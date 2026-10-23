// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

interface IBasketPool {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address tokenIn,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

contract Basket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant DEFAULT_USDC_BPS = 4_000;
    uint16 public constant DEFAULT_EURC_BPS = 3_000;
    uint16 public constant DEFAULT_BTC_BPS = 3_000;

    IERC20 public immutable usdc;
    IERC20 public immutable eurc;
    IERC20 public immutable cirBTC;

    uint8 public immutable usdcDecimals;
    uint8 public immutable eurcDecimals;
    uint8 public immutable btcDecimals;

    IBasketPool public immutable usdcEurcPool;
    IBasketPool public immutable usdcBtcPool;

    bool public immutable usdcIsToken0InEurcPool;
    bool public immutable usdcIsToken0InBtcPool;

    struct BasketPosition {
        uint256 usdcAmount;
        uint256 eurcAmount;
        uint256 btcAmount;
    }

    struct Allocation {
        uint16 usdcBps;
        uint16 eurcBps;
        uint16 btcBps;
        bool custom;
    }

    mapping(address => BasketPosition) public positions;
    mapping(address => Allocation) private userAllocations;

    event Deposited(address indexed user, uint256 usdcIn, uint256 eurcOut, uint256 btcOut);
    event Withdrawn(address indexed user, uint256 usdcOut);
    event WithdrawnTokens(address indexed user, uint256 usdcAmount, uint256 eurcAmount, uint256 btcAmount);
    event WithdrawnPartial(address indexed user, uint16 shareBps, uint256 usdcOut);
    event WithdrawnPartialTokens(address indexed user, uint16 shareBps, uint256 usdcAmount, uint256 eurcAmount, uint256 btcAmount);
    event AllocationSet(address indexed user, uint16 usdcBps, uint16 eurcBps, uint16 btcBps);

    constructor(address _usdc, address _eurc, address _cirBTC, address _usdcEurcPool, address _usdcBtcPool)
        Ownable(msg.sender)
    {
        require(_usdc != address(0), "Basket: zero usdc");
        require(_eurc != address(0), "Basket: zero eurc");
        require(_cirBTC != address(0), "Basket: zero cirBTC");
        require(_usdcEurcPool != address(0), "Basket: zero usdcEurcPool");
        require(_usdcBtcPool != address(0), "Basket: zero usdcBtcPool");

        usdc = IERC20(_usdc);
        eurc = IERC20(_eurc);
        cirBTC = IERC20(_cirBTC);

        usdcDecimals = IERC20Decimals(_usdc).decimals();
        eurcDecimals = IERC20Decimals(_eurc).decimals();
        btcDecimals = IERC20Decimals(_cirBTC).decimals();

        usdcEurcPool = IBasketPool(_usdcEurcPool);
        usdcBtcPool = IBasketPool(_usdcBtcPool);

        (bool _usdcIsToken0InEurcPool, bool validEurcPool) = _validatePoolPair(_usdcEurcPool, _usdc, _eurc);
        require(validEurcPool, "Basket: invalid usdc/eurc pool");
        usdcIsToken0InEurcPool = _usdcIsToken0InEurcPool;

        (bool _usdcIsToken0InBtcPool, bool validBtcPool) = _validatePoolPair(_usdcBtcPool, _usdc, _cirBTC);
        require(validBtcPool, "Basket: invalid usdc/cirBTC pool");
        usdcIsToken0InBtcPool = _usdcIsToken0InBtcPool;
    }

    function setAllocation(uint16 usdcBps, uint16 eurcBps, uint16 btcBps) external {
        require(uint256(usdcBps) + uint256(eurcBps) + uint256(btcBps) == BPS_DENOMINATOR, "Basket: invalid bps");

        userAllocations[msg.sender] = Allocation({usdcBps: usdcBps, eurcBps: eurcBps, btcBps: btcBps, custom: true});

        emit AllocationSet(msg.sender, usdcBps, eurcBps, btcBps);
    }

    function getAllocation(address user) external view returns (uint16 usdcBps, uint16 eurcBps, uint16 btcBps) {
        Allocation memory allocation = _effectiveAllocation(user);
        return (allocation.usdcBps, allocation.eurcBps, allocation.btcBps);
    }

