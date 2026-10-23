// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BasketStream} from "../BasketStream.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockBasket} from "../test-helpers/MockBasket.sol";

/// @dev Shared fixtures for all BasketStream test suites.
abstract contract BasketStreamBase is Test {
    // ─── actors ──────────────────────────────────────────────────────────────
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    // ─── constants ────────────────────────────────────────────────────────────
    uint64 internal constant DUR_1H  = 1 hours;
    uint64 internal constant DUR_1D  = 1 days;
    uint64 internal constant DUR_7D  = 7 days;
    uint64 internal constant DUR_30D = 30 days;

    uint256 internal constant STREAM_AMOUNT = 1_000e6; // 1 000 USDC (6 dec)
    uint256 internal constant INITIAL_USDC  = 10_000e6;

    // ─── contracts ────────────────────────────────────────────────────────────
    MockERC20     internal usdc;
    MockBasket    internal mockBasket;
    BasketStream  internal stream;

    // ─── setUp ────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        usdc       = new MockERC20("Mock USDC", "mUSDC", 6);
        mockBasket = new MockBasket(address(usdc));
        stream     = new BasketStream(address(usdc), address(mockBasket));

        // fund actors
        usdc.mint(alice, INITIAL_USDC);
        usdc.mint(bob,   INITIAL_USDC);

        // pre-approve stream contract
        vm.prank(alice);
        usdc.approve(address(stream), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(stream), type(uint256).max);
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /// Start a stream as alice and return the stream id.
    function _startStream(uint256 amount, uint64 duration) internal returns (uint256 id) {
        vm.prank(alice);
        id = stream.startStream(amount, duration);
    }
}
