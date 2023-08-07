// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "./dependencies/CheckContract.sol";
import "./interfaces/ISHADYToken.sol";
import "./interfaces/ILockupContractFactory.sol";

// https://github.com/liquity/dev/blob/main/packages/contracts/contracts/LQTY/LQTYToken.sol
contract SHADYToken is ERC20, ERC20Permit, CheckContract, ISHADYToken {
    uint internal constant ONE_YEAR_IN_SECONDS = 31536000;  // 60 * 60 * 24 * 365
    uint internal constant _1_MILLION = 1e24;    // 1e6 * 1e18 = 1e24

    uint internal immutable deploymentStartTime;
    address public immutable multisigAddress;
    address public immutable communityIssuanceAddress;
    address public immutable liquidityRewardsIssuanceAddress;
    // todo remove
    address public immutable veAddress;
    ILockupContractFactory public immutable lockupContractFactory;

    // --- Functions ---

    constructor(
        address communityIssuanceAddress_,
        address liquidityRewardsIssuanceAddress_,
        address veAddress_, // todo remove
        address lockupFactoryAddress_,
        address spenderAddress_,
        address multisigAddress_
    ) ERC20("Shady", "SHADY") ERC20Permit("Shady") {
        _checkContract(communityIssuanceAddress_);
        _checkContract(liquidityRewardsIssuanceAddress_);
        _checkContract(veAddress_);
        _checkContract(lockupFactoryAddress_);

        multisigAddress = multisigAddress_;
        deploymentStartTime  = block.timestamp;
        communityIssuanceAddress = communityIssuanceAddress_;
        liquidityRewardsIssuanceAddress = liquidityRewardsIssuanceAddress_;
        veAddress = veAddress_;// todo remove
        lockupContractFactory = ILockupContractFactory(lockupFactoryAddress_);

        // --- Initial SHADY allocations ---

        uint depositorsEntitlement = _1_MILLION * 30; // Allocate 30 million to the algorithmic issuance schedule
        _mint(communityIssuanceAddress_, depositorsEntitlement);

        uint lpRewardsEntitlement = _1_MILLION * 30; // Allocate 30 million to the algorithmic issuance schedule
        _mint(liquidityRewardsIssuanceAddress_, lpRewardsEntitlement);

        uint _spenderEntitlement = _1_MILLION * 14;  // Allocate 14 million for Public Sale, Community Reserve and initial liquidity
        _mint(spenderAddress_, _spenderEntitlement);

        // Allocate the remainder to the Multisig: (100 - 30 - 30 - 14) million = 26 million
        uint multisigEntitlement = _1_MILLION * 100 - depositorsEntitlement - lpRewardsEntitlement - _spenderEntitlement;
        _mint(multisigAddress_, multisigEntitlement);
    }

    // --- External functions ---

    function getDeploymentStartTime() external view override returns (uint256) {
        return deploymentStartTime;
    }

    function approve(address spender, uint256 amount) public virtual override (ERC20, IERC20) returns (bool) {
        if (_isFirstYear()) {
            _requireCallerIsNotMultisig();
        }

        address owner = _msgSender();
        _approve(owner, spender, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) public virtual override returns (bool) {
        if (_isFirstYear()) {
            _requireCallerIsNotMultisig();
        }

        address owner = _msgSender();
        _approve(owner, spender, allowance(owner, spender) + addedValue);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual override returns (bool) {
        if (_isFirstYear()) {
            _requireCallerIsNotMultisig();
        }

        address owner = _msgSender();
        uint256 currentAllowance = allowance(owner, spender);
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(owner, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    // TODO remove
    function sendToVe(address _sender, uint256 _amount) external override {
        _requireCallerIsVe();

        // Prevent the multisig from lock to ve
        if (_isFirstYear()) {
            _requireSenderIsNotMultisig(_sender);
        }

        _transfer(_sender, veAddress, _amount);
    }

    // --- hooks ---

    function _beforeTokenTransfer(address from, address to, uint256) internal virtual override {
        // Restrict the multisig's transfers in first year
        if (from == multisigAddress && _isFirstYear()) {
            _requireRecipientIsRegisteredLC(to);
        }

        if (from != address(0) && msg.sender != veAddress) {
            _requireValidRecipient(to);
        }
    }

    // --- Helper functions ---

    function _callerIsMultisig() internal view returns (bool) {
        return (msg.sender == multisigAddress);
    }

    function _isFirstYear() internal view returns (bool) {
        return (block.timestamp - deploymentStartTime < ONE_YEAR_IN_SECONDS);
    }

    // --- 'require' functions ---

    function _requireValidRecipient(address _recipient) internal view {
        require(
            _recipient != address(this),
            "SHADY: Cannot transfer tokens directly to the SHADY token contract"
        );
        require(
            _recipient != communityIssuanceAddress &&
            _recipient != liquidityRewardsIssuanceAddress &&
            _recipient != veAddress,
            "SHADY: Cannot transfer tokens directly to an issuance or ve contract"
        );
    }

    function _requireRecipientIsRegisteredLC(address _recipient) internal view {
        require(lockupContractFactory.isRegisteredLockup(_recipient),
            "SHADY: recipient must be a LockupContract registered in the Factory");
    }

    function _requireSenderIsNotMultisig(address _sender) internal view {
        require(_sender != multisigAddress, "SHADY: sender must not be the multisig");
    }

    function _requireCallerIsNotMultisig() internal view {
        require(!_callerIsMultisig(), "SHADY: caller must not be the multisig");
    }

    function _requireCallerIsVe() internal view { // todo remove
        require(msg.sender == veAddress, "SHADY: caller must be the ve contract");
    }
}
