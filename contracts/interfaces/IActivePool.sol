// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IPool.sol";


interface IActivePool is IPool {
    // --- Events ---
    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolSIMDebtUpdated(uint _SIMDebt);
    event ActivePoolWSTETHBalanceUpdated(uint _WSTETH);

    // --- Functions ---
    function sendWSTETH(address _account, uint _amount) external;
}