    function depositUsdc(uint256 usdcAmount, uint256 minEurc, uint256 minBtc) external nonReentrant {
        require(usdcAmount > 0, "Basket: zero amount");

        Allocation memory allocation = _effectiveAllocation(msg.sender);

        uint256 usdcKeep = (usdcAmount * allocation.usdcBps) / BPS_DENOMINATOR;
        uint256 usdcForEurc = (usdcAmount * allocation.eurcBps) / BPS_DENOMINATOR;
        uint256 usdcForBtc = usdcAmount - usdcKeep - usdcForEurc;

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        uint256 eurcOut = 0;
        if (usdcForEurc > 0) {
            usdc.forceApprove(address(usdcEurcPool), usdcForEurc);
            eurcOut = usdcEurcPool.swapExactTokensForTokens(
                usdcForEurc,
                minEurc,
                address(usdc),
                address(this),
                block.timestamp
            );
            usdc.forceApprove(address(usdcEurcPool), 0);
        }

        uint256 btcOut = 0;
        if (usdcForBtc > 0) {
            usdc.forceApprove(address(usdcBtcPool), usdcForBtc);
            btcOut = usdcBtcPool.swapExactTokensForTokens(
                usdcForBtc,
                minBtc,
                address(usdc),
                address(this),
                block.timestamp
            );
            usdc.forceApprove(address(usdcBtcPool), 0);
        }

        BasketPosition storage position = positions[msg.sender];
        position.usdcAmount += usdcKeep;
        position.eurcAmount += eurcOut;
        position.btcAmount += btcOut;

        emit Deposited(msg.sender, usdcAmount, eurcOut, btcOut);
    }

    /**
     * @notice Deposit USDC on behalf of a recipient.
     *         Caller (msg.sender) must have pre-approved this contract for usdcAmount.
     *         The basket position is credited to `recipient`, not to msg.sender.
     *         Designed for use by the BasketStream contract so streamed USDC goes
     *         directly into the streamer's own basket position.
     * @param recipient   The address whose BasketPosition is credited.
     * @param usdcAmount  USDC amount to deposit (6-decimal units).
     * @param minEurc     Minimum EURC to receive from the USDC→EURC swap (slippage guard).
     * @param minBtc      Minimum cirBTC to receive from the USDC→BTC swap (slippage guard).
     */
    function depositUsdcFor(address recipient, uint256 usdcAmount, uint256 minEurc, uint256 minBtc)
        external
        nonReentrant
    {
        require(recipient != address(0), "Basket: zero recipient");
        require(usdcAmount > 0, "Basket: zero amount");
        // Pull USDC from the caller (e.g. BasketStream contract)
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Identical split logic as depositUsdc, but position credited to recipient
        Allocation memory alloc = _effectiveAllocation(recipient);
        uint256 usdcForEurc = (usdcAmount * alloc.eurcBps) / BPS_DENOMINATOR;
        uint256 usdcForBtc = (usdcAmount * alloc.btcBps) / BPS_DENOMINATOR;
        uint256 usdcKept = usdcAmount - usdcForEurc - usdcForBtc;

        uint256 eurcOut = 0;
        uint256 btcOut = 0;

        if (usdcForEurc > 0) {
            usdc.forceApprove(address(usdcEurcPool), usdcForEurc);
            eurcOut = usdcEurcPool.swapExactTokensForTokens(
                usdcForEurc, minEurc, address(usdc), address(this), block.timestamp
            );
            usdc.forceApprove(address(usdcEurcPool), 0);
        }

        if (usdcForBtc > 0) {
            usdc.forceApprove(address(usdcBtcPool), usdcForBtc);
            btcOut = usdcBtcPool.swapExactTokensForTokens(
                usdcForBtc, minBtc, address(usdc), address(this), block.timestamp
            );
            usdc.forceApprove(address(usdcBtcPool), 0);
        }

        positions[recipient].usdcAmount += usdcKept;
        positions[recipient].eurcAmount += eurcOut;
        positions[recipient].btcAmount += btcOut;

        emit Deposited(recipient, usdcKept, eurcOut, btcOut);
    }

