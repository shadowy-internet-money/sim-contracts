// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IVe.sol";
import "hardhat/console.sol";

contract Ve is IVe {

    uint public F_WSTETH;  // Running sum of WSTETH fees
    uint public F_SIM; // Running sum of SIM fees

    function increaseF_WSTETH(uint _WSTETHFee) external {
        console.log('increaseF_WSTETH', _WSTETHFee);
        F_WSTETH += _WSTETHFee;
    }

    function increaseF_SIM(uint _SIMFee) external {
        console.log('increaseF_SIM', _SIMFee);
        F_SIM += _SIMFee;
    }
}
