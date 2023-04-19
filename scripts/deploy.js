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
const factory = loadEnvVar(process.env.UNISWAP_TEST_FACTORY, "No UNISWAP_TEST_FACTORY");
const token0 = loadEnvVar(process.env.UNISWAP_TEST_TOKEN0, "No UNISWAP_TEST_TOKEN0");
const token1 = loadEnvVar(process.env.UNISWAP_TEST_TOKEN1, "No UNISWAP_TEST_TOKEN1");
const feeTier = loadEnvVarInt(process.env.UNISWAP_TEST_FEE_TIER, "No UNISWAP_TEST_FEE_TIER");
const decimalOffset = loadEnvVarInt(process.env.UNISWAP_TEST_DECIMAL_OFFSET, "No UNISWAP_TEST_DECIMAL_OFFSET");

async function main() {
    const [deployer] = await ethers.getSigners();

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

    const vault = await upgrades.deployProxy(
        TeaVaultV3Pair,
        ["Test Vault", "TVault", factory, token0, token1, feeTier, decimalOffset, deployer.address],
        {
            kind: "uups",
            unsafeAllowLinkedLibraries: true,
            unsafeAllow: ["delegatecall"],
        }
    );

    console.log("Vault depolyed", vault.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
