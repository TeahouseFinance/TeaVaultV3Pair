const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { providers } = require("ethers");
const { network, ethers, upgrades } = require("hardhat");


function loadEnvVar(env, errorMsg) {
    if (env == undefined) {
        throw errorMsg;
    }

    return env;
}

function loadEnvVarInt(env, errorMsg) {
    if (env == undefined) {
        throw errorMsg;
    }

    return parseInt(env);
}


// setup uniswapV3 parameters
const testRpc = loadEnvVar(process.env.UNISWAP_TEST_RPC, "No UNISWAP_TEST_RPC");
const testBlock = loadEnvVarInt(process.env.UNISWAP_TEST_BLOCK, "No UNISWAP_TEST_BLOCK");
const testFactory = loadEnvVar(process.env.UNISWAP_TEST_FACTORY, "No UNISWAP_TEST_FACTORY");
const testToken0 = loadEnvVar(process.env.UNISWAP_TEST_TOKEN0, "No UNISWAP_TEST_TOKEN0");
const testToken1 = loadEnvVar(process.env.UNISWAP_TEST_TOKEN1, "No UNISWAP_TEST_TOKEN1");
const testFeeTier = loadEnvVarInt(process.env.UNISWAP_TEST_FEE_TIER, "No UNISWAP_TEST_FEE_TIER");
const testDecimalOffset = loadEnvVarInt(process.env.UNISWAP_TEST_DECIMAL_OFFSET, "No UNISWAP_TEST_DECIMAL_OFFSET");
const testToken0Whale = loadEnvVar(process.env.UNISWAP_TEST_TOKEN0_WHALE, "No UNISWAP_TEST_TOKEN0_WHALE");
const testToken1Whale = loadEnvVar(process.env.UNISWAP_TEST_TOKEN1_WHALE, "No UNISWAP_TEST_TOKEN1_WHALE");
const test1InchRouter = loadEnvVar(process.env.UNISWAP_TEST_1INCH_ROUTER, "No UNISWAP_TEST_1INCH_ROUTER");
const testWeth = loadEnvVar(process.env.UNISWAP_TEST_WETH, "No UNISWAP_TEST_WETH");

const UINT256_MAX = '0x' + 'f'.repeat(64);
const UINT64_MAX = '0x' + 'f'.repeat(16);


async function deployTeaVaultV3Pair() {
    // fork a testing environment
    await helpers.reset(testRpc, testBlock);

    // Contracts are deployed using the first signer/account by default
    const [owner, manager, user] = await ethers.getSigners();

    // get ERC20 tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    const token0 = MockToken.attach(testToken0);
    const token1 = MockToken.attach(testToken1);

    // get tokens from whale
    await helpers.impersonateAccount(testToken0Whale);
    const token0Whale = await ethers.getSigner(testToken0Whale);
    await helpers.setBalance(token0Whale.address, ethers.utils.parseEther("100"));  // assign some eth to the whale in case it's a contract and not accepting eth
    await token0.connect(token0Whale).transfer(user.address, "100000" + '0'.repeat(await token0.decimals()));

    await helpers.impersonateAccount(testToken1Whale);
    const token1Whale = await ethers.getSigner(testToken1Whale);
    await helpers.setBalance(token1Whale.address, ethers.utils.parseEther("100"));  // assign some eth to the whale in case it's a contract and not accepting eth
    await token1.connect(token1Whale).transfer(user.address, "100000" + '0'.repeat(await token1.decimals()));

    // deploy TeaVaultV3Pair
    const VaultUtils = await ethers.getContractFactory("VaultUtils");
    const vaultUtils = await VaultUtils.deploy();

    const GenericRouter1Inch = await ethers.getContractFactory("GenericRouter1Inch");
    const genericRouter1Inch = await GenericRouter1Inch.deploy();

    const TeaVaultV3Pair = await ethers.getContractFactory("TeaVaultV3Pair", {
        libraries: {
            VaultUtils: vaultUtils.address,
            GenericRouter1Inch: genericRouter1Inch.address,
        },
    });

    const vault = await upgrades.deployProxy(TeaVaultV3Pair,
        [ "Test Vault", "TVault", testFactory, token0.address, token1.address, testFeeTier, testDecimalOffset, owner.address, ],
        { 
            kind: "uups", 
            unsafeAllowLinkedLibraries: true, 
            unsafeAllow: [ 'delegatecall' ],
        }
    );

    return { owner, manager, user, vault, token0, token1 }
}

async function deployTeaVaultV3PairHelper() {
    const { owner, manager, user, vault, token0, token1 } = await deployTeaVaultV3Pair();

    // deploy TeaVaultV3PairHelper
    const TeaVaultV3PairHelper = await ethers.getContractFactory("TeaVaultV3PairHelper");
    const helper = await TeaVaultV3PairHelper.deploy(test1InchRouter, testWeth);

    return { owner, manager, user, vault, helper, token0, token1 };
}

describe("TeaVaultV3Pair", function () {

    describe("Deployment", function() {
        it("Should set the correct tokens", async function () {
            const { vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            expect(await vault.assetToken0()).to.equal(token0.address);
            expect(await vault.assetToken1()).to.equal(token1.address);
        });

        it("Should set the correct decimals", async function () {
            const { vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            const token0Decimals = await token0.decimals();
            expect(await vault.decimals()).to.equal(token0Decimals + testDecimalOffset);
        });
    });

    describe("Owner functions", function() {
        it("Should be able to set fees from owner", async function() {
            const { owner, vault } = await helpers.loadFixture(deployTeaVaultV3Pair);

            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await vault.setFeeConfig(feeConfig);
            const fees = await vault.feeConfig();

            expect(feeConfig.vault).to.equal(fees.vault);
            expect(feeConfig.entryFee).to.equal(fees.entryFee);
            expect(feeConfig.exitFee).to.equal(fees.exitFee);
            expect(feeConfig.performanceFee).to.equal(fees.performanceFee);
            expect(feeConfig.managementFee).to.equal(fees.managementFee);
        });

        it("Should not be able to set incorrect fees", async function() {
            const { owner, vault } = await helpers.loadFixture(deployTeaVaultV3Pair);

            const feeConfig1 = {
                vault: owner.address,
                entryFee: 500001,
                exitFee: 500000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await expect(vault.setFeeConfig(feeConfig1)).to.be.revertedWith("");

            const feeConfig2 = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 1000001,
                managementFee: 10000,
            }

            await expect(vault.setFeeConfig(feeConfig2)).to.be.revertedWith("");

            const feeConfig3 = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 1000001,
            }

            await expect(vault.setFeeConfig(feeConfig3)).to.be.revertedWith("");
        });

        it("Should not be able to set fees from non-owner", async function() {
            const { manager, vault } = await helpers.loadFixture(deployTeaVaultV3Pair);

            const feeConfig = {
                vault: manager.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await expect(vault.connect(manager).setFeeConfig(feeConfig)).to.be.revertedWith("");
        });

        it("Should be able to assign manager from owner", async function() {
            const { manager, vault } = await helpers.loadFixture(deployTeaVaultV3Pair);

            await vault.assignManager(manager.address);
            expect(await vault.manager()).to.equal(manager.address);
        });

        it("Should not be able to assign manager from non-owner", async function() {
            const { manager, vault } = await helpers.loadFixture(deployTeaVaultV3Pair);

            await expect(vault.connect(manager).assignManager(manager.address)).to.be.revertedWith("");            
            expect(await vault.manager()).to.equal("0x" + "0".repeat(40));
        });
    });

    describe("User functions", function() {        
        it("Should be able to deposit and withdraw from user", async function() {
            const { owner, user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await vault.setFeeConfig(feeConfig);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            const token0Amount = "100" + "0".repeat(await token0.decimals());
            let token0Before = await token0.balanceOf(user.address);
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);
            expect(await vault.balanceOf(user.address)).to.equal(shares);
            let token0After = await token0.balanceOf(user.address);

            let expectedAmount0 = ethers.BigNumber.from(token0Amount);
            const entryFeeAmount0 = expectedAmount0.mul(feeConfig.entryFee).div("1000000");
            expectedAmount0 = expectedAmount0.add(entryFeeAmount0);
            expect(token0Before.sub(token0After)).to.equal(expectedAmount0); // user spent expectedAmount0 of token0
            expect(await token0.balanceOf(owner.address)).to.equal(entryFeeAmount0); // vault received entryFeeAmount0 of token0
            const depositTime = await vault.lastCollectManagementFee();

            // withdraw
            token0Before = await token0.balanceOf(user.address);
            await vault.connect(user).withdraw(shares, 0, 0);
            expect(await vault.balanceOf(user.address)).to.equal(0);
            token0After = await token0.balanceOf(user.address);

            const withdrawTime = await vault.lastCollectManagementFee();
            const managementFeeTimeDiff = feeConfig.managementFee * (withdrawTime - depositTime);
            const feeMultiplier = await vault.FEE_MULTIPLIER();
            const secondsInAYear = await vault.SECONDS_IN_A_YEAR();
            const denominator = feeMultiplier * secondsInAYear - managementFeeTimeDiff;
            const managementFee = ethers.BigNumber.from(shares).mul(managementFeeTimeDiff).add(denominator - 1).div(denominator);

            expectedAmount0 = ethers.BigNumber.from(token0Amount);
            const exitFeeAmount0 = expectedAmount0.mul(feeConfig.exitFee).div("1000000");
            const exitFeeShares = ethers.BigNumber.from(shares).mul(feeConfig.exitFee).div("1000000");
            expectedAmount0 = expectedAmount0.sub(exitFeeAmount0);
            expect(token0After.sub(token0Before)).to.equal(expectedAmount0); // user received expectedAmount0 of token0
            expect(await vault.balanceOf(owner.address)).to.equal(exitFeeShares.add(managementFee)); // vault received exitFeeShares and managementFee of share
        });

        it("Should not be able to deposit and withdraw incorrect amounts", async function() {
            const { user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            // deposit without enough allowance
            await token0.connect(user).approve(vault.address, "1000" + "0".repeat(await token0.decimals()));
            const shares = "10000" + "0".repeat(await vault.decimals());
            await expect(vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX)).to.be.revertedWith("");

            const smallerShares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(smallerShares, UINT256_MAX, UINT256_MAX);

            // withdraw more than owned shares
            await expect(vault.connect(user).withdraw(shares, 0, 0)).to.be.revertedWith("");
        });

        it("Should revert with slippage checks when depositing", async function() {
            const { user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            // deposit with slippage check
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            const shares = "10000" + "0".repeat(await vault.decimals());
            await expect(vault.connect(user).deposit(shares, "100", "100")).to.be.revertedWith("");
        });

        it("Should revert with slippage checks when withdrawing", async function() {
            const { user, vault, token0 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            await token0.connect(user).approve(vault.address, "1000" + "0".repeat(await token0.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // withdraw with slippage check
            await expect(vault.connect(user).withdraw(shares, "100", "100")).to.be.revertedWith("");
        });

        it("Should be able to add and remove positions after deposit", async function() {
            const { owner, manager, user, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // get pool info
            const factory = await ethers.getContractAt("IUniswapV3Factory", testFactory);
            const poolAddr = await factory.getPool(testToken0, testToken1, testFeeTier);
            const pool = await ethers.getContractAt("IUniswapV3Pool", poolAddr);
            const slot0 = await pool.slot0();
            const tickSpacing = await pool.tickSpacing();

            // swap
            await vault.connect(manager).swapInputSingle(
                true,
                "50" + "0".repeat(await token0.decimals()),
                0,
                0,
                UINT64_MAX
            );

            let amount0 = await token0.balanceOf(vault.address);
            let amount1 = await token1.balanceOf(vault.address);

            // add positions
            const tick0 = Math.floor((slot0.tick - tickSpacing * 30) / tickSpacing) * tickSpacing;
            const tick1 = Math.ceil((slot0.tick - tickSpacing * 10) / tickSpacing) * tickSpacing;
            const tick2 = Math.ceil((slot0.tick + tickSpacing * 10) / tickSpacing) * tickSpacing;
            const tick3 = Math.ceil((slot0.tick + tickSpacing * 30) / tickSpacing) * tickSpacing;

            // add "center" position
            const liquidity1 = await vault.getLiquidityForAmounts(tick1, tick2, amount0.div(3), amount1.div(3));
            await vault.connect(manager).addLiquidity(tick1, tick2, liquidity1, 0, 0, UINT64_MAX);

            // add "lower" position
            amount1 = await token1.balanceOf(vault.address);
            const liquidity0 = await vault.getLiquidityForAmounts(tick0, tick1, 0, amount1);
            await vault.connect(manager).addLiquidity(tick0, tick1, liquidity0, 0, 0, UINT64_MAX);

            // add "upper" position
            amount0 = await token0.balanceOf(vault.address);
            const liquidity2 = await vault.getLiquidityForAmounts(tick2, tick3, amount0, 0);
            await vault.connect(manager).addLiquidity(tick2, tick3, liquidity2, 0, 0, UINT64_MAX);

            // add more liquidity
            const shares2 = "1000" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares2, UINT256_MAX, UINT256_MAX);

            // reduce some position
            const position1 = await vault.positions(1);
            await vault.connect(manager).removeLiquidity(position1.tickLower, position1.tickUpper, position1.liquidity, 0, 0, UINT64_MAX);

            // check vault values
            const investedToken0 = ethers.BigNumber.from("1100" + "0".repeat(await token0.decimals()));            
            const values = await vault.vaultAllUnderlyingAssets();
            // expect amount0 to be > 45% of invested token0
            expect(values.amount0.gt(investedToken0.mul(45).div(100))).to.be.true;
            
            const valueInToken0 = await vault.estimatedValueInToken0();
            const valueInToken1 = await vault.estimatedValueInToken1();
            // expect total value in token0 to be > 95% of invested token0
            expect(valueInToken0.gt(investedToken0.mul(95).div(100))).to.be.true;
            // expect total value in token1 to be > 190% of value in token1
            expect(valueInToken1.gt(values.amount1.mul(190).div(100))).to.be.true;

            // withdraw
            const amount0Before = await token0.balanceOf(user.address);
            const amount1Before = await token1.balanceOf(user.address);
            const totalShares = await vault.balanceOf(user.address);
            await vault.connect(user).withdraw(totalShares, 0, 0);
            const amount0After = await token0.balanceOf(user.address);
            const amount1After = await token1.balanceOf(user.address);

            expect(await vault.balanceOf(user.address)).to.equal(0);
            const amount0Diff = amount0After.sub(amount0Before);
            const amount1Diff = amount1After.sub(amount1Before);
            const price = slot0.sqrtPriceX96.mul(slot0.sqrtPriceX96);
            const totalIn0 = amount1Diff.mul(ethers.BigNumber.from(2).pow(192)).div(price).add(amount0Diff);

            // expect withdrawn tokens to be > 95% of invested token0
            expect(totalIn0.gt(investedToken0.mul(95).div(100))).to.be.true;

            // remove the remaining share
            const remainShares = await vault.balanceOf(owner.address);
            await vault.withdraw(remainShares, 0, 0);
            expect(await vault.totalSupply()).to.equal(0);

            // positions should be empty
            expect(await vault.getAllPositions()).to.eql([]);
        });

        it("Should be able to swap using 1Inch router", async function() {
            const { owner, manager, user, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3Pair);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set 1inch router address
            await vault.assignRouter1Inch(test1InchRouter);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // unoswap data
            // const data = "0x0502b1c5000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000002faf080000000000000000000000000000000000000000000000000005b39c7bf3723b40000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000003b6d0340b4e16d0168e52d35cacd2c6185b44281ec28c9dccfee7c08";           
            // const decoded = vault.interface.decodeFunctionData("unoswap", data);
            // await vault.connect(manager).unoswap(
            //     decoded.srcToken,
            //     decoded.amount,
            //     decoded.minReturn,
            //     decoded.pools
            // );

            // uniswapv3 data
            // const data = "0xe449022e0000000000000000000000000000000000000000000000000000000002faf080000000000000000000000000000000000000000000000000005badeac783afdb00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e0554a476a092703abdb3ef35c80e0d76d32939fcfee7c08";
            // const decoded = vault.interface.decodeFunctionData("uniswapV3Swap", data);
            // await vault.connect(manager).uniswapV3Swap(
            //     decoded.amount,
            //     decoded.minReturn,
            //     decoded.pools
            // );

            // test in-place swap
            const amountIn = "50" + "0".repeat(await token0.decimals());
            const amountOut = await vault.connect(manager).callStatic.swapInputSingle(
                true,
                amountIn,
                0,
                0,
                UINT64_MAX
            );

            // swap data
            const data = "0x12aa3caf0000000000000000000000007122db0ebe4eb9b434a9f2ffe6760bc03bfbd0e0000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000007122db0ebe4eb9b434a9f2ffe6760bc03bfbd0e000000000000000000000000047ac0fb4f2d84898e4d9e7b4dab3c24507a6d5030000000000000000000000000000000000000000000000000000000002faf080000000000000000000000000000000000000000000000000005e68a54e2a8a67000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001360000000000000000000000000000000000000000000001180000ea0000d0512061bb2fda13600c497272a8dd029313afdb125fd3a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480044d5bcb9b5000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005e68a54e2a8a6700000000000000000000000042f527f50f16a103b6ccab48bccca214500c10214041c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2d0e30db080a06c4eca27c02aaa39b223fe8d0a0e5c4f27ead9083c756cc21111111254eeb25477b68fb85ed929f73a96058200000000000000000000cfee7c08"
            const decoded = vault.interface.decodeFunctionData("swap", data);
            const desc = {
                srcToken: decoded.desc.srcToken,
                dstToken: decoded.desc.dstToken,
                srcReceiver: decoded.desc.srcReceiver,
                dstReceiver: vault.address,
                amount: amountIn,
                minReturnAmount: decoded.desc.minReturnAmount,
                flags: decoded.desc.flags
            };
            const token1Before = await token1.balanceOf(vault.address);
            await vault.connect(manager).swap(
                decoded.executor,
                desc,
                decoded.permit,
                decoded.data                
            );
            const token1After = await token1.balanceOf(vault.address);

            // if successful, swap amount should be larger than in-place swap
            expect(token1After.sub(token1Before).gt(amountOut)).to.be.true;
        });
    })
})

describe("TeaVaultV3PairHelper", function () {

    describe("Deployment", function() {
        it("Should set the correct router and weth9", async function () {
            const { helper } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            expect(await helper.router1Inch()).to.equal(test1InchRouter);
            expect(await helper.weth9()).to.equal(testWeth);
        });
    });

    describe("Owner functions", function() {
        it("Should be able to rescue funds from owner", async function () {
            const { helper, token0, owner, user } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            const amount = "1000" + "0".repeat(await token0.decimals());
            await token0.connect(user).transfer(helper.address, amount);
            expect(await token0.balanceOf(helper.address)).to.equal(amount);

            await helper.rescueFund(token0.address, amount);
            expect(await token0.balanceOf(helper.address)).to.equal(0);
            expect(await token0.balanceOf(owner.address)).to.equal(amount);
        });

        it("Should not be able to rescue funds from non-owner", async function () {
            const { helper, token0, owner, user } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            const amount = "1000" + "0".repeat(await token0.decimals());
            await token0.connect(user).transfer(helper.address, amount);

            await expect(helper.connect(user).rescueFund(token0.address, amount)).to.be.revertedWith("");
        });        
    });

    describe("User functions", function() {
        it("Should be able to deposit", async function() {
            const { owner, manager, user, helper, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // swap
            await vault.connect(manager).swapInputSingle(
                true,
                "50" + "0".repeat(await token0.decimals()),
                0,
                0,
                UINT64_MAX
            );

            // deposit using helper
            // estimate how much tokens are required
            const shares2 = "1000" + "0".repeat(await vault.decimals());
            const amounts = await vault.connect(user).callStatic.deposit(shares2, UINT256_MAX, UINT256_MAX);
            await token0.connect(user).approve(vault.address, 0);
            await token1.connect(user).approve(vault.address, 0);

            // deposit
            const token0Before = await token0.balanceOf(user.address);
            const token1Before = await token1.balanceOf(user.address);
            await token0.connect(user).approve(helper.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(helper.address, "10000" + "0".repeat(await token1.decimals()));
            const depositData = helper.interface.encodeFunctionData("deposit", [ shares2, UINT256_MAX, UINT256_MAX ]);
            await helper.connect(user).multicall(
                vault.address,
                amounts.depositedAmount0.add("100"), // add some extra tokens to test refund
                amounts.depositedAmount1.add("100"), // add some extra tokens to test refund
                [ depositData ]
            );
            const token0After = await token0.balanceOf(user.address);
            const token1After = await token1.balanceOf(user.address);
            
            // should have shares minted
            expect(await vault.balanceOf(user.address)).to.equal(ethers.BigNumber.from(shares).add(shares2));

            // should have tokens refunded
            expect(token0Before.sub(token0After)).to.equal(amounts.depositedAmount0);
            expect(token1Before.sub(token1After)).to.equal(amounts.depositedAmount1);
        });

        if (testToken0 == testWeth || testToken1 == testWeth) {
            it("Should be able to convert to WETH and deposit", async function() {
                const { owner, manager, user, helper, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

                // set fees
                const feeConfig = {
                    vault: owner.address,
                    entryFee: 1000,
                    exitFee: 2000,
                    performanceFee: 100000,
                    managementFee: 0,
                }

                await vault.setFeeConfig(feeConfig);

                // set manager
                await vault.assignManager(manager.address);

                // deposit
                await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
                await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
                const shares = "100" + "0".repeat(await vault.decimals());
                await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

                // swap
                await vault.connect(manager).swapInputSingle(
                    true,
                    "50" + "0".repeat(await token0.decimals()),
                    0,
                    0,
                    UINT64_MAX
                );

                // deposit using helper
                // estimate how much tokens are required
                const shares2 = "1000" + "0".repeat(await vault.decimals());
                const amounts = await vault.connect(user).callStatic.deposit(shares2, UINT256_MAX, UINT256_MAX);
                await token0.connect(user).approve(vault.address, 0);
                await token1.connect(user).approve(vault.address, 0);

                let amount0 = amounts.depositedAmount0;
                let amount1 = amounts.depositedAmount1;

                let ethAmount;
                if (testToken0 == testWeth) {
                    ethAmount = amount0;
                    amount0 = 0;
                }
                else {
                    ethAmount = amount1;
                    amount1 = 0;
                }

                // deposit
                if (amount0 != 0) {
                    await token0.connect(user).approve(helper.address, "10000" + "0".repeat(await token0.decimals()));
                }
                if (amount1 != 0) {
                    await token1.connect(user).approve(helper.address, "10000" + "0".repeat(await token1.decimals()));
                }

                const token0Before = await token0.balanceOf(user.address);
                const token1Before = await token1.balanceOf(user.address);
                const balanceBefore = await ethers.provider.getBalance(user.address);
                const depositData = helper.interface.encodeFunctionData("deposit", [ shares2, UINT256_MAX, UINT256_MAX ]);
                const convertWethData = helper.interface.encodeFunctionData("convertWETH");
                const tx = await helper.connect(user).multicall(
                    vault.address,
                    amount0,
                    amount1,
                    [ 
                        depositData,
                        convertWethData,
                    ],
                    { value: ethAmount.add("100") }
                );
                const token0After = await token0.balanceOf(user.address);
                const token1After = await token1.balanceOf(user.address);
                const balanceAfter = await ethers.provider.getBalance(user.address);
                
                // should have shares minted
                expect(await vault.balanceOf(user.address)).to.equal(ethers.BigNumber.from(shares).add(shares2));

                // calculate tx price
                const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
                const ethUsed = receipt.gasUsed.mul(tx.gasPrice);
                
                // should have tokens refunded
                expect(token0Before.sub(token0After)).to.equal(amount0);
                expect(token1Before.sub(token1After)).to.equal(amount1);
                expect(balanceBefore.sub(balanceAfter)).to.equal(ethAmount.add(ethUsed));
            });
        }

        it("Should be able to swap using unoswap and deposit", async function() {
            const { owner, manager, user, helper, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // swap
            await vault.connect(manager).swapInputSingle(
                true,
                "50" + "0".repeat(await token0.decimals()),
                0,
                0,
                UINT64_MAX
            );

            // swap and deposit using helper
            const shares2 = "990" + "0".repeat(await vault.decimals());
            const swapData = "0x0502b1c5000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000001dcd65000000000000000000000000000000000000000000000000000390fbd3a4f18e130000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000100000000000000003b6d03403aa370aacf4cb08c7e1e7aa8e8ff9418d73c7e0fcfee7c08";

            const amount0 = "1010" + "0".repeat(await token0.decimals());
            await token0.connect(user).approve(helper.address, "10000" + "0".repeat(await token0.decimals()));
            const depositData = helper.interface.encodeFunctionData("deposit", [ shares2, UINT256_MAX, UINT256_MAX ]);

            await helper.connect(user).multicall(
                vault.address,
                amount0,
                0,
                [ swapData, depositData ]
            );
            
            // should have shares minted
            expect(await vault.balanceOf(user.address)).to.equal(ethers.BigNumber.from(shares).add(shares2));
        });

        it("Should be able to swap using uniswapV3Swap and deposit", async function() {
            const { owner, manager, user, helper, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // swap
            await vault.connect(manager).swapInputSingle(
                true,
                "50" + "0".repeat(await token0.decimals()),
                0,
                0,
                UINT64_MAX
            );

            // swap and deposit using helper
            const shares2 = "990" + "0".repeat(await vault.decimals());
            const swapData = "0xe449022e000000000000000000000000000000000000000000000000000000001dcd650000000000000000000000000000000000000000000000000003904eccd53a770e0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640cfee7c08";

            const amount0 = "1010" + "0".repeat(await token0.decimals());
            await token0.connect(user).approve(helper.address, "10000" + "0".repeat(await token0.decimals()));
            const depositData = helper.interface.encodeFunctionData("deposit", [ shares2, UINT256_MAX, UINT256_MAX ]);

            await helper.connect(user).multicall(
                vault.address,
                amount0,
                0,
                [ swapData, depositData ]
            );
            
            // should have shares minted
            expect(await vault.balanceOf(user.address)).to.equal(ethers.BigNumber.from(shares).add(shares2));
        });
        
        it("Should be able to swap using swap and deposit", async function() {
            const { owner, manager, user, helper, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // swap
            await vault.connect(manager).swapInputSingle(
                true,
                "50" + "0".repeat(await token0.decimals()),
                0,
                0,
                UINT64_MAX
            );

            // swap and deposit using helper
            const shares2 = "990" + "0".repeat(await vault.decimals());
            const swapData = "0x12aa3caf0000000000000000000000001136b25047e142fa3018184793aec68fbb173ce4000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000001136b25047e142fa3018184793aec68fbb173ce4000000000000000000000000b1c05b498cb58568b2470369feb98b00702063da000000000000000000000000000000000000000000000000000000001dcd6500000000000000000000000000000000000000000000000000037dcd95d600e1d4000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001360000000000000000000000000000000000000000000001180000ea0000d0512061bb2fda13600c497272a8dd029313afdb125fd3a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480044d5bcb9b5000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000037dcd95d600e1d400000000000000000000000042f527f50f16a103b6ccab48bccca214500c10214041c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2d0e30db080a06c4eca27c02aaa39b223fe8d0a0e5c4f27ead9083c756cc21111111254eeb25477b68fb85ed929f73a96058200000000000000000000cfee7c08";

            const amount0 = "1010" + "0".repeat(await token0.decimals());
            await token0.connect(user).approve(helper.address, "10000" + "0".repeat(await token0.decimals()));
            const depositData = helper.interface.encodeFunctionData("deposit", [ shares2, UINT256_MAX, UINT256_MAX ]);

            await helper.connect(user).multicall(
                vault.address,
                amount0,
                0,
                [ swapData, depositData ]
            );
            
            // should have shares minted
            expect(await vault.balanceOf(user.address)).to.equal(ethers.BigNumber.from(shares).add(shares2));
        });

        it("Should be able to withdraw and swap", async function() {
            const { owner, manager, user, helper, vault, token0, token1 } = await helpers.loadFixture(deployTeaVaultV3PairHelper);

            // set fees
            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 0,
            }

            await vault.setFeeConfig(feeConfig);

            // set manager
            await vault.assignManager(manager.address);

            // deposit
            await token0.connect(user).approve(vault.address, "10000" + "0".repeat(await token0.decimals()));
            await token1.connect(user).approve(vault.address, "10000" + "0".repeat(await token1.decimals()));
            const shares = "100" + "0".repeat(await vault.decimals());
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

            // swap
            await vault.connect(manager).swapInputSingle(
                true,
                "50" + "0".repeat(await token0.decimals()),
                0,
                0,
                UINT64_MAX
            );

            // estimate vault value in token0
            const valueInToken0 = await vault.estimatedValueInToken0();

            // withdraw and swap using helper
            const token0Before = await token0.balanceOf(user.address);
            const swapData = "0x0502b1c5000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000005c6ed7b17288880000000000000000000000000000000000000000000000000000000002eba0e90000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340b4e16d0168e52d35cacd2c6185b44281ec28c9dccfee7c08";
            const withdrawData = helper.interface.encodeFunctionData("withdraw", [ shares, 0, 0 ]);
            await vault.connect(user).approve(helper.address, shares);
            await helper.connect(user).multicall(
                vault.address,
                0,
                0,
                [ withdrawData, swapData ]
            );
            const token0After = await token0.balanceOf(user.address);

            expect(await vault.balanceOf(user.address)).to.equal(0);
            // received token0 should be > 95% of estimated vault value in token0
            expect(token0After.sub(token0Before).gt(valueInToken0.mul(95).div(100))).to.be.true;
        });
    });
});
