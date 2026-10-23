// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketStreamBase} from "./BasketStream.Base.t.sol";
import {BasketStream} from "../BasketStream.sol";

/// @dev Tests for startStream, unlockedAmount, and getStreamIds.
contract BasketStreamStreamTest is BasketStreamBase {

    // =========================================================================
    // startStream — happy paths (one for each valid duration)
    // =========================================================================

    function test_StartStream_1h_HappyPath() public {
        uint64 dur = DUR_1H;
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 contractBefore = usdc.balanceOf(address(stream));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(stream));
        emit BasketStream.StreamStarted(
            1, alice, STREAM_AMOUNT, dur, uint64(block.timestamp) + dur
        );
        uint256 id = stream.startStream(STREAM_AMOUNT, dur);

        assertEq(id, 1, "first id is 1");
        assertEq(stream.nextStreamId(), 2, "nextStreamId bumped");

        // USDC transferred to contract
        assertEq(usdc.balanceOf(alice), aliceBefore - STREAM_AMOUNT, "alice debited");
        assertEq(usdc.balanceOf(address(stream)), contractBefore + STREAM_AMOUNT, "contract credited");

        // stream state
        (
            address owner,
            uint256 total,
            uint256 claimed,
            uint64 startTime,
            uint64 endTime,
            bool stopped
        ) = stream.streams(id);

        assertEq(owner,     alice,                         "owner");
        assertEq(total,     STREAM_AMOUNT,                 "total");
        assertEq(claimed,   0,                             "claimed");
        assertEq(startTime, uint64(block.timestamp),       "startTime");
        assertEq(endTime,   uint64(block.timestamp) + dur, "endTime");
        assertFalse(stopped,                               "not stopped");
    }

    function test_StartStream_1d_HappyPath() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        (, , , , uint64 endTime,) = stream.streams(id);
        assertEq(endTime, uint64(block.timestamp) + DUR_1D);
    }

    function test_StartStream_7d_HappyPath() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_7D);
        (, , , , uint64 endTime,) = stream.streams(id);
        assertEq(endTime, uint64(block.timestamp) + DUR_7D);
    }

    function test_StartStream_30d_HappyPath() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_30D);
        (, , , , uint64 endTime,) = stream.streams(id);
        assertEq(endTime, uint64(block.timestamp) + DUR_30D);
    }

    // =========================================================================
    // startStream — revert paths
    // =========================================================================

    function test_StartStream_RevertZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: zero amount"));
        stream.startStream(0, DUR_1H);
    }

    function test_StartStream_RevertInvalidDuration_2h() public {
        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: invalid duration"));
        stream.startStream(STREAM_AMOUNT, 2 hours);
    }

    function test_StartStream_RevertInvalidDuration_0() public {
        vm.prank(alice);
        vm.expectRevert(bytes("BasketStream: invalid duration"));
        stream.startStream(STREAM_AMOUNT, 0);
    }

    function test_StartStream_IncrementIdsAcrossCallers() public {
        uint256 id1 = _startStream(STREAM_AMOUNT, DUR_1H);

        vm.prank(bob);
        uint256 id2 = stream.startStream(STREAM_AMOUNT, DUR_1D);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(stream.nextStreamId(), 3);
    }

    // =========================================================================
    // unlockedAmount
    // =========================================================================

    function test_UnlockedAmount_AtT0_IsZero() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        // same block → 0 elapsed
        assertEq(stream.unlockedAmount(id), 0);
    }

    function test_UnlockedAmount_AtHalfDuration_Is50Pct() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);
        uint256 unlocked = stream.unlockedAmount(id);
        // half elapsed → STREAM_AMOUNT / 2  (exact, since DUR_1D is even)
        assertEq(unlocked, STREAM_AMOUNT / 2);
    }

    function test_UnlockedAmount_AtEndTime_Is100Pct() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D);
        assertEq(stream.unlockedAmount(id), STREAM_AMOUNT);
    }

    function test_UnlockedAmount_AfterEndTime_CappedAt100Pct() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D + 1 days);
        assertEq(stream.unlockedAmount(id), STREAM_AMOUNT, "capped at total");
    }

    function test_UnlockedAmount_OnStoppedStream_IsZero() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);
        vm.prank(alice);
        stream.stopStream(id, 0, 0);
        // after stop unlockedAmount always returns 0
        assertEq(stream.unlockedAmount(id), 0);
    }

    function test_UnlockedAmount_AfterPartialClaim_ReflectsClaimed() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1D);
        skip(DUR_1D / 2);
        // move 50 % to basket
        vm.prank(alice);
        stream.moveToBasket(id, 0, 0);

        // advance another quarter
        skip(DUR_1D / 4);
        uint256 unlocked = stream.unlockedAmount(id);
        // 75 % total elapsed = 750e6, claimed = 500e6 → expected = 250e6
        assertEq(unlocked, STREAM_AMOUNT * 3 / 4 - STREAM_AMOUNT / 2);
    }

    // =========================================================================
    // getStreamIds
    // =========================================================================

    function test_GetStreamIds_Empty() public view {
        uint256[] memory ids = stream.getStreamIds(alice);
        assertEq(ids.length, 0);
    }

    function test_GetStreamIds_SingleStream() public {
        uint256 id = _startStream(STREAM_AMOUNT, DUR_1H);
        uint256[] memory ids = stream.getStreamIds(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
    }

    function test_GetStreamIds_MultipleStreams() public {
        uint256 id1 = _startStream(STREAM_AMOUNT, DUR_1H);
        uint256 id2 = _startStream(STREAM_AMOUNT, DUR_7D);
        uint256[] memory ids = stream.getStreamIds(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], id1);
        assertEq(ids[1], id2);
    }

    function test_GetStreamIds_IsolatedByUser() public {
        _startStream(STREAM_AMOUNT, DUR_1H);

        vm.prank(bob);
        stream.startStream(STREAM_AMOUNT, DUR_7D);

        assertEq(stream.getStreamIds(alice).length, 1);
        assertEq(stream.getStreamIds(bob).length,   1);
    }

    // =========================================================================
    // fuzz: unlockedAmount never exceeds total
    // =========================================================================

    function testFuzz_UnlockedAmount_NeverExceedsTotal(uint64 warpSeconds) public {
        warpSeconds = uint64(bound(warpSeconds, 0, 60 days));
        uint256 id = _startStream(STREAM_AMOUNT, DUR_7D);
        skip(warpSeconds);
        assertLe(stream.unlockedAmount(id), STREAM_AMOUNT);
    }
}
