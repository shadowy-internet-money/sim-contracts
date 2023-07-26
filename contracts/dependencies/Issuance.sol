// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/ISHADYToken.sol";
import "../interfaces/IIssuance.sol";
import "./BaseMath.sol";
import "./LiquityMath.sol";
import "./CheckContract.sol";


abstract contract Issuance is IIssuance, Ownable, CheckContract, BaseMath {
    // --- Data ---

    uint constant public SECONDS_IN_ONE_MINUTE = 60;

   /* The issuance factor F determines the curvature of the issuance curve.
    *
    * Minutes in one year: 60*24*365 = 525600
    *
    * For 50% of remaining tokens issued each year, with minutes as time units, we have:
    * 
    * F ** 525600 = 0.5
    * 
    * Re-arranging:
    * 
    * 525600 * ln(F) = ln(0.5)
    * F = 0.5 ** (1/525600)
    * F = 0.999998681227695000 
    */
    uint constant public ISSUANCE_FACTOR = 999998681227695000;

    /* 
    * The community SHADY supply cap is the starting balance of the Community Issuance contract.
    * It should be minted to this contract by SHADYToken, when the token is deployed.
    * 
    * Set to 32M (slightly less than 1/3) of total SHADY supply.
    */
    uint constant public SHADYSupplyCap = 30e24; // 30 million

    ISHADYToken public shadyToken;

    address public issuerAddress;

    uint public totalSHADYIssued;
    uint public immutable deploymentTime;

    // --- Functions ---

    constructor() {
        deploymentTime = block.timestamp;
    }

    function setAddresses(
        address _shadyTokenAddress, 
        address _issuerAddress
    ) external virtual onlyOwner override {
        _checkContract(_shadyTokenAddress);
//        _checkContract(_issuerAddress);

        shadyToken = ISHADYToken(_shadyTokenAddress);
        issuerAddress = _issuerAddress;

        // When SHADYToken deployed, it should have transferred CommunityIssuance's SHADY entitlement
        uint SHADYBalance = shadyToken.balanceOf(address(this));
        assert(SHADYBalance >= SHADYSupplyCap);

        emit SHADYTokenAddressSet(_shadyTokenAddress);
        emit StabilityPoolAddressSet(_issuerAddress);

        renounceOwnership();
    }

    function issueSHADY() external override returns (uint) {
        _requireCallerIsIssuer();

        uint latestTotalSHADYIssued = SHADYSupplyCap * _getCumulativeIssuanceFraction() / DECIMAL_PRECISION;
        uint issuance = latestTotalSHADYIssued - totalSHADYIssued;

        totalSHADYIssued = latestTotalSHADYIssued;
        emit TotalSHADYIssuedUpdated(latestTotalSHADYIssued);
        
        return issuance;
    }

    /* Gets 1-f^t    where: f < 1

    f: issuance factor that determines the shape of the curve
    t:  time passed since last SHADY issuance event  */
    function _getCumulativeIssuanceFraction() internal view returns (uint) {
        // Get the time passed since deployment
        uint timePassedInMinutes = (block.timestamp - deploymentTime) / SECONDS_IN_ONE_MINUTE;

        // f^t
        uint power = LiquityMath._decPow(ISSUANCE_FACTOR, timePassedInMinutes);

        //  (1 - f^t)
        uint cumulativeIssuanceFraction = (uint(DECIMAL_PRECISION) - power);
        assert(cumulativeIssuanceFraction <= DECIMAL_PRECISION); // must be in range [0,1]

        return cumulativeIssuanceFraction;
    }

    function sendSHADY(address _account, uint _SHADYamount) external override {
        _requireCallerIsIssuer();

        shadyToken.transfer(_account, _SHADYamount);
    }

    // --- 'require' functions ---

    function _requireCallerIsIssuer() internal view {
        require(msg.sender == issuerAddress, "CommunityIssuance: caller is not issuer");
    }
}
