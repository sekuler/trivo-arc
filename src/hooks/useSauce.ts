/**
 * useSauce — Sauce SDK integration for the browser.
 *
 * Compiles conditionalBasket.sauce.ts and withdrawFromPot.sauce.ts once,
 * using the SDK's `routes.compileSauceProgram` with a resolve callback
 * that serves the ABI JSON files from memory (imported as JS modules by Vite).
 *
 * Exports:
 *  - compiled: the two compiled programs (null until ready)
 *  - sauceReady: true once WASM loaded + both programs compiled
 *  - sauceError: compile/load error string
 *  - buildConditionalBuyCall: builds the cook call for the conditional deposit
 *  - buildWithdrawCall: builds the cook call for withdrawing all Pot USDC
 *  - KITCHEN: Kitchen contract address
 *  - ENGINE: Engine contract address
 */

import { useEffect, useState } from 'react'
import {
  DEFAULT_POT_SALT,
  kitchenExecutionFee,
  ready,
  routes,
  v12PredictPot,
} from '@eco-incorp/sauce'

import { v12EngineAddress, v12KitchenAddress } from '@eco-incorp/sauce/deployments'
import { bytesToHex, concatHex, type Hex } from 'viem'

// ABI JSON files imported by Vite — used as the resolve callback for the Sauce compiler
import basketPoolAbiJson from '../sauce/BasketPool.abi.json'
import basketAbiJson     from '../sauce/Basket.abi.json'

// conditionalBasket source from the shared string-constant module (same source
// the API route compiles server-side, ensuring bytecode identity)
import { CONDITIONAL_BASKET_SOURCE } from '../sauce/conditionalBasket.source'
// withdrawFromPot has no server-side compile path — keep as raw import
import withdrawFromPotSrc from '../sauce/withdrawFromPot.sauce.ts?raw'

export const KITCHEN = v12KitchenAddress() as Hex
export const ENGINE  = v12EngineAddress()  as Hex
export const MIN_FEE_PER_GAS = 20_000_000_000n // 20 gwei

// Re-export for consumers
export { DEFAULT_POT_SALT, kitchenExecutionFee, v12PredictPot }

export interface CompiledPrograms {
  conditionalBasket: routes.CompiledSauceProgram
  withdrawFromPot:   routes.CompiledSauceProgram
}

// Resolve ABI imports inside the Sauce programs
const enc = new TextEncoder()
function resolveAbi(specifier: string): Uint8Array | undefined {
  if (specifier === './BasketPool.abi.json') return enc.encode(JSON.stringify(basketPoolAbiJson))
  if (specifier === './Basket.abi.json')     return enc.encode(JSON.stringify(basketAbiJson))
  return undefined
}

let _compiled: CompiledPrograms | null = null
let _compilePromise: Promise<CompiledPrograms> | null = null

async function compileAll(): Promise<CompiledPrograms> {
  if (_compiled) return _compiled
  if (_compilePromise) return _compilePromise

  _compilePromise = (async () => {
    // Load WASM from public/ (copied from node_modules/sauce-compiler/web/)
    await ready(new URL('/sauce_wasm_bg.wasm', location.href))

    const opts = { resolve: resolveAbi }
    const conditionalBasket = routes.compileSauceProgram('arc', CONDITIONAL_BASKET_SOURCE, opts)
    const withdrawFromPot   = routes.compileSauceProgram('arc', withdrawFromPotSrc)

    _compiled = { conditionalBasket, withdrawFromPot }
    return _compiled
  })()

  return _compilePromise
}

export function useSauce() {
  const [compiled, setCompiled] = useState<CompiledPrograms | null>(_compiled)
  const [sauceReady, setSauceReady] = useState(!!_compiled)
  const [sauceError, setSauceError] = useState<string | null>(null)

  useEffect(() => {
    if (_compiled) return
    compileAll()
      .then((c) => { setCompiled(c); setSauceReady(true) })
      .catch((e: unknown) => setSauceError(e instanceof Error ? e.message : String(e)))
  }, [])

  return { compiled, sauceReady, sauceError }
}

/** The exact tx the owner wallet must send for a cook. */
export interface CookCall {
  to:    Hex    // Pot address — the cook() function lives here
  data:  Hex    // cook(engine, payload)
  value: bigint // Kitchen execution fee — paid by the owner wallet
}

/**
 * Build the full cook call for a conditional basket deposit.
 * The returned { to, data, value } is sent by the OWNER wallet to the Pot.
 */
export function buildConditionalBuyCall(
  compiled:    CompiledPrograms,
  pot:         Hex,   // predicted Pot address for the connected wallet
  fee:         bigint, // Kitchen execution fee
  recipient:   Hex,
  usdcAmount:  bigint,
  maxBtcPrice: bigint,
  minEurc:     bigint,
  minBtc:      bigint,
): CookCall {
  const p = compiled.conditionalBasket
  const args = routes.encodeEntryArguments(p, [recipient, usdcAmount, maxBtcPrice, minEurc, minBtc])
  const payload = concatHex([bytesToHex(p.bytecode), bytesToHex(args)])
  const call = routes.buildSauceEvmCall({ pot, engine: ENGINE, program: payload, value: fee })
  return { to: call.to, data: call.data, value: call.value }
}

/**
 * Build the full cook call for withdrawing all USDC from the Pot to owner.
 * The returned { to, data, value } is sent by the OWNER wallet to the Pot.
 */
export function buildWithdrawCall(
  compiled: CompiledPrograms,
  pot:      Hex,   // verified Pot address
  fee:      bigint, // Kitchen execution fee
  owner:    Hex,
): CookCall {
  const p = compiled.withdrawFromPot
  const args = routes.encodeEntryArguments(p, [owner])
  const payload = concatHex([bytesToHex(p.bytecode), bytesToHex(args)])
  const call = routes.buildSauceEvmCall({ pot, engine: ENGINE, program: payload, value: fee })
  return { to: call.to, data: call.data, value: call.value }
}
