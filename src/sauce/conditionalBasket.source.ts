/**
 * conditionalBasket program source — exported as a string constant so both the
 * browser (useSauce.ts) and the Vercel API route (api/orders.ts) compile the
 * exact same source without reading files at runtime.
 *
 * Do not import this file into regular TypeScript compilation; it is excluded
 * from tsconfig.json. The API route imports it directly via a relative path.
 */

// The *.sauce.ts source files are excluded from tsc (tsconfig "exclude"),
// so we keep the program text here as a plain string constant.
export const CONDITIONAL_BASKET_SOURCE = `\
// Conditional basket deposit: deposits USDC into the Trivo basket only if
// the current cirBTC price is at or below the user's limit.
//
// sauce run conditionalBasket.sauce.ts --chain arc \\
//   --args <recipient> <usdcAmount> <maxBtcPrice> <minEurc> <minBtc>
//
//   recipient:   Address  — the wallet that receives the basket position
//   usdcAmount:  Uint256  — USDC amount in 6-decimal units (e.g. 5000000 = 5 USDC)
//   maxBtcPrice: Uint256  — max cirBTC price in USDC, expressed as USDC-per-cirBTC
//                           scaled to 6 decimals (e.g. 100000000 = 100 USDC per BTC)
//   minEurc:     Uint256  — min EURC out of the EURC pool swap, in 6-decimal units
//   minBtc:      Uint256  — min cirBTC out of the BTC pool swap, in 8-decimal units
//
// Example (Arc mainnet, 1 USDC, max BTC price 100000 USDC/BTC):
//   sauce run conditionalBasket.sauce.ts --chain arc \\
//     --args 0xYOUR_WALLET 1000000 100000000000 0 0

import BasketPoolABI from "./BasketPool.abi.json"
import BasketABI from "./Basket.abi.json"

function main(
  recipient:   Address,
  usdcAmount:  Uint256,
  maxBtcPrice: Uint256,
  minEurc:     Uint256,
  minBtc:      Uint256,
) {
  // 1. Read BTC pool reserves only (EURC price check is not needed here)
  //    BTC pool: token0=USDC (6 dec), token1=cirBTC (8 dec)
  //             reserve0=USDC, reserve1=cirBTC (confirmed onchain)
  const [r0btc, r1btc] = BasketPoolABI.at(0xBb97d774C019b138250245794092E9a511E35449).getReserves()

  // 2. Compute cirBTC spot price as USDC-per-cirBTC, normalized to 6 dec
  //    price = r0btc (6 dec) * 1e8 / r1btc (8 dec)  →  USDC per whole cirBTC
  require(r1btc > 0, "BTC pool empty")

  const btcPrice = (r0btc * 100000000) / r1btc

  // 3. Price guard — revert if price exceeds user's limit
  require(btcPrice <= maxBtcPrice, "price above limit")

  // 4. Approve USDC from Pot to Basket contract
  USDC.approve(0x104b0f1b643f642E1cAf264a85B1B105503f3dB5, usdcAmount)

  // 5. Deposit — basket position credited directly to recipient's wallet
  BasketABI.at(0x104b0f1b643f642E1cAf264a85B1B105503f3dB5).depositUsdcFor(recipient, usdcAmount, minEurc, minBtc)
}
`
