// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/ICrossChainRateReceiver.sol";

contract CrossChainRateReceiverMock is ICrossChainRateReceiver {
    uint private _rate;
    uint private _timestamp;

    function rate() external view returns (uint) {
        return _rate;
    }

    function lastUpdated() external view returns (uint) {
        return _timestamp;
    }

    function setRate(uint rate_) external {
        _rate = rate_;
    }

    function setUpdateTime(uint timestamp) external {
        _timestamp = timestamp;
    }
}
