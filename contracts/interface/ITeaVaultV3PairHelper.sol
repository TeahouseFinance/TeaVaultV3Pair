// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import "../interface/ITeaVaultV3Pair.sol";
import "../interface/IGenericRouter1Inch.sol";

interface ITeaVaultV3PairHelper {

    /// @notice Multicall
    /// @param data array of function call data
    /// @return results function call results
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);

    /// @notice Convert ETH to WETH and transfer token from sender to contract
    /// @param _token Token to transfer
    /// @param _amount amount of token to tranfer
    function convertAndTransferToken(address _token, uint256 _amount) external payable;

    /// @notice Transfer tokens from sender to contract
    /// @param _token0 Token0 to transfer
    /// @param _amount0 amount of token0 to tranfer
    /// @param _token1 Token1 to transfer
    /// @param _amount1 amount of token1 to tranfer
    function transferTokens(address _token0, uint256 _amount0, address _token1, uint256 _amount1) external;

    /// @notice Deposit to vault
    /// @param _vault TeaVaultV3Pair to deposit
    /// @param _shares Share amount to be mint
    /// @param _amount0Max Max token0 amount to be deposited
    /// @param _amount1Max Max token1 amount to be deposited
    /// @return depositedAmount0 Deposited token0 amount
    /// @return depositedAmount1 Deposited token1 amount
    function deposit(
        ITeaVaultV3Pair _vault,
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external returns (uint256 depositedAmount0, uint256 depositedAmount1);

    /// @notice Burn shares and withdraw token0 and token1
    /// @param _vault TeaVaultV3Pair to deposit
    /// @param _shares Share amount to be burnt
    /// @param _amount0Min Min token0 amount to be withdrawn
    /// @param _amount1Min Min token1 amount to be withdrawn
    /// @return withdrawnAmount0 Withdrew token0 amount
    /// @return withdrawnAmount1 Withdrew token1 amount
    function withdraw(
        ITeaVaultV3Pair _vault,        
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external returns (uint256 withdrawnAmount0, uint256 withdrawnAmount1);

    /// @notice Convert WETH9 to ETH and refund token and all ETH back to sender
    /// @param _token Token to refund
    function convertAndRefundToken(address _token) external;

    /// @notice Refund tokens back to sender
    /// @param _token0 Token0 to refund
    /// @param _token0 Token1 to refund
    function refundTokens(address _token0, address _token1) external;
}
