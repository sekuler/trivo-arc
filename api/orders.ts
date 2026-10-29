/**
 * /api/orders — signed-cook order storage (Vercel serverless function).
 *
 * POST   /api/orders               submit a new signed order (server-side sig verify)
 * GET    /api/orders?owner=0x…     list active orders for one owner
 * GET    /api/orders?all=true      list all orders (bot; requires Authorization: Bearer CRON_SECRET)
 * DELETE /api/orders               cancel an order (owner EIP-191 cancel sig required for live orders)
 *
 * Storage: Upstash Redis — key  orders:<checksummed owner>  →  SignedOrder[]
 * Max 3 active orders per owner. Stale entries (expired / nonce used) are pruned on read.
 *
 * RPC: uses RPC_PROXY_BASE_URL when set; falls back to the Arc Mainnet public endpoint
 * from the onchain-facts registry.
 *
 * Self-contained: no relative imports from ../src, no JSON imports.
 * The inlined CONDITIONAL_BASKET_SOURCE string MUST stay identical to
 * src/sauce/conditionalBasket.source.ts — update both together.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import {
  createPublicClient, http,
  getAddress, recoverMessageAddress, isHex, hexToBytes,
} from 'viem'
import { arc } from 'viem/chains'
import {
  verifySignedCook,
  checkSignedCookPot,
  cookNonceUsed,
} from '@eco-incorp/sauce/evm/engine'
import { v12EngineAddress } from '@eco-incorp/sauce/deployments'
import { routes } from '@eco-incorp/sauce'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SignedOrder {
  owner:            string   // checksummed
  pot:              string   // checksummed
  nonce:            string   // bigint as decimal string
  deadline:         string   // unix seconds as decimal string
  program:          string   // 0x-prefixed compiled bytecode + args
  signature:        string   // EIP-712 sig from owner
  maxExecutionFee:  string   // bigint as decimal string
  value:            string   // '0' — Pot pays Kitchen fee internally
  targetPriceLabel: string   // display-only (e.g. "80000 USDC/cirBTC")
  usdcAmount:       string   // 6-dec units, decimal string
  createdAt:        string   // ISO timestamp
  chainId:          number   // must be 5042
}

// ─── Inlined Sauce source + ABIs ─────────────────────────────────────────────
// KEEP IN SYNC with src/sauce/conditionalBasket.source.ts — update both together.

const CONDITIONAL_BASKET_SOURCE = `\
// Conditional basket deposit: deposits USDC into the Trivo basket only if
// the current cirBTC price is at or below the user's limit.
//
// sauce run conditionalBasket.sauce.ts --chain arc \\
//   --args <recipient> <usdcAmount> <maxBtcPrice> <minEurc> <minBtc>
//
//   recipient:   Address  — the wallet that receives the basket position
//   usdcAmount:  Uint256  — USDC amount in 6-decimal units (e.g. 5000000 = 5 USDC)
//   maxBtcPrice: Uint256  — max cirBTC price in USDC, expressed as USDC-per-cirBTC
//                           scaled to 6 decimals (e.g. 100000000 = 100 USDC per BTC)
//   minEurc:     Uint256  — min EURC out of the EURC pool swap, in 6-decimal units
//   minBtc:      Uint256  — min cirBTC out of the BTC pool swap, in 8-decimal units
//
// Example (Arc mainnet, 1 USDC, max BTC price 100000 USDC/BTC):
//   sauce run conditionalBasket.sauce.ts --chain arc \\
//     --args 0xYOUR_WALLET 1000000 100000000000 0 0

import BasketPoolABI from "./BasketPool.abi.json"
import BasketABI from "./Basket.abi.json"

function main(
  recipient:   Address,
  usdcAmount:  Uint256,
  maxBtcPrice: Uint256,
  minEurc:     Uint256,
  minBtc:      Uint256,
) {
  // 1. Read BTC pool reserves only (EURC price check is not needed here)
  //    BTC pool: token0=USDC (6 dec), token1=cirBTC (8 dec)
  //             reserve0=USDC, reserve1=cirBTC (confirmed onchain)
  const [r0btc, r1btc] = BasketPoolABI.at(0xBb97d774C019b138250245794092E9a511E35449).getReserves()

  // 2. Compute cirBTC spot price as USDC-per-cirBTC, normalized to 6 dec
  //    price = r0btc (6 dec) * 1e8 / r1btc (8 dec)  →  USDC per whole cirBTC
  require(r1btc > 0, "BTC pool empty")

  const btcPrice = (r0btc * 100000000) / r1btc

  // 3. Price guard — revert if price exceeds user's limit
  require(btcPrice <= maxBtcPrice, "price above limit")

  // 4. Approve USDC from Pot to Basket contract
  USDC.approve(0x104b0f1b643f642E1cAf264a85B1B105503f3dB5, usdcAmount)

  // 5. Deposit — basket position credited directly to recipient's wallet
  BasketABI.at(0x104b0f1b643f642E1cAf264a85B1B105503f3dB5).depositUsdcFor(recipient, usdcAmount, minEurc, minBtc)
}
`

// Minimal ABI for the Sauce compiler's resolve callback.
// Matches src/sauce/BasketPool.abi.json exactly.
const BASKET_POOL_ABI_JSON = JSON.stringify([
  {
    type: 'function', name: 'getReserves',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
])

// Minimal ABI for the Sauce compiler's resolve callback.
// Matches src/sauce/Basket.abi.json exactly.
const BASKET_ABI_JSON = JSON.stringify([
  {
    type: 'function', name: 'depositUsdcFor',
    inputs: [
      { name: 'recipient',  type: 'address' },
      { name: 'usdcAmount', type: 'uint256' },
      { name: 'minEurc',    type: 'uint256' },
      { name: 'minBtc',     type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
])

// ─── Sauce constants (server-side) ───────────────────────────────────────────

const ENGINE      = v12EngineAddress() as `0x${string}`
// arc-studio-allow-onchain-literal
const BOT_ADDRESS = '0x58833a0C95eCdF90C8E468bd4B04bE06a5Ec6B13' as `0x${string}`

// Compile conditionalBasket once at cold-start (Node native build — no ready() needed).
const _enc = (s: string) => new TextEncoder().encode(s)
const _resolve = (spec: string): Uint8Array | undefined => {
  if (spec === './BasketPool.abi.json') return _enc(BASKET_POOL_ABI_JSON)
  if (spec === './Basket.abi.json')     return _enc(BASKET_ABI_JSON)
  return undefined
}

let COMPILED_CB: ReturnType<typeof routes.compileSauceProgram>
let BYTECODE_LEN:  number
let BYTECODE_HEX:  string   // full bytecode as lowercase hex (no 0x prefix)
let COMPILE_ERROR: string | null = null

try {
  COMPILED_CB  = routes.compileSauceProgram('arc', CONDITIONAL_BASKET_SOURCE, { resolve: _resolve })
  BYTECODE_LEN = COMPILED_CB.bytecode.length
  BYTECODE_HEX = Buffer.from(COMPILED_CB.bytecode).toString('hex')  // all BYTECODE_LEN bytes
} catch (e: unknown) {
  COMPILE_ERROR = e instanceof Error ? e.message : String(e)
  // Assign stubs so TypeScript is satisfied; handler returns 500 before using them
  COMPILED_CB   = null as unknown as ReturnType<typeof routes.compileSauceProgram>
  BYTECODE_LEN  = 0
  BYTECODE_HEX  = ''
}

// 0.1 USDC in 18-decimal native units = 100_000_000_000_000_000
const MAX_EXECUTION_FEE = 100_000_000_000_000_000n

// ─── RPC / infra ─────────────────────────────────────────────────────────────

function arcRpcUrl(): string {
  const proxyBase = process.env.RPC_PROXY_BASE_URL
  const chains    = process.env.RPC_PROXY_CHAINS ?? ''
  if (proxyBase && chains.includes('5042')) {
    const token = process.env.RPC_PROXY_TOKEN ?? ''
    return token
      ? `${proxyBase}/api/rpc/5042?_rpc_token=${token}`
      : `${proxyBase}/api/rpc/5042`
  }
  // Fallback: public Arc Mainnet endpoint from onchain-facts registry
  // arc-studio-allow-onchain-literal
  return 'https://rpc.mainnet.arc.io'
}

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL   ?? '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
})

const publicClient = createPublicClient({
  chain:     arc,
  transport: http(arcRpcUrl()),
})

const ARC_CHAIN_ID = 5042
const MAX_ORDERS   = 3
const CRON_SECRET  = process.env.CRON_SECRET ?? ''

// ─── Redis helpers ────────────────────────────────────────────────────────────

function redisKey(owner: string) { return `orders:${getAddress(owner)}` }

async function loadOrders(owner: string): Promise<SignedOrder[]> {
  const raw = await redis.get<SignedOrder[]>(redisKey(owner))
  return raw ?? []
}

async function saveOrders(owner: string, orders: SignedOrder[]): Promise<void> {
  await redis.set(redisKey(owner), orders)
}

/** Remove entries whose deadline has passed or whose nonce is already used onchain. */
async function pruneOrders(orders: SignedOrder[]): Promise<SignedOrder[]> {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const alive: SignedOrder[] = []
  for (const o of orders) {
    if (BigInt(o.deadline) < now) continue
    const used = await cookNonceUsed(
      publicClient as Parameters<typeof cookNonceUsed>[0],
      getAddress(o.pot) as `0x${string}`,
      BigInt(o.nonce),
    )
    if (used) continue
    alive.push(o)
  }
  return alive
}

