// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;


interface ICrossChainRateReceiver {
    function rate() external view returns (uint);
    function lastUpdated() external view returns (uint);
}
