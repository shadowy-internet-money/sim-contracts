// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../dependencies/Issuance.sol";

contract CommunityIssuanceTester is Issuance {
    function obtainSHADY(uint _amount) external {
        shadyToken.transfer(msg.sender, _amount);
    }

    function getCumulativeIssuanceFraction() external view returns (uint) {
       return _getCumulativeIssuanceFraction();
    }

    function unprotectedIssueSHADY() external returns (uint) {
        // No checks on caller address
       
        uint latestTotalSHADYIssued = SHADYSupplyCap * _getCumulativeIssuanceFraction() / DECIMAL_PRECISION;
        uint issuance = latestTotalSHADYIssued - totalSHADYIssued;
      
        totalSHADYIssued = latestTotalSHADYIssued;
        return issuance;
    }
}
