/**
 * Trivo Arc — signed-cook bot runner.
 *
 * Reads all "orders:*" keys from Upstash Redis, checks each order, and
 * submits the cook tx when the eth_call simulation succeeds.
 *
 * Usage:
 *   bun run scripts/bot-runner.mts
 *
 * Required env vars:
 *   BOT_PRIVATE_KEY       — 0x-prefixed private key; address must equal BOT_ADDRESS
 *   KV_REST_API_URL       — Upstash Redis REST URL (or UPSTASH_REDIS_REST_URL)
 *   KV_REST_API_TOKEN     — Upstash Redis REST token (or UPSTASH_REDIS_REST_TOKEN)
 *
 * Optional:
 *   DRY_RUN=true          — simulate and log only; never broadcast
 *
 * Never prints BOT_PRIVATE_KEY or any other secret.
 */

import { Redis }               from '@upstash/redis'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
  hexToString,
  getAddress,
  isHex,
  type Hex,
}                              from 'viem'
import { arc }                 from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeCookSigned,
  cookNonceUsed,
}                              from '@eco-incorp/sauce/evm/engine'
import { v12EngineAddress }    from '@eco-incorp/sauce/deployments'

// ─── Constants ───────────────────────────────────────────────────────────────

// arc-studio-allow-onchain-literal
const ARC_RPC     = 'https://rpc.mainnet.arc.io'
const ARC_CHAIN_ID = 5042
const MIN_GAS_GWEI = 20n
// arc-studio-allow-onchain-literal
const BOT_ADDRESS  = '0x58833a0C95eCdF90C8E468bd4B04bE06a5Ec6B13' as `0x${string}`
const ENGINE       = v12EngineAddress() as `0x${string}`

// ─── Env ─────────────────────────────────────────────────────────────────────

const DRY_RUN     = process.env['DRY_RUN'] === 'true'
const BOT_KEY     = process.env['BOT_PRIVATE_KEY'] ?? ''
const KV_URL      = process.env['KV_REST_API_URL']      ?? process.env['UPSTASH_REDIS_REST_URL']   ?? ''
const KV_TOKEN    = process.env['KV_REST_API_TOKEN']    ?? process.env['UPSTASH_REDIS_REST_TOKEN'] ?? ''

if (!BOT_KEY)   { console.error('[bot] BOT_PRIVATE_KEY is not set'); process.exit(1) }
if (!KV_URL)    { console.error('[bot] KV_REST_API_URL is not set');  process.exit(1) }
if (!KV_TOKEN)  { console.error('[bot] KV_REST_API_TOKEN is not set'); process.exit(1) }
if (!isHex(BOT_KEY)) { console.error('[bot] BOT_PRIVATE_KEY must be 0x-prefixed hex'); process.exit(1) }

// ─── Clients ─────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(BOT_KEY as Hex)

// Verify the key matches the expected bot address at startup
if (getAddress(account.address) !== getAddress(BOT_ADDRESS)) {
  console.error(
    `[bot] Key address ${account.address} does not match BOT_ADDRESS ${BOT_ADDRESS} — aborting`
  )
  process.exit(1)
}

const transport = http(ARC_RPC, { retryCount: 2, retryDelay: 600 })

const publicClient = createPublicClient({ chain: arc, transport })
const walletClient = createWalletClient({ chain: arc, transport, account })

