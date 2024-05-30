// SPDX-License-Identifier: Unlicensed
// Mock ERC20 contract for testing purpose

pragma solidity =0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {

    constructor(uint256 _initialSupply) ERC20("Mock", "Mock") {
        _mint(msg.sender, _initialSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
