// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interface/ITeaVaultV3PairHelper.sol";
import "./interface/IWETH9.sol";

contract TeaVaultV3PairHelper is ITeaVaultV3PairHelper, Ownable {

    using SafeERC20 for IERC20;

    IGenericRouter1Inch immutable router1Inch;
    IWETH9 immutable weth9;

    ITeaVaultV3Pair private vault;
    IERC20 private token0;
    IERC20 private token1;

    constructor(address _router1Inch, address _weth9) {
        router1Inch = IGenericRouter1Inch(_router1Inch);
        weth9 = IWETH9(_weth9);

        vault = ITeaVaultV3Pair(address(0x1));
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function multicall(
        ITeaVaultV3Pair _vault,
        uint256 _amount0,
        uint256 _amount1,
        bytes[] calldata _data
    ) external payable returns (bytes[] memory results) {
        if (address(vault) != address(0x1)) {
            revert NestedMulticall();
        }

        vault = _vault;
        token0 = IERC20(_vault.assetToken0());
        token1 = IERC20(_vault.assetToken1());

        // convert msg.value into weth9 if necessary
        if (msg.value > 0) {
            // check if either token0 or token1 is weth9, revert if not
            if (address(token0) != address(weth9) && address(token1) != address(weth9)) {
                revert NotWETH9Vault();
            }

            weth9.deposit{ value: msg.value }();
        }

        // transfer tokens from user
        if (_amount0 > 0) {
            token0.safeTransferFrom(msg.sender, address(this), _amount0);
        }

        if (_amount1 > 0) {
            token1.safeTransferFrom(msg.sender, address(this), _amount1);
        }

        // execute commands
        results = new bytes[](_data.length);
        for (uint256 i = 0; i < _data.length; i++) {
            results[i] = Address.functionDelegateCall(address(this), _data[i]);
        }

        // refund all balances
        if (address(this).balance != 0) {
            Address.sendValue(payable(msg.sender), address(this).balance);
        }

        uint256 balance = token0.balanceOf(address(this));
        if (balance > 0) {
            token0.safeTransfer(msg.sender, balance);
        }

        balance = token1.balanceOf(address(this));
        if (balance > 0) {
            token1.safeTransfer(msg.sender, balance);
        }

        vault = ITeaVaultV3Pair(address(0x1));
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function deposit(
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external onlyInMulticall returns (uint256 depositedAmount0, uint256 depositedAmount1) {
        token0.safeApprove(address(vault), type(uint256).max);
        token1.safeApprove(address(vault), type(uint256).max);
        (depositedAmount0, depositedAmount1) = vault.deposit(_shares, _amount0Max, _amount1Max);
        token0.safeApprove(address(vault), 1);
        token1.safeApprove(address(vault), 1);

        IERC20(address(vault)).safeTransfer(msg.sender, _shares);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function withdraw(
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external onlyInMulticall returns (uint256 withdrawnAmount0, uint256 withdrawnAmount1) {
        IERC20(address(vault)).safeTransferFrom(msg.sender, address(this), _shares);
        (withdrawnAmount0, withdrawnAmount1) = vault.withdraw(_shares, _amount0Min, _amount1Min);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function convertWETH() external onlyInMulticall {
        uint256 balance = weth9.balanceOf(address(this));
        weth9.withdraw(balance);
    }

    /// @inheritdoc ITeaVaultV3PairHelper
    function rescueFund(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(msg.sender, _amount);
    }

    /// @inheritdoc IGenericRouter1Inch
    function swap(
        address executor,
        SwapDescription calldata desc,
        bytes calldata permit,
        bytes calldata data
    ) external payable override onlyInMulticall returns (uint256 returnAmount, uint256 spentAmount) {
        if (desc.dstReceiver != address(this)) {
            revert InvalidSwapReceiver();
        }

        return router1Inch.swap(executor, desc, permit, data);
    }

    /// @inheritdoc IGenericRouter1Inch
    function clipperSwap(
        address clipperExchange,
        address srcToken,
        address dstToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 goodUntil,
        bytes32 r,
        bytes32 vs
    ) external payable override onlyInMulticall returns(uint256 returnAmount) {
        return router1Inch.clipperSwap(clipperExchange, srcToken, dstToken, inputAmount, outputAmount, goodUntil, r, vs);
    }

    /// @inheritdoc IGenericRouter1Inch
    function unoswap(
        address srcToken,
        uint256 amount,
        uint256 minReturn,
        uint256[] calldata pools
    ) external payable override onlyInMulticall returns(uint256 returnAmount) {
        return router1Inch.unoswap(srcToken, amount, minReturn, pools);
    }

    /// @inheritdoc IGenericRouter1Inch
    function uniswapV3Swap(
        uint256 amount,
        uint256 minReturn,
        uint256[] calldata pools
    ) external payable override onlyInMulticall returns(uint256 returnAmount) {
        return router1Inch.uniswapV3Swap(amount, minReturn, pools);
    }

    // modifiers
    modifier onlyInMulticall() {
        if (address(vault) == address(0x1)) revert OnlyInMulticall();
        _;
    }
}
