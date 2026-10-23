/**
 * TokenLogo — shows the official logo for USDC, EURC, or cirBTC.
 * All three use the binary PNG files in public/logos/.
 */

export type TokenKey = 'USDC' | 'EURC' | 'CIRBTC'

const LOGOS: Record<TokenKey, string> = {
  USDC:   '/logos/usdc.png',
  EURC:   '/logos/eurc.png',
  CIRBTC: '/logos/cirbtc.png',
}

const ALT: Record<TokenKey, string> = {
  USDC:   'USDC',
  EURC:   'EURC',
  CIRBTC: 'cirBTC',
}

interface Props {
  token: TokenKey
  size?: number
  className?: string
}

export function TokenLogo({ token, size = 20, className = '' }: Props) {
  return (
    <img
      src={LOGOS[token]}
      alt={ALT[token]}
      width={size}
      height={size}
      style={{ width: size, height: size, flexShrink: 0 }}
      className={`rounded-full object-cover ${className}`}
    />
  )
}
