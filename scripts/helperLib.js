// A simple library for using the Helper contract
// Teahouse Finance

const fetch = require('node-fetch');
const ethers = require('ethers');

const HARDHAT_NETWORK_CHAINID = 31337;
const OVERRIDE_CHAINID = 1; // override chainId for forked hardhat network

module.exports = {
    getVaultTokenRatio,
    is1InchHealthy,
    getQuoteFrom1Inch,
    previewDeposit,
    deposit,
    previewWithdraw,
    withdraw
};

const FQDN_1INCH = 'https://api.1inch.io/'

// get the ratio of token0 and token1 required to deposit into or withdraw from a vault
// vault: a TeaVaultV3Pair contract object created using ethers.js
// returns { amount0: amount of token0, amount1: amount of token1 }
async function getVaultTokenRatio(vault) {
    const results = await vault.vaultAllUnderlyingAssets();
    return { amount0: results.amount0, amount1: results.amount1 };
}

// check 1inch API status
// chainId: chainId
async function is1InchHealthy(chainId) {
    if (chainId == HARDHAT_NETWORK_CHAINID) chainId = OVERRIDE_CHAINID;
    const response = await fetch(FQDN_1INCH + 'v5.0/' + chainId + '/healthcheck');
    return response.status == 200;
}

// get quote from 1inch
// chainId: chainId
// fromToken: address of source token
// toToken: address of target token
// amount: amount of source token
async function getQuoteFrom1Inch(chainId, fromToken, toToken, amount) {
    if (chainId == HARDHAT_NETWORK_CHAINID) chainId = OVERRIDE_CHAINID;
    const response = await fetch(FQDN_1INCH + 'v5.0/' + chainId + '/quote?'
        + 'fromTokenAddress=' + fromToken + '&'
        + 'toTokenAddress=' + toToken + '&'
        + 'amount=' + amount
    );

    if (response.status == 200) {
        const jsonData = await response.json();
        return jsonData;
    }
    else {
        throw new Error("Unable to get quote from 1Inch");
    }
}

// get swap from 1inch
// chainId: chainId
// fromToken: address of source token
// toToken: address of target token
// amount: amount of source token
// fromAddress: address of source token holder
// slippage: slippage (1 ~ 50)
async function getSwapFrom1Inch(chainId, fromToken, toToken, amount, fromAddress, slippage) {
    if (chainId == HARDHAT_NETWORK_CHAINID) chainId = OVERRIDE_CHAINID;
    const response = await fetch(FQDN_1INCH + 'v5.0/' + chainId + '/swap?'
        + 'fromTokenAddress=' + fromToken + '&'
        + 'toTokenAddress=' + toToken + '&'
        + 'amount=' + amount + '&'
        + 'fromAddress=' + fromAddress + '&'
        + 'slippage=' + slippage + '&'
        + 'disableEstimate=true'
    );

    if (response.status == 200) {
        const jsonData = await response.json();
        return jsonData;
    }
    else {
        console.log(response);
        throw new Error("Unable to get swap from 1Inch");
    }
}

