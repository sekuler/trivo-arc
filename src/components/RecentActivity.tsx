/**
 * RecentActivity — local transaction history for the connected wallet.
 * Entries are saved to localStorage by each tab on confirmation.
 * No onchain log scanning — purely local, instant, no RPC calls.
 */

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import { IS_MAINNET, TARGET_CHAIN_ID, MAINNET_ADDRESSES } from '../contracts'
import { loadActivity, type ActivityEntry } from '../hooks/useActivity'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { useRefresh } from '../context/RefreshContext'

const glass = {
  card:  { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px' },
} as const

const TYPE_COLOR: Record<string, string> = {
  'Deposit':          'var(--success)',
  'Withdraw':         'var(--danger)',
  'Swap':             'var(--accent)',
  'Add Liquidity':    'var(--success)',
  'Remove Liquidity': 'var(--danger)',
  'Stream':           'var(--accent)',
  'Move to Basket':   'var(--success)',
  'Stop Stream':      'var(--muted)',
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function RecentActivity() {
  const { address, isConnected } = useAccount()
  const { refreshKey } = useRefresh()
  const [items, setItems] = useState<ActivityEntry[]>([])
  const [, setTick] = useState(0)

  // Load from localStorage whenever address or refreshKey changes
  // (deferred to avoid setState-in-effect lint; refreshKey fires after every confirmed tx)
  useEffect(() => {
    const t = setTimeout(() => {
      setItems(address ? loadActivity(address) : [])
    }, 0)
    return () => clearTimeout(t)
  }, [address, refreshKey])

  // Re-render time-ago labels every minute
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // Explorer links for the two main contracts (Arc Mainnet only)
  const basketAddr = MAINNET_ADDRESSES.BASKET
  const streamAddr = MAINNET_ADDRESSES.STREAM
  const explorerChain = IS_MAINNET ? TARGET_CHAIN_ID : TARGET_CHAIN_ID

  return (
    <div style={glass.card} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
          Recent Activity
        </span>
      </div>

      {/* Empty state */}
      {(!isConnected || items.length === 0) && (
        <p className="text-xs text-center py-3" style={{ color: 'var(--subtle)' }}>
          No activity yet. Your deposits, swaps and streams will appear here.
        </p>
      )}

      {/* Activity list */}
      {items.length > 0 && (
        <div className="space-y-2 mb-4">
          {items.map((item) => (
            <div key={item.id} style={glass.inner}
              className="flex items-center justify-between px-3 py-2.5 gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate"
                  style={{ color: TYPE_COLOR[item.type] ?? 'var(--ink-2)' }}>
                  {item.desc}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {timeAgo(item.timestamp)}
                </div>
              </div>
              <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, item.txHash as `0x${string}`)}
                target="_blank" rel="noreferrer"
                className="shrink-0 flex items-center gap-1 text-xs font-medium"
                style={{ color: 'var(--accent)' }}>
                View <ExternalLink className="size-3" />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* "View all onchain activity" footer links */}
      <div className="flex items-center gap-3 flex-wrap pt-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>View all onchain activity:</span>
        <a href={buildAddressExplorerUrl(explorerChain, basketAddr)}
          target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-xs font-medium"
          style={{ color: 'var(--accent)' }}>
          Basket contract <ExternalLink className="size-3" />
        </a>
        <a href={buildAddressExplorerUrl(explorerChain, streamAddr)}
          target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-xs font-medium"
          style={{ color: 'var(--accent)' }}>
          BasketStream contract <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}
