// A sample script on how to use the helper contract

const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, upgrades } = require("hardhat");
const helperLib = require("./helperLib.js");

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

const testRpc = loadEnvVar(process.env.UNISWAP_TEST_RPC, "No UNISWAP_TEST_RPC");
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


async function setupContracts() {
    // fork a testing environment
    // does not specify a block because we want to use 1inch API
    // and it has to be fairly close to the latest block
    await helpers.reset(testRpc);

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
    await token0.connect(token0Whale).transfer(user.address, ethers.utils.parseUnits("100000", await token0.decimals()));

    await helpers.impersonateAccount(testToken1Whale);
    const token1Whale = await ethers.getSigner(testToken1Whale);
    await helpers.setBalance(token1Whale.address, ethers.utils.parseEther("100"));  // assign some eth to the whale in case it's a contract and not accepting eth
    await token1.connect(token1Whale).transfer(user.address, ethers.utils.parseUnits("100000", await token1.decimals()));

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

    // deploy TeaVaultV3PairHelper
    const TeaVaultV3PairHelper = await ethers.getContractFactory("TeaVaultV3PairHelper");
    const helper = await TeaVaultV3PairHelper.deploy(test1InchRouter, testWeth);    

    return { owner, manager, user, vault, helper, token0, token1 }
}

async function prepareLiquidity(owner, manager, user, vault, token0, token1) {
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
    await token0.connect(user).approve(vault.address, ethers.utils.parseUnits("10000", await token0.decimals()));
    await token1.connect(user).approve(vault.address, ethers.utils.parseUnits("10000", await token1.decimals()));
    const shares = ethers.utils.parseUnits("100", await vault.decimals());
    await vault.connect(user).deposit(shares, UINT256_MAX, UINT256_MAX);

    // swap
    await vault.connect(manager).swapInputSingle(
        true,
        ethers.utils.parseUnits("50", await token0.decimals()),
        0,
        0,
        UINT64_MAX
    );
}

async function main() {
    const { owner, manager, user, vault, helper, token0, token1 } = await setupContracts();

    await prepareLiquidity(owner, manager, user, vault, token0, token1);

    console.log("Ratio of tokens:", await helperLib.getVaultTokenRatio(vault));

    const amount0 = ethers.utils.parseUnits("100", await token0.decimals());
    const amount1 = ethers.utils.parseUnits("1", await token1.decimals());
    const preview = await helperLib.previewDeposit(helper, vault, amount0, 0, amount1);
    console.log("previewDeposit:", preview);

    const multicallData = await helperLib.deposit(helper, vault, preview, 5);

    // perform multicall
    let sharesBefore = await vault.balanceOf(user.address);
    let token0Before = await token0.balanceOf(user.address);
    let token1Before = await token1.balanceOf(user.address);
    await token0.connect(user).approve(helper.address, ethers.utils.parseUnits("10000", await token0.decimals()));
    await token1.connect(user).approve(helper.address, ethers.utils.parseUnits("10000", await token1.decimals()));
    await helper.connect(user).multicall(vault.address, amount0, amount1, multicallData, { value: 0 });
    let sharesAfter = await vault.balanceOf(user.address);
    let token0After = await token0.balanceOf(user.address);
    let token1After = await token1.balanceOf(user.address);

    // check result
    console.log("shares:", sharesAfter.sub(sharesBefore));
    console.log("token0 used:", token0Before.sub(token0After));
    console.log("token1 used:", token1Before.sub(token1After));

    // preview withdraw
    const shares = sharesAfter.sub(sharesBefore);
    const withdraw = await helperLib.previewWithdraw(helper, vault.connect(user), shares);
    console.log("previewWithdraw:", withdraw);

    const multicallData2 = await helperLib.withdraw(helper, vault.connect(user), shares, 1, 5);

    // perform multicall
    sharesBefore = await vault.balanceOf(user.address);
    token0Before = await token0.balanceOf(user.address);
    token1Before = await token1.balanceOf(user.address);
    await vault.connect(user).approve(helper.address, ethers.utils.parseUnits("10000", await vault.decimals()));
    await helper.connect(user).multicall(vault.address, 0, 0, multicallData2, { value: 0 });
    sharesAfter = await vault.balanceOf(user.address);
    token0After = await token0.balanceOf(user.address);
    token1After = await token1.balanceOf(user.address);

    // check result
    console.log("shares used:", sharesBefore.sub(sharesAfter));
    console.log("token0 received:", token0After.sub(token0Before));
    console.log("token1 received:", token1After.sub(token1Before));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