    function depositEurc(uint256 eurcAmount, uint256 minUsdc, uint256 minBtc) external nonReentrant {
        require(eurcAmount > 0, "Basket: zero amount");

        Allocation memory allocation = _effectiveAllocation(msg.sender);

        uint256 eurcKeep = (eurcAmount * allocation.eurcBps) / BPS_DENOMINATOR;
        uint256 eurcForUsdc = (eurcAmount * allocation.usdcBps) / BPS_DENOMINATOR;
        uint256 eurcForBtc = eurcAmount - eurcKeep - eurcForUsdc;

        eurc.safeTransferFrom(msg.sender, address(this), eurcAmount);

        uint256 usdcOut = 0;
        if (eurcForUsdc > 0) {
            eurc.forceApprove(address(usdcEurcPool), eurcForUsdc);
            usdcOut = usdcEurcPool.swapExactTokensForTokens(
                eurcForUsdc,
                minUsdc,
                address(eurc),
                address(this),
                block.timestamp
            );
            eurc.forceApprove(address(usdcEurcPool), 0);
        }

        uint256 btcOut = 0;
        if (eurcForBtc > 0) {
            eurc.forceApprove(address(usdcEurcPool), eurcForBtc);
            uint256 usdcIntermediate = usdcEurcPool.swapExactTokensForTokens(
                eurcForBtc,
                0,
                address(eurc),
                address(this),
                block.timestamp
            );
            eurc.forceApprove(address(usdcEurcPool), 0);

            if (usdcIntermediate > 0) {
                usdc.forceApprove(address(usdcBtcPool), usdcIntermediate);
                btcOut = usdcBtcPool.swapExactTokensForTokens(
                    usdcIntermediate,
                    minBtc,
                    address(usdc),
                    address(this),
                    block.timestamp
                );
                usdc.forceApprove(address(usdcBtcPool), 0);
            }
        }

        BasketPosition storage position = positions[msg.sender];
        position.usdcAmount += usdcOut;
        position.eurcAmount += eurcKeep;
        position.btcAmount += btcOut;

        emit Deposited(msg.sender, usdcOut, eurcKeep, btcOut);
    }

    function depositCirBtc(uint256 btcAmount, uint256 minUsdc, uint256 minEurc) external nonReentrant {
        require(btcAmount > 0, "Basket: zero amount");

        Allocation memory allocation = _effectiveAllocation(msg.sender);

        uint256 btcKeep = (btcAmount * allocation.btcBps) / BPS_DENOMINATOR;
        uint256 btcForUsdc = (btcAmount * allocation.usdcBps) / BPS_DENOMINATOR;
        uint256 btcForEurc = btcAmount - btcKeep - btcForUsdc;

        cirBTC.safeTransferFrom(msg.sender, address(this), btcAmount);

        uint256 usdcOut = 0;
        if (btcForUsdc > 0) {
            cirBTC.forceApprove(address(usdcBtcPool), btcForUsdc);
            usdcOut = usdcBtcPool.swapExactTokensForTokens(
                btcForUsdc,
                minUsdc,
                address(cirBTC),
                address(this),
                block.timestamp
            );
            cirBTC.forceApprove(address(usdcBtcPool), 0);
        }

        uint256 eurcOut = 0;
        if (btcForEurc > 0) {
            cirBTC.forceApprove(address(usdcBtcPool), btcForEurc);
            uint256 usdcIntermediate = usdcBtcPool.swapExactTokensForTokens(
                btcForEurc,
                0,
                address(cirBTC),
                address(this),
                block.timestamp
            );
            cirBTC.forceApprove(address(usdcBtcPool), 0);

            if (usdcIntermediate > 0) {
                usdc.forceApprove(address(usdcEurcPool), usdcIntermediate);
                eurcOut = usdcEurcPool.swapExactTokensForTokens(
                    usdcIntermediate,
                    minEurc,
                    address(usdc),
                    address(this),
                    block.timestamp
                );
                usdc.forceApprove(address(usdcEurcPool), 0);
            }
        }

        BasketPosition storage position = positions[msg.sender];
        position.usdcAmount += usdcOut;
        position.eurcAmount += eurcOut;
        position.btcAmount += btcKeep;

        emit Deposited(msg.sender, usdcOut, eurcOut, btcKeep);
    }

    function withdrawAll(uint256 minUsdc) external nonReentrant {
        BasketPosition memory position = positions[msg.sender];
        require(position.usdcAmount > 0 || position.eurcAmount > 0 || position.btcAmount > 0, "Basket: empty position");

        // Checks-Effects-Interactions: clear state before external calls to prevent
        // any reentrancy risk even if token contracts are malicious.
        delete positions[msg.sender];

        uint256 totalUsdcOut = position.usdcAmount;

        if (position.eurcAmount > 0) {
            eurc.forceApprove(address(usdcEurcPool), position.eurcAmount);
            uint256 usdcFromEurc = usdcEurcPool.swapExactTokensForTokens(
                position.eurcAmount,
                0,
                address(eurc),
                address(this),
                block.timestamp
            );
            totalUsdcOut += usdcFromEurc;
        }

        if (position.btcAmount > 0) {
            cirBTC.forceApprove(address(usdcBtcPool), position.btcAmount);
            uint256 usdcFromBtc = usdcBtcPool.swapExactTokensForTokens(
                position.btcAmount,
                0,
                address(cirBTC),
                address(this),
                block.timestamp
            );
            totalUsdcOut += usdcFromBtc;
        }

        require(totalUsdcOut >= minUsdc, "Basket: slippage exceeded");

        usdc.safeTransfer(msg.sender, totalUsdcOut);

        emit Withdrawn(msg.sender, totalUsdcOut);
    }

