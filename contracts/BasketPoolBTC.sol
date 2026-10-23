// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketPool} from "./BasketPool.sol";

/// @notice Alias for the USDC/cirBTC pool. Identical bytecode, separate artifact for deployment.
contract BasketPoolBTC is BasketPool {
    constructor(address _token0, address _token1) BasketPool(_token0, _token1) {}
}
