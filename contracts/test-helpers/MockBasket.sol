// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Mock IBasket that records depositUsdcFor calls and can be toggled to revert.
contract MockBasket {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    bool public shouldRevert;
    uint256 public depositCallCount;

    // last call args
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public lastMinEurc;
    uint256 public lastMinBtc;

    // per-recipient totals credited
    mapping(address => uint256) public credited;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function depositUsdcFor(address recipient, uint256 usdcAmount, uint256 minEurc, uint256 minBtc) external {
        if (shouldRevert) revert("MockBasket: forced revert");

        // Pull USDC from caller (mirrors Basket.depositUsdcFor behaviour)
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        depositCallCount++;
        lastRecipient = recipient;
        lastAmount = usdcAmount;
        lastMinEurc = minEurc;
        lastMinBtc = minBtc;
        credited[recipient] += usdcAmount;
    }
}
