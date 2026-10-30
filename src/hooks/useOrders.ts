/* oxlint-disable set-state-in-effect -- fetchOrders/fetchFee are async (void-wrapped); setState is never called synchronously inside the effect */
/**
 * useOrders — fetch, sign, submit, and cancel signed limit-buy orders.
 *
 * Signing flow:
 *  1. Compute program payload from compiled Sauce program + entry args
 *  2. Call signedCookTypedData → get EIP-712 typed data
 *  3. User signs with signTypedData (no gas, no transaction)
 *  4. POST signed order to /api/orders for server-side verification + storage
 *
 * Cancel flow:
 *  - If deadline passed / nonce used: DELETE with no signature required
 *  - For live orders: personal_sign "cancel:<nonce>", then DELETE
 *
 * Also provides onchain cancel (encodeInvalidateNonces) via the wallet.
 */

import { useState, useCallback, useEffect } from 'react'
import { useAccount, usePublicClient, useWalletClient, useSignTypedData } from 'wagmi'
import {
  getAddress, concatHex, bytesToHex,
  type Hex, type WalletClient,
} from 'viem'
import {
  signedCookTypedData,
  cookNonceWordBit,
  encodeInvalidateNonces,
  randomCookNonce,
} from '@eco-incorp/sauce/evm/engine'

import { routes, DEFAULT_POT_SALT, v12PredictPot, kitchenExecutionFee } from '@eco-incorp/sauce'
import { ENGINE, MIN_FEE_PER_GAS, type CompiledPrograms } from './useSauce'
import { TARGET_CHAIN_ID, IS_MAINNET } from '../contracts'
import type { SignedOrder } from '../../api/orders'

export type { SignedOrder }

// ─── Constants ───────────────────────────────────────────────────────────────

/** The Trivo bot address — the only submitter allowed in signed orders. */
export const BOT_ADDRESS = '0x58833a0C95eCdF90C8E468bd4B04bE06a5Ec6B13' as Hex

const ORDERS_API = '/api/orders'
const ARC_CHAIN_ID = 5042

// ─── AMM helpers ─────────────────────────────────────────────────────────────

/** Uniswap-V2 style quote with 0.3% fee. */
export function ammQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const fee = amountIn * 997n
  return (fee * reserveOut) / (reserveIn * 1000n + fee)
}

/**
 * Compute minBtc and minEurc for a limit-buy order.
 *
 * minBtc is derived from the TARGET price the user entered — not the current price.
 * This ensures the order only executes if cirBTC is at or below their chosen level.
 *
 *   usdcForBtc  = usdcAmount * btcBps / 10000
 *   usdcForEurc = usdcAmount * eurcBps / 10000
 *   minBtc  = floor(usdcForBtc * 1e8 / targetPrice * 0.99 * 0.997)
 *   minEurc = floor(ammQuote(usdcForEurc, eurcR0, eurcR1) * 0.98)
 *
 * @param usdcAmount   6-decimal USDC units
 * @param btcBps       allocation basis points (e.g. 3000 = 30%)
 * @param eurcBps      allocation basis points
 * @param targetPrice  USDC per whole cirBTC, 6-decimal units
 * @param eurcR0       EURC pool USDC reserve
 * @param eurcR1       EURC pool EURC reserve
 */
