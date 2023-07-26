// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IProxy.sol";

contract Api3ProxyMock is IProxy {
    int224 private _price;
    uint32 private _timestamp;
    bool private _revert;

    function read() external view returns (int224 value, uint32 timestamp) {
        if (_revert) {
            require(1 == 0, "reverted");
        }

        return (_price, _timestamp);
    }

    function getUpdateTime() external view returns (uint) {
        return uint(_timestamp);
    }

    function setPrice(int224 value) external {
        _price = value;
    }

    function setUpdateTime(uint32 timestamp) external {
        _timestamp = timestamp;
    }

    function setRevert(bool revert_) external {
        _revert = revert_;
    }
}
