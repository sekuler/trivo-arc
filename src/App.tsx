import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { BasketTab } from './components/BasketTab'
import { SwapTab } from './components/SwapTab'
import { PoolTab } from './components/PoolTab'
import { StreamTab } from './components/StreamTab'
import { WalletBalancesCard } from './components/WalletBalancesCard'
import { RecentActivity } from './components/RecentActivity'
import { SidePanelLeft } from './components/SidePanelLeft'
import { SidePanelRight } from './components/SidePanelRight'
import { IS_MAINNET } from './contracts'

type Tab = 'basket' | 'swap' | 'pool' | 'stream'

const TABS: { id: Tab; label: string }[] = [
  { id: 'basket', label: 'Basket' },
  { id: 'stream', label: 'Stream' },
  { id: 'swap',   label: 'Swap'   },
  { id: 'pool',   label: 'Pool'   },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('basket')
  return (
    <div className="min-h-dvh relative overflow-x-hidden" style={{ background: 'var(--bg-gradient)' }}>

      {/* ── Animated background glow ─────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* USDC blue — top-left */}
        <div className="glow-orb glow-usdc" />
        {/* EURC purple/blue — top-right */}
        <div className="glow-orb glow-eurc" />
        {/* cirBTC violet — bottom-center */}
        <div className="glow-orb glow-cirbtc" />
      </div>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b" style={{ background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="max-w-[1440px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-7 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #acc6e9 0%, #5b8fc4 100%)' }}>
              <span className="display text-xs font-bold text-white">T</span>
            </div>
            <span className="display text-base font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Trivo Arc</span>
            <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{
              background: IS_MAINNET ? 'rgba(172,198,233,0.12)' : 'rgba(141,216,159,0.12)',
              color: IS_MAINNET ? 'var(--accent)' : 'var(--success)',
            }}>
              {IS_MAINNET ? 'Mainnet' : 'Testnet'}
            </span>
          </div>
          <ConnectKitButton />
        </div>
      </header>

      {/* ── Page body ────────────────────────────────────────────────── */}
      <div className="relative z-10 max-w-[1440px] mx-auto px-4">

        {/* Wallet balances — full row, above columns */}
        <div className="pt-3 pb-1">
          <WalletBalancesCard />
        </div>

        {/* Three-column layout — side panels appear only at ≥1280px */}
        <div className="flex gap-6 items-start pt-2">

          {/* Left panel */}
          <aside className="hidden xl:flex xl:flex-col w-60 shrink-0 sticky top-20 gap-4">
            <SidePanelLeft />
          </aside>

          {/* Centre */}
          <main className="flex-1 min-w-0 pb-10">
            {/* Tab nav */}
            <div className="max-w-md mx-auto">
              <div className="flex gap-1 p-1 rounded-2xl mb-4" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)' }}>
                {TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: tab === id ? 'rgba(172,198,233,0.15)' : 'transparent',
                      color: tab === id ? 'var(--accent)' : 'var(--subtle)',
                      border: tab === id ? '1px solid rgba(172,198,233,0.25)' : '1px solid transparent',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content — basket is wider to fit two-column gateway layout */}
            <div className={`mx-auto ${tab === 'basket' ? 'max-w-2xl' : 'max-w-md'}`}>
              {tab === 'basket' && <BasketTab />}
              {tab === 'stream' && <StreamTab />}
              {tab === 'swap'   && <SwapTab />}
              {tab === 'pool'   && <PoolTab />}
            </div>

            {/* Recent activity */}
            <div className="max-w-md mx-auto mt-4">
              <RecentActivity />
            </div>
          </main>

          {/* Right panel */}
          <aside className="hidden xl:flex xl:flex-col w-60 shrink-0 sticky top-20 gap-4">
            <SidePanelRight />
          </aside>

        </div>
      </div>
    </div>
  )
}
