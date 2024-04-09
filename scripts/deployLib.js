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
const name = loadEnvVar(process.env.NAME, "No NAME");
const symbol = loadEnvVar(process.env.SYMBOL, "No SYMBOL");
const factory = loadEnvVar(process.env.UNISWAP_FACTORY, "No UNISWAP_FACTORY");
const token0 = loadEnvVar(process.env.UNISWAP_TOKEN0, "No UNISWAP_TOKEN0");
const token1 = loadEnvVar(process.env.UNISWAP_TOKEN1, "No UNISWAP_TOKEN1");
const feeTier = loadEnvVarInt(process.env.UNISWAP_FEE_TIER, "No UNISWAP_FEE_TIER");
const decimalOffset = loadEnvVarInt(process.env.UNISWAP_DECIMAL_OFFSET, "No UNISWAP_DECIMAL_OFFSET");
const owner = loadEnvVar(process.env.OWNER, "No OWNER");
const vaultUtils = loadEnvVar(process.env.VAULTUTILS, "No VAULTUTILS");
const genericRouter1Inch = loadEnvVar(process.env.GENERICROUTER1INCH, "No GENERICROUTER1INCH");

const feeVault = loadEnvVar(process.env.FEE_VAULT, "No FEE_VAULT");
const feeCap = loadEnvVar(process.env.FEE_CAP, "No FEE_CAP");
const entryFee = loadEnvVarInt(process.env.ENTRY_FEE, "No ENTRY_FEE");
const exitFee = loadEnvVarInt(process.env.EXIT_FEE, "No EXIT_FEE");
const performanceFee = loadEnvVarInt(process.env.PPERFORMANCE_FEE, "No PPERFORMANCE_FEE");
const managementFee = loadEnvVarInt(process.env.MANAGEMENT_FEE, "No MANAGEMENT_FEE");
const oneInchRouter = loadEnvVar(process.env.ROUTER_1INCH_V5, "No ROUTER_1INCH_V5");
const manager = loadEnvVar(process.env.MANAGER, "No MANAGER");
const rewardClaimer = loadEnvVar(process.env.REWARD_CLAIMER, "No REWARD_CLAIMER");

async function main() {
    const [deployer] = await ethers.getSigners();
    const TeaVaultV3Pair = await ethers.getContractFactory("TeaVaultV3Pair", {
        libraries: {
            VaultUtils: vaultUtils,
            GenericRouter1Inch: genericRouter1Inch,
        },
    });

    const vault = await upgrades.deployProxy(
        TeaVaultV3Pair,
        [name, symbol, factory, token0, token1, feeTier, decimalOffset, feeCap, [feeVault, entryFee, exitFee, performanceFee, managementFee], deployer.address, rewardClaimer],
        {
            kind: "uups",
            unsafeAllowLinkedLibraries: true,
            unsafeAllow: ["delegatecall"],
        }
    );
    console.log("VaultUtils used", vaultUtils);
    console.log("GenericRouter1Inch used", genericRouter1Inch);
    console.log("Vault depolyed", vault.target);

    await vault.assignManager(manager, {gasLimit: 1000000n});
    console.log("Manager set!");
    await vault.assignRouter1Inch(oneInchRouter, {gasLimit: 1000000n});
    console.log("1inchRouter set!");
    await vault.transferOwnership(owner, {gasLimit: 1000000n});
    console.log("Ownership transfered!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
