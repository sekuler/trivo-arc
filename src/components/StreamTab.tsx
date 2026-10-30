/**
 * StreamTab — USDC linear-unlock stream to basket.
 * Users lock USDC that unlocks second-by-second over a chosen duration.
 * "Move to basket" claims unlocked USDC into their basket position.
 * "Stop stream" claims unlocked portion to basket and refunds the rest.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { Loader2, PlayCircle, ArrowRightCircle, StopCircle, Clock, ExternalLink, AlertCircle } from 'lucide-react'
import { BASKET_STREAM_ABI, getAddresses, TARGET_CHAIN_ID, TARGET_CHAIN, GAS_FALLBACK } from '../contracts'
import { estimateGas } from '../estimateGas'
import { useTokenBalances } from '../hooks/useContracts'
import { useRefresh } from '../context/RefreshContext'
import { formatUnits, parseUnitsStrict } from '../utils/format'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { saveActivity } from '../hooks/useActivity'

const glass = {
  card:  { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

const DURATIONS = [
  { label: '1 hour',  value: 3600,    display: '1h'  },
  { label: '1 day',   value: 86400,   display: '1d'  },
  { label: '7 days',  value: 604800,  display: '7d'  },
  { label: '30 days', value: 2592000, display: '30d' },
]

interface Stream {
  id: bigint
  owner: string
  total: bigint
  claimed: bigint
  startTime: bigint
  endTime: bigint
  stopped: boolean
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function calcUnlocked(stream: Stream, now: number): bigint {
  if (stream.stopped || stream.claimed >= stream.total) return 0n
  const start = Number(stream.startTime)
  const end   = Number(stream.endTime)
  const elapsed = Math.min(now, end) - start
  if (elapsed <= 0) return 0n
  const duration = end - start
  const unlocked = (stream.total * BigInt(elapsed)) / BigInt(duration)
  const claimable = unlocked - stream.claimed
  return claimable > 0n ? claimable : 0n
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s || parts.length === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

// ─── StreamCard ───────────────────────────────────────────────────────────────
function StreamCard({ stream, onAction }: { stream: Stream; onAction: () => void }) {
  const now = useNow()
  const { chainId, address } = useAccount()
  const { switchChain } = useSwitchChain()
  const { triggerRefresh } = useRefresh()
  const addrs = getAddresses(TARGET_CHAIN_ID)
  const wrongChain = !!(chainId && chainId !== TARGET_CHAIN_ID)

  const [action, setAction] = useState<'idle' | 'moving' | 'stopping'>('idle')
  const [err, setErr]       = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()

  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const { writeContract, isPending } = useWriteContract()
  const { isSuccess, isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash, chainId: TARGET_CHAIN_ID })

  // Deferred effect — avoids set-state-in-effect lint
  const actionRef = useRef(action)
  useEffect(() => { actionRef.current = action }, [action])

  useEffect(() => {
    if (!isSuccess) return
    const t = setTimeout(() => {
      const isMoving = actionRef.current === 'moving'
      toast.success(isMoving ? 'Moved to basket!' : 'Stream stopped!')
      if (address && txHash) {
        saveActivity(address, {
          id: `${txHash}-${isMoving ? 'MoveToBasket' : 'StopStream'}`,
          type: isMoving ? 'Move to Basket' : 'Stop Stream',
          desc: isMoving
            ? `Moved unlocked USDC from stream #${stream.id.toString()} to basket`
            : `Stopped stream #${stream.id.toString()}`,
          txHash,
          timestamp: Date.now(),
        }, triggerRefresh)
      }
      setAction('idle')
      setErr('')
      triggerRefresh()
      onAction()
    }, 0)
    return () => clearTimeout(t)
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  const claimable   = calcUnlocked(stream, now)
  const remaining   = stream.total - stream.claimed - claimable
  const elapsed     = now - Number(stream.startTime)
  const duration    = Number(stream.endTime) - Number(stream.startTime)
  const timeLeft    = Math.max(0, Number(stream.endTime) - now)
  const pct         = Math.min(100, duration > 0 ? (elapsed / duration) * 100 : 100)

  const handleMove = useCallback(async () => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    if (!address || !publicClient) return
    setErr('')
    setAction('moving')
    try {
      const gas = await estimateGas(publicClient, {
        address: addrs.STREAM,
        abi: BASKET_STREAM_ABI,
        functionName: 'moveToBasket',
        args: [stream.id, 0n, 0n],
        account: address,
      })
      writeContract({
        address: addrs.STREAM,
        abi: BASKET_STREAM_ABI,
        functionName: 'moveToBasket',
        args: [stream.id, 0n, 0n],
        gas,
      }, {
        onSuccess: (hash) => setTxHash(hash),
        onError:   (e)    => { setErr(e.message.split('\n')[0]); setAction('idle') },
      })
    } catch (e) { setErr((e as Error).message.split('\n')[0]); setAction('idle') }
  }, [address, addrs.STREAM, stream.id, writeContract, publicClient, wrongChain, switchChain])

  const handleStop = useCallback(async () => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    if (!address || !publicClient) return
    setErr('')
    setAction('stopping')
    try {
      const gas = await estimateGas(publicClient, {
        address: addrs.STREAM,
        abi: BASKET_STREAM_ABI,
        functionName: 'stopStream',
        args: [stream.id, 0n, 0n],
        account: address,
      })
      writeContract({
        address: addrs.STREAM,
        abi: BASKET_STREAM_ABI,
        functionName: 'stopStream',
        args: [stream.id, 0n, 0n],
        gas,
      }, {
        onSuccess: (hash) => setTxHash(hash),
        onError:   (e)    => { setErr(e.message.split('\n')[0]); setAction('idle') },
      })
    } catch (e) { setErr((e as Error).message.split('\n')[0]); setAction('idle') }
  }, [address, addrs.STREAM, stream.id, writeContract, publicClient, wrongChain, switchChain])

  const busy = isPending || confirming

  return (
    <div style={glass.card} className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Stream #{stream.id.toString()}
          </span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: stream.stopped ? 'rgba(255,255,255,0.06)' : 'rgba(141,216,159,0.15)', color: stream.stopped ? 'var(--muted)' : 'var(--success)' }}>
          {stream.stopped ? 'Stopped' : timeLeft > 0 ? 'Active' : 'Completed'}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, background: 'linear-gradient(90deg, var(--accent), #5b8fc4)' }} />
      </div>

      {/* Stats */}
      <div style={glass.inner} className="p-3 mb-3 grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Total',     val: stream.total,                      color: 'var(--ink)'     },
          { label: 'Streamed',  val: stream.claimed + claimable,        color: 'var(--success)' },
          { label: 'Locked',    val: stream.total - stream.claimed - claimable, color: 'var(--accent)'  },
        ].map(({ label, val, color }) => (
          <div key={label}>
            <div className="text-xs mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
            <div className="text-sm font-semibold tabular-nums" style={{ color }}>{formatUnits(val < 0n ? 0n : val, 6)}</div>
          </div>
        ))}
      </div>

      {/* Claimable now */}
      {!stream.stopped && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl mb-3"
          style={{ background: claimable > 0n ? 'rgba(141,216,159,0.08)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(141,216,159,0.15)' }}>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Claimable now</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--success)' }}>
            {formatUnits(claimable, 6)} USDC
          </span>
        </div>
      )}

      {/* Time left */}
      {!stream.stopped && timeLeft > 0 && (
        <div className="text-xs text-center mb-3" style={{ color: 'var(--muted)' }}>
          <Clock className="size-3 inline mr-1" />{formatDuration(timeLeft)} remaining
        </div>
      )}

      {/* Stop preview */}
      {!stream.stopped && (
        <div className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <div className="font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>If you stop now:</div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--muted)' }}>Moves to basket</span>
            <span style={{ color: 'var(--success)' }}>{formatUnits(claimable, 6)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--muted)' }}>Returns to wallet</span>
            <span style={{ color: 'var(--accent)' }}>{formatUnits(remaining < 0n ? 0n : remaining, 6)} USDC</span>
          </div>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', color: 'var(--danger)' }}>
          <AlertCircle className="size-3 mt-0.5 shrink-0" /><span>{err}</span>
        </div>
      )}

      {/* Action buttons */}
      {!stream.stopped && (
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={busy || wrongChain || claimable === 0n}
            onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleMove}
            className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(141,216,159,0.12)', color: 'var(--success)', border: '1px solid rgba(141,216,159,0.25)' }}>
            {busy && action === 'moving'
              ? <><Loader2 className="size-4 animate-spin" />Moving…</>
              : wrongChain ? '⇄ Switch'
              : <><ArrowRightCircle className="size-4" />Move to basket</>}
          </button>
          <button
            disabled={busy || wrongChain}
            onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleStop}
            className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(232,109,122,0.1)', color: 'var(--danger)', border: '1px solid rgba(232,109,122,0.25)' }}>
            {busy && action === 'stopping'
              ? <><Loader2 className="size-4 animate-spin" />Stopping…</>
              : wrongChain ? '⇄ Switch'
              : <><StopCircle className="size-4" />Stop stream</>}
          </button>
        </div>
      )}

      {txHash && (
        <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, txHash)} target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-xs mt-2 justify-center" style={{ color: 'var(--accent)' }}>
          View tx <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}

