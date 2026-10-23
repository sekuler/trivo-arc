// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {BasketPool} from "../BasketPool.sol";
import {Basket} from "../Basket.sol";

/**
 * @title DeployBasket
 * @notice Foundry deploy script for Arc mainnet (chain 5042).
 *
 * WARNING: Mainnet transactions involve REAL funds. Review all addresses
 * and constructor args before broadcasting. Use --dry-run first.
 *
 * Prerequisites:
 *   export PRIVATE_KEY=<your deployer private key>   # never commit
 *
 * Usage (deploy all three in order):
 *   forge script contracts/script/DeployBasket.s.sol \
 *       --sig "deployEurcPool()" \
 *       --rpc-url https://rpc.mainnet.arc.io \
 *       --private-key $PRIVATE_KEY \
 *       --broadcast
 *
 *   forge script contracts/script/DeployBasket.s.sol \
 *       --sig "deployBtcPool()" \
 *       --rpc-url https://rpc.mainnet.arc.io \
 *       --private-key $PRIVATE_KEY \
 *       --broadcast
 *
 *   forge script contracts/script/DeployBasket.s.sol \
 *       --sig "deployBasket(address,address)" \
 *       <EURC_POOL_ADDRESS> <BTC_POOL_ADDRESS> \
 *       --rpc-url https://rpc.mainnet.arc.io \
 *       --private-key $PRIVATE_KEY \
 *       --broadcast
 *
 * After deploy:
 *   Update src/contracts.ts MAINNET_ADDRESSES with the three deployed addresses.
 */
contract DeployBasket is Script {
    // ─── Arc Mainnet token addresses ───────────────────────────────────────────
    address constant USDC   = 0x3600000000000000000000000000000000000000;
    address constant EURC   = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    address constant CIRBTC = 0x171A4217b86A807A64eB94757Db6849fb4bDbAA0;

    function deployEurcPool() external returns (address pool) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        pool = address(new BasketPool(USDC, EURC));
        vm.stopBroadcast();
        console.log("USDC/EURC pool deployed at:", pool);
    }

    function deployBtcPool() external returns (address pool) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        pool = address(new BasketPool(USDC, CIRBTC));
        vm.stopBroadcast();
        console.log("USDC/cirBTC pool deployed at:", pool);
    }

    function deployBasket(address eurcPool, address btcPool) external returns (address basket) {
        require(eurcPool != address(0), "DeployBasket: zero eurcPool");
        require(btcPool  != address(0), "DeployBasket: zero btcPool");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        basket = address(new Basket(USDC, EURC, CIRBTC, eurcPool, btcPool));
        vm.stopBroadcast();
        console.log("Basket deployed at:", basket);
    }

    /// @notice Deploy all three in one call (convenience). Not recommended for production
    /// because you lose individual tx control and can't verify each address before proceeding.
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        BasketPool eurcPool = new BasketPool(USDC, EURC);
        console.log("USDC/EURC pool:", address(eurcPool));

        BasketPool btcPool = new BasketPool(USDC, CIRBTC);
        console.log("USDC/cirBTC pool:", address(btcPool));

        Basket basket = new Basket(USDC, EURC, CIRBTC, address(eurcPool), address(btcPool));
        console.log("Basket:", address(basket));

        vm.stopBroadcast();
    }
}
