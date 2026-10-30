/**
 * SidePanelLeft — "How Trivo works" explainer + Arc branding.
 * Visible only on desktop (≥1280px), rendered via App.tsx.
 */
import { TokenLogo } from './TokenLogo'

const STEPS = [
  {
    num: '01',
    title: 'Deposit USDC',
    body: 'Send any amount of USDC from your wallet into the basket.',
  },
  {
    num: '02',
    title: 'Split automatically',
    body: 'Your USDC is swapped into USDC, EURC, and cirBTC according to your allocation (default 40 / 30 / 30).',
  },
  {
    num: '03',
    title: 'Withdraw anytime',
    body: 'Take back your full position or any percentage — as USDC or as the underlying tokens.',
  },
]

export function SidePanelLeft() {
  return (
    <div className="flex flex-col gap-4">
      {/* How it works card */}
      <div
        className="rounded-2xl p-5 flex flex-col gap-5"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <p className="section-label">
          How Trivo works
        </p>

        <div className="flex flex-col gap-4">
          {STEPS.map((s) => (
            <div key={s.num} className="flex gap-3">
              <span
                className="display text-xs font-bold shrink-0 mt-0.5 tabular-nums"
                style={{ color: 'var(--accent)', opacity: 0.7 }}
              >
                {s.num}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{s.title}</p>
                <p className="text-xs leading-relaxed text-pretty" style={{ color: 'var(--subtle)' }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Token trio */}
        <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Holds</span>
          <div className="flex items-center gap-1.5">
            <TokenLogo token="USDC"   size={18} />
            <TokenLogo token="EURC"   size={18} />
            <TokenLogo token="CIRBTC" size={18} />
          </div>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC · EURC · cirBTC</span>
        </div>
      </div>

      {/* Built on Arc */}
      <div
        className="rounded-2xl px-5 py-4 flex items-center gap-3"
        style={{
          background: 'rgba(172,198,233,0.06)',
          border: '1px solid rgba(172,198,233,0.12)',
        }}
      >
        <img
          src="/logos/arc.png"
          alt="Arc"
          width={24}
          height={24}
        />
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Built on Arc</p>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>USDC as native gas · sub-second finality</p>
        </div>
      </div>
    </div>
  )
}
