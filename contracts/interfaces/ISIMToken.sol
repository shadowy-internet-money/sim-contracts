// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface ISIMToken is IERC20, IERC20Permit {
    // --- Events ---

    event TroveManagerAddressChanged(address troveManagerAddress);
    event StabilityPoolAddressChanged(address newStabilityPoolAddress);
    event BorrowerOperationsAddressChanged(address newBorrowerOperationsAddress);
    event LUSDTokenBalanceUpdated(address user, uint amount);

    // --- Functions ---

    function mint(address account_, uint256 amount_) external;

    function burn(address account_, uint256 amount_) external;

    function sendToPool(address sender_, address poolAddress, uint256 amount_) external;

    function returnFromPool(address poolAddress, address user, uint256 amount_) external;
}
