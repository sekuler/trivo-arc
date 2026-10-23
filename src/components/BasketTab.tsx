import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'
import { BASKET_ABI, getAddresses, TARGET_CHAIN_ID, TARGET_CHAIN, GAS_FALLBACK } from '../contracts'
import { TokenLogo } from './TokenLogo'
import { estimateGas } from '../estimateGas'
import { GatewaySection } from './GatewaySection'
import { useBasketPosition, useBasketAllocation, useTokenBalances, usePoolReserves } from '../hooks/useContracts'
import { useRefresh } from '../context/RefreshContext'
import { formatUnits, parseUnitsStrict, formatUsd, slippageFactor, calcPriceImpactBps } from '../utils/format'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { saveActivity } from '../hooks/useActivity'

const glass = {
  card:  { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

type DepositStep  = 'idle' | 'approve' | 'deposit' | 'done'
type WithdrawMode = 'usdc' | 'tokens'

/** Scale bigint by a basis-point share (1–10000) */
function bpsOf(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / 10000n
}

/** Constant-product AMM output quote (0.3% fee) */
function ammQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const fee = amountIn * 997n
  return (fee * reserveOut) / (reserveIn * 1000n + fee)
}

export function BasketTab() {
  const { chainId, isConnected, address } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const addrs    = getAddresses(TARGET_CHAIN_ID)
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID
  const { triggerRefresh } = useRefresh()

  // ── Data hooks ────────────────────────────────────────────────────────────
  const { totalValue, usdcHeld, eurcHeld, btcHeld, isLoading: posLoading, refetch: refetchPos } = useBasketPosition()
  const { usdcBps, eurcBps, btcBps, refetch: refetchAlloc } = useBasketAllocation()
  const { usdc: usdcBal, isLoading: balLoading } = useTokenBalances()
  const { reserve0: eurcR0, reserve1: eurcR1 } = usePoolReserves(addrs.POOL_USDC_EURC)
  const { reserve0: btcR0,  reserve1: btcR1  } = usePoolReserves(addrs.POOL_USDC_BTC)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [depositAmt,    setDepositAmt]    = useState('')
  const [slipBps,       setSlipBps]       = useState(100)
  const [showAlloc,     setShowAlloc]     = useState(false)
  const [newUsdc,       setNewUsdc]       = useState(usdcBps)
  const [newEurc,       setNewEurc]       = useState(eurcBps)
  const [newBtc,        setNewBtc]        = useState(btcBps)
  const [withdrawMode,     setWithdrawMode]     = useState<WithdrawMode>('usdc')
  const [withdrawShareBps, setWithdrawShareBps] = useState<number>(10000) // 100% default
  const [withdrawUsdcAmt,  setWithdrawUsdcAmt]  = useState('')            // custom USDC input

  // ── Tx state ──────────────────────────────────────────────────────────────
  const [depositStep,   setDepositStep]   = useState<DepositStep>('idle')
  const [pendingAmt,    setPendingAmt]    = useState(0n)
  const [pendingMin1,   setPendingMin1]   = useState(0n)
  const [pendingMin2,   setPendingMin2]   = useState(0n)
  const [depositError,  setDepositError]  = useState<string | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const { writeContract: approveFn,  data: approveHash,  isPending: approvePending,  error: approveErr,   reset: resetApprove  } = useWriteContract()
  const { writeContract: depositFn,  data: depositHash,  isPending: depositPending,  error: depositErr,   reset: resetDeposit  } = useWriteContract()
  const { writeContract: withdrawFn, data: withdrawHash, isPending: withdrawPending, error: withdrawErr               } = useWriteContract()
  const { writeContract: allocFn,    data: allocHash,    isPending: allocPending                                       } = useWriteContract()

  const { isLoading: approveConf, isSuccess: approveOk }  = useWaitForTransactionReceipt({ hash: approveHash,  chainId: TARGET_CHAIN_ID })
  const { isLoading: depositConf, isSuccess: depositOk }  = useWaitForTransactionReceipt({ hash: depositHash,  chainId: TARGET_CHAIN_ID })
  const { isLoading: withdrawConf, isSuccess: withdrawOk } = useWaitForTransactionReceipt({ hash: withdrawHash, chainId: TARGET_CHAIN_ID })
  const { isSuccess: allocOk }                             = useWaitForTransactionReceipt({ hash: allocHash,    chainId: TARGET_CHAIN_ID })

  // ── Quoted preview (USDC deposit only) ───────────────────────────────────
  const previewAmt   = parseUnitsStrict(depositAmt || '0', 6)
  const slip         = slippageFactor(slipBps)
  const usdcKept     = previewAmt > 0n ? (previewAmt * BigInt(usdcBps)) / 10000n : 0n
  const usdcForEurc  = previewAmt > 0n ? (previewAmt * BigInt(eurcBps)) / 10000n : 0n
  const usdcForBtc   = previewAmt > 0n ? (previewAmt * BigInt(btcBps))  / 10000n : 0n
  const quotedEurc   = ammQuote(usdcForEurc, eurcR0, eurcR1)
  const quotedBtc    = ammQuote(usdcForBtc,  btcR0,  btcR1)
  const minEurc      = slip(quotedEurc)
  const minBtc       = slip(quotedBtc)

  // Price impact for deposit (weighted: eurc leg + btc leg, each relative to its own swap)
  const depositImpactBps = previewAmt > 0n ? Math.round(
    (eurcBps > 0 ? calcPriceImpactBps(usdcForEurc, eurcR0, eurcR1) * eurcBps : 0) / 10000 +
    (btcBps  > 0 ? calcPriceImpactBps(usdcForBtc,  btcR0,  btcR1)  * btcBps  : 0) / 10000
  ) : 0

  // ── Withdraw share derived from USDC amount input or quick % buttons ────────
  // If the user typed a USDC amount, convert it to a bps share of totalValue.
  // totalValue comes from the contract's getBasketValue (spot price).
  const withdrawShareFromInput: number = (() => {
    if (!withdrawUsdcAmt) return withdrawShareBps
    const inputRaw = parseUnitsStrict(withdrawUsdcAmt, 6)
    if (inputRaw === 0n || totalValue === 0n) return withdrawShareBps
    const computed = Number((inputRaw * 10000n) / totalValue)
    return Math.min(10000, Math.max(1, computed))
  })()
  // Active share: USDC amount input takes precedence when non-empty
  const activeBps = withdrawUsdcAmt ? withdrawShareFromInput : withdrawShareBps

  // Per-share slices
  const wUsdcShare = bpsOf(usdcHeld, activeBps)
  const wEurcShare = bpsOf(eurcHeld, activeBps)
  const wBtcShare  = bpsOf(btcHeld,  activeBps)

  // Expected output when converting to USDC
  const expectedUsdcFromEurc = ammQuote(wEurcShare, eurcR1, eurcR0)
  const expectedUsdcFromBtc  = ammQuote(wBtcShare,  btcR1,  btcR0)
  const expectedTotalUsdc    = wUsdcShare + expectedUsdcFromEurc + expectedUsdcFromBtc
  const minWithdrawUsdc      = slip(expectedTotalUsdc)

  // Price impact for withdraw-as-USDC (weighted by each leg's value share)
  const withdrawImpactBps = expectedTotalUsdc > 0n ? Math.round(
    (wEurcShare > 0n ? calcPriceImpactBps(wEurcShare, eurcR1, eurcR0) * Number(expectedUsdcFromEurc) : 0) / Number(expectedTotalUsdc || 1n) +
    (wBtcShare  > 0n ? calcPriceImpactBps(wBtcShare,  btcR1,  btcR0)  * Number(expectedUsdcFromBtc)  : 0) / Number(expectedTotalUsdc || 1n)
  ) : 0

  // Pool state
  const eurcPoolOk = eurcR0 > 0n && eurcR1 > 0n
  const btcPoolOk  = btcR0  > 0n && btcR1  > 0n
  const bothPoolsOk = eurcPoolOk && btcPoolOk

  // Depth warning: deposit uses >20% of the relevant reserve
  const depthWarnings: string[] = []
  if (previewAmt > 0n && bothPoolsOk) {
    if (eurcBps > 0 && usdcForEurc * 5n > eurcR0) depthWarnings.push(`USDC/EURC pool is shallow (${formatUsd(eurcR0)} USDC available)`)
    if (btcBps  > 0 && usdcForBtc  * 5n > btcR0)  depthWarnings.push(`USDC/cirBTC pool is shallow (${formatUsd(btcR0)} USDC available)`)
  }

  const hasPosition  = usdcHeld > 0n || eurcHeld > 0n || btcHeld > 0n
  const busyDeposit  = depositStep !== 'idle' && depositStep !== 'done'
  const busyAny      = busyDeposit || approvePending || approveConf || depositPending || depositConf
  const busyWithdraw = withdrawPending || withdrawConf

  const depositStepLabel =
    depositStep === 'approve' ? `Step 1/2 — Approve USDC for ${addrs.BASKET.slice(0,6)}…${addrs.BASKET.slice(-4)} in your wallet`
    : depositStep === 'deposit' ? 'Step 2/2 — Confirm deposit in your wallet…'
    : ''

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const err = approveErr ?? depositErr
    if (err) {
      const msg = (err as { shortMessage?: string; message?: string }).shortMessage ?? err.message ?? 'Transaction failed'
      setDepositError(msg)
      setDepositStep('idle')
      toast.error(msg.slice(0, 80), { id: 'deposit' })
    }
  }, [approveErr, depositErr])

  useEffect(() => {
    if (depositStep !== 'approve' || !approveOk || !address || !publicClient) return
    setDepositStep('deposit')
    toast.info('Step 2/2: Confirm deposit in your wallet', { id: 'deposit' })
    void (async () => {
      const gas = await estimateGas(publicClient, {
        address: addrs.BASKET,
        abi: BASKET_ABI,
        functionName: 'depositUsdc',
        args: [pendingAmt, pendingMin1, pendingMin2],
        account: address,
      })
      depositFn({ address: addrs.BASKET, abi: BASKET_ABI, functionName: 'depositUsdc', args: [pendingAmt, pendingMin1, pendingMin2], gas })
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveOk, depositStep])

  useEffect(() => {
    if (depositStep === 'deposit' && depositOk) {
      setDepositStep('done')
      void refetchPos()
      triggerRefresh()
      toast.success('Deposit confirmed!', { id: 'deposit' })
      if (address && depositHash) {
        saveActivity(address, {
          id: `${depositHash}-Deposit`,
          type: 'Deposit',
          desc: `Deposited ${formatUnits(pendingAmt, 6, 2)} USDC to basket`,
          txHash: depositHash,
          timestamp: Date.now(),
        })
      }
      setDepositAmt('')
      setTimeout(() => setDepositStep('idle'), 3000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositOk, depositStep])

  useEffect(() => {
    if (withdrawErr) {
      const msg = (withdrawErr as { shortMessage?: string; message?: string }).shortMessage ?? withdrawErr.message ?? 'Transaction failed'
      setWithdrawError(msg)
      toast.error(msg.slice(0, 80), { id: 'withdraw' })
    }
  }, [withdrawErr])

  useEffect(() => {
    if (withdrawOk) {
      void refetchPos()
      triggerRefresh()
      setWithdrawError(null)
      toast.success('Withdrawal confirmed!', { id: 'withdraw' })
      if (address && withdrawHash) {
        saveActivity(address, {
          id: `${withdrawHash}-Withdraw`,
          type: 'Withdraw',
          desc: `Withdrew ${(activeBps / 100).toFixed(activeBps % 100 === 0 ? 0 : 2)}% from basket${withdrawMode === 'usdc' ? ' as USDC' : ' as tokens'}`,
          txHash: withdrawHash,
          timestamp: Date.now(),
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawOk])

  useEffect(() => {
    if (allocOk) {
      void refetchAlloc()
      setShowAlloc(false)
      toast.success('Allocation updated')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocOk])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDeposit = () => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    if (!depositAmt) return
    const amount = parseUnitsStrict(depositAmt, 6)
    if (amount === 0n) return

    const m1 = minEurc  // already computed from live reserves
    const m2 = minBtc

    // Pre-flight: check pool reserves are non-zero and quote is achievable.
    // We do NOT simulate the full depositUsdc call here because the USDC allowance
    // is 0 at this point (approve hasn't run yet) — the simulation would always
    // fail with "transfer amount exceeds allowance" before even reaching the swap.
    // Instead we catch the actual revert from the deposit tx after approve confirms.
    if (!eurcPoolOk || !btcPoolOk) {
      setDepositError('Pool has no liquidity. Add liquidity in the Pool tab first.')
      return
    }
    if (quotedEurc === 0n && eurcBps > 0) {
      setDepositError('USDC/EURC pool cannot fill this swap — add more liquidity.')
      return
    }
    if (quotedBtc === 0n && btcBps > 0) {
      setDepositError('USDC/cirBTC pool cannot fill this swap — add more liquidity.')
      return
    }

    setDepositError(null)
    resetApprove()
    resetDeposit()
    setPendingAmt(amount)
    setPendingMin1(m1)
    setPendingMin2(m2)
    setDepositStep('approve')

    toast.info('Step 1/2: Approve USDC in your wallet', { id: 'deposit' })
    void (async () => {
      const gas = publicClient && address ? await estimateGas(publicClient, {
        address: addrs.USDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addrs.BASKET, amount],
        account: address,
      }) : GAS_FALLBACK.approve
      approveFn({ address: addrs.USDC, abi: erc20Abi, functionName: 'approve', args: [addrs.BASKET, amount], gas })
    })()
  }

  const handleWithdraw = () => {
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    setWithdrawError(null)
    const isPartial = activeBps < 10000
    void (async () => {
      try {
        if (withdrawMode === 'usdc') {
          const fn = isPartial ? 'withdrawPartial' : 'withdrawAll'
          const args = isPartial ? [activeBps, minWithdrawUsdc] : [minWithdrawUsdc]
          const gas = publicClient && address ? await estimateGas(publicClient, {
            address: addrs.BASKET, abi: BASKET_ABI, functionName: fn, args, account: address,
          }) : GAS_FALLBACK.withdraw
          withdrawFn({ address: addrs.BASKET, abi: BASKET_ABI, functionName: fn, args, gas })
        } else {
          const fn = isPartial ? 'withdrawPartialTokens' : 'withdrawTokens'
          const args = isPartial ? [activeBps] : []
          const gas = publicClient && address ? await estimateGas(publicClient, {
            address: addrs.BASKET, abi: BASKET_ABI, functionName: fn, args, account: address,
          }) : GAS_FALLBACK.withdrawPartial
          withdrawFn({ address: addrs.BASKET, abi: BASKET_ABI, functionName: fn, args, gas })
        }
        toast.info('Confirm withdrawal in your wallet', { id: 'withdraw' })
      } catch (e) {
        const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? 'Gas estimation failed'
        setWithdrawError(msg); toast.error(msg.slice(0, 80), { id: 'withdraw' })
      }
    })()
  }

  const handleSetAllocation = () => {
    if (newUsdc + newEurc + newBtc !== 10000) { toast.error('Must sum to 100%'); return }
    void (async () => {
      const gas = publicClient && address ? await estimateGas(publicClient, {
        address: addrs.BASKET, abi: BASKET_ABI, functionName: 'setAllocation',
        args: [newUsdc, newEurc, newBtc], account: address,
      }) : GAS_FALLBACK.setAlloc
      allocFn({ address: addrs.BASKET, abi: BASKET_ABI, functionName: 'setAllocation', args: [newUsdc, newEurc, newBtc], gas })
    })()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)]" style={{ alignItems: 'start' }}>

      {/* ── Left column: holdings + deposit + withdraw ── */}
      <div className="space-y-4">

      {/* ── Holdings card ── */}
      <div style={glass.card} className="p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Your Basket</span>
          {hasPosition && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(141,216,159,0.15)', color: 'var(--success)' }}>Active</span>
          )}
        </div>

        {/* Total value */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
            {posLoading ? <Loader2 className="size-5 animate-spin inline" /> : `$${formatUsd(totalValue)}`}
          </span>
          <span className="text-sm" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>Estimated value · live pool reserves · display only</p>

        {/* Per-token rows */}
        <div className="space-y-2">
          {([
            { label: 'USDC',   tok: 'USDC'    as const, value: usdcHeld, dec: 6, digits: 2, bps: usdcBps },
            { label: 'EURC',   tok: 'EURC'    as const, value: eurcHeld, dec: 6, digits: 2, bps: eurcBps },
            { label: 'cirBTC', tok: 'CIRBTC'  as const, value: btcHeld,  dec: 8, digits: 8, bps: btcBps  },
          ]).map(({ label, tok, value, dec, digits, bps }) => (
            <div key={label} style={glass.inner} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 w-20 shrink-0">
                <TokenLogo token={tok} size={18} />
                <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{label}</span>
              </div>
              <span className="display text-sm font-bold tabular-nums flex-1 text-center" style={{ color: value > 0n ? 'var(--ink)' : 'var(--subtle)' }}>
                {posLoading ? '…' : formatUnits(value, dec, digits)}
              </span>
              <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-lg w-12 text-right shrink-0" style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}>
                {(bps / 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>

        {!hasPosition && !posLoading && (
          <p className="text-xs text-center mt-3" style={{ color: 'var(--subtle)' }}>No holdings yet — deposit below to start.</p>
        )}
      </div>

      {/* ── Deposit card ── */}
      <div style={glass.card} className="p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>Deposit USDC</h3>

        {/* Amount input */}
        <div style={glass.inner} className="p-4 mb-3">
          <input
            inputMode="decimal"
            value={depositAmt}
            onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setDepositAmt(v) }}
            placeholder="0.00"
            className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-20"
            style={{ color: 'var(--ink)' }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
            <button
              onClick={() => usdcBal && setDepositAmt(formatUnits(usdcBal, 6, 6))}
              disabled={!usdcBal || balLoading}
              className="text-xs font-semibold disabled:opacity-40"
              style={{ color: 'var(--accent-hover)' }}>
              {balLoading ? '…' : usdcBal ? `Balance: ${formatUnits(usdcBal, 6, 2)} · Max` : 'Connect wallet'}
            </button>
          </div>
        </div>

        {/* Quote preview */}
        {previewAmt > 0n && (
          <div className="text-xs px-3 py-2.5 rounded-xl mb-3 space-y-1.5" style={{ background: 'rgba(172,198,233,0.06)', border: '1px solid rgba(172,198,233,0.12)' }}>
            <div className="font-semibold mb-1" style={{ color: 'var(--accent)' }}>Expected split ({(slipBps / 100).toFixed(0)}% slippage protection):</div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--subtle)' }}>USDC kept</span>
              <span className="tabular-nums font-medium" style={{ color: 'var(--ink-2)' }}>{formatUnits(usdcKept, 6, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--subtle)' }}>Min EURC received</span>
              <span className="tabular-nums font-medium" style={{ color: eurcPoolOk ? 'var(--ink-2)' : 'var(--muted)' }}>
                {eurcPoolOk ? formatUnits(minEurc, 6, 4) : 'pool empty'}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--subtle)' }}>Min cirBTC received</span>
              <span className="tabular-nums font-medium" style={{ color: btcPoolOk ? 'var(--ink-2)' : 'var(--muted)' }}>
                {btcPoolOk ? formatUnits(minBtc, 8, 8) : 'pool empty'}
              </span>
            </div>
            {depositImpactBps > 0 && (
              <div className="flex justify-between pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                <span style={{ color: 'var(--subtle)' }}>Price impact</span>
                <span className="tabular-nums font-semibold" style={{ color: depositImpactBps >= 1000 ? 'var(--danger)' : depositImpactBps >= 200 ? '#f59e0b' : 'var(--subtle)' }}>
                  {(depositImpactBps / 100).toFixed(2)}%
                </span>
              </div>
            )}
            {depositImpactBps >= 1000 && (
              <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(232,109,122,0.10)', border: '1px solid rgba(232,109,122,0.20)', color: 'var(--danger)' }}>
                <AlertCircle className="size-3 shrink-0" />
                Low liquidity: large price impact
              </div>
            )}
          </div>
        )}

        {/* Allocation chips + editor */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {([
            { label: 'USDC',   tok: 'USDC'   as const, bps: usdcBps },
            { label: 'EURC',   tok: 'EURC'   as const, bps: eurcBps },
            { label: 'cirBTC', tok: 'CIRBTC' as const, bps: btcBps  },
          ]).map(({ label, tok, bps }) => (
            <span key={label} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--ink-2)' }}>
              <TokenLogo token={tok} size={12} />
              {(bps / 100).toFixed(0)}% {label}
            </span>
          ))}
          <button onClick={() => setShowAlloc(!showAlloc)} className="ml-auto text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            Edit <ChevronDown className={`size-3 transition-transform ${showAlloc ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showAlloc && (
          <div style={glass.inner} className="p-4 mb-3 space-y-3">
            {([
              { label: 'USDC %',   val: newUsdc, set: setNewUsdc },
              { label: 'EURC %',   val: newEurc, set: setNewEurc },
              { label: 'cirBTC %', val: newBtc,  set: setNewBtc  },
            ] as { label: string; val: number; set: (v: number) => void }[]).map(({ label, val, set }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs w-16 shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
                <input type="range" min={0} max={10000} step={100} value={val} onChange={(e) => set(Number(e.target.value))} className="flex-1 accent-blue-400" />
                <span className="text-xs tabular-nums w-10 text-right" style={{ color: 'var(--ink-2)' }}>{(val / 100).toFixed(0)}%</span>
              </div>
            ))}
            <div className="flex items-center justify-between mt-1">
              <span className={`text-xs ${newUsdc + newEurc + newBtc === 10000 ? '' : 'text-red-400'}`}>
                Total: {((newUsdc + newEurc + newBtc) / 100).toFixed(0)}%
              </span>
              <button onClick={handleSetAllocation} disabled={allocPending || newUsdc + newEurc + newBtc !== 10000}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
                {allocPending ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Slippage */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Slippage</span>
          {[50, 100, 200].map((bps) => (
            <button key={bps} onClick={() => setSlipBps(bps)}
              className="text-xs px-2.5 py-1 rounded-lg font-semibold"
              style={{ background: slipBps === bps ? 'var(--accent)' : 'rgba(255,255,255,0.07)', color: slipBps === bps ? '#0d1b2f' : 'var(--muted)' }}>
              {(bps / 100).toFixed(2)}%
            </button>
          ))}
        </div>

        {/* Warnings */}
        {!bothPoolsOk && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.25)', color: '#F7931A' }}>
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span>
              {!eurcPoolOk && !btcPoolOk ? 'Both pools have no liquidity.' : !eurcPoolOk ? 'USDC/EURC pool has no liquidity.' : 'USDC/cirBTC pool has no liquidity.'}
              {' '}Go to the <strong>Pool</strong> tab and add liquidity to both sides first.
            </span>
          </div>
        )}
        {depthWarnings.length > 0 && bothPoolsOk && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.18)', color: '#F7931A' }}>
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span>High price impact: {depthWarnings.join('; ')}. Add more pool liquidity or reduce deposit size.</span>
          </div>
        )}

        {/* Step status */}
        {depositStepLabel && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
            <Loader2 className="size-3.5 animate-spin shrink-0" />
            <span>{depositStepLabel}</span>
          </div>
        )}
        {depositStep === 'done' && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span>Deposit confirmed!</span>
          </div>
        )}
        {depositError && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
            style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{depositError}</span>
          </div>
        )}

        <button
          disabled={!isConnected || (busyAny && !wrongChain) || (!wrongChain && (!depositAmt || Number(depositAmt) <= 0 || !bothPoolsOk))}
          onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleDeposit}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: wrongChain ? 'rgba(172,198,233,0.2)' : 'var(--accent)', color: wrongChain ? 'var(--accent)' : '#0d1b2f', border: wrongChain ? '1px solid rgba(172,198,233,0.35)' : 'none' }}>
          {!isConnected ? 'Connect Wallet'
            : wrongChain ? `⇄ Switch to ${TARGET_CHAIN.name}`
            : busyAny
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{depositStepLabel || 'Processing…'}</span>
              : 'Deposit USDC to Basket'}
        </button>

        {depositHash && (
          <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, depositHash)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs mt-2 justify-center" style={{ color: 'var(--accent)' }}>
            View deposit tx <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {/* ── Withdraw card ── always visible so the UI is testable before depositing */}
      <div style={glass.card} className="p-5">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-2)' }}>Withdraw</h3>

          {!hasPosition && !posLoading && (
            <p className="text-xs mb-4 text-center py-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--subtle)' }}>
              No basket position yet. Deposit USDC above to start.
            </p>
          )}

          {hasPosition && (<>

          {/* ── Amount selector ── */}
          <div className="mb-4">
            {/* Quick % buttons */}
            <div className="flex gap-2 mb-3">
              {([2500, 5000, 7500, 10000] as const).map((bps) => (
                <button key={bps}
                  onClick={() => { setWithdrawShareBps(bps); setWithdrawUsdcAmt('') }}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-colors"
                  style={{
                    background: activeBps === bps && !withdrawUsdcAmt ? 'rgba(172,198,233,0.18)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${activeBps === bps && !withdrawUsdcAmt ? 'rgba(172,198,233,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    color: activeBps === bps && !withdrawUsdcAmt ? 'var(--accent)' : 'var(--muted)',
                  }}>
                  {bps === 10000 ? 'MAX' : `${bps / 100}%`}
                </button>
              ))}
            </div>

            {/* Custom USDC amount input */}
            <div style={glass.inner} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <input
                  inputMode="decimal"
                  placeholder="Custom USDC amount…"
                  value={withdrawUsdcAmt}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '')
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setWithdrawUsdcAmt(v)
                  }}
                  className="display w-full bg-transparent text-xl font-bold tabular-nums outline-none placeholder:text-sm placeholder:font-normal placeholder:opacity-30"
                  style={{ color: 'var(--ink)' }}
                />
              </div>
              <span className="text-xs shrink-0" style={{ color: 'var(--subtle)' }}>USDC</span>
              {withdrawUsdcAmt && (
                <button onClick={() => setWithdrawUsdcAmt('')}
                  className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>✕</button>
              )}
            </div>

            {/* Share indicator */}
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                Withdrawing <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>{(activeBps / 100).toFixed(activeBps % 100 === 0 ? 0 : 2)}%</span> of basket
              </span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                ≈ ${formatUsd(expectedTotalUsdc)}
              </span>
            </div>
          </div>

          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {([
              { mode: 'usdc'   as WithdrawMode, label: 'Convert to USDC',   sub: 'Swaps EURC + cirBTC → USDC' },
              { mode: 'tokens' as WithdrawMode, label: 'Receive as tokens',  sub: 'No swaps — raw balances' },
            ]).map(({ mode, label, sub }) => (
              <button key={mode} onClick={() => setWithdrawMode(mode)}
                className="text-left p-3 rounded-xl transition-colors"
                style={{
                  background: withdrawMode === mode ? 'rgba(172,198,233,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${withdrawMode === mode ? 'rgba(172,198,233,0.35)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                <div className="text-xs font-semibold mb-0.5" style={{ color: withdrawMode === mode ? 'var(--accent)' : 'var(--ink-2)' }}>{label}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</div>
              </button>
            ))}
          </div>

          {/* Expected amounts preview */}
          <div style={glass.inner} className="p-3 mb-4 space-y-2">
            {withdrawMode === 'usdc' ? (
              <>
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--subtle)' }}>
                  You will receive (estimated, {(activeBps / 100).toFixed(activeBps % 100 === 0 ? 0 : 2)}%):
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>USDC (direct)</span>
                  <span className="display text-sm tabular-nums font-bold" style={{ color: 'var(--ink)' }}>{formatUnits(wUsdcShare, 6, 2)}</span>
                </div>
                {wEurcShare > 0n && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>EURC → USDC</span>
                    <span className="display text-sm tabular-nums font-bold" style={{ color: 'var(--ink)' }}>≈ {formatUnits(expectedUsdcFromEurc, 6, 2)}</span>
                  </div>
                )}
                {wBtcShare > 0n && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>cirBTC → USDC</span>
                    <span className="display text-sm tabular-nums font-bold" style={{ color: 'var(--ink)' }}>≈ {formatUnits(expectedUsdcFromBtc, 6, 2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Min total (after {(slipBps / 100).toFixed(0)}% slippage)</span>
                  <span className="display text-sm tabular-nums font-bold" style={{ color: 'var(--success)' }}>${formatUsd(minWithdrawUsdc)}</span>
                </div>
                {withdrawImpactBps > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>Price impact</span>
                    <span className="text-xs tabular-nums font-semibold" style={{ color: withdrawImpactBps >= 1000 ? 'var(--danger)' : withdrawImpactBps >= 200 ? '#f59e0b' : 'var(--subtle)' }}>
                      {(withdrawImpactBps / 100).toFixed(2)}%
                    </span>
                  </div>
                )}
                {withdrawImpactBps >= 1000 && (
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(232,109,122,0.10)', border: '1px solid rgba(232,109,122,0.20)', color: 'var(--danger)' }}>
                    <AlertCircle className="size-3 shrink-0" />
                    Low liquidity: large price impact
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--subtle)' }}>
                  You will receive ({(activeBps / 100).toFixed(activeBps % 100 === 0 ? 0 : 2)}% of each):
                </div>
                {([
                  { label: 'USDC',   val: wUsdcShare, dec: 6, digits: 2 },
                  { label: 'EURC',   val: wEurcShare, dec: 6, digits: 4 },
                  { label: 'cirBTC', val: wBtcShare,  dec: 8, digits: 8 },
                ] as const).map(({ label, val, dec, digits }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
                    <span className="display text-sm tabular-nums font-bold" style={{ color: val > 0n ? 'var(--ink)' : 'var(--subtle)' }}>
                      {formatUnits(val, dec, digits)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Status / errors */}
          {withdrawError && (
            <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
              style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{withdrawError}</span>
            </div>
          )}
          {withdrawOk && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
              style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>Withdrawal confirmed!</span>
            </div>
          )}

          <button
            disabled={!isConnected || (busyWithdraw && !wrongChain) || (!wrongChain && activeBps < 1)}
            onClick={wrongChain ? () => switchChain({ chainId: TARGET_CHAIN_ID }) : handleWithdraw}
            className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: wrongChain ? 'rgba(172,198,233,0.2)' : 'rgba(232,109,122,0.15)', color: wrongChain ? 'var(--accent)' : 'var(--danger)', border: wrongChain ? '1px solid rgba(172,198,233,0.35)' : '1px solid rgba(232,109,122,0.3)' }}>
            {wrongChain
              ? `⇄ Switch to ${TARGET_CHAIN.name}`
              : busyWithdraw
                ? <span className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {withdrawPending ? 'Confirm in wallet…' : 'Processing…'}
                  </span>
                : `Withdraw ${(activeBps / 100).toFixed(activeBps % 100 === 0 ? 0 : 2)}% ${withdrawMode === 'usdc' ? 'as USDC' : 'as tokens'}`
            }
          </button>

          {withdrawHash && (
            <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, withdrawHash)} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs mt-2 justify-center" style={{ color: 'var(--danger)' }}>
              View withdraw tx <ExternalLink className="size-3" />
            </a>
          )}
        </>)}
      </div>

      {/* ── End left column ── */}
      </div>

      {/* ── Right column: Gateway ── */}
      <div>
        <GatewaySection
          onUsdcArrivedOnArc={(amt) => {
            const trimmed = parseFloat(amt).toFixed(6).replace(/\.?0+$/, '')
            setDepositAmt(trimmed)
            toast.success(`${parseFloat(amt).toFixed(2)} USDC arriving on Arc — deposit to basket!`, { duration: 6000 })
          }}
        />
      </div>

    </div>
  )
}
