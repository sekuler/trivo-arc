// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Alias so the SCP tool deploys a fresh address for the updated Basket contract.
import {Basket} from "./Basket.sol";

contract BasketV2 is Basket {
    constructor(address _usdc, address _eurc, address _cirBTC, address _usdcEurcPool, address _usdcBtcPool)
        Basket(_usdc, _eurc, _cirBTC, _usdcEurcPool, _usdcBtcPool)
    {}
}
