// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import './interfaces/IDefaultPool.sol';
import "./dependencies/CheckContract.sol";

/*
 * The Default Pool holds the WSTETH and SIM debt (but not SIM tokens) from liquidations that have been redistributed
 * to active troves but not yet "applied", i.e. not yet recorded on a recipient active trove's struct.
 *
 * When a trove makes an operation that applies its pending WSTETH and SIM debt, its pending WSTETH and SIM debt is moved
 * from the Default Pool to the Active Pool.
 */
contract DefaultPool is Ownable, CheckContract, IDefaultPool {
    string constant public NAME = "DefaultPool";

    address public WSTETHAddress;
    address public troveManagerAddress;
    address public activePoolAddress;
    uint256 internal WSTETH;  // deposited WSTETH tracker
    uint256 internal SIMDebt;  // debt

    // --- Dependency setters ---

    function setAddresses(
        address _WSTETHAddress,
        address _troveManagerAddress,
        address _activePoolAddress
    )
        external
        onlyOwner
    {
        _checkContract(_WSTETHAddress);
        _checkContract(_troveManagerAddress);
        _checkContract(_activePoolAddress);

        WSTETHAddress = _WSTETHAddress;
        troveManagerAddress = _troveManagerAddress;
        activePoolAddress = _activePoolAddress;

        emit WSTETHAddressChanged(_WSTETHAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);

        renounceOwnership();
    }

    // --- Getters for public variables. Required by IPool interface ---

    /*
    * Returns the WSTETH state variable.
    *
    * Not necessarily equal to the the contract's raw WSTETH balance - ether can be forcibly sent to contracts.
    */
    function getWSTETH() external view override returns (uint) {
        return WSTETH;
    }

    function getSIMDebt() external view override returns (uint) {
        return SIMDebt;
    }

    // --- Pool functionality ---

    function sendWSTETHToActivePool(uint _amount) external override {
        _requireCallerIsTroveManager();
        address activePool = activePoolAddress; // cache to save an SLOAD
        WSTETH -= _amount;
        emit DefaultPoolWSTETHBalanceUpdated(WSTETH);
        emit EtherSent(activePool, _amount);

        IERC20(WSTETHAddress).transfer(activePool, _amount);
    }

    function receiveWSTETH(uint amount) external {
        _requireCallerIsActivePool();
        WSTETH += amount;
        emit DefaultPoolWSTETHBalanceUpdated(WSTETH);
    }

    function increaseSIMDebt(uint _amount) external override {
        _requireCallerIsTroveManager();
        SIMDebt = SIMDebt + _amount;
        emit DefaultPoolSIMDebtUpdated(SIMDebt);
    }

    function decreaseSIMDebt(uint _amount) external override {
        _requireCallerIsTroveManager();
        SIMDebt = SIMDebt - _amount;
        emit DefaultPoolSIMDebtUpdated(SIMDebt);
    }

    // --- 'require' functions ---

    function _requireCallerIsActivePool() internal view {
        require(msg.sender == activePoolAddress, "DefaultPool: Caller is not the ActivePool");
    }

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == troveManagerAddress, "DefaultPool: Caller is not the TroveManager");
    }

}
