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

contract BasketPool is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private constant FEE_NUMERATOR = 997;
    uint256 private constant FEE_DENOMINATOR = 1_000;

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint8 public immutable token0Decimals;
    uint8 public immutable token1Decimals;

    uint112 private reserve0;
    uint112 private reserve1;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amountIn,
        uint256 amountOut,
        bool zeroForOne,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address _token0, address _token1) ERC20("Basket LP Token", "BLP") Ownable(msg.sender) {
        require(_token0 != address(0) && _token1 != address(0), "BasketPool: zero address");
        require(_token0 != _token1, "BasketPool: identical tokens");

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
        uint256 deadline
    )
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1, uint256 liquidity)
    {
        _checkDeadline(deadline);
        require(to != address(0), "BasketPool: zero recipient");
        require(amount0Desired > 0 && amount1Desired > 0, "BasketPool: invalid desired amounts");

        (uint112 _reserve0, uint112 _reserve1) = (reserve0, reserve1);

        if (_reserve0 == 0 && _reserve1 == 0) {
            amount0 = amount0Desired;
            amount1 = amount1Desired;
        } else {
            uint256 amount1Optimal = (amount0Desired * _reserve1) / _reserve0;
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "BasketPool: INSUFFICIENT_B_AMOUNT");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * _reserve0) / _reserve1;
                require(amount0Optimal <= amount0Desired, "BasketPool: amount0 optimal overflow");
                require(amount0Optimal >= amount0Min, "BasketPool: INSUFFICIENT_A_AMOUNT");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
        }

        require(amount0 >= amount0Min && amount1 >= amount1Min, "BasketPool: slippage exceeded");

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "BasketPool: INSUFFICIENT_LIQUIDITY_MINTED");
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min((amount0 * _totalSupply) / _reserve0, (amount1 * _totalSupply) / _reserve1);
            require(liquidity > 0, "BasketPool: INSUFFICIENT_LIQUIDITY_MINTED");
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
        uint256 deadline
    )
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        _checkDeadline(deadline);
        require(to != address(0), "BasketPool: zero recipient");
        require(liquidity > 0, "BasketPool: zero liquidity");

        uint256 _totalSupply = totalSupply();
        require(_totalSupply > 0, "BasketPool: no liquidity");

        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;

        require(amount0 >= amount0Min, "BasketPool: amount0 below min");
        require(amount1 >= amount1Min, "BasketPool: amount1 below min");

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
        uint256 deadline
    )
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        _checkDeadline(deadline);
        require(to != address(0), "BasketPool: zero recipient");
        require(amountIn > 0, "BasketPool: zero input");

        bool zeroForOne = false;
        if (tokenIn == address(token0)) {
            zeroForOne = true;
        } else if (tokenIn == address(token1)) {
            zeroForOne = false;
        } else {
            revert("BasketPool: invalid tokenIn");
        }

        (uint112 _reserve0, uint112 _reserve1) = (reserve0, reserve1);
        require(_reserve0 > 0 && _reserve1 > 0, "BasketPool: no liquidity");

        if (zeroForOne) {
            token0.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = _getAmountOut(amountIn, _reserve0, _reserve1);
            require(amountOut >= amountOutMin, "BasketPool: INSUFFICIENT_OUTPUT_AMOUNT");
            token1.safeTransfer(to, amountOut);
        } else {
            token1.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = _getAmountOut(amountIn, _reserve1, _reserve0);
            require(amountOut >= amountOutMin, "BasketPool: INSUFFICIENT_OUTPUT_AMOUNT");
            token0.safeTransfer(to, amountOut);
        }

        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        emit Swap(msg.sender, amountIn, amountOut, zeroForOne, to);
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DENOMINATOR) + amountInWithFee;
        return numerator / denominator;
    }

    function _update(uint256 balance0, uint256 balance1) internal {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "BasketPool: reserve overflow");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        emit Sync(reserve0, reserve1);
    }

    function _checkDeadline(uint256 deadline) internal view {
        require(block.timestamp <= deadline, "BasketPool: EXPIRED");
    }

    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = (y / 2) + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