export function computeMins(
  usdcAmount:  bigint,
  btcBps:      number,
  eurcBps:     number,
  targetPrice: bigint,
  eurcR0:      bigint,
  eurcR1:      bigint,
): { minBtc: bigint; minEurc: bigint } {
  if (usdcAmount === 0n || targetPrice === 0n) return { minBtc: 0n, minEurc: 0n }

  const usdcForBtc  = (usdcAmount * BigInt(btcBps))  / 10000n
  const usdcForEurc = (usdcAmount * BigInt(eurcBps)) / 10000n

  // minBtc: target-price-derived, minus 1% user slippage, minus 0.3% pool fee
  // = usdcForBtc * 1e8 / targetPrice * 99/100 * 997/1000
  const rawBtc  = (usdcForBtc * 100_000_000n) / targetPrice
  const minBtc  = (rawBtc * 99n * 997n) / (100n * 1000n)

  // minEurc: current-pool quote with 2% tolerance
  const rawEurc = ammQuote(usdcForEurc, eurcR0, eurcR1)
  const minEurc = (rawEurc * 98n) / 100n

  return { minBtc, minEurc }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type OrdersState = 'idle' | 'loading' | 'signing' | 'submitting' | 'cancelling'

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrders(
  compiled:  CompiledPrograms | null,
  btcBps:    number,
  eurcBps:   number,
  eurcR0:    bigint,
  eurcR1:    bigint,
) {
  const { address, isConnected } = useAccount()
  const publicClient  = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const { data: rawWallet } = useWalletClient()
  const walletClient  = rawWallet as WalletClient | undefined
  const { signTypedDataAsync } = useSignTypedData()

  const [orders,    setOrders]    = useState<SignedOrder[]>([])
  const [state,     setState]     = useState<OrdersState>('idle')
  const [error,     setError]     = useState<string | null>(null)
  const [kitchenFee, setKitchenFee] = useState<bigint>(0n)

  // Derive Pot address for connected wallet
  const potAddress: Hex | null = address
    ? (getAddress(v12PredictPot(getAddress(address), DEFAULT_POT_SALT)))
    : null

  // ── Fetch orders ────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (!address || !IS_MAINNET) return
    setState('loading')
    try {
      const r = await fetch(`${ORDERS_API}?owner=${address}`)
      const j = await r.json() as { orders?: SignedOrder[]; error?: string }
      if (!r.ok) throw new Error(j.error ?? r.statusText)
      setOrders(j.orders ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setState('idle')
    }
  }, [address])

  // ── Fetch Kitchen fee ───────────────────────────────────────────────────────
  const fetchFee = useCallback(async () => {
    if (!publicClient) return
    try {
      const req = kitchenExecutionFee()
      const { data } = await publicClient.call({ to: req.to, data: req.data })
      if (data) setKitchenFee(req.decode(data))
    } catch { /* use 0n */ }
  }, [publicClient])

  useEffect(() => {
    if (!isConnected || !address) return
    void fetchOrders()
    void fetchFee()
  }, [isConnected, address, fetchOrders, fetchFee])

  // ── Sign + submit an order ──────────────────────────────────────────────────
  const submitOrder = useCallback(async (usdcAmount: bigint, targetPrice: bigint, label: string): Promise<boolean> => {
    if (!address || !compiled || !potAddress || !IS_MAINNET) return false
    setError(null)

    const { minBtc, minEurc } = computeMins(
      usdcAmount, btcBps, eurcBps, targetPrice, eurcR0, eurcR1,
    )
    if (minBtc === 0n) { setError('Could not compute minBtc — check pool reserves'); return false }

    if (orders.length >= 3) { setError('Maximum 3 active orders'); return false }

    const p       = compiled.conditionalBasket
    const args    = routes.encodeEntryArguments(p, [
      address,   // recipient
      usdcAmount,
      targetPrice,   // maxBtcPrice
      minEurc,
      minBtc,
    ])
    const program = concatHex([bytesToHex(p.bytecode), bytesToHex(args)])

    const nonce    = randomCookNonce()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
    // maxExecutionFee: 2× Kitchen fee for headroom
    const maxFee   = kitchenFee * 2n || 20_000_000_000_000_000n

    const cookData = {
      chainId:         ARC_CHAIN_ID,
      pot:             potAddress,
      engine:          ENGINE,
      program,
      value:           0n,   // Pot pays Kitchen fee internally
      maxExecutionFee: maxFee,
      nonce,
      deadline,
      submitter:       BOT_ADDRESS,
    }

    const typedData = signedCookTypedData(cookData)

    setState('signing')
    let signature: Hex
    try {
      signature = await signTypedDataAsync({
        domain:      typedData.domain,
        types:       typedData.types,
        primaryType: typedData.primaryType,
        message:     typedData.message,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 120) : 'Sign cancelled')
      setState('idle')
      return false
    }

    setState('submitting')
    try {
      const body: Partial<SignedOrder> & { chainId: number } = {
        owner:            getAddress(address),
        pot:              potAddress,
        nonce:            nonce.toString(),
        deadline:         deadline.toString(),
        program,
        signature,
        maxExecutionFee:  maxFee.toString(),
        value:            '0',
        targetPriceLabel: label,
        usdcAmount:       usdcAmount.toString(),
        chainId:          ARC_CHAIN_ID,
      }
      const r = await fetch(ORDERS_API, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const j = await r.json() as { order?: SignedOrder; error?: string }
      if (!r.ok) throw new Error(j.error ?? r.statusText)
      setOrders(prev => [...prev, j.order!])
      setState('idle')
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setState('idle')
      return false
    }
  }, [address, compiled, potAddress, btcBps, eurcBps, eurcR0, eurcR1, orders.length, kitchenFee, signTypedDataAsync])

  // ── Cancel an order ─────────────────────────────────────────────────────────
  const cancelOrder = useCallback(async (nonce: string): Promise<boolean> => {
    if (!address || !walletClient) return false
    setError(null)
    setState('cancelling')
    try {
      // Try without cancelSig first (expired / used orders)
      let r = await fetch(ORDERS_API, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ owner: address, nonce }),
      })

      // If the server requires a cancelSig, sign and retry
      if (r.status === 403) {
        const message = `cancel:${nonce}` as const
        const cancelSig = await walletClient.signMessage({ account: address, message })
        r = await fetch(ORDERS_API, {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ owner: address, nonce, cancelSig }),
        })
      }

      const j = await r.json() as { removed?: string; error?: string }
      if (!r.ok) throw new Error(j.error ?? r.statusText)
      setOrders(prev => prev.filter(o => o.nonce !== nonce))
      setState('idle')
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setState('idle')
      return false
    }
  }, [address, walletClient])

  // ── Onchain nonce invalidation (burns the nonce in the Pot) ─────────────────
  const invalidateOnchain = useCallback(async (nonce: bigint): Promise<Hex | null> => {
    if (!address || !walletClient || !potAddress) return null
    try {
      const feeCap = async () => {
        if (!publicClient) return MIN_FEE_PER_GAS
        try {
          const est = await publicClient.estimateFeesPerGas()
          return est.maxFeePerGas > MIN_FEE_PER_GAS ? est.maxFeePerGas : MIN_FEE_PER_GAS
        } catch { return MIN_FEE_PER_GAS }
      }
      const { word, mask } = cookNonceWordBit(nonce)
      const data = encodeInvalidateNonces(word, mask)
      const hash: Hex = await (walletClient).sendTransaction({
        account:      address,
        to:           potAddress,
        data,
        value:        0n,
        maxFeePerGas: await feeCap(),
        chain:        null,
      })
      return hash
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      return null
    }
  }, [address, walletClient, potAddress, publicClient])

  return {
    orders,
    state,
    error,
    setError,
    kitchenFee,
    potAddress,
    fetchOrders,
    submitOrder,
    cancelOrder,
    invalidateOnchain,
  }
}
