/**
 * Contract addresses and ABIs for Basket DeFi on Arc.
 * Testnet addresses are live. Mainnet addresses must be filled after your own deploy.
 */

import basketPoolAbi  from './abis/BasketPool.json'
import basketAbi      from './abis/Basket.json'
import streamAbi      from './abis/BasketStream.json'

export const BASKET_POOL_ABI   = basketPoolAbi
export const BASKET_ABI        = basketAbi
export const BASKET_STREAM_ABI = streamAbi

// GAS is kept only as an emergency fallback — dynamic estimation via
// estimateGas() in src/estimateGas.ts is used at call sites instead.
export const GAS_FALLBACK = {
  approve:         100_000n,
  addLiquidity:    400_000n,
  removeLiquidity: 300_000n,
  swap:            300_000n,
  deposit:         900_000n,
  withdraw:        700_000n,
  withdrawPartial: 700_000n,
  setAlloc:        100_000n,
  startStream:     300_000n,
  moveToBasket:  1_000_000n,
  stopStream:    1_000_000n,
} as const

// ─── Arc Testnet (chain ID 5042002) ───────────────────────────────────────────
export const TESTNET_ADDRESSES = {
  USDC:          '0x3600000000000000000000000000000000000000' as const,
  EURC:          '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const,
  CIRBTC:        '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as const,
  POOL_USDC_EURC:'0x835d2827ab94d3c7be8677af6d0f15fdf720be83' as const,
  POOL_USDC_BTC: '0xa39f874578e230027acb98afaa384a661fe365c7' as const,
  BASKET:        '0x96d61dbd1284c5eb028415da3258ec8227b1a204' as const,
  STREAM:        '0x11ed969fcc6a262791838b38fd9f54a35d7d760e' as const,
} as const

// ─── Mainnet stream — fill after deploy ──────────────────────────────────────
// MAINNET_STREAM: '0x0000000000000000000000000000000000000000'

// ─── Arc Mainnet (chain ID 5042) — REPLACE after you deploy ──────────────────
// Deploy with: scripts/deploy-mainnet.sh (see contracts/script/)
export const MAINNET_ADDRESSES = {
  USDC:          '0x3600000000000000000000000000000000000000' as const,
  EURC:          '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1' as const,
  CIRBTC:        '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0' as const,
  POOL_USDC_EURC:'0x793b6115b9EF8049e9E3643660E15D8a3028C25C' as const,
  POOL_USDC_BTC: '0xBb97d774C019b138250245794092E9a511E35449' as const,
  BASKET:        '0x104b0f1b643f642E1cAf264a85B1B105503f3dB5' as const,
  STREAM:        '0x014289eB4de7C172Ea11F6CBFEB1215f598A7eb0' as const,
} as const

import { arcTestnet, arc } from 'viem/chains'

// Mainnet is the default for public builds.
// Set VITE_MAINNET=false in .env to switch to Arc Testnet (chain ID 5042002).
export const IS_MAINNET = import.meta.env.VITE_MAINNET !== 'false'
export const TARGET_CHAIN_ID = IS_MAINNET ? arc.id : arcTestnet.id
export const TARGET_CHAIN    = IS_MAINNET ? arc     : arcTestnet

export function getAddresses(chainId: number) {
  if (chainId === 5042) return MAINNET_ADDRESSES
  return TESTNET_ADDRESSES
}

export const TOKEN_META: Record<string, { symbol: string; decimals: number; color: string }> = {
  USDC:   { symbol: 'USDC',   decimals: 6, color: '#2775CA' },
  EURC:   { symbol: 'EURC',   decimals: 6, color: '#0066cc' },
  CIRBTC: { symbol: 'cirBTC', decimals: 8, color: '#F7931A' },
}
