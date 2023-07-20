// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract WSTETHMock is ERC20 {
    constructor() ERC20("wstETH", "wstETH") {}

    function mint(address account_, uint256 amount_) external {
        _mint(account_, amount_);
    }

    function burn(address account_, uint256 amount_) external {
        _burn(account_, amount_);
    }
}