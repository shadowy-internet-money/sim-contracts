// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract CheckContract {
    /**
     * Check that the account is an already deployed non-destroyed contract.
     */
    function _checkContract(address account_) internal view {
        require(account_ != address(0), "Account cannot be zero address");

        uint256 size;
        // solhint-disable-next-line no-inline-assembly
        assembly { size := extcodesize(account_) }
        require(size > 0, "Account code size cannot be zero");
    }
}
