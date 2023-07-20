// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ICommunityIssuance { 
    
    // --- Events ---

    event SHADYTokenAddressSet(address _shadyTokenAddress);
    event StabilityPoolAddressSet(address _stabilityPoolAddress);
    event TotalSHADYIssuedUpdated(uint _totalSHADYIssued);

    // --- Functions ---

    function setAddresses(address shadyTokenAddress_, address stabilityPoolAddress_) external;

    function issueSHADY() external returns (uint);

    function sendSHADY(address account_, uint shadyAmount_) external;
}
