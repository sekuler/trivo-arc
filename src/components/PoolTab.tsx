import { useState, useEffect, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { Loader2, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'
import { BASKET_POOL_ABI, getAddresses, TARGET_CHAIN_ID, GAS_FALLBACK } from '../contracts'
import { TokenLogo } from './TokenLogo'
import { estimateGas } from '../estimateGas'
import { usePoolReserves, useTokenBalances, usePoolLpBalance, usePoolTotalSupply } from '../hooks/useContracts'
import { useRefresh } from '../context/RefreshContext'
import { formatUnits, parseUnitsStrict, formatUsd, slippageFactor, deadline } from '../utils/format'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { saveActivity } from '../hooks/useActivity'

const glass = {
  card: { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

type Pool = 'eurc' | 'btc'
type AddStep = 'idle' | 'approveUsdc' | 'approveToken1' | 'addLiq' | 'done'
type RemoveStep = 'idle' | 'approveLp' | 'removeLiq' | 'done'

const POOL_INFO: Record<Pool, { label: string; token1: string; token1Dec: number; token1Key: 'EURC' | 'CIRBTC' }> = {
  eurc: { label: 'USDC / EURC',   token1: 'EURC',   token1Dec: 6, token1Key: 'EURC'   },
  btc:  { label: 'USDC / cirBTC', token1: 'cirBTC', token1Dec: 8, token1Key: 'CIRBTC' },
}

const STEP_LABELS: Record<AddStep, string> = {
  idle:          '',
  approveUsdc:   'Step 1/3 — Approve USDC in your wallet…',
  approveToken1: 'Step 2/3 — Approve token in your wallet…',
  addLiq:        'Step 3/3 — Confirm Add Liquidity in your wallet…',
  done:          'Liquidity added!',
}

const REMOVE_LABELS: Record<RemoveStep, string> = {
  idle:       '',
  approveLp:  'Step 1/2 — Approve LP token in your wallet…',
  removeLiq:  'Step 2/2 — Confirm Remove Liquidity in your wallet…',
  done:       'Liquidity removed!',
}

function PoolCard({ pool }: { pool: Pool }) {
  const { chainId, isConnected, address: userAddr } = useAccount()
  const { triggerRefresh } = useRefresh()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const addrs = getAddresses(TARGET_CHAIN_ID)
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID
  const poolAddr = pool === 'eurc' ? addrs.POOL_USDC_EURC : addrs.POOL_USDC_BTC
  const token1Addr = pool === 'eurc' ? addrs.EURC : addrs.CIRBTC
  const info = POOL_INFO[pool]

  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [usdcAmt, setUsdcAmt] = useState('')
  const [tokenAmt, setTokenAmt] = useState('')
  const [lpAmt, setLpAmt] = useState('')
  const [slipBps, setSlipBps] = useState(50)
  const [addError, setAddError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const { reserve0, reserve1, refetch: refetchReserves } = usePoolReserves(poolAddr)
  const { usdc: usdcBal, eurc: eurcBal, cirBtc: cirBtcBal, refetch: refetchBals } = useTokenBalances()
  const { lpBalance, refetch: refetchLp } = usePoolLpBalance(poolAddr)
  const totalSupply = usePoolTotalSupply(poolAddr)

  const token1Bal = pool === 'eurc' ? eurcBal : cirBtcBal

  function optimalToken1(usdcIn: bigint): bigint {
    if (reserve0 === 0n || reserve1 === 0n) return 0n
    return (usdcIn * reserve1) / reserve0
  }

  const handleUsdcChange = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, '')
    if (clean === '' || /^\d*\.?\d*$/.test(clean)) {
      setUsdcAmt(clean)
      if (clean && reserve0 > 0n) {
        const opt = optimalToken1(parseUnitsStrict(clean, 6))
        setTokenAmt(formatUnits(opt, info.token1Dec, info.token1Dec))
      }
    }
  }

  function lpShareEstimate(): bigint {
    if (reserve0 === 0n || reserve1 === 0n || totalSupply === 0n || !usdcAmt) return 0n
    const u = parseUnitsStrict(usdcAmt, 6)
    if (u === 0n) return 0n
    return (u * totalSupply) / reserve0
  }

  function removeAmounts(): { amt0: bigint; amt1: bigint } {
    if (!lpAmt) return { amt0: 0n, amt1: 0n }
    const lp = parseUnitsStrict(lpAmt, 18)
    if (totalSupply === 0n || lp === 0n) return { amt0: 0n, amt1: 0n }
    return { amt0: (lp * reserve0) / totalSupply, amt1: (lp * reserve1) / totalSupply }
  }

  // ── Add liquidity state machine ──────────────────────────────────────────

  const [addStep, setAddStep] = useState<AddStep>('idle')
  const [pendingUsdc, setPendingUsdc] = useState(0n)
  const [pendingT1, setPendingT1] = useState(0n)

  const {
    writeContract: approveUsdcFn,
    data: approveUsdcHash,
    isPending: approveUsdcPending,
    error: approveUsdcError,
    reset: resetApproveUsdc,
  } = useWriteContract()

  const {
    writeContract: approveT1Fn,
    data: approveT1Hash,
    isPending: approveT1Pending,
    error: approveT1Error,
    reset: resetApproveT1,
  } = useWriteContract()

  const {
    writeContract: addLiqFn,
    data: addHash,
    isPending: addPending,
    error: addError_,
    reset: resetAddLiq,
  } = useWriteContract()

  const { isLoading: approveUsdcConf, isSuccess: approveUsdcOk } = useWaitForTransactionReceipt({ hash: approveUsdcHash, chainId: TARGET_CHAIN_ID })
  const { isLoading: approveT1Conf, isSuccess: approveT1Ok } = useWaitForTransactionReceipt({ hash: approveT1Hash, chainId: TARGET_CHAIN_ID })
  const { isLoading: addConf, isSuccess: addOk } = useWaitForTransactionReceipt({ hash: addHash, chainId: TARGET_CHAIN_ID })

  // Capture write errors for the user
  useEffect(() => {
    const err = approveUsdcError ?? approveT1Error ?? addError_
    if (err) {
      const msg = (err as { shortMessage?: string }).shortMessage ?? err.message ?? 'Transaction failed'
      setAddError(msg)
      setAddStep('idle')
      toast.error(msg, { id: 'addliq' + pool })
    }
  }, [approveUsdcError, approveT1Error, addError_, pool])

  // Step 1 done → kick step 2
  useEffect(() => {
    if (addStep !== 'approveUsdc' || !approveUsdcOk || !userAddr || !publicClient) return
    setAddStep('approveToken1')
    toast.info(`Step 2/3: Approve ${info.token1}`, { id: 'addliq' + pool })
    void (async () => {
      const gas = await estimateGas(publicClient, {
        address: token1Addr, abi: erc20Abi, functionName: 'approve', args: [poolAddr, pendingT1], account: userAddr,
      })
      approveT1Fn({ address: token1Addr, abi: erc20Abi, functionName: 'approve', args: [poolAddr, pendingT1], gas })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveUsdcOk, addStep])

  // Step 2 done → kick step 3
  useEffect(() => {
    if (addStep !== 'approveToken1' || !approveT1Ok || !userAddr || !publicClient) return
    const slip = slippageFactor(slipBps)
    setAddStep('addLiq')
    toast.info('Step 3/3: Confirm Add Liquidity', { id: 'addliq' + pool })
    void (async () => {
      const args = [pendingUsdc, pendingT1, slip(pendingUsdc), slip(pendingT1), userAddr, deadline()] as const
      const gas = await estimateGas(publicClient, {
        address: poolAddr, abi: BASKET_POOL_ABI, functionName: 'addLiquidity', args, account: userAddr,
      })
      addLiqFn({ address: poolAddr, abi: BASKET_POOL_ABI, functionName: 'addLiquidity', args, gas })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveT1Ok, addStep])

  // Step 3 done → success
  useEffect(() => {
    if (addStep === 'addLiq' && addOk) {
      setAddStep('done')
      void refetchReserves()
      void refetchBals()
      void refetchLp()
      triggerRefresh()
      toast.success('Liquidity added!', { id: 'addliq' + pool })
      if (userAddr && addHash) {
        saveActivity(userAddr, {
          id: `${addHash}-AddLiquidity`,
          type: 'Add Liquidity',
          desc: `Added ${formatUnits(pendingUsdc, 6, 2)} USDC + ${formatUnits(pendingT1, info.token1Dec, info.token1Dec)} ${info.token1} to ${info.label} pool`,
          txHash: addHash,
          timestamp: Date.now(),
        }, triggerRefresh)
      }
      setUsdcAmt('')
      setTokenAmt('')
      setTimeout(() => setAddStep('idle'), 2000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOk, addStep])

  const handleAdd = useCallback(() => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    const u = parseUnitsStrict(usdcAmt, 6)
    const t = parseUnitsStrict(tokenAmt, info.token1Dec)
    if (u === 0n || t === 0n) return
    setAddError(null)
    setPendingUsdc(u)
    setPendingT1(t)
    resetApproveUsdc()
    resetApproveT1()
    resetAddLiq()
    setAddStep('approveUsdc')
    toast.info('Step 1/3: Approve USDC', { id: 'addliq' + pool })
    void (async () => {
      try {
        const gas = publicClient && userAddr ? await estimateGas(publicClient, {
          address: addrs.USDC, abi: erc20Abi, functionName: 'approve', args: [poolAddr, u], account: userAddr,
        }) : GAS_FALLBACK.approve
        approveUsdcFn({ address: addrs.USDC, abi: erc20Abi, functionName: 'approve', args: [poolAddr, u], gas })
      } catch (e) {
        const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
        setAddError(msg); setAddStep('idle'); toast.error(msg, { id: 'addliq' + pool })
      }
    })()
  }, [usdcAmt, tokenAmt, info.token1Dec, addrs.USDC, poolAddr, pool, approveUsdcFn, resetApproveUsdc, resetApproveT1, resetAddLiq, publicClient, userAddr, wrongChain, switchChain])

  // ── Remove liquidity state machine ───────────────────────────────────────

  const [removeStep, setRemoveStep] = useState<RemoveStep>('idle')
  const [pendingLp, setPendingLp] = useState(0n)

  const {
    writeContract: approveLpFn,
    data: approveLpHash,
    isPending: approveLpPending,
    error: approveLpError,
    reset: resetApproveLp,
  } = useWriteContract()

  const {
    writeContract: removeLiqFn,
    data: removeHash,
    isPending: removePending,
    error: removeLiqError,
    reset: resetRemoveLiq,
  } = useWriteContract()

  const { isLoading: approveLpConf, isSuccess: approveLpOk } = useWaitForTransactionReceipt({ hash: approveLpHash, chainId: TARGET_CHAIN_ID })
  const { isLoading: removeConf, isSuccess: removeOk } = useWaitForTransactionReceipt({ hash: removeHash, chainId: TARGET_CHAIN_ID })

  useEffect(() => {
    const err = approveLpError ?? removeLiqError
    if (err) {
      const msg = (err as { shortMessage?: string }).shortMessage ?? err.message ?? 'Transaction failed'
      setRemoveError(msg)
      setRemoveStep('idle')
      toast.error(msg, { id: 'remliq' + pool })
    }
  }, [approveLpError, removeLiqError, pool])

  useEffect(() => {
    if (removeStep !== 'approveLp' || !approveLpOk || !userAddr || !publicClient) return
    const { amt0, amt1 } = removeAmounts()
    const slip = slippageFactor(slipBps)
    setRemoveStep('removeLiq')
    toast.info('Step 2/2: Confirm Remove Liquidity', { id: 'remliq' + pool })
    void (async () => {
      const args = [pendingLp, slip(amt0), slip(amt1), userAddr, deadline()] as const
      const gas = await estimateGas(publicClient, {
        address: poolAddr, abi: BASKET_POOL_ABI, functionName: 'removeLiquidity', args, account: userAddr,
      })
      removeLiqFn({ address: poolAddr, abi: BASKET_POOL_ABI, functionName: 'removeLiquidity', args, gas })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveLpOk, removeStep])

  useEffect(() => {
    if (removeStep === 'removeLiq' && removeOk) {
      setRemoveStep('done')
      void refetchReserves()
      void refetchBals()
      void refetchLp()
      triggerRefresh()
      toast.success('Liquidity removed!', { id: 'remliq' + pool })
      if (userAddr && removeHash) {
        saveActivity(userAddr, {
          id: `${removeHash}-RemoveLiquidity`,
          type: 'Remove Liquidity',
          desc: `Removed ${formatUnits(pendingLp, 18, 4)} LP from ${info.label} pool`,
          txHash: removeHash,
          timestamp: Date.now(),
        }, triggerRefresh)
      }
      setLpAmt('')
      setTimeout(() => setRemoveStep('idle'), 2000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removeOk, removeStep])

  const handleRemove = useCallback(() => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    const lp = parseUnitsStrict(lpAmt, 18)
    if (lp === 0n) return
    setRemoveError(null)
    setPendingLp(lp)
    resetApproveLp()
    resetRemoveLiq()
    setRemoveStep('approveLp')
    toast.info('Step 1/2: Approve LP token', { id: 'remliq' + pool })
    void (async () => {
      try {
        const gas = publicClient && userAddr ? await estimateGas(publicClient, {
          address: poolAddr, abi: erc20Abi, functionName: 'approve', args: [poolAddr, lp], account: userAddr,
        }) : GAS_FALLBACK.approve
        approveLpFn({ address: poolAddr, abi: erc20Abi, functionName: 'approve', args: [poolAddr, lp], gas })
      } catch (e) {
        const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
        setRemoveError(msg); setRemoveStep('idle'); toast.error(msg, { id: 'remliq' + pool })
      }
    })()
  }, [lpAmt, poolAddr, pool, approveLpFn, resetApproveLp, resetRemoveLiq, publicClient, userAddr, wrongChain, switchChain])

  // ── Derived busy states ───────────────────────────────────────────────────

  const busyAdd = addStep !== 'idle' && addStep !== 'done'
  const busyAddAny = busyAdd || approveUsdcPending || approveUsdcConf || approveT1Pending || approveT1Conf || addPending || addConf
  const busyRemove = removeStep !== 'idle' && removeStep !== 'done'
  const busyRemoveAny = busyRemove || approveLpPending || approveLpConf || removePending || removeConf

  const { amt0: removeAmt0, amt1: removeAmt1 } = removeAmounts()

  return (
    <div style={glass.card} className="p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center">
          <TokenLogo token="USDC" size={28} />
          <TokenLogo token={info.token1Key} size={28} className="-ml-2" />
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{info.label}</div>
          <div className="text-xs mono" style={{ color: 'var(--subtle)' }}>{poolAddr.slice(0, 10)}…</div>
        </div>
      </div>

      {/* One-sided reserve warning */}
      {(reserve0 === 0n) !== (reserve1 === 0n) && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.25)', color: '#F7931A' }}>
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span>
            This pool has liquidity on only one side — it cannot swap or accept proportional adds.
            Add <strong>both</strong> tokens together to seed it fresh, or use the "Force init" mode below.
          </span>
        </div>
      )}

      {/* Reserves */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div style={glass.inner} className="p-3">
          <div className="flex items-center gap-1 text-xs mb-1" style={{ color: 'var(--subtle)' }}>
            <TokenLogo token="USDC" size={12} />USDC Reserve
          </div>
          <div className="display text-sm font-bold tabular-nums mt-1" style={{ color: 'var(--ink)' }}>{formatUsd(reserve0)}</div>
        </div>
        <div style={glass.inner} className="p-3">
          <div className="flex items-center gap-1 text-xs mb-1" style={{ color: 'var(--subtle)' }}>
            <TokenLogo token={info.token1Key} size={12} />{info.token1} Reserve
          </div>
          <div className="display text-sm font-bold tabular-nums mt-1" style={{ color: 'var(--ink)' }}>{formatUnits(reserve1, info.token1Dec, 6)}</div>
        </div>
      </div>

      {lpBalance > 0n && (
        <div className="px-3 py-2 mb-4 rounded-xl text-xs" style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.15)' }}>
          <span style={{ color: 'var(--muted)' }}>Your LP: </span>
          <span className="tabular-nums font-semibold" style={{ color: 'var(--accent)' }}>{formatUnits(lpBalance, 18, 6)}</span>
        </div>
      )}

      {/* Mode tabs */}
      <div className="flex gap-2 mb-4">
        {(['add', 'remove'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className="flex-1 py-2 rounded-xl text-xs font-semibold transition-colors"
            style={{ background: mode === m ? 'var(--surface-strong)' : 'var(--surface)', color: mode === m ? 'var(--ink)' : 'var(--muted)', border: `1px solid ${mode === m ? 'var(--border-strong)' : 'var(--border)'}` }}>
            {m === 'add' ? 'Add Liquidity' : 'Remove'}
          </button>
        ))}
      </div>

      {mode === 'add' && (
        <div className="space-y-3">
          <div style={glass.inner} className="p-3">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--subtle)' }}>
              <span>USDC</span>
              <button onClick={() => usdcBal && handleUsdcChange(formatUnits(usdcBal, 6, 6))} style={{ color: 'var(--accent)' }}>
                {usdcBal ? `${formatUsd(usdcBal)} Max` : '—'}
              </button>
            </div>
            <input inputMode="decimal" value={usdcAmt} onChange={(e) => handleUsdcChange(e.target.value)}
              placeholder="0.00" className="display w-full bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:opacity-20"
              style={{ color: 'var(--ink)' }} />
          </div>

          <div style={glass.inner} className="p-3">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--subtle)' }}>
              <span>{info.token1}</span>
              <span className="tabular-nums">{token1Bal ? formatUnits(token1Bal, info.token1Dec, info.token1Dec) : '—'}</span>
            </div>
            <input inputMode="decimal" value={tokenAmt}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setTokenAmt(v) }}
              placeholder="0.00" className="display w-full bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:opacity-20"
              style={{ color: 'var(--ink)' }} />
          </div>

          {totalSupply > 0n && usdcAmt && parseUnitsStrict(usdcAmt, 6) > 0n && (
            <div className="text-xs px-1" style={{ color: 'var(--subtle)' }}>
              You'll receive ≈ {formatUnits(lpShareEstimate(), 18, 6)} LP tokens
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>Slippage</span>
            {[25, 50, 100].map((bps) => (
              <button key={bps} onClick={() => setSlipBps(bps)}
                className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors"
                style={{ background: slipBps === bps ? 'var(--accent)' : 'rgba(255,255,255,0.07)', color: slipBps === bps ? '#0d1b2f' : 'var(--muted)' }}>
                {(bps / 100).toFixed(2)}%
              </button>
            ))}
          </div>

          {/* Step status */}
          {addStep !== 'idle' && addStep !== 'done' && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
              <Loader2 className="size-3.5 animate-spin shrink-0" />
              <span>{STEP_LABELS[addStep]}</span>
            </div>
          )}
          {addStep === 'done' && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>Liquidity added successfully!</span>
            </div>
          )}
          {addError && (
            <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{addError}</span>
            </div>
          )}

          <button
            disabled={!isConnected || wrongChain || busyAddAny || !usdcAmt || !tokenAmt || parseUnitsStrict(usdcAmt, 6) === 0n}
            onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleAdd}
            className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
            {!isConnected ? 'Connect Wallet'
              : wrongChain ? 'Switch Network'
              : busyAddAny ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {STEP_LABELS[addStep] || 'Processing…'}
                </span>
              )
              : 'Add Liquidity'}
          </button>
          {addHash && (
            <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, addHash)} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs mt-1 justify-center" style={{ color: 'var(--accent)' }}>
              View last tx <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {mode === 'remove' && (
        <div className="space-y-3">
          <div style={glass.inner} className="p-3">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--subtle)' }}>
              <span>LP tokens</span>
              <button onClick={() => lpBalance && setLpAmt(formatUnits(lpBalance, 18, 18))} style={{ color: 'var(--accent)' }}>
                {lpBalance ? `${formatUnits(lpBalance, 18, 4)} Max` : '—'}
              </button>
            </div>
            <input inputMode="decimal" value={lpAmt}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setLpAmt(v) }}
              placeholder="0.000000" className="display w-full bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:opacity-20"
              style={{ color: 'var(--ink)' }} />
          </div>

          {lpAmt && parseUnitsStrict(lpAmt, 18) > 0n && (
            <div className="text-xs space-y-1 px-1" style={{ color: 'var(--subtle)' }}>
              <div>Receive ≈ <span className="tabular-nums" style={{ color: 'var(--ink)' }}>{formatUsd(removeAmt0)} USDC</span></div>
              <div>and ≈ <span className="tabular-nums" style={{ color: 'var(--ink)' }}>{formatUnits(removeAmt1, info.token1Dec, 6)} {info.token1}</span></div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>Slippage</span>
            {[25, 50, 100].map((bps) => (
              <button key={bps} onClick={() => setSlipBps(bps)}
                className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors"
                style={{ background: slipBps === bps ? 'var(--accent)' : 'rgba(255,255,255,0.07)', color: slipBps === bps ? '#0d1b2f' : 'var(--muted)' }}>
                {(bps / 100).toFixed(2)}%
              </button>
            ))}
          </div>

          {/* Remove step status */}
          {removeStep !== 'idle' && removeStep !== 'done' && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
              <Loader2 className="size-3.5 animate-spin shrink-0" />
              <span>{REMOVE_LABELS[removeStep]}</span>
            </div>
          )}
          {removeStep === 'done' && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>Liquidity removed successfully!</span>
            </div>
          )}
          {removeError && (
            <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{removeError}</span>
            </div>
          )}

          <button
            disabled={!isConnected || wrongChain || busyRemoveAny || !lpAmt || lpBalance === 0n || parseUnitsStrict(lpAmt, 18) === 0n}
            onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleRemove}
            className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'rgba(232,109,122,0.2)', color: 'var(--danger)', border: '1px solid rgba(232,109,122,0.3)' }}>
            {!isConnected ? 'Connect Wallet'
              : wrongChain ? 'Switch Network'
              : busyRemoveAny ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {REMOVE_LABELS[removeStep] || 'Processing…'}
                </span>
              )
              : 'Remove Liquidity'}
          </button>
          {removeHash && (
            <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, removeHash)} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs mt-1 justify-center" style={{ color: 'var(--danger)' }}>
              View last tx <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export function PoolTab() {
  return (
    <div className="space-y-4">
      <PoolCard pool="eurc" />
      <PoolCard pool="btc" />
    </div>
  )
}
