// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interface/ITeaVaultV3Pair.sol";
import "../interface/IGenericRouter1Inch.sol";

library GenericRouter1Inch {

    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice swap tokens using 1Inch router via ClipperRouter
    /// @param srcToken Source token
    /// @param dstToken Destination token
    /// @param inputAmount Amount of source tokens to swap
    /// @param outputAmount Amount of destination tokens to receive
    /// @param goodUntil Timestamp until the swap will be valid
    /// @param r Clipper order signature (r part)
    /// @param vs Clipper order signature (vs part)
    /// @return returnAmount Amount of destination tokens received
    function clipperSwap(
        IGenericRouter1Inch router1Inch,
        IERC20Upgradeable token0,
        IERC20Upgradeable token1,
        uint256 minAmount,
        address clipperExchange,
        address srcToken,
        address dstToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 goodUntil,
        bytes32 r,
        bytes32 vs
    ) external returns(uint256 returnAmount) {
        if (srcToken == address(token0)) {
            // perform actual swap
            token0.safeApprove(address(router1Inch), inputAmount);
            uint256 token1BalanceBefore = token1.balanceOf(address(this));
            returnAmount = router1Inch.clipperSwap(clipperExchange, srcToken, dstToken, inputAmount, outputAmount, goodUntil, r, vs);
            uint256 token1BalanceAfter = token1.balanceOf(address(this));
            uint256 convertedAmount = token1BalanceAfter - token1BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
        else {
            // perform actual swap
            token1.safeApprove(address(router1Inch), inputAmount);
            uint256 token0BalanceBefore = token0.balanceOf(address(this));
            returnAmount = router1Inch.clipperSwap(clipperExchange, srcToken, dstToken, inputAmount, outputAmount, goodUntil, r, vs);
            uint256 token0BalanceAfter = token0.balanceOf(address(this));
            uint256 convertedAmount = token0BalanceAfter - token0BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
    }

    /// @notice swap tokens using 1Inch router via GenericRouter
    /// @param executor Aggregation executor that executes calls described in `data`
    /// @param desc Swap description
    /// @param permit Should contain valid permit that can be used in `IERC20Permit.permit` calls.
    /// @param data Encoded calls that `caller` should execute in between of swaps
    /// @return returnAmount Resulting token amount
    /// @return spentAmount Source token amount        
    function swap(
        IGenericRouter1Inch router1Inch,
        IERC20Upgradeable token0,
        IERC20Upgradeable token1,
        uint256 minAmount,
        address executor,
        IGenericRouter1Inch.SwapDescription calldata desc,
        bytes calldata permit,
        bytes calldata data
    ) external returns (uint256 returnAmount, uint256 spentAmount) {
        if (desc.srcToken == address(token0)) {
            // perform actual swap
            token0.safeApprove(address(router1Inch), desc.amount);
            uint256 token1BalanceBefore = token1.balanceOf(address(this));
            (returnAmount, spentAmount) = router1Inch.swap(executor, desc, permit, data);
            uint256 token1BalanceAfter = token1.balanceOf(address(this));
            uint256 convertedAmount = token1BalanceAfter - token1BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
        else {
            // perform actual swap
            token1.safeApprove(address(router1Inch), desc.amount);
            uint256 token0BalanceBefore = token0.balanceOf(address(this));
            (returnAmount, spentAmount) = router1Inch.swap(executor, desc, permit, data);
            uint256 token0BalanceAfter = token0.balanceOf(address(this));
            uint256 convertedAmount = token0BalanceAfter - token0BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
    }

    /// @notice Swap tokens using 1Inch router via unoswap (for UniswapV2)
    /// @param srcToken Source token
    /// @param amount Amount of source tokens to swap
    /// @param minReturn Minimal allowed returnAmount to make transaction commit
    /// @param pools Pools chain used for swaps. Pools src and dst tokens should match to make swap happen
    function unoswap(
        IGenericRouter1Inch router1Inch,
        IERC20Upgradeable token0,
        IERC20Upgradeable token1,
        uint256 minAmount,        
        address srcToken,
        uint256 amount,
        uint256 minReturn,
        uint256[] calldata pools
    ) external returns(uint256 returnAmount) {
        if (srcToken == address(token0)) {
            // perform actual swap
            token0.safeApprove(address(router1Inch), amount);
            uint256 token1BalanceBefore = token1.balanceOf(address(this));
            (returnAmount) = router1Inch.unoswap(srcToken, amount, minReturn, pools);
            uint256 token1BalanceAfter = token1.balanceOf(address(this));
            uint256 convertedAmount = token1BalanceAfter - token1BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
        else {
            // perform actual swap
            token1.safeApprove(address(router1Inch), amount);
            uint256 token0BalanceBefore = token0.balanceOf(address(this));
            (returnAmount) = router1Inch.unoswap(srcToken, amount, minReturn, pools);
            uint256 token0BalanceAfter = token0.balanceOf(address(this));
            uint256 convertedAmount = token0BalanceAfter - token0BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
    }

    /// @notice Swap tokens using 1Inch router via UniswapV3
    /// @param amount Amount of source tokens to swap
    /// @param minReturn Minimal allowed returnAmount to make transaction commit
    /// @param pools Pools chain used for swaps. Pools src and dst tokens should match to make swap happen
    function uniswapV3Swap(
        IGenericRouter1Inch router1Inch,
        IERC20Upgradeable token0,
        IERC20Upgradeable token1,
        bool zeroForOne,
        uint256 minAmount,        
        uint256 amount,
        uint256 minReturn,
        uint256[] calldata pools
    ) external returns(uint256 returnAmount) {
        if (zeroForOne) {
            // perform actual swap
            token0.safeApprove(address(router1Inch), amount);
            uint256 token1BalanceBefore = token1.balanceOf(address(this));
            (returnAmount) = router1Inch.uniswapV3Swap(amount, minReturn, pools);
            uint256 token1BalanceAfter = token1.balanceOf(address(this));
            uint256 convertedAmount = token1BalanceAfter - token1BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
        else {
            // perform actual swap
            token1.safeApprove(address(router1Inch), amount);
            uint256 token0BalanceBefore = token0.balanceOf(address(this));
            (returnAmount) = router1Inch.uniswapV3Swap(amount, minReturn, pools);
            uint256 token0BalanceAfter = token0.balanceOf(address(this));
            uint256 convertedAmount = token0BalanceAfter - token0BalanceBefore;
            if (convertedAmount < minAmount) {
                revert ITeaVaultV3Pair.InsufficientSwapResult(minAmount, convertedAmount);
            }
        }
    }
}
