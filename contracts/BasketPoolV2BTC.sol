// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {BasketPoolV2} from "./BasketPoolV2.sol";

/// @title BasketPoolV2BTC — USDC/cirBTC pool instance
contract BasketPoolV2BTC is BasketPoolV2 {
    constructor(address _token0, address _token1) BasketPoolV2(_token0, _token1) {}
}
