// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @dev https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/proxies/interfaces/IProxy.sol
interface IProxy {
    function read() external view returns (int224 value, uint32 timestamp);

//    function api3ServerV1() external view returns (address);
}
