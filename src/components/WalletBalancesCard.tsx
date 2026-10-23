import { useAccount } from 'wagmi'
import { Loader2 } from 'lucide-react'
import { useTokenBalances } from '../hooks/useContracts'
import { formatUnits, formatUsd } from '../utils/format'
import { TokenLogo, type TokenKey } from './TokenLogo'

const TOKENS: { key: TokenKey; label: string; decimals: number; digits: number }[] = [
  { key: 'USDC',   label: 'USDC',   decimals: 6, digits: 2 },
  { key: 'EURC',   label: 'EURC',   decimals: 6, digits: 2 },
  { key: 'CIRBTC', label: 'cirBTC', decimals: 8, digits: 8 },
]

export function WalletBalancesCard() {
  const { isConnected } = useAccount()
  const { usdc, eurc, cirBtc, isLoading } = useTokenBalances()

  if (!isConnected) return null

  const values = { USDC: usdc, EURC: eurc, CIRBTC: cirBtc }

  return (
    <div
      className="max-w-xl mx-auto px-4 mb-3"
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
            {TOKENS.map(({ key, label, decimals, digits }) => {
              const raw = values[key] ?? 0n
              const formatted = decimals === 6
                ? formatUsd(raw, decimals)
                : formatUnits(raw, decimals, digits)
              return (
                <div key={key} className="flex items-center gap-1.5 shrink-0">
                  <TokenLogo token={key} size={14} />
                  <span className="text-xs tabular-nums font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
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
