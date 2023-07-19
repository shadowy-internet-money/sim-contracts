// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Common interface for the Pools.
interface IPool {
    
    // --- Events ---
    
    event WSTETHBalanceUpdated(uint _newBalance);
    event SIMBalanceUpdated(uint _newBalance);
    event WSTETHAddressChanged(address _newWSTETHAddress);
    event ActivePoolAddressChanged(address _newActivePoolAddress);
    event DefaultPoolAddressChanged(address _newDefaultPoolAddress);
    event StabilityPoolAddressChanged(address _newStabilityPoolAddress);
    event EtherSent(address _to, uint _amount);

    // --- Functions ---
    
    function getWSTETH() external view returns (uint);

    function getSIMDebt() external view returns (uint);

    function increaseSIMDebt(uint _amount) external;

    function decreaseSIMDebt(uint _amount) external;
}
