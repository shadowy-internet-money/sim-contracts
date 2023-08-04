// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/ICrossChainRateReceiver.sol";

contract CrossChainRateReceiverMock is ICrossChainRateReceiver {
    uint private _rate;
    uint private _timestamp;
    address private _owner;

    constructor() {
        _owner = msg.sender;
    }

    function rate() external view returns (uint) {
        return _rate;
    }

    function lastUpdated() external view returns (uint) {
        return _timestamp;
    }

    function setRate(uint rate_) external {
        require(msg.sender == _owner, "Now owner");
        _rate = rate_;
    }

    function setUpdateTime(uint timestamp) external {
        _timestamp = timestamp;
    }
}
