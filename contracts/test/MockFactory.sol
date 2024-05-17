// SPDX-License-Identifier: Unlicensed
// Mock UniswapV3Factory contract for testing claims
// No pool function is actually required for this test

pragma solidity =0.8.25;


contract MockFactory {

    function getPool(address /*tokenA*/, address /*tokenB*/, uint24 /*fee*/) external view returns (address) {
        return address(this);
    }

}
