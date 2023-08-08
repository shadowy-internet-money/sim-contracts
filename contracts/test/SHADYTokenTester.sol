// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../SHADYToken.sol";

contract SHADYTokenTester is SHADYToken {
    constructor
    (
        address communityIssuanceAddress_,
        address liquidityRewardsIssuanceAddress_,
        address lockupFactoryAddress_,
        address spenderAddress_,
        address multisigAddress_
    ) SHADYToken(
    communityIssuanceAddress_,
    liquidityRewardsIssuanceAddress_,
    lockupFactoryAddress_,
    spenderAddress_,
    multisigAddress_
    )
    {}

    function unprotectedMint(address account, uint256 amount) external {
        // No check for the caller here

        _mint(account, amount);
    }

    function callInternalApprove(address owner, address spender, uint256 amount) external returns (bool) {
        _approve(owner, spender, amount);
        return true;
    }

    function callInternalTransfer(address sender, address recipient, uint256 amount) external returns (bool) {
        _transfer(sender, recipient, amount);
        return true;
    }

    function getChainId() external view returns (uint256 chainID) {
        //return _chainID(); // it’s private
        assembly {
            chainID := chainid()
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}