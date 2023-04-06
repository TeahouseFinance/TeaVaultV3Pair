const { time, loadFixture, helpers } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { network, ethers, upgrades } = require("hardhat");

// setup uniswapV3 parameters
const testRpc = process.env.UNISWAP_TEST_RPC || "";
if (testRpc == "") {
    throw "No UNISWAP_TEST_RPC";
}

const testBlock = process.env.UNISWAP_TEST_BLOCK || "";
if (testBlock == "") {
    throw "No UNISWAP_TEST_BLOCK";
}

const testFactory = process.env.UNISWAP_TEST_FACTORY || "";
if (testFactory == "") {
    throw "No UNISWAP_TEST_FACTORY";
}

const testToken0 = process.env.UNISWAP_TEST_TOKEN0 || "";
if (testToken0 == "") {
    throw "No UNISWAP_TEST_TOKEN0";
}

const testToken1 = process.env.UNISWAP_TEST_TOKEN1 || "";
if (testToken1 == "") {
    throw "No UNISWAP_TEST_TOKEN1";
}

const testFeeTier = process.env.UNISWAP_TEST_FEE_TIER || "";
if (testFeeTier == "") {
    throw "No UNISWAP_TEST_FEE_TIER";
}

const testDecimalOffset = process.env.UNISWAP_TEST_DECIMAL_OFFSET || "";
if (testDecimalOffset == "") {
    throw "No UNISWAP_TEST_DECIMAL_OFFSET";
}


describe("TeaVaultV3Pair", function () {

    async function deployTeaVaultV3Pair() {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: testRpc,
                        blockNumber: parseInt(testBlock),
                    },
                },
            ],
        });
    
        // Contracts are deployed using the first signer/account by default
        const [owner, otherAccount] = await ethers.getSigners();

        // get ERC20 tokens
        const MockToken = await ethers.getContractFactory("MockToken");
        const token0 = MockToken.attach(testToken0);
        const token1 = MockToken.attach(testToken1);

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

        return { owner, otherAccount, vault, token0, token1 }
    }

    describe("Deployment", function() {
        it("Should set the correct tokens", async function () {
            const { vault, token0, token1 } = await loadFixture(deployTeaVaultV3Pair);

            expect(await vault.assetToken0()).to.be.equal(token0.address);
            expect(await vault.assetToken1()).to.be.equal(token1.address);
        });

        it("Should set the correct decimals", async function () {
            const { vault, token0 } = await loadFixture(deployTeaVaultV3Pair);

            const token0Decimals = await token0.decimals();
            expect(await vault.decimals()).to.be.equal(token0Decimals + parseInt(testDecimalOffset));
        });

        it("Should be able to set fees from owner", async function() {
            const { owner, vault } = await loadFixture(deployTeaVaultV3Pair);

            const feeConfig = {
                vault: owner.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await vault.setFeeConfig(feeConfig);
            const fees = await vault.feeConfig();

            expect(feeConfig.vault).to.be.equal(fees.vault);
            expect(feeConfig.entryFee).to.be.equal(fees.entryFee);
            expect(feeConfig.exitFee).to.be.equal(fees.exitFee);
            expect(feeConfig.performanceFee).to.be.equal(fees.performanceFee);
            expect(feeConfig.managementFee).to.be.equal(fees.managementFee);
        });

        it("Should be able to set incorrect fees", async function() {
            const { owner, vault } = await loadFixture(deployTeaVaultV3Pair);

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
            const { otherAccount, vault } = await loadFixture(deployTeaVaultV3Pair);

            const feeConfig = {
                vault: otherAccount.address,
                entryFee: 1000,
                exitFee: 2000,
                performanceFee: 100000,
                managementFee: 10000,
            }

            await expect(vault.connect(otherAccount).setFeeConfig(feeConfig)).to.be.revertedWith("");
        });

        it("Should be able to assign manager from owner", async function() {
            const { otherAccount, vault } = await loadFixture(deployTeaVaultV3Pair);

            await vault.assignManager(otherAccount.address);
            const manager = await vault.manager();

            expect(manager).to.be.equal(otherAccount.address);
        });

        it("Should not be able to assign manager from non-owner", async function() {
            const { otherAccount, vault } = await loadFixture(deployTeaVaultV3Pair);

            await expect(vault.connect(otherAccount).assignManager(otherAccount.address)).to.be.revertedWith("");
            
            const manager = await vault.manager();
            expect(manager).to.be.equal("0x" + "0".repeat(40));
        });
    })
})
