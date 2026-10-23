// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20 ^0.8.24;

// node_modules/@openzeppelin/contracts/utils/Context.sol

// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// node_modules/@openzeppelin/contracts/utils/Errors.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/Errors.sol)

/**
 * @dev Collection of common custom errors used in multiple contracts
 *
 * IMPORTANT: Backwards compatibility is not guaranteed in future versions of the library.
 * It is recommended to avoid relying on the error API for critical functionality.
 *
 * _Available since v5.1._
 */
library Errors {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error InsufficientBalance(uint256 balance, uint256 needed);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedCall();

    /**
     * @dev The deployment failed.
     */
    error FailedDeployment();

    /**
     * @dev A necessary precompile is missing.
     */
    error MissingPrecompile(address);
}

// node_modules/@openzeppelin/contracts/utils/introspection/IERC165.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/introspection/IERC165.sol)

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol

// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}

// node_modules/@openzeppelin/contracts/utils/Address.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/Address.sol)

/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev There's no code at `target` (it is not a contract).
     */
    error AddressEmptyCode(address target);

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://consensys.net/diligence/blog/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.8.20/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert Errors.InsufficientBalance(address(this).balance, amount);
        }

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert Errors.FailedCall();
        }
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain `call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason or custom error, it is bubbled
     * up by this function (like regular Solidity function calls). However, if
     * the call reverted with no returned reason, this function reverts with a
     * {Errors.FailedCall} error.
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Tool to verify that a low level call to smart-contract was successful, and reverts if the target
     * was not a contract or bubbling up the revert reason (falling back to {Errors.FailedCall}) in case
     * of an unsuccessful call.
     */
    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            // only check if target is a contract if the call was successful and the return data is empty
            // otherwise we already know that it was a contract
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    /**
     * @dev Tool to verify that a low level call was successful, and reverts if it wasn't, either by bubbling the
     * revert reason or with a default {Errors.FailedCall} error.
     */
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    /**
     * @dev Reverts with returndata if present. Otherwise reverts with {Errors.FailedCall}.
     */
    function _revert(bytes memory returndata) private pure {
        // Look for revert reason and bubble it up if present
        if (returndata.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            assembly ("memory-safe") {
                let returndata_size := mload(returndata)
                revert(add(32, returndata), returndata_size)
            }
        } else {
            revert Errors.FailedCall();
        }
    }
}

// node_modules/@openzeppelin/contracts/interfaces/IERC165.sol

// OpenZeppelin Contracts (last updated v5.0.0) (interfaces/IERC165.sol)

// node_modules/@openzeppelin/contracts/interfaces/IERC20.sol

// OpenZeppelin Contracts (last updated v5.0.0) (interfaces/IERC20.sol)

// node_modules/@openzeppelin/contracts/access/Ownable.sol

// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// node_modules/@openzeppelin/contracts/interfaces/IERC1363.sol

// OpenZeppelin Contracts (last updated v5.1.0) (interfaces/IERC1363.sol)

/**
 * @title IERC1363
 * @dev Interface of the ERC-1363 standard as defined in the https://eips.ethereum.org/EIPS/eip-1363[ERC-1363].
 *
 * Defines an extension interface for ERC-20 tokens that supports executing code on a recipient contract
 * after `transfer` or `transferFrom`, or code on a spender contract after `approve`, in a single transaction.
 */
interface IERC1363 is IERC20, IERC165 {
    /*
     * Note: the ERC-165 identifier for this interface is 0xb0202a11.
     * 0xb0202a11 ===
     *   bytes4(keccak256('transferAndCall(address,uint256)')) ^
     *   bytes4(keccak256('transferAndCall(address,uint256,bytes)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256,bytes)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256,bytes)'))
     */

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @param data Additional data with no specified format, sent in call to `spender`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}

// node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol

// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC20/utils/SafeERC20.sol)

/**
 * @title SafeERC20
 * @dev Wrappers around ERC-20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    /**
     * @dev An operation with an ERC-20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     *
     * NOTE: If the token implements ERC-7674, this function will not modify any temporary allowance. This function
     * only sets the "standard" allowance. Any temporary allowance will remain active, in addition to the value being
     * set here.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @dev Performs an {ERC1363} transferAndCall, with a fallback to the simple {ERC20} transfer if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferFromAndCall, with a fallback to the simple {ERC20} transferFrom if the target
     * has no code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} approveAndCall, with a fallback to the simple {ERC20} approve if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * NOTE: When the recipient address (`to`) has no code (i.e. is an EOA), this function behaves as {forceApprove}.
     * Opposedly, when the recipient address (`to`) has code, this function only attempts to call {ERC1363-approveAndCall}
     * once without retrying, and relies on the returned value to be true.
     *
     * Reverts if the returned value is other than `true`.
     */
    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturnBool} that reverts if call fails to meet the requirements.
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            let success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            // bubble errors
            if iszero(success) {
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            returnSize := returndatasize()
            returnValue := mload(0)
        }

        if (returnSize == 0 ? address(token).code.length == 0 : returnValue != 1) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturn} that silently catches all reverts and returns a bool instead.
     */
    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        bool success;
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0)
        }
        return success && (returnSize == 0 ? address(token).code.length > 0 : returnValue == 1);
    }
}

// contracts/Basket.sol

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

