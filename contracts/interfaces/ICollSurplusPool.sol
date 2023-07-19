// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;


interface ICollSurplusPool {

    // --- Events ---

    event WSTETHAddressChanged(address _newWSTETHAddress);
    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _newActivePoolAddress);

    event CollBalanceUpdated(address indexed _account, uint _newBalance);
    event EtherSent(address _to, uint _amount);

    // --- Contract setters ---

    function setAddresses(
        address _WSTETHAddress,
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _activePoolAddress
    ) external;

    function getWSTETH() external view returns (uint);

    function getCollateral(address _account) external view returns (uint);

    function accountSurplus(address _account, uint _amount) external;

    function claimColl(address _account) external;
}
