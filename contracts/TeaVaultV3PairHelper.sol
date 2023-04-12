// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interface/ITeaVaultV3PairHelper.sol";
import "./interface/IWETH9.sol";

contract TeaVaultV3PairHelper is ITeaVaultV3PairHelper {

    using SafeERC20 for IERC20;

    event DepositETH(address indexed sender, address indexed recipient, uint256 shares, uint256 amount0, uint256 amount1);

    IWETH9 immutable weth9;

    constructor(address _weth9) {
        weth9 = IWETH9(_weth9);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            results[i] = Address.functionDelegateCall(address(this), data[i]);
        }
        return results;
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function convertAndTransferToken(address _token, uint256 _amount) external payable {
        weth9.deposit{ value: msg.value }();
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function transferTokens(address _token0, uint256 _amount0, address _token1, uint256 _amount1) external {
        IERC20(_token0).safeTransferFrom(msg.sender, address(this), _amount0);
        IERC20(_token1).safeTransferFrom(msg.sender, address(this), _amount1);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function deposit(
        ITeaVaultV3Pair _vault,
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external returns (uint256 depositedAmount0, uint256 depositedAmount1) {
        IERC20 token0 = IERC20(_vault.assetToken0());
        IERC20 token1 = IERC20(_vault.assetToken1());

        token0.safeApprove(address(_vault), type(uint256).max);
        token1.safeApprove(address(_vault), type(uint256).max);
        (depositedAmount0, depositedAmount1) = _vault.deposit(_shares, _amount0Max, _amount1Max);
        token0.safeApprove(address(_vault), 1);
        token1.safeApprove(address(_vault), 1);

        IERC20(address(_vault)).safeTransfer(msg.sender, _shares);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function withdraw(
        ITeaVaultV3Pair _vault,        
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external returns (uint256 withdrawnAmount0, uint256 withdrawnAmount1) {
        IERC20(address(_vault)).safeTransferFrom(msg.sender, address(this), _shares);
        (withdrawnAmount0, withdrawnAmount1) = _vault.withdraw(_shares, _amount0Min, _amount1Min);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function convertAndRefundToken(address _token) external {
        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(msg.sender, balance);

        balance = weth9.balanceOf(address(this));
        weth9.withdraw(balance);

        Address.sendValue(payable(msg.sender), address(this).balance);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function refundTokens(address _token0, address _token1) external {
        uint256 balance = IERC20(_token0).balanceOf(address(this));
        IERC20(_token0).safeTransfer(msg.sender, balance);
        balance = IERC20(_token1).balanceOf(address(this));
        IERC20(_token1).safeTransfer(msg.sender, balance);
    }
}
