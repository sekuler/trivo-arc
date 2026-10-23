// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Minimal IBasketPool mock.
///      Simulates swapExactTokensForTokens with a configurable output ratio.
///      token0/token1 are set in the constructor so Basket's constructor validation passes.
contract MockBasketPool {
    using SafeERC20 for IERC20;

    address public token0;
    address public token1;

    // ratio: how many output tokens per input token (1:1 by default)
    uint256 public outputPerInput = 1e6; // scaled by 1e6; default = 1.0
    bool public shouldRevert;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function setOutputRatio(uint256 _ratio) external {
        outputPerInput = _ratio;
    }

    function setShouldRevert(bool _rev) external {
        shouldRevert = _rev;
    }

    function getReserves() external pure returns (uint112, uint112) {
        return (1_000_000e6, 1_000_000e6);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 /*amountOutMin*/,
        address tokenIn,
        address to,
        uint256 /*deadline*/
    ) external returns (uint256 amountOut) {
        if (shouldRevert) revert("MockBasketPool: forced revert");

        // pull tokenIn from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = (amountIn * outputPerInput) / 1e6;

        // deliver output token to `to` — determine which token to send
        address tokenOut = (tokenIn == token0) ? token1 : token0;
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }
}