// preview deposit
// helper: a TeaVaultV3PairHelper contract object created using ethers.js
// vault: a TeaVaultV3Pair contract object created using ethers.js
// amount0: amount of token0 to deposit
// amount1: amount of token1 to deposit
// eth (optional): amount of ETH to deposit, only when either amount0 or amount1 is WETH9
// returns:
// amount0: total amount of token0
// amount1: total amount of token1
// eth: total amount of eth
// convertAmount: amount of token needs to be converted
// zeroToOne: true if convert from token0 to token1, false if from token1 to token0
// finalAmount0: estimated amount of token0 after conversion
// finalAmount1: estimated amount of token1 after conversion
// shares: estimated amount of shares
async function previewDeposit(helper, vault, amount0, amount1, eth = undefined) {
    const network = await vault.provider.getNetwork();
    const healthy = await is1InchHealthy(network.chainId);
    if (!healthy) {
        throw new Error("1Inch network not healthy");
    }

    const token0 = await vault.assetToken0();
    const token1 = await vault.assetToken1();

    amount0 = ethers.BigNumber.from(amount0);
    amount1 = ethers.BigNumber.from(amount1);

    const originalAmount0 = amount0;
    const originalAmount1 = amount1;
    let originalEth = ethers.BigNumber.from(0);

    if (eth != undefined) {
        originalEth = ethers.BigNumber.from(eth);

        const weth9 = await helper.weth9();
        if (weth9 == token0) {
            amount0 = amount0.add(eth);
        }
        else if (weth9 == token1) {
            amount1 = amount1.add(eth);
        }
        else {
            throw new Error("Vault does not accept ETH");
        }
    }

    let convertAmount;
    let zeroToOne;

    const ratio = await getVaultTokenRatio(vault);
    if (ratio.amount0.isZero()) {
        // does not need token0, convert all token0 to token1
        convertAmount = amount0;
        zeroToOne = true;
        convert1 = ethers.BigNumber.from(0);
    }
    else if (ratio.amount1.isZero()) {
        // does not need token1, convert all token1 to token0
        convertAmount = amount1;
        zeroToOne = false;
    }
    else {
        // calculate required amounts for both tokens
        let requiredAmount0 = amount1.mul(ratio.amount0).div(ratio.amount1);
        let requiredAmount1 = amount0.mul(ratio.amount1).div(ratio.amount0);
        if (requiredAmount0.gt(amount0)) {
            // need more token0, convert some token1 to token0
            zeroToOne = false;
            const diff0 = requiredAmount0.sub(amount0);
            const quote = await getQuoteFrom1Inch(network.chainId, token0, token1, diff0);
            convertAmount = ratio.amount0.mul(amount1).sub(ratio.amount1.mul(amount0));
            convertAmount = convertAmount.div(ratio.amount1.mul(quote.fromTokenAmount).div(quote.toTokenAmount).add(ratio.amount0));
        }
        else if (requiredAmount1.gt(amount1)) {
            // need more token1, convert some token0 to token1
            zeroToOne = true;
            const diff1 = requiredAmount1.sub(amount1);
            const quote = await getQuoteFrom1Inch(network.chainId, token1, token0, diff1);
            convertAmount = ratio.amount1.mul(amount0).sub(ratio.amount0.mul(amount1));
            convertAmount = convertAmount.div(ratio.amount0.mul(quote.fromTokenAmount).div(quote.toTokenAmount).add(ratio.amount1));
        }
        else {
            // no conversion required
            convertAmount = ethers.BigNumber.from(0);
            zeroToOne = true;
        }
    }

    let finalAmount0 = amount0;
    let finalAmount1 = amount1;

    if (!convertAmount.isZero()) {
        if (zeroToOne) {
            const quote = await getQuoteFrom1Inch(network.chainId, token0, token1, convertAmount);
            finalAmount0 = amount0.sub(quote.fromTokenAmount);
            finalAmount1 = amount1.add(quote.toTokenAmount);
        }
        else {
            const quote = await getQuoteFrom1Inch(network.chainId, token1, token0, convertAmount);
            finalAmount0 = amount0.add(quote.toTokenAmount);
            finalAmount1 = amount1.sub(quote.fromTokenAmount);
        }
    }

    const totalShares = await vault.totalSupply();
    let shares = ethers.BigNumber.from(0);
    if (!ratio.amount0.isZero()) {
        shares = finalAmount0.mul(totalShares).div(ratio.amount0);
    }
    if (!ratio.amount1.isZero()) {
        const shares1 = finalAmount1.mul(totalShares).div(ratio.amount1);
        if (shares.isZero() || shares.gt(shares1)) {
            shares = shares1;
        }
    }

    return {
        amount0: originalAmount0,
        amount1: originalAmount1,
        eth: originalEth,
        convertAmount: convertAmount,
        zeroToOne: zeroToOne,
        finalAmount0: finalAmount0,
        finalAmount1: finalAmount1,
        shares: shares
    };
}

// perform deposit
// helper: a TeaVaultV3PairHelper contract object created using ethers.js
// vault: a TeaVaultV3Pair contract object created using ethers.js
// preview: a preview object returned by previewDeposit function
// slppage: allowed slippage for 1Inch exchange swap
// unwrapWeth: true to unwrap WETH to ETH
// amount0max: maximum amount of token0 to deposit
// amount1max: maximum amount of token1 to deposit
// returns: multicall data for calling the multicall function
async function deposit(helper, vault, preview, slippage, unwrapWeth = true, amount0max = undefined, amount1max = undefined) {
    const network = await vault.provider.getNetwork();
    const healthy = await is1InchHealthy(network.chainId);
    if (!healthy) {
        throw new Error("1Inch network not healthy");
    }

    let result = [];

    const token0 = await vault.assetToken0();
    const token1 = await vault.assetToken1();

    if (!preview.convertAmount.isZero()) {
        // need to convert something
        const fromToken = preview.zeroToOne ? token0 : token1;
        const toToken = preview.zeroToOne ? token1 : token0;
    
        const swap = await getSwapFrom1Inch(network.chainId, fromToken, toToken, preview.convertAmount, helper.address, slippage);
        const router1Inch = await helper.router1Inch();
        if (router1Inch.toLowerCase() != swap.tx.to.toLowerCase()) {
            throw new Error("1Inch router mismatch");
        }

        result.push(swap.tx.data);
    }

    if (amount0max == undefined) {
        amount0max = preview.finalAmount0;
    }

    if (amount1max == undefined) {
        amount1max = preview.finalAmount1;
    }

    const sharesMinusSlippage = preview.shares.mul(1000 - slippage).div(1000);

    // actual deposit
    result.push(helper.interface.encodeFunctionData('deposit', [ sharesMinusSlippage, amount0max, amount1max ]));

    // convert weth9 back to eth if either token0 or token1 is weth9
    if (unwrapWeth) {
        const weth9 = await helper.weth9();
        if (weth9 == token0 || weth9 == token1) {
            result.push(helper.interface.encodeFunctionData('convertWETH'));
        }    
    }
    
    return result;
}

