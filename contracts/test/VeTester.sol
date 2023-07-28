// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../Ve.sol";
import "../interfaces/ISHADYToken.sol";

contract VeTester is Ve {
    function unprotectedCallSHADYSendToVe(address shady_, address sender_, uint256 amount_) external {
        ISHADYToken(shady_).sendToVe(sender_, amount_);
    }
}