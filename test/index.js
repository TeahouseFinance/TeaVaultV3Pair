const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
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

const UINT256_MAX = '0x' + 'f'.repeat(64);


describe("TeaVaultV3Pair", function () {

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

        const TeaVaultV3Pair = await ethers.getContractFactory("TeaVaultV3Pair", {
            libraries: {
                VaultUtils: vaultUtils.address,
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

        it("Should be able to set incorrect fees", async function() {
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
            let token0Before = await token0.balanceOf(user.address);
            await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);
            expect(await vault.balanceOf(user.address)).to.equal(shares);
            let token0After = await token0.balanceOf(user.address);

            let expectedAmount0 = ethers.BigNumber.from("100" + "0".repeat(await token0.decimals()));
            const entryFeeAmount0 = expectedAmount0.mul(feeConfig.entryFee).div("1000000");
            expectedAmount0 = expectedAmount0.add(entryFeeAmount0);
            expect(token0Before.sub(token0After)).to.equal(expectedAmount0); // user spent expectedAmount0 of token0
            expect(await token0.balanceOf(owner.address)).to.equal(entryFeeAmount0); // vault received entryFeeAmount0 of token0

            // withdraw
            token0Before = await token0.balanceOf(user.address);
            await vault.connect(user).withdraw(shares, 0, 0);
            expect(await vault.balanceOf(user.address)).to.equal(0);
            token0After = await token0.balanceOf(user.address);

            expectedAmount0 = ethers.BigNumber.from("100" + "0".repeat(await token0.decimals()));
            const exitFeeAmount0 = expectedAmount0.mul(feeConfig.exitFee).div("1000000");
            expectedAmount0 = expectedAmount0.sub(exitFeeAmount0);
            expect(token0After.sub(token0Before)).to.equal(expectedAmount0); // user received expectedAmount0 of token0
            expect(await token0.balanceOf(owner.address)).to.equal(entryFeeAmount0.add(exitFeeAmount0)); // vault received exitFeeAmount0 of token0
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
    })
})