// ─── Main handler ────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    if (COMPILE_ERROR) return res.status(500).json({ error: `Sauce compiler init failed: ${COMPILE_ERROR}` })
    if (req.method === 'GET')    return await handleGet(req, res)
    if (req.method === 'POST')   return await handlePost(req, res)
    if (req.method === 'DELETE') return await handleDelete(req, res)
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: unknown) {
    console.error('[orders]', e)
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal error' })
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const query = req.query as Record<string, string>

  // Bot: fetch all orders — protected by CRON_SECRET
  if (query['all'] === 'true') {
    const auth = (req.headers['authorization'] ?? '') as string
    if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const keys = await redis.keys('orders:*')
    const allOrders: SignedOrder[] = []
    for (const key of keys) {
      const raw = await redis.get<SignedOrder[]>(key)
      if (raw) allOrders.push(...raw)
    }
    return res.status(200).json({ orders: allOrders })
  }

  const { owner } = query
  if (!owner) return res.status(400).json({ error: 'owner query param required' })
  let checksumOwner: string
  try { checksumOwner = getAddress(owner) }
  catch { return res.status(400).json({ error: 'Invalid owner address' }) }

  const raw    = await loadOrders(checksumOwner)
  const pruned = await pruneOrders(raw)
  if (pruned.length !== raw.length) await saveOrders(checksumOwner, pruned)

  return res.status(200).json({ orders: pruned })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const body = req.body as Partial<SignedOrder> & { chainId?: number }

  // ── Field presence ────────────────────────────────────────────────────────
  const required = ['owner','pot','nonce','deadline','program','signature',
                    'maxExecutionFee','usdcAmount','targetPriceLabel'] as const
  for (const f of required) {
    if (!body[f]) return res.status(400).json({ error: `Missing field: ${f}` })
  }

  let owner: `0x${string}`, pot: `0x${string}`
  try {
    owner = getAddress(body.owner!) as `0x${string}`
    pot   = getAddress(body.pot!)   as `0x${string}`
  } catch { return res.status(400).json({ error: 'Invalid address' }) }

  if (!isHex(body.program!))   return res.status(400).json({ error: 'program must be 0x hex' })
  if (!isHex(body.signature!)) return res.status(400).json({ error: 'signature must be 0x hex' })
  if (body.chainId !== ARC_CHAIN_ID) {
    return res.status(400).json({ error: `chainId must be ${ARC_CHAIN_ID}` })
  }

  // ── Policy: value must be "0" ─────────────────────────────────────────────
  if ((body.value ?? '0') !== '0') {
    return res.status(400).json({ error: 'value must be "0" — the Pot pays the Kitchen fee internally' })
  }

  // ── Policy: deadline ≤ now + 8 days ──────────────────────────────────────
  const now      = BigInt(Math.floor(Date.now() / 1000))
  const deadline = BigInt(body.deadline!)
  if (deadline < now) return res.status(400).json({ error: 'Order already expired' })
  if (deadline > now + 8n * 86400n) {
    return res.status(400).json({ error: 'deadline must be at most 8 days from now' })
  }

  // ── Policy: maxExecutionFee ≤ 0.1 USDC (18-dec native units) ─────────────
  const maxFee = BigInt(body.maxExecutionFee!)
  if (maxFee > MAX_EXECUTION_FEE) {
    return res.status(400).json({ error: `maxExecutionFee exceeds 0.1 USDC limit (${MAX_EXECUTION_FEE})` })
  }

  // ── Policy: program must start with the full compiled conditionalBasket bytecode ──
  // Compare all BYTECODE_LEN bytes, not just a prefix, to rule out substituted programs.
  const programHex = body.program!.slice(2).toLowerCase()
  if (programHex.length < BYTECODE_LEN * 2) {
    return res.status(400).json({ error: 'program too short to contain conditionalBasket bytecode' })
  }
  if (!programHex.startsWith(BYTECODE_HEX)) {
    return res.status(400).json({ error: 'program does not match conditionalBasket bytecode' })
  }

  // ── Policy: decode entry args — recipient must equal owner, usdcAmount must match ──
  const argsBytes = hexToBytes(('0x' + programHex.slice(BYTECODE_LEN * 2)) as `0x${string}`)
  let decodedArgs: unknown[]
  try {
    decodedArgs = routes.decodeEntryArguments(COMPILED_CB, argsBytes) as unknown[]
  } catch (e: unknown) {
    return res.status(400).json({ error: 'Failed to decode program entry arguments: ' + (e instanceof Error ? e.message : String(e)) })
  }
  const recipient  = decodedArgs[0] as string
  const usdcAmount = decodedArgs[1] as bigint
  if (getAddress(recipient) !== owner) {
    return res.status(403).json({ error: `program recipient (${recipient}) must equal owner (${owner})` })
  }
  const claimedUsdc = BigInt(body.usdcAmount!)
  if (usdcAmount !== claimedUsdc) {
    return res.status(400).json({ error: `program usdcAmount (${usdcAmount}) does not match body.usdcAmount (${claimedUsdc})` })
  }

  // ── Onchain: Pot deployed and owned by owner ──────────────────────────────
  const potCheck = await checkSignedCookPot(
    publicClient as Parameters<typeof checkSignedCookPot>[0],
    pot,
  )
  if (!potCheck.ok) {
    return res.status(400).json({ error: `Pot check failed: ${potCheck.reason ?? 'unknown'}` })
  }
  if ((getAddress(potCheck.owner) as `0x${string}`) !== owner) {
    return res.status(403).json({ error: `Pot owner mismatch: ${potCheck.owner} !== ${owner}` })
  }

  // ── EIP-712 signature verification ───────────────────────────────────────
  // engine = ENGINE (same constant the frontend uses when building signedCookTypedData)
  // submitter = BOT_ADDRESS (the only allowed submitter)
  // value = 0n (the Pot pays the Kitchen fee internally)
  const valid = await verifySignedCook(
    {
      chainId:         ARC_CHAIN_ID,
      pot,
      engine:          ENGINE,
      program:         body.program! as `0x${string}`,
      value:           0n,
      maxExecutionFee: maxFee,
      nonce:           BigInt(body.nonce!),
      deadline,
      submitter:       BOT_ADDRESS,
      owner,
      signature:       body.signature! as `0x${string}`,
    },
    publicClient as Parameters<typeof verifySignedCook>[1],
  )
  if (!valid) return res.status(403).json({ error: 'Invalid signature' })

  // ── Nonce freshness ───────────────────────────────────────────────────────
  const used = await cookNonceUsed(
    publicClient as Parameters<typeof cookNonceUsed>[0],
    pot,
    BigInt(body.nonce!),
  )
  if (used) return res.status(409).json({ error: 'Nonce already used' })

  // ── Load, prune, cap, dedup ───────────────────────────────────────────────
  const existing = await loadOrders(owner)
  const pruned   = await pruneOrders(existing)
  if (pruned.length >= MAX_ORDERS) {
    return res.status(409).json({ error: `Max ${MAX_ORDERS} active orders per owner` })
  }
  if (pruned.some(o => o.nonce === body.nonce)) {
    return res.status(409).json({ error: 'Duplicate nonce' })
  }

  const order: SignedOrder = {
    owner,
    pot,
    nonce:            body.nonce!,
    deadline:         body.deadline!,
    program:          body.program!,
    signature:        body.signature!,
    maxExecutionFee:  body.maxExecutionFee!,
    value:            '0',
    targetPriceLabel: body.targetPriceLabel!,
    usdcAmount:       body.usdcAmount!,
    createdAt:        new Date().toISOString(),
    chainId:          ARC_CHAIN_ID,
  }
  pruned.push(order)
  await saveOrders(owner, pruned)

  return res.status(201).json({ order })
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const body = req.body as { owner?: string; nonce?: string; cancelSig?: string }
  if (!body.owner || !body.nonce) {
    return res.status(400).json({ error: 'owner and nonce required' })
  }

  let owner: string
  try { owner = getAddress(body.owner) }
  catch { return res.status(400).json({ error: 'Invalid owner address' }) }

  const existing = await loadOrders(owner)
  const target   = existing.find(o => o.nonce === body.nonce)
  if (!target) return res.status(404).json({ error: 'Order not found' })

  const now     = BigInt(Math.floor(Date.now() / 1000))
  const expired = BigInt(target.deadline) < now
  const used    = !expired && await cookNonceUsed(
    publicClient as Parameters<typeof cookNonceUsed>[0],
    getAddress(target.pot) as `0x${string}`,
    BigInt(target.nonce),
  )

  // Live order: require a personal-sign cancel message from the owner
  if (!expired && !used) {
    if (!body.cancelSig) {
      return res.status(403).json({ error: 'cancelSig required for active orders' })
    }
    let recovered: string
    try {
      recovered = await recoverMessageAddress({
        message:   `cancel:${body.nonce}`,
        signature: body.cancelSig as `0x${string}`,
      })
    } catch {
      return res.status(403).json({ error: 'Invalid cancelSig' })
    }
    if (getAddress(recovered) !== owner) {
      return res.status(403).json({ error: 'cancelSig not signed by owner' })
    }
  }

  await saveOrders(owner, existing.filter(o => o.nonce !== body.nonce))
  return res.status(200).json({ removed: target.nonce })
}
