// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IBorrowerOperations.sol";
import "./interfaces/ITroveManager.sol";
import "./interfaces/ISIMToken.sol";
import "./interfaces/ICollSurplusPool.sol";
import "./interfaces/ISortedTroves.sol";
import "./interfaces/IVeDistributor.sol";
import "./dependencies/Base.sol";
import "./dependencies/CheckContract.sol";

// https://github.com/liquity/dev/blob/main/packages/contracts/contracts/BorrowerOperations.sol
contract BorrowerOperations is Base, Ownable, CheckContract, IBorrowerOperations {
    string constant public NAME = "BorrowerOperations";

    // --- Connected contract declarations ---

    address public WSTETHAddress;

    ITroveManager public troveManager;

    address public stabilityPoolAddress;

    ICollSurplusPool public collSurplusPool;

    address public simVeDistributor;

    ISIMToken public simToken;

    // A doubly linked list of Troves, sorted by their collateral ratios
    ISortedTroves public sortedTroves;

    address public feeReceiver;

    /* --- Variable container structs  ---

    Used to hold, return and assign variables inside a function, in order to avoid the error:
    "CompilerError: Stack too deep". */

    struct LocalVariables_adjustTrove {
        uint price;
        uint collChange;
        uint netDebtChange;
        bool isCollIncrease;
        uint debt;
        uint coll;
        uint oldICR;
        uint newICR;
        uint newTCR;
        uint SIMFee;
        uint newDebt;
        uint newColl;
        uint stake;
    }

    struct LocalVariables_openTrove {
        uint price;
        uint SIMFee;
        uint netDebt;
        uint compositeDebt;
        uint ICR;
        uint NICR;
        uint stake;
        uint arrayIndex;
    }

    struct ContractsCache {
        ITroveManager troveManager;
        IActivePool activePool;
        ISIMToken simToken;
    }

    enum BorrowerOperation {
        openTrove,
        closeTrove,
        adjustTrove
    }

    // --- Dependency setters ---

    function setAddresses(
        address _WSTETHAddress,
        address _troveManagerAddress,
        address _activePoolAddress,
        address _defaultPoolAddress,
        address _stabilityPoolAddress,
        address _collSurplusPoolAddress,
        address _priceFeedAddress,
        address _sortedTrovesAddress,
        address _simTokenAddress,
        address _simVeDistributorAddress,
        address _feeReceiver
    )
    external
    override
    onlyOwner
    {
        // This makes impossible to open a trove with zero withdrawn SIM
        assert(MIN_NET_DEBT > 0);

        _checkContract(_WSTETHAddress);
        _checkContract(_troveManagerAddress);
        _checkContract(_activePoolAddress);
        _checkContract(_defaultPoolAddress);
        _checkContract(_stabilityPoolAddress);
        _checkContract(_collSurplusPoolAddress);
        _checkContract(_priceFeedAddress);
        _checkContract(_sortedTrovesAddress);
        _checkContract(_simTokenAddress);
        _checkContract(_simVeDistributorAddress);

        WSTETHAddress = _WSTETHAddress;
        troveManager = ITroveManager(_troveManagerAddress);
        activePool = IActivePool(_activePoolAddress);
        defaultPool = IDefaultPool(_defaultPoolAddress);
        stabilityPoolAddress = _stabilityPoolAddress;
        collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
        priceFeed = IPriceFeed(_priceFeedAddress);
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
        simToken = ISIMToken(_simTokenAddress);
        simVeDistributor = _simVeDistributorAddress;
        feeReceiver = _feeReceiver;

        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);
        emit DefaultPoolAddressChanged(_defaultPoolAddress);
        emit StabilityPoolAddressChanged(_stabilityPoolAddress);
        emit CollSurplusPoolAddressChanged(_collSurplusPoolAddress);
        emit PriceFeedAddressChanged(_priceFeedAddress);
        emit SortedTrovesAddressChanged(_sortedTrovesAddress);
        emit SIMTokenAddressChanged(_simTokenAddress);
        emit SimVeDistributorAddressChanged(_simVeDistributorAddress);

        renounceOwnership();
    }

    // --- Borrower Trove Operations ---

    function openTrove(uint amount, uint _maxFeePercentage, uint _SIMAmount, address _upperHint, address _lowerHint) external payable override {
        ContractsCache memory contractsCache = ContractsCache(troveManager, activePool, simToken);
        LocalVariables_openTrove memory vars;

        require(IERC20(WSTETHAddress).transferFrom(msg.sender, address(this), amount));

        vars.price = priceFeed.fetchPrice();
        bool isRecoveryMode = _checkRecoveryMode(vars.price);

        _requireValidMaxFeePercentage(_maxFeePercentage, isRecoveryMode);
        _requireTroveisNotActive(contractsCache.troveManager, msg.sender);

        vars.SIMFee;
        vars.netDebt = _SIMAmount;

        if (!isRecoveryMode) {
            vars.SIMFee = _triggerBorrowingFee(contractsCache.troveManager, contractsCache.simToken, _SIMAmount, _maxFeePercentage);
            vars.netDebt = vars.netDebt + vars.SIMFee;
        }
        _requireAtLeastMinNetDebt(vars.netDebt);

        // ICR is based on the composite debt, i.e. the requested SIM amount + SIM borrowing fee + SIM gas comp.
        vars.compositeDebt = _getCompositeDebt(vars.netDebt);
        assert(vars.compositeDebt > 0);

        vars.ICR = LiquityMath._computeCR(amount, vars.compositeDebt, vars.price);
        vars.NICR = LiquityMath._computeNominalCR(amount, vars.compositeDebt);

        if (isRecoveryMode) {
            _requireICRisAboveCCR(vars.ICR);
        } else {
            _requireICRisAboveMCR(vars.ICR);
            uint newTCR = _getNewTCRFromTroveChange(amount, true, vars.compositeDebt, true, vars.price);  // bools: coll increase, debt increase
            _requireNewTCRisAboveCCR(newTCR);
        }

        // Set the trove struct's properties
        contractsCache.troveManager.setTroveStatus(msg.sender, 1);
        contractsCache.troveManager.increaseTroveColl(msg.sender, amount);
        contractsCache.troveManager.increaseTroveDebt(msg.sender, vars.compositeDebt);

        contractsCache.troveManager.updateTroveRewardSnapshots(msg.sender);
        vars.stake = contractsCache.troveManager.updateStakeAndTotalStakes(msg.sender);

        sortedTroves.insert(msg.sender, vars.NICR, _upperHint, _lowerHint);
        vars.arrayIndex = contractsCache.troveManager.addTroveOwnerToArray(msg.sender);
        emit TroveCreated(msg.sender, vars.arrayIndex);

        // Move the ether to the Active Pool, and mint the SIMAmount to the borrower
        _activePoolAddColl(contractsCache.activePool, amount);
        _withdrawSIM(contractsCache.activePool, contractsCache.simToken, msg.sender, _SIMAmount, vars.netDebt);

        emit TroveUpdated(msg.sender, vars.compositeDebt, amount, vars.stake, uint8(BorrowerOperation.openTrove));
        emit SIMBorrowingFeePaid(msg.sender, vars.SIMFee);
    }

    // Send WSTETH as collateral to a trove
    function addColl(uint amount, address _upperHint, address _lowerHint) external override {
        require(IERC20(WSTETHAddress).transferFrom(msg.sender, address(this), amount));
        _adjustTrove(msg.sender, 0, 0, false, _upperHint, _lowerHint, 0);
    }

    // Send WSTETH as collateral to a trove. Called by only the Stability Pool.
    function moveWSTETHGainToTrove(address _borrower, address _upperHint, address _lowerHint) external payable override {
        _requireCallerIsStabilityPool();
        _adjustTrove(_borrower, 0, 0, false, _upperHint, _lowerHint, 0);
    }

    // Withdraw WSTETH collateral from a trove
    function withdrawColl(uint _collWithdrawal, address _upperHint, address _lowerHint) external override {
        _adjustTrove(msg.sender, _collWithdrawal, 0, false, _upperHint, _lowerHint, 0);
    }

    // Withdraw SIM tokens from a trove: mint new SIM tokens to the owner, and increase the trove's debt accordingly
    function withdrawSIM(uint _maxFeePercentage, uint _SIMAmount, address _upperHint, address _lowerHint) external override {
        _adjustTrove(msg.sender, 0, _SIMAmount, true, _upperHint, _lowerHint, _maxFeePercentage);
    }

    // Repay SIM tokens to a Trove: Burn the repaid SIM tokens, and reduce the trove's debt accordingly
    function repaySIM(uint _SIMAmount, address _upperHint, address _lowerHint) external override {
        _adjustTrove(msg.sender, 0, _SIMAmount, false, _upperHint, _lowerHint, 0);
    }

    function adjustTrove(uint addColAmount, uint _maxFeePercentage, uint _collWithdrawal, uint _SIMChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) external payable override {
        if (addColAmount > 0) {
            require(IERC20(WSTETHAddress).transferFrom(msg.sender, address(this), addColAmount));
        }
        _adjustTrove(msg.sender, _collWithdrawal, _SIMChange, _isDebtIncrease, _upperHint, _lowerHint, _maxFeePercentage);
    }

    /*
    * _adjustTrove(): Alongside a debt change, this function can perform either a collateral top-up or a collateral withdrawal.
    *
    * It therefore expects either a positive msg.value, or a positive _collWithdrawal argument.
    *
    * If both are positive, it will revert.
    */
    function _adjustTrove(address _borrower, uint _collWithdrawal, uint _SIMChange, bool _isDebtIncrease, address _upperHint, address _lowerHint, uint _maxFeePercentage) internal {
        ContractsCache memory contractsCache = ContractsCache(troveManager, activePool, simToken);
        LocalVariables_adjustTrove memory vars;

        vars.price = priceFeed.fetchPrice();
        bool isRecoveryMode = _checkRecoveryMode(vars.price);

        if (_isDebtIncrease) {
            _requireValidMaxFeePercentage(_maxFeePercentage, isRecoveryMode);
            _requireNonZeroDebtChange(_SIMChange);
        }
        _requireSingularCollChange(_collWithdrawal);
        _requireNonZeroAdjustment(_collWithdrawal, _SIMChange);
        _requireTroveisActive(contractsCache.troveManager, _borrower);

        // Confirm the operation is either a borrower adjusting their own trove, or a pure WSTETH transfer from the Stability Pool to a trove
        uint b = IERC20(WSTETHAddress).balanceOf(address(this));
        assert(msg.sender == _borrower || (msg.sender == stabilityPoolAddress && b > 0 && _SIMChange == 0));

        contractsCache.troveManager.applyPendingRewards(_borrower);

        // Get the collChange based on whether or not WSTETH was sent in the transaction
        (vars.collChange, vars.isCollIncrease) = _getCollChange(b, _collWithdrawal);

        vars.netDebtChange = _SIMChange;

        // If the adjustment incorporates a debt increase and system is in Normal Mode, then trigger a borrowing fee
        if (_isDebtIncrease && !isRecoveryMode) {
            vars.SIMFee = _triggerBorrowingFee(contractsCache.troveManager, contractsCache.simToken, _SIMChange, _maxFeePercentage);
            vars.netDebtChange = vars.netDebtChange + vars.SIMFee; // The raw debt change includes the fee
        }

        vars.debt = contractsCache.troveManager.getTroveDebt(_borrower);
        vars.coll = contractsCache.troveManager.getTroveColl(_borrower);

        // Get the trove's old ICR before the adjustment, and what its new ICR will be after the adjustment
        vars.oldICR = LiquityMath._computeCR(vars.coll, vars.debt, vars.price);
        vars.newICR = _getNewICRFromTroveChange(vars.coll, vars.debt, vars.collChange, vars.isCollIncrease, vars.netDebtChange, _isDebtIncrease, vars.price);
        assert(_collWithdrawal <= vars.coll);

        // Check the adjustment satisfies all conditions for the current system mode
        _requireValidAdjustmentInCurrentMode(isRecoveryMode, _collWithdrawal, _isDebtIncrease, vars);

        // When the adjustment is a debt repayment, check it's a valid amount and that the caller has enough SIM
        if (!_isDebtIncrease && _SIMChange > 0) {
            _requireAtLeastMinNetDebt(_getNetDebt(vars.debt) - vars.netDebtChange);
            _requireValidSIMRepayment(vars.debt, vars.netDebtChange);
            _requireSufficientSIMBalance(contractsCache.simToken, _borrower, vars.netDebtChange);
        }

        (vars.newColl, vars.newDebt) = _updateTroveFromAdjustment(contractsCache.troveManager, _borrower, vars.collChange, vars.isCollIncrease, vars.netDebtChange, _isDebtIncrease);
        vars.stake = contractsCache.troveManager.updateStakeAndTotalStakes(_borrower);

        // Re-insert trove in to the sorted list
        uint newNICR = _getNewNominalICRFromTroveChange(vars.coll, vars.debt, vars.collChange, vars.isCollIncrease, vars.netDebtChange, _isDebtIncrease);
        sortedTroves.reInsert(_borrower, newNICR, _upperHint, _lowerHint);

        emit TroveUpdated(_borrower, vars.newDebt, vars.newColl, vars.stake, uint8(BorrowerOperation.adjustTrove));
        emit SIMBorrowingFeePaid(msg.sender,  vars.SIMFee);

        // Use the unmodified _SIMChange here, as we don't send the fee to the user
        _moveTokensAndWSTETHfromAdjustment(
            contractsCache.activePool,
            contractsCache.simToken,
            msg.sender,
            vars.collChange,
            vars.isCollIncrease,
            _SIMChange,
            _isDebtIncrease,
            vars.netDebtChange
        );
    }

    function closeTrove() external override {
        ITroveManager troveManagerCached = troveManager;
        IActivePool activePoolCached = activePool;
        ISIMToken simTokenCached = simToken;

        _requireTroveisActive(troveManagerCached, msg.sender);
        uint price = priceFeed.fetchPrice();
        _requireNotInRecoveryMode(price);

        troveManagerCached.applyPendingRewards(msg.sender);

        uint coll = troveManagerCached.getTroveColl(msg.sender);
        uint debt = troveManagerCached.getTroveDebt(msg.sender);

        _requireSufficientSIMBalance(simTokenCached, msg.sender, debt/*.sub(SIM_GAS_COMPENSATION)*/);

        uint newTCR = _getNewTCRFromTroveChange(coll, false, debt, false, price);
        _requireNewTCRisAboveCCR(newTCR);

        troveManagerCached.removeStake(msg.sender);
        troveManagerCached.closeTrove(msg.sender);

        emit TroveUpdated(msg.sender, 0, 0, 0, uint8(BorrowerOperation.closeTrove));

        // Burn the repaid SIM from the user's balance and the gas compensation from the Gas Pool
        _repaySIM(activePoolCached, simTokenCached, msg.sender, debt);

        // Send the collateral back to the user
        activePoolCached.sendWSTETH(msg.sender, coll);
    }

    /**
     * Claim remaining collateral from a redemption or from a liquidation with ICR > MCR in Recovery Mode
     */
    function claimCollateral() external override {
        // send WSTETH from CollSurplus Pool to owner
        collSurplusPool.claimColl(msg.sender);
    }

    // --- Helper functions ---

    function _triggerBorrowingFee(ITroveManager _troveManager, ISIMToken _simToken, uint _SIMAmount, uint _maxFeePercentage) internal returns (uint) {
        _troveManager.decayBaseRateFromBorrowing(); // decay the baseRate state variable
        uint SIMFee = _troveManager.getBorrowingFee(_SIMAmount);

        _requireUserAcceptsFee(SIMFee, _SIMAmount, _maxFeePercentage);

        // Send half of fee to Ve contract
        uint half = SIMFee / 2;
        _simToken.mint(simVeDistributor, half);
        IVeDistributor(simVeDistributor).checkpoint();

        // Send half of fee to feeReceiver
        _simToken.mint(feeReceiver, SIMFee - half);

        return SIMFee;
    }

    /*function _getUSDValue(uint _coll, uint _price) internal pure returns (uint) {
        uint usdValue = _price * _coll / DECIMAL_PRECISION;

        return usdValue;
    }*/

    function _getCollChange(
        uint _collReceived,
        uint _requestedCollWithdrawal
    )
    internal
    pure
    returns(uint collChange, bool isCollIncrease)
    {
        if (_collReceived != 0) {
            collChange = _collReceived;
            isCollIncrease = true;
        } else {
            collChange = _requestedCollWithdrawal;
        }
    }

    // Update trove's coll and debt based on whether they increase or decrease
    function _updateTroveFromAdjustment
    (
        ITroveManager _troveManager,
        address _borrower,
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease
    )
    internal
    returns (uint, uint)
    {
        uint newColl = (_isCollIncrease) ? _troveManager.increaseTroveColl(_borrower, _collChange)
            : _troveManager.decreaseTroveColl(_borrower, _collChange);
        uint newDebt = (_isDebtIncrease) ? _troveManager.increaseTroveDebt(_borrower, _debtChange)
            : _troveManager.decreaseTroveDebt(_borrower, _debtChange);

        return (newColl, newDebt);
    }

    function _moveTokensAndWSTETHfromAdjustment
    (
        IActivePool _activePool,
        ISIMToken _simToken,
        address _borrower,
        uint _collChange,
        bool _isCollIncrease,
        uint _SIMChange,
        bool _isDebtIncrease,
        uint _netDebtChange
    )
    internal
    {
        if (_isDebtIncrease) {
            _withdrawSIM(_activePool, _simToken, _borrower, _SIMChange, _netDebtChange);
        } else {
            _repaySIM(_activePool, _simToken, _borrower, _SIMChange);
        }

        if (_isCollIncrease) {
            _activePoolAddColl(_activePool, _collChange);
        } else {
            _activePool.sendWSTETH(_borrower, _collChange);
        }
    }

    // Send WSTETH to Active Pool and increase its recorded WSTETH balance
    function _activePoolAddColl(IActivePool _activePool, uint _amount) internal {
        require(IERC20(WSTETHAddress).transfer(address(_activePool), _amount));
        _activePool.receiveWSTETH(_amount);
    }

    // Issue the specified amount of SIM to _account and increases the total active debt (_netDebtIncrease potentially includes a SIMFee)
    function _withdrawSIM(IActivePool _activePool, ISIMToken _simToken, address _account, uint _SIMAmount, uint _netDebtIncrease) internal {
        _activePool.increaseSIMDebt(_netDebtIncrease);
        _simToken.mint(_account, _SIMAmount);
    }

    // Burn the specified amount of SIM from _account and decreases the total active debt
    function _repaySIM(IActivePool _activePool, ISIMToken _simToken, address _account, uint _SIM) internal {
        _activePool.decreaseSIMDebt(_SIM);
        _simToken.burn(_account, _SIM);
    }

    // --- 'Require' wrapper functions ---

    function _requireSingularCollChange(uint _collWithdrawal) internal view {
        require(IERC20(WSTETHAddress).balanceOf(address(this)) == 0 || _collWithdrawal == 0, "BorrowerOperations: Cannot withdraw and add coll");
    }

    /*function _requireCallerIsBorrower(address _borrower) internal view {
        require(msg.sender == _borrower, "BorrowerOps: Caller must be the borrower for a withdrawal");
    }*/

    function _requireNonZeroAdjustment(uint _collWithdrawal, uint _SIMChange) internal view {
        require(IERC20(WSTETHAddress).balanceOf(address(this)) != 0 || _collWithdrawal != 0 || _SIMChange != 0, "BorrowerOps: There must be either a collateral change or a debt change");
    }

    function _requireTroveisActive(ITroveManager _troveManager, address _borrower) internal view {
        uint status = _troveManager.getTroveStatus(_borrower);
        require(status == 1, "BorrowerOps: Trove does not exist or is closed");
    }

    function _requireTroveisNotActive(ITroveManager _troveManager, address _borrower) internal view {
        uint status = _troveManager.getTroveStatus(_borrower);
        require(status != 1, "BorrowerOps: Trove is active");
    }

    function _requireNonZeroDebtChange(uint _SIMChange) internal pure {
        require(_SIMChange > 0, "BorrowerOps: Debt increase requires non-zero debtChange");
    }

    function _requireNotInRecoveryMode(uint _price) internal view {
        require(!_checkRecoveryMode(_price), "BorrowerOps: Operation not permitted during Recovery Mode");
    }

    function _requireNoCollWithdrawal(uint _collWithdrawal) internal pure {
        require(_collWithdrawal == 0, "BorrowerOps: Collateral withdrawal not permitted Recovery Mode");
    }

    function _requireValidAdjustmentInCurrentMode
    (
        bool _isRecoveryMode,
        uint _collWithdrawal,
        bool _isDebtIncrease,
        LocalVariables_adjustTrove memory _vars
    )
    internal
    view
    {
        /*
        *In Recovery Mode, only allow:
        *
        * - Pure collateral top-up
        * - Pure debt repayment
        * - Collateral top-up with debt repayment
        * - A debt increase combined with a collateral top-up which makes the ICR >= 150% and improves the ICR (and by extension improves the TCR).
        *
        * In Normal Mode, ensure:
        *
        * - The new ICR is above MCR
        * - The adjustment won't pull the TCR below CCR
        */
        if (_isRecoveryMode) {
            _requireNoCollWithdrawal(_collWithdrawal);
            if (_isDebtIncrease) {
                _requireICRisAboveCCR(_vars.newICR);
                _requireNewICRisAboveOldICR(_vars.newICR, _vars.oldICR);
            }
        } else { // if Normal Mode
            _requireICRisAboveMCR(_vars.newICR);
            _vars.newTCR = _getNewTCRFromTroveChange(_vars.collChange, _vars.isCollIncrease, _vars.netDebtChange, _isDebtIncrease, _vars.price);
            _requireNewTCRisAboveCCR(_vars.newTCR);
        }
    }

    function _requireICRisAboveMCR(uint _newICR) internal pure {
        require(_newICR >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
    }

    function _requireICRisAboveCCR(uint _newICR) internal pure {
        require(_newICR >= CCR, "BorrowerOps: Operation must leave trove with ICR >= CCR");
    }

    function _requireNewICRisAboveOldICR(uint _newICR, uint _oldICR) internal pure {
        require(_newICR >= _oldICR, "BorrowerOps: Cannot decrease your Trove's ICR in Recovery Mode");
    }

    function _requireNewTCRisAboveCCR(uint _newTCR) internal pure {
        require(_newTCR >= CCR, "BorrowerOps: An operation that would result in TCR < CCR is not permitted");
    }

    function _requireAtLeastMinNetDebt(uint _netDebt) internal pure {
        require (_netDebt >= MIN_NET_DEBT, "BorrowerOps: Trove's net debt must be greater than minimum");
    }

    function _requireValidSIMRepayment(uint _currentDebt, uint _debtRepayment) internal pure {
        require(_debtRepayment <= _currentDebt/*.sub(SIM_GAS_COMPENSATION)*/, "BorrowerOps: Amount repaid must not be larger than the Trove's debt");
    }

    function _requireCallerIsStabilityPool() internal view {
        require(msg.sender == stabilityPoolAddress, "BorrowerOps: Caller is not Stability Pool");
    }

    function _requireSufficientSIMBalance(ISIMToken _simToken, address _borrower, uint _debtRepayment) internal view {
        require(_simToken.balanceOf(_borrower) >= _debtRepayment, "BorrowerOps: Caller doesnt have enough SIM to make repayment");
    }

    function _requireValidMaxFeePercentage(uint _maxFeePercentage, bool _isRecoveryMode) internal pure {
        if (_isRecoveryMode) {
            require(_maxFeePercentage <= DECIMAL_PRECISION,
                "Max fee percentage must less than or equal to 100%");
        } else {
            require(_maxFeePercentage >= BORROWING_FEE_FLOOR && _maxFeePercentage <= DECIMAL_PRECISION,
                "Max fee percentage must be between 0.5% and 100%");
        }
    }

    // --- ICR and TCR getters ---

    // Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
    function _getNewNominalICRFromTroveChange
    (
        uint _coll,
        uint _debt,
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease
    )
    pure
    internal
    returns (uint)
    {
        (uint newColl, uint newDebt) = _getNewTroveAmounts(_coll, _debt, _collChange, _isCollIncrease, _debtChange, _isDebtIncrease);

        uint newNICR = LiquityMath._computeNominalCR(newColl, newDebt);
        return newNICR;
    }

    // Compute the new collateral ratio, considering the change in coll and debt. Assumes 0 pending rewards.
    function _getNewICRFromTroveChange
    (
        uint _coll,
        uint _debt,
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease,
        uint _price
    )
    pure
    internal
    returns (uint)
    {
        (uint newColl, uint newDebt) = _getNewTroveAmounts(_coll, _debt, _collChange, _isCollIncrease, _debtChange, _isDebtIncrease);

        uint newICR = LiquityMath._computeCR(newColl, newDebt, _price);
        return newICR;
    }

    function _getNewTroveAmounts(
        uint _coll,
        uint _debt,
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease
    )
    internal
    pure
    returns (uint, uint)
    {
        uint newColl = _coll;
        uint newDebt = _debt;

        newColl = _isCollIncrease ? _coll + _collChange :  _coll - _collChange;
        newDebt = _isDebtIncrease ? _debt + _debtChange : _debt - _debtChange;

        return (newColl, newDebt);
    }

    function _getNewTCRFromTroveChange
    (
        uint _collChange,
        bool _isCollIncrease,
        uint _debtChange,
        bool _isDebtIncrease,
        uint _price
    )
    internal
    view
    returns (uint)
    {
        uint totalColl = getEntireSystemColl();
        uint totalDebt = getEntireSystemDebt();

        totalColl = _isCollIncrease ? totalColl + _collChange : totalColl - _collChange;
        totalDebt = _isDebtIncrease ? totalDebt + _debtChange : totalDebt - _debtChange;

        uint newTCR = LiquityMath._computeCR(totalColl, totalDebt, _price);
        return newTCR;
    }

    /*function getCompositeDebt(uint _debt) external pure override returns (uint) {
        return _getCompositeDebt(_debt);
    }*/
}
