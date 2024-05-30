// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IWETH9 {

    function balanceOf(address) external view returns (uint256);
    function deposit() external payable;
    function withdraw(uint wad) external;
    function approve(address guy, uint wad) external returns (bool);
    function transfer(address dst, uint wad) external returns (bool);
    function transferFrom(address src, address dst, uint wad) external returns (bool);

}