const redis = new Redis({ url: KV_URL, token: KV_TOKEN })

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignedOrder {
  owner:            string
  pot:              string
  nonce:            string
  deadline:         string
  program:          string
  signature:        string
  maxExecutionFee:  string
  value:            string
  targetPriceLabel: string
  usdcAmount:       string
  createdAt:        string
  chainId:          number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function short(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}` }

/** Decode a raw revert payload to a human-readable string. */
function decodeRevert(data: Hex | undefined): string {
  if (!data || data === '0x') return '(empty revert)'
  // Error(string): selector 0x08c379a0
  if (data.startsWith('0x08c379a0')) {
    try {
      const offset  = parseInt(data.slice(10, 74), 16)          // skip selector + offset
      const length  = parseInt(data.slice(10 + offset * 2, 10 + offset * 2 + 64), 16)
      const msgHex  = data.slice(10 + offset * 2 + 64, 10 + offset * 2 + 64 + length * 2)
      return hexToString(`0x${msgHex}`)
    } catch { /* fall through */ }
  }
  // try UTF-8 decode of raw bytes
  try { return hexToString(data) } catch { return data.slice(0, 66) }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[bot] Starting${DRY_RUN ? ' (DRY RUN)' : ''} — bot: ${short(BOT_ADDRESS)}`)

  // Load all order keys from Redis
  const keys = await redis.keys('orders:*')
  if (keys.length === 0) { console.log('[bot] No orders found.'); return }

  const now = BigInt(Math.floor(Date.now() / 1000))

  // Estimate network gas price and enforce 20 gwei minimum
  let networkGwei: bigint
  try {
    const fee = await publicClient.estimateFeesPerGas()
    networkGwei = fee.maxFeePerGas ?? parseGwei('20')
  } catch {
    networkGwei = parseGwei('20')
  }
  const maxFeePerGas = networkGwei > parseGwei(MIN_GAS_GWEI.toString())
    ? networkGwei
    : parseGwei(MIN_GAS_GWEI.toString())

  for (const key of keys) {
    const orders = await redis.get<SignedOrder[]>(key)
    if (!orders || orders.length === 0) continue

    const remaining: SignedOrder[] = []

    for (const order of orders) {
      const tag = `owner=${short(order.owner)} target=${order.targetPriceLabel}`

      // 1. Expired?
      if (BigInt(order.deadline) < now) {
        console.log(`[bot] EXPIRED   ${tag}`)
        continue  // drop from remaining
      }

      const pot    = getAddress(order.pot)
      const nonce  = BigInt(order.nonce)

      // 2. Nonce already used onchain?
      let nonceUsed: boolean
      try {
        nonceUsed = await cookNonceUsed(publicClient, pot, nonce)
      } catch (e) {
        console.error(`[bot] ERROR checking nonce for ${tag}:`, e)
        remaining.push(order)
        continue
      }
      if (nonceUsed) {
        console.log(`[bot] USED      ${tag}`)
        continue  // drop from remaining
      }

      // 3. Build the cook tx with encodeCookSigned
      const cookTx = encodeCookSigned({
        chainId:         ARC_CHAIN_ID,
        pot,
        engine:          ENGINE,
        program:         order.program  as `0x${string}`,
        value:           0n,
        maxExecutionFee: BigInt(order.maxExecutionFee),
        nonce,
        deadline:        BigInt(order.deadline),
        submitter:       BOT_ADDRESS,
        signature:       order.signature as `0x${string}`,
      })

      // 4. eth_call simulate from bot account
      let revertReason: string | null = null
      try {
        await publicClient.call({
          account: account.address,
          to:      cookTx.to,
          data:    cookTx.data,
          value:   cookTx.value,
        })
        revertReason = null  // success
      } catch (err: unknown) {
        // Walk viem's error chain for the raw revert data
        let rawData: Hex | undefined
        let cur: unknown = err
        for (let i = 0; i < 10 && cur && typeof cur === 'object' && !rawData; i++) {
          const o = cur as { data?: unknown; cause?: unknown }
          if (typeof o.data === 'string' && o.data.startsWith('0x') && o.data.length > 2) rawData = o.data as Hex
          else if (o.data && typeof o.data === 'object') {
            const inner = (o.data as { data?: unknown }).data
            if (typeof inner === 'string' && inner.startsWith('0x') && inner.length > 2) rawData = inner as Hex
          }
          cur = o.cause
        }
        revertReason = decodeRevert(rawData)
        if (!rawData && err instanceof Error) revertReason += ` ${err.message.slice(0, 160)}`
      }

      // 5. "price above limit" — condition not met, keep the order
      if (revertReason !== null && revertReason.includes('price above limit')) {
        console.log(`[bot] SKIP      ${tag} — price above limit`)
        remaining.push(order)
        continue
      }

      // 6. Any other revert — log and keep (user may need to add funds)
      if (revertReason !== null) {
        console.log(`[bot] REVERT    ${tag} — ${revertReason}`)
        remaining.push(order)
        continue
      }

      // 7. Simulation succeeded
      if (DRY_RUN) {
        console.log(`[bot] DRY_RUN   ${tag} — simulation OK, would send`)
        remaining.push(order)
        continue
      }

      // 8. Send the real tx
      console.log(`[bot] SENDING   ${tag}`)
      try {
        const hash = await walletClient.sendTransaction({
          to:           cookTx.to,
          data:         cookTx.data,
          value:        cookTx.value,
          maxFeePerGas,
        })
        console.log(`[bot] SENT      ${tag} — tx ${hash}`)

        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status === 'success') {
          console.log(`[bot] SUCCESS   ${tag} — block ${receipt.blockNumber}`)
          // Drop order (do not push to remaining)
        } else {
          console.log(`[bot] REVERTED  ${tag} — block ${receipt.blockNumber}`)
          remaining.push(order)  // keep for next run
        }
      } catch (sendErr: unknown) {
        console.error(`[bot] SEND_ERR  ${tag}:`, sendErr instanceof Error ? sendErr.message : sendErr)
        remaining.push(order)
      }
    }

    // Write back the surviving orders (or delete the key if empty)
    if (remaining.length !== orders.length) {
      if (remaining.length === 0) {
        await redis.del(key)
      } else {
        await redis.set(key, remaining)
      }
    }
  }

  console.log('[bot] Done.')
}

run().catch(e => { console.error('[bot] Fatal:', e); process.exit(1) })
