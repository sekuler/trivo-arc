# Trivo Arc

> Built with Arc Studio - money-powered apps in minutes

## What This App Does

A DeFi basket app on Arc. Users deposit USDC and get automatic exposure to a USDC/EURC/cirBTC portfolio mix.
Three custom x*y=k AMM pools (USDC/EURC and USDC/cirBTC) handle swaps and liquidity.
Frontend: 3 tabs — Basket (deposit/withdraw), Swap, Pool (add/remove liquidity).

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, Arc Dark design system
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`. Build: `bun run contracts:build`.
- Chain: Arc Mainnet (5042) is the live network; Arc Testnet (5042002) was used for development

## Deployed Contracts — Arc Testnet (5042002)

| Contract       | Address                                      | Explorer |
|----------------|----------------------------------------------|---------|
| BasketPoolV2 (USDC/EURC) | `0x835d2827ab94d3c7be8677af6d0f15fdf720be83` | https://explorer.testnet.arc.io/address/0x835d2827ab94d3c7be8677af6d0f15fdf720be83 |
| BasketPoolV2BTC (USDC/cirBTC) | `0xa39f874578e230027acb98afaa384a661fe365c7` | https://explorer.testnet.arc.io/address/0xa39f874578e230027acb98afaa384a661fe365c7 |
| BasketV3 (active) | `0x96d61dbd1284c5eb028415da3258ec8227b1a204` | https://explorer.testnet.arc.io/address/0x96d61dbd1284c5eb028415da3258ec8227b1a204 |
| BasketStreamV2 (active) | `0x11ed969fcc6a262791838b38fd9f54a35d7d760e` | https://explorer.testnet.arc.io/address/0x11ed969fcc6a262791838b38fd9f54a35d7d760e |
| BasketStream (deprecated) | `0x1a0de1374cc5932201d0e0125355b48c9d6f75ad` | https://explorer.testnet.arc.io/address/0x1a0de1374cc5932201d0e0125355b48c9d6f75ad |
| BasketV2 (deprecated) | `0x3200c3bf3e808684be661885a360926f89090815` | https://explorer.testnet.arc.io/address/0x3200c3bf3e808684be661885a360926f89090815 |

## Token Addresses

| Token  | Testnet                                        | Mainnet                                        | Decimals |
|--------|------------------------------------------------|------------------------------------------------|---------|
| USDC   | `0x3600000000000000000000000000000000000000`   | `0x3600000000000000000000000000000000000000`   | 6 |
| EURC   | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`  | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`  | 6 |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`  | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`  | 8 |

## Token Address Verification

### EURC Mainnet
- `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`: confirmed via [Arc docs](https://docs.arc.io/arc/references/contract-addresses) and [Circle developer docs](https://developers.circle.com/stablecoins/eurc-contract-addresses). Live `symbol()` = "EURC", `decimals()` = 6. (Note: Arc testnet EURC `0x89B5...` is different from mainnet.)

## cirBTC Address Verification
- **Mainnet** `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`: confirmed via Arc docs (docs.arc.io/arc/references/contract-addresses), Circle developer docs (developers.circle.com/assets/cirbtc-contract-addresses), Arc scan, cirBTC whitepaper, live `symbol()` call returning `"cirBTC"` and `decimals()` returning `8`.
- **Testnet** `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`: confirmed via Arc docs and live `symbol()` call returning `"cirBTC"`.

## Deployed Contracts — Arc Mainnet (5042)

| Contract | Address | Explorer |
|----------|---------|---------|
| USDC/EURC Pool | `0x793b6115b9EF8049e9E3643660E15D8a3028C25C` | https://explorer.arc.io/address/0x793b6115b9EF8049e9E3643660E15D8a3028C25C |
| USDC/cirBTC Pool | `0xBb97d774C019b138250245794092E9a511E35449` | https://explorer.arc.io/address/0xBb97d774C019b138250245794092E9a511E35449 |
| Basket | `0x104b0f1b643f642E1cAf264a85B1B105503f3dB5` | https://explorer.arc.io/address/0x104b0f1b643f642E1cAf264a85B1B105503f3dB5 |
| BasketStream | `0x014289eB4de7C172Ea11F6CBFEB1215f598A7eb0` | https://explorer.arc.io/address/0x014289eB4de7C172Ea11F6CBFEB1215f598A7eb0 |

Deployed from user wallet via Remix (0.8.24, paris, optimizer 200). Verified onchain 2026-10-23.

Mainnet deploy guide: `docs/mainnet/MAINNET_DEPLOY_GUIDE.md`

## Key Files

- `src/App.tsx` — Main composition root (tab routing)
- `src/components/BasketTab.tsx` — Deposit/withdraw/allocation UI
- `src/components/SwapTab.tsx` — Token swap UI
- `src/components/PoolTab.tsx` — Add/remove liquidity UI
- `src/contracts.ts` — Contract addresses and ABIs
- `src/hooks/useContracts.ts` — wagmi read hooks
- `src/utils/format.ts` — Formatting utilities
- `contracts/BasketPool.sol` — x*y=k AMM pool (0.3% fee, LP tokens)
- `contracts/Basket.sol` — Basket aggregator
