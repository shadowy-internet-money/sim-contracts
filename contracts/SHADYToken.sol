// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "./dependencies/CheckContract.sol";
import "./interfaces/ISHADYToken.sol";
import "./interfaces/ILockupContractFactory.sol";

contract SHADYToken is ERC20, ERC20Permit, CheckContract, ISHADYToken {
    uint internal constant ONE_YEAR_IN_SECONDS = 31536000;  // 60 * 60 * 24 * 365
    uint internal constant _1_MILLION = 1e24;    // 1e6 * 1e18 = 1e24

    uint internal immutable deploymentStartTime;
    address public immutable multisigAddress;
    address public immutable communityIssuanceAddress;
    address public immutable veAddress;
    uint internal immutable lpRewardsEntitlement;
    ILockupContractFactory public immutable lockupContractFactory;

    // --- Functions ---

    constructor(
        address communityIssuanceAddress_,
        address veAddress_,
        address lockupFactoryAddress_,
        address bountyAddress_,
        address lpRewardsAddress_,
        address multisigAddress_
    ) ERC20("Shady", "SHADY") ERC20Permit("Shady") {
        _checkContract(communityIssuanceAddress_);
        _checkContract(veAddress_);
        _checkContract(lockupFactoryAddress_);

        multisigAddress = multisigAddress_;
        deploymentStartTime  = block.timestamp;
        communityIssuanceAddress = communityIssuanceAddress_;
        veAddress = veAddress_;
        lockupContractFactory = ILockupContractFactory(lockupFactoryAddress_);

        // --- Initial SHADY allocations ---

        uint bountyEntitlement = _1_MILLION * 2; // Allocate 2 million for bounties/hackathons
        _mint(bountyAddress_, bountyEntitlement);

        uint depositorsEntitlement = _1_MILLION * 32; // Allocate 32 million to the algorithmic issuance schedule
        _mint(communityIssuanceAddress_, depositorsEntitlement);

        uint _lpRewardsEntitlement = _1_MILLION * 4 / 3;  // Allocate 1.33 million for LP rewards
        lpRewardsEntitlement = _lpRewardsEntitlement;
        _mint(lpRewardsAddress_, _lpRewardsEntitlement);

        // Allocate the remainder to the Multisig: (100 - 2 - 32 - 1.33) million = 64.66 million
        uint multisigEntitlement = _1_MILLION * 100 - bountyEntitlement - depositorsEntitlement - _lpRewardsEntitlement;
        _mint(multisigAddress_, multisigEntitlement);
    }

    // --- External functions ---

    function getDeploymentStartTime() external view override returns (uint256) {
        return deploymentStartTime;
    }

    function getLpRewardsEntitlement() external view override returns (uint256) {
        return lpRewardsEntitlement;
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

        if (from != address(0)) {
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
            _recipient != veAddress,
            "SHADY: Cannot transfer tokens directly to the community issuance or ve contract"
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

    function _requireCallerIsVe() internal view {
        require(msg.sender == veAddress, "SHADY: caller must be the ve contract");
    }
}