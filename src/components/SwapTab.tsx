import { useState, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from 'wagmi'
import { erc20Abi, parseAbiItem, decodeEventLog } from 'viem'
import { toast } from 'sonner'
import { ArrowUpDown, Loader2, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'
import { BASKET_POOL_ABI, getAddresses, TARGET_CHAIN_ID, TARGET_CHAIN, GAS_FALLBACK } from '../contracts'
import { TokenLogo } from './TokenLogo'
import { estimateGas } from '../estimateGas'
import { usePoolReserves, useTokenBalances } from '../hooks/useContracts'
import { useRefresh } from '../context/RefreshContext'
import { formatUnits, parseUnitsStrict, slippageFactor, deadline, calcPriceImpactBps } from '../utils/format'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { saveActivity } from '../hooks/useActivity'

const glass = {
  card: { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

const TOKENS = ['USDC', 'EURC', 'CIRBTC'] as const
type Token = typeof TOKENS[number]

const TOKEN_LABEL: Record<Token, string> = { USDC: 'USDC', EURC: 'EURC', CIRBTC: 'cirBTC' }
const TOKEN_DEC:   Record<Token, number>  = { USDC: 6,      EURC: 6,      CIRBTC: 8 }

const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, bool zeroForOne, address indexed to)'
)

/** Uniswap V2 getAmountOut formula (0.3 % fee). */
function getQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const fee = amountIn * 997n
  return (fee * reserveOut) / (reserveIn * 1000n + fee)
}


// ─── Route classification ──────────────────────────────────────────────────
type RouteType = 'direct' | 'two-hop' | 'none'

function classifyRoute(from: Token, to: Token): RouteType {
  if (from === to) return 'none'
  if ((from === 'USDC' && to === 'EURC')   || (from === 'EURC'   && to === 'USDC'))   return 'direct'
  if ((from === 'USDC' && to === 'CIRBTC') || (from === 'CIRBTC' && to === 'USDC'))   return 'direct'
  if ((from === 'EURC' && to === 'CIRBTC') || (from === 'CIRBTC' && to === 'EURC'))   return 'two-hop'
  return 'none'
}

// ─── Step machine ──────────────────────────────────────────────────────────
// Direct:  idle → approve1 → swap1 → done
// Two-hop: idle → approve1 → swap1 → approve2 → swap2 → done
type Step = 'idle' | 'approve1' | 'swap1' | 'approve2' | 'swap2' | 'done'

interface PendingOp {
  pool:    `0x${string}`
  tokenIn: Token
  amount:  bigint
  minOut:  bigint
}

export function SwapTab() {
  const { address: userAddr, chainId, isConnected } = useAccount()
  const { triggerRefresh } = useRefresh()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const addrs = getAddresses(TARGET_CHAIN_ID)
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID

  const [tokenIn,  setTokenIn]  = useState<Token>('USDC')
  const [tokenOut, setTokenOut] = useState<Token>('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [slipBps,  setSlipBps]  = useState(50)
  const [step,     setStep]     = useState<Step>('idle')
  const [swapError, setSwapError] = useState<string | null>(null)

  // Refs so async effects can access current swap parameters
  const hop1OpRef = useRef<PendingOp | null>(null)  // direct or two-hop first leg
  const hop2OpRef = useRef<PendingOp | null>(null)  // two-hop second leg (filled after hop1 receipt)
  const amountInRef  = useRef(amountIn)
  const tokenInRef   = useRef(tokenIn)
  const tokenOutRef  = useRef(tokenOut)
  useEffect(() => { amountInRef.current  = amountIn  }, [amountIn])
  useEffect(() => { tokenInRef.current   = tokenIn   }, [tokenIn])
  useEffect(() => { tokenOutRef.current  = tokenOut  }, [tokenOut])

  const { usdc: usdcBal, eurc: eurcBal, cirBtc: cirBtcBal, refetch: refetchBals } = useTokenBalances()
  // reserve0=USDC, reserve1=EURC (confirmed onchain: token0=0x3600, token1=EURC)
  const { reserve0: eurcPoolUsdc, reserve1: eurcPoolEurc } = usePoolReserves(addrs.POOL_USDC_EURC)
  // reserve0=USDC, reserve1=cirBTC (confirmed onchain: token0=0x3600, token1=cirBTC)
  const { reserve0: btcPoolUsdc,  reserve1: btcPoolBtc  } = usePoolReserves(addrs.POOL_USDC_BTC)

  const balances: Record<Token, bigint> = {
    USDC:   usdcBal   ?? 0n,
    EURC:   eurcBal   ?? 0n,
    CIRBTC: cirBtcBal ?? 0n,
  }

  // ─── Direct-route reserve mapping ─────────────────────────────────────────
  function directReserves(from: Token, to: Token): { pool: `0x${string}`; reserveIn: bigint; reserveOut: bigint } | null {
    if (from === 'USDC'   && to === 'EURC')   return { pool: addrs.POOL_USDC_EURC, reserveIn: eurcPoolUsdc, reserveOut: eurcPoolEurc }
    if (from === 'EURC'   && to === 'USDC')   return { pool: addrs.POOL_USDC_EURC, reserveIn: eurcPoolEurc, reserveOut: eurcPoolUsdc }
    if (from === 'USDC'   && to === 'CIRBTC') return { pool: addrs.POOL_USDC_BTC,  reserveIn: btcPoolUsdc,  reserveOut: btcPoolBtc  }
    if (from === 'CIRBTC' && to === 'USDC')   return { pool: addrs.POOL_USDC_BTC,  reserveIn: btcPoolBtc,   reserveOut: btcPoolUsdc }
    return null
  }

  const route     = classifyRoute(tokenIn, tokenOut)
  const direct    = route === 'direct' ? directReserves(tokenIn, tokenOut) : null
  const amtBig    = parseUnitsStrict(amountIn, TOKEN_DEC[tokenIn])

  // Quote for direct swap
  const directOut = direct && amtBig > 0n ? getQuote(amtBig, direct.reserveIn, direct.reserveOut) : 0n
  const unitQuote = direct && direct.reserveIn > 0n
    ? getQuote(10n ** BigInt(TOKEN_DEC[tokenIn]), direct.reserveIn, direct.reserveOut)
    : 0n

  // Quote for two-hop swap
  let twoHopOut = 0n
  let twoHopMidOut = 0n
  if (route === 'two-hop' && amtBig > 0n) {
    if (tokenIn === 'EURC') {
      twoHopMidOut = getQuote(amtBig,      eurcPoolEurc, eurcPoolUsdc)
      twoHopOut    = getQuote(twoHopMidOut, btcPoolUsdc,  btcPoolBtc)
    } else {
      twoHopMidOut = getQuote(amtBig,      btcPoolBtc,   btcPoolUsdc)
      twoHopOut    = getQuote(twoHopMidOut, eurcPoolUsdc, eurcPoolEurc)
    }
  }

  const quoteOut = route === 'direct' ? directOut : route === 'two-hop' ? twoHopOut : 0n
  const noRoute  = route === 'none'
  const hasQuote = quoteOut > 0n

  // Price impact (bps, 100 = 1%)
  const impactBps: number = (() => {
    if (!hasQuote || amtBig === 0n) return 0
    if (route === 'direct' && direct) {
      return calcPriceImpactBps(amtBig, direct.reserveIn, direct.reserveOut)
    }
    if (route === 'two-hop') {
      // Combined impact: hop1 + hop2 (approximately additive for small amounts)
      const imp1 = tokenIn === 'EURC'
        ? calcPriceImpactBps(amtBig, eurcPoolEurc, eurcPoolUsdc)
        : calcPriceImpactBps(amtBig, btcPoolBtc, btcPoolUsdc)
      const imp2 = tokenIn === 'EURC'
        ? calcPriceImpactBps(twoHopMidOut, btcPoolUsdc, btcPoolBtc)
        : calcPriceImpactBps(twoHopMidOut, eurcPoolUsdc, eurcPoolEurc)
      return imp1 + imp2
    }
    return 0
  })()

  // ─── Separate wagmi hooks for hop1 and hop2 ───────────────────────────────
  // Using separate hooks means each receipt is independently tracked — no stale
  // swapOk cross-contamination between the two hops.

  const { writeContract: approveFn,  data: approveHash,  isPending: approvePending,  error: approveError,   reset: resetApprove  } = useWriteContract()
  const { writeContract: swap1Fn,    data: swap1Hash,    isPending: swap1Pending,    error: swap1WriteError, reset: resetSwap1    } = useWriteContract()
  const { writeContract: swap2Fn,    data: swap2Hash,    isPending: swap2Pending,    error: swap2WriteError, reset: resetSwap2    } = useWriteContract()
  // Second approve for two-hop step 3
  const { writeContract: approve2Fn, data: approve2Hash, isPending: approve2Pending, error: approve2Error,   reset: resetApprove2 } = useWriteContract()

  const { isLoading: approveConf,  isSuccess: approveOk,  data: approveReceipt  } = useWaitForTransactionReceipt({ hash: approveHash,  chainId: TARGET_CHAIN_ID })
  const { isLoading: approve2Conf, isSuccess: approve2Ok, data: approve2Receipt  } = useWaitForTransactionReceipt({ hash: approve2Hash, chainId: TARGET_CHAIN_ID })
  const { isLoading: swap1Conf,    isSuccess: swap1Ok,    data: swap1Receipt     } = useWaitForTransactionReceipt({ hash: swap1Hash,    chainId: TARGET_CHAIN_ID })
  const { isLoading: swap2Conf,    isSuccess: swap2Ok,    data: swap2Receipt     } = useWaitForTransactionReceipt({ hash: swap2Hash,    chainId: TARGET_CHAIN_ID })

  // Suppress unused-variable warnings — receipts used in effects below
  void approveReceipt; void approve2Receipt; void swap2Receipt

  // ─── Error capture ─────────────────────────────────────────────────────────
  useEffect(() => {
    const err = approveError ?? approve2Error ?? swap1WriteError ?? swap2WriteError
    if (!err) return
    const msg = (err as { shortMessage?: string }).shortMessage ?? err.message ?? 'Transaction failed'
    const isMidSwap = step === 'swap2' || step === 'approve2'
    setSwapError(isMidSwap ? `${msg} — you now hold USDC from step 1.` : msg)
    setStep('idle')
    hop1OpRef.current = null
    hop2OpRef.current = null
    toast.error(msg, { id: 'swap' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveError, approve2Error, swap1WriteError, swap2WriteError])

  // ─── Helper: send approve (hop1) ───────────────────────────────────────────
  async function sendApprove1(tokenAddr: `0x${string}`, spender: `0x${string}`, amount: bigint) {
    try {
      const gas = publicClient && userAddr
        ? await estimateGas(publicClient, { address: tokenAddr, abi: erc20Abi, functionName: 'approve', args: [spender, amount], account: userAddr })
        : GAS_FALLBACK.approve
      resetApprove()
      approveFn({ address: tokenAddr, abi: erc20Abi, functionName: 'approve', args: [spender, amount], gas })
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
      setSwapError(msg); setStep('idle'); hop1OpRef.current = null; hop2OpRef.current = null
      toast.error(msg, { id: 'swap' })
    }
  }

  // ─── Helper: send approve (hop2) ───────────────────────────────────────────
  async function sendApprove2(tokenAddr: `0x${string}`, spender: `0x${string}`, amount: bigint) {
    try {
      const gas = publicClient && userAddr
        ? await estimateGas(publicClient, { address: tokenAddr, abi: erc20Abi, functionName: 'approve', args: [spender, amount], account: userAddr })
        : GAS_FALLBACK.approve
      resetApprove2()
      approve2Fn({ address: tokenAddr, abi: erc20Abi, functionName: 'approve', args: [spender, amount], gas })
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
      setSwapError(`${msg} — you now hold USDC from step 1.`); setStep('idle')
      hop1OpRef.current = null; hop2OpRef.current = null
      toast.error(msg, { id: 'swap' })
    }
  }

  // ─── Helper: send swap hop1 ────────────────────────────────────────────────
  async function sendSwap1(op: PendingOp) {
    const tokenInAddr = addrs[op.tokenIn as keyof typeof addrs] as `0x${string}`
    try {
      const gas = publicClient && userAddr
        ? await estimateGas(publicClient, {
            address: op.pool, abi: BASKET_POOL_ABI, functionName: 'swapExactTokensForTokens',
            args: [op.amount, op.minOut, tokenInAddr, userAddr, deadline()], account: userAddr,
          })
        : GAS_FALLBACK.swap
      resetSwap1()
      swap1Fn({ address: op.pool, abi: BASKET_POOL_ABI, functionName: 'swapExactTokensForTokens',
        args: [op.amount, op.minOut, tokenInAddr, userAddr!, deadline()], gas })
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
      setSwapError(msg); setStep('idle'); hop1OpRef.current = null; hop2OpRef.current = null
      toast.error(msg, { id: 'swap' })
    }
  }

  // ─── Helper: send swap hop2 ────────────────────────────────────────────────
  async function sendSwap2(op: PendingOp) {
    const tokenInAddr = addrs[op.tokenIn as keyof typeof addrs] as `0x${string}`
    try {
      const gas = publicClient && userAddr
        ? await estimateGas(publicClient, {
            address: op.pool, abi: BASKET_POOL_ABI, functionName: 'swapExactTokensForTokens',
            args: [op.amount, op.minOut, tokenInAddr, userAddr, deadline()], account: userAddr,
          })
        : GAS_FALLBACK.swap
      resetSwap2()
      swap2Fn({ address: op.pool, abi: BASKET_POOL_ABI, functionName: 'swapExactTokensForTokens',
        args: [op.amount, op.minOut, tokenInAddr, userAddr!, deadline()], gas })
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
      setSwapError(`${msg} — you now hold USDC from step 1.`)
      setStep('idle'); hop1OpRef.current = null; hop2OpRef.current = null
      toast.error(msg, { id: 'swap' })
    }
  }

  // ─── approve1 confirmed → send swap1 ──────────────────────────────────────
  useEffect(() => {
    if (!approveOk || step !== 'approve1') return
    const op = hop1OpRef.current
    if (!op) return
    setStep('swap1')
    toast.info(hop2OpRef.current ? 'Step 2/4: Confirm first swap in wallet…' : 'Step 2/2: Confirm swap in wallet…', { id: 'swap' })
    void sendSwap1(op)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveOk])

  // ─── swap1 confirmed → either done (direct) or approve2 (two-hop) ─────────
  useEffect(() => {
    if (!swap1Ok || step !== 'swap1') return

    if (!hop2OpRef.current) {
      // Direct swap — done
      setStep('done')
      void refetchBals()
      triggerRefresh()
      toast.success('Swap confirmed!', { id: 'swap' })
      if (userAddr && swap1Hash) {
        saveActivity(userAddr, {
          id: `${swap1Hash}-Swap`,
          type: 'Swap',
          desc: `Swapped ${amountInRef.current} ${TOKEN_LABEL[tokenInRef.current]} → ${TOKEN_LABEL[tokenOutRef.current]}`,
          txHash: swap1Hash,
          timestamp: Date.now(),
        })
      }
      setAmountIn('')
      setTimeout(() => setStep('idle'), 2000)
      return
    }

    // Two-hop: read actual USDC received from hop1 receipt's Swap event
    const receipt = swap1Receipt
    let actualUsdcOut: bigint | null = null
    if (receipt) {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: [SWAP_EVENT], eventName: 'Swap', data: log.data, topics: log.topics })
          // amountOut is the second non-indexed arg
          const args = decoded.args as { amountIn: bigint; amountOut: bigint; zeroForOne: boolean }
          actualUsdcOut = args.amountOut
          break
        } catch { /* not a Swap log, skip */ }
      }
    }

    // Use actual received USDC; fall back to quoted amount if receipt parse fails
    const usedUsdcIn = actualUsdcOut ?? hop2OpRef.current.amount

    // Recompute hop2 quote from current reserves with the actual USDC in, apply slippage
    const slip = slippageFactor(slipBps)
    let hop2MinOut: bigint
    if (tokenOutRef.current === 'CIRBTC') {
      // USDC → cirBTC
      const reQuote = getQuote(usedUsdcIn, btcPoolUsdc, btcPoolBtc)
      hop2MinOut = slip(reQuote)
    } else {
      // USDC → EURC
      const reQuote = getQuote(usedUsdcIn, eurcPoolUsdc, eurcPoolEurc)
      hop2MinOut = slip(reQuote)
    }

    // Update hop2 op with actual amount and fresh minOut
    hop2OpRef.current = { ...hop2OpRef.current, amount: usedUsdcIn, minOut: hop2MinOut }

    setStep('approve2')
    toast.info('Step 3/4: Approve USDC for second swap…', { id: 'swap' })
    void sendApprove2(addrs.USDC, hop2OpRef.current.pool, usedUsdcIn)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap1Ok])

  // ─── approve2 confirmed → send swap2 ──────────────────────────────────────
  useEffect(() => {
    if (!approve2Ok || step !== 'approve2') return
    const op = hop2OpRef.current
    if (!op) return
    setStep('swap2')
    toast.info('Step 4/4: Confirm second swap in wallet…', { id: 'swap' })
    void sendSwap2(op)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approve2Ok])

  // ─── swap2 confirmed → done ────────────────────────────────────────────────
  useEffect(() => {
    if (!swap2Ok || step !== 'swap2') return
    hop1OpRef.current = null
    hop2OpRef.current = null
    setStep('done')
    void refetchBals()
    triggerRefresh()
    toast.success('Two-hop swap confirmed!', { id: 'swap' })
    if (userAddr && swap2Hash) {
      saveActivity(userAddr, {
        id: `${swap2Hash}-Swap`,
        type: 'Swap',
        desc: `Swapped ${amountInRef.current} ${TOKEN_LABEL[tokenInRef.current]} → ${TOKEN_LABEL[tokenOutRef.current]} (via USDC)`,
        txHash: swap2Hash,
        timestamp: Date.now(),
      })
    }
    setAmountIn('')
    setTimeout(() => setStep('idle'), 2000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap2Ok])

  // ─── handleSwap ───────────────────────────────────────────────────────────
  const handleSwap = () => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    if (!amountIn || amtBig === 0n || noRoute || !hasQuote) return
    resetApprove(); resetApprove2(); resetSwap1(); resetSwap2()
    setSwapError(null)
    hop1OpRef.current = null
    hop2OpRef.current = null

    if (route === 'direct' && direct) {
      const minOut = slippageFactor(slipBps)(directOut)
      const tokenInAddr = addrs[tokenIn as keyof typeof addrs] as `0x${string}`
      hop1OpRef.current = { pool: direct.pool, tokenIn, amount: amtBig, minOut }
      setStep('approve1')
      toast.info('Step 1/2: Approve token in wallet…', { id: 'swap' })
      void sendApprove1(tokenInAddr, direct.pool, amtBig)
      return
    }

    if (route === 'two-hop') {
      const slip = slippageFactor(slipBps)
      // hop1 minOut: quoted intermediate USDC with slippage
      const hop1MinUsdc = slip(twoHopMidOut)
      // hop2 op: amount and minOut will be overwritten after hop1 receipt
      const finalMinOut = slip(twoHopOut)

      let pool1: `0x${string}`, pool2: `0x${string}`
      let hop1Token: Token
      if (tokenIn === 'EURC') {
        pool1 = addrs.POOL_USDC_EURC; pool2 = addrs.POOL_USDC_BTC
        hop1Token = 'EURC'
      } else {
        pool1 = addrs.POOL_USDC_BTC; pool2 = addrs.POOL_USDC_EURC
        hop1Token = 'CIRBTC'
      }

      hop1OpRef.current = { pool: pool1, tokenIn: hop1Token, amount: amtBig, minOut: hop1MinUsdc }
      // hop2 placeholder — amount/minOut updated from receipt after hop1 confirms
      hop2OpRef.current = { pool: pool2, tokenIn: 'USDC', amount: twoHopMidOut, minOut: finalMinOut }

      const tokenInAddr = addrs[hop1Token as keyof typeof addrs] as `0x${string}`
      setStep('approve1')
      toast.info('Step 1/4: Approve token in wallet…', { id: 'swap' })
      void sendApprove1(tokenInAddr, pool1, amtBig)
    }
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────
  const flipTokens = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn('')
    setStep('idle')
    setSwapError(null)
    hop1OpRef.current = null
    hop2OpRef.current = null
  }

  const changeTokenIn = (t: Token) => {
    setTokenIn(t)
    if (tokenOut === t) setTokenOut(TOKENS.find(x => x !== t) ?? 'EURC')
    setAmountIn('')
    setStep('idle')
    setSwapError(null)
  }

  const changeTokenOut = (t: Token) => {
    setTokenOut(t)
    setAmountIn('')
    setStep('idle')
    setSwapError(null)
  }

  const stepCount = route === 'two-hop' ? 4 : 2
  const busy      = step !== 'idle' && step !== 'done'
  const busyAny   = busy || approvePending || approveConf || approve2Pending || approve2Conf || swap1Pending || swap1Conf || swap2Pending || swap2Conf

  const stepLabel =
    step === 'approve1' ? `Step 1/${stepCount} — Approve in wallet…`            :
    step === 'swap1'    ? `Step 2/${stepCount} — Confirm swap in wallet…`        :
    step === 'approve2' ? `Step 3/4 — Approve USDC for second swap…`             :
    step === 'swap2'    ? `Step 4/4 — Confirm second swap in wallet…`            : ''

  const displayQuote = quoteOut > 0n
    ? formatUnits(quoteOut, TOKEN_DEC[tokenOut], TOKEN_DEC[tokenOut])
    : '—'

  const unitQuoteLabel = route === 'direct' && unitQuote > 0n
    ? `1 ${TOKEN_LABEL[tokenIn]} ≈ ${formatUnits(unitQuote, TOKEN_DEC[tokenOut], TOKEN_DEC[tokenOut])} ${TOKEN_LABEL[tokenOut]}`
    : null

  // Latest tx hash to show explorer link
  const latestTxHash = swap2Hash ?? swap1Hash

  return (
    <div className="space-y-4">
      <div style={glass.card} className="p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-2)' }}>Swap</h3>

        {/* Token In */}
        <div style={glass.inner} className="p-4 mb-2">
          <div className="flex items-center gap-3 mb-2">
            <TokenLogo token={tokenIn} size={20} />
            <select value={tokenIn} onChange={(e) => changeTokenIn(e.target.value as Token)}
              className="bg-transparent text-sm font-semibold outline-none cursor-pointer"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 8px' }}>
              {TOKENS.map((t) => <option key={t} value={t} style={{ background: '#0d1b2f' }}>{TOKEN_LABEL[t]}</option>)}
            </select>
            <button onClick={() => setAmountIn(formatUnits(balances[tokenIn], TOKEN_DEC[tokenIn], TOKEN_DEC[tokenIn]))}
              className="ml-auto text-xs disabled:opacity-40" style={{ color: 'var(--accent)' }}
              disabled={balances[tokenIn] === 0n}>
              {balances[tokenIn] > 0n ? `${formatUnits(balances[tokenIn], TOKEN_DEC[tokenIn], TOKEN_DEC[tokenIn])} Max` : '— Max'}
            </button>
          </div>
          <input inputMode="decimal" value={amountIn}
            onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setAmountIn(v) }}
            placeholder="0.00" className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-20"
            style={{ color: 'var(--ink)' }} />
        </div>

        {/* Flip */}
        <div className="flex justify-center my-1">
          <button onClick={flipTokens}
            className="p-2 rounded-xl transition-all hover:scale-110 active:scale-95"
            style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid var(--border)' }}>
            <ArrowUpDown className="size-4" style={{ color: 'var(--accent)' }} />
          </button>
        </div>

        {/* Token Out */}
        <div style={glass.inner} className="p-4 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <TokenLogo token={tokenOut} size={20} />
            <select value={tokenOut} onChange={(e) => changeTokenOut(e.target.value as Token)}
              className="bg-transparent text-sm font-semibold outline-none cursor-pointer"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 8px' }}>
              {TOKENS.filter((t) => t !== tokenIn).map((t) =>
                <option key={t} value={t} style={{ background: '#0d1b2f' }}>{TOKEN_LABEL[t]}</option>)}
            </select>
            <span className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>
              {formatUnits(balances[tokenOut], TOKEN_DEC[tokenOut], TOKEN_DEC[tokenOut])} bal
            </span>
          </div>
          <div className="display text-3xl font-bold tabular-nums" style={{ color: quoteOut > 0n ? 'var(--ink)' : 'var(--subtle)' }}>
            {displayQuote}
          </div>
          {route === 'two-hop' && twoHopMidOut > 0n && (
            <div className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
              via {formatUnits(twoHopMidOut, 6, 4)} USDC
            </div>
          )}
        </div>

        {/* Slippage */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Slippage</span>
          {[25, 50, 100].map((bps) => (
            <button key={bps} onClick={() => setSlipBps(bps)}
              className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors"
              style={{ background: slipBps === bps ? 'var(--accent)' : 'rgba(255,255,255,0.07)', color: slipBps === bps ? '#0d1b2f' : 'var(--muted)' }}>
              {(bps / 100).toFixed(2)}%
            </button>
          ))}
        </div>

        {/* Rate (direct only) */}
        {unitQuoteLabel && (
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--subtle)' }}>
            <span>Rate</span>
            <span className="tabular-nums">{unitQuoteLabel}</span>
          </div>
        )}

        {/* Price impact */}
        {hasQuote && amtBig > 0n && (
          <div className="mb-4 space-y-0.5">
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--subtle)' }}>Price impact</span>
              <span className="tabular-nums font-semibold" style={{
                color: impactBps >= 1000 ? 'var(--danger)' : impactBps >= 200 ? '#f59e0b' : 'var(--subtle)'
              }}>
                {(impactBps / 100).toFixed(2)}%
              </span>
            </div>
            {impactBps >= 1000 && (
              <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(232,109,122,0.10)', border: '1px solid rgba(232,109,122,0.22)', color: 'var(--danger)' }}>
                <AlertCircle className="size-3 shrink-0" />
                Low liquidity: large price impact
              </div>
            )}
          </div>
        )}

        {/* Route info for two-hop */}
        {route === 'two-hop' && (
          <div className="text-xs mb-4 p-3 rounded-xl" style={{ background: 'rgba(172,198,233,0.07)', color: 'var(--subtle)', border: '1px solid rgba(172,198,233,0.12)' }}>
            {TOKEN_LABEL[tokenIn]} → USDC → {TOKEN_LABEL[tokenOut]} (two steps, slippage applied to final amount)
          </div>
        )}

        {/* Token pair legend */}
        <div className="flex items-center gap-3 mb-4">
          {([tokenIn, tokenOut] as Token[]).filter((t, i, a) => a.indexOf(t) === i).map((t) => (
            <span key={t} className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
              <TokenLogo token={t} size={14} />
              {TOKEN_LABEL[t]}
            </span>
          ))}
        </div>

        {/* Step status */}
        {stepLabel && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3" style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
            <Loader2 className="size-3.5 animate-spin shrink-0" />
            <span>{stepLabel}</span>
          </div>
        )}
        {step === 'done' && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3" style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span>Swap confirmed!</span>
          </div>
        )}
        {swapError && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{swapError}</span>
          </div>
        )}

        <button
          disabled={!isConnected || busyAny || !amountIn || amtBig === 0n || noRoute || !hasQuote}
          onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleSwap}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
          {!isConnected ? 'Connect Wallet'
            : wrongChain ? `Switch to ${TARGET_CHAIN.name}`
            : busyAny
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{stepLabel || 'Processing…'}</span>
            : noRoute ? 'No route'
            : route === 'two-hop' ? 'Swap via USDC (2 steps)'
            : 'Swap'}
        </button>

        {latestTxHash && (
          <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, latestTxHash)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs mt-2 justify-center" style={{ color: 'var(--accent)' }}>
            View tx <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}