    function withdrawTokens() external nonReentrant {
        BasketPosition memory position = positions[msg.sender];
        require(position.usdcAmount > 0 || position.eurcAmount > 0 || position.btcAmount > 0, "Basket: empty position");

        delete positions[msg.sender];

        if (position.usdcAmount > 0) {
            usdc.safeTransfer(msg.sender, position.usdcAmount);
        }
        if (position.eurcAmount > 0) {
            eurc.safeTransfer(msg.sender, position.eurcAmount);
        }
        if (position.btcAmount > 0) {
            cirBTC.safeTransfer(msg.sender, position.btcAmount);
        }

        emit WithdrawnTokens(msg.sender, position.usdcAmount, position.eurcAmount, position.btcAmount);
    }

    /**
     * @notice Withdraw a percentage of holdings, converting everything to USDC.
     * @param shareBps Share to withdraw in basis points (1–10000). 10000 = 100%.
     * @param minUsdc  Minimum total USDC to receive (slippage protection).
     */
    function withdrawPartial(uint16 shareBps, uint256 minUsdc) external nonReentrant {
        require(shareBps >= 1 && shareBps <= BPS_DENOMINATOR, "Basket: invalid shareBps");
        BasketPosition storage pos = positions[msg.sender];
        require(pos.usdcAmount > 0 || pos.eurcAmount > 0 || pos.btcAmount > 0, "Basket: empty position");

        // Calculate the share of each asset to withdraw
        uint256 usdcShare = (pos.usdcAmount * shareBps) / BPS_DENOMINATOR;
        uint256 eurcShare = (pos.eurcAmount * shareBps) / BPS_DENOMINATOR;
        uint256 btcShare  = (pos.btcAmount  * shareBps) / BPS_DENOMINATOR;

        // Checks-Effects: deduct from position before any external call
        pos.usdcAmount -= usdcShare;
        pos.eurcAmount -= eurcShare;
        pos.btcAmount  -= btcShare;

        uint256 totalUsdcOut = usdcShare;

        if (eurcShare > 0) {
            eurc.forceApprove(address(usdcEurcPool), eurcShare);
            uint256 usdcFromEurc = usdcEurcPool.swapExactTokensForTokens(
                eurcShare, 0, address(eurc), address(this), block.timestamp
            );
            totalUsdcOut += usdcFromEurc;
        }

        if (btcShare > 0) {
            cirBTC.forceApprove(address(usdcBtcPool), btcShare);
            uint256 usdcFromBtc = usdcBtcPool.swapExactTokensForTokens(
                btcShare, 0, address(cirBTC), address(this), block.timestamp
            );
            totalUsdcOut += usdcFromBtc;
        }

        require(totalUsdcOut >= minUsdc, "Basket: slippage exceeded");
        usdc.safeTransfer(msg.sender, totalUsdcOut);

        emit WithdrawnPartial(msg.sender, shareBps, totalUsdcOut);
    }

    /**
     * @notice Withdraw a percentage of holdings as raw tokens (no swaps).
     * @param shareBps Share to withdraw in basis points (1–10000). 10000 = 100%.
     */
    function withdrawPartialTokens(uint16 shareBps) external nonReentrant {
        require(shareBps >= 1 && shareBps <= BPS_DENOMINATOR, "Basket: invalid shareBps");
        BasketPosition storage pos = positions[msg.sender];
        require(pos.usdcAmount > 0 || pos.eurcAmount > 0 || pos.btcAmount > 0, "Basket: empty position");

        uint256 usdcShare = (pos.usdcAmount * shareBps) / BPS_DENOMINATOR;
        uint256 eurcShare = (pos.eurcAmount * shareBps) / BPS_DENOMINATOR;
        uint256 btcShare  = (pos.btcAmount  * shareBps) / BPS_DENOMINATOR;

        // Checks-Effects: deduct before transfers
        pos.usdcAmount -= usdcShare;
        pos.eurcAmount -= eurcShare;
        pos.btcAmount  -= btcShare;

        if (usdcShare > 0) usdc.safeTransfer(msg.sender, usdcShare);
        if (eurcShare > 0) eurc.safeTransfer(msg.sender, eurcShare);
        if (btcShare  > 0) cirBTC.safeTransfer(msg.sender, btcShare);

        emit WithdrawnPartialTokens(msg.sender, shareBps, usdcShare, eurcShare, btcShare);
    }

