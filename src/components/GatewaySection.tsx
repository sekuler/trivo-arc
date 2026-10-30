/**
 * GatewaySection — deposit USDC from any supported chain into Circle
 * Gateway's unified balance, then move it to Arc and deposit into the basket.
 *
 * Uses @circle-fin/unified-balance-kit with the EIP-1193 browser-wallet adapter.
 * No kit key is required for unified-balance operations.
 *
 * Kit chain identifiers come from the published @circle-fin/unified-balance-kit
 * package (verified by inspecting index.cjs for string literals).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { UnifiedBalanceKit } from '@circle-fin/unified-balance-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import { Loader2, AlertCircle, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { TARGET_CHAIN_ID, IS_MAINNET } from '../contracts'

// ── Chain metadata ─────────────────────────────────────────────────────────────
// Kit identifiers verified from @circle-fin/unified-balance-kit index.cjs string literals.
// Chain IDs from onchain-facts.ts (the Arc Studio generated registry).
const MAINNET_GATEWAY_CHAINS = [
  { label: 'Arc',       chainId: 5042,  kitId: 'Arc'       as const, instant: true,  explorer: 'https://explorer.arc.io/tx/' },
  { label: 'Base',      chainId: 8453,  kitId: 'Base'      as const, instant: false, explorer: 'https://basescan.org/tx/' },
  { label: 'Ethereum',  chainId: 1,     kitId: 'Ethereum'  as const, instant: false, explorer: 'https://etherscan.io/tx/' },
  { label: 'Arbitrum',  chainId: 42161, kitId: 'Arbitrum'  as const, instant: false, explorer: 'https://arbiscan.io/tx/' },
  { label: 'Avalanche', chainId: 43114, kitId: 'Avalanche' as const, instant: false, explorer: 'https://snowtrace.io/tx/' },
] as const

const TESTNET_GATEWAY_CHAINS = [
  { label: 'Arc Testnet',       chainId: 5042002, kitId: 'Arc_Testnet'       as const, instant: true,  explorer: 'https://explorer.testnet.arc.io/tx/' },
  { label: 'Base Sepolia',      chainId: 84532,   kitId: 'Base_Sepolia'      as const, instant: false, explorer: 'https://sepolia.basescan.org/tx/' },
  { label: 'Ethereum Sepolia',  chainId: 11155111, kitId: 'Ethereum_Sepolia' as const, instant: false, explorer: 'https://sepolia.etherscan.io/tx/' },
  { label: 'Arbitrum Sepolia',  chainId: 421614,  kitId: 'Arbitrum_Sepolia'  as const, instant: false, explorer: 'https://sepolia.arbiscan.io/tx/' },
  { label: 'Avalanche Fuji',    chainId: 43113,   kitId: 'Avalanche_Fuji'    as const, instant: false, explorer: 'https://testnet.snowtrace.io/tx/' },
] as const

type MainnetChain = (typeof MAINNET_GATEWAY_CHAINS)[number]
type TestnetChain = (typeof TESTNET_GATEWAY_CHAINS)[number]
type GatewayChain = MainnetChain | TestnetChain

const GATEWAY_CHAINS: readonly GatewayChain[] = IS_MAINNET ? MAINNET_GATEWAY_CHAINS : TESTNET_GATEWAY_CHAINS
const ARC_KIT_ID = IS_MAINNET ? 'Arc' : 'Arc_Testnet'
const NETWORK_TYPE = IS_MAINNET ? 'mainnet' : 'testnet'
const ARC_LABEL = IS_MAINNET ? 'Arc' : 'Arc Testnet'

// Singleton kit instance — no kit key needed for unified-balance operations
const kit = new UnifiedBalanceKit()

const glass = {
  card:  { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

type Step =
  | 'idle'
  | 'switching'
  | 'depositing'
  | 'deposited'
  | 'spending'
  | 'spent'

interface GatewayBalance {
  total: string
  byChain: { chain: string; balance: string }[]
}

interface GatewaySectionProps {
  onUsdcArrivedOnArc: (amount: string) => void
}

export function GatewaySection({ onUsdcArrivedOnArc }: GatewaySectionProps) {
  const { address, chainId, isConnected, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()

  // Default to first non-Arc chain in the list
  const defaultSrc = GATEWAY_CHAINS.find(c => c.chainId !== TARGET_CHAIN_ID) ?? GATEWAY_CHAINS[0]
  const [srcChain,   setSrcChain]   = useState<GatewayChain>(defaultSrc)
  const [amount,     setAmount]     = useState('')
  const [step,       setStep]       = useState<Step>('idle')
  const [error,      setError]      = useState<string | null>(null)
  const [depositTx,  setDepositTx]  = useState<string | null>(null)
  const [spendTx,    setSpendTx]    = useState<string | null>(null)
  const [gwBalance,  setGwBalance]  = useState<GatewayBalance | null>(null)
  const [balLoading, setBalLoading] = useState(false)

  const getAdapter = useCallback(async (requiredChainId: number) => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== requiredChainId) {
      setStep('switching')
      await switchChainAsync({ chainId: requiredChainId })
    }
    const provider = (await connector.getProvider()) as EIP1193Provider
    return createViemAdapterFromProvider({ provider })
  }, [connector, chainId, switchChainAsync])

  const fetchBalance = useCallback(async () => {
    if (!address) return
    setBalLoading(true)
    try {
      const res = await kit.getBalances({
        sources: { address },
        networkType: NETWORK_TYPE,
      })
      const byChain: { chain: string; balance: string }[] = []
      for (const account of res.breakdown) {
        for (const entry of account.breakdown) {
          if (parseFloat(entry.confirmedBalance) > 0) {
            byChain.push({ chain: entry.chain, balance: entry.confirmedBalance })
          }
        }
      }
      setGwBalance({ total: res.totalConfirmedBalance, byChain })
    } catch {
      // non-critical
    } finally {
      setBalLoading(false)
    }
  }, [address])

  const fetchBalanceRef = useRef(fetchBalance)
  useEffect(() => { fetchBalanceRef.current = fetchBalance }, [fetchBalance])

  useEffect(() => {
    if (!isConnected) return
    const initial = setTimeout(() => { void fetchBalanceRef.current() }, 0)
    const id = setInterval(() => { void fetchBalanceRef.current() }, 12_000)
    return () => { clearTimeout(initial); clearInterval(id) }
  }, [isConnected])

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return
    setError(null); setDepositTx(null); setSpendTx(null)
    try {
      const adapter = await getAdapter(srcChain.chainId)
      setStep('depositing')
      const result = await kit.deposit({
        from: { adapter, chain: srcChain.kitId },
        amount,
        allowanceStrategy: 'authorize',
      })
      setDepositTx(result.txHash ?? null)
      setStep('deposited')
      void fetchBalance()
      setAmount('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('idle')
    }
  }

  const handleSpend = async (spendAmount: string, allocationChain: string) => {
    if (!address) return
    setError(null); setSpendTx(null)
    const chainMeta = GATEWAY_CHAINS.find(c => c.kitId === allocationChain)
    if (!chainMeta) { setError(`Unknown chain: ${allocationChain}`); return }
    try {
      const adapter = await getAdapter(chainMeta.chainId)
      setStep('spending')
      const result = await kit.spend({
        from: {
          adapter,
          allocations: { amount: spendAmount, chain: chainMeta.kitId },
        },
        to: {
          chain:            ARC_KIT_ID,
          recipientAddress: address,
          useForwarder:     true,
        },
        amount: spendAmount,
      })
      setSpendTx(result.txHash ?? null)
      setStep('spent')
      void fetchBalance()
      onUsdcArrivedOnArc(spendAmount)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('idle')
    }
  }

  const busy    = step !== 'idle' && step !== 'deposited' && step !== 'spent'
  const isArcSrc = srcChain.chainId === TARGET_CHAIN_ID

  return (
    <div style={glass.card} className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
          Deposit from any chain
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)', border: '1px solid rgba(172,198,233,0.25)' }}>
          Circle Gateway
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
        Deposit USDC from {IS_MAINNET
          ? 'Base, Ethereum, Arbitrum or Avalanche'
          : 'Base Sepolia, Ethereum Sepolia, Arbitrum Sepolia or Avalanche Fuji'
        } into a unified balance — then move it to {ARC_LABEL} in one click and deposit into your basket.
      </p>

      {/* ── Unified Gateway balance ── */}
      <div style={glass.inner} className="p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>Your Gateway balance</span>
          <button onClick={() => { void fetchBalance() }} disabled={balLoading}
            className="flex items-center gap-1 text-xs disabled:opacity-40"
            style={{ color: 'var(--accent)' }}>
            <RefreshCw className={`size-3 ${balLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {!isConnected ? (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>Connect wallet to see balance</p>
        ) : balLoading && !gwBalance ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <Loader2 className="size-3 animate-spin" /> Loading…
          </div>
        ) : gwBalance ? (
          <>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {parseFloat(gwBalance.total).toFixed(2)}
              </span>
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
            </div>
            {gwBalance.byChain.length > 0 ? (
              <div className="space-y-1.5">
                {gwBalance.byChain.map(({ chain, balance }) => {
                  const label = GATEWAY_CHAINS.find(c => c.kitId === chain)?.label ?? chain
                  const chainMeta = GATEWAY_CHAINS.find(c => c.kitId === chain)
                  return (
                    <div key={chain} className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="display text-xs tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
                          {parseFloat(balance).toFixed(4)} USDC
                        </span>
                        {chain !== ARC_KIT_ID && chainMeta && parseFloat(balance) > 0 && (
                          <button
                            disabled={busy}
                            onClick={() => { void handleSpend(balance, chain) }}
                            className="text-xs px-2 py-0.5 rounded-lg font-semibold disabled:opacity-40 transition-colors chip-brand">
                            Move to {ARC_LABEL} →
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>No Gateway balance yet</p>
            )}
          </>
        ) : (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>—</p>
        )}
      </div>

      {/* ── Source chain selector ── */}
      <div className="mb-3">
        <span className="text-xs mb-2 block" style={{ color: 'var(--subtle)' }}>Deposit from</span>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {GATEWAY_CHAINS.filter(c => c.chainId !== TARGET_CHAIN_ID).map((c) => (
            <button key={c.chainId}
              onClick={() => setSrcChain(c)}
              className="py-2 px-2.5 rounded-xl text-xs font-semibold transition-colors text-left"
              style={{
                background: srcChain.chainId === c.chainId ? 'rgba(172,198,233,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${srcChain.chainId === c.chainId ? 'rgba(172,198,233,0.4)' : 'rgba(255,255,255,0.09)'}`,
                color: srcChain.chainId === c.chainId ? 'var(--accent)' : 'var(--muted)',
              }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timing notice */}
      {!isArcSrc && !srcChain.instant && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(172,198,233,0.06)', border: '1px solid rgba(172,198,233,0.15)', color: 'var(--accent)' }}>
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span>
            Deposits from <strong>{srcChain.label}</strong> typically take <strong>15–20 minutes</strong> to be
            credited to your Gateway balance. The balance card above will update automatically.
          </span>
        </div>
      )}

      {/* ── Amount input ── */}
      <div style={glass.inner} className="px-4 py-3 mb-3">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '')
            if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
          }}
          className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-20"
          style={{ color: 'var(--ink)' }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC on {srcChain.label}</span>
        </div>
      </div>

      {/* Step status */}
      {step === 'switching' && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
          <Loader2 className="size-3.5 animate-spin shrink-0" />
          <span>Switching wallet to {srcChain.label}…</span>
        </div>
      )}
      {step === 'depositing' && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
          <Loader2 className="size-3.5 animate-spin shrink-0" />
          <span>Depositing {amount} USDC into Gateway from {srcChain.label}… Sign in your wallet.</span>
        </div>
      )}
      {step === 'deposited' && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
          <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
          <span>
            Deposit confirmed!
            {srcChain.instant
              ? ' Your Gateway balance should update shortly.'
              : ' Your Gateway balance will update in 15–20 minutes.'}
            {' '}Use the <strong>Move to {ARC_LABEL} →</strong> button above once credited.
          </span>
        </div>
      )}
      {step === 'spending' && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.18)', color: 'var(--accent)' }}>
          <Loader2 className="size-3.5 animate-spin shrink-0" />
          <span>Moving USDC to {ARC_LABEL} via Circle's Forwarding Service… Sign in your wallet.</span>
        </div>
      )}
      {step === 'spent' && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(86,201,130,0.08)', border: '1px solid rgba(86,201,130,0.18)', color: 'var(--success)' }}>
          <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
          <span>
            USDC is arriving on {ARC_LABEL}! The <strong>Deposit USDC</strong> section has been
            pre-filled — review and confirm your basket deposit.
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-xl mb-3"
          style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.18)', color: 'var(--danger)' }}>
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Deposit button */}
      <button
        disabled={!isConnected || busy || !amount || parseFloat(amount) <= 0}
        onClick={() => { void handleDeposit() }}
        className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 btn-brand">
        {busy && (step === 'switching' || step === 'depositing')
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />
              {step === 'switching' ? 'Switching chain…' : 'Depositing…'}</span>
          : `Deposit ${amount || '0'} USDC from ${srcChain.label} into Gateway`
        }
      </button>

      {/* Explorer links */}
      <div className="space-y-1 mt-2">
        {depositTx && (
          <a href={`${srcChain.explorer}${depositTx}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs justify-center" style={{ color: 'var(--accent)' }}>
            View deposit tx <ExternalLink className="size-3" />
          </a>
        )}
        {spendTx && (
          <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, spendTx)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs justify-center" style={{ color: 'var(--accent)' }}>
            View {ARC_LABEL} tx <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}
