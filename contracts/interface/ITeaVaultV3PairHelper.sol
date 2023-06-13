// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import "../interface/ITeaVaultV3Pair.sol";
import "../interface/IGenericRouter1Inch.sol";

interface ITeaVaultV3PairHelper is IGenericRouter1Inch {

    error NestedMulticall();
    error OnlyInMulticall();
    error NotWETH9Vault();
    error InvalidSwapReceiver();

    /// @notice Multicall
    /// @notice This function converts all msg.value into WETH9, and transfer required token amounts from the caller to the contract,
    /// @notice perform the transactions specified in _data, then refund all remaining ETH and tokens back to the caller.
    /// @notice Only ETH and token0 and token1 of the _vault will be refunded, do not swap to, or transfer other tokens to the helper.
    /// @param _vault address of TeaVaultV3Pair vault for this transaction
    /// @param _amount0 Amount of token0 for use in this transaction
    /// @param _amount1 Amount of token1 for use in this transaction
    /// @param _data array of function call data
    /// @return results function call results
    function multicall(
        ITeaVaultV3Pair _vault,
        uint256 _amount0,
        uint256 _amount1,
        bytes[] calldata _data
    ) external payable returns (bytes[] memory results);

    /// @notice Deposit to vault
    /// @notice Can only be called inside multicall
    /// @param _shares Share amount to be mint
    /// @param _amount0Max Max token0 amount to be deposited
    /// @param _amount1Max Max token1 amount to be deposited
    /// @return depositedAmount0 Deposited token0 amount
    /// @return depositedAmount1 Deposited token1 amount
    /// @dev this function is set to payable because multicall is payable
    /// @dev otherwise calls to this function fails as solidity requires msg.value to be 0 for non-payable functions
    function deposit(
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external payable returns (uint256 depositedAmount0, uint256 depositedAmount1);

    /// @notice Burn shares and withdraw token0 and token1
    /// @notice Can only be called inside multicall
    /// @param _shares Share amount to be burnt
    /// @param _amount0Min Min token0 amount to be withdrawn
    /// @param _amount1Min Min token1 amount to be withdrawn
    /// @return withdrawnAmount0 Withdrew token0 amount
    /// @return withdrawnAmount1 Withdrew token1 amount
    /// @dev this function is set to payable because multicall is payable
    /// @dev otherwise calls to this function fails as solidity requires msg.value to be 0 for non-payable functions
    function withdraw(
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external payable returns (uint256 withdrawnAmount0, uint256 withdrawnAmount1);

    /// @notice Convert all WETH9 back to ETH
    /// @notice Can only be called inside multicall
    /// @dev this function is set to payable because multicall is payable
    /// @dev otherwise calls to this function fails as solidity requires msg.value to be 0 for non-payable functions
    function convertWETH() external payable;

    /// @notice Resuce stuck tokens in the contract, send them to the caller
    /// @notice Only owner can call this function.
    /// @notice This is for emergency only. Users should not left tokens in the contract.
    /// @param _token Address of the token
    /// @param _amount Amount to transfer
    function rescueFund(address _token, uint256 _amount) external;
}
