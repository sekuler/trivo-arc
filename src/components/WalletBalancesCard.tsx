import { useAccount } from 'wagmi'
import { Loader2 } from 'lucide-react'
import { useTokenBalances } from '../hooks/useContracts'
import { formatUnits, formatUsd } from '../utils/format'
import { TOKEN_META } from '../contracts'

const TOKENS = [
  { key: 'USDC',   label: 'USDC',   decimals: 6, digits: 2, colorKey: 'USDC'   },
  { key: 'EURC',   label: 'EURC',   decimals: 6, digits: 2, colorKey: 'EURC'   },
  { key: 'CIRBTC', label: 'cirBTC', decimals: 8, digits: 6, colorKey: 'CIRBTC' },
] as const

export function WalletBalancesCard() {
  const { isConnected } = useAccount()
  const { usdc, eurc, cirBtc, isLoading } = useTokenBalances()

  if (!isConnected) return null

  const values = { USDC: usdc, EURC: eurc, CIRBTC: cirBtc }

  return (
    <div
      className="max-w-md mx-auto px-4 mb-3"
    >
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-2xl"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
        }}
      >
        <span className="text-xs font-semibold tracking-widest uppercase mr-1" style={{ color: 'var(--subtle)' }}>
          Wallet
        </span>
        {isLoading ? (
          <Loader2 className="size-3 animate-spin" style={{ color: 'var(--subtle)' }} />
        ) : (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {TOKENS.map(({ key, label, decimals, digits, colorKey }) => {
              const raw = values[key] ?? 0n
              const formatted = decimals === 6
                ? formatUsd(raw, decimals)
                : formatUnits(raw, decimals, digits)
              return (
                <div key={key} className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="size-2 rounded-full flex-shrink-0"
                    style={{ background: TOKEN_META[colorKey].color }}
                  />
                  <span className="text-xs tabular-nums font-semibold truncate" style={{ color: 'var(--ink)' }}>
                    {formatted}
                  </span>
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--subtle)' }}>
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
