// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "./dependencies/CheckContract.sol";
import "./interfaces/ISIMToken.sol";

contract SIMToken is ERC20, ERC20Permit, CheckContract, ISIMToken {
    address public immutable troveManagerAddress;
    address public immutable stabilityPoolAddress;
    address public immutable borrowerOperationsAddress;

    constructor(
        address troveManagerAddress_,
        address stabilityPoolAddress_,
        address borrowerOperationsAddress_
    ) ERC20("Shadowy Internet Money", "SIM") ERC20Permit("Shadowy Internet Money") {
        _checkContract(troveManagerAddress_);
        _checkContract(stabilityPoolAddress_);
        _checkContract(borrowerOperationsAddress_);

        troveManagerAddress = troveManagerAddress_;
        emit TroveManagerAddressChanged(troveManagerAddress_);

        stabilityPoolAddress = stabilityPoolAddress_;
        emit StabilityPoolAddressChanged(stabilityPoolAddress_);

        borrowerOperationsAddress = borrowerOperationsAddress_;
        emit BorrowerOperationsAddressChanged(borrowerOperationsAddress_);
    }

    // --- Functions for intra-protocol calls ---

    function mint(address account_, uint256 amount_) external override {
        _requireCallerIsBorrowerOperations();
        _mint(account_, amount_);
    }

    function burn(address account_, uint256 amount_) external override {
        _requireCallerIsBOorTroveMorSP();
        _burn(account_, amount_);
    }

    function transfer(address to, uint256 amount) public virtual override (ERC20, IERC20) returns (bool) {
        _requireValidRecipient(to);
        address owner = _msgSender();
        _transfer(owner, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override (ERC20, IERC20) returns (bool) {
        _requireValidRecipient(to);
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function sendToPool(address sender_,  address poolAddress_, uint256 amount_) external override {
        _requireCallerIsStabilityPool();
        _transfer(sender_, poolAddress_, amount_);
    }

    function returnFromPool(address poolAddress_, address receiver_, uint256 amount_) external override {
        _requireCallerIsTroveMorSP();
        _transfer(poolAddress_, receiver_, amount_);
    }

    // --- 'require' functions ---

    function _requireValidRecipient(address recipient_) internal view {
        require(
            recipient_ != address(this),
            "SIM: Cannot transfer tokens directly to the SIM token contract"
        );
        require(
            recipient_ != stabilityPoolAddress &&
            recipient_ != troveManagerAddress &&
            recipient_ != borrowerOperationsAddress,
            "SIM: Cannot transfer tokens directly to the StabilityPool, TroveManager or BorrowerOps"
        );
    }

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress, "SIMToken: Caller is not BorrowerOperations");
    }

    function _requireCallerIsBOorTroveMorSP() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress ||
            msg.sender == stabilityPoolAddress,
            "SIM: Caller is neither BorrowerOperations nor TroveManager nor StabilityPool"
        );
    }

    function _requireCallerIsStabilityPool() internal view {
        require(msg.sender == stabilityPoolAddress, "SIM: Caller is not the StabilityPool");
    }

    function _requireCallerIsTroveMorSP() internal view {
        require(
            msg.sender == troveManagerAddress || msg.sender == stabilityPoolAddress,
            "SIM: Caller is neither TroveManager nor StabilityPool");
    }
}
