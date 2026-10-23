// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Basket} from "../Basket.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockBasketPool} from "../test-helpers/MockBasketPool.sol";

/// @dev Tests for Basket.depositUsdcFor.
contract BasketDepositForTest is Test {

    // ─── constants ────────────────────────────────────────────────────────────
    uint256 internal constant USDC_AMOUNT = 1_000e6; // 1 000 USDC
    uint256 internal constant SEED        = 10_000e6;

    // ─── actors ───────────────────────────────────────────────────────────────
    address internal owner     = makeAddr("owner");
    address internal caller    = makeAddr("caller");   // msg.sender to depositUsdcFor
    address internal recipient = makeAddr("recipient");// whose position is credited

    // ─── contracts ────────────────────────────────────────────────────────────
    MockERC20      internal usdc;
    MockERC20      internal eurc;
    MockERC20      internal cirBTC;
    MockBasketPool internal eurcPool;
    MockBasketPool internal btcPool;
    Basket         internal basket;

    function setUp() public {
        // Deploy tokens
        usdc   = new MockERC20("Mock USDC",   "mUSDC",  6);
        eurc   = new MockERC20("Mock EURC",   "mEURC",  6);
        cirBTC = new MockERC20("Mock cirBTC", "mBTC",   8);

        // Pools: usdc is token0, other is token1
        eurcPool = new MockBasketPool(address(usdc), address(eurc));
        btcPool  = new MockBasketPool(address(usdc), address(cirBTC));

        // Seed pools with output tokens so swaps can deliver
        eurc.mint(address(eurcPool), SEED * 100);
        cirBTC.mint(address(btcPool), SEED * 100);

        // Deploy Basket (constructor pulls decimals via IERC20Decimals.decimals())
        vm.prank(owner);
        basket = new Basket(
            address(usdc),
            address(eurc),
            address(cirBTC),
            address(eurcPool),
            address(btcPool)
        );

        // Fund caller and approve basket
        usdc.mint(caller, SEED);
        vm.prank(caller);
        usdc.approve(address(basket), type(uint256).max);
    }

    // =========================================================================
    // depositUsdcFor — happy path: position credited to recipient, not caller
    // =========================================================================

    function test_DepositUsdcFor_PositionCreditedToRecipient() public {
        vm.prank(caller);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);

        // recipient has a non-zero position
        (uint256 usdcPos, uint256 eurcPos, uint256 btcPos) = basket.positions(recipient);
        uint256 totalCredit = usdcPos + eurcPos + btcPos;
        assertGt(totalCredit, 0, "recipient position non-zero");

        // position split: default alloc 40/30/30
        // usdcKept = 40% of USDC_AMOUNT = 400e6
        // eurcOut  ≈ 30% of USDC_AMOUNT at 1:1 = 300e6
        // btcOut   ≈ 30% of USDC_AMOUNT at 1:1 = 300e6
        assertEq(usdcPos, (USDC_AMOUNT * 4_000) / 10_000, "usdcPos");
        assertEq(eurcPos, (USDC_AMOUNT * 3_000) / 10_000, "eurcPos");
        assertEq(btcPos,  (USDC_AMOUNT * 3_000) / 10_000, "btcPos");
    }

    function test_DepositUsdcFor_CallerPositionUntouched() public {
        vm.prank(caller);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);

        // caller's own position must be zero
        (uint256 u, uint256 e, uint256 b) = basket.positions(caller);
        assertEq(u, 0, "caller usdc pos");
        assertEq(e, 0, "caller eurc pos");
        assertEq(b, 0, "caller btc pos");
    }

    function test_DepositUsdcFor_UsdcPulledFromCaller() public {
        uint256 callerBalBefore = usdc.balanceOf(caller);

        vm.prank(caller);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);

        assertEq(
            usdc.balanceOf(caller),
            callerBalBefore - USDC_AMOUNT,
            "USDC pulled from caller"
        );
    }

    function test_DepositUsdcFor_EmitsDepositedEventWithRecipient() public {
        vm.prank(caller);
        vm.expectEmit(true, false, false, false, address(basket));
        emit Basket.Deposited(recipient, 0, 0, 0);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);
    }

    // =========================================================================
    // depositUsdcFor — recipient uses custom allocation
    // =========================================================================

    function test_DepositUsdcFor_UsesRecipientAllocation() public {
        // recipient sets 100% USDC, 0% EURC, 0% BTC
        vm.prank(recipient);
        basket.setAllocation(10_000, 0, 0);

        vm.prank(caller);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);

        (uint256 usdcPos, uint256 eurcPos, uint256 btcPos) = basket.positions(recipient);
        assertEq(usdcPos, USDC_AMOUNT, "all USDC kept");
        assertEq(eurcPos, 0,           "no EURC");
        assertEq(btcPos,  0,           "no BTC");
    }

    // =========================================================================
    // depositUsdcFor — accumulates across multiple calls
    // =========================================================================

    function test_DepositUsdcFor_AccumulatesPosition() public {
        vm.prank(caller);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);

        vm.prank(caller);
        basket.depositUsdcFor(recipient, USDC_AMOUNT, 0, 0);

        (uint256 usdcPos,,) = basket.positions(recipient);
        // 2x the single-call usdcPos
        assertEq(usdcPos, 2 * (USDC_AMOUNT * 4_000 / 10_000));
    }

    // =========================================================================
    // depositUsdcFor — revert paths
    // =========================================================================

    function test_DepositUsdcFor_RevertZeroRecipient() public {
        vm.prank(caller);
        vm.expectRevert(bytes("Basket: zero recipient"));
        basket.depositUsdcFor(address(0), USDC_AMOUNT, 0, 0);
    }

    function test_DepositUsdcFor_RevertZeroAmount() public {
        vm.prank(caller);
        vm.expectRevert(bytes("Basket: zero amount"));
        basket.depositUsdcFor(recipient, 0, 0, 0);
    }

    // =========================================================================
    // fuzz: recipient always gets credit == USDC_AMOUNT
    // =========================================================================

    function testFuzz_DepositUsdcFor_TotalPositionEqualsInput(uint256 amount) public {
        // Use default 40/30/30 allocation; at 1:1 swap ratio credit == input
        amount = bound(amount, 1, SEED);
        usdc.mint(caller, amount); // extra on top of SEED already minted in setUp

        vm.prank(caller);
        basket.depositUsdcFor(recipient, amount, 0, 0);

        (uint256 u, uint256 e, uint256 b) = basket.positions(recipient);
        assertEq(u + e + b, amount, "total position == input amount");
    }
}
