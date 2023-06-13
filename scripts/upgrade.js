const { ethers, upgrades } = require("hardhat");

function loadEnvVar(env, errorMsg) {
    if (env == undefined) {
        throw errorMsg;
    }

    return env;
}

const vaultUtils = loadEnvVar(process.env.VAULTUTILS, "No VAULTUTILS");
const genericRouter1Inch = loadEnvVar(process.env.GENERICROUTER1INCH, "No GENERICROUTER1INCH");
const proxy = loadEnvVar(process.env.PROXY, "No PROXY");

async function main() {
    const TeaVaultV3Pair = await ethers.getContractFactory("TeaVaultV3Pair", {
        libraries: {
            VaultUtils: vaultUtils,
            GenericRouter1Inch: genericRouter1Inch,
        },
    });

    console.log("Upgrading TeaVaultV3Pair...");
    const newLogic = await upgrades.upgradeProxy(proxy, TeaVaultV3Pair, {
        kind: "uups",
        unsafeAllowLinkedLibraries: true,
        unsafeAllow: ["delegatecall"],
    });
    console.log("TeaVaultV3Pair upgraded successfully:", newLogic.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
