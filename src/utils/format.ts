export function formatUnits(value: bigint, decimals: number, digits = 4): string {
  if (value === 0n) return '0.00'
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const frac = value % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, digits)
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fracStr.replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${trimmed}`
}

export function parseUnitsStrict(value: string, decimals: number): bigint {
  if (!value || value === '') return 0n
  const [whole, frac = ''] = value.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}

export function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatUsd(value: bigint, decimals = 6): string {
  const f = formatUnits(value, decimals, 2)
  const [w, d] = f.split('.')
  const withCommas = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${withCommas}.${d ?? '00'}`
}

export function slippageFactor(bps: number) {
  // e.g. 50 bps = 0.5% slippage → multiply output by (10000 - 50) / 10000
  return (n: bigint) => (n * BigInt(10000 - bps)) / 10000n
}

// Deadline: now + minutes in seconds
export function deadline(minutes = 20): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60)
}

/**
 * Uniswap V2 getAmountOut (0.3% fee).
 * Duplicated here so BasketTab can import without depending on SwapTab.
 */
export function ammGetQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const fee = amountIn * 997n
  return (fee * reserveOut) / (reserveIn * 1000n + fee)
}

/**
 * Price impact in basis points (100 = 1%).
 * impact = 1 – quoted / spot, where spot = amountIn * reserveOut / reserveIn (no fee).
 */
export function calcPriceImpactBps(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0
  const quoted = ammGetQuote(amountIn, reserveIn, reserveOut)
  const spotScaled = (amountIn * reserveOut * 1_000_000n) / reserveIn
  if (spotScaled === 0n) return 0
  const quotedScaled = quoted * 1_000_000n
  return Math.max(0, Number((spotScaled - quotedScaled) * 10_000n / spotScaled))
}
