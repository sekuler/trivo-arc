// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBasket {
    function depositUsdcFor(
        address recipient,
        uint256 usdcAmount,
        uint256 minEurc,
        uint256 minBtc
    ) external;
}

contract BasketStream is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IBasket public immutable basket;
    uint256 public nextStreamId;

    struct Stream {
        address owner;
        uint256 total;
        uint256 claimed;
        uint64 startTime;
        uint64 endTime;
        bool stopped;
    }

    mapping(uint256 => Stream) public streams;
    mapping(address => uint256[]) public userStreamIds;

    event StreamStarted(uint256 indexed streamId, address indexed owner, uint256 total, uint64 duration, uint64 endTime);
    event MovedToBasket(uint256 indexed streamId, address indexed owner, uint256 amount);
    event StreamStopped(uint256 indexed streamId, address indexed owner, uint256 claimedToBasket, uint256 returnedToWallet);

    constructor(address _usdc, address _basket) {
        require(_usdc != address(0) && _basket != address(0), "BasketStream: zero address");
        usdc = IERC20(_usdc);
        basket = IBasket(_basket);
        nextStreamId = 1;
    }

    function startStream(uint256 totalUsdc, uint64 duration) external nonReentrant returns (uint256 streamId) {
        require(totalUsdc > 0, "BasketStream: zero amount");
        require(
            duration == 1 hours || duration == 7 days || duration == 1 days || duration == 30 days,
            "BasketStream: invalid duration"
        );

        usdc.safeTransferFrom(msg.sender, address(this), totalUsdc);

        streamId = nextStreamId;
        nextStreamId = streamId + 1;

        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = startTime + duration;

        streams[streamId] = Stream({
            owner: msg.sender,
            total: totalUsdc,
            claimed: 0,
            startTime: startTime,
            endTime: endTime,
            stopped: false
        });

        userStreamIds[msg.sender].push(streamId);

        emit StreamStarted(streamId, msg.sender, totalUsdc, duration, endTime);
    }

    function unlockedAmount(uint256 streamId) public view returns (uint256) {
        Stream memory stream = streams[streamId];

        if (stream.stopped || stream.claimed >= stream.total) {
            return 0;
        }

        uint256 elapsed;
        if (block.timestamp >= stream.endTime) {
            elapsed = uint256(stream.endTime) - uint256(stream.startTime);
        } else {
            elapsed = block.timestamp - uint256(stream.startTime);
        }

        uint256 duration = uint256(stream.endTime) - uint256(stream.startTime);
        uint256 unlocked = (stream.total * elapsed) / duration;

        if (unlocked <= stream.claimed) {
            return 0;
        }

        return unlocked - stream.claimed;
    }

    function moveToBasket(uint256 streamId, uint256 minEurc, uint256 minBtc) external nonReentrant {
        Stream storage stream = streams[streamId];
        require(stream.owner == msg.sender, "BasketStream: not owner");
        require(!stream.stopped, "BasketStream: stopped");

        uint256 amount = unlockedAmount(streamId);
        require(amount > 0, "BasketStream: nothing to move");

        stream.claimed += amount;

        usdc.forceApprove(address(basket), amount);
        try basket.depositUsdcFor(stream.owner, amount, minEurc, minBtc) {
            usdc.forceApprove(address(basket), 0);
        } catch {
            usdc.forceApprove(address(basket), 0);
            revert("BasketStream: basket deposit failed");
        }

        emit MovedToBasket(streamId, stream.owner, amount);
    }

    function stopStream(uint256 streamId, uint256 minEurc, uint256 minBtc) external nonReentrant {
        Stream storage stream = streams[streamId];
        require(stream.owner == msg.sender, "BasketStream: not owner");
        require(!stream.stopped, "BasketStream: stopped");

        uint256 claimable = unlockedAmount(streamId);
        uint256 remaining = stream.total - stream.claimed - claimable;

        stream.stopped = true;
        stream.claimed += claimable;

        uint256 toRefund = remaining;
        if (claimable > 0) {
            usdc.forceApprove(address(basket), claimable);
            try basket.depositUsdcFor(stream.owner, claimable, minEurc, minBtc) {
                emit MovedToBasket(streamId, stream.owner, claimable);
                usdc.forceApprove(address(basket), 0);
            } catch {
                usdc.forceApprove(address(basket), 0);
                toRefund += claimable;
            }
        }

        if (toRefund > 0) {
            usdc.safeTransfer(stream.owner, toRefund);
        }

        emit StreamStopped(streamId, stream.owner, claimable, toRefund);
    }

    function getStreamIds(address user) external view returns (uint256[] memory) {
        return userStreamIds[user];
    }
}
