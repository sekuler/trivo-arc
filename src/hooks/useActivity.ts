/**
 * useActivity — localStorage-backed Trivo transaction history.
 * Keyed by wallet address, newest-first, capped at 20 entries per wallet.
 * All reads/writes are wrapped in try/catch so the app works if storage is blocked.
 */

const MAX_ENTRIES = 20
const STORAGE_KEY = 'trivo_activity'

export interface ActivityEntry {
  id:        string   // unique: `${txHash}-${type}`
  type:      string   // 'Deposit' | 'Withdraw' | 'Swap' | 'Add Liquidity' | 'Remove Liquidity' | 'Stream' | 'Move to Basket' | 'Stop Stream'
  desc:      string   // short human-readable description with amounts/tokens
  txHash:    string
  timestamp: number   // Date.now() ms
}

function storageKey(address: string): string {
  return `${STORAGE_KEY}_${address.toLowerCase()}`
}

export function loadActivity(address: string): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(address))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as ActivityEntry[]
  } catch {
    return []
  }
}

export function saveActivity(address: string, entry: ActivityEntry): void {
  try {
    const existing = loadActivity(address)
    // Deduplicate by id
    const filtered = existing.filter((e) => e.id !== entry.id)
    // Prepend newest, cap at MAX_ENTRIES
    const updated = [entry, ...filtered].slice(0, MAX_ENTRIES)
    localStorage.setItem(storageKey(address), JSON.stringify(updated))
  } catch {
    // Storage blocked or full — fail silently
  }
}
