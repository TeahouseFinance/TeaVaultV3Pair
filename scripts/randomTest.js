// Randomized tests for distributing rewards
// Teahouse Finance

const { ethers, upgrades } = require("hardhat");

const UINT256_MAX = (1n << 256n) - 1n;
let randomNumberSeed = 0n;

function randomSeed(seed) {
    randomNumberSeed = seed;
}

function randomNumber() {
    const hex = ethers.toBeHex(randomNumberSeed);
    const newHex = ethers.keccak256(hex);
    randomNumberSeed = ethers.toBigInt(newHex);
    return randomNumberSeed;
}

function distributeRewards(totalShares, shares, rewards, reward) {
    let newTotalShares = 0n;
    for (let i = 0; i < shares.length; i++) {
        newTotalShares += shares[i];
    }
    if (newTotalShares != totalShares) {
        console.log("totalShares:", totalShares);
        console.log("newTotalShares:", newTotalShares);
        throw "newTotalShares != totalShares";
    }

    for (let i = 0; i < shares.length; i++) {
        rewards[i] += reward * shares[i] / totalShares;
    }
}


async function deployContracts(owner) {
    // deploy tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    const token0 = await MockToken.deploy(ethers.parseEther("1000000000"));
    const token1 = await MockToken.deploy(ethers.parseEther("1000000000"));
    const rewardToken = await MockToken.deploy(ethers.parseEther("1000000000"));

    // deploy factory
    const MockFactory = await ethers.getContractFactory("MockFactory");
    const factory = await MockFactory.deploy();

    // deploy TeaVaultV3Pair
    const VaultUtils = await ethers.getContractFactory("VaultUtils");
    const vaultUtils = await VaultUtils.deploy();

    const GenericRouter1Inch = await ethers.getContractFactory("GenericRouter1Inch");
    const genericRouter1Inch = await GenericRouter1Inch.deploy();

    const TeaVaultV3Pair = await ethers.getContractFactory("TeaVaultV3Pair", {
        libraries: {
            VaultUtils: vaultUtils.target,
            GenericRouter1Inch: genericRouter1Inch.target,
        },
    });

    const vault = await upgrades.deployProxy(
        TeaVaultV3Pair,
        ["Mock", "Mock", factory.target, token0.target, token1.target, 3000, 1, 100000, [owner.address, 0, 0, 0, 0], owner.address, owner.address],
        {
            kind: "uups",
            unsafeAllowLinkedLibraries: true,
            unsafeAllow: ["delegatecall"],
        }
    );

    return { vault, token0, token1, rewardToken };
}

