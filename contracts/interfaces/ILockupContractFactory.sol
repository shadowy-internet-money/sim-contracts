// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
    
interface ILockupContractFactory {
    
    // --- Events ---

    event SHADYTokenAddressSet(address shadyTokenAddress_);
    event LockupContractDeployedThroughFactory(address lockupContractAddress_, address beneficiary_, uint unlockTime_, address deployer_);

    // --- Functions ---

    function setSHADYTokenAddress(address shadyTokenAddress_) external;

    function deployLockupContract(address beneficiary_, uint unlockTime_) external;

    function isRegisteredLockup(address addr_) external view returns (bool);
}
