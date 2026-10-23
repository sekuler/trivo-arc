# Basket — Arc Mainnet Deploy & Verification Guide

> **Warning:** These contracts handle real funds. Read this guide in full before proceeding.
> All deployment transactions must be made from your own wallet. Arc Studio does not deploy, sign, or transact on mainnet on your behalf.

## Deployed Addresses (Arc Mainnet — chain ID 5042)

| Contract | Address |
|----------|---------|
| USDC/EURC Pool | `0x793b6115b9EF8049e9E3643660E15D8a3028C25C` |
| USDC/cirBTC Pool | `0xBb97d774C019b138250245794092E9a511E35449` |
| Basket | `0x104b0f1b643f642E1cAf264a85B1B105503f3dB5` |
| BasketStream | `0x014289eB4de7C172Ea11F6CBFEB1215f598A7eb0` |

All four verified onchain (2026-10-23): token pairs, basket pool references, and stream basket address confirmed via `eth_call` on `https://rpc.mainnet.arc.io`.

---

---

## 1. Arc Mainnet Token Addresses (verified onchain)

| Token | Address | Decimals | Source |
|-------|---------|----------|--------|
| USDC  | `0x3600000000000000000000000000000000000000` | 6 | [Arc docs](https://docs.arc.io/arc/references/contract-addresses) + `symbol()` = "USDC", `decimals()` = 6 ✓ |
| EURC  | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 | [Arc docs](https://docs.arc.io/arc/references/contract-addresses) + [Circle docs](https://developers.circle.com/stablecoins/eurc-contract-addresses) + `symbol()` = "EURC", `decimals()` = 6 ✓ |
| cirBTC | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` | 8 | [Arc docs](https://docs.arc.io/arc/references/contract-addresses) + `name()` = "Circle Wrapped Bitcoin", `symbol()` = "cirBTC", `decimals()` = 8 ✓ |

All three verified via live `eth_call` against `https://rpc.mainnet.arc.io` (chain ID 5042).

---

## 2. Compiler Settings (use these exactly in Remix and for Blockscout verification)

| Setting | Value |
|---------|-------|
| Solidity version | `0.8.24` (exact) |
| EVM target | `paris` |
| Optimizer | **Enabled** |
| Optimizer runs | `200` |
| Via IR | No |
| License | MIT |

> **Critical:** Arc targets the Paris EVM. Solidity ≥ 0.8.20 emits `PUSH0` by default (Shanghai+).  
> You **must** set EVM version to `paris` in Remix → Advanced settings → EVM version.  
> Deploying without this setting will produce bytecode that fails to deploy on Arc mainnet.

---

## 3. Deploy Order & Constructor Arguments

Deploy in this exact order. Each contract depends on the previous.

### Step 1 — USDC/EURC Pool

**File:** `docs/mainnet/BasketPool_USDC_EURC_flat.sol`  
**Contract name:** `BasketPoolV2`  
**Constructor arguments:**
```
_token0: 0x3600000000000000000000000000000000000000   (USDC)
_token1: 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1   (EURC)
```
Save the deployed address as **POOL_USDC_EURC**.

### Step 2 — USDC/cirBTC Pool

**File:** `docs/mainnet/BasketPool_USDC_cirBTC_flat.sol`  
**Contract name:** `BasketPoolV2BTC`  
**Constructor arguments:**
```
_token0: 0x3600000000000000000000000000000000000000   (USDC)
_token1: 0x171A4217b86A807A64eB94757Db6849fb4bDbAA0   (cirBTC)
```
Save the deployed address as **POOL_USDC_CIRBTC**.

### Step 3 — Basket

**File:** `docs/mainnet/Basket_flat.sol`  
**Contract name:** `Basket` (the contract inside the flat file is named `Basket`, not `BasketV3`)  
**Constructor arguments:**
```
_usdc:        0x3600000000000000000000000000000000000000   (USDC)
_eurc:        0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1   (EURC)
_cirBTC:      0x171A4217b86A807A64eB94757Db6849fb4bDbAA0   (cirBTC)
_usdcEurcPool: <POOL_USDC_EURC from Step 1>
_usdcBtcPool:  <POOL_USDC_CIRBTC from Step 2>
```
Save the deployed address as **BASKET**.

### Step 4 — BasketStream

**File:** `docs/mainnet/BasketStream_flat.sol`  
**Contract name:** `BasketStream` (the contract inside the flat file is named `BasketStream`, not `BasketStreamV2`)  
**Constructor arguments:**
```
_usdc:   0x3600000000000000000000000000000000000000   (USDC)
_basket: <BASKET from Step 3>
```
Save the deployed address as **STREAM**.

---

## 4. Remix Step-by-Step

1. Open [Remix IDE](https://remix.ethereum.org)
2. Create a new file and paste the contents of the flat .sol file
3. Go to **Solidity Compiler** tab:
   - Select compiler `0.8.24`
   - Click **Advanced Configurations**
   - Set **EVM version** → `paris`
   - Check **Enable optimization** → runs: `200`
4. Click **Compile**
5. Go to **Deploy & Run Transactions** tab:
   - Environment: **Injected Provider - MetaMask**
   - Make sure MetaMask is on **Arc Mainnet** (chain ID 5042)
   - Select the correct contract from the dropdown
   - Fill in constructor args (copy from Section 3 above)
   - Click **Deploy** — MetaMask will prompt for USDC gas
6. Copy the deployed address from the Remix console
7. Repeat for each contract in order

---

## 5. Wiring the Frontend

After all four contracts are deployed, update `src/contracts.ts`:

```typescript
export const MAINNET_ADDRESSES = {
  USDC:          '0x3600000000000000000000000000000000000000',
  EURC:          '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
  CIRBTC:        '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0',
  POOL_USDC_EURC: '<your POOL_USDC_EURC address>',
  POOL_USDC_BTC:  '<your POOL_USDC_CIRBTC address>',
  BASKET:         '<your BASKET address>',
  STREAM:         '<your STREAM address>',
}
```

Then set `VITE_MAINNET=true` in your `.env` file:

```
VITE_MAINNET=true
```

Restart the dev server (`bun run dev`). The app will connect to Arc Mainnet and use the mainnet addresses.

> **Note on EURC Mainnet address:** The EURC address on Arc Mainnet (`0xbEf5...`) is different from the testnet address (`0x89B5...`). The frontend reads it from `MAINNET_ADDRESSES` — no code change needed.

---

## 6. Blockscout Verification (Arc Mainnet Explorer)

Blockscout URL: `https://explorer.mainnet.arc.io`

### For each contract:

1. Go to `https://explorer.mainnet.arc.io/address/<CONTRACT_ADDRESS>`
2. Click the **Contract** tab → **Verify & Publish**
3. Select:
   - **Verification method:** `Solidity (Flattened source code)`
   - **Compiler:** `v0.8.24+commit...` (latest 0.8.24 build)
   - **EVM version:** `paris`
   - **Optimization:** `Yes`, runs `200`
   - **License:** `MIT`
4. Paste the entire contents of the corresponding flat .sol file
5. For constructor arguments: Blockscout will auto-detect them from the deployment tx.  
   If it asks for ABI-encoded args manually, use the values from Section 3 above encoded as ABI bytes (Remix shows the ABI-encoded args in the deployment transaction under "Input data").
6. Click **Verify** — it should match immediately since the bytecode was compiled with the same settings.

### Verification checklist

| Contract | Flat file | Contract name | 
|----------|-----------|---------------|
| USDC/EURC Pool | `BasketPool_USDC_EURC_flat.sol` | `BasketPoolV2` |
| USDC/cirBTC Pool | `BasketPool_USDC_cirBTC_flat.sol` | `BasketPoolV2BTC` |
| Basket | `Basket_flat.sol` | `BasketV3` |
| BasketStream | `BasketStream_flat.sol` | `BasketStreamV2` |

---

## 7. Post-Deploy Checklist

- [ ] Verify all 4 contracts on Blockscout
- [ ] Add initial liquidity to both pools (recommended: at least 500 USDC + equivalent on each side)
- [ ] Test a small USDC deposit to the Basket
- [ ] Test a small stream start + move to basket
- [ ] Update `AGENTS.md` with mainnet contract addresses
- [ ] Confirm `VITE_MAINNET=true` is in production `.env` before hosting

---

## 8. Security Notes (pre-mainnet audit summary)

The contracts received a max-severity review before testnet deployment and again before this mainnet guide. The following accepted findings are documented here:

**Accepted (not fixed — known, low practical risk with these specific tokens):**
- Pool contracts use requested input amounts rather than measured `balanceBefore/After` deltas. USDC, EURC, and cirBTC are all Circle-issued non-fee-on-transfer tokens. This pattern is safe with these specific assets but would be a bug if the pools were ever pointed at rebasing or fee-on-transfer tokens. **Do not change pool token pairs after deploy.**
- Basket accepts pool addresses validated by token-pair check (not factory whitelist). Mitigation: you control the constructor args — verify pool addresses before deploying Basket.

**Fixed:**
- `_mint(address(0))` → `_mint(address(0xdead))` for minimum liquidity lock
- `withdrawAll` CEI: position deleted before external calls
- All pool/basket `forceApprove(pool, 0)` residual allowance clearing
- `stopStream` resilience: basket deposit failure returns all USDC to user
- `StreamStopped` event now emits actual `toRefund` amount (not nominal `remaining`)

> This is not a substitute for a professional third-party audit before handling significant mainnet funds.
