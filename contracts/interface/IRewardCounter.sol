// SPDX-License-Identifier: BUSL
// Teahouse Finance

pragma solidity ^0.8.24;

interface IRewardCounter {

    struct UserData {
        uint256 unclaimedRewards;
        uint256 lastRewardPerShareX36;
    }

    error CallerIsNotVault();
    error AlreadyInitialized();

    /// @notice Initialize reward counter
    /// @param _shares Initial total shares
    /// @param _rewards Initial rewards
    function initialize(uint256 _shares, uint256 _rewards) external;

    /// @notice Call this function when shares changed (mint/burn/transfer)
    /// @param _owner Address of shares to be updated
    /// @param _oldShares Amount of shares owned by _owner before this update
    function onUpdateShares(address _owner, uint256 _oldShares) external;

    /// @notice Call this function when receiving rewards
    /// @param _rewards Reward received
    /// @param _totalShares Total amount of shares
    function onReceiveRewards(uint256 _rewards, uint256 _totalShares) external;

    /// @notice Call this function when claiming rewards
    /// @param _owner Address to claim reward
    /// @param _ownerShares Amount of shares owned by _owner
    /// @return rewards Amount of rewards claimed
    function claim(address _owner, uint256 _ownerShares) external returns (uint256 rewards);

    /// @notice Retrieve amount of rewards that can be claimed
    /// @param _owner Address to claim reward
    /// @param _ownerShares Amount of shares owned by _owner
    /// @return rewards Amount of rewards claimable
    function claimable(address _owner, uint256 _ownerShares) external view returns (uint256 rewards);

}
