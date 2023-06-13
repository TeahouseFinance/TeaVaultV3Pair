require("dotenv").config();

require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-contract-sizer");
require("@openzeppelin/hardhat-upgrades");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();

    for (const account of accounts) {
        console.log(account.address);
    }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    solidity: {
        version: "0.8.19",
        settings: {
            viaIR: true,
            optimizer: {
                enabled: true,
                runs: 15,
            },
            // debug: {
            //     revertStrings: "strip",
            // },
        },
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true,
        },
        goerli: {
            url: process.env.GOERLI_URL || "",
            accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
        },
        sepolia: {
            url: process.env.SEPOLIA_URL || "",
            accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
        },
        op: {
            url: process.env.OP_URL || "",
            accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
        },
        arb: {
            url: process.env.ARB_URL || "",
            accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
        },
        mumbai: {
            url: process.env.MUMBAI_URL || "",
            accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],            
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "USD",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
};
