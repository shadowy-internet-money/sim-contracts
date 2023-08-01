// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Common interface for the Trove Manager.
interface IBorrowerOperations {

    // --- Events ---

    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _activePoolAddress);
    event DefaultPoolAddressChanged(address _defaultPoolAddress);
    event StabilityPoolAddressChanged(address _stabilityPoolAddress);
    event GasPoolAddressChanged(address _gasPoolAddress);
    event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
    event PriceFeedAddressChanged(address  _newPriceFeedAddress);
    event SortedTrovesAddressChanged(address _sortedTrovesAddress);
    event SIMTokenAddressChanged(address _simTokenAddress);
    event SimVeDistributorAddressChanged(address _VeAddress);

    event TroveCreated(address indexed _borrower, uint arrayIndex);
    event TroveUpdated(address indexed _borrower, uint _debt, uint _coll, uint stake, uint8 operation);
    event SIMBorrowingFeePaid(address indexed _borrower, uint _SIMFee);

    // --- Functions ---

    function setAddresses(
        address _troveManagerAddress,
        address _activePoolAddress,
        address _defaultPoolAddress,
        address _stabilityPoolAddress,
        address _gasPoolAddress,
        address _collSurplusPoolAddress,
        address _priceFeedAddress,
        address _sortedTrovesAddress,
        address _simTokenAddress,
        address _shadyStakingAddress,
        address _feeReceiver
    ) external;

    function openTrove(uint amount, uint _maxFee, uint _SIMAmount, address _upperHint, address _lowerHint) external payable;

    function addColl(uint amount, address _upperHint, address _lowerHint) external;

    function moveWSTETHGainToTrove(address _user, address _upperHint, address _lowerHint) external payable;

    function withdrawColl(uint _amount, address _upperHint, address _lowerHint) external;

    function withdrawSIM(uint _maxFee, uint _amount, address _upperHint, address _lowerHint) external;

    function repaySIM(uint _amount, address _upperHint, address _lowerHint) external;

    function closeTrove() external;

    function adjustTrove(uint addColAmount, uint _maxFee, uint _collWithdrawal, uint _debtChange, bool isDebtIncrease, address _upperHint, address _lowerHint) external payable;

    function claimCollateral() external;

//    function getCompositeDebt(uint _debt) external pure returns (uint);
}