// ─── StreamTab ────────────────────────────────────────────────────────────────
export function StreamTab() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const addrs      = getAddresses(TARGET_CHAIN_ID)
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID
  const { triggerRefresh } = useRefresh()
  const { usdc: usdcBal } = useTokenBalances()

  const [amount,   setAmount]   = useState('')
  const [duration, setDuration] = useState(3600)
  const [streams,  setStreams]  = useState<Stream[]>([])
  const [loadingStreams, setLoadingStreams] = useState(false)

  // ── Start stream multi-step flow ─────────────────────────────────────────────
  type StartStep = 'idle' | 'approve' | 'start' | 'done'
  const [startStep,   setStartStep]   = useState<StartStep>('idle')
  const [startErr,    setStartErr]    = useState('')
  const [startTxHash, setStartTxHash] = useState<`0x${string}` | undefined>()

  const { writeContract: approveFn, isPending: approvePending, reset: resetApprove } = useWriteContract()
  const { writeContract: startFn,   isPending: startPending,   reset: resetStart   } = useWriteContract()
  const { isSuccess: approveOk, isLoading: approveConf } = useWaitForTransactionReceipt({ hash: startStep === 'approve' ? startTxHash : undefined, chainId: TARGET_CHAIN_ID })
  const { isSuccess: startOk,   isLoading: startConf   } = useWaitForTransactionReceipt({ hash: startStep === 'start'   ? startTxHash : undefined, chainId: TARGET_CHAIN_ID })

  const amountBigInt = parseUnitsStrict(amount, 6)
  const busyStart    = startStep === 'approve' || startStep === 'start'

  // Step refs to avoid stale closures in effects
  const amountRef   = useRef(amountBigInt)
  const durationRef = useRef(duration)
  useEffect(() => { amountRef.current   = amountBigInt }, [amountBigInt])
  useEffect(() => { durationRef.current = duration     }, [duration])

  // Load streams ref
  const loadStreamsRef = useRef<() => Promise<void>>()

  // Approve → start
  useEffect(() => {
    if (!approveOk || !address || !publicClient) return
    resetStart()
    void (async () => {
      setStartTxHash(undefined)
      const gas = await estimateGas(publicClient, {
        address: addrs.STREAM,
        abi: BASKET_STREAM_ABI,
        functionName: 'startStream',
        args: [amountRef.current, BigInt(durationRef.current)],
        account: address,
      })
      startFn({
        address: addrs.STREAM,
        abi: BASKET_STREAM_ABI,
        functionName: 'startStream',
        args: [amountRef.current, BigInt(durationRef.current)],
        gas,
      }, {
        onSuccess: (hash) => { setStartStep('start'); setStartTxHash(hash) },
        onError:   (e)    => { setStartErr(e.message.split('\n')[0]); setStartStep('idle') },
      })
    })()
  }, [approveOk]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start confirmed
  useEffect(() => {
    if (!startOk) return
    const t = setTimeout(() => {
      setStartStep('done')
      toast.success('Stream started!')
      if (address && startTxHash) {
        const dur = durationRef.current
        const dLabel = dur >= 2592000 ? '30d' : dur >= 604800 ? '7d' : dur >= 86400 ? '1d' : '1h'
        saveActivity(address, {
          id: `${startTxHash}-StreamStarted`,
          type: 'Stream',
          desc: `Started ${formatUnits(amountRef.current, 6, 2)} USDC stream over ${dLabel}`,
          txHash: startTxHash,
          timestamp: Date.now(),
        }, triggerRefresh)
      }
      setAmount('')
      triggerRefresh()
      void loadStreamsRef.current?.()
    }, 0)
    return () => clearTimeout(t)
  }, [startOk]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = () => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    if (!address || amountBigInt === 0n) return
    setStartErr('')
    setStartStep('idle')
    resetApprove()
    setStartTxHash(undefined)
    setStartStep('approve')
    void (async () => {
      try {
        const gas = publicClient ? await estimateGas(publicClient, {
          address: addrs.USDC,
          abi: erc20Abi,
          functionName: 'approve',
          args: [addrs.STREAM, amountBigInt],
          account: address,
        }) : GAS_FALLBACK.approve
        approveFn({
          address: addrs.USDC,
          abi: erc20Abi,
          functionName: 'approve',
          args: [addrs.STREAM as `0x${string}`, amountBigInt],
          gas,
        }, {
          onSuccess: (hash) => setStartTxHash(hash),
          onError:   (e)    => { setStartErr(e.message.split('\n')[0]); setStartStep('idle') },
        })
      } catch (e) {
        setStartErr((e as Error).message.split('\n')[0]); setStartStep('idle')
      }
    })()
  }

  // ── Load streams ─────────────────────────────────────────────────────────────
  const loadUserStreams = useCallback(async () => {
    if (!address || !publicClient) return
    const streamAddr = addrs.STREAM as `0x${string}`
    if (!streamAddr) return
    setLoadingStreams(true)
    try {
      // getStreamIds(address) → uint256[]
      const ids = await publicClient.readContract({
        address: streamAddr,
        abi: BASKET_STREAM_ABI,
        functionName: 'getStreamIds',
        args: [address],
      }) as bigint[]

      if (!ids || ids.length === 0) { setStreams([]); return }

      // streams(uint256) for each id
      const loaded: Stream[] = []
      for (const id of ids) {
        const s = await publicClient.readContract({
          address: streamAddr,
          abi: BASKET_STREAM_ABI,
          functionName: 'streams',
          args: [id],
        }) as [string, bigint, bigint, bigint, bigint, boolean]
        loaded.push({
          id,
          owner:     s[0],
          total:     s[1],
          claimed:   s[2],
          startTime: s[3],
          endTime:   s[4],
          stopped:   s[5],
        })
      }
      setStreams(loaded.reverse())
    } catch (e) { console.error('loadUserStreams', e) }
    finally { setLoadingStreams(false) }
  }, [address, addrs.STREAM, publicClient])

  // Keep ref in sync
  useEffect(() => { loadStreamsRef.current = loadUserStreams }, [loadUserStreams])

  // Load on connect / address change — deferred to avoid set-state-in-effect
  const loadStreamsOnConnect = useRef(loadUserStreams)
  useEffect(() => { loadStreamsOnConnect.current = loadUserStreams }, [loadUserStreams])

  useEffect(() => {
    if (!isConnected || !address) {
      const t = setTimeout(() => setStreams([]), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => { void loadStreamsOnConnect.current() }, 0)
    return () => clearTimeout(t)
  }, [isConnected, address])

  const canStart = isConnected && !wrongChain && amountBigInt > 0n && !busyStart
    && usdcBal !== undefined && amountBigInt <= usdcBal

  const stepLabel = startStep === 'approve' ? 'Step 1/2 — Approve USDC…'
    : startStep === 'start' ? 'Step 2/2 — Starting stream…'
    : ''

  const durationObj = DURATIONS.find(d => d.value === duration) ?? DURATIONS[0]

  return (
    <div className="space-y-4">
      {/* ── Start stream card ── */}
      <div style={glass.card} className="p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-2)' }}>New Stream</h3>

        {/* Amount */}
        <div style={glass.inner} className="p-4 mb-3">
          <div className="flex items-center gap-2">
            <input inputMode="decimal" value={amount}
              onChange={e => { setAmount(e.target.value); setStartStep('idle') }}
              placeholder="0.00" disabled={busyStart}
              className="flex-1 bg-transparent text-lg font-bold outline-none placeholder:opacity-30 disabled:opacity-50"
              style={{ color: 'var(--ink)' }} />
            <span className="text-sm font-semibold px-2 py-1 rounded-lg"
              style={{ background: 'rgba(39,117,202,0.15)', color: '#2775CA' }}>USDC</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Balance: {usdcBal !== undefined ? formatUnits(usdcBal, 6) : '—'} USDC
            </span>
            {usdcBal !== undefined && usdcBal > 0n && (
              <button onClick={() => setAmount(formatUnits(usdcBal, 6))}
                className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Max</button>
            )}
          </div>
        </div>

        {/* Duration buttons */}
        <div className="mb-4">
          <div className="text-xs mb-2" style={{ color: 'var(--muted)' }}>Duration</div>
          <div className="grid grid-cols-4 gap-2">
            {DURATIONS.map(d => (
              <button key={d.value} onClick={() => setDuration(d.value)} disabled={busyStart}
                className={`py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${duration === d.value ? 'chip-brand' : ''}`}
                style={duration !== d.value ? { background: 'rgba(255,255,255,0.05)', color: 'var(--subtle)', border: '1px solid rgba(255,255,255,0.07)' } : undefined}>
                {d.display}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        {amountBigInt > 0n && (
          <div style={glass.inner} className="p-3 mb-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Total locked</span>
              <span style={{ color: 'var(--ink)' }}>{formatUnits(amountBigInt, 6)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Duration</span>
              <span style={{ color: 'var(--ink)' }}>{durationObj.label}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Unlock rate</span>
              <span style={{ color: 'var(--ink)' }}>
                {((Number(amountBigInt) / 1e6) / duration).toFixed(6)} USDC/sec
              </span>
            </div>
          </div>
        )}

        {/* Status banners */}
        {stepLabel !== '' && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.2)', color: 'var(--accent)' }}>
            <Loader2 className="size-3 animate-spin shrink-0" />{stepLabel}
          </div>
        )}
        {startStep === 'done' && (
          <div className="text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid rgba(141,216,159,0.2)', color: 'var(--success)' }}>
            Stream started!
          </div>
        )}
        {startErr !== '' && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)', color: 'var(--danger)' }}>
            <AlertCircle className="size-3 mt-0.5 shrink-0" /><span>{startErr}</span>
          </div>
        )}
        {(approvePending || approveConf || startPending || startConf) && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.15)', color: 'var(--accent)' }}>
            <Loader2 className="size-3 animate-spin" />
            {approvePending || approveConf ? 'Confirming approval…' : 'Confirming stream start…'}
          </div>
        )}

        <button disabled={!canStart || busyStart}
          onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleStart}
          className={`w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${!wrongChain ? 'btn-brand' : ''}`}
          style={wrongChain ? { background: 'rgba(172,198,233,0.2)', color: 'var(--accent)', border: '1px solid rgba(172,198,233,0.35)' } : undefined}>
          {!isConnected ? 'Connect wallet'
            : wrongChain ? `⇄ Switch to ${TARGET_CHAIN.name}`
            : busyStart
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{stepLabel}</span>
              : <span className="flex items-center justify-center gap-2"><PlayCircle className="size-4" />Start stream</span>
          }
        </button>
      </div>

      {/* ── Streams list ── */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
            Your streams
          </span>
          <button onClick={() => void loadUserStreams()} disabled={loadingStreams}
            className="text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--accent)' }}>
            {loadingStreams ? <Loader2 className="size-3 animate-spin inline" /> : 'Refresh'}
          </button>
        </div>

        {!isConnected && (
          <div style={{ ...glass.card, color: 'var(--muted)' }} className="p-5 text-center text-sm">
            Connect your wallet to see your streams.
          </div>
        )}
        {isConnected && !loadingStreams && streams.length === 0 && (
          <div style={{ ...glass.card, color: 'var(--muted)' }} className="p-5 text-center text-sm">
            No streams yet. Start one above to drip USDC into your basket.
          </div>
        )}
        {loadingStreams && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        )}
        {streams.map(s => (
          <div key={s.id.toString()} className="mb-3">
            <StreamCard stream={s} onAction={() => void loadUserStreams()} />
          </div>
        ))}
      </div>
    </div>
  )
}
