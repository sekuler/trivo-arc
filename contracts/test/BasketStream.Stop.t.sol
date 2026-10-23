// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketStreamBase} from "./BasketStream.Base.t.sol";
import {BasketStream} from "../BasketStream.sol";

/// @dev Tests for stopStream, including basket-revert resilience.
contract BasketStreamStopTest is BasketStreamBase {

    // =========================================================================
    // stopStream — happy paths
    // =========================================================================

    function test_StopStream_Partial_ClaimableToBasket_RemainderToWallet() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 4); // 25 % elapsed

        uint256 claimable  = STREAM_AMOUNT / 4;
        uint256 remainder  = STREAM_AMOUNT - claimable;

        uint256 aliceBalBefore  = usdc.balanceOf(alice);
        uint256 streamBalBefore = usdc.balanceOf(address(stream));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(stream));
        // StreamStopped(id, owner, claimedToBasket, returnedToWallet)
        emit BasketStream.StreamStopped(id, alice, claimable, remainder);
        stream.stopStream(id, 0, 0);

        // claimable went to basket
        assertEq(mockBasket.credited(alice), claimable, "claimable credited");

        // remainder returned to alice
        assertEq(
            usdc.balanceOf(alice),
            aliceBalBefore + remainder,
            "remainder returned"
        );

        // stream contract balance drops by full STREAM_AMOUNT
        assertEq(
            usdc.balanceOf(address(stream)),
            streamBalBefore - STREAM_AMOUNT,
            "stream balance cleared"
        );

        // stream marked stopped
        (, , , , , bool stopped) = stream.streams(id);
        assertTrue(stopped, "stream stopped");
    }

    function test_StopStream_FullyElapsed_AllClaimableNoRemainder() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D); // 100 % elapsed

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(stream));
        emit BasketStream.StreamStopped(id, alice, STREAM_AMOUNT, 0);
        stream.stopStream(id, 0, 0);

        // everything goes to basket
        assertEq(mockBasket.credited(alice), STREAM_AMOUNT, "all to basket");
        // alice gets nothing back (remainder = 0)
        assertEq(usdc.balanceOf(alice), aliceBalBefore, "alice not refunded");
    }

    function test_StopStream_AtT0_AllReturnedToWallet() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        // no time passes → claimable = 0, remainder = STREAM_AMOUNT

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(stream));
        emit BasketStream.StreamStopped(id, alice, 0, STREAM_AMOUNT);
        stream.stopStream(id, 0, 0);

        // nothing credited to basket
        assertEq(mockBasket.credited(alice), 0, "nothing to basket");
        assertEq(mockBasket.depositCallCount(), 0, "no deposit call");

        // entire amount returned
        assertEq(usdc.balanceOf(alice), aliceBalBefore + STREAM_AMOUNT, "all returned");
    }

    function test_StopStream_MovedToBasketEvent_EmittedForClaimable() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        uint256 claimable = STREAM_AMOUNT / 2;

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(stream));
        emit BasketStream.MovedToBasket(id, alice, claimable);
        stream.stopStream(id, 0, 0);
    }

    // =========================================================================
    // stopStream — revert paths
    // =========================================================================

    function test_StopStream_RevertNonOwner() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);

        vm.prank(stranger);
        vm.expectRevert(bytes("BasketStream: not owner"));
        stream.stopStream(id, 0, 0);
    }

    function test_StopStream_RevertAlreadyStopped() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        vm.prank(alice);
        stream.stopStream(id, 0, 0);

        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: stopped"));
        stream.stopStream(id, 0, 0);
    }

    // =========================================================================
    // stopStream — resilience: when basket.depositUsdcFor reverts
    // the user gets ALL usdc back (claimable + remainder)
    // =========================================================================

    function test_StopStream_Resilience_BasketReverts_UserGetsAllUsdc() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 4); // 25 % claimable

        uint256 claimable = STREAM_AMOUNT / 4;
        uint256 remainder = STREAM_AMOUNT - claimable;

        mockBasket.setShouldRevert(true);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        // StreamStopped is still emitted with original claimable/remainder values
        vm.expectEmit(true, true, false, true, address(stream));
        emit BasketStream.StreamStopped(id, alice, claimable, remainder);
        stream.stopStream(id, 0, 0);

        // alice gets back the full STREAM_AMOUNT (claimable + remainder)
        assertEq(
            usdc.balanceOf(alice),
            aliceBalBefore + STREAM_AMOUNT,
            "alice gets all USDC back when basket reverts"
        );

        // nothing credited in basket
        assertEq(mockBasket.credited(alice), 0, "nothing credited to basket");

        // stream is still stopped
        (, , , , , bool stopped) = stream.streams(id);
        assertTrue(stopped, "stream is stopped");
    }

    function test_StopStream_Resilience_AllowanceClearedAfterBasketRevert() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);

        mockBasket.setShouldRevert(true);

        vm.prank(alice);
        stream.stopStream(id, 0, 0);

        // catch branch must have called forceApprove(basket, 0)
        assertEq(
            usdc.allowance(address(stream), address(mockBasket)),
            0,
            "allowance cleared after basket revert"
        );
    }

    // =========================================================================
    // fuzz: stopStream conservation — alice always recovers exactly STREAM_AMOUNT
    // (split between basket credit and wallet refund)
    // =========================================================================

    function testFuzz_StopStream_Conservation(uint64 warpSeconds) public {
        warpSeconds = uint64(bound(warpSeconds, 0, DUR_7D));
        uint256 id = _startStream(STREAM_AMOUNT, DUR_7D);
        skip(warpSeconds);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        stream.stopStream(id, 0, 0);

        uint256 walletRefund = usdc.balanceOf(alice) - aliceBalBefore;
        uint256 basketCredit = mockBasket.credited(alice);

        assertEq(walletRefund + basketCredit, STREAM_AMOUNT, "conservation: total == STREAM_AMOUNT");
    }
}
