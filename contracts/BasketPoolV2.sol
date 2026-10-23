// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title BasketPoolV2 — constant-product AMM pool (x*y=k), 0.3% fee
contract BasketPoolV2 is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private constant FEE_NUMERATOR    = 997;
    uint256 private constant FEE_DENOMINATOR  = 1_000;

    IERC20  public immutable token0;
    IERC20  public immutable token1;
    uint8   public immutable token0Decimals;
    uint8   public immutable token1Decimals;

    uint112 private reserve0;
    uint112 private reserve1;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, bool zeroForOne, address indexed to);
    event Sync(uint112 r0, uint112 r1);

    constructor(address _token0, address _token1) ERC20("Basket LP V2", "BLP2") Ownable(msg.sender) {
        require(_token0 != address(0) && _token1 != address(0), "BPV2: zero addr");
        require(_token0 != _token1, "BPV2: same token");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        token0Decimals = IERC20Decimals(_token0).decimals();
        token1Decimals = IERC20Decimals(_token1).decimals();
    }

    function getReserves() external view returns (uint112, uint112) {
        return (reserve0, reserve1);
    }

    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline_
    ) external nonReentrant returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        require(block.timestamp <= deadline_, "BPV2: expired");
        require(to != address(0), "BPV2: zero to");
        require(amount0Desired > 0 && amount1Desired > 0, "BPV2: zero desired");

        (uint112 _r0, uint112 _r1) = (reserve0, reserve1);

        if (_r0 == 0 && _r1 == 0) {
            amount0 = amount0Desired;
            amount1 = amount1Desired;
        } else {
            uint256 opt1 = (uint256(amount0Desired) * _r1) / _r0;
            if (opt1 <= amount1Desired) {
                require(opt1 >= amount1Min, "BPV2: B_AMOUNT");
                amount0 = amount0Desired;
                amount1 = opt1;
            } else {
                uint256 opt0 = (uint256(amount1Desired) * _r0) / _r1;
                require(opt0 <= amount0Desired, "BPV2: A_OPT_OVERFLOW");
                require(opt0 >= amount0Min, "BPV2: A_AMOUNT");
                amount0 = opt0;
                amount1 = amount1Desired;
            }
        }
        require(amount0 >= amount0Min && amount1 >= amount1Min, "BPV2: slippage");

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        uint256 _supply = totalSupply();
        if (_supply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "BPV2: min_liquidity");
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min((amount0 * _supply) / _r0, (amount1 * _supply) / _r1);
            require(liquidity > 0, "BPV2: zero_lp");
        }

        _mint(to, liquidity);
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        emit Mint(msg.sender, amount0, amount1);
    }

    function removeLiquidity(
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline_
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(block.timestamp <= deadline_, "BPV2: expired");
        require(to != address(0), "BPV2: zero to");
        require(liquidity > 0, "BPV2: zero lp");
        uint256 _supply = totalSupply();
        require(_supply > 0, "BPV2: no liquidity");
        amount0 = (liquidity * reserve0) / _supply;
        amount1 = (liquidity * reserve1) / _supply;
        require(amount0 >= amount0Min, "BPV2: A_MIN");
        require(amount1 >= amount1Min, "BPV2: B_MIN");
        _burn(msg.sender, liquidity);
        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address tokenIn,
        address to,
        uint256 deadline_
    ) external nonReentrant returns (uint256 amountOut) {
        require(block.timestamp <= deadline_, "BPV2: expired");
        require(to != address(0), "BPV2: zero to");
        require(amountIn > 0, "BPV2: zero in");

        bool zeroForOne;
        if      (tokenIn == address(token0)) zeroForOne = true;
        else if (tokenIn == address(token1)) zeroForOne = false;
        else revert("BPV2: bad tokenIn");

        (uint112 _r0, uint112 _r1) = (reserve0, reserve1);
        require(_r0 > 0 && _r1 > 0, "BPV2: no liquidity");

        if (zeroForOne) {
            token0.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = _getAmountOut(amountIn, _r0, _r1);
            require(amountOut >= amountOutMin, "BPV2: INSUFFICIENT_OUTPUT");
            token1.safeTransfer(to, amountOut);
        } else {
            token1.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = _getAmountOut(amountIn, _r1, _r0);
            require(amountOut >= amountOutMin, "BPV2: INSUFFICIENT_OUTPUT");
            token0.safeTransfer(to, amountOut);
        }

        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        emit Swap(msg.sender, amountIn, amountOut, zeroForOne, to);
    }

    function _getAmountOut(uint256 amountIn, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        uint256 inWithFee = amountIn * FEE_NUMERATOR;
        return (inWithFee * rOut) / (rIn * FEE_DENOMINATOR + inWithFee);
    }

    function _update(uint256 b0, uint256 b1) internal {
        require(b0 <= type(uint112).max && b1 <= type(uint112).max, "BPV2: overflow");
        // forge-lint: disable-next-line(unsafe-typecast)
        reserve0 = uint112(b0);
        // forge-lint: disable-next-line(unsafe-typecast)
        reserve1 = uint112(b1);
        emit Sync(reserve0, reserve1);
    }

    function _min(uint256 x, uint256 y) internal pure returns (uint256) { return x < y ? x : y; }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
}
