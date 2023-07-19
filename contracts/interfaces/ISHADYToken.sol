// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface ISHADYToken is IERC20, IERC20Permit {
    // --- Events ---

    event CommunityIssuanceAddressSet(address communityIssuanceAddress);
    event VeAddressSet(address veAddress);
    event LockupContractFactoryAddressSet(address lockupContractFactoryAddress);

    // --- Functions ---

    function sendToVe(address sender_, uint amount_) external;

    function getDeploymentStartTime() external view returns (uint);

    function getLpRewardsEntitlement() external view returns (uint);
}