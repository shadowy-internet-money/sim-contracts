// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/ISHADYToken.sol";

contract LockupContract {
    // --- Data ---
    string constant public NAME = "LockupContract";

    uint constant internal SECONDS_IN_ONE_YEAR = 31536000;

    address public immutable beneficiary;

    ISHADYToken public shadyToken;

    // Unlock time is the Unix point in time at which the beneficiary can withdraw.
    uint public unlockTime;

    // --- Events ---

    event LockupContractCreated(address _beneficiary, uint _unlockTime);
    event LockupContractEmptied(uint _SHADYwithdrawal);

    // --- Functions ---

    constructor(
        address _shadyTokenAddress,
        address _beneficiary, 
        uint _unlockTime
    ) {
        shadyToken = ISHADYToken(_shadyTokenAddress);

        /*
        * Set the unlock time to a chosen instant in the future, as long as it is at least 1 year after
        * the system was deployed 
        */
        _requireUnlockTimeIsAtLeastOneYearAfterSystemDeployment(_unlockTime);
        unlockTime = _unlockTime;
        
        beneficiary = _beneficiary;
        emit LockupContractCreated(_beneficiary, _unlockTime);
    }

    function withdrawSHADY() external {
        _requireCallerIsBeneficiary();
        _requireLockupDurationHasPassed();

        ISHADYToken shadyTokenCached = shadyToken;
        uint SHADYBalance = shadyTokenCached.balanceOf(address(this));
        shadyTokenCached.transfer(beneficiary, SHADYBalance);
        emit LockupContractEmptied(SHADYBalance);
    }

    // --- 'require' functions ---

    function _requireCallerIsBeneficiary() internal view {
        require(msg.sender == beneficiary, "LockupContract: caller is not the beneficiary");
    }

    function _requireLockupDurationHasPassed() internal view {
        require(block.timestamp >= unlockTime, "LockupContract: The lockup duration must have passed");
    }

    function _requireUnlockTimeIsAtLeastOneYearAfterSystemDeployment(uint _unlockTime) internal view {
        uint systemDeploymentTime = shadyToken.getDeploymentStartTime();
        require(_unlockTime >= systemDeploymentTime + SECONDS_IN_ONE_YEAR, "LockupContract: unlock time must be at least one year after system deployment");
    }
}
