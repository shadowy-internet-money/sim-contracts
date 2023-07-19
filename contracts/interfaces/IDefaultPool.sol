// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IPool.sol";


interface IDefaultPool is IPool {
    // --- Events ---
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event DefaultPoolSIMDebtUpdated(uint _SIMDebt);
    event DefaultPoolWSTETHBalanceUpdated(uint _WSTETH);

    // --- Functions ---
    function sendWSTETHToActivePool(uint _amount) external;
}
