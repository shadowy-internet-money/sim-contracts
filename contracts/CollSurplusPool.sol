// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ICollSurplusPool.sol";
import "./dependencies/CheckContract.sol";


contract CollSurplusPool is Ownable, CheckContract, ICollSurplusPool {
    string constant public NAME = "CollSurplusPool";

    address public WSTETHAddress;
    address public borrowerOperationsAddress;
    address public troveManagerAddress;
    address public activePoolAddress;

    // deposited ether tracker
    uint256 internal WSTETH;
    // Collateral surplus claimable by trove owners
    mapping (address => uint) internal balances;
    
    // --- Contract setters ---

    function setAddresses(
        address _WSTETHAddress,
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _activePoolAddress
    )
        external
        override
        onlyOwner
    {
        _checkContract(_WSTETHAddress);
        _checkContract(_borrowerOperationsAddress);
        _checkContract(_troveManagerAddress);
        _checkContract(_activePoolAddress);

        WSTETHAddress = _WSTETHAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        troveManagerAddress = _troveManagerAddress;
        activePoolAddress = _activePoolAddress;

        emit WSTETHAddressChanged(_WSTETHAddress);
        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);

        renounceOwnership();
    }

    /* Returns the WSTETH state variable at ActivePool address.
       Not necessarily equal to the raw ether balance - ether can be forcibly sent to contracts. */
    function getWSTETH() external view override returns (uint) {
        return WSTETH;
    }

    function getCollateral(address _account) external view override returns (uint) {
        return balances[_account];
    }

    // --- Pool functionality ---

    function accountSurplus(address _account, uint _amount) external override {
        _requireCallerIsTroveManager();

        uint newAmount = balances[_account] + _amount;
        balances[_account] = newAmount;

        emit CollBalanceUpdated(_account, newAmount);
    }

    function claimColl(address _account) external override {
        _requireCallerIsBorrowerOperations();
        uint claimableColl = balances[_account];
        require(claimableColl > 0, "CollSurplusPool: No collateral available to claim");

        balances[_account] = 0;
        emit CollBalanceUpdated(_account, 0);

        WSTETH -= claimableColl;
        emit EtherSent(_account, claimableColl);

        IERC20(WSTETHAddress).transfer(_account, claimableColl);
    }

    function receiveWSTETH(uint amount) external payable {
        _requireCallerIsActivePool();
        WSTETH += amount;
    }

    // --- 'require' functions ---

    function _requireCallerIsBorrowerOperations() internal view {
        require(
            msg.sender == borrowerOperationsAddress,
            "CollSurplusPool: Caller is not Borrower Operations");
    }

    function _requireCallerIsTroveManager() internal view {
        require(
            msg.sender == troveManagerAddress,
            "CollSurplusPool: Caller is not TroveManager");
    }

    function _requireCallerIsActivePool() internal view {
        require(
            msg.sender == activePoolAddress,
            "CollSurplusPool: Caller is not Active Pool");
    }
}