async function main() {
    const signers = await hre.ethers.getSigners();
    const { vault, token0, token1, rewardToken } = await deployContracts(signers[0]);
    
    // give tokens to each account
    for (let i = 1; i < signers.length; i++) {
        await token0.transfer(signers[i].address, ethers.parseEther("10000000"));
    }

    // set allowences
    for (let i = 0; i < signers.length; i++) {
        await token0.connect(signers[i]).approve(vault.target, UINT256_MAX);
    }

    const ITERATIONS = 100000;
    const RANDOM_SEED = 100n;
    const DECIMAL_SCALE = 10n ** 18n;

    randomSeed(RANDOM_SEED);

    let shares = new Array(signers.length);
    let rewards = new Array(signers.length);
    let claimed = new Array(signers.length);

    shares.fill(0n);
    rewards.fill(0n);
    claimed.fill(0n);
    
    // set up initial condition
    const initialRewards = randomNumber() % 10000n * DECIMAL_SCALE;
    let totalRewards = initialRewards;
    let totalShares = 0n;
    for (let i = 0; i < 10; i++) {
        shares[i] = randomNumber() % 100000000n * DECIMAL_SCALE / 10000n;
        totalShares += shares[i];

        await vault.connect(signers[i]).deposit(shares[i], UINT256_MAX, UINT256_MAX);
    }

    console.log("Initial rewards:", initialRewards);
    console.log("Initial shares:", shares);
    console.log("Initial total shares:", totalShares);
    distributeRewards(totalShares, shares, rewards, initialRewards);
    await rewardToken.transfer(vault.target, initialRewards);

    // initialize
    await vault.setUpLxpL(rewardToken.target);

    // start iterations
    for (let i = 0; i < ITERATIONS; i++) {
        if (i % Math.floor(ITERATIONS / 100) == 0) {
            console.log("iteration:", i);
        }
        const action = randomNumber();
        const target = Number(action / 7n % BigInt(signers.length));
        switch(action % 7n) {
            case 0n:
                // mint
                const amount = randomNumber() % (100000n * DECIMAL_SCALE);
                await vault.connect(signers[target]).deposit(amount, UINT256_MAX, UINT256_MAX);
                shares[target] += amount;
                totalShares += amount;
                break;

            case 1n:
                // burn
                if (shares[target] > 0n) {
                    const amount = randomNumber() % shares[target];
                    await vault.connect(signers[target]).withdraw(amount, 0, 0);
                    shares[target] -= amount;    
                    totalShares -= amount;
                }
                break;

            case 2n:
                // burn all
                if (shares[target] > 0n) {
                    const amount = shares[target];
                    await vault.connect(signers[target]).withdraw(amount, 0, 0);
                    totalShares -= amount;
                    shares[target] = 0n;
                }
                break;

            case 3n:
                // transfer
                if (shares[target] > 0n) {
                    const target2 = Number(action / 7n / 7n % BigInt(signers.length));
                    const amount = randomNumber() % shares[target];
                    await vault.connect(signers[target]).transfer(signers[target2].address, amount);
                    shares[target] -= amount;
                    shares[target2] += amount;    
                }
                break;

            case 4n:
                // transfer all
                if (shares[target] > 0n) {
                    const target2 = Number(action / 7n / 7n % BigInt(signers.length));
                    const amount = shares[target];
                    await vault.connect(signers[target]).transfer(signers[target2].address, amount);
                    shares[target2] += amount;
                    shares[target] -= amount;
                }
                break;
            
            case 5n:
                // claim
                const claim = await vault.connect(vault.runner.provider).claim.staticCall({ from: signers[target].address });
                await vault.connect(signers[target]).claim();
                claimed[target] += claim;
                break;

            case 6n:
                // drop reward
                const reward = randomNumber() % 10000n * DECIMAL_SCALE;
                await rewardToken.transfer(vault.target, reward);
                totalRewards += reward;
                distributeRewards(totalShares, shares, rewards, reward);
                break;
        }
    }

    console.log("totalShares:", totalShares);
    let newTotalShares = 0n;
    for (let i = 0; i < shares.length; i++) {
        newTotalShares += shares[i];
    }
    console.log("newTotalShares:", newTotalShares);

    // check claim states
    for (let i = 0; i < shares.length; i++) {
        if (i != 0) {
            const rewardBalance = await rewardToken.balanceOf(signers[i].address);
            if (claimed[i] != rewardBalance) {
                throw "Claimed[i] != rewardBalance";
            }
        }

        const claimable = await vault.connect(vault.runner.provider).claim.staticCall({ from: signers[i].address });
        claimed[i] += claimable;

        console.log("claimed:", claimed[i])
        console.log("rewards:", rewards[i]);

        let diff = claimed[i] - rewards[i];
        if (diff < 0n) {
            diff = -diff;
        }

        if (diff > claimed[i] / 10000n || diff > rewards[i] / 10000n) {
            throw "Claimed too different from rewards";
        }
    }

    let totalClaimed = 0n;
    for (let i = 0; i < shares.length; i++) {
        totalClaimed += claimed[i];
    }
    console.log("totalClaimed:", totalClaimed);
    console.log("totalRewards:", totalRewards);
    
    if (totalClaimed > totalRewards) {
        throw "totalClaimed > totalRewards";
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
