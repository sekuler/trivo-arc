export function formatUnits(value: bigint, decimals: number, digits = 4): string {
  if (value === 0n) return '0.00'
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const frac = value % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, digits)
  return `${whole}.${fracStr}`
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
