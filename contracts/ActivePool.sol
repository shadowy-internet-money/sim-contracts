// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import './interfaces/IActivePool.sol';
import './interfaces/IDefaultPool.sol';
import "./dependencies/CheckContract.sol";

/*
 * The Active Pool holds the WSTETH collateral and SIM debt (but not SIM tokens) for all active troves.
 *
 * When a trove is liquidated, it's WSTETH and SIM debt are transferred from the Active Pool, to either the
 * Stability Pool, the Default Pool, or both, depending on the liquidation conditions.
 *
 */
contract ActivePool is Ownable, CheckContract, IActivePool {
    string constant public NAME = "ActivePool";

    address public WSTETHAddress;
    address public borrowerOperationsAddress;
    address public troveManagerAddress;
    address public stabilityPoolAddress;
    address public defaultPoolAddress;
    uint256 internal WSTETH;  // deposited ether tracker
    uint256 internal SIMDebt;

    // --- Contract setters ---

    function setAddresses(
        address _WSTETHAddress,
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _stabilityPoolAddress,
        address _defaultPoolAddress
    )
        external
        onlyOwner
    {
        _checkContract(_WSTETHAddress);
        _checkContract(_borrowerOperationsAddress);
        _checkContract(_troveManagerAddress);
        _checkContract(_stabilityPoolAddress);
        _checkContract(_defaultPoolAddress);

        WSTETHAddress = _WSTETHAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        troveManagerAddress = _troveManagerAddress;
        stabilityPoolAddress = _stabilityPoolAddress;
        defaultPoolAddress = _defaultPoolAddress;

        emit WSTETHAddressChanged(_WSTETHAddress);
        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit StabilityPoolAddressChanged(_stabilityPoolAddress);
        emit DefaultPoolAddressChanged(_defaultPoolAddress);

        renounceOwnership();
    }

    // --- Getters for public variables. Required by IPool interface ---

    /*
    * Returns the WSTETH state variable.
    *
    *Not necessarily equal to the the contract's raw WSTETH balance - ether can be forcibly sent to contracts.
    */
    function getWSTETH() external view override returns (uint) {
        return WSTETH;
    }

    function getSIMDebt() external view override returns (uint) {
        return SIMDebt;
    }

    // --- Pool functionality ---

    function sendWSTETH(address _account, uint _amount) external override {
        _requireCallerIsBOorTroveMorSP();
        WSTETH = WSTETH - _amount;
        emit ActivePoolWSTETHBalanceUpdated(WSTETH);
        emit EtherSent(_account, _amount);

        IERC20(WSTETHAddress).transfer(_account, _amount);
        if (_account == defaultPoolAddress) {
            IDefaultPool(defaultPoolAddress).receiveWSTETH(_amount);
        }
    }

    function receiveWSTETH(uint amount) external {
        _requireCallerIsBorrowerOperationsOrDefaultPool();
        WSTETH = WSTETH + amount;
        emit ActivePoolWSTETHBalanceUpdated(WSTETH);
    }

    function increaseSIMDebt(uint _amount) external override {
        _requireCallerIsBOorTroveM();
        SIMDebt  = SIMDebt + _amount;
        emit ActivePoolSIMDebtUpdated(SIMDebt);
    }

    function decreaseSIMDebt(uint _amount) external override {
        _requireCallerIsBOorTroveMorSP();
        SIMDebt = SIMDebt - _amount;
        emit ActivePoolSIMDebtUpdated(SIMDebt);
    }

    // --- 'require' functions ---

    function _requireCallerIsBorrowerOperationsOrDefaultPool() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == defaultPoolAddress,
            "ActivePool: Caller is neither BO nor Default Pool");
    }

    function _requireCallerIsBOorTroveMorSP() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress ||
            msg.sender == stabilityPoolAddress,
            "ActivePool: Caller is neither BorrowerOperations nor TroveManager nor StabilityPool");
    }

    function _requireCallerIsBOorTroveM() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress,
            "ActivePool: Caller is neither BorrowerOperations nor TroveManager");
    }
}
