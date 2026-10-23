// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// BasketV3 — adds depositUsdcFor (used by BasketStream).
// Same interface as BasketV2, just a new deployment alias so
// the deploy tool creates a fresh address.
import {BasketV2} from "./BasketV2.sol";

contract BasketV3 is BasketV2 {
    constructor(
        address _usdc,
        address _eurc,
        address _cirBTC,
        address _usdcEurcPool,
        address _usdcBtcPool
    ) BasketV2(_usdc, _eurc, _cirBTC, _usdcEurcPool, _usdcBtcPool) {}
}
