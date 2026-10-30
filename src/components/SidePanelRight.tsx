/**
 * SidePanelRight — "Live on Arc Mainnet": pool liquidity, prices, explorer links.
 * Visible only on desktop (≥1280px), rendered via App.tsx.
 */
import { ExternalLink, Loader2 } from 'lucide-react'
import { TokenLogo } from './TokenLogo'
import { usePoolReserves } from '../hooks/useContracts'
import { getAddresses, TARGET_CHAIN_ID, MAINNET_ADDRESSES } from '../contracts'
import { formatUnits } from '../utils/format'
import { buildAddressExplorerUrl } from '@/onchain-facts'

const addrs = getAddresses(TARGET_CHAIN_ID)

// Explorer links — always Arc Mainnet addresses regardless of testnet flag
const EXPLORER = 'https://explorer.arc.io'
function explorerLink(addr: string) {
  return buildAddressExplorerUrl(TARGET_CHAIN_ID, addr) || `${EXPLORER}/address/${addr}`
}

const CONTRACTS = [
  { label: 'USDC/EURC Pool',     addr: MAINNET_ADDRESSES.POOL_USDC_EURC },
  { label: 'USDC/cirBTC Pool',   addr: MAINNET_ADDRESSES.POOL_USDC_BTC  },
  { label: 'Basket',             addr: MAINNET_ADDRESSES.BASKET  },
  { label: 'BasketStream',       addr: MAINNET_ADDRESSES.STREAM  },
] as const

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function SidePanelRight() {
  const { reserve0: eurcR0, reserve1: eurcR1, isLoading: eurcLoading } = usePoolReserves(addrs.POOL_USDC_EURC)
  const { reserve0: btcR0,  reserve1: btcR1,  isLoading: btcLoading  } = usePoolReserves(addrs.POOL_USDC_BTC)

  // USDC/EURC pool: reserve0=USDC (6 dec), reserve1=EURC (6 dec)
  // Price of 1 EURC in USDC = reserve0 / reserve1
  const eurcPriceUsdc: number = eurcR1 > 0n
    ? Number(eurcR0) / Number(eurcR1)
    : 0

  // USDC/cirBTC pool: reserve0=USDC (6 dec), reserve1=cirBTC (8 dec)
  // Price of 1 cirBTC in USDC = (reserve0 / 1e6) / (reserve1 / 1e8)
  const btcPriceUsdc: number = btcR1 > 0n
    ? (Number(btcR0) / 1e6) / (Number(btcR1) / 1e8)
    : 0

  // Total liquidity = USDC side of both pools + USDC value of EURC and cirBTC sides
  // EURC pool: reserve0=USDC (6 dec), reserve1=EURC (6 dec) — both same decimals, value≈1:1 at pool price
  // cirBTC pool: reserve0=USDC (6 dec), reserve1=cirBTC (8 dec)
  // Each pool's TVL = 2 × USDC reserve (AMM pools are balanced by definition at 50/50 value)
  const totalUsdcLiquidity = (eurcR0 * 2n) + (btcR0 * 2n)

  const loading = eurcLoading || btcLoading

  return (
    <div className="flex flex-col gap-4">
      {/* Live data card */}
      <div
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex items-center justify-between">
          <p className="section-label">
            Live on Arc Mainnet
          </p>
          {loading && <Loader2 className="size-3 animate-spin" style={{ color: 'var(--subtle)' }} />}
        </div>

        {/* Total liquidity */}
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Total pool liquidity</span>
          <div className="flex items-center gap-1.5">
            <TokenLogo token="USDC" size={16} />
            <span className="display text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {loading ? '—' : formatUnits(totalUsdcLiquidity, 6, 2)}
            </span>
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        </div>

        <div className="h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />

        {/* EURC price */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TokenLogo token="EURC" size={16} />
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>EURC</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm tabular-nums font-semibold" style={{ color: 'var(--ink)' }}>
              {loading ? '—' : eurcPriceUsdc.toFixed(4)}
            </span>
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        </div>

        {/* cirBTC price */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TokenLogo token="CIRBTC" size={16} />
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>cirBTC</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm tabular-nums font-semibold" style={{ color: 'var(--ink)' }}>
              {loading ? '—' : btcPriceUsdc >= 1000
                ? btcPriceUsdc.toLocaleString('en-US', { maximumFractionDigits: 0 })
                : btcPriceUsdc.toFixed(2)
              }
            </span>
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        </div>
      </div>

      {/* Contract links */}
      <div
        className="rounded-2xl p-4 flex flex-col gap-2"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <p className="section-label mb-1">
          Contracts
        </p>
        {CONTRACTS.map(({ label, addr }) => (
          <a
            key={addr}
            href={explorerLink(addr)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between group py-1"
          >
            <span className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>{label}</span>
            <div className="flex items-center gap-1">
              <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>{shortAddr(addr)}</span>
              <ExternalLink className="size-3 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--subtle)' }} />
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
