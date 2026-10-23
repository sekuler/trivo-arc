import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { ArrowUpDown, Loader2, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'
import { BASKET_POOL_ABI, getAddresses, TARGET_CHAIN_ID, TARGET_CHAIN, TOKEN_META, GAS_FALLBACK } from '../contracts'
import { estimateGas } from '../estimateGas'
import { usePoolReserves, useTokenBalances } from '../hooks/useContracts'
import { useRefresh } from '../context/RefreshContext'
import { formatUnits, parseUnitsStrict, slippageFactor, deadline } from '../utils/format'
import { buildTxExplorerUrl } from '@/onchain-facts'

const glass = {
  card: { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

const TOKENS = ['USDC', 'EURC', 'CIRBTC'] as const
type Token = typeof TOKENS[number]

const TOKEN_LABEL: Record<Token, string> = { USDC: 'USDC', EURC: 'EURC', CIRBTC: 'cirBTC' }
const TOKEN_DEC: Record<Token, number> = { USDC: 6, EURC: 6, CIRBTC: 8 }

function getQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const amountInFee = amountIn * 997n
  return (amountInFee * reserveOut) / (reserveIn * 1000n + amountInFee)
}

type Step = 'idle' | 'approve' | 'swap' | 'done'

type PendingSwap = { pool: `0x${string}`; amount: bigint; minOut: bigint; tokenIn: Token }

export function SwapTab() {
  const { address: userAddr, chainId, isConnected } = useAccount()
  const { triggerRefresh } = useRefresh()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient()
  const addrs = getAddresses(chainId ?? TARGET_CHAIN_ID)
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID

  const [tokenIn, setTokenIn] = useState<Token>('USDC')
  const [tokenOut, setTokenOut] = useState<Token>('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [slipBps, setSlipBps] = useState(50)
  const [step, setStep] = useState<Step>('idle')
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)

  const { usdc: usdcBal, eurc: eurcBal, cirBtc: cirBtcBal, refetch: refetchBals } = useTokenBalances()
  const { reserve0: eurcR0, reserve1: eurcR1 } = usePoolReserves(addrs.POOL_USDC_EURC)
  const { reserve0: btcR0, reserve1: btcR1 } = usePoolReserves(addrs.POOL_USDC_BTC)

  const balances: Record<Token, bigint | undefined> = { USDC: usdcBal, EURC: eurcBal, CIRBTC: cirBtcBal }

  function getPoolAndReserves(): { pool: `0x${string}`; reserveIn: bigint; reserveOut: bigint } | null {
    const pair = [tokenIn, tokenOut].sort().join('/')
    if (pair === 'EURC/USDC') {
      const usdcIsIn = tokenIn === 'USDC'
      return { pool: addrs.POOL_USDC_EURC, reserveIn: usdcIsIn ? eurcR0 : eurcR1, reserveOut: usdcIsIn ? eurcR1 : eurcR0 }
    }
    if (pair === 'CIRBTC/USDC') {
      const usdcIsIn = tokenIn === 'USDC'
      return { pool: addrs.POOL_USDC_BTC, reserveIn: usdcIsIn ? btcR0 : btcR1, reserveOut: usdcIsIn ? btcR1 : btcR0 }
    }
    return null
  }

  const poolInfo = getPoolAndReserves()
  const noRoute = !poolInfo
  const amtBig = poolInfo ? parseUnitsStrict(amountIn, TOKEN_DEC[tokenIn]) : 0n
  const quoteOut = poolInfo && amtBig > 0n ? getQuote(amtBig, poolInfo.reserveIn, poolInfo.reserveOut) : 0n
  const unitQuote = poolInfo && poolInfo.reserveIn > 0n ? getQuote(10n ** BigInt(TOKEN_DEC[tokenIn]), poolInfo.reserveIn, poolInfo.reserveOut) : 0n

  const {
    writeContract: approveFn,
    data: approveHash,
    isPending: approvePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract()

  const {
    writeContract: swapFn,
    data: swapHash,
    isPending: swapPending,
    error: swapWriteError,
    reset: resetSwap,
  } = useWriteContract()

  const { isLoading: approveConf, isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveHash })
  const { isLoading: swapConf, isSuccess: swapOk } = useWaitForTransactionReceipt({ hash: swapHash })

  // Capture errors
  useEffect(() => {
    const err = approveError ?? swapWriteError
    if (err) {
      const msg = (err as { shortMessage?: string }).shortMessage ?? err.message ?? 'Transaction failed'
      setSwapError(msg)
      setStep('idle')
      setPendingSwap(null)
      toast.error(msg, { id: 'swap' })
    }
  }, [approveError, swapWriteError])

  // Approve confirmed → fire swap
  useEffect(() => {
    if (step !== 'approve' || !approveOk || !pendingSwap || !userAddr || !publicClient) return
    const tokenInAddr = addrs[pendingSwap.tokenIn as keyof typeof addrs] as `0x${string}`
    setStep('swap')
    toast.info('Step 2/2: Confirm swap in your wallet', { id: 'swap' })
    const swap = pendingSwap
    setPendingSwap(null)
    void (async () => {
      const gas = await estimateGas(publicClient, {
        address: swap.pool, abi: BASKET_POOL_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [swap.amount, swap.minOut, tokenInAddr, userAddr, deadline()],
        account: userAddr,
      })
      swapFn({ address: swap.pool, abi: BASKET_POOL_ABI, functionName: 'swapExactTokensForTokens',
        args: [swap.amount, swap.minOut, tokenInAddr, userAddr, deadline()], gas })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveOk, step])

  // Swap confirmed → success
  useEffect(() => {
    if (step === 'swap' && swapOk) {
      setStep('done')
      void refetchBals()
      triggerRefresh()
      toast.success('Swap confirmed!', { id: 'swap' })
      setAmountIn('')
      setTimeout(() => setStep('idle'), 2000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapOk, step])

  const handleSwap = () => {
    if (!poolInfo || quoteOut === 0n || !amountIn) return
    const minOut = slippageFactor(slipBps)(quoteOut)
    const tokenInAddr = addrs[tokenIn as keyof typeof addrs] as `0x${string}`
    setSwapError(null)
    resetApprove()
    resetSwap()
    setPendingSwap({ pool: poolInfo.pool, amount: amtBig, minOut, tokenIn })
    setStep('approve')
    toast.info('Step 1/2: Approve token in your wallet', { id: 'swap' })
    void (async () => {
      const gas = publicClient && userAddr ? await estimateGas(publicClient, {
        address: tokenInAddr, abi: erc20Abi, functionName: 'approve',
        args: [poolInfo.pool, amtBig], account: userAddr,
      }) : GAS_FALLBACK.approve
      approveFn({ address: tokenInAddr, abi: erc20Abi, functionName: 'approve', args: [poolInfo.pool, amtBig], gas })
    })()
  }

  const flipTokens = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn('')
  }

  const busy = step !== 'idle' && step !== 'done'
  const busyAny = busy || approvePending || approveConf || swapPending || swapConf

  const stepLabel = step === 'approve'
    ? 'Step 1/2 — Approve token in your wallet…'
    : step === 'swap'
    ? 'Step 2/2 — Confirm swap in your wallet…'
    : ''

  return (
    <div className="space-y-4">
      <div style={glass.card} className="p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-2)' }}>Swap</h3>

        {/* Token In */}
        <div style={glass.inner} className="p-4 mb-2">
          <div className="flex items-center gap-3 mb-2">
            <select value={tokenIn} onChange={(e) => { setTokenIn(e.target.value as Token); setAmountIn('') }}
              className="bg-transparent text-sm font-semibold outline-none cursor-pointer"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 8px' }}>
              {TOKENS.map((t) => <option key={t} value={t} style={{ background: '#0d1b2f' }}>{TOKEN_LABEL[t]}</option>)}
            </select>
            <button onClick={() => balances[tokenIn] && setAmountIn(formatUnits(balances[tokenIn], TOKEN_DEC[tokenIn], TOKEN_DEC[tokenIn]))}
              className="ml-auto text-xs disabled:opacity-40" style={{ color: 'var(--accent)' }}
              disabled={!balances[tokenIn]}>
              {balances[tokenIn] ? `${formatUnits(balances[tokenIn], TOKEN_DEC[tokenIn], 4)} Max` : '—'}
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
            <select value={tokenOut} onChange={(e) => setTokenOut(e.target.value as Token)}
              className="bg-transparent text-sm font-semibold outline-none cursor-pointer"
              style={{ color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 8px' }}>
              {TOKENS.filter((t) => t !== tokenIn).map((t) => <option key={t} value={t} style={{ background: '#0d1b2f' }}>{TOKEN_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="display text-3xl font-bold tabular-nums" style={{ color: quoteOut > 0n ? 'var(--ink)' : 'var(--subtle)' }}>
            {noRoute ? <span className="text-lg" style={{ color: 'var(--danger)' }}>No direct route</span>
              : quoteOut > 0n ? formatUnits(quoteOut, TOKEN_DEC[tokenOut], TOKEN_DEC[tokenOut] === 8 ? 6 : 4)
              : '—'}
          </div>
        </div>

        {/* Slippage */}
        {!noRoute && (
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
        )}

        {/* Rate */}
        {!noRoute && unitQuote > 0n && (
          <div className="flex justify-between text-xs mb-4" style={{ color: 'var(--subtle)' }}>
            <span>Rate</span>
            <span className="tabular-nums">1 {TOKEN_LABEL[tokenIn]} ≈ {formatUnits(unitQuote, TOKEN_DEC[tokenOut], 4)} {TOKEN_LABEL[tokenOut]}</span>
          </div>
        )}

        {/* Token color dots */}
        <div className="flex items-center gap-3 mb-4">
          {[tokenIn, tokenOut].filter((t, i, a) => a.indexOf(t) === i).map((t) => (
            <span key={t} className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
              <span className="size-2 rounded-full inline-block" style={{ background: TOKEN_META[t as keyof typeof TOKEN_META]?.color ?? '#888' }} />
              {TOKEN_LABEL[t]}
            </span>
          ))}
        </div>

        {noRoute && (
          <div className="text-xs mb-4 p-3 rounded-xl" style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)', border: '1px solid rgba(232,109,122,0.2)' }}>
            Direct EURC ↔ cirBTC swaps require routing via USDC (two hops).
          </div>
        )}

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
          disabled={!isConnected || wrongChain || busyAny || !amountIn || Number(amountIn) <= 0 || noRoute}
          onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleSwap}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
          {!isConnected ? 'Connect Wallet'
            : wrongChain ? `Switch to ${TARGET_CHAIN.name}`
            : busyAny
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{stepLabel || 'Processing…'}</span>
            : noRoute ? 'No route'
            : 'Swap'}
        </button>

        {swapHash && (
          <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, swapHash)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs mt-2 justify-center" style={{ color: 'var(--accent)' }}>
            View tx <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}
