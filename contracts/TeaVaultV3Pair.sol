// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";

import "./interface/ITeaVaultV3Pair.sol";
import "./VaultUtils.sol";

contract TeaVaultV3Pair is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20Upgradeable,
    ITeaVaultV3Pair
{
    using SafeERC20Upgradeable for ERC20Upgradeable;
    using FullMath for uint256;
    using SafeCastUpgradeable for uint256;

    uint256 public SECONDS_IN_A_YEAR;
    uint256 public DECIMALS_MULTIPLIER;
    uint8 internal DECIMALS;
    uint8 internal MAX_POSITION_LENGTH;

    address public manager;
    Position[] public positions;
    FeeConfig public feeConfig;

    IUniswapV3Pool public pool;
    ERC20Upgradeable internal token0;
    ERC20Upgradeable internal token1;

    uint256 private callbackStatus;
    uint256 public lastCollectManagementFee;

    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _factory,
        address _token0,
        address _token1,
        uint24 _feeTier,
        address _owner
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        __ReentrancyGuard_init();
        __ERC20_init(_name, _symbol);
        
        uint8 DECIMALS_OFFSET = 12;
        SECONDS_IN_A_YEAR = 365 * 24 * 60 * 60;
        DECIMALS_MULTIPLIER = 10 ** DECIMALS_OFFSET;
        MAX_POSITION_LENGTH = 5;

        IUniswapV3Factory factory = IUniswapV3Factory(_factory);
        PoolAddress.PoolKey memory poolKey = PoolAddress.getPoolKey(_token0, _token1, _feeTier);
        pool = IUniswapV3Pool(PoolAddress.computeAddress(address(factory), poolKey));
        token0 = ERC20Upgradeable(poolKey.token0);
        token1 = ERC20Upgradeable(poolKey.token1);
        DECIMALS = DECIMALS_OFFSET + token0.decimals();

        callbackStatus = 1;
        transferOwnership(_owner);

        emit TeaVaultV3PairCreated(address(this));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    /// @inheritdoc ITeaVaultV3Pair
    function setFeeConfig(FeeConfig calldata _feeConfig) external override onlyOwner {
        if (_feeConfig.entryFee + _feeConfig.exitFee > 1000000) revert InvalidFeePercentage();
        if (_feeConfig.performanceFee > 1000000) revert InvalidFeePercentage();
        if (_feeConfig.managementFee > 1000000) revert InvalidFeePercentage();

        feeConfig = _feeConfig;

        emit FeeConfigChanged(msg.sender, block.timestamp, _feeConfig);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function assignManager(address _manager) external override onlyOwner {
        manager = _manager;
        emit ManagerChanged(msg.sender, _manager);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function collectManagementFee() external onlyManager returns (uint256 collectedShares) {
        return _collectManagementFee();
    }

    function _collectManagementFee() internal returns (uint256 collectedShares) {
        if (lastCollectManagementFee != 0) {
            uint256 timeDiff = block.timestamp - lastCollectManagementFee;

            unchecked {
                uint256 feeTimesTimediff = feeConfig.managementFee * timeDiff;
                uint256 denominator = (
                    1000000 * SECONDS_IN_A_YEAR > feeTimesTimediff?
                        1000000 * SECONDS_IN_A_YEAR - feeTimesTimediff:
                        1
                );
                collectedShares = totalSupply().mulDivRoundingUp(feeTimesTimediff, denominator);
            }

            _mint(feeConfig.vault, collectedShares);
            emit ManagementFeeCollected(collectedShares);
        }
        lastCollectManagementFee = block.timestamp;
    }

    /// @inheritdoc ITeaVaultV3Pair
    function deposit(
        uint256 _shares,
        uint256 _amount0Max,
        uint256 _amount1Max
    ) external override nonReentrant returns (uint256 depositedAmount0, uint256 depositedAmount1) {
        if (_shares == 0) revert InvalidShareAmount();
        uint256 totalShares = totalSupply();

        if (totalShares == 0) {
            depositedAmount0 = _shares / DECIMALS_MULTIPLIER;
            token0.safeTransferFrom(msg.sender, address(this), depositedAmount0);
        }
        else {
            _collectManagementFee();

            uint256 positionLength = positions.length;
            uint256 amount0;
            uint256 amount1;
            uint128 liquidity;
            bytes memory callbackData = abi.encode(msg.sender);

            for (uint256 i; i < positionLength; i++) {
                Position storage position = positions[i];
                pool.burn(position.tickLower, position.tickUpper, 0);
                _collect(position.tickLower, position.tickUpper);

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
        if (depositedAmount0 > _amount0Max || depositedAmount1 > _amount1Max) revert InvalidPriceSlippage();
        _mint(msg.sender, _shares);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function withdraw(
        uint256 _shares,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) external override nonReentrant returns (uint256 withdrawnAmount0, uint256 withdrawnAmount1) {
        if (_shares == 0) revert InvalidShareAmount();
        _burn(msg.sender, _shares);
        _collectManagementFee();

        uint256 totalShares = totalSupply();
        uint256 positionLength = positions.length;
        uint256 amount0;
        uint256 amount1;

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            int24 tickLower = position.tickLower;
            int24 tickUpper = position.tickUpper;
            uint128 liquidity = uint256(position.liquidity).mulDiv(_shares, totalShares).toUint128();

            (amount0, amount1) = _removeLiquidity(tickLower, tickUpper, liquidity);
            _collect(tickLower, tickUpper);
            withdrawnAmount0 += amount0;
            withdrawnAmount1 += amount1;
        }

        withdrawnAmount0 += token0.balanceOf(address(this)).mulDiv(_shares, totalShares);
        withdrawnAmount1 += token1.balanceOf(address(this)).mulDiv(_shares, totalShares);
        if (withdrawnAmount0 < _amount0Min || withdrawnAmount1 < _amount1Min) revert InvalidPriceSlippage();

        token0.safeTransfer(msg.sender, withdrawnAmount0);
        token1.safeTransfer(msg.sender, withdrawnAmount1);
        
        emit withdrawShares(msg.sender, _shares, withdrawnAmount0, withdrawnAmount1);
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
        uint128 liquidity;
        uint256 positionLength = positions.length;
        uint256 i;

        for (; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                (amount0, amount1) = _addLiquidity(_tickLower, _tickUpper, _liquidity, _amount0Min, _amount1Min);
                position.liquidity += liquidity;

                return (amount0, amount1);
            }
        }

        if (i == MAX_POSITION_LENGTH) revert PositionLengthExceedsLimit();

        (amount0, amount1) = _addLiquidity(_tickLower, _tickUpper, _liquidity, _amount0Min, _amount1Min);
        positions.push(Position({
            tickLower: _tickLower,
            tickUpper: _tickUpper,
            liquidity: liquidity
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

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                (amount0, amount1) = _removeLiquidity(_tickLower, _tickUpper, _liquidity);
                if (amount0 < _amount0Min || amount1 < _amount1Min) revert InvalidPriceSlippage();
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

        revert PositionNotExist();
    }

    /// @inheritdoc ITeaVaultV3Pair
    function collectPositionSwapFee(
        int24 _tickLower,
        int24 _tickUpper
    ) external onlyManager returns (uint128 amount0, uint128 amount1) {
        uint256 positionLength = positions.length;

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                pool.burn(_tickLower, _tickUpper, 0);
                return _collect(_tickLower, _tickUpper);
            }
        }

        revert PositionNotExist();
    }

    /// @inheritdoc ITeaVaultV3Pair
    function collectAllSwapFee() external onlyManager returns (uint128 amount0, uint128 amount1) {
        uint256 positionLength = positions.length;
        uint128 _amount0;
        uint128 _amount1;

        for (uint256 i; i < positionLength; i++) {
            Position storage position = positions[i];
            pool.burn(position.tickLower, position.tickUpper, 0);
            (_amount0, _amount1) = _collect(position.tickLower, position.tickUpper);
            unchecked {
                amount0 += _amount0;
                amount1 += _amount1;
            }
        }
    }

    function _addLiquidity(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _liquidity,
        uint256 _amount0Min,
        uint256 _amount1Min
    ) internal returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _addLiquidity(_tickLower, _tickUpper, _liquidity, "");
        if (amount0 < _amount0Min || amount1 < _amount1Min) revert InvalidPriceSlippage();
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
        if(amountOut < _amountOutMin) revert InvalidPriceSlippage();

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
        if (_maxPriceInSqrtPriceX96 == 0 && amountOutReceived != _amountOut) revert InvalidPriceSlippage();
        if (amountIn > _amountInMax) revert InvalidPriceSlippage();

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

        if (isExactInput) {
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
        for (uint256 i; i < positions.length; i++) {
            Position storage position = positions[i];
            if (position.tickLower == _tickLower && position.tickUpper == _tickUpper) {
                return VaultUtils.positionInfo(address(this), pool, positions[i]);
            }
        }

        revert PositionNotExist();
    }

    /// @inheritdoc ITeaVaultV3Pair
    function positionInfo(
        uint256 _index
    ) external override view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        if (_index >= positions.length) revert PositionNotExist();
        return VaultUtils.positionInfo(address(this), pool, positions[_index]);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function allPositionInfo() external override view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        return _allPositionInfo();
    }

    function _allPositionInfo() internal view returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        uint256 _amount0;
        uint256 _amount1;
        uint256 _fee0;
        uint256 _fee1;

        for (uint256 i; i < positions.length; i++) {
            (_amount0, _amount1, _fee0, _fee1) = VaultUtils.positionInfo(address(this), pool, positions[i]);
            amount0 += _amount0;
            amount1 += _amount1;
            fee0 += _fee0;
            fee1 += _fee1;
        }
    }

    /// @inheritdoc ITeaVaultV3Pair
    function vaultAllUnderlyingAssets() external override view returns (uint256 amount0, uint256 amount1) {
        return _vaultAllUnderlyingAssets();
    }

    function _vaultAllUnderlyingAssets() internal view returns (uint256 amount0, uint256 amount1) {
        (uint256 _amount0, uint256 _amount1, uint256 _fee0, uint256 _fee1) = _allPositionInfo();
        amount0 = _amount0 + _fee0;
        amount1 = _amount1 + _fee1;
    }
    

    /// @inheritdoc ITeaVaultV3Pair
    function estimatedValueInToken0() external override view returns (uint256 value0) {
        (uint256 _amount0, uint256 _amount1) = _vaultAllUnderlyingAssets();
        value0 = VaultUtils.estimatedValueInToken0(pool, _amount0, _amount1);
    }

    /// @inheritdoc ITeaVaultV3Pair
    function estimatedValueInToken1() external override view returns (uint256 value1) {
        (uint256 _amount0, uint256 _amount1) = _vaultAllUnderlyingAssets();
        value1 = VaultUtils.estimatedValueInToken1(pool, _amount0, _amount1);
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