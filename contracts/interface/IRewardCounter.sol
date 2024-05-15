// SPDX-License-Identifier: BUSL
// Teahouse Finance

pragma solidity ^0.8.24;

interface IRewardCounter {

    struct UserData {
        uint256 unclaimedRewards;
        uint256 lastRewardPerShareX36;
    }

}
