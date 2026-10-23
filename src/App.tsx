import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { BasketTab } from './components/BasketTab'
import { SwapTab } from './components/SwapTab'
import { PoolTab } from './components/PoolTab'
import { StreamTab } from './components/StreamTab'
import { WalletBalancesCard } from './components/WalletBalancesCard'
import { IS_MAINNET } from './contracts'

type Tab = 'basket' | 'swap' | 'pool' | 'stream'

const TABS: { id: Tab; label: string }[] = [
  { id: 'basket', label: 'Basket' }, // tab label kept as "Basket" — just the nav item
  { id: 'stream', label: 'Stream' },
  { id: 'swap',   label: 'Swap'   },
  { id: 'pool',   label: 'Pool'   },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('basket')
  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b" style={{ background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Logo mark */}
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

      {/* Wallet balances — visible on all tabs */}
      <div className="pt-3">
        <WalletBalancesCard />
      </div>

      {/* Tab nav — narrow container, always centered */}
      <div className="max-w-md mx-auto px-4">
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

      {/* Tab content — basket gets a wider container for two-column layout */}
      <div className={`mx-auto px-4 pb-10 ${tab === 'basket' ? 'max-w-5xl' : 'max-w-md'}`}>
        {tab === 'basket' && <BasketTab />}
        {tab === 'stream' && <StreamTab />}
        {tab === 'swap'   && <SwapTab />}
        {tab === 'pool'   && <PoolTab />}
      </div>
    </div>
  )
}
