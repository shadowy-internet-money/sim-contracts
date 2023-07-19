// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IVe {
    function increaseF_WSTETH(uint _WSTETHFee) external;

    function increaseF_SIM(uint _SHADYFee) external;
}