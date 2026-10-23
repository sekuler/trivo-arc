// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketStreamBase} from "./BasketStream.Base.t.sol";
import {BasketStream} from "../BasketStream.sol";

/// @dev Tests for moveToBasket.
contract BasketStreamMoveTest is BasketStreamBase {

    // =========================================================================
    // moveToBasket — happy path
    // =========================================================================

    function test_MoveToBasket_HappyPath_HalfElapsed() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        uint256 expectedAmount = STREAM_AMOUNT / 2;
        uint256 streamBalBefore = usdc.balanceOf(address(stream));
        uint256 basketBalBefore = usdc.balanceOf(address(mockBasket));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(stream));
        emit BasketStream.MovedToBasket(id, alice, expectedAmount);
        stream.moveToBasket(id, 0, 0);

        // USDC moved from stream contract to mock basket
        assertEq(
            usdc.balanceOf(address(stream)),
            streamBalBefore - expectedAmount,
            "stream USDC decreased"
        );
        assertEq(
            usdc.balanceOf(address(mockBasket)),
            basketBalBefore + expectedAmount,
            "basket USDC increased"
        );

        // basket called with correct recipient (alice, not BasketStream)
        assertEq(mockBasket.lastRecipient(), alice, "recipient is alice");
        assertEq(mockBasket.lastAmount(),    expectedAmount, "amount matches");
        assertEq(mockBasket.credited(alice), expectedAmount, "credited to alice");

        // claimed updated
        (, , uint256 claimed, , ,) = stream.streams(id);
        assertEq(claimed, expectedAmount, "claimed updated");
    }

    function test_MoveToBasket_AllowanceClearedAfterCall() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        vm.prank(alice);
        stream.moveToBasket(id, 0, 0);

        // After the try/catch the contract always calls forceApprove(basket, 0)
        assertEq(
            usdc.allowance(address(stream), address(mockBasket)),
            0,
            "allowance cleared"
        );
    }

    function test_MoveToBasket_FullElapsed() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D);

        vm.prank(alice);
        stream.moveToBasket(id, 0, 0);

        assertEq(mockBasket.credited(alice), STREAM_AMOUNT);
        (, , uint256 claimed, , ,) = stream.streams(id);
        assertEq(claimed, STREAM_AMOUNT);
    }

    // =========================================================================
    // moveToBasket — state accumulates correctly across multiple moves
    // =========================================================================

    function test_MoveToBasket_TwoConsecutiveMoves() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);

        // first move at 25 %
        skip(DUR_1D / 4);
        vm.prank(alice);
        stream.moveToBasket(id, 0, 0);

        uint256 firstMoveAmount = STREAM_AMOUNT / 4;
        assertEq(mockBasket.credited(alice), firstMoveAmount);

        // second move at 75 % (i.e. another 50 % elapsed)
        skip(DUR_1D / 2);
        vm.prank(alice);
        stream.moveToBasket(id, 0, 0);

        uint256 secondMoveAmount = STREAM_AMOUNT / 2;
        assertEq(mockBasket.credited(alice), firstMoveAmount + secondMoveAmount);

        (, , uint256 claimed, , ,) = stream.streams(id);
        assertEq(claimed, firstMoveAmount + secondMoveAmount);
    }

    // =========================================================================
    // moveToBasket — revert paths
    // =========================================================================

    function test_MoveToBasket_RevertNonOwner() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        vm.prank(stranger);
        vm.expectRevert(bytes("BasketStream: not owner"));
        stream.moveToBasket(id, 0, 0);
    }

    function test_MoveToBasket_RevertAlreadyStopped() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        vm.prank(alice);
        stream.stopStream(id, 0, 0);

        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: stopped"));
        stream.moveToBasket(id, 0, 0);
    }

    function test_MoveToBasket_RevertNothingUnlocked() public {
        // at t=0, nothing has elapsed → unlockedAmount = 0
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);

        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: nothing to move"));
        stream.moveToBasket(id, 0, 0);
    }

    function test_MoveToBasket_RevertWhenBasketReverts() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        mockBasket.setShouldRevert(true);

        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: basket deposit failed"));
        stream.moveToBasket(id, 0, 0);
    }

    function test_MoveToBasket_AllowanceClearedEvenWhenBasketReverts() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        mockBasket.setShouldRevert(true);

        vm.prank(alice);
        // We expect the outer revert, but we first verify allowance is 0 afterwards
        vm.expectRevert(bytes("BasketStream: basket deposit failed"));
        stream.moveToBasket(id, 0, 0);

        // allowance must be cleared in the catch branch before the outer revert
        assertEq(
            usdc.allowance(address(stream), address(mockBasket)),
            0,
            "allowance cleared even on revert"
        );
    }
}
