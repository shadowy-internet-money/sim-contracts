// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./dependencies/CheckContract.sol";
import "./interfaces/ILockupContractFactory.sol";
import "./LockupContract.sol";


contract LockupContractFactory is ILockupContractFactory, Ownable, CheckContract {
    // --- Data ---
    string constant public NAME = "LockupContractFactory";
    uint constant internal SECONDS_IN_ONE_YEAR = 31536000;

    address public shadyTokenAddress;
    mapping (address => address) public lockupContractToDeployer;

    // --- Functions ---

    function setSHADYTokenAddress(address _shadyTokenAddress) external override onlyOwner {
        _checkContract(_shadyTokenAddress);

        shadyTokenAddress = _shadyTokenAddress;
        emit SHADYTokenAddressSet(_shadyTokenAddress);

        renounceOwnership();
    }

    function deployLockupContract(address _beneficiary, uint _unlockTime) external override {
        address shadyTokenAddressCached = shadyTokenAddress;
        _requireSHADYAddressIsSet(shadyTokenAddressCached);
        LockupContract lockupContract = new LockupContract(shadyTokenAddressCached, _beneficiary, _unlockTime);

        lockupContractToDeployer[address(lockupContract)] = msg.sender;
        emit LockupContractDeployedThroughFactory(address(lockupContract), _beneficiary, _unlockTime, msg.sender);
    }

    function isRegisteredLockup(address _contractAddress) public view override returns (bool) {
        return lockupContractToDeployer[_contractAddress] != address(0);
    }

    // --- 'require'  functions ---
    function _requireSHADYAddressIsSet(address _shadyTokenAddress) internal pure {
        require(_shadyTokenAddress != address(0), "LCF: SHADY address is not set");
    }
}
