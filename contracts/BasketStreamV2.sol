// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BasketStream.sol";

/// @dev Alias contract to force a fresh deployment artifact.
contract BasketStreamV2 is BasketStream {
    constructor(address _usdc, address _basket) BasketStream(_usdc, _basket) {}
}