// preview withdraw
// helper: a TeaVaultV3PairHelper contract object created using ethers.js
// vault: a TeaVaultV3Pair contract object created using ethers.js
// shares: amount of shares to withdraw
// returns:
// amount0: estimated amount of token0 to be withdrawn
// amount1: estimated amount of token1 to be withdrawm
// convertToToken0: estimated total amount of token0 if convert all token1 into token0
// convertToToken1: estimated total amount of token1 if convert all token0 into token1
async function previewWithdraw(helper, vault, shares) {
    const network = await vault.provider.getNetwork();
    const healthy = await is1InchHealthy(network.chainId);
    if (!healthy) {
        throw new Error("1Inch network not healthy");
    }

    const token0 = await vault.assetToken0();
    const token1 = await vault.assetToken1();

    const amounts = await vault.callStatic.withdraw(shares, 0, 0);

    // estimate convertToToken0 by converting all token1 to token0
    const quote0 = await getQuoteFrom1Inch(network.chainId, token1, token0, amounts.withdrawnAmount1);
    const convertToToken0 = amounts.withdrawnAmount0.add(quote0.toTokenAmount);

    // estimate convertToToken0 by converting all token1 to token0
    const quote1 = await getQuoteFrom1Inch(network.chainId, token0, token1, amounts.withdrawnAmount0);
    const convertToToken1 = amounts.withdrawnAmount1.add(quote1.toTokenAmount);

    return {
        amount0: amounts.withdrawnAmount0,
        amount1: amounts.withdrawnAmount1,
        convertToToken0: convertToToken0,
        convertToToken1: convertToToken1
    };
}

// perform withdraw
// helper: a TeaVaultV3PairHelper contract object created using ethers.js
// vault: a TeaVaultV3Pair contract object created using ethers.js
// shares: amount of shares to withdraw
// target: 0: do not convert, 1: convert to token0, 2: convert to token1
// slippage: slippage
// unwrapWeth: true to unwrap WETH to ETH
// amount0min: minimum amount of token0 to withdraw
// amount1min: minimum amount of token1 to withdraw
// returns: multicall data for calling the multicall function
async function withdraw(helper, vault, shares, target, slippage, unwrapWeth = true, amount0min = 0, amount1min = 0) {
    const network = await vault.provider.getNetwork();
    const healthy = await is1InchHealthy(network.chainId);
    if (!healthy) {
        throw new Error("1Inch network not healthy");
    }

    let result = [];

    const token0 = await vault.assetToken0();
    const token1 = await vault.assetToken1();

    const amounts = await vault.callStatic.withdraw(shares, 0, 0);

    result.push(helper.interface.encodeFunctionData('withdraw', [ shares, amount0min, amount1min ]));

    if (target == 0) {
        // do nothing
    }
    else if (target == 1) {
        const amountsMinusSlippage = amounts.withdrawnAmount1.mul(1000 - slippage).div(1000);

        const swap = await getSwapFrom1Inch(network.chainId, token1, token0, amountsMinusSlippage, helper.address, slippage);
        const router1Inch = await helper.router1Inch();
        if (router1Inch.toLowerCase() != swap.tx.to.toLowerCase()) {
            throw new Error("1Inch router mismatch");
        }

        result.push(swap.tx.data);
    }
    else if (target == 2) {
        const amountsMinusSlippage = amounts.withdrawnAmount0.mul(1000 - slippage).div(1000);

        const swap = await getSwapFrom1Inch(network.chainId, token0, token1, amountsMinusSlippage, helper.address, slippage);
        const router1Inch = await helper.router1Inch();
        if (router1Inch.toLowerCase() != swap.tx.to.toLowerCase()) {
            throw new Error("1Inch router mismatch");
        }

        result.push(swap.tx.data);
    }
    else {
        throw new Error("Invalid target");
    }

    if (unwrapWeth) {
        const weth9 = await helper.weth9();
        if (weth9 == token0 || weth9 == token1) {
            result.push(helper.interface.encodeFunctionData('convertWETH'));
        }
    }

    return result;
}