    /**
     * @notice Returns an estimated basket value using instantaneous pool reserves.
     * @dev WARNING: spot-price only — reserves can be manipulated within a block via
     *      flash loans or large swaps. Do NOT use this value in any on-chain fund-movement
     *      logic (e.g. liquidations, credit limits, automatic rebalancing). It is safe for
     *      display-only frontend use.
     */
    function getBasketValue(address user)
        external
        view
        returns (uint256 totalValueInUsdc, uint256 usdcHeld, uint256 eurcHeld, uint256 btcHeld)
    {
        BasketPosition memory position = positions[user];
        usdcHeld = position.usdcAmount;
        eurcHeld = position.eurcAmount;
        btcHeld = position.btcAmount;

        uint256 eurcValueInUsdc = _valueInUsdcFromPool(
            eurcHeld,
            usdcEurcPool,
            eurcDecimals,
            usdcIsToken0InEurcPool
        );

        uint256 btcValueInUsdc = _valueInUsdcFromPool(
            btcHeld,
            usdcBtcPool,
            btcDecimals,
            usdcIsToken0InBtcPool
        );

        totalValueInUsdc = usdcHeld + eurcValueInUsdc + btcValueInUsdc;
    }

    function _effectiveAllocation(address user) internal view returns (Allocation memory allocation) {
        allocation = userAllocations[user];
        if (!allocation.custom) {
            allocation = Allocation({
                usdcBps: DEFAULT_USDC_BPS,
                eurcBps: DEFAULT_EURC_BPS,
                btcBps: DEFAULT_BTC_BPS,
                custom: false
            });
        }
    }

    function _validatePoolPair(address pool, address usdcToken, address pairedToken)
        internal
        view
        returns (bool usdcIsToken0, bool valid)
    {
        address t0 = IBasketPool(pool).token0();
        address t1 = IBasketPool(pool).token1();

        if (t0 == usdcToken && t1 == pairedToken) {
            return (true, true);
        }
        if (t1 == usdcToken && t0 == pairedToken) {
            return (false, true);
        }
        return (false, false);
    }

    function _valueInUsdcFromPool(uint256 tokenAmount, IBasketPool pool, uint8 tokenDecimals, bool _usdcIsToken0)
        internal
        view
        returns (uint256)
    {
        if (tokenAmount == 0) {
            return 0;
        }

        (uint112 _reserve0, uint112 _reserve1) = pool.getReserves();
        if (_reserve0 == 0 || _reserve1 == 0) {
            return 0;
        }

        uint256 reserveUsdc = _usdcIsToken0 ? uint256(_reserve0) : uint256(_reserve1);
        uint256 reserveToken = _usdcIsToken0 ? uint256(_reserve1) : uint256(_reserve0);

        // value_in_usdc = tokenAmount * reserveUsdc / reserveToken
        // Adjust for decimal differences between tokenDecimals and usdcDecimals so the
        // result is in USDC's 6-decimal unit.
        //
        // Multiply-before-divide: never divide an intermediate result before all
        // multiplications are applied. Slither's divide-before-multiply detector
        // fires on any expression of the form (a/b)*c. We avoid that by combining
        // all multiplications in the numerator first, then performing one final division.
        //
        // Case A: tokenDecimals > usdcDecimals (cirBTC 8 > USDC 6)
        //   value = tokenAmount * reserveUsdc / (reserveToken * 10^(tokenDecimals - usdcDecimals))
        // Case B: tokenDecimals <= usdcDecimals (EURC 6 == USDC 6)
        //   value = tokenAmount * reserveUsdc * 10^(usdcDecimals - tokenDecimals) / reserveToken
        uint8 _usdcDecimals = usdcDecimals;

        if (tokenDecimals > _usdcDecimals) {
            uint256 decimalAdj = 10 ** uint256(tokenDecimals - _usdcDecimals);
            // numerator = tokenAmount * reserveUsdc
            // denominator = reserveToken * decimalAdj
            uint256 denominator = reserveToken * decimalAdj;
            if (denominator == 0) return 0;
            return (tokenAmount * reserveUsdc) / denominator;
        } else {
            uint256 decimalAdj = 10 ** uint256(_usdcDecimals - tokenDecimals);
            // numerator = tokenAmount * reserveUsdc * decimalAdj
            // denominator = reserveToken
            if (reserveToken == 0) return 0;
            return (tokenAmount * reserveUsdc * decimalAdj) / reserveToken;
        }
    }
}
