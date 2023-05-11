// SPDX-License-Identifier: BUSL-1.1
// Teahouse Finance

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";

import "./interface/ITeaVaultV3Pair.sol";
import "./interface/IGenericRouter1Inch.sol";
import "./library/VaultUtils.sol";
import "./library/GenericRouter1Inch.sol";

//import "hardhat/console.sol";

contract TeaVaultV3Pair is
    ITeaVaultV3Pair,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20Upgradeable
{
    using SafeERC20Upgradeable for ERC20Upgradeable;
    using FullMath for uint256;
    using SafeCastUpgradeable for uint256;

    uint256 public SECONDS_IN_A_YEAR;
    uint256 public DECIMALS_MULTIPLIER;
    uint256 public FEE_MULTIPLIER;
    uint8 internal DECIMALS;
    uint8 internal MAX_POSITION_LENGTH;

    address public manager;
    Position[] public positions;
    FeeConfig public feeConfig;

    IUniswapV3Pool public pool;
    ERC20Upgradeable private token0;
    ERC20Upgradeable private token1;

    uint256 private callbackStatus;
    uint256 public lastCollectManagementFee;

    IGenericRouter1Inch public router1Inch;

    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _factory,
        address _token0,
        address _token1,
        uint24 _feeTier,
        uint8 _decimalOffset,
        address _owner
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        __ReentrancyGuard_init();
        __ERC20_init(_name, _symbol);

        if (_token0 >= _token1) {
            revert InvalidTokenOrder();
        }
        
        SECONDS_IN_A_YEAR = 365 * 24 * 60 * 60;
        DECIMALS_MULTIPLIER = 10 ** _decimalOffset;
        FEE_MULTIPLIER = 1000000;
        MAX_POSITION_LENGTH = 5;

        IUniswapV3Factory factory = IUniswapV3Factory(_factory);
        pool = IUniswapV3Pool(factory.getPool(_token0, _token1, _feeTier));
        token0 = ERC20Upgradeable(_token0);
        token1 = ERC20Upgradeable(_token1);
        DECIMALS = _decimalOffset + token0.decimals();

        callbackStatus = 1;
        transferOwnership(_owner);

        emit TeaVaultV3PairCreated(address(this));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    function assetToken0() public view override returns (address) {
        return address(token0);
    }

    function assetToken1() public view override returns (address) {
        return address(token1);
    }

    function getToken0Balance() external override view returns (uint256 amount) {
        return token0.balanceOf(address(this));
    }

    function getToken1Balance() external override view returns (uint256 amount) {
        return token1.balanceOf(address(this));
    }

    function getPoolInfo() external view returns (address, address, uint8, uint8, uint24, uint160, int24) {
        uint24 feeTier = pool.fee();
        uint8 decimals0 = token0.decimals();
        uint8 decimals1 = token1.decimals();
        (uint160 sqrtPriceX96, int24 tick, , , , , ) = pool.slot0();

        return (address(token0), address(token1), decimals0, decimals1, feeTier, sqrtPriceX96, tick);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function setFeeConfig(FeeConfig calldata _feeConfig) external override onlyOwner {
        if (_feeConfig.entryFee + _feeConfig.exitFee > FEE_MULTIPLIER) revert InvalidFeePercentage();
        if (_feeConfig.performanceFee > FEE_MULTIPLIER) revert InvalidFeePercentage();
        if (_feeConfig.managementFee > FEE_MULTIPLIER) revert InvalidFeePercentage();

        feeConfig = _feeConfig;

        emit FeeConfigChanged(msg.sender, block.timestamp, _feeConfig);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function assignManager(address _manager) external override onlyOwner {
        manager = _manager;
        emit ManagerChanged(msg.sender, _manager);
    }

    function assignRouter1Inch(address _router1Inch) external onlyOwner {
        router1Inch = IGenericRouter1Inch(_router1Inch);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function collectManagementFee() external onlyManager returns (uint256 collectedShares) {
        return _collectManagementFee();
    }

    /// @dev mint shares as management fee, based on time since last time collected
    /// @dev must be called every time before totalSupply changed
    function _collectManagementFee() internal returns (uint256 collectedShares) {
        uint256 timeDiff = block.timestamp - lastCollectManagementFee;
        if (timeDiff > 0) {
            unchecked {
                uint256 feeTimesTimediff = feeConfig.managementFee * timeDiff;
                uint256 denominator = (
                    FEE_MULTIPLIER * SECONDS_IN_A_YEAR > feeTimesTimediff?
                        FEE_MULTIPLIER * SECONDS_IN_A_YEAR - feeTimesTimediff:
                        1
                );
                collectedShares = totalSupply().mulDivRoundingUp(feeTimesTimediff, denominator);
            }

            if (collectedShares > 0) {
                _mint(feeConfig.vault, collectedShares);
                emit ManagementFeeCollected(collectedShares);
            }

            lastCollectManagementFee = block.timestamp;
        }
    }

    /// @inheritdoc ITeaVaultV3Pair
    function deposit(
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external override nonReentrant returns (uint256 depositedAmount0, uint256 depositedAmount1) {
        if (_shares == 0) revert InvalidShareAmount();
        uint256 totalShares = totalSupply();
        _collectManagementFee();

        if (totalShares == 0) {
            // vault is empty, default to 1:1 share to token0 ratio (offseted by _decimalOffset)
            depositedAmount0 = _shares / DECIMALS_MULTIPLIER;
            token0.safeTransferFrom(msg.sender, address(this), depositedAmount0);
        }
        else {
            _collectAllSwapFee();

            uint256 positionLength = positions.length;
            uint256 amount0;
            uint256 amount1;
            uint128 liquidity;
            bytes memory callbackData = abi.encode(msg.sender);

            for (uint256 i = 0; i < positionLength; i++) {
                Position storage position = positions[i];

                liquidity = uint256(position.liquidity).mulDivRoundingUp(_shares, totalShares).toUint128();
                (amount0, amount1) = _addLiquidity(position.tickLower, position.tickUpper, liquidity, callbackData);

                position.liquidity += liquidity;
                depositedAmount0 += amount0;
                depositedAmount1 += amount1;
            }

            amount0 = token0.balanceOf(address(this)).mulDivRoundingUp(_shares, totalShares);
            amount1 = token1.balanceOf(address(this)).mulDivRoundingUp(_shares, totalShares);
            depositedAmount0 += amount0;
            depositedAmount1 += amount1;
            
            token0.safeTransferFrom(msg.sender, address(this), amount0);
            token1.safeTransferFrom(msg.sender, address(this), amount1);
        }

        // make sure a user can't make a zero amount deposit
        if (depositedAmount0 == 0 && depositedAmount1 == 0) revert InvalidShareAmount();

        // collect entry fee for users
        // do not collect entry fee for fee recipient
        uint256 entryFeeAmount0 = 0;
        uint256 entryFeeAmount1 = 0;

        if (msg.sender != feeConfig.vault) {
            entryFeeAmount0 = depositedAmount0.mulDivRoundingUp(feeConfig.entryFee, FEE_MULTIPLIER);
            entryFeeAmount1 = depositedAmount1.mulDivRoundingUp(feeConfig.entryFee, FEE_MULTIPLIER);

            if (entryFeeAmount0 > 0) {
                token0.safeTransferFrom(msg.sender, feeConfig.vault, entryFeeAmount0);
            }
            
            if (entryFeeAmount1 > 0) {
                token1.safeTransferFrom(msg.sender, feeConfig.vault, entryFeeAmount1);
            }

            depositedAmount0 += entryFeeAmount0;
            depositedAmount1 += entryFeeAmount1;
        }

        // price slippage check
        if (depositedAmount0 > _amount0Max || depositedAmount1 > _amount1Max) revert InvalidPriceSlippage(depositedAmount0, depositedAmount1);
        _mint(msg.sender, _shares);

        emit DepositShares(msg.sender, _shares, depositedAmount0, depositedAmount1, entryFeeAmount0, entryFeeAmount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function withdraw(
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external override nonReentrant returns (uint256 withdrawnAmount0, uint256 withdrawnAmount1) {
        if (_shares == 0) revert InvalidShareAmount();
        uint256 totalShares = totalSupply();
        _collectManagementFee();

        // collect exit fee for users
        // do not collect exit fee for fee recipient
        uint256 exitFeeAmount = 0;
        if (msg.sender != feeConfig.vault) {
            // calculate exit fee
            exitFeeAmount = _shares.mulDivRoundingUp(feeConfig.exitFee, FEE_MULTIPLIER);
            if (exitFeeAmount > 0) {
                _transfer(msg.sender, feeConfig.vault, exitFeeAmount);
            }

            _shares -= exitFeeAmount;
        }

        _burn(msg.sender, _shares);

        uint256 positionLength = positions.length;
        uint256 amount0;
        uint256 amount1;

        // collect all swap fees first
        _collectAllSwapFee();

        // calculate how much percentage of "cash" should be withdrawn
        // need to be done before removing any liquidity positions
        withdrawnAmount0 = token0.balanceOf(address(this)).mulDiv(_shares, totalShares);
        withdrawnAmount1 = token1.balanceOf(address(this)).mulDiv(_shares, totalShares);

        uint256 i;
        for (i = 0; i < positionLength; i++) {
            Position storage position = positions[i];
            int24 tickLower = position.tickLower;
            int24 tickUpper = position.tickUpper;
            uint128 liquidity = uint256(position.liquidity).mulDiv(_shares, totalShares).toUint128();

            (amount0, amount1) = _removeLiquidity(tickLower, tickUpper, liquidity);
            _collect(tickLower, tickUpper);
            withdrawnAmount0 += amount0;
            withdrawnAmount1 += amount1;

            position.liquidity -= liquidity;
        }

        // remove position entries with no liquidity
        i = 0;
        while(i < positions.length) {
            if (positions[i].liquidity == 0) {
                positions[i] = positions[positions.length - 1];
                positions.pop();
            }
            else {
                i++;
            }
        }

        // slippage check
        if (withdrawnAmount0 < _amount0Min || withdrawnAmount1 < _amount1Min) revert InvalidPriceSlippage(withdrawnAmount0, withdrawnAmount1);

        token0.safeTransfer(msg.sender, withdrawnAmount0);
        token1.safeTransfer(msg.sender, withdrawnAmount1);

        emit WithdrawShares(msg.sender, _shares, withdrawnAmount0, withdrawnAmount1, exitFeeAmount);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function addLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min,
        uint64 _deadline
    ) external override checkDeadline(_deadline) onlyManager returns (uint256 amount0, uint256 amount1) {
        uint256 positionLength = positions.length;
        uint256 i;

        for (i = 0; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                (amount0, amount1) = _addLiquidity(_tickLower, _tickUpper, _liquidity, _amount0Min, _amount1Min);
                position.liquidity += _liquidity;

                return (amount0, amount1);
            }
        }

        if (i == MAX_POSITION_LENGTH) revert PositionLengthExceedsLimit();

        (amount0, amount1) = _addLiquidity(_tickLower, _tickUpper, _liquidity, _amount0Min, _amount1Min);
        positions.push(Position({
            tickLower: _tickLower,
            tickUpper: _tickUpper,
            liquidity: _liquidity
        }));
    }

    /// @inheritdoc ITeaVaultV3Pair
    function removeLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min,
        uint64 _deadline
    ) external checkDeadline(_deadline) onlyManager returns (uint256 amount0, uint256 amount1) {
        uint256 positionLength = positions.length;

        for (uint256 i = 0; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                // collect swap fee before remove liquidity to ensure correct calculation of performance fee
                _collectPositionSwapFee(position);

                (amount0, amount1) = _removeLiquidity(_tickLower, _tickUpper, _liquidity);
                if (amount0 < _amount0Min || amount1 < _amount1Min) revert InvalidPriceSlippage(amount0, amount1);
                _collect(_tickLower, _tickUpper);

                if (position.liquidity == _liquidity) {
                    positions[i] = positions[positionLength - 1];
                    positions.pop();
                }
                else {
                    position.liquidity -= _liquidity;
                }

                return (amount0, amount1);
            }
        }

        revert PositionDoesNotExist();
    }

    /// @inheritdoc ITeaVaultV3Pair
    function collectPositionSwapFee(
        int24 _tickLower,
        int24 _tickUpper
    ) external onlyManager returns (uint128 amount0, uint128 amount1) {
        uint256 positionLength = positions.length;

        for (uint256 i = 0; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                return _collectPositionSwapFee(position);
            }
        }

        revert PositionDoesNotExist();
    }

    function _collectPositionSwapFee(Position storage position) internal returns(uint128 amount0, uint128 amount1) {
        pool.burn(position.tickLower, position.tickUpper, 0);
        (amount0, amount1) =  _collect(position.tickLower, position.tickUpper);

        _collectPerformanceFee(amount0, amount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function collectAllSwapFee() external onlyManager returns (uint128 amount0, uint128 amount1) {
        return _collectAllSwapFee();
    }

    function _collectAllSwapFee() internal returns (uint128 amount0, uint128 amount1) {
        uint256 positionLength = positions.length;
        uint128 _amount0;
        uint128 _amount1;

        for (uint256 i = 0; i < positionLength; i++) {
            Position storage position = positions[i];
            pool.burn(position.tickLower, position.tickUpper, 0);
            (_amount0, _amount1) = _collect(position.tickLower, position.tickUpper);
            unchecked {
                amount0 += _amount0;
                amount1 += _amount1;
            }
        }

        _collectPerformanceFee(amount0, amount1);
    }

    function _collectPerformanceFee(uint128 amount0, uint128 amount1) internal {
        uint256 performanceFeeAmount0 = uint256(amount0).mulDivRoundingUp(feeConfig.performanceFee, FEE_MULTIPLIER);
        uint256 performanceFeeAmount1 = uint256(amount1).mulDivRoundingUp(feeConfig.performanceFee, FEE_MULTIPLIER);

        if (performanceFeeAmount0 > 0) {
            token0.safeTransfer(feeConfig.vault, performanceFeeAmount0);
        }

        if (performanceFeeAmount1 > 0) {
            token1.safeTransfer(feeConfig.vault, performanceFeeAmount1);
        }

        emit CollectSwapFees(address(pool), amount0, amount1, performanceFeeAmount0, performanceFeeAmount1);
    }

    function _addLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _addLiquidity(_tickLower, _tickUpper, _liquidity, abi.encode(address(0)));
        if (amount0 < _amount0Min || amount1 < _amount1Min) revert InvalidPriceSlippage(amount0, amount1);
    }

    function _addLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity,
        bytes memory _callbackData
    ) internal checkLiquidity(_liquidity) returns (uint256 amount0, uint256 amount1) {
        callbackStatus = 2;
        (amount0, amount1) = pool.mint(address(this), _tickLower, _tickUpper, _liquidity, _callbackData);
        callbackStatus = 1;
        
        emit AddLiquidity(address(pool), _tickLower, _tickUpper, _liquidity, amount0, amount1);
    }

    function uniswapV3MintCallback(uint256 _amount0Owed, uint256 _amount1Owed, bytes calldata _data) external {
        if (callbackStatus != 2) revert InvalidCallbackStatus();
        if (address(pool) != msg.sender) revert InvalidCallbackCaller();

        address depositor = abi.decode(_data, (address));

        if (_amount0Owed > 0) {
            depositor == address(0)?
                token0.safeTransfer(msg.sender, _amount0Owed):
                token0.safeTransferFrom(depositor, msg.sender, _amount0Owed);
        }

        if (_amount1Owed > 0) {
            depositor == address(0)?
                token1.safeTransfer(msg.sender, _amount1Owed):
                token1.safeTransferFrom(depositor, msg.sender, _amount1Owed);
        }
    }

    function _removeLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity
    ) internal checkLiquidity(_liquidity) returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = pool.burn(_tickLower, _tickUpper, _liquidity);

        emit RemoveLiquidity(address(pool), _tickLower, _tickUpper, _liquidity, amount0, amount1);
    }

    function _collect(int24 _tickLower, int24 _tickUpper) internal returns (uint128 amount0, uint128 amount1) {
        (amount0, amount1) = pool.collect(address(this), _tickLower, _tickUpper, type(uint128).max, type(uint128).max);

        emit Collect(address(pool), _tickLower, _tickUpper, amount0, amount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function swapInputSingle(
        bool _zeroForOne,
        uint256 _amountIn,
        uint256 _amountOutMin,
        uint160 _minPriceInSqrtPriceX96,
        uint64 _deadline
    ) public onlyManager checkDeadline(_deadline) returns (uint256 amountOut) {
        callbackStatus = 2;
        (int256 amount0, int256 amount1) = pool.swap(
            address(this),
            _zeroForOne,
            _amountIn.toInt256(),
            _minPriceInSqrtPriceX96 == 0 
                ? (_zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : _minPriceInSqrtPriceX96,
            abi.encode(_zeroForOne)
        );
        callbackStatus = 1;

        amountOut = uint256(-(_zeroForOne ? amount1 : amount0));
        if(amountOut < _amountOutMin) revert InvalidPriceSlippage(amountOut, 0);

        emit Swap(_zeroForOne, true, _amountIn, amountOut);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function swapOutputSingle(
        bool _zeroForOne,
        uint256 _amountOut,
        uint256 _amountInMax,
        uint160 _maxPriceInSqrtPriceX96,
        uint64 _deadline
    ) public onlyManager checkDeadline(_deadline) returns (uint256 amountIn) {
        callbackStatus = 2;
        (int256 amount0Delta, int256 amount1Delta) = pool.swap(
            address(this),
            _zeroForOne,
            -_amountOut.toInt256(),
            _maxPriceInSqrtPriceX96 == 0
                ? (_zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : _maxPriceInSqrtPriceX96,
            abi.encode(_zeroForOne)
        );
        callbackStatus = 1;

        uint256 amountOutReceived;
        
        (amountIn, amountOutReceived) = _zeroForOne
            ? (uint256(amount0Delta), uint256(-amount1Delta))
            : (uint256(amount1Delta), uint256(-amount0Delta));

        // it's technically possible to not receive the full output amount,
        // so if no price limit has been specified, require this possibility away
        if (_maxPriceInSqrtPriceX96 == 0 && amountOutReceived != _amountOut) revert InvalidPriceSlippage(amountOutReceived, 0);
        if (amountIn > _amountInMax) revert InvalidPriceSlippage(amountIn, 0);

        emit Swap(_zeroForOne, false, amountIn, _amountOut);
    }

    function uniswapV3SwapCallback(int256 _amount0Delta, int256 _amount1Delta, bytes calldata _data) external {
        if (callbackStatus != 2) revert InvalidCallbackStatus();
        if (address(pool) != msg.sender) revert InvalidCallbackCaller();
        if (_amount0Delta == 0 || _amount1Delta == 0) revert SwapInZeroLiquidityRegion();

        bool zeroForOne = abi.decode(_data, (bool));
        (bool isExactInput, uint256 amountToPay) =
            _amount0Delta > 0
                ? (zeroForOne, uint256(_amount0Delta))
                : (!zeroForOne, uint256(_amount1Delta));

        if (isExactInput == zeroForOne) {
            token0.safeTransfer(msg.sender, amountToPay);
        }
        else {
            token1.safeTransfer(msg.sender, amountToPay);
        }
    }

    /// @inheritdoc ITeaVaultV3Pair
    function multicall(bytes[] calldata data) external returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory returndata) = address(this).delegatecall(data[i]);
            results[i] = AddressUpgradeable.verifyCallResult(success, returndata, "Address: low-level delegate call failed");
        }
        return results;
    }

    /// @inheritdoc ITeaVaultV3Pair
    function positionInfo(
        int24 _tickLower,
        int24 _tickUpper
    ) external override view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        for (uint256 i = 0; i < positions.length; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                return VaultUtils.positionInfo(address(this), pool, positions[i]);
            }
        }

        revert PositionDoesNotExist();
    }

    /// @inheritdoc ITeaVaultV3Pair
    function positionInfo(
        uint256 _index
    ) external override view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        if (_index >= positions.length) revert PositionDoesNotExist();
        return VaultUtils.positionInfo(address(this), pool, positions[_index]);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function allPositionInfo() public view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        uint256 _amount0;
        uint256 _amount1;
        uint256 _fee0;
        uint256 _fee1;

        for (uint256 i = 0; i < positions.length; i++) {
            (_amount0, _amount1, _fee0, _fee1) = VaultUtils.positionInfo(address(this), pool, positions[i]);
            amount0 += _amount0;
            amount1 += _amount1;
            fee0 += _fee0;
            fee1 += _fee1;
        }
    }

    /// @inheritdoc ITeaVaultV3Pair
    function vaultAllUnderlyingAssets() public override view returns (uint256 amount0, uint256 amount1) {        
        (uint256 _amount0, uint256 _amount1, uint256 _fee0, uint256 _fee1) = allPositionInfo();
        amount0 = _amount0 + _fee0;
        amount1 = _amount1 + _fee1;
        amount0 = amount0 + token0.balanceOf(address(this));
        amount1 = amount1 + token1.balanceOf(address(this));
    }

    /// @inheritdoc ITeaVaultV3Pair
    function estimatedValueInToken0() external override view returns (uint256 value0) {
        (uint256 _amount0, uint256 _amount1) = vaultAllUnderlyingAssets();
        value0 = VaultUtils.estimatedValueInToken0(pool, _amount0, _amount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function estimatedValueInToken1() external override view returns (uint256 value1) {
        (uint256 _amount0, uint256 _amount1) = vaultAllUnderlyingAssets();
        value1 = VaultUtils.estimatedValueInToken1(pool, _amount0, _amount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function getLiquidityForAmounts(
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint128 liquidity) {
        return VaultUtils.getLiquidityForAmounts(pool, tickLower, tickUpper, amount0, amount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function getAmountsForLiquidity(
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external view returns (uint256 amount0, uint256 amount1) {
        return VaultUtils.getAmountsForLiquidity(pool, tickLower, tickUpper, liquidity);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function getAllPositions() external view returns (Position[] memory results) {
        return positions;
    }

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
        address clipperExchange,
        address srcToken,
        address dstToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 goodUntil,
        bytes32 r,
        bytes32 vs
    ) external nonReentrant onlyManager returns(uint256 returnAmount) {
        if (srcToken != address(token0) && srcToken != address(token1)) {
            revert InvalidSwapToken();
        }

        // simulate using uniswap to find a safe minimum amount
        uint256 minAmount = simulateSwapInputSingle(srcToken == address(token0), inputAmount);
        return GenericRouter1Inch.clipperSwap(
            router1Inch,
            IERC20Upgradeable(token0),
            IERC20Upgradeable(token1),
            minAmount,
            clipperExchange,
            srcToken,
            dstToken,
            inputAmount,
            outputAmount,
            goodUntil,
            r,
            vs
        );
    }

    /// @notice swap tokens using 1Inch router via GenericRouter
    /// @param executor Aggregation executor that executes calls described in `data`
    /// @param desc Swap description
    /// @param permit Should contain valid permit that can be used in `IERC20Permit.permit` calls.
    /// @param data Encoded calls that `caller` should execute in between of swaps
    /// @return returnAmount Resulting token amount
    /// @return spentAmount Source token amount        
    function swap(
        address executor,
        IGenericRouter1Inch.SwapDescription calldata desc,
        bytes calldata permit,
        bytes calldata data
    ) external nonReentrant onlyManager returns (uint256 returnAmount, uint256 spentAmount) {
        if (desc.srcToken != address(token0) && desc.srcToken != address(token1)) {
            revert InvalidSwapToken();
        }

        uint256 minAmount = simulateSwapInputSingle(desc.srcToken == address(token0), desc.amount);
        return GenericRouter1Inch.swap(
            router1Inch,
            IERC20Upgradeable(token0),
            IERC20Upgradeable(token1),
            minAmount,
            executor,
            desc,
            permit,
            data
        );
    }

    /// @notice Swap tokens using 1Inch router via unoswap (for UniswapV2)
    /// @param srcToken Source token
    /// @param amount Amount of source tokens to swap
    /// @param minReturn Minimal allowed returnAmount to make transaction commit
    /// @param pools Pools chain used for swaps. Pools src and dst tokens should match to make swap happen
    function unoswap(
        address srcToken,
        uint256 amount,
        uint256 minReturn,
        uint256[] calldata pools
    ) external nonReentrant onlyManager returns(uint256 returnAmount) {
        if (srcToken != address(token0) && srcToken != address(token1)) {
            revert InvalidSwapToken();
        }

        uint256 minAmount = simulateSwapInputSingle(srcToken == address(token0), amount);
        return GenericRouter1Inch.unoswap(
            router1Inch,
            IERC20Upgradeable(token0),
            IERC20Upgradeable(token1),
            minAmount,
            srcToken,
            amount,
            minReturn,
            pools            
        );
    }

    /// @notice Swap tokens using 1Inch router via UniswapV3
    /// @param amount Amount of source tokens to swap
    /// @param minReturn Minimal allowed returnAmount to make transaction commit
    /// @param pools Pools chain used for swaps. Pools src and dst tokens should match to make swap happen
    function uniswapV3Swap(
        uint256 amount,
        uint256 minReturn,
        uint256[] calldata pools
    ) external nonReentrant onlyManager returns(uint256 returnAmount) {
        uint256 poolData = pools[0];
        bool zeroForOne = poolData & (1 << 255) == 0;
        IUniswapV3Pool swapPool = IUniswapV3Pool(address(uint160(poolData)));

        address srcToken = zeroForOne? swapPool.token0(): swapPool.token1();
        if (srcToken != address(token0) && srcToken != address(token1)) {
            revert InvalidSwapToken();
        }

        // simulate using uniswap
        uint256 minAmount = simulateSwapInputSingle(srcToken == address(token0), amount);
        return GenericRouter1Inch.uniswapV3Swap(
            router1Inch,
            IERC20Upgradeable(token0),
            IERC20Upgradeable(token1),
            srcToken == address(token0),
            minAmount,
            amount,
            minReturn,
            pools
        );
    }

    /// @notice Simulate in-place swap
    /// @param _zeroForOne Swap direction from token0 to token1 or not
    /// @param _amountIn Amount of input token
    /// @return amountOut Output token amount
    function simulateSwapInputSingle(bool _zeroForOne, uint256 _amountIn) internal returns (uint256 amountOut) {
        (bool success, bytes memory returndata) = address(this).delegatecall(
            abi.encodeWithSignature("simulateSwapInputSingleInternal(bool,uint256)", _zeroForOne, _amountIn));
        
        if (success) {
            // shouldn't happen, revert
            revert();
        }
        else {
            if (returndata.length == 0) {
                // no result, revert
                revert();
            }

            amountOut = abi.decode(returndata, (uint256));
        }
    }

    /// @dev Helper function for simulating in-place swap
    /// @dev This function always revert, so there's no point calling it directly
    function simulateSwapInputSingleInternal(bool _zeroForOne, uint256 _amountIn) external onlyManager {
        callbackStatus = 2;
        (bool success, bytes memory returndata) = address(pool).call(
            abi.encodeWithSignature(
                "swap(address,bool,int256,uint160,bytes)",
                address(this),
                _zeroForOne,
                _amountIn.toInt256(),
                _zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
                abi.encode(_zeroForOne)
            )
        );
        callbackStatus = 1;
        
        if (success) {
            (int256 amount0, int256 amount1) = abi.decode(returndata, (int256, int256));
            uint256 amountOut = uint256(-(_zeroForOne ? amount1 : amount0));
            bytes memory data = abi.encode(amountOut);
            assembly {
                revert(add(data, 32), 32)
            }
        }
        else {
            revert();
        }
    }

    // modifiers

    /**
     * @dev Throws if called by any account other than the manager.
     */
    modifier onlyManager() {
        if (msg.sender != manager) revert CallerIsNotManager();
        _;
    }

    modifier checkLiquidity(uint128 _liquidity) {
        if (_liquidity == 0) revert ZeroLiquidity();
        _;
    }

    modifier checkDeadline(uint256 _deadline) {
        if (block.timestamp > _deadline) revert TransactionExpired();
        _;
    }
}