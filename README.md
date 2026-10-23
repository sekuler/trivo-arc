# Trivo Arc

A DeFi basket app on [Arc](https://arc.io) — deposit USDC and get automatic exposure to a USDC / EURC / cirBTC portfolio mix through custom x*y=k AMM pools with linear USDC streaming.

Built with [Arc Studio](https://studio.arc.io)

## What it does

- **Basket** — deposit USDC, choose your USDC/EURC/cirBTC allocation (default 40/30/30), withdraw anytime as USDC or raw tokens, partial withdrawals (25/50/75/100%)
- **Stream** — lock USDC that unlocks linearly second-by-second; move unlocked amounts to your basket or stop early to reclaim the remainder
- **Swap** — swap directly between USDC, EURC and cirBTC
- **Pool** — add and remove liquidity from both AMM pools
- **Gateway** — deposit USDC from Base, Ethereum, Arbitrum or Avalanche into the basket without bridging manually (Circle Unified Balance Kit)

## Tech stack

- React 18, Vite, TypeScript, Tailwind CSS
- wagmi v2, viem v2, ConnectKit
- Solidity 0.8.24, Foundry
- Circle Unified Balance Kit (`@circle-fin/unified-balance-kit`)

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contract compilation)
- A wallet with USDC on Arc Mainnet (chain ID 5042)

### Install

```bash
bun install
```

### Environment variables

```bash
cp .env.example .env
# Edit .env — see comments inside
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_MAINNET` | No | Defaults to **Arc Mainnet**. Set to `false` to switch to Arc Testnet. |

### Run

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Compile contracts

```bash
cd contracts && forge build
```

## Mainnet deployment

See [`docs/mainnet/MAINNET_DEPLOY_GUIDE.md`](docs/mainnet/MAINNET_DEPLOY_GUIDE.md) for:
- Verified Arc Mainnet token addresses (USDC, EURC, cirBTC)
- Flattened contract files ready for Remix
- Exact compiler settings and constructor arguments
- Step-by-step Blockscout verification instructions

Mainnet addresses are already filled in `src/contracts.ts`. The app runs on Arc Mainnet by default. Set `VITE_MAINNET=false` in `.env` to use Arc Testnet instead.

## Contracts

### Arc Mainnet (chain ID 5042)

| Contract | Address |
|----------|---------|
| USDC/EURC Pool | `0x793b6115b9EF8049e9E3643660E15D8a3028C25C` |
| USDC/cirBTC Pool | `0xBb97d774C019b138250245794092E9a511E35449` |
| Basket | `0x104b0f1b643f642E1cAf264a85B1B105503f3dB5` |
| BasketStream | `0x014289eB4de7C172Ea11F6CBFEB1215f598A7eb0` |

### Arc Testnet (tested in Arc Studio before mainnet)

| Contract | Address |
|----------|---------|
| USDC/EURC Pool | `0x835d2827ab94d3c7be8677af6d0f15fdf720be83` |
| USDC/cirBTC Pool | `0xa39f874578e230027acb98afaa384a661fe365c7` |
| Basket | `0x96d61dbd1284c5eb028415da3258ec8227b1a204` |
| BasketStream | `0x11ed969fcc6a262791838b38fd9f54a35d7d760e` |

## Token addresses

| Token | Testnet | Mainnet | Decimals |
|-------|---------|---------|---------|
| USDC | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` | 6 |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` | 8 |
