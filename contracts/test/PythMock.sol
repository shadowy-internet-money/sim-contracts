// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPyth.sol";

contract PythMock is IPyth {
    bytes32 private _id;
    int64 private _price;
    int32 private _expo;
    uint private _publishTime;
    bool private _revert;

    function getPriceUnsafe(
        bytes32 id
    ) external view returns (PythStructs.Price memory price) {
        require(id == _id, "revert");
        if (_revert) {
            require(1 == 0, "reverted");
        }
        return PythStructs.Price({
            price: _price,
            conf: 0,
            expo: _expo,
            publishTime: _publishTime
        });
    }

    function getUpdateTime() external view returns (uint) {
        return _publishTime;
    }

    function setPrice(int64 price) external {
        _price = price;
    }

    function setExpo(int32 expo) external {
        _expo = expo;
    }

    function setUpdateTime(uint timestamp) external {
        _publishTime = timestamp;
    }

    function setFeedId(bytes32 id) external {
        _id = id;
    }

    function setRevert(bool revert_) external {
        _revert = revert_;
    }
}