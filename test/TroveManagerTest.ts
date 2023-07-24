import {MoneyValues, TestHelper} from "../utils/TestHelper";
import {IContracts, IOpenTroveParams, IWithdrawSIMParams} from "../utils/types";
import {
  ActivePool,
  BorrowerOperationsTester, CollSurplusPool, DefaultPool, HintHelpers,
  PriceFeedMock, SIMTokenTester,
  SortedTroves, StabilityPool,
  TroveManagerTester
} from "../typechain-types";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber} from "ethers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {assert, ethers} from "hardhat";
import {parseUnits} from "ethers/lib/utils";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const mv = MoneyValues
const timeValues = th.TimeValues

const GAS_PRICE = 10000000


/* NOTE: Some tests involving ETH redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific ETH gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the TroveManager, which is still TBD based on economic modelling.
 * 
 */ 
describe('TroveManager', async () => {
  let bountyAddress: string, lpRewardsAddress: string, multisig: string

  const _18_zeros = '000000000000000000'
  const ZERO_ADDRESS = th.ZERO_ADDRESS

  let contracts: IContracts
  let priceFeed: PriceFeedMock
  let troveManager: TroveManagerTester
  let borrowerOperations: BorrowerOperationsTester
  let activePool: ActivePool
  let sortedTroves: SortedTroves
  let simToken: SIMTokenTester
  let defaultPool: DefaultPool
  let stabilityPool: StabilityPool
  let collSurplusPool: CollSurplusPool
  let hintHelpers: HintHelpers

  let
      owner:SignerWithAddress,
      alice:SignerWithAddress,
      bob:SignerWithAddress,
      carol:SignerWithAddress,
      dennis:SignerWithAddress,
      whale:SignerWithAddress,
      A:SignerWithAddress,
      B:SignerWithAddress,
      C:SignerWithAddress,
      D:SignerWithAddress,
      E:SignerWithAddress,
      F:SignerWithAddress,
      G:SignerWithAddress,
      H:SignerWithAddress,
      erin: SignerWithAddress,
      defaulter_1: SignerWithAddress,
      defaulter_2: SignerWithAddress,
      defaulter_3: SignerWithAddress,
      defaulter_4: SignerWithAddress,
      flyn: SignerWithAddress,
      graham: SignerWithAddress,
      harriet: SignerWithAddress,
      ida: SignerWithAddress

  let liquidationArray: SignerWithAddress[]|string[]

  const openTrove = async (params: IOpenTroveParams) => th.openTrove(contracts, params)
  const getTroveEntireColl = async (trove: string) => th.getTroveEntireColl(contracts, trove)
  const getTroveEntireDebt = async (trove: string) => th.getTroveEntireDebt(contracts, trove)
  const getNetBorrowingAmount = async (debtWithFee: BigNumber) => th.getNetBorrowingAmount(contracts, debtWithFee)
  const getOpenTroveLUSDAmount = async (totalDebt: BigNumber) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const getOpenTroveTotalDebt = async (lusdAmount: BigNumber) => th.getOpenTroveTotalDebt(contracts, lusdAmount)
  // const getActualDebtFromComposite = async (compositeDebt) => th.getActualDebtFromComposite(compositeDebt, contracts)
  const withdrawLUSD = async (params: IWithdrawSIMParams) => th.withdrawLUSD(contracts, params)

  beforeEach(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    [
      owner, alice, bob, carol, dennis, whale,
      A, B, C, D, E, F, G, H, erin,
    ] = f.signers;
    [ defaulter_1, defaulter_2, defaulter_3, defaulter_4] = [E, F, C, D];
    [ flyn, graham, harriet, ida] = [A, B, C, D]
    contracts = f.contracts;
    bountyAddress = f.bountyAddress
    lpRewardsAddress = f.lpRewardsAddress
    multisig = f.multisig
    priceFeed = contracts.priceFeedMock
    troveManager = contracts.troveManager as TroveManagerTester
    borrowerOperations = contracts.borrowerOperations as BorrowerOperationsTester
    activePool = contracts.activePool
    sortedTroves = contracts.sortedTroves
    simToken = contracts.simToken as SIMTokenTester
    defaultPool = contracts.defaultPool
    hintHelpers = contracts.hintHelpers
    collSurplusPool = contracts.collSurplusPool
    stabilityPool = contracts.stabilityPool

  })

  it('liquidate(): closes a Trove that has ICR < MCR', async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })

    const price = await priceFeed.getPrice()
    const ICR_Before = await troveManager.getCurrentICR(alice.address, price)
    assert.equal(ICR_Before.toString(), dec(4, 18))

    const MCR = (await troveManager.MCR()).toString()
    assert.equal(MCR.toString(), '1100000000000000000')

    // Alice increases debt to 180 LUSD, lowering her ICR to 1.11
    const A_LUSDWithdrawal = await getNetBorrowingAmount(toBN(dec(130, 18)))

    const targetICR = toBN('1111111111111111111')
    await withdrawLUSD({ ICR: targetICR, extraParams: { from: alice } })

    const ICR_AfterWithdrawal = await troveManager.getCurrentICR(alice.address, price)
    assert.isAtMost(th.getDifference(ICR_AfterWithdrawal, targetICR), 100)

    // price drops to 1ETH:100LUSD, reducing Alice's ICR below MCR
    await priceFeed.setPrice('100000000000000000000');

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // close Trove
    await troveManager.connect(owner).liquidate(alice.address);

    // check the Trove is successfully closed, and removed from sortedList
    const status = (await troveManager.Troves(alice.address))[3]
    assert.equal(status, 3)  // status enum 3 corresponds to "Closed by liquidation"
    const alice_Trove_isInSortedList = await sortedTroves.contains(alice.address)
    assert.isFalse(alice_Trove_isInSortedList)
  })

  it("liquidate(): decreases ActivePool ETH and LUSDDebt by correct amounts", async () => {
    // --- SETUP ---
    const { collateral: A_collateral, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    const { collateral: B_collateral, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(21, 17)), extraParams: { from: bob } })

    // --- TEST ---

    // check ActivePool ETH and LUSD debt before
    const activePool_ETH_Before = (await activePool.getWSTETH()).toString()
    const activePool_RawEther_Before = await contracts.wstETHMock.balanceOf(activePool.address)
    const activePool_LUSDDebt_Before = await activePool.getSIMDebt()

    assert.equal(activePool_ETH_Before, A_collateral.add(B_collateral))
    assert.equal(activePool_RawEther_Before.toString(), A_collateral.add(B_collateral).toString())
    th.assertIsApproximatelyEqual(activePool_LUSDDebt_Before, A_totalDebt.add(B_totalDebt))

    // price drops to 1ETH:100LUSD, reducing Bob's ICR below MCR
    await priceFeed.setPrice('100000000000000000000');

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    /* close Bob's Trove. Should liquidate his ether and LUSD,
    leaving Alice’s ether and LUSD debt in the ActivePool. */
    await troveManager.liquidate(bob.address);

    // check ActivePool ETH and LUSD debt 
    const activePool_ETH_After = (await activePool.getWSTETH()).toString()
    const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
    const activePool_LUSDDebt_After = await activePool.getSIMDebt()

    assert.equal(activePool_ETH_After, A_collateral)
    assert.equal(activePool_RawEther_After.toString(), A_collateral.toString())
    th.assertIsApproximatelyEqual(activePool_LUSDDebt_After, A_totalDebt)
  })

  it("liquidate(): increases DefaultPool ETH and LUSD debt by correct amounts", async () => {
    // --- SETUP ---
    const { collateral: A_collateral, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    const { collateral: B_collateral, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(21, 17)), extraParams: { from: bob } })

    // --- TEST ---

    // check DefaultPool ETH and LUSD debt before
    const defaultPool_ETH_Before = (await defaultPool.getWSTETH())
    const defaultPool_RawEther_Before = (await contracts.wstETHMock.balanceOf(defaultPool.address)).toString()
    const defaultPool_LUSDDebt_Before = (await defaultPool.getSIMDebt()).toString()

    assert.equal(defaultPool_ETH_Before.toString(), '0')
    assert.equal(defaultPool_RawEther_Before, '0')
    assert.equal(defaultPool_LUSDDebt_Before, '0')

    // price drops to 1ETH:100LUSD, reducing Bob's ICR below MCR
    await priceFeed.setPrice('100000000000000000000');

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // close Bob's Trove
    await troveManager.liquidate(bob.address);

    // check after
    const defaultPool_ETH_After = (await defaultPool.getWSTETH()).toString()
    const defaultPool_RawEther_After = (await contracts.wstETHMock.balanceOf(defaultPool.address)).toString()
    const defaultPool_LUSDDebt_After = (await defaultPool.getSIMDebt()).toString()

    const defaultPool_ETH = th.applyLiquidationFee(B_collateral)
    assert.equal(defaultPool_ETH_After, defaultPool_ETH.toString())
    assert.equal(defaultPool_RawEther_After, defaultPool_ETH.toString())
    th.assertIsApproximatelyEqual(toBN(defaultPool_LUSDDebt_After), B_totalDebt)
  })

  it("liquidate(): removes the Trove's stake from the total stakes", async () => {
    // --- SETUP ---
    const { collateral: A_collateral, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    const { collateral: B_collateral, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(21, 17)), extraParams: { from: bob } })

    // --- TEST ---

    // check totalStakes before
    const totalStakes_Before = (await troveManager.totalStakes()).toString()
    assert.equal(totalStakes_Before, A_collateral.add(B_collateral))

    // price drops to 1ETH:100LUSD, reducing Bob's ICR below MCR
    await priceFeed.setPrice('100000000000000000000');

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Close Bob's Trove
    await troveManager.liquidate(bob.address);

    // check totalStakes after
    const totalStakes_After = (await troveManager.totalStakes()).toString()
    assert.equal(totalStakes_After, A_collateral)
  })

  it("liquidate(): Removes the correct trove from the TroveOwners array, and moves the last array element to the new empty slot", async () => {
    // --- SETUP --- 
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

    // Alice, Bob, Carol, Dennis, Erin open troves with consecutively decreasing collateral ratio
    await openTrove({ ICR: toBN(dec(218, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(216, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(214, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(212, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: erin } })

    // At this stage, TroveOwners array should be: [W, A, B, C, D, E] 

    // Drop price
    await priceFeed.setPrice(dec(100, 18))

    const arrayLength_Before = await troveManager.getTroveOwnersCount()
    assert.equal(arrayLength_Before.toNumber(), 6)

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate carol
    await troveManager.liquidate(carol.address)

    // Check Carol no longer has an active trove
    assert.isFalse(await sortedTroves.contains(carol.address))

    // Check length of array has decreased by 1
    const arrayLength_After = await troveManager.getTroveOwnersCount()
    assert.equal(arrayLength_After.toNumber(), 5)

    /* After Carol is removed from array, the last element (Erin's address) should have been moved to fill
    the empty slot left by Carol, and the array length decreased by one.  The final TroveOwners array should be:
  
    [W, A, B, E, D] 

    Check all remaining troves in the array are in the correct order */
    const trove_0 = await troveManager.TroveOwners(0)
    const trove_1 = await troveManager.TroveOwners(1)
    const trove_2 = await troveManager.TroveOwners(2)
    const trove_3 = await troveManager.TroveOwners(3)
    const trove_4 = await troveManager.TroveOwners(4)

    assert.equal(trove_0, whale.address)
    assert.equal(trove_1, alice.address)
    assert.equal(trove_2, bob.address)
    assert.equal(trove_3, erin.address)
    assert.equal(trove_4, dennis.address)

    // Check correct indices recorded on the active trove structs
    const whale_arrayIndex = (await troveManager.Troves(whale.address))[4]
    const alice_arrayIndex = (await troveManager.Troves(alice.address))[4]
    const bob_arrayIndex = (await troveManager.Troves(bob.address))[4]
    const dennis_arrayIndex = (await troveManager.Troves(dennis.address))[4]
    const erin_arrayIndex = (await troveManager.Troves(erin.address))[4]

    // [W, A, B, E, D] 
    assert.equal(whale_arrayIndex.toNumber(), 0)
    assert.equal(alice_arrayIndex.toNumber(), 1)
    assert.equal(bob_arrayIndex.toNumber(), 2)
    assert.equal(erin_arrayIndex.toNumber(), 3)
    assert.equal(dennis_arrayIndex.toNumber(), 4)
  })

  it("liquidate(): updates the snapshots of total stakes and total collateral", async () => {
    // --- SETUP ---
    const { collateral: A_collateral, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    const { collateral: B_collateral, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(21, 17)), extraParams: { from: bob } })

    // --- TEST ---

    // check snapshots before 
    const totalStakesSnapshot_Before = (await troveManager.totalStakesSnapshot()).toString()
    const totalCollateralSnapshot_Before = (await troveManager.totalCollateralSnapshot()).toString()
    assert.equal(totalStakesSnapshot_Before, '0')
    assert.equal(totalCollateralSnapshot_Before, '0')

    // price drops to 1ETH:100LUSD, reducing Bob's ICR below MCR
    await priceFeed.setPrice('100000000000000000000');

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // close Bob's Trove.  His ether*0.995 and LUSD should be added to the DefaultPool.
    await troveManager.liquidate(bob.address);

    /* check snapshots after. Total stakes should be equal to the  remaining stake then the system:
    10 ether, Alice's stake.
     
    Total collateral should be equal to Alice's collateral plus her pending ETH reward (Bob’s collaterale*0.995 ether), earned
    from the liquidation of Bob's Trove */
    const totalStakesSnapshot_After = (await troveManager.totalStakesSnapshot()).toString()
    const totalCollateralSnapshot_After = (await troveManager.totalCollateralSnapshot()).toString()

    assert.equal(totalStakesSnapshot_After, A_collateral)
    assert.equal(totalCollateralSnapshot_After, A_collateral.add(th.applyLiquidationFee(B_collateral)))
  })

  it("liquidate(): updates the L_ETH and L_LUSDDebt reward-per-unit-staked totals", async () => {
    // --- SETUP ---
    const { collateral: A_collateral, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(8, 18)), extraParams: { from: alice } })
    const { collateral: B_collateral, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: bob } })
    const { collateral: C_collateral, totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(111, 16)), extraParams: { from: carol } })

    // --- TEST ---

    // price drops to 1ETH:100LUSD, reducing Carols's ICR below MCR
    await priceFeed.setPrice('100000000000000000000');

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // close Carol's Trove.  
    assert.isTrue(await sortedTroves.contains(carol.address))
    await troveManager.liquidate(carol.address);
    assert.isFalse(await sortedTroves.contains(carol.address))

    // Carol's ether*0.995 and LUSD should be added to the DefaultPool.
    const L_ETH_AfterCarolLiquidated = await troveManager.L_WSTETH()
    const L_LUSDDebt_AfterCarolLiquidated = await troveManager.L_SIMDebt()

    const L_ETH_expected_1 = th.applyLiquidationFee(C_collateral).mul(mv._1e18BN).div(A_collateral.add(B_collateral))
    const L_LUSDDebt_expected_1 = C_totalDebt.mul(mv._1e18BN).div(A_collateral.add(B_collateral))
    assert.isAtMost(th.getDifference(L_ETH_AfterCarolLiquidated, L_ETH_expected_1), 100)
    assert.isAtMost(th.getDifference(L_LUSDDebt_AfterCarolLiquidated, L_LUSDDebt_expected_1), 100)

    // Bob now withdraws LUSD, bringing his ICR to 1.11
    const { increasedTotalDebt: B_increasedTotalDebt } = await withdrawLUSD({ ICR: toBN(dec(111, 16)), extraParams: { from: bob } })

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // price drops to 1ETH:50LUSD, reducing Bob's ICR below MCR
    await priceFeed.setPrice(dec(50, 18));
    const price = await priceFeed.getPrice()

    // close Bob's Trove 
    assert.isTrue(await sortedTroves.contains(bob.address))
    await troveManager.liquidate(bob.address);
    assert.isFalse(await sortedTroves.contains(bob.address))

    /* Alice now has all the active stake. totalStakes in the system is now 10 ether.
   
   Bob's pending collateral reward and debt reward are applied to his Trove
   before his liquidation.
   His total collateral*0.995 and debt are then added to the DefaultPool. 
   
   The system rewards-per-unit-staked should now be:
   
   L_ETH = (0.995 / 20) + (10.4975*0.995  / 10) = 1.09425125 ETH
   L_LUSDDebt = (180 / 20) + (890 / 10) = 98 LUSD */
    const L_ETH_AfterBobLiquidated = await troveManager.L_WSTETH()
    const L_LUSDDebt_AfterBobLiquidated = await troveManager.L_SIMDebt()

    const L_ETH_expected_2 = L_ETH_expected_1.add(th.applyLiquidationFee(B_collateral.add(B_collateral.mul(L_ETH_expected_1).div(mv._1e18BN))).mul(mv._1e18BN).div(A_collateral))
    const L_LUSDDebt_expected_2 = L_LUSDDebt_expected_1.add(B_totalDebt.add(B_increasedTotalDebt).add(B_collateral.mul(L_LUSDDebt_expected_1).div(mv._1e18BN)).mul(mv._1e18BN).div(A_collateral))
    assert.isAtMost(th.getDifference(L_ETH_AfterBobLiquidated, L_ETH_expected_2), 100)
    assert.isAtMost(th.getDifference(L_LUSDDebt_AfterBobLiquidated, L_LUSDDebt_expected_2), 100)
  })

  it("liquidate(): Liquidates undercollateralized trove if there are two troves in the system", async () => {
    await openTrove({ ICR: toBN(dec(200, 18)), extraParams: { from: bob, value: dec(100, 'ether') } })

    // Alice creates a single trove with 0.7 ETH and a debt of 70 LUSD, and provides 10 LUSD to SP
    const { collateral: A_collateral, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

    // Alice proves 10 LUSD to SP
    await stabilityPool.connect(alice).provideToSP(dec(10, 18), ZERO_ADDRESS)

    // Set ETH:USD price to 105
    await priceFeed.setPrice('105000000000000000000')
    const price = await priceFeed.getPrice()

    assert.isFalse(await th.checkRecoveryMode(contracts))

    const alice_ICR = (await troveManager.getCurrentICR(alice.address, price)).toString()
    assert.equal(alice_ICR, '1050000000000000000')

    const activeTrovesCount_Before = await troveManager.getTroveOwnersCount()

    assert.equal(activeTrovesCount_Before.toNumber(), 2)

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate the trove
    await troveManager.liquidate(alice.address)

    // Check Alice's trove is removed, and bob remains
    const activeTrovesCount_After = await troveManager.getTroveOwnersCount()
    assert.equal(activeTrovesCount_After.toNumber(), 1)

    const alice_isInSortedList = await sortedTroves.contains(alice.address)
    assert.isFalse(alice_isInSortedList)

    const bob_isInSortedList = await sortedTroves.contains(bob.address)
    assert.isTrue(bob_isInSortedList)
  })

  it("liquidate(): reverts if trove is non-existent", async () => {
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(21, 17)), extraParams: { from: bob } })

    assert.equal((await troveManager.getTroveStatus(carol.address)).toNumber(), 0) // check trove non-existent

    assert.isFalse(await sortedTroves.contains(carol.address))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    try {
      const txCarol = await troveManager.liquidate(carol.address)

      assert.isFalse(1)
    } catch (err) {
      assert.include(err?.toString(), "revert")
      assert.include(err?.toString(), "Trove does not exist or is closed")
    }
  })

  it("liquidate(): reverts if trove has been closed", async () => {
    await openTrove({ ICR: toBN(dec(8, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

    assert.isTrue(await sortedTroves.contains(carol.address))

    // price drops, Carol ICR falls below MCR
    await priceFeed.setPrice(dec(100, 18))

    // Carol liquidated, and her trove is closed
    const txCarol_L1 = await troveManager.liquidate(carol.address)
    // assert.isTrue(txCarol_L1.receipt.status)

    assert.isFalse(await sortedTroves.contains(carol.address))

    assert.equal((await troveManager.getTroveStatus(carol.address)).toNumber(), 3)  // check trove closed by liquidation

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    try {
      const txCarol_L2 = await troveManager.liquidate(carol.address)

      assert.isFalse(1)
    } catch (err) {
      assert.include(err?.toString(), "revert")
      assert.include(err?.toString(), "Trove does not exist or is closed")
    }
  })

  it("liquidate(): does nothing if trove has >= 110% ICR", async () => {
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: bob } })

    const TCR_Before = (await th.getTCR(contracts)).toString()
    const listSize_Before = (await sortedTroves.getSize()).toString()

    const price = await priceFeed.getPrice()

    // Check Bob's ICR > 110%
    const bob_ICR = await troveManager.getCurrentICR(bob.address, price)
    assert.isTrue(bob_ICR.gte(mv._MCR))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Attempt to liquidate bob
    await assertRevert(troveManager.liquidate(bob.address), "TroveManager: nothing to liquidate")

    // Check bob active, check whale active
    assert.isTrue((await sortedTroves.contains(bob.address)))
    assert.isTrue((await sortedTroves.contains(whale.address)))

    const TCR_After = (await th.getTCR(contracts)).toString()
    const listSize_After = (await sortedTroves.getSize()).toString()

    assert.equal(TCR_Before, TCR_After)
    assert.equal(listSize_Before, listSize_After)
  })

  it("liquidate(): Given the same price and no other trove changes, complete Pool offsets restore the TCR to its value prior to the defaulters opening troves", async () => {
    // Whale provides LUSD to SP
    const spDeposit = toBN(dec(100, 24))
    await openTrove({ ICR: toBN(dec(4, 18)), extraLUSDAmount: spDeposit, extraParams: { from: whale } })
    await stabilityPool.connect(whale).provideToSP(spDeposit, ZERO_ADDRESS)

    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(70, 18)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(200, 18)), extraParams: { from: dennis } })

    const TCR_Before = (await th.getTCR(contracts)).toString()

    await openTrove({ ICR: toBN(dec(202, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: defaulter_2 } })
    await openTrove({ ICR: toBN(dec(196, 16)), extraParams: { from: defaulter_3 } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_4 } })

    assert.isTrue((await sortedTroves.contains(defaulter_1.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_2.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_3.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_4.address)))

    // Price drop
    await priceFeed.setPrice(dec(100, 18))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // All defaulters liquidated
    await troveManager.liquidate(defaulter_1.address)
    assert.isFalse((await sortedTroves.contains(defaulter_1.address)))

    await troveManager.liquidate(defaulter_2.address)
    assert.isFalse((await sortedTroves.contains(defaulter_2.address)))

    await troveManager.liquidate(defaulter_3.address)
    assert.isFalse((await sortedTroves.contains(defaulter_3.address)))

    await troveManager.liquidate(defaulter_4.address)
    assert.isFalse((await sortedTroves.contains(defaulter_4.address)))

    // Price bounces back
    await priceFeed.setPrice(dec(200, 18))

    const TCR_After = (await th.getTCR(contracts)).toString()
    assert.equal(TCR_Before, TCR_After)
  })


  it("liquidate(): Pool offsets increase the TCR", async () => {
    // Whale provides LUSD to SP
    const spDeposit = toBN(dec(100, 24))
    await openTrove({ ICR: toBN(dec(4, 18)), extraLUSDAmount: spDeposit, extraParams: { from: whale } })
    await stabilityPool.connect(whale).provideToSP(spDeposit, ZERO_ADDRESS)

    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(70, 18)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(200, 18)), extraParams: { from: dennis } })

    await openTrove({ ICR: toBN(dec(202, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: defaulter_2 } })
    await openTrove({ ICR: toBN(dec(196, 16)), extraParams: { from: defaulter_3 } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_4 } })

    assert.isTrue((await sortedTroves.contains(defaulter_1.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_2.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_3.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_4.address)))

    await priceFeed.setPrice(dec(100, 18))

    const TCR_1 = await th.getTCR(contracts)

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Check TCR improves with each liquidation that is offset with Pool
    await troveManager.liquidate(defaulter_1.address)
    assert.isFalse((await sortedTroves.contains(defaulter_1.address)))
    const TCR_2 = await th.getTCR(contracts)
    assert.isTrue(TCR_2.gte(TCR_1))

    await troveManager.liquidate(defaulter_2.address)
    assert.isFalse((await sortedTroves.contains(defaulter_2.address)))
    const TCR_3 = await th.getTCR(contracts)
    assert.isTrue(TCR_3.gte(TCR_2))

    await troveManager.liquidate(defaulter_3.address)
    assert.isFalse((await sortedTroves.contains(defaulter_3.address)))
    const TCR_4 = await th.getTCR(contracts)
    assert.isTrue(TCR_4.gte(TCR_3))

    await troveManager.liquidate(defaulter_4.address)
    assert.isFalse((await sortedTroves.contains(defaulter_4.address)))
    const TCR_5 = await th.getTCR(contracts)
    assert.isTrue(TCR_5.gte(TCR_4))
  })

  it("liquidate(): a pure redistribution reduces the TCR only as a result of compensation", async () => {
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(70, 18)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(200, 18)), extraParams: { from: dennis } })

    await openTrove({ ICR: toBN(dec(202, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: defaulter_2 } })
    await openTrove({ ICR: toBN(dec(196, 16)), extraParams: { from: defaulter_3 } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_4 } })

    assert.isTrue((await sortedTroves.contains(defaulter_1.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_2.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_3.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_4.address)))

    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    const TCR_0 = await th.getTCR(contracts)

    const entireSystemCollBefore = await troveManager.getEntireSystemColl()
    const entireSystemDebtBefore = await troveManager.getEntireSystemDebt()

    const expectedTCR_0 = entireSystemCollBefore.mul(price).div(entireSystemDebtBefore)

    assert.isTrue(expectedTCR_0.eq(TCR_0))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Check TCR does not decrease with each liquidation 
    const liquidationTx_1 = await troveManager.liquidate(defaulter_1.address)
    const [liquidatedDebt_1, liquidatedColl_1, gasComp_1] = await th.getEmittedLiquidationValues(liquidationTx_1)
    assert.isFalse((await sortedTroves.contains(defaulter_1.address)))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    const TCR_1 = await th.getTCR(contracts)

    // Expect only change to TCR to be due to the issued gas compensation
    const expectedTCR_1 = (entireSystemCollBefore
      .sub(gasComp_1))
      .mul(price)
      .div(entireSystemDebtBefore)

    assert.isTrue(expectedTCR_1.eq(TCR_1))

    const liquidationTx_2 = await troveManager.liquidate(defaulter_2.address)
    const [liquidatedDebt_2, liquidatedColl_2, gasComp_2] = await th.getEmittedLiquidationValues(liquidationTx_2)
    assert.isFalse((await sortedTroves.contains(defaulter_2.address)))

    const TCR_2 = await th.getTCR(contracts)

    const expectedTCR_2 = (entireSystemCollBefore
      .sub(gasComp_1)
      .sub(gasComp_2))
      .mul(price)
      .div(entireSystemDebtBefore)

    assert.isTrue(expectedTCR_2.eq(TCR_2))

    const liquidationTx_3 = await troveManager.liquidate(defaulter_3.address)
    const [liquidatedDebt_3, liquidatedColl_3, gasComp_3] = await th.getEmittedLiquidationValues(liquidationTx_3)
    assert.isFalse((await sortedTroves.contains(defaulter_3.address)))

    const TCR_3 = await th.getTCR(contracts)

    const expectedTCR_3 = (entireSystemCollBefore
      .sub(gasComp_1)
      .sub(gasComp_2)
      .sub(gasComp_3))
      .mul(price)
      .div(entireSystemDebtBefore)

    assert.isTrue(expectedTCR_3.eq(TCR_3))


    const liquidationTx_4 = await troveManager.liquidate(defaulter_4.address)
    const [liquidatedDebt_4, liquidatedColl_4, gasComp_4] = await th.getEmittedLiquidationValues(liquidationTx_4)
    assert.isFalse((await sortedTroves.contains(defaulter_4.address)))

    const TCR_4 = await th.getTCR(contracts)

    const expectedTCR_4 = (entireSystemCollBefore
      .sub(gasComp_1)
      .sub(gasComp_2)
      .sub(gasComp_3)
      .sub(gasComp_4))
      .mul(price)
      .div(entireSystemDebtBefore)

    assert.isTrue(expectedTCR_4.eq(TCR_4))
  })

  it("liquidate(): does not affect the SP deposit or ETH gain when called on an SP depositor's address that has no trove", async () => {
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    const spDeposit = toBN(dec(1, 24))
    await openTrove({ ICR: toBN(dec(3, 18)), extraLUSDAmount: spDeposit, extraParams: { from: bob } })
    /*const { totalDebt: C_totalDebt, collateral: C_collateral } = */await openTrove({ ICR: toBN(dec(218, 16)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: carol } })

    // Bob sends tokens to Dennis, who has no trove
    await simToken.connect(bob).transfer(dennis.address, spDeposit)

    //Dennis provides LUSD to SP
    await stabilityPool.connect(dennis).provideToSP(spDeposit, ZERO_ADDRESS)

    // Carol gets liquidated
    await priceFeed.setPrice(dec(100, 18))
    const liquidationTX_C = await troveManager.liquidate(carol.address)
    const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTX_C)

    assert.isFalse(await sortedTroves.contains(carol.address))
    // Check Dennis' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH
    const dennis_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(dennis.address)
    const dennis_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(dennis.address)
    assert.isAtMost(th.getDifference(dennis_Deposit_Before, spDeposit.sub(liquidatedDebt)), 1000000)
    assert.isAtMost(th.getDifference(dennis_ETHGain_Before, liquidatedColl), 1000)

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Attempt to liquidate Dennis
    try {
      const txDennis = await troveManager.liquidate(dennis.address)
      assert.isFalse(1)
    } catch (err) {
      assert.include(err?.toString(), "revert")
      assert.include(err?.toString(), "Trove does not exist or is closed")
    }

    // Check Dennis' SP deposit does not change after liquidation attempt
    const dennis_Deposit_After = (await stabilityPool.getCompoundedSIMDeposit(dennis.address)).toString()
    const dennis_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(dennis.address)).toString()
    assert.equal(dennis_Deposit_Before.toString(), dennis_Deposit_After)
    assert.equal(dennis_ETHGain_Before.toString(), dennis_ETHGain_After)
  })

  it("liquidate(): does not liquidate a SP depositor's trove with ICR > 110%, and does not affect their SP deposit or ETH gain", async () => {
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    const spDeposit = toBN(dec(1, 24))
    await openTrove({ ICR: toBN(dec(3, 18)), extraLUSDAmount: spDeposit, extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(218, 16)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: carol } })

    //Bob provides LUSD to SP
    await stabilityPool.connect(bob).provideToSP(spDeposit, ZERO_ADDRESS)

    // Carol gets liquidated
    await priceFeed.setPrice(dec(100, 18))
    const liquidationTX_C = await troveManager.liquidate(carol.address)
    const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTX_C)
    assert.isFalse(await sortedTroves.contains(carol.address))

    // price bounces back - Bob's trove is >110% ICR again
    await priceFeed.setPrice(dec(200, 18))
    const price = await priceFeed.getPrice()
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).gt(mv._MCR))

    // Check Bob' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH
    const bob_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(bob.address)
    const bob_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(bob.address)
    assert.isAtMost(th.getDifference(bob_Deposit_Before, spDeposit.sub(liquidatedDebt)), 1000000)
    assert.isAtMost(th.getDifference(bob_ETHGain_Before, liquidatedColl), 1000)

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Attempt to liquidate Bob
    await assertRevert(troveManager.liquidate(bob.address), "TroveManager: nothing to liquidate")

    // Confirm Bob's trove is still active
    assert.isTrue(await sortedTroves.contains(bob.address))

    // Check Bob' SP deposit does not change after liquidation attempt
    const bob_Deposit_After = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
    const bob_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()
    assert.equal(bob_Deposit_Before.toString(), bob_Deposit_After)
    assert.equal(bob_ETHGain_Before.toString(), bob_ETHGain_After)
  })

  it("liquidate(): liquidates a SP depositor's trove with ICR < 110%, and the liquidation correctly impacts their SP deposit and ETH gain", async () => {
    const A_spDeposit = toBN(dec(3, 24))
    const B_spDeposit = toBN(dec(1, 24))
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(8, 18)), extraLUSDAmount: A_spDeposit, extraParams: { from: alice } })
    const { collateral: B_collateral, totalDebt: B_debt } = await openTrove({ ICR: toBN(dec(218, 16)), extraLUSDAmount: B_spDeposit, extraParams: { from: bob } })
    const { collateral: C_collateral, totalDebt: C_debt } = await openTrove({ ICR: toBN(dec(210, 16)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: carol } })

    //Bob provides LUSD to SP
    await stabilityPool.connect(bob).provideToSP(B_spDeposit, ZERO_ADDRESS)

    // Carol gets liquidated
    await priceFeed.setPrice(dec(100, 18))
    await troveManager.liquidate(carol.address)

    // Check Bob' SP deposit has absorbed Carol's debt, and he has received her liquidated ETH
    const bob_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(bob.address)
    const bob_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(bob.address)
    assert.isAtMost(th.getDifference(bob_Deposit_Before, B_spDeposit.sub(C_debt)), 1000000)
    assert.isAtMost(th.getDifference(bob_ETHGain_Before, th.applyLiquidationFee(C_collateral)), 1000)

    // Alice provides LUSD to SP
    await stabilityPool.connect(alice).provideToSP(A_spDeposit, ZERO_ADDRESS)

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate Bob
    await troveManager.liquidate(bob.address)

    // Confirm Bob's trove has been closed
    assert.isFalse(await sortedTroves.contains(bob.address))
    const bob_Trove_Status = ((await troveManager.Troves(bob.address))[3]).toString()
    assert.equal(bob_Trove_Status, '3') // check closed by liquidation

    /* Alice's LUSD Loss = (300 / 400) * 200 = 150 LUSD
       Alice's ETH gain = (300 / 400) * 2*0.995 = 1.4925 ETH

       Bob's LUSDLoss = (100 / 400) * 200 = 50 LUSD
       Bob's ETH gain = (100 / 400) * 2*0.995 = 0.4975 ETH

     Check Bob' SP deposit has been reduced to 50 LUSD, and his ETH gain has increased to 1.5 ETH. */
    const alice_Deposit_After = (await stabilityPool.getCompoundedSIMDeposit(alice.address)).toString()
    const alice_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()

    const totalDeposits = bob_Deposit_Before.add(A_spDeposit)

    assert.isAtMost(th.getDifference(toBN(alice_Deposit_After), A_spDeposit.sub(B_debt.mul(A_spDeposit).div(totalDeposits))), 1000000)
    assert.isAtMost(th.getDifference(toBN(alice_ETHGain_After), th.applyLiquidationFee(B_collateral).mul(A_spDeposit).div(totalDeposits)), 1000000)

    const bob_Deposit_After = await stabilityPool.getCompoundedSIMDeposit(bob.address)
    const bob_ETHGain_After = await stabilityPool.getDepositorWSTETHGain(bob.address)

    assert.isAtMost(th.getDifference(bob_Deposit_After, bob_Deposit_Before.sub(B_debt.mul(bob_Deposit_Before).div(totalDeposits))), 1000000)
    assert.isAtMost(th.getDifference(bob_ETHGain_After, bob_ETHGain_Before.add(th.applyLiquidationFee(B_collateral).mul(bob_Deposit_Before).div(totalDeposits))), 1000000)
  })

  it("liquidate(): does not alter the liquidated user's token balance", async () => {
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    const { lusdAmount: A_lusdAmount } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: toBN(dec(300, 18)), extraParams: { from: alice } })
    const { lusdAmount: B_lusdAmount } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: toBN(dec(200, 18)), extraParams: { from: bob } })
    const { lusdAmount: C_lusdAmount } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: carol } })

    await priceFeed.setPrice(dec(100, 18))

    // Check sortedList size
    assert.equal((await sortedTroves.getSize()).toString(), '4')

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate A, B and C
    const activeLUSDDebt_0 = await activePool.getSIMDebt()
    const defaultLUSDDebt_0 = await defaultPool.getSIMDebt()

    await troveManager.liquidate(alice.address)
    const activeLUSDDebt_A = await activePool.getSIMDebt()
    const defaultLUSDDebt_A = await defaultPool.getSIMDebt()

    await troveManager.liquidate(bob.address)
    const activeLUSDDebt_B = await activePool.getSIMDebt()
    const defaultLUSDDebt_B = await defaultPool.getSIMDebt()

    await troveManager.liquidate(carol.address)

    // Confirm A, B, C closed
    assert.isFalse(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))
    assert.isFalse(await sortedTroves.contains(carol.address))

    // Check sortedList size reduced to 1
    assert.equal((await sortedTroves.getSize()).toString(), '1')

    // Confirm token balances have not changed
    assert.equal((await simToken.balanceOf(alice.address)).toString(), A_lusdAmount.toString())
    assert.equal((await simToken.balanceOf(bob.address)).toString(), B_lusdAmount.toString())
    assert.equal((await simToken.balanceOf(carol.address)).toString(), C_lusdAmount.toString())
  })

  it("liquidate(): liquidates based on entire/collateral debt (including pending rewards), not raw collateral/debt", async () => {
    await openTrove({ ICR: toBN(dec(8, 18)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(221, 16)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: carol } })

    // Defaulter opens with 60 LUSD, 0.6 ETH
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

    // Price drops
    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    const alice_ICR_Before = await troveManager.getCurrentICR(alice.address, price)
    const bob_ICR_Before = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR_Before = await troveManager.getCurrentICR(carol.address, price)

    /* Before liquidation:
    Alice ICR: = (2 * 100 / 50) = 400%
    Bob ICR: (1 * 100 / 90.5) = 110.5%
    Carol ICR: (1 * 100 / 100 ) =  100%

    Therefore Alice and Bob above the MCR, Carol is below */
    assert.isTrue(alice_ICR_Before.gte(mv._MCR))
    assert.isTrue(bob_ICR_Before.gte(mv._MCR))
    assert.isTrue(carol_ICR_Before.lte(mv._MCR))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    /* Liquidate defaulter. 30 LUSD and 0.3 ETH is distributed between A, B and C.

    A receives (30 * 2/4) = 15 LUSD, and (0.3*2/4) = 0.15 ETH
    B receives (30 * 1/4) = 7.5 LUSD, and (0.3*1/4) = 0.075 ETH
    C receives (30 * 1/4) = 7.5 LUSD, and (0.3*1/4) = 0.075 ETH
    */
    await troveManager.liquidate(defaulter_1.address)

    const alice_ICR_After = await troveManager.getCurrentICR(alice.address, price)
    const bob_ICR_After = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR_After = await troveManager.getCurrentICR(carol.address, price)

    /* After liquidation:

    Alice ICR: (10.15 * 100 / 60) = 183.33%
    Bob ICR:(1.075 * 100 / 98) =  109.69%
    Carol ICR: (1.075 *100 /  107.5 ) = 100.0%

    Check Alice is above MCR, Bob below, Carol below. */


    assert.isTrue(alice_ICR_After.gte(mv._MCR))
    assert.isTrue(bob_ICR_After.lte(mv._MCR))
    assert.isTrue(carol_ICR_After.lte(mv._MCR))

    /* Though Bob's true ICR (including pending rewards) is below the MCR,
    check that Bob's raw coll and debt has not changed, and that his "raw" ICR is above the MCR */
    const bob_Coll = (await troveManager.Troves(bob.address))[1]
    const bob_Debt = (await troveManager.Troves(bob.address))[0]

    const bob_rawICR = bob_Coll.mul(toBN(dec(100, 18))).div(bob_Debt)
    assert.isTrue(bob_rawICR.gte(mv._MCR))

    // Whale enters system, pulling it into Normal Mode
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // Liquidate Alice, Bob, Carol
    await assertRevert(troveManager.liquidate(alice.address), "TroveManager: nothing to liquidate")
    await troveManager.liquidate(bob.address)
    await troveManager.liquidate(carol.address)

    /* Check Alice stays active, Carol gets liquidated, and Bob gets liquidated
   (because his pending rewards bring his ICR < MCR) */
    assert.isTrue(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))
    assert.isFalse(await sortedTroves.contains(carol.address))

    // Check trove statuses - A active (1),  B and C liquidated (3)
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '1')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '3')
  })

  it("liquidate(): when SP > 0, triggers LQTY reward event - increases the sum G", async () => {
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // A, B, C open troves 
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: C } })

    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

    // B provides to SP
    await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), dec(100, 18))

    const G_Before = await stabilityPool.epochToScaleToG(0, 0)

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // Price drops to 1ETH:100LUSD, reducing defaulters to below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // Liquidate trove
    await troveManager.liquidate(defaulter_1.address)
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))

    const G_After = await stabilityPool.epochToScaleToG(0, 0)

    // Expect G has increased from the LQTY reward event triggered
    assert.isTrue(G_After.gt(G_Before))
  })

  it("liquidate(): when SP is empty, doesn't update G", async () => {
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // A, B, C open troves 
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: C } })

    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

    // B provides to SP
    await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // B withdraws
    await stabilityPool.connect(B).withdrawFromSP(dec(100, 18))

    // Check SP is empty
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), '0')

    // Check G is non-zero
    const G_Before = await stabilityPool.epochToScaleToG(0, 0)
    assert.isTrue(G_Before.gt(toBN('0')))

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // Price drops to 1ETH:100LUSD, reducing defaulters to below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // liquidate trove
    await troveManager.liquidate(defaulter_1.address)
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))

    const G_After = await stabilityPool.epochToScaleToG(0, 0)

    // Expect G has not changed
    assert.isTrue(G_After.eq(G_Before))
  })

  // --- liquidateTroves() ---

  it('liquidateTroves(): liquidates a Trove that a) was skipped in a previous liquidation and b) has pending rewards', async () => {
    // A, B, C, D, E open troves
    await openTrove({ ICR: toBN(dec(333, 16)), extraParams: { from: D } })
    await openTrove({ ICR: toBN(dec(333, 16)), extraParams: { from: E } })
    await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(133, 16)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: C } })

    // Price drops
    await priceFeed.setPrice(dec(175, 18))
    let price = await priceFeed.getPrice()
    
    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // A gets liquidated, creates pending rewards for all
    const liqTxA = await troveManager.liquidate(A.address)
    // assert.isTrue(liqTxA.receipt.status)
    assert.isFalse(await sortedTroves.contains(A.address))

    // A adds 10 LUSD to the SP, but less than C's debt
    await stabilityPool.connect(A).provideToSP(dec(10, 18), ZERO_ADDRESS)

    // Price drops
    await priceFeed.setPrice(dec(100, 18))
    price = await priceFeed.getPrice()
    // Confirm system is now in Recovery Mode
    assert.isTrue(await th.checkRecoveryMode(contracts))

    // Confirm C has ICR > TCR
    const TCR = await troveManager.getTCR(price)
    const ICR_C = await troveManager.getCurrentICR(C.address, price)
  
    assert.isTrue(ICR_C.gt(TCR))

    // Attempt to liquidate B and C, which skips C in the liquidation since it is immune
    const liqTxBC = await troveManager.liquidateTroves(2)
    // assert.isTrue(liqTxBC.receipt.status)
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isTrue(await sortedTroves.contains(C.address))
    assert.isTrue(await sortedTroves.contains(D.address))
    assert.isTrue(await sortedTroves.contains(E.address))

    // // All remaining troves D and E repay a little debt, applying their pending rewards
    assert.isTrue((await sortedTroves.getSize()).eq(toBN('3')))
    await borrowerOperations.connect(D).repaySIM(dec(1, 18), D.address, D.address)
    await borrowerOperations.connect(E).repaySIM(dec(1, 18), E.address, E.address)

    // Check C is the only trove that has pending rewards
    assert.isTrue(await troveManager.hasPendingRewards(C.address))
    assert.isFalse(await troveManager.hasPendingRewards(D.address))
    assert.isFalse(await troveManager.hasPendingRewards(E.address))

    // Check C's pending coll and debt rewards are <= the coll and debt in the DefaultPool
    const pendingETH_C = await troveManager.getPendingWSTETHReward(C.address)
    const pendingLUSDDebt_C = await troveManager.getPendingSIMDebtReward(C.address)
    const defaultPoolETH = await defaultPool.getWSTETH()
    const defaultPoolLUSDDebt = await defaultPool.getSIMDebt()
    assert.isTrue(pendingETH_C.lte(defaultPoolETH))
    assert.isTrue(pendingLUSDDebt_C.lte(defaultPoolLUSDDebt))
    //Check only difference is dust
    assert.isAtMost(th.getDifference(pendingETH_C, defaultPoolETH), 1000)
    assert.isAtMost(th.getDifference(pendingLUSDDebt_C, defaultPoolLUSDDebt), 1000)

    // Confirm system is still in Recovery Mode
    assert.isTrue(await th.checkRecoveryMode(contracts))

    // D and E fill the Stability Pool, enough to completely absorb C's debt of 70
    await stabilityPool.connect(D).provideToSP(dec(50, 18), ZERO_ADDRESS)
    await stabilityPool.connect(E).provideToSP(dec(50, 18), ZERO_ADDRESS)

    await priceFeed.setPrice(dec(50, 18))

    // Try to liquidate C again. Check it succeeds and closes C's trove
    const liqTx2 = await troveManager.liquidateTroves(2)
    // assert.isTrue(liqTx2.receipt.status)
    assert.isFalse(await sortedTroves.contains(C.address))
    assert.isFalse(await sortedTroves.contains(D.address))
    assert.isTrue(await sortedTroves.contains(E.address))
    assert.isTrue((await sortedTroves.getSize()).eq(toBN('1')))
  })

  it('liquidateTroves(): closes every Trove with ICR < MCR, when n > number of undercollateralized troves', async () => {
    // --- SETUP ---
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

    // create 5 Troves with varying ICRs
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(195, 16)), extraParams: { from: erin } })
    await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: flyn } })

    // G,H, I open high-ICR troves
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: graham } })
    await openTrove({ ICR: toBN(dec(90, 18)), extraParams: { from: harriet } })
    await openTrove({ ICR: toBN(dec(80, 18)), extraParams: { from: ida } })

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(dec(300, 18), ZERO_ADDRESS)

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing Bob and Carol's ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Confirm troves A-E are ICR < 110%
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).lte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(carol.address, price)).lte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(erin.address, price)).lte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(flyn.address, price)).lte(mv._MCR))

    // Confirm troves G, H, I are ICR > 110%
    assert.isTrue((await troveManager.getCurrentICR(graham.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(harriet.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(ida.address, price)).gte(mv._MCR))

    // Confirm Whale is ICR > 110% 
    assert.isTrue((await troveManager.getCurrentICR(whale.address, price)).gte(mv._MCR))

    // Liquidate 5 troves
    await troveManager.liquidateTroves(5);

    // Confirm troves A-E have been removed from the system
    assert.isFalse(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))
    assert.isFalse(await sortedTroves.contains(carol.address))
    assert.isFalse(await sortedTroves.contains(erin.address))
    assert.isFalse(await sortedTroves.contains(flyn.address))

    // Check all troves A-E are now closed by liquidation
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(erin.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(flyn.address))[3].toString(), '3')

    // Check sorted list has been reduced to length 4 
    assert.equal((await sortedTroves.getSize()).toString(), '4')
  })

  it('liquidateTroves(): liquidates  up to the requested number of undercollateralized troves', async () => {
    // --- SETUP --- 
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

    // Alice, Bob, Carol, Dennis, Erin open troves with consecutively decreasing collateral ratio
    await openTrove({ ICR: toBN(dec(202, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(204, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(206, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(208, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: erin } })

    // --- TEST --- 

    // Price drops
    await priceFeed.setPrice(dec(100, 18))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    await troveManager.liquidateTroves(3)

    const TroveOwnersArrayLength = await troveManager.getTroveOwnersCount()
    assert.equal(TroveOwnersArrayLength.toString(), '3')

    // Check Alice, Bob, Carol troves have been closed
    const aliceTroveStatus = (await troveManager.getTroveStatus(alice.address)).toString()
    const bobTroveStatus = (await troveManager.getTroveStatus(bob.address)).toString()
    const carolTroveStatus = (await troveManager.getTroveStatus(carol.address)).toString()

    assert.equal(aliceTroveStatus, '3')
    assert.equal(bobTroveStatus, '3')
    assert.equal(carolTroveStatus, '3')

    //  Check Alice, Bob, and Carol's trove are no longer in the sorted list
    const alice_isInSortedList = await sortedTroves.contains(alice.address)
    const bob_isInSortedList = await sortedTroves.contains(bob.address)
    const carol_isInSortedList = await sortedTroves.contains(carol.address)

    assert.isFalse(alice_isInSortedList)
    assert.isFalse(bob_isInSortedList)
    assert.isFalse(carol_isInSortedList)

    // Check Dennis, Erin still have active troves
    const dennisTroveStatus = (await troveManager.getTroveStatus(dennis.address)).toString()
    const erinTroveStatus = (await troveManager.getTroveStatus(erin.address)).toString()

    assert.equal(dennisTroveStatus, '1')
    assert.equal(erinTroveStatus, '1')

    // Check Dennis, Erin still in sorted list
    const dennis_isInSortedList = await sortedTroves.contains(dennis.address)
    const erin_isInSortedList = await sortedTroves.contains(erin.address)

    assert.isTrue(dennis_isInSortedList)
    assert.isTrue(erin_isInSortedList)
  })

  it('liquidateTroves(): does nothing if all troves have ICR > 110%', async () => {
    await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(222, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(222, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(222, 16)), extraParams: { from: carol } })

    // Price drops, but all troves remain active at 111% ICR
    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    assert.isTrue((await sortedTroves.contains(whale.address)))
    assert.isTrue((await sortedTroves.contains(alice.address)))
    assert.isTrue((await sortedTroves.contains(bob.address)))
    assert.isTrue((await sortedTroves.contains(carol.address)))

    const TCR_Before = (await th.getTCR(contracts)).toString()
    const listSize_Before = (await sortedTroves.getSize()).toString()

    assert.isTrue((await troveManager.getCurrentICR(whale.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(carol.address, price)).gte(mv._MCR))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Attempt liqudation sequence
    await assertRevert(troveManager.liquidateTroves(10), "TroveManager: nothing to liquidate")

    // Check all troves remain active
    assert.isTrue((await sortedTroves.contains(whale.address)))
    assert.isTrue((await sortedTroves.contains(alice.address)))
    assert.isTrue((await sortedTroves.contains(bob.address)))
    assert.isTrue((await sortedTroves.contains(carol.address)))

    const TCR_After = (await th.getTCR(contracts)).toString()
    const listSize_After = (await sortedTroves.getSize()).toString()

    assert.equal(TCR_Before, TCR_After)
    assert.equal(listSize_Before, listSize_After)
  })

  
  it("liquidateTroves(): liquidates based on entire/collateral debt (including pending rewards), not raw collateral/debt", async () => {
    await openTrove({ ICR: toBN(dec(400, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(221, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_1 } })

    // Price drops
    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    const alice_ICR_Before = await troveManager.getCurrentICR(alice.address, price)
    const bob_ICR_Before = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR_Before = await troveManager.getCurrentICR(carol.address, price)

    /* Before liquidation:
    Alice ICR: = (2 * 100 / 100) = 200%
    Bob ICR: (1 * 100 / 90.5) = 110.5%
    Carol ICR: (1 * 100 / 100 ) =  100%

    Therefore Alice and Bob above the MCR, Carol is below */
    assert.isTrue(alice_ICR_Before.gte(mv._MCR))
    assert.isTrue(bob_ICR_Before.gte(mv._MCR))
    assert.isTrue(carol_ICR_Before.lte(mv._MCR))

    // Liquidate defaulter. 30 LUSD and 0.3 ETH is distributed uniformly between A, B and C. Each receive 10 LUSD, 0.1 ETH
    await troveManager.liquidate(defaulter_1.address)

    const alice_ICR_After = await troveManager.getCurrentICR(alice.address, price)
    const bob_ICR_After = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR_After = await troveManager.getCurrentICR(carol.address, price)

    /* After liquidation:

    Alice ICR: (1.0995 * 100 / 60) = 183.25%
    Bob ICR:(1.0995 * 100 / 100.5) =  109.40%
    Carol ICR: (1.0995 * 100 / 110 ) 99.95%

    Check Alice is above MCR, Bob below, Carol below. */
    assert.isTrue(alice_ICR_After.gte(mv._MCR))
    assert.isTrue(bob_ICR_After.lte(mv._MCR))
    assert.isTrue(carol_ICR_After.lte(mv._MCR))

    /* Though Bob's true ICR (including pending rewards) is below the MCR, check that Bob's raw coll and debt has not changed */
    const bob_Coll = (await troveManager.Troves(bob.address))[1]
    const bob_Debt = (await troveManager.Troves(bob.address))[0]

    const bob_rawICR = bob_Coll.mul(toBN(dec(100, 18))).div(bob_Debt)
    assert.isTrue(bob_rawICR.gte(mv._MCR))

    // Whale enters system, pulling it into Normal Mode
    await openTrove({ ICR: toBN(dec(10, 18)), extraLUSDAmount: dec(1, 24), extraParams: { from: whale } })

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    //liquidate A, B, C
    await troveManager.liquidateTroves(10)

    // Check A stays active, B and C get liquidated
    assert.isTrue(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))
    assert.isFalse(await sortedTroves.contains(carol.address))

    // check trove statuses - A active (1),  B and C closed by liquidation (3)
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '1')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '3')
  })

  it("liquidateTroves(): reverts if n = 0", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(218, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(206, 16)), extraParams: { from: carol } })

    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    const TCR_Before = (await th.getTCR(contracts)).toString()

    // Confirm A, B, C ICRs are below 110%
    const alice_ICR = await troveManager.getCurrentICR(alice.address, price)
    const bob_ICR = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR = await troveManager.getCurrentICR(carol.address, price)
    assert.isTrue(alice_ICR.lte(mv._MCR))
    assert.isTrue(bob_ICR.lte(mv._MCR))
    assert.isTrue(carol_ICR.lte(mv._MCR))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidation with n = 0
    await assertRevert(troveManager.liquidateTroves(0), "TroveManager: nothing to liquidate")

    // Check all troves are still in the system
    assert.isTrue(await sortedTroves.contains(whale.address))
    assert.isTrue(await sortedTroves.contains(alice.address))
    assert.isTrue(await sortedTroves.contains(bob.address))
    assert.isTrue(await sortedTroves.contains(carol.address))

    const TCR_After = (await th.getTCR(contracts)).toString()

    // Check TCR has not changed after liquidation
    assert.equal(TCR_Before, TCR_After)
  })

  it("liquidateTroves():  liquidates troves with ICR < MCR", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // A, B, C open troves that will remain active when price drops to 100
    await openTrove({ ICR: toBN(dec(220, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(230, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(240, 16)), extraParams: { from: carol } })

    // D, E, F open troves that will fall below MCR when price drops to 100
    await openTrove({ ICR: toBN(dec(218, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(216, 16)), extraParams: { from: erin } })
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: flyn } })

    // Check list size is 7
    assert.equal((await sortedTroves.getSize()).toString(), '7')

    // Price drops
    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    const alice_ICR = await troveManager.getCurrentICR(alice.address, price)
    const bob_ICR = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR = await troveManager.getCurrentICR(carol.address, price)
    const dennis_ICR = await troveManager.getCurrentICR(dennis.address, price)
    const erin_ICR = await troveManager.getCurrentICR(erin.address, price)
    const flyn_ICR = await troveManager.getCurrentICR(flyn.address, price)

    // Check A, B, C have ICR above MCR
    assert.isTrue(alice_ICR.gte(mv._MCR))
    assert.isTrue(bob_ICR.gte(mv._MCR))
    assert.isTrue(carol_ICR.gte(mv._MCR))

    // Check D, E, F have ICR below MCR
    assert.isTrue(dennis_ICR.lte(mv._MCR))
    assert.isTrue(erin_ICR.lte(mv._MCR))
    assert.isTrue(flyn_ICR.lte(mv._MCR))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    //Liquidate sequence
    await troveManager.liquidateTroves(10)

    // check list size reduced to 4
    assert.equal((await sortedTroves.getSize()).toString(), '4')

    // Check Whale and A, B, C remain in the system
    assert.isTrue(await sortedTroves.contains(whale.address))
    assert.isTrue(await sortedTroves.contains(alice.address))
    assert.isTrue(await sortedTroves.contains(bob.address))
    assert.isTrue(await sortedTroves.contains(carol.address))

    // Check D, E, F have been removed
    assert.isFalse(await sortedTroves.contains(dennis.address))
    assert.isFalse(await sortedTroves.contains(erin.address))
    assert.isFalse(await sortedTroves.contains(flyn.address))
  })

  it("liquidateTroves(): does not affect the liquidated user's token balances", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // D, E, F open troves that will fall below MCR when price drops to 100
    await openTrove({ ICR: toBN(dec(218, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(216, 16)), extraParams: { from: erin } })
    await openTrove({ ICR: toBN(dec(210, 16)), extraParams: { from: flyn } })

    const D_balanceBefore = await simToken.balanceOf(dennis.address)
    const E_balanceBefore = await simToken.balanceOf(erin.address)
    const F_balanceBefore = await simToken.balanceOf(flyn.address)

    // Check list size is 4
    assert.equal((await sortedTroves.getSize()).toString(), '4')

    // Price drops
    await priceFeed.setPrice(dec(100, 18))
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    //Liquidate sequence
    await troveManager.liquidateTroves(10)

    // check list size reduced to 1
    assert.equal((await sortedTroves.getSize()).toString(), '1')

    // Check Whale remains in the system
    assert.isTrue(await sortedTroves.contains(whale.address))

    // Check D, E, F have been removed
    assert.isFalse(await sortedTroves.contains(dennis.address))
    assert.isFalse(await sortedTroves.contains(erin.address))
    assert.isFalse(await sortedTroves.contains(flyn.address))

    // Check token balances of users whose troves were liquidated, have not changed
    assert.equal((await simToken.balanceOf(dennis.address)).toString(), D_balanceBefore.toString())
    assert.equal((await simToken.balanceOf(erin.address)).toString(), E_balanceBefore.toString())
    assert.equal((await simToken.balanceOf(flyn.address)).toString(), F_balanceBefore.toString())
  })

  it("liquidateTroves(): A liquidation sequence containing Pool offsets increases the TCR", async () => {
    // Whale provides 500 LUSD to SP
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: toBN(dec(500, 18)), extraParams: { from: whale } })
    await stabilityPool.connect(whale).provideToSP(dec(500, 18), ZERO_ADDRESS)

    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(28, 18)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(8, 18)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(80, 18)), extraParams: { from: dennis } })

    await openTrove({ ICR: toBN(dec(199, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(156, 16)), extraParams: { from: defaulter_2 } })
    await openTrove({ ICR: toBN(dec(183, 16)), extraParams: { from: defaulter_3 } })
    await openTrove({ ICR: toBN(dec(166, 16)), extraParams: { from: defaulter_4 } })

    assert.isTrue((await sortedTroves.contains(defaulter_1.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_2.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_3.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_4.address)))

    assert.equal((await sortedTroves.getSize()).toString(), '9')

    // Price drops
    await priceFeed.setPrice(dec(100, 18))

    const TCR_Before = await th.getTCR(contracts)

    // Check pool has 500 LUSD
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), dec(500, 18))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate troves
    await troveManager.liquidateTroves(10)

    // Check pool has been emptied by the liquidations
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), '0')

    // Check all defaulters have been liquidated
    assert.isFalse((await sortedTroves.contains(defaulter_1.address)))
    assert.isFalse((await sortedTroves.contains(defaulter_2.address)))
    assert.isFalse((await sortedTroves.contains(defaulter_3.address)))
    assert.isFalse((await sortedTroves.contains(defaulter_4.address)))

    // check system sized reduced to 5 troves
    assert.equal((await sortedTroves.getSize()).toString(), '5')

    // Check that the liquidation sequence has improved the TCR
    const TCR_After = await th.getTCR(contracts)
    assert.isTrue(TCR_After.gte(TCR_Before))
  })

  it("liquidateTroves(): A liquidation sequence of pure redistributions decreases the TCR, due to gas compensation, but up to 0.5%", async () => {
    const { collateral: W_coll, totalDebt: W_debt } = await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })
    const { collateral: A_coll, totalDebt: A_debt } = await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
    const { collateral: B_coll, totalDebt: B_debt } = await openTrove({ ICR: toBN(dec(28, 18)), extraParams: { from: bob } })
    const { collateral: C_coll, totalDebt: C_debt } = await openTrove({ ICR: toBN(dec(8, 18)), extraParams: { from: carol } })
    const { collateral: D_coll, totalDebt: D_debt } = await openTrove({ ICR: toBN(dec(80, 18)), extraParams: { from: dennis } })

    const { collateral: d1_coll, totalDebt: d1_debt } = await openTrove({ ICR: toBN(dec(199, 16)), extraParams: { from: defaulter_1 } })
    const { collateral: d2_coll, totalDebt: d2_debt } = await openTrove({ ICR: toBN(dec(156, 16)), extraParams: { from: defaulter_2 } })
    const { collateral: d3_coll, totalDebt: d3_debt } = await openTrove({ ICR: toBN(dec(183, 16)), extraParams: { from: defaulter_3 } })
    const { collateral: d4_coll, totalDebt: d4_debt } = await openTrove({ ICR: toBN(dec(166, 16)), extraParams: { from: defaulter_4 } })

    const totalCollNonDefaulters = W_coll.add(A_coll).add(B_coll).add(C_coll).add(D_coll)
    const totalCollDefaulters = d1_coll.add(d2_coll).add(d3_coll).add(d4_coll)
    const totalColl = totalCollNonDefaulters.add(totalCollDefaulters)
    const totalDebt = W_debt.add(A_debt).add(B_debt).add(C_debt).add(D_debt).add(d1_debt).add(d2_debt).add(d3_debt).add(d4_debt)

    assert.isTrue((await sortedTroves.contains(defaulter_1.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_2.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_3.address)))
    assert.isTrue((await sortedTroves.contains(defaulter_4.address)))

    assert.equal((await sortedTroves.getSize()).toString(), '9')

    // Price drops
    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price)

    const TCR_Before = await th.getTCR(contracts)
    assert.isAtMost(th.getDifference(TCR_Before, totalColl.mul(price).div(totalDebt)), 1000)

    // Check pool is empty before liquidation
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), '0')

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate
    await troveManager.liquidateTroves(10)

    // Check all defaulters have been liquidated
    assert.isFalse((await sortedTroves.contains(defaulter_1.address)))
    assert.isFalse((await sortedTroves.contains(defaulter_2.address)))
    assert.isFalse((await sortedTroves.contains(defaulter_3.address)))
    assert.isFalse((await sortedTroves.contains(defaulter_4.address)))

    // check system sized reduced to 5 troves
    assert.equal((await sortedTroves.getSize()).toString(), '5')

    // Check that the liquidation sequence has reduced the TCR
    const TCR_After = await th.getTCR(contracts)
    // ((100+1+7+2+20)+(1+2+3+4)*0.995)*100/(2050+50+50+50+50+101+257+328+480)
    assert.isAtMost(th.getDifference(TCR_After, totalCollNonDefaulters.add(th.applyLiquidationFee(totalCollDefaulters)).mul(price).div(totalDebt)), 1000)
    assert.isTrue(TCR_Before.gte(TCR_After))
    assert.isTrue(TCR_After.gte(TCR_Before.mul(toBN(995)).div(toBN(1000))))
  })

  it("liquidateTroves(): Liquidating troves with SP deposits correctly impacts their SP deposit and ETH gain", async () => {
    // Whale provides 400 LUSD to the SP
    const whaleDeposit = toBN(dec(40000, 18))
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: whaleDeposit, extraParams: { from: whale } })
    await stabilityPool.connect(whale).provideToSP(whaleDeposit, ZERO_ADDRESS)

    const A_deposit = toBN(dec(10000, 18))
    const B_deposit = toBN(dec(30000, 18))
    const { collateral: A_coll, totalDebt: A_debt } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: A_deposit, extraParams: { from: alice } })
    const { collateral: B_coll, totalDebt: B_debt } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: B_deposit, extraParams: { from: bob } })
    const { collateral: C_coll, totalDebt: C_debt } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

    const liquidatedColl = A_coll.add(B_coll).add(C_coll)
    const liquidatedDebt = A_debt.add(B_debt).add(C_debt)

    // A, B provide 100, 300 to the SP
    await stabilityPool.connect(alice).provideToSP(A_deposit, ZERO_ADDRESS)
    await stabilityPool.connect(bob).provideToSP(B_deposit, ZERO_ADDRESS)

    assert.equal((await sortedTroves.getSize()).toString(), '4')

    // Price drops
    await priceFeed.setPrice(dec(100, 18))

    // Check 800 LUSD in Pool
    const totalDeposits = whaleDeposit.add(A_deposit).add(B_deposit)
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), totalDeposits.toString())

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Liquidate
    await troveManager.liquidateTroves(10)

    // Check all defaulters have been liquidated
    assert.isFalse((await sortedTroves.contains(alice.address)))
    assert.isFalse((await sortedTroves.contains(bob.address)))
    assert.isFalse((await sortedTroves.contains(carol.address)))

    // check system sized reduced to 1 troves
    assert.equal((await sortedTroves.getSize()).toString(), '1')

    /* Prior to liquidation, SP deposits were:
    Whale: 400 LUSD
    Alice: 100 LUSD
    Bob:   300 LUSD
    Carol: 0 LUSD

    Total LUSD in Pool: 800 LUSD

    Then, liquidation hits A,B,C: 

    Total liquidated debt = 150 + 350 + 150 = 650 LUSD
    Total liquidated ETH = 1.1 + 3.1 + 1.1 = 5.3 ETH

    whale lusd loss: 650 * (400/800) = 325 lusd
    alice lusd loss:  650 *(100/800) = 81.25 lusd
    bob lusd loss: 650 * (300/800) = 243.75 lusd

    whale remaining deposit: (400 - 325) = 75 lusd
    alice remaining deposit: (100 - 81.25) = 18.75 lusd
    bob remaining deposit: (300 - 243.75) = 56.25 lusd

    whale eth gain: 5*0.995 * (400/800) = 2.4875 eth
    alice eth gain: 5*0.995 *(100/800) = 0.621875 eth
    bob eth gain: 5*0.995 * (300/800) = 1.865625 eth

    Total remaining deposits: 150 LUSD
    Total ETH gain: 4.975 ETH */

    // Check remaining LUSD Deposits and ETH gain, for whale and depositors whose troves were liquidated
    const whale_Deposit_After = await stabilityPool.getCompoundedSIMDeposit(whale.address)
    const alice_Deposit_After = await stabilityPool.getCompoundedSIMDeposit(alice.address)
    const bob_Deposit_After = await stabilityPool.getCompoundedSIMDeposit(bob.address)

    const whale_ETHGain = await stabilityPool.getDepositorWSTETHGain(whale.address)
    const alice_ETHGain = await stabilityPool.getDepositorWSTETHGain(alice.address)
    const bob_ETHGain = await stabilityPool.getDepositorWSTETHGain(bob.address)

    assert.isAtMost(th.getDifference(whale_Deposit_After, whaleDeposit.sub(liquidatedDebt.mul(whaleDeposit).div(totalDeposits))), 100000)
    assert.isAtMost(th.getDifference(alice_Deposit_After, A_deposit.sub(liquidatedDebt.mul(A_deposit).div(totalDeposits))), 100000)
    assert.isAtMost(th.getDifference(bob_Deposit_After, B_deposit.sub(liquidatedDebt.mul(B_deposit).div(totalDeposits))), 100000)

    assert.isAtMost(th.getDifference(whale_ETHGain, th.applyLiquidationFee(liquidatedColl).mul(whaleDeposit).div(totalDeposits)), 100000)
    assert.isAtMost(th.getDifference(alice_ETHGain, th.applyLiquidationFee(liquidatedColl).mul(A_deposit).div(totalDeposits)), 100000)
    assert.isAtMost(th.getDifference(bob_ETHGain, th.applyLiquidationFee(liquidatedColl).mul(B_deposit).div(totalDeposits)), 100000)

    // Check total remaining deposits and ETH gain in Stability Pool
    const total_LUSDinSP = await stabilityPool.getTotalSIMDeposits()
    const total_ETHinSP = await stabilityPool.getWSTETH()

    assert.isAtMost(th.getDifference(total_LUSDinSP, totalDeposits.sub(liquidatedDebt)), 1000)
    assert.isAtMost(th.getDifference(total_ETHinSP, th.applyLiquidationFee(liquidatedColl)), 1000)
  })

  it("liquidateTroves(): when SP > 0, triggers LQTY reward event - increases the sum G", async () => {
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // A, B, C open troves
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: C } })

    await openTrove({ ICR: toBN(dec(219, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(213, 16)), extraParams: { from: defaulter_2 } })

    // B provides to SP
    await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), dec(100, 18))

    const G_Before = await stabilityPool.epochToScaleToG(0, 0)

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // Price drops to 1ETH:100LUSD, reducing defaulters to below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // Liquidate troves
    await troveManager.liquidateTroves(2)
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))
    assert.isFalse(await sortedTroves.contains(defaulter_2.address))

    const G_After = await stabilityPool.epochToScaleToG(0, 0)

    // Expect G has increased from the LQTY reward event triggered
    assert.isTrue(G_After.gt(G_Before))
  })

  it("liquidateTroves(): when SP is empty, doesn't update G", async () => {
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // A, B, C open troves
    await openTrove({ ICR: toBN(dec(4, 18)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraLUSDAmount: toBN(dec(100, 18)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: C } })

    await openTrove({ ICR: toBN(dec(219, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(213, 16)), extraParams: { from: defaulter_2 } })

    // B provides to SP
    await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // B withdraws
    await stabilityPool.connect(B).withdrawFromSP(dec(100, 18))

    // Check SP is empty
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), '0')

    // Check G is non-zero
    const G_Before = await stabilityPool.epochToScaleToG(0, 0)
    assert.isTrue(G_Before.gt(toBN('0')))

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // Price drops to 1ETH:100LUSD, reducing defaulters to below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // liquidate troves
    await troveManager.liquidateTroves(2)
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))
    assert.isFalse(await sortedTroves.contains(defaulter_2.address))

    const G_After = await stabilityPool.epochToScaleToG(0, 0)

    // Expect G has not changed
    assert.isTrue(G_After.eq(G_Before))
  })


  // --- batchLiquidateTroves() ---

  it('batchLiquidateTroves(): liquidates a Trove that a) was skipped in a previous liquidation and b) has pending rewards', async () => {
    // A, B, C, D, E open troves 
    await openTrove({ ICR: toBN(dec(300, 16)), extraParams: { from: C } })
    await openTrove({ ICR: toBN(dec(364, 16)), extraParams: { from: D } })
    await openTrove({ ICR: toBN(dec(364, 16)), extraParams: { from: E } })
    await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(133, 16)), extraParams: { from: B } })

    // Price drops
    await priceFeed.setPrice(dec(175, 18))
    let price = await priceFeed.getPrice()
    
    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // A gets liquidated, creates pending rewards for all
    const liqTxA = await troveManager.liquidate(A.address)
    // assert.isTrue(liqTxA.receipt.status)
    assert.isFalse(await sortedTroves.contains(A.address))

    // A adds 10 LUSD to the SP, but less than C's debt
    await stabilityPool.connect(A).provideToSP(dec(10, 18), ZERO_ADDRESS)

    // Price drops
    await priceFeed.setPrice(dec(100, 18))
    price = await priceFeed.getPrice()
    // Confirm system is now in Recovery Mode
    assert.isTrue(await th.checkRecoveryMode(contracts))

    // Confirm C has ICR > TCR
    const TCR = await troveManager.getTCR(price)
    const ICR_C = await troveManager.getCurrentICR(C.address, price)
  
    assert.isTrue(ICR_C.gt(TCR))

    // Attempt to liquidate B and C, which skips C in the liquidation since it is immune
    const liqTxBC = await troveManager.liquidateTroves(2)
    // assert.isTrue(liqTxBC.receipt.status)
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isTrue(await sortedTroves.contains(C.address))
    assert.isTrue(await sortedTroves.contains(D.address))
    assert.isTrue(await sortedTroves.contains(E.address))

    // // All remaining troves D and E repay a little debt, applying their pending rewards
    assert.isTrue((await sortedTroves.getSize()).eq(toBN('3')))
    await borrowerOperations.connect(D).repaySIM(dec(1, 18), D.address, D.address)
    await borrowerOperations.connect(E).repaySIM(dec(1, 18), E.address, E.address)

    // Check C is the only trove that has pending rewards
    assert.isTrue(await troveManager.hasPendingRewards(C.address))
    assert.isFalse(await troveManager.hasPendingRewards(D.address))
    assert.isFalse(await troveManager.hasPendingRewards(E.address))

    // Check C's pending coll and debt rewards are <= the coll and debt in the DefaultPool
    const pendingETH_C = await troveManager.getPendingWSTETHReward(C.address)
    const pendingLUSDDebt_C = await troveManager.getPendingSIMDebtReward(C.address)
    const defaultPoolETH = await defaultPool.getWSTETH()
    const defaultPoolLUSDDebt = await defaultPool.getSIMDebt()
    assert.isTrue(pendingETH_C.lte(defaultPoolETH))
    assert.isTrue(pendingLUSDDebt_C.lte(defaultPoolLUSDDebt))
    //Check only difference is dust
    assert.isAtMost(th.getDifference(pendingETH_C, defaultPoolETH), 1000)
    assert.isAtMost(th.getDifference(pendingLUSDDebt_C, defaultPoolLUSDDebt), 1000)

    // Confirm system is still in Recovery Mode
    assert.isTrue(await th.checkRecoveryMode(contracts))

    // D and E fill the Stability Pool, enough to completely absorb C's debt of 70
    await stabilityPool.connect(D).provideToSP(dec(50, 18), ZERO_ADDRESS)
    await stabilityPool.connect(E).provideToSP(dec(50, 18), ZERO_ADDRESS)

    await priceFeed.setPrice(dec(50, 18))

    // Try to liquidate C again. Check it succeeds and closes C's trove
    const liqTx2 = await troveManager.batchLiquidateTroves([C.address,D.address])
    // assert.isTrue(liqTx2.receipt.status)
    assert.isFalse(await sortedTroves.contains(C.address))
    assert.isFalse(await sortedTroves.contains(D.address))
    assert.isTrue(await sortedTroves.contains(E.address))
    assert.isTrue((await sortedTroves.getSize()).eq(toBN('1')))
  })

  it('batchLiquidateTroves(): closes every trove with ICR < MCR in the given array', async () => {
    // --- SETUP ---
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(133, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(2000, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(1800, 16)), extraParams: { from: erin } })

    // Check full sorted list size is 6
    assert.equal((await sortedTroves.getSize()).toString(), '6')

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(dec(300, 18), ZERO_ADDRESS)

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing A, B, C ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Confirm troves A-C are ICR < 110%
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(carol.address, price)).lt(mv._MCR))

    // Confirm D-E are ICR > 110%
    assert.isTrue((await troveManager.getCurrentICR(dennis.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(erin.address, price)).gte(mv._MCR))

    // Confirm Whale is ICR >= 110% 
    assert.isTrue((await troveManager.getCurrentICR(whale.address, price)).gte(mv._MCR))

    liquidationArray = [alice, bob, carol, dennis, erin].map(s => s.address)
    await troveManager.batchLiquidateTroves(liquidationArray);

    // Confirm troves A-C have been removed from the system
    assert.isFalse(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))
    assert.isFalse(await sortedTroves.contains(carol.address))

    // Check all troves A-C are now closed by liquidation
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '3')

    // Check sorted list has been reduced to length 3
    assert.equal((await sortedTroves.getSize()).toString(), '3')
  })

  it('batchLiquidateTroves(): does not liquidate troves that are not in the given array', async () => {
    // --- SETUP ---
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: toBN(dec(500, 18)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: toBN(dec(500, 18)), extraParams: { from: erin } })

    // Check full sorted list size is 6
    assert.equal((await sortedTroves.getSize()).toString(), '6')

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(dec(300, 18), ZERO_ADDRESS)

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing A, B, C ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Confirm troves A-E are ICR < 110%
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(carol.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(dennis.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(erin.address, price)).lt(mv._MCR))

    liquidationArray = [alice, bob]  // C-E not included
    liquidationArray = liquidationArray.map(s => s.address)
    await troveManager.batchLiquidateTroves(liquidationArray);

    // Confirm troves A-B have been removed from the system
    assert.isFalse(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))

    // Check all troves A-B are now closed by liquidation
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')

    // Confirm troves C-E remain in the system
    assert.isTrue(await sortedTroves.contains(carol.address))
    assert.isTrue(await sortedTroves.contains(dennis.address))
    assert.isTrue(await sortedTroves.contains(erin.address))

    // Check all troves C-E are still active
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '1')
    assert.equal((await troveManager.Troves(dennis.address))[3].toString(), '1')
    assert.equal((await troveManager.Troves(erin.address))[3].toString(), '1')

    // Check sorted list has been reduced to length 4
    assert.equal((await sortedTroves.getSize()).toString(), '4')
  })

  it('batchLiquidateTroves(): does not close troves with ICR >= MCR in the given array', async () => {
    // --- SETUP ---
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(195, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(2000, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(1800, 16)), extraParams: { from: erin } })

    // Check full sorted list size is 6
    assert.equal((await sortedTroves.getSize()).toString(), '6')

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(dec(300, 18), ZERO_ADDRESS)

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing A, B, C ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Confirm troves A-C are ICR < 110%
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(carol.address, price)).lt(mv._MCR))

    // Confirm D-E are ICR >= 110%
    assert.isTrue((await troveManager.getCurrentICR(dennis.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(erin.address, price)).gte(mv._MCR))

    // Confirm Whale is ICR > 110% 
    assert.isTrue((await troveManager.getCurrentICR(whale.address, price)).gte(mv._MCR))

    liquidationArray = [alice, bob, carol, dennis, erin]
    liquidationArray = liquidationArray.map(s => s.address)
    await troveManager.batchLiquidateTroves(liquidationArray);

    // Confirm troves D-E and whale remain in the system
    assert.isTrue(await sortedTroves.contains(dennis.address))
    assert.isTrue(await sortedTroves.contains(erin.address))
    assert.isTrue(await sortedTroves.contains(whale.address))

    // Check all troves D-E and whale remain active
    assert.equal((await troveManager.Troves(dennis.address))[3].toString(), '1')
    assert.equal((await troveManager.Troves(erin.address))[3].toString(), '1')
    assert.isTrue(await sortedTroves.contains(whale.address))

    // Check sorted list has been reduced to length 3
    assert.equal((await sortedTroves.getSize()).toString(), '3')
  })

  it('batchLiquidateTroves(): reverts if array is empty', async () => {
    // --- SETUP ---
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(195, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(2000, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(1800, 16)), extraParams: { from: erin } })

    // Check full sorted list size is 6
    assert.equal((await sortedTroves.getSize()).toString(), '6')

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(dec(300, 18), ZERO_ADDRESS)

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing A, B, C ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    liquidationArray = [] as string[]
    try {
      const tx = await troveManager.batchLiquidateTroves(liquidationArray);
      assert.isFalse(1)
    } catch (error) {
      assert.include(error?.toString(), "TroveManager: Calldata address array must not be empty")
    }
  })

  it("batchLiquidateTroves(): skips if trove is non-existent", async () => {
    // --- SETUP ---
    const spDeposit = toBN(dec(500000, 18))
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: spDeposit, extraParams: { from: whale } })

    const { totalDebt: A_debt } = await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: alice } })
    const { totalDebt: B_debt } = await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(2000, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(1800, 16)), extraParams: { from: erin } })

    assert.equal((await troveManager.getTroveStatus(carol.address)).toNumber(), 0) // check trove non-existent

    // Check full sorted list size is 6
    assert.equal((await sortedTroves.getSize()).toString(), '5')

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(spDeposit, ZERO_ADDRESS)

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing A, B, C ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Confirm troves A-B are ICR < 110%
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).lt(mv._MCR))

    // Confirm D-E are ICR > 110%
    assert.isTrue((await troveManager.getCurrentICR(dennis.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(erin.address, price)).gte(mv._MCR))

    // Confirm Whale is ICR >= 110% 
    assert.isTrue((await troveManager.getCurrentICR(whale.address, price)).gte(mv._MCR))

    // Liquidate - trove C in between the ones to be liquidated!
    liquidationArray = [alice, carol, bob, dennis, erin]
    liquidationArray = liquidationArray.map(s => s.address)
    await troveManager.batchLiquidateTroves(liquidationArray);

    // Confirm troves A-B have been removed from the system
    assert.isFalse(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))

    // Check all troves A-B are now closed by liquidation
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')

    // Check sorted list has been reduced to length 3
    assert.equal((await sortedTroves.getSize()).toString(), '3')

    // Confirm trove C non-existent
    assert.isFalse(await sortedTroves.contains(carol.address))
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '0')

    // Check Stability pool has only been reduced by A-B
    th.assertIsApproximatelyEqual(await stabilityPool.getTotalSIMDeposits(), spDeposit.sub(A_debt).sub(B_debt))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));
  })

  it("batchLiquidateTroves(): skips if a trove has been closed", async () => {
    // --- SETUP ---
    const spDeposit = toBN(dec(500000, 18))
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: spDeposit, extraParams: { from: whale } })

    const { totalDebt: A_debt } = await openTrove({ ICR: toBN(dec(190, 16)), extraParams: { from: alice } })
    const { totalDebt: B_debt } = await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(195, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(2000, 16)), extraParams: { from: dennis } })
    await openTrove({ ICR: toBN(dec(1800, 16)), extraParams: { from: erin } })

    assert.isTrue(await sortedTroves.contains(carol.address))

    // Check full sorted list size is 6
    assert.equal((await sortedTroves.getSize()).toString(), '6')

    // Whale puts some tokens in Stability Pool
    await stabilityPool.connect(whale).provideToSP(spDeposit, ZERO_ADDRESS)

    // Whale transfers to Carol so she can close her trove
    await simToken.connect(whale).transfer(carol.address, dec(100, 18))

    // --- TEST ---

    // Price drops to 1ETH:100LUSD, reducing A, B, C ICR below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()

    // Carol liquidated, and her trove is closed
    const txCarolClose = await borrowerOperations.connect(carol).closeTrove()
    // assert.isTrue(txCarolClose.receipt.status)

    assert.isFalse(await sortedTroves.contains(carol.address))

    assert.equal((await troveManager.getTroveStatus(carol.address)).toNumber(), 2)  // check trove closed

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));

    // Confirm troves A-B are ICR < 110%
    assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(bob.address, price)).lt(mv._MCR))

    // Confirm D-E are ICR > 110%
    assert.isTrue((await troveManager.getCurrentICR(dennis.address, price)).gte(mv._MCR))
    assert.isTrue((await troveManager.getCurrentICR(erin.address, price)).gte(mv._MCR))

    // Confirm Whale is ICR >= 110% 
    assert.isTrue((await troveManager.getCurrentICR(whale.address, price)).gte(mv._MCR))

    // Liquidate - trove C in between the ones to be liquidated!
    liquidationArray = [alice, carol, bob, dennis, erin]
    liquidationArray = liquidationArray.map(s => s.address)
    await troveManager.batchLiquidateTroves(liquidationArray);

    // Confirm troves A-B have been removed from the system
    assert.isFalse(await sortedTroves.contains(alice.address))
    assert.isFalse(await sortedTroves.contains(bob.address))

    // Check all troves A-B are now closed by liquidation
    assert.equal((await troveManager.Troves(alice.address))[3].toString(), '3')
    assert.equal((await troveManager.Troves(bob.address))[3].toString(), '3')
    // Trove C still closed by user
    assert.equal((await troveManager.Troves(carol.address))[3].toString(), '2')

    // Check sorted list has been reduced to length 3
    assert.equal((await sortedTroves.getSize()).toString(), '3')

    // Check Stability pool has only been reduced by A-B
    th.assertIsApproximatelyEqual(await stabilityPool.getTotalSIMDeposits(), spDeposit.sub(A_debt).sub(B_debt))

    // Confirm system is not in Recovery Mode
    assert.isFalse(await th.checkRecoveryMode(contracts));
  })

  it("batchLiquidateTroves: when SP > 0, triggers LQTY reward event - increases the sum G", async () => {
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // A, B, C open troves
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(133, 16)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(167, 16)), extraParams: { from: C } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_2 } })

    // B provides to SP
    await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), dec(100, 18))

    const G_Before = await stabilityPool.epochToScaleToG(0, 0)

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // Price drops to 1ETH:100LUSD, reducing defaulters to below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // Liquidate troves
    await troveManager.batchLiquidateTroves([defaulter_1, defaulter_2].map(s => s.address))
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))
    assert.isFalse(await sortedTroves.contains(defaulter_2.address))

    const G_After = await stabilityPool.epochToScaleToG(0, 0)

    // Expect G has increased from the LQTY reward event triggered
    assert.isTrue(G_After.gt(G_Before))
  })

  it("batchLiquidateTroves(): when SP is empty, doesn't update G", async () => {
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // A, B, C open troves
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(133, 16)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(167, 16)), extraParams: { from: C } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_1 } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: defaulter_2 } })

    // B provides to SP
    await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // B withdraws
    await stabilityPool.connect(B).withdrawFromSP(dec(100, 18))

    // Check SP is empty
    assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), '0')

    // Check G is non-zero
    const G_Before = await stabilityPool.epochToScaleToG(0, 0)
    assert.isTrue(G_Before.gt(toBN('0')))

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

    // Price drops to 1ETH:100LUSD, reducing defaulters to below MCR
    await priceFeed.setPrice(dec(100, 18));
    const price = await priceFeed.getPrice()
    assert.isFalse(await th.checkRecoveryMode(contracts))

    // liquidate troves
    await troveManager.batchLiquidateTroves([defaulter_1, defaulter_2].map(s => s.address))
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))
    assert.isFalse(await sortedTroves.contains(defaulter_2.address))

    const G_After = await stabilityPool.epochToScaleToG(0, 0)

    // Expect G has not changed
    assert.isTrue(G_After.eq(G_Before))
  })

  // --- redemptions ---


  it('getRedemptionHints(): gets the address of the first Trove and the final ICR of the last Trove involved in a redemption', async () => {
    // --- SETUP ---
    const partialRedemptionAmount = toBN(dec(100, 18))
    const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(310, 16)), extraLUSDAmount: partialRedemptionAmount, extraParams: { from: alice } })
    const { netDebt: B_debt } = await openTrove({ ICR: toBN(dec(290, 16)), extraParams: { from: bob } })
    const { netDebt: C_debt } = await openTrove({ ICR: toBN(dec(250, 16)), extraParams: { from: carol } })
    // Dennis' Trove should be untouched by redemption, because its ICR will be < 110% after the price drop
    await openTrove({ ICR: toBN(dec(120, 16)), extraParams: { from: dennis } })

    // Drop the price
    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price);

    // --- TEST ---
    const redemptionAmount = C_debt.add(B_debt).add(partialRedemptionAmount)
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(redemptionAmount, price, 0)

    assert.equal(firstRedemptionHint, carol.address)
    const expectedICR = A_coll.mul(price).sub(partialRedemptionAmount.mul(mv._1e18BN)).div(A_totalDebt.sub(partialRedemptionAmount))
    th.assertIsApproximatelyEqual(partialRedemptionHintNICR, expectedICR)
  });

  it('getRedemptionHints(): returns 0 as partialRedemptionHintNICR when reaching _maxIterations', async () => {
    // --- SETUP ---
    await openTrove({ ICR: toBN(dec(310, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(290, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(250, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraParams: { from: dennis } })

    const price = await priceFeed.getPrice();

    // --- TEST ---

    // was: Get hints for a redemption of 170 + 30 + some extra LUSD. At least 3 iterations are needed
    // for total redemption of the given amount.
    // now: Get hints for a redemption of 2000
    // todo check new mechanics without LUSD_GAS_COMPENSATION
    const {
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints('2000' + _18_zeros, price, 2) // limit _maxIterations to 2

    assert.equal(partialRedemptionHintNICR.toString(), '0')
  });

  it('redeemCollateral(): cancels the provided LUSD with debt from Troves with the lowest ICRs and sends an equivalent amount of Ether', async () => {
    // --- SETUP ---
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(310, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: alice } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(8, 18), extraParams: { from: bob } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(250, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: carol } })
    const partialRedemptionAmount = toBN(2)
    const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)
    // start Dennis with a high ICR
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: redemptionAmount, extraParams: { from: dennis } })

    const dennis_ETHBalance_Before = await contracts.wstETHMock.balanceOf(dennis.address)
    
    const dennis_LUSDBalance_Before = await simToken.balanceOf(dennis.address)

    const price = await priceFeed.getPrice()
    assert.equal(price.toString(), dec(200, 18))

    // --- TEST ---

    // Find hints for redeeming 20 LUSD
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(redemptionAmount, price, 0)

    // We don't need to use getApproxHint for this test, since it's not the subject of this
    // test case, and the list is very small, so the correct position is quickly found
    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      dennis.address,
      dennis.address
    )

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Dennis redeems 20 LUSD
    // Don't pay for gas, as it makes it easier to calculate the received Ether
    const redemptionTx = await troveManager.connect(dennis).redeemCollateral(
      redemptionAmount,
      firstRedemptionHint,
      upperPartialRedemptionHint,
      lowerPartialRedemptionHint,
      partialRedemptionHintNICR,
      0, th._100pct
    )

    const ETHFee = (await th.getEmittedRedemptionValues(redemptionTx))[3]

    const alice_Trove_After = await troveManager.Troves(alice.address)
    const bob_Trove_After = await troveManager.Troves(bob.address)
    const carol_Trove_After = await troveManager.Troves(carol.address)

    const alice_debt_After = alice_Trove_After[0]
    const bob_debt_After = bob_Trove_After[0].toString()
    const carol_debt_After = carol_Trove_After[0].toString()

    /* check that Dennis' redeemed 20 LUSD has been cancelled with debt from Bobs's Trove (8) and Carol's Trove (10).
    The remaining lot (2) is sent to Alice's Trove, who had the best ICR.
    It leaves her with (3) LUSD debt + 50 for gas compensation. */
    th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
    assert.equal(bob_debt_After, '0')
    assert.equal(carol_debt_After, '0')

    const dennis_ETHBalance_After = await contracts.wstETHMock.balanceOf(dennis.address)
    const receivedETH = dennis_ETHBalance_After.sub(dennis_ETHBalance_Before)

    const expectedTotalETHDrawn = redemptionAmount.div(toBN(200)) // convert redemptionAmount LUSD to ETH, at ETH:USD price 200
    const expectedReceivedETH = expectedTotalETHDrawn.sub(toBN(ETHFee))/*.sub(toBN(await th.gasUsed(redemptionTx)).mul(GAS_PRICE))*/ // substract gas used for troveManager.redeemCollateral from expected received ETH
    
    // console.log("*********************************************************************************")
    // console.log("ETHFee: " + ETHFee)
    // console.log("dennis_ETHBalance_Before: " + dennis_ETHBalance_Before)
    // console.log("GAS_USED: " + th.gasUsed(redemptionTx))
    // console.log("dennis_ETHBalance_After: " + dennis_ETHBalance_After)
    // console.log("expectedTotalETHDrawn: " + expectedTotalETHDrawn)
    // console.log("recived  : " + receivedETH)
    // console.log("expected : " + expectedReceivedETH)
    // console.log("wanted :   " + expectedReceivedETH.sub(toBN(GAS_PRICE)))
    // console.log("*********************************************************************************")
    th.assertIsApproximatelyEqual(expectedReceivedETH, receivedETH)

    const dennis_LUSDBalance_After = (await simToken.balanceOf(dennis.address)).toString()
    assert.equal(dennis_LUSDBalance_After, dennis_LUSDBalance_Before.sub(redemptionAmount).toString())
  })

  it('redeemCollateral(): with invalid first hint, zero address', async () => {
    // --- SETUP ---
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(310, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: alice } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(8, 18), extraParams: { from: bob } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(250, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: carol } })
    const partialRedemptionAmount = toBN(2)
    const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)
    // start Dennis with a high ICR
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: redemptionAmount, extraParams: { from: dennis } })

    const dennis_ETHBalance_Before = await contracts.wstETHMock.balanceOf(dennis.address)

    const dennis_LUSDBalance_Before = await simToken.balanceOf(dennis.address)

    const price = await priceFeed.getPrice()
    assert.equal(price.toString(), dec(200, 18))

    // --- TEST ---

    // Find hints for redeeming 20 LUSD
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(redemptionAmount, price, 0)

    // We don't need to use getApproxHint for this test, since it's not the subject of this
    // test case, and the list is very small, so the correct position is quickly found
    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      dennis.address,
      dennis.address
    )

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Dennis redeems 20 LUSD
    // Don't pay for gas, as it makes it easier to calculate the received Ether
    const redemptionTx = await troveManager.connect(dennis).redeemCollateral(
      redemptionAmount,
      ZERO_ADDRESS, // invalid first hint
      upperPartialRedemptionHint,
      lowerPartialRedemptionHint,
      partialRedemptionHintNICR,
      0, th._100pct
    )

    const ETHFee = (await th.getEmittedRedemptionValues(redemptionTx))[3]

    const alice_Trove_After = await troveManager.Troves(alice.address)
    const bob_Trove_After = await troveManager.Troves(bob.address)
    const carol_Trove_After = await troveManager.Troves(carol.address)

    const alice_debt_After = alice_Trove_After[0]
    const bob_debt_After = bob_Trove_After[0].toString()
    const carol_debt_After = carol_Trove_After[0].toString()

    /* check that Dennis' redeemed 20 LUSD has been cancelled with debt from Bobs's Trove (8) and Carol's Trove (10).
    The remaining lot (2) is sent to Alice's Trove, who had the best ICR.
    It leaves her with (3) LUSD debt + 50 for gas compensation. */
    th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
    assert.equal(bob_debt_After, '0')
    assert.equal(carol_debt_After, '0')

    const dennis_ETHBalance_After = await contracts.wstETHMock.balanceOf(dennis.address)
    const receivedETH = dennis_ETHBalance_After.sub(dennis_ETHBalance_Before)

    const expectedTotalETHDrawn = redemptionAmount.div(toBN(200)) // convert redemptionAmount LUSD to ETH, at ETH:USD price 200
    const expectedReceivedETH = expectedTotalETHDrawn.sub(toBN(ETHFee))/*.sub(toBN(th.gasUsed(redemptionTx) * GAS_PRICE))*/ // substract gas used for troveManager.redeemCollateral from expected received ETH

    th.assertIsApproximatelyEqual(expectedReceivedETH, receivedETH)

    const dennis_LUSDBalance_After = (await simToken.balanceOf(dennis.address)).toString()
    assert.equal(dennis_LUSDBalance_After, dennis_LUSDBalance_Before.sub(redemptionAmount).toString())
  })

  it('redeemCollateral(): with invalid first hint, non-existent trove', async () => {
    // --- SETUP ---
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(310, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: alice } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(8, 18), extraParams: { from: bob } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(250, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: carol } })
    const partialRedemptionAmount = toBN(2)
    const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)
    // start Dennis with a high ICR
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: redemptionAmount, extraParams: { from: dennis } })

    const dennis_ETHBalance_Before = await contracts.wstETHMock.balanceOf(dennis.address)

    const dennis_LUSDBalance_Before = await simToken.balanceOf(dennis.address)

    const price = await priceFeed.getPrice()
    assert.equal(price.toString(), dec(200, 18))

    // --- TEST ---

    // Find hints for redeeming 20 LUSD
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(redemptionAmount, price, 0)

    // We don't need to use getApproxHint for this test, since it's not the subject of this
    // test case, and the list is very small, so the correct position is quickly found
    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      dennis.address,
      dennis.address
    )

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Dennis redeems 20 LUSD
    // Don't pay for gas, as it makes it easier to calculate the received Ether
    const redemptionTx = await troveManager.connect(dennis).redeemCollateral(
      redemptionAmount,
      erin.address, // invalid first hint, it doesn’t have a trove
      upperPartialRedemptionHint,
      lowerPartialRedemptionHint,
      partialRedemptionHintNICR,
      0, th._100pct
    )

    const ETHFee = (await th.getEmittedRedemptionValues(redemptionTx))[3]

    const alice_Trove_After = await troveManager.Troves(alice.address)
    const bob_Trove_After = await troveManager.Troves(bob.address)
    const carol_Trove_After = await troveManager.Troves(carol.address)

    const alice_debt_After = alice_Trove_After[0]
    const bob_debt_After = bob_Trove_After[0].toString()
    const carol_debt_After = carol_Trove_After[0].toString()

    /* check that Dennis' redeemed 20 LUSD has been cancelled with debt from Bobs's Trove (8) and Carol's Trove (10).
    The remaining lot (2) is sent to Alice's Trove, who had the best ICR.
    It leaves her with (3) LUSD debt + 50 for gas compensation. */
    th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
    assert.equal(bob_debt_After, '0')
    assert.equal(carol_debt_After, '0')

    const dennis_ETHBalance_After = await contracts.wstETHMock.balanceOf(dennis.address)
    const receivedETH = dennis_ETHBalance_After.sub(dennis_ETHBalance_Before)

    const expectedTotalETHDrawn = redemptionAmount.div(toBN(200)) // convert redemptionAmount LUSD to ETH, at ETH:USD price 200
    const expectedReceivedETH = expectedTotalETHDrawn.sub(toBN(ETHFee))/*.sub(toBN(th.gasUsed(redemptionTx) * GAS_PRICE))*/ // substract gas used for troveManager.redeemCollateral from expected received ETH

    th.assertIsApproximatelyEqual(expectedReceivedETH, receivedETH)

    const dennis_LUSDBalance_After = (await simToken.balanceOf(dennis.address)).toString()
    assert.equal(dennis_LUSDBalance_After, dennis_LUSDBalance_Before.sub(redemptionAmount).toString())
  })

  it('redeemCollateral(): with invalid first hint, trove below MCR', async () => {
    // --- SETUP ---
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(310, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: alice } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(8, 18), extraParams: { from: bob } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(250, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: carol } })
    const partialRedemptionAmount = toBN(2)
    const redemptionAmount = C_netDebt.add(B_netDebt).add(partialRedemptionAmount)
    // start Dennis with a high ICR
    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: redemptionAmount, extraParams: { from: dennis } })

    const dennis_ETHBalance_Before = await contracts.wstETHMock.balanceOf(dennis.address)

    const dennis_LUSDBalance_Before = await simToken.balanceOf(dennis.address)

    const price = await priceFeed.getPrice()
    assert.equal(price.toString(), dec(200, 18))

    // Increase price to start Erin, and decrease it again so its ICR is under MCR
    await priceFeed.setPrice(price.mul(toBN(2)))
    await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: erin } })
    await priceFeed.setPrice(price)


    // --- TEST ---

    // Find hints for redeeming 20 LUSD
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(redemptionAmount, price, 0)

    // We don't need to use getApproxHint for this test, since it's not the subject of this
    // test case, and the list is very small, so the correct position is quickly found
    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      dennis.address,
      dennis.address
    )

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Dennis redeems 20 LUSD
    // Don't pay for gas, as it makes it easier to calculate the received Ether
    const redemptionTx = await troveManager.connect(dennis).redeemCollateral(
      redemptionAmount,
      erin.address, // invalid trove, below MCR
      upperPartialRedemptionHint,
      lowerPartialRedemptionHint,
      partialRedemptionHintNICR,
      0, th._100pct
    )

    const ETHFee = (await th.getEmittedRedemptionValues(redemptionTx))[3]

    const alice_Trove_After = await troveManager.Troves(alice.address)
    const bob_Trove_After = await troveManager.Troves(bob.address)
    const carol_Trove_After = await troveManager.Troves(carol.address)

    const alice_debt_After = alice_Trove_After[0]
    const bob_debt_After = bob_Trove_After[0].toString()
    const carol_debt_After = carol_Trove_After[0].toString()

    /* check that Dennis' redeemed 20 LUSD has been cancelled with debt from Bobs's Trove (8) and Carol's Trove (10).
    The remaining lot (2) is sent to Alice's Trove, who had the best ICR.
    It leaves her with (3) LUSD debt + 50 for gas compensation. */
    th.assertIsApproximatelyEqual(alice_debt_After, A_totalDebt.sub(partialRedemptionAmount))
    assert.equal(bob_debt_After, '0')
    assert.equal(carol_debt_After, '0')

    const dennis_ETHBalance_After = await contracts.wstETHMock.balanceOf(dennis.address)
    const receivedETH = dennis_ETHBalance_After.sub(dennis_ETHBalance_Before)

    const expectedTotalETHDrawn = redemptionAmount.div(toBN(200)) // convert redemptionAmount LUSD to ETH, at ETH:USD price 200
    const expectedReceivedETH = expectedTotalETHDrawn.sub(toBN(ETHFee))/*.sub(toBN(th.gasUsed(redemptionTx) * GAS_PRICE))*/ // substract gas used for troveManager.redeemCollateral from expected received ETH

    th.assertIsApproximatelyEqual(expectedReceivedETH, receivedETH)

    const dennis_LUSDBalance_After = (await simToken.balanceOf(dennis.address)).toString()
    assert.equal(dennis_LUSDBalance_After, dennis_LUSDBalance_Before.sub(redemptionAmount).toString())
  })

  it('redeemCollateral(): ends the redemption sequence when the token redemption request has been filled', async () => {
    // --- SETUP --- 
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // Alice, Bob, Carol, Dennis, Erin open troves
    const { netDebt: A_debt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: alice } })
    const { netDebt: B_debt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: bob } })
    const { netDebt: C_debt } = await openTrove({ ICR: toBN(dec(290, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: carol } })
    const redemptionAmount = A_debt.add(B_debt).add(C_debt)
    const { totalDebt: D_totalDebt, collateral: D_coll } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: dennis } })
    const { totalDebt: E_totalDebt, collateral: E_coll } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: erin } })

    // --- TEST --- 

    // open trove from redeemer.  Redeemer has highest ICR (100ETH, 100 LUSD), 20000%
    const { lusdAmount: F_lusdAmount } = await openTrove({ ICR: toBN(dec(200, 18)), extraLUSDAmount: redemptionAmount.mul(toBN(2)), extraParams: { from: flyn } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Flyn redeems collateral
    await troveManager.connect(flyn).redeemCollateral(redemptionAmount, alice.address, alice.address, alice.address, 0, 0, th._100pct)

    // Check Flyn's redemption has reduced his balance from 100 to (100-60) = 40 LUSD
    const flynBalance = await simToken.balanceOf(flyn.address)
    th.assertIsApproximatelyEqual(flynBalance, F_lusdAmount.sub(redemptionAmount))

    // Check debt of Alice, Bob, Carol
    const alice_Debt = await troveManager.getTroveDebt(alice.address)
    const bob_Debt = await troveManager.getTroveDebt(bob.address)
    const carol_Debt = await troveManager.getTroveDebt(carol.address)

    assert.equal(alice_Debt.toNumber(), 0)
    assert.equal(bob_Debt.toNumber(), 0)
    assert.equal(carol_Debt.toNumber(), 0)

    // check Alice, Bob and Carol troves are closed by redemption
    const alice_Status = await troveManager.getTroveStatus(alice.address)
    const bob_Status = await troveManager.getTroveStatus(bob.address)
    const carol_Status = await troveManager.getTroveStatus(carol.address)
    assert.equal(alice_Status.toNumber(), 4)
    assert.equal(bob_Status.toNumber(), 4)
    assert.equal(carol_Status.toNumber(), 4)

    // check debt and coll of Dennis, Erin has not been impacted by redemption
    const dennis_Debt = await troveManager.getTroveDebt(dennis.address)
    const erin_Debt = await troveManager.getTroveDebt(erin.address)

    th.assertIsApproximatelyEqual(dennis_Debt, D_totalDebt)
    th.assertIsApproximatelyEqual(erin_Debt, E_totalDebt)

    const dennis_Coll = await troveManager.getTroveColl(dennis.address)
    const erin_Coll = await troveManager.getTroveColl(erin.address)

    assert.equal(dennis_Coll.toString(), D_coll.toString())
    assert.equal(erin_Coll.toString(), E_coll.toString())
  })

  it('redeemCollateral(): ends the redemption sequence when max iterations have been reached', async () => {
    // --- SETUP --- 
    await openTrove({ ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

    // Alice, Bob, Carol open troves with equal collateral ratio
    const { netDebt: A_debt } = await openTrove({ ICR: toBN(dec(286, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: alice } })
    const { netDebt: B_debt } = await openTrove({ ICR: toBN(dec(286, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: bob } })
    const { netDebt: C_debt, totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(286, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: carol } })
    const redemptionAmount = A_debt.add(B_debt)
    const attemptedRedemptionAmount = redemptionAmount.add(C_debt)

    // --- TEST --- 

    // open trove from redeemer.  Redeemer has highest ICR (100ETH, 100 LUSD), 20000%
    const { lusdAmount: F_lusdAmount } = await openTrove({ ICR: toBN(dec(200, 18)), extraLUSDAmount: redemptionAmount.mul(toBN(2)), extraParams: { from: flyn } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Flyn redeems collateral with only two iterations
    await troveManager.connect(flyn).redeemCollateral(attemptedRedemptionAmount, alice.address, alice.address, alice.address, 0, 2, th._100pct)

    // Check Flyn's redemption has reduced his balance from 100 to (100-40) = 60 LUSD
    const flynBalance = await simToken.balanceOf(flyn.address)
    th.assertIsApproximatelyEqual(flynBalance, F_lusdAmount.sub(redemptionAmount))

    // Check debt of Alice, Bob, Carol
    const alice_Debt = await troveManager.getTroveDebt(alice.address)
    const bob_Debt = await troveManager.getTroveDebt(bob.address)
    const carol_Debt = await troveManager.getTroveDebt(carol.address)

    assert.equal(alice_Debt.toNumber(), 0)
    assert.equal(bob_Debt.toNumber(), 0)
    th.assertIsApproximatelyEqual(carol_Debt, C_totalDebt)

    // check Alice and Bob troves are closed, but Carol is not
    const alice_Status = await troveManager.getTroveStatus(alice.address)
    const bob_Status = await troveManager.getTroveStatus(bob.address)
    const carol_Status = await troveManager.getTroveStatus(carol.address)
    assert.equal(alice_Status.toNumber(), 4)
    assert.equal(bob_Status.toNumber(), 4)
    assert.equal(carol_Status.toNumber(), 1)
  })

  it("redeemCollateral(): performs partial redemption if resultant debt is > minimum net debt", async () => {
    await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
    await borrowerOperations.connect(A).openTrove(dec(1000, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(10000, 18))), A.address, A.address)
    await contracts.wstETHMock.connect(B).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
    await borrowerOperations.connect(B).openTrove(dec(1000, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(20000, 18))), B.address, B.address)
    await contracts.wstETHMock.connect(C).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
    await borrowerOperations.connect(C).openTrove(dec(1000, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(30000, 18))), C.address, C.address)

    // A and C send all their tokens to B
    await simToken.connect(A).transfer(B.address, await simToken.balanceOf(A.address))
    await simToken.connect(C).transfer(B.address, await simToken.balanceOf(C.address))
    
    await troveManager.setBaseRate(0) 

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // LUSD redemption is 55000 US
    const LUSDRedemption = dec(55000, 18)
    const tx1 = await th.redeemCollateralAndGetTxObject(B, contracts, LUSDRedemption, th._100pct)
    
    // Check B, C closed and A remains active
    assert.isTrue(await sortedTroves.contains(A.address))
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isFalse(await sortedTroves.contains(C.address))

    // A's remaining debt = 30000 + 20000 + 10000 - 55000 = 5000
    const A_debt = await troveManager.getTroveDebt(A.address)
    await th.assertIsApproximatelyEqual(A_debt, toBN(dec(5000/*4600*/, 18)), 1000)
  })

  it("redeemCollateral(): doesn't perform partial redemption if resultant debt would be < minimum net debt", async () => {
    await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
    await borrowerOperations.connect(A).openTrove(dec(1000, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(6000, 18))), A.address, A.address)
    await contracts.wstETHMock.connect(B).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
    await borrowerOperations.connect(B).openTrove(dec(1000, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(20000, 18))), B.address, B.address)
    await contracts.wstETHMock.connect(C).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
    await borrowerOperations.connect(C).openTrove(dec(1000, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(30000, 18))), C.address, C.address)

    // A and C send all their tokens to B
    await simToken.connect(A).transfer(B.address, await simToken.balanceOf(A.address))
    await simToken.connect(C).transfer(B.address, await simToken.balanceOf(C.address))

    await troveManager.setBaseRate(0) 

    // Skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // LUSD redemption is 55000 LUSD
    const LUSDRedemption = dec(55000, 18)
    const tx1 = await th.redeemCollateralAndGetTxObject(B, contracts, LUSDRedemption, th._100pct)
    
    // Check B, C closed and A remains active
    assert.isTrue(await sortedTroves.contains(A.address))
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isFalse(await sortedTroves.contains(C.address))

    // A's remaining debt would be 29950 + 19950 + 5950 + 50 - 55000 = 900.
    // Since this is below the min net debt of 100, A should be skipped and untouched by the redemption
    const A_debt = await troveManager.getTroveDebt(A.address)
    await th.assertIsApproximatelyEqual(A_debt, toBN(dec(6000, 18)))
  })

  it('redeemCollateral(): doesnt perform the final partial redemption in the sequence if the hint is out-of-date', async () => {
    // --- SETUP ---
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(363, 16)), extraLUSDAmount: dec(5, 18), extraParams: { from: alice } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(344, 16)), extraLUSDAmount: dec(8, 18), extraParams: { from: bob } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(333, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: carol } })

    const partialRedemptionAmount = toBN(2)
    const fullfilledRedemptionAmount = C_netDebt.add(B_netDebt)
    const redemptionAmount = fullfilledRedemptionAmount.add(partialRedemptionAmount)

    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: redemptionAmount, extraParams: { from: dennis } })

    const dennis_ETHBalance_Before = await contracts.wstETHMock.balanceOf(dennis.address)

    const dennis_LUSDBalance_Before = await simToken.balanceOf(dennis.address)

    const price = await priceFeed.getPrice()
    assert.equal(price.toString(), dec(200, 18))

    // --- TEST --- 

    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(redemptionAmount, price, 0)

    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      dennis.address,
      dennis.address
    )

    const frontRunRedepmtion = toBN(dec(1, 18))
    // Oops, another transaction gets in the way
    {
      const {
        firstRedemptionHint,
        partialRedemptionHintNICR
      } = await hintHelpers.getRedemptionHints(dec(1, 18), price, 0)

      const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
        partialRedemptionHintNICR,
        dennis.address,
        dennis.address
      )

      // skip bootstrapping phase
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

      // Alice redeems 1 LUSD from Carol's Trove
      await troveManager.connect(alice).redeemCollateral(
        frontRunRedepmtion,
        firstRedemptionHint,
        upperPartialRedemptionHint,
        lowerPartialRedemptionHint,
        partialRedemptionHintNICR,
        0, th._100pct
      )
    }

    // Dennis tries to redeem 20 LUSD
    const redemptionTx = await troveManager.connect(dennis).redeemCollateral(
      redemptionAmount,
      firstRedemptionHint,
      upperPartialRedemptionHint,
      lowerPartialRedemptionHint,
      partialRedemptionHintNICR,
      0, th._100pct
    )

    const ETHFee = (await th.getEmittedRedemptionValues(redemptionTx))[3]

    // Since Alice already redeemed 1 LUSD from Carol's Trove, Dennis was  able to redeem:
    //  - 9 LUSD from Carol's
    //  - 8 LUSD from Bob's
    // for a total of 17 LUSD.

    // Dennis calculated his hint for redeeming 2 LUSD from Alice's Trove, but after Alice's transaction
    // got in the way, he would have needed to redeem 3 LUSD to fully complete his redemption of 20 LUSD.
    // This would have required a different hint, therefore he ended up with a partial redemption.

    const dennis_ETHBalance_After = await contracts.wstETHMock.balanceOf(dennis.address)
    const receivedETH = dennis_ETHBalance_After.sub(dennis_ETHBalance_Before)

    // Expect only 17 worth of ETH drawn
    const expectedTotalETHDrawn = fullfilledRedemptionAmount.sub(frontRunRedepmtion).div(toBN(200)) // redempted LUSD converted to ETH, at ETH:USD price 200
    const expectedReceivedETH = expectedTotalETHDrawn.sub(ETHFee)/*.sub(toBN(th.gasUsed(redemptionTx) * GAS_PRICE))*/ // substract gas used for troveManager.redeemCollateral from expected received ETH

    th.assertIsApproximatelyEqual(expectedReceivedETH, receivedETH)

    const dennis_LUSDBalance_After = await simToken.balanceOf(dennis.address)
    th.assertIsApproximatelyEqual(dennis_LUSDBalance_After, dennis_LUSDBalance_Before.sub(fullfilledRedemptionAmount.sub(frontRunRedepmtion)))
  })

  // active debt cannot be zero, as there’s a positive min debt enforced, and at least a trove must exist
  /*it.skip("redeemCollateral(): can redeem if there is zero active debt but non-zero debt in DefaultPool", async () => {
    // --- SETUP ---

    const amount = await getOpenTroveLUSDAmount(dec(110, 18))
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(133, 16)), extraLUSDAmount: amount, extraParams: { from: bob } })

    await simToken.transfer(carol.address, amount, { from: bob })

    const price = dec(100, 18)
    await priceFeed.setPrice(price)

    // Liquidate Bob's Trove
    await troveManager.liquidateTroves(1)

    // --- TEST --- 

    const carol_ETHBalance_Before = toBN(await web3.eth.getBalance(carol))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    const redemptionTx = await troveManager.redeemCollateral(
      amount,
      alice.address,
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '10367038690476190477',
      0,
      th._100pct,
      {
        from: carol,
        gasPrice: GAS_PRICE
      }
    )

    const ETHFee = (await th.getEmittedRedemptionValues(redemptionTx))[3]

    const carol_ETHBalance_After = toBN(await web3.eth.getBalance(carol))

    const expectedTotalETHDrawn = toBN(amount).div(toBN(100)) // convert 100 LUSD to ETH at ETH:USD price of 100
    const expectedReceivedETH = expectedTotalETHDrawn.sub(ETHFee)

    const receivedETH = carol_ETHBalance_After.sub(carol_ETHBalance_Before)
    assert.isTrue(expectedReceivedETH.eq(receivedETH))

    const carol_LUSDBalance_After = (await simToken.balanceOf(carol.address)).toString()
    assert.equal(carol_LUSDBalance_After, '0')
  })*/

  it("redeemCollateral(): doesn't touch Troves with ICR < 110%", async () => {
    // --- SETUP ---

    const { netDebt: A_debt } = await openTrove({ ICR: toBN(dec(13, 18)), extraParams: { from: alice } })
    const { lusdAmount: B_lusdAmount, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(133, 16)), extraLUSDAmount: A_debt, extraParams: { from: bob } })

    await simToken.connect(bob).transfer(carol.address, B_lusdAmount)

    // Put Bob's Trove below 110% ICR
    const price = dec(100, 18)
    await priceFeed.setPrice(price)

    // --- TEST --- 

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    await troveManager.connect(carol).redeemCollateral(
      A_debt,
      alice.address,
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      0,
      0,
      th._100pct
    );

    // Alice's Trove was cleared of debt
    const { debt: alice_Debt_After } = await troveManager.Troves(alice.address)
    assert.equal(alice_Debt_After.toString(), '0')

    // Bob's Trove was left untouched
    const { debt: bob_Debt_After } = await troveManager.Troves(bob.address)
    th.assertIsApproximatelyEqual(bob_Debt_After, B_totalDebt)
  });

  it("redeemCollateral(): finds the last Trove with ICR == 110% even if there is more than one", async () => {
    // --- SETUP ---
    const amount1 = toBN(dec(100, 18))
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: amount1, extraParams: { from: alice } })
    const { totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: amount1, extraParams: { from: bob } })
    const { totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: amount1, extraParams: { from: carol } })
    const redemptionAmount = C_totalDebt.add(B_totalDebt).add(A_totalDebt)
    const { totalDebt: D_totalDebt } = await openTrove({ ICR: toBN(dec(195, 16)), extraLUSDAmount: redemptionAmount, extraParams: { from: dennis } })

    // This will put Dennis slightly below 110%, and everyone else exactly at 110%
    const price = '110' + _18_zeros
    await priceFeed.setPrice(price)

    const orderOfTroves = [];
    let current = await sortedTroves.getFirst();

    while (current !== '0x0000000000000000000000000000000000000000') {
      orderOfTroves.push(current);
      current = await sortedTroves.getNext(current);
    }

    assert.deepEqual(orderOfTroves, [carol, bob, alice, dennis].map(s => s.address));

    await openTrove({ ICR: toBN(dec(100, 18)), extraLUSDAmount: dec(10, 18), extraParams: { from: whale } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    const tx = await troveManager.connect(dennis).redeemCollateral(
      redemptionAmount,
      carol.address, // try to trick redeemCollateral by passing a hint that doesn't exactly point to the
      // last Trove with ICR == 110% (which would be Alice's)
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      0,
      0,
      th._100pct
    )
    
    const { debt: alice_Debt_After } = await troveManager.Troves(alice.address)
    assert.equal(alice_Debt_After.toString(), '0')

    const { debt: bob_Debt_After } = await troveManager.Troves(bob.address)
    assert.equal(bob_Debt_After.toString(), '0')

    const { debt: carol_Debt_After } = await troveManager.Troves(carol.address)
    assert.equal(carol_Debt_After.toString(), '0')

    const { debt: dennis_Debt_After } = await troveManager.Troves(dennis.address)
    th.assertIsApproximatelyEqual(dennis_Debt_After, D_totalDebt)
  });

  it("redeemCollateral(): reverts when TCR < MCR", async () => {
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(196, 16)), extraParams: { from: dennis } })

    // This will put Dennis slightly below 110%, and everyone else exactly at 110%
  
    await priceFeed.setPrice('110' + _18_zeros)
    const price = await priceFeed.getPrice()
    
    const TCR = (await th.getTCR(contracts))
    assert.isTrue(TCR.lt(toBN('1100000000000000000')))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    await assertRevert(th.redeemCollateral(carol, contracts, dec(270, 18), GAS_PRICE), "TroveManager: Cannot redeem when TCR < MCR")
  });

  it("redeemCollateral(): reverts when argument _amount is 0", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // Alice opens trove and transfers 500LUSD to Erin, the would-be redeemer
    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(500, 18), extraParams: { from: alice } })
    await simToken.connect(alice).transfer(erin.address, dec(500, 18))

    // B, C and D open troves
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: bob } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: carol } })
    await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: dennis } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Erin attempts to redeem with _amount = 0
    const redemptionTxPromise = troveManager.connect(erin).redeemCollateral(0, erin.address, erin.address, erin.address, 0, 0, th._100pct)
    await assertRevert(redemptionTxPromise, "TroveManager: Amount must be greater than zero")
  })

  it("redeemCollateral(): reverts if max fee > 100%", async () => {
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(30, 18), extraParams: { from: C } })
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(40, 18), extraParams: { from: D } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, dec(10, 18), GAS_PRICE ,dec(2, 18)), "Max fee percentage must be between 0.5% and 100%")
    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, dec(10, 18), GAS_PRICE, '1000000000000000001'), "Max fee percentage must be between 0.5% and 100%")
  })

  it("redeemCollateral(): reverts if max fee < 0.5%", async () => { 
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(10, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(20, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(30, 18), extraParams: { from: C } })
    await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(40, 18), extraParams: { from: D } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, dec(10, 18), GAS_PRICE, '0'), "Max fee percentage must be between 0.5% and 100%")
    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, dec(10, 18), GAS_PRICE, '1'), "Max fee percentage must be between 0.5% and 100%")
    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, dec(10, 18), GAS_PRICE, '4999999999999999'), "Max fee percentage must be between 0.5% and 100%")
  })

  it("redeemCollateral(): reverts if fee exceeds max fee percentage", async () => {
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(80, 18), extraParams: { from: A } })
    const { totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(90, 18), extraParams: { from: B } })
    const { totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })
    const expectedTotalSupply = A_totalDebt.add(B_totalDebt).add(C_totalDebt)

    // Check total LUSD supply
    const totalSupply = await simToken.totalSupply()
    th.assertIsApproximatelyEqual(totalSupply, expectedTotalSupply)

    await troveManager.setBaseRate(0) 

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    const attemptedLUSDRedemption = expectedTotalSupply.div(toBN(25))

    // totals.totalWSTETHDrawn 1254270000000000000
    // totals.WSTETHFee          31356750000000000

    // Max fee is <2.5%
    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, attemptedLUSDRedemption.toString(), 0, '24999999999999999'), "Fee exceeded provided maximum")
  
    await troveManager.setBaseRate(0)  // artificially zero the baseRate
    
    // Max fee is 1%
    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, attemptedLUSDRedemption.toString(), 0, dec(1, 16)), "Fee exceeded provided maximum")

    // Max fee is 0.5%
    await assertRevert(th.redeemCollateralAndGetTxObject(A, contracts, attemptedLUSDRedemption.toString(), 0, dec(5, 15)), "Fee exceeded provided maximum")
  })

  it("redeemCollateral(): succeeds if fee is less than max fee percentage", async () => {
    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(9500, 18), extraParams: { from: A } })
    const { totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(395, 16)), extraLUSDAmount: dec(9000, 18), extraParams: { from: B } })
    const { totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(390, 16)), extraLUSDAmount: dec(10000, 18), extraParams: { from: C } })
    const expectedTotalSupply = A_totalDebt.add(B_totalDebt).add(C_totalDebt)

    // Check total LUSD supply
    const totalSupply = await simToken.totalSupply()
    th.assertIsApproximatelyEqual(totalSupply, expectedTotalSupply)

    await troveManager.setBaseRate(0) 

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // LUSD redemption fee with 10% of the supply will be 0.5% + 1/(10*2)
    const attemptedLUSDRedemption = expectedTotalSupply.div(toBN(10))

    // Attempt with maxFee > 5.5%
    const price = await priceFeed.getPrice()
    const ETHDrawn = attemptedLUSDRedemption.mul(mv._1e18BN).div(price)
    const slightlyMoreThanFee = (await troveManager.getRedemptionFeeWithDecay(ETHDrawn))
    const tx1 = await th.redeemCollateralAndGetTxObject(A, contracts, attemptedLUSDRedemption.toString(), slightlyMoreThanFee.toString())
    // assert.isTrue(tx1.receipt.status)

    await troveManager.setBaseRate(0)  // Artificially zero the baseRate
    
    // Attempt with maxFee = 5.5%
    const exactSameFee = (await troveManager.getRedemptionFeeWithDecay(ETHDrawn))
    const tx2 = await th.redeemCollateralAndGetTxObject(C, contracts, attemptedLUSDRedemption.toString(), exactSameFee.toString())
    // assert.isTrue(tx2.receipt.status)

    await troveManager.setBaseRate(0)

     // Max fee is 10%
    const tx3 = await th.redeemCollateralAndGetTxObject(B, contracts, attemptedLUSDRedemption.toString(), dec(1, 17))
    // assert.isTrue(tx3.receipt.status)

    await troveManager.setBaseRate(0)

    // Max fee is 37.659%
    const tx4 = await th.redeemCollateralAndGetTxObject(A, contracts, attemptedLUSDRedemption.toString(), dec(37659, 13))
    // assert.isTrue(tx4.receipt.status)

    await troveManager.setBaseRate(0)

    // Max fee is 100%
    const tx5 = await th.redeemCollateralAndGetTxObject(C, contracts, attemptedLUSDRedemption.toString(), dec(1, 18))
    // assert.isTrue(tx5.receipt.status)
  })

  it("redeemCollateral(): doesn't affect the Stability Pool deposits or ETH gain of redeemed-from troves", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // B, C, D, F open trove
    const { totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: bob } })
    const { totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(195, 16)), extraLUSDAmount: dec(200, 18), extraParams: { from: carol } })
    const { totalDebt: D_totalDebt } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(400, 18), extraParams: { from: dennis } })
    const { totalDebt: F_totalDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: flyn } })

    const redemptionAmount = B_totalDebt.add(C_totalDebt).add(D_totalDebt).add(F_totalDebt)
    // Alice opens trove and transfers LUSD to Erin, the would-be redeemer
    await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: redemptionAmount, extraParams: { from: alice } })
    await simToken.connect(alice).transfer(erin.address, redemptionAmount)

    // B, C, D deposit some of their tokens to the Stability Pool
    await stabilityPool.connect(bob).provideToSP(dec(50, 18), ZERO_ADDRESS)
    await stabilityPool.connect(carol).provideToSP(dec(150, 18), ZERO_ADDRESS)
    await stabilityPool.connect(dennis).provideToSP(dec(200, 18), ZERO_ADDRESS)

    let price = await priceFeed.getPrice()
    const bob_ICR_before = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR_before = await troveManager.getCurrentICR(carol.address, price)
    const dennis_ICR_before = await troveManager.getCurrentICR(dennis.address, price)

    // Price drops
    await priceFeed.setPrice(dec(100, 18))

    assert.isTrue(await sortedTroves.contains(flyn.address))

    // Liquidate Flyn
    await troveManager.liquidate(flyn.address)
    assert.isFalse(await sortedTroves.contains(flyn.address))

    // Price bounces back, bringing B, C, D back above MCR
    await priceFeed.setPrice(dec(200, 18))

    const bob_SPDeposit_before = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
    const carol_SPDeposit_before = (await stabilityPool.getCompoundedSIMDeposit(carol.address)).toString()
    const dennis_SPDeposit_before = (await stabilityPool.getCompoundedSIMDeposit(dennis.address)).toString()

    const bob_ETHGain_before = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()
    const carol_ETHGain_before = (await stabilityPool.getDepositorWSTETHGain(carol.address)).toString()
    const dennis_ETHGain_before = (await stabilityPool.getDepositorWSTETHGain(dennis.address)).toString()

    // Check the remaining LUSD and ETH in Stability Pool after liquidation is non-zero
    const LUSDinSP = await stabilityPool.getTotalSIMDeposits()
    const ETHinSP = await stabilityPool.getWSTETH()
    assert.isTrue(LUSDinSP.gte(mv._zeroBN))
    assert.isTrue(ETHinSP.gte(mv._zeroBN))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Erin redeems LUSD
    await th.redeemCollateral(erin, contracts, redemptionAmount.toString(), th._100pct)

    price = await priceFeed.getPrice()
    const bob_ICR_after = await troveManager.getCurrentICR(bob.address, price)
    const carol_ICR_after = await troveManager.getCurrentICR(carol.address, price)
    const dennis_ICR_after = await troveManager.getCurrentICR(dennis.address, price)

    // Check ICR of B, C and D troves has increased,i.e. they have been hit by redemptions
    assert.isTrue(bob_ICR_after.gte(bob_ICR_before))
    assert.isTrue(carol_ICR_after.gte(carol_ICR_before))
    assert.isTrue(dennis_ICR_after.gte(dennis_ICR_before))

    const bob_SPDeposit_after = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
    const carol_SPDeposit_after = (await stabilityPool.getCompoundedSIMDeposit(carol.address)).toString()
    const dennis_SPDeposit_after = (await stabilityPool.getCompoundedSIMDeposit(dennis.address)).toString()

    const bob_ETHGain_after = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()
    const carol_ETHGain_after = (await stabilityPool.getDepositorWSTETHGain(carol.address)).toString()
    const dennis_ETHGain_after = (await stabilityPool.getDepositorWSTETHGain(dennis.address)).toString()

    // Check B, C, D Stability Pool deposits and ETH gain have not been affected by redemptions from their troves
    assert.equal(bob_SPDeposit_before, bob_SPDeposit_after)
    assert.equal(carol_SPDeposit_before, carol_SPDeposit_after)
    assert.equal(dennis_SPDeposit_before, dennis_SPDeposit_after)

    assert.equal(bob_ETHGain_before, bob_ETHGain_after)
    assert.equal(carol_ETHGain_before, carol_ETHGain_after)
    assert.equal(dennis_ETHGain_before, dennis_ETHGain_after)
  })

  it("redeemCollateral(): caller can redeem their entire LUSDToken balance", async () => {
    const { collateral: W_coll, totalDebt: W_totalDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // Alice opens trove and transfers 400 LUSD to Erin, the would-be redeemer
    const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(400, 18), extraParams: { from: alice } })
    await simToken.connect(alice).transfer(erin.address, dec(400, 18))

    // Check Erin's balance before
    const erin_balance_before = await simToken.balanceOf(erin.address)
    assert.equal(erin_balance_before.toString(), dec(400, 18))

    // B, C, D open trove
    const { collateral: B_coll, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(590, 18), extraParams: { from: bob } })
    const { collateral: C_coll, totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(1990, 18), extraParams: { from: carol } })
    const { collateral: D_coll, totalDebt: D_totalDebt } = await openTrove({ ICR: toBN(dec(500, 16)), extraLUSDAmount: dec(1990, 18), extraParams: { from: dennis } })

    const totalDebt = W_totalDebt.add(A_totalDebt).add(B_totalDebt).add(C_totalDebt).add(D_totalDebt)
    const totalColl = W_coll.add(A_coll).add(B_coll).add(C_coll).add(D_coll)

    // Get active debt and coll before redemption
    const activePool_debt_before = await activePool.getSIMDebt()
    const activePool_coll_before = await activePool.getWSTETH()

    th.assertIsApproximatelyEqual(activePool_debt_before, totalDebt)
    assert.equal(activePool_coll_before.toString(), totalColl)

    const price = await priceFeed.getPrice()

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Erin attempts to redeem 400 LUSD
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(dec(400, 18), price, 0)

    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      erin.address,
      erin.address
    )

    await troveManager.connect(erin).redeemCollateral(
      dec(400, 18),
      firstRedemptionHint,
      upperPartialRedemptionHint,
      lowerPartialRedemptionHint,
      partialRedemptionHintNICR,
      0, th._100pct
    )

    // Check activePool debt reduced by  400 LUSD
    const activePool_debt_after = await activePool.getSIMDebt()
    assert.equal(activePool_debt_before.sub(activePool_debt_after).toString(), dec(400, 18))

    /* Check ActivePool coll reduced by $400 worth of Ether: at ETH:USD price of $200, this should be 2 ETH.

    therefore remaining ActivePool ETH should be 198 */
    const activePool_coll_after = await activePool.getWSTETH()
    // console.log(`activePool_coll_after: ${activePool_coll_after}`)
    assert.equal(activePool_coll_after.toString(), activePool_coll_before.sub(toBN(dec(2, 18))).toString())

    // Check Erin's balance after
    const erin_balance_after = (await simToken.balanceOf(erin.address)).toString()
    assert.equal(erin_balance_after, '0')
  })

  it("redeemCollateral(): reverts when requested redemption amount exceeds caller's LUSD token balance", async () => {
    const { collateral: W_coll, totalDebt: W_totalDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // Alice opens trove and transfers 400 LUSD to Erin, the would-be redeemer
    const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(400, 18), extraParams: { from: alice } })
    await simToken.connect(alice).transfer(erin.address, dec(400, 18))

    // Check Erin's balance before
    const erin_balance_before = await simToken.balanceOf(erin.address)
    assert.equal(erin_balance_before.toString(), dec(400, 18))

    // B, C, D open trove
    const { collateral: B_coll, totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(590, 18), extraParams: { from: bob } })
    const { collateral: C_coll, totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(1990, 18), extraParams: { from: carol } })
    const { collateral: D_coll, totalDebt: D_totalDebt } = await openTrove({ ICR: toBN(dec(500, 16)), extraLUSDAmount: dec(1990, 18), extraParams: { from: dennis } })

    const totalDebt = W_totalDebt.add(A_totalDebt).add(B_totalDebt).add(C_totalDebt).add(D_totalDebt)
    const totalColl = W_coll.add(A_coll).add(B_coll).add(C_coll).add(D_coll)

    // Get active debt and coll before redemption
    const activePool_debt_before = await activePool.getSIMDebt()
    const activePool_coll_before = (await activePool.getWSTETH()).toString()

    th.assertIsApproximatelyEqual(activePool_debt_before, totalDebt)
    assert.equal(activePool_coll_before, totalColl)

    const price = await priceFeed.getPrice()

    let firstRedemptionHint
    let partialRedemptionHintNICR

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Erin tries to redeem 1000 LUSD
    try {
      ({
        firstRedemptionHint,
        partialRedemptionHintNICR
      } = await hintHelpers.getRedemptionHints(dec(1000, 18), price, 0))

      const { 0: upperPartialRedemptionHint_1, 1: lowerPartialRedemptionHint_1 } = await sortedTroves.findInsertPosition(
        partialRedemptionHintNICR,
        erin.address,
        erin.address
      )

      const redemptionTx = await troveManager.connect(erin).redeemCollateral(
        dec(1000, 18),
        firstRedemptionHint,
        upperPartialRedemptionHint_1,
        lowerPartialRedemptionHint_1,
        partialRedemptionHintNICR,
        0, th._100pct)

      assert.isFalse(1)
    } catch (error) {
      assert.include(error?.toString(), "revert")
      assert.include(error?.toString(), "Requested redemption amount must be <= user's SIM token balance")
    }

    // Erin tries to redeem 401 LUSD
    try {
      ({
        firstRedemptionHint,
        partialRedemptionHintNICR
      } = await hintHelpers.getRedemptionHints('401000000000000000000', price, 0))

      const { 0: upperPartialRedemptionHint_2, 1: lowerPartialRedemptionHint_2 } = await sortedTroves.findInsertPosition(
        partialRedemptionHintNICR,
        erin.address,
        erin.address
      )

      const redemptionTx = await troveManager.connect(erin).redeemCollateral(
        '401000000000000000000', firstRedemptionHint,
        upperPartialRedemptionHint_2,
        lowerPartialRedemptionHint_2,
        partialRedemptionHintNICR,
        0, th._100pct)
      assert.isFalse(1)
    } catch (error) {
      assert.include(error?.toString(), "revert")
      assert.include(error?.toString(), "Requested redemption amount must be <= user's SIM token balance")
    }

    // Erin tries to redeem 239482309 LUSD
    try {
      ({
        firstRedemptionHint,
        partialRedemptionHintNICR
      } = await hintHelpers.getRedemptionHints('239482309000000000000000000', price, 0))

      const { 0: upperPartialRedemptionHint_3, 1: lowerPartialRedemptionHint_3 } = await sortedTroves.findInsertPosition(
        partialRedemptionHintNICR,
        erin.address,
        erin.address
      )

      const redemptionTx = await troveManager.connect(erin).redeemCollateral(
        '239482309000000000000000000', firstRedemptionHint,
        upperPartialRedemptionHint_3,
        lowerPartialRedemptionHint_3,
        partialRedemptionHintNICR,
        0, th._100pct)
      assert.isFalse(1)
    } catch (error) {
      assert.include(error?.toString(), "revert")
      assert.include(error?.toString(), "Requested redemption amount must be <= user's SIM token balance")
    }

    // Erin tries to redeem 2^256 - 1 LUSD
    const maxBytes32 = toBN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

    try {
      ({
        firstRedemptionHint,
        partialRedemptionHintNICR
      } = await hintHelpers.getRedemptionHints('239482309000000000000000000', price, 0))

      const { 0: upperPartialRedemptionHint_4, 1: lowerPartialRedemptionHint_4 } = await sortedTroves.findInsertPosition(
        partialRedemptionHintNICR,
        erin.address,
        erin.address
      )

      const redemptionTx = await troveManager.connect(erin).redeemCollateral(
        maxBytes32, firstRedemptionHint,
        upperPartialRedemptionHint_4,
        lowerPartialRedemptionHint_4,
        partialRedemptionHintNICR,
        0, th._100pct)
      assert.isFalse(1)
    } catch (error) {
      assert.include(error?.toString(), "revert")
      assert.include(error?.toString(), "Requested redemption amount must be <= user's SIM token balance")
    }
  })

  it("redeemCollateral(): value of issued ETH == face value of redeemed LUSD (assuming 1 LUSD has value of $1)", async () => {
    const { collateral: W_coll } = await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    // Alice opens trove and transfers 1000 LUSD each to Erin, Flyn, Graham
    const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(400, 16)), extraLUSDAmount: dec(4990, 18), extraParams: { from: alice } })
    await simToken.connect(alice).transfer(erin.address, dec(1000, 18))
    await simToken.connect(alice).transfer(flyn.address, dec(1000, 18))
    await simToken.connect(alice).transfer(graham.address, dec(1000, 18))

    // B, C, D open trove
    const { collateral: B_coll } = await openTrove({ ICR: toBN(dec(300, 16)), extraLUSDAmount: dec(1590, 18), extraParams: { from: bob } })
    const { collateral: C_coll } = await openTrove({ ICR: toBN(dec(600, 16)), extraLUSDAmount: dec(1090, 18), extraParams: { from: carol } })
    const { collateral: D_coll } = await openTrove({ ICR: toBN(dec(800, 16)), extraLUSDAmount: dec(1090, 18), extraParams: { from: dennis } })

    const totalColl = W_coll.add(A_coll).add(B_coll).add(C_coll).add(D_coll)

    const price = await priceFeed.getPrice()

    const _120_LUSD = '120000000000000000000'
    const _373_LUSD = '373000000000000000000'
    const _950_LUSD = '950000000000000000000'

    // Check Ether in activePool
    const activeETH_0 = await activePool.getWSTETH()
    assert.equal(activeETH_0, totalColl.toString());

    let firstRedemptionHint
    let partialRedemptionHintNICR


    // Erin redeems 120 LUSD
    ({
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(_120_LUSD, price, 0))

    const { 0: upperPartialRedemptionHint_1, 1: lowerPartialRedemptionHint_1 } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      erin.address,
      erin.address
    )

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    const redemption_1 = await troveManager.connect(erin).redeemCollateral(
      _120_LUSD,
      firstRedemptionHint,
      upperPartialRedemptionHint_1,
      lowerPartialRedemptionHint_1,
      partialRedemptionHintNICR,
      0, th._100pct)

    // assert.isTrue(redemption_1.receipt.status);

    /* 120 LUSD redeemed.  Expect $120 worth of ETH removed. At ETH:USD price of $200,
    ETH removed = (120/200) = 0.6 ETH
    Total active ETH = 280 - 0.6 = 279.4 ETH */

    const activeETH_1 = await activePool.getWSTETH()
    assert.equal(activeETH_1.toString(), activeETH_0.sub(toBN(_120_LUSD).mul(mv._1e18BN).div(price)).toString());

    // Flyn redeems 373 LUSD
    ({
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(_373_LUSD, price, 0))

    const { 0: upperPartialRedemptionHint_2, 1: lowerPartialRedemptionHint_2 } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      flyn.address,
      flyn.address
    )

    const redemption_2 = await troveManager.connect(flyn).redeemCollateral(
      _373_LUSD,
      firstRedemptionHint,
      upperPartialRedemptionHint_2,
      lowerPartialRedemptionHint_2,
      partialRedemptionHintNICR,
      0, th._100pct)

    // assert.isTrue(redemption_2.receipt.status);

    /* 373 LUSD redeemed.  Expect $373 worth of ETH removed. At ETH:USD price of $200,
    ETH removed = (373/200) = 1.865 ETH
    Total active ETH = 279.4 - 1.865 = 277.535 ETH */
    const activeETH_2 = await activePool.getWSTETH()
    assert.equal(activeETH_2.toString(), activeETH_1.sub(toBN(_373_LUSD).mul(mv._1e18BN).div(price)).toString());

    // Graham redeems 950 LUSD
    ({
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(_950_LUSD, price, 0))

    const { 0: upperPartialRedemptionHint_3, 1: lowerPartialRedemptionHint_3 } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      graham.address,
      graham.address
    )

    const redemption_3 = await troveManager.connect(graham).redeemCollateral(
      _950_LUSD,
      firstRedemptionHint,
      upperPartialRedemptionHint_3,
      lowerPartialRedemptionHint_3,
      partialRedemptionHintNICR,
      0, th._100pct)

    // assert.isTrue(redemption_3.receipt.status);

    /* 950 LUSD redeemed.  Expect $950 worth of ETH removed. At ETH:USD price of $200,
    ETH removed = (950/200) = 4.75 ETH
    Total active ETH = 277.535 - 4.75 = 272.785 ETH */
    const activeETH_3 = (await activePool.getWSTETH()).toString()
    assert.equal(activeETH_3.toString(), activeETH_2.sub(toBN(_950_LUSD).mul(mv._1e18BN).div(price)).toString());
  })

  // it doesn’t make much sense as there’s now min debt enforced and at least one trove must remain active
  // the only way to test it is before any trove is opened
  it("redeemCollateral(): reverts if there is zero outstanding system debt", async () => {
    // --- SETUP --- illegally mint LUSD to Bob
    await simToken.unprotectedMint(bob.address, dec(100, 18))

    assert.equal((await simToken.balanceOf(bob.address)).toString(), dec(100, 18))

    const price = await priceFeed.getPrice()

    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(dec(100, 18), price, 0)

    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      bob.address,
      bob.address
    )

    // Bob tries to redeem his illegally obtained LUSD
    try {
      const redemptionTx = await troveManager.connect(bob).redeemCollateral(
        dec(100, 18),
        firstRedemptionHint,
        upperPartialRedemptionHint,
        lowerPartialRedemptionHint,
        partialRedemptionHintNICR,
        0, th._100pct)
    } catch (error) {
      assert.include(error?.toString(), "VM Exception while processing transaction")
    }

    // assert.isFalse(1);
  })

  it("redeemCollateral(): reverts if caller's tries to redeem more than the outstanding system debt", async () => {
    // --- SETUP --- illegally mint LUSD to Bob
    await simToken.unprotectedMint(bob.address, '101000000000000000000')

    assert.equal((await simToken.balanceOf(bob.address)).toString(), '101000000000000000000')

    const { collateral: C_coll, totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(1000, 16)), extraLUSDAmount: dec(40, 18), extraParams: { from: carol } })
    const { collateral: D_coll, totalDebt: D_totalDebt } = await openTrove({ ICR: toBN(dec(1000, 16)), extraLUSDAmount: dec(40, 18), extraParams: { from: dennis } })

    const totalDebt = C_totalDebt.add(D_totalDebt)
    th.assertIsApproximatelyEqual(await activePool.getSIMDebt(), totalDebt)

    const price = await priceFeed.getPrice()
    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints('101000000000000000000', price, 0)

    const { 0: upperPartialRedemptionHint, 1: lowerPartialRedemptionHint } = await sortedTroves.findInsertPosition(
      partialRedemptionHintNICR,
      bob.address,
      bob.address
    )

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // Bob attempts to redeem his ill-gotten 101 LUSD, from a system that has 100 LUSD outstanding debt
    try {
      const redemptionTx = await troveManager.connect(bob).redeemCollateral(
        totalDebt.add(toBN(dec(100, 18))),
        firstRedemptionHint,
        upperPartialRedemptionHint,
        lowerPartialRedemptionHint,
        partialRedemptionHintNICR,
        0, th._100pct)
    } catch (error) {
      assert.include(error?.toString(), "VM Exception while processing transaction")
    }
  })

  // Redemption fees 
  it("redeemCollateral(): a redemption made when base rate is zero increases the base rate", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // Check baseRate == 0
    assert.equal((await troveManager.baseRate()).toString(), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    const A_balanceBefore = await simToken.balanceOf(A.address)

    await th.redeemCollateral(A, contracts, dec(10, 18), GAS_PRICE)

    // Check A's balance has decreased by 10 LUSD
    assert.equal((await simToken.balanceOf(A.address)).toString(), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check baseRate is now non-zero
    assert.isTrue((await troveManager.baseRate()).gt(toBN('0')))
  })

  // todo ve
  /*it("redeemCollateral(): a redemption made when base rate is non-zero increases the base rate, for negligible time passed", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // Check baseRate == 0
    assert.equal(await troveManager.baseRate(), '0')

    const A_balanceBefore = await simToken.balanceOf(A.address)
    const B_balanceBefore = await simToken.balanceOf(B)

    // A redeems 10 LUSD
    const redemptionTx_A = await th.redeemCollateralAndGetTxObject(A, contracts, dec(10, 18), GAS_PRICE)
    const timeStamp_A = await th.getTimestampFromTx(redemptionTx_A, web3)

    // Check A's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(A.address), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check baseRate is now non-zero
    const baseRate_1 = await troveManager.baseRate()
    assert.isTrue(baseRate_1.gt(toBN('0')))

    // B redeems 10 LUSD
    const redemptionTx_B = await th.redeemCollateralAndGetTxObject(B, contracts, dec(10, 18), GAS_PRICE)
    const timeStamp_B = await th.getTimestampFromTx(redemptionTx_B, web3)

    // Check B's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(B), B_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check negligible time difference (< 1 minute) between txs
    assert.isTrue(Number(timeStamp_B) - Number(timeStamp_A) < 60)

    const baseRate_2 = await troveManager.baseRate()

    // Check baseRate has again increased
    assert.isTrue(baseRate_2.gt(baseRate_1))
  })*/

  it("redeemCollateral(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation [ @skip-on-coverage ]", async () => {
    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    const A_balanceBefore = await simToken.balanceOf(A.address)

    // A redeems 10 LUSD
    await th.redeemCollateral(A, contracts, dec(10, 18), GAS_PRICE)

    // Check A's balance has decreased by 10 LUSD
    assert.equal(A_balanceBefore.sub(await simToken.balanceOf(A.address)).toString(), dec(10, 18))

    // Check baseRate is now non-zero
    const baseRate_1 = await troveManager.baseRate()
    assert.isTrue(baseRate_1.gt(toBN('0')))

    const lastFeeOpTime_1 = await troveManager.lastFeeOperationTime()

    // 45 seconds pass
    th.fastForwardTime(45)

    // Borrower A triggers a fee
    await th.redeemCollateral(A, contracts, dec(1, 18), GAS_PRICE)

    const lastFeeOpTime_2 = await troveManager.lastFeeOperationTime()

    // Check that the last fee operation time did not update, as borrower A's 2nd redemption occured
    // since before minimum interval had passed 
    assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))

    // 15 seconds passes
    await th.fastForwardTime(15)

    // Check that now, at least one hour has passed since lastFeeOpTime_1
    const timeNow = await th.getLatestBlockTimestamp()
    assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(60))

    // Borrower A triggers a fee
    await th.redeemCollateral(A, contracts, dec(1, 18), GAS_PRICE)

    const lastFeeOpTime_3 = await troveManager.lastFeeOperationTime()

    // Check that the last fee operation time DID update, as A's 2rd redemption occured
    // after minimum interval had passed 
    assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
  })

  // todo ve
  /*it("redeemCollateral(): a redemption made at zero base rate send a non-zero ETHFee to LQTY staking contract", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // Check baseRate == 0
    assert.equal(await troveManager.baseRate(), '0')

    // Check LQTY Staking contract balance before is zero
    const lqtyStakingBalance_Before = await web3.eth.getBalance(lqtyStaking.address)
    assert.equal(lqtyStakingBalance_Before, '0')

    const A_balanceBefore = await simToken.balanceOf(A.address)

    // A redeems 10 LUSD
    await th.redeemCollateral(A, contracts, dec(10, 18), GAS_PRICE)

    // Check A's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(A.address), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check baseRate is now non-zero
    const baseRate_1 = await troveManager.baseRate()
    assert.isTrue(baseRate_1.gt(toBN('0')))

    // Check LQTY Staking contract balance after is non-zero
    const lqtyStakingBalance_After = toBN(await web3.eth.getBalance(lqtyStaking.address))
    assert.isTrue(lqtyStakingBalance_After.gt(toBN('0')))
  })

  it("redeemCollateral(): a redemption made at zero base increases the ETH-fees-per-LQTY-staked in LQTY Staking contract", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // Check baseRate == 0
    assert.equal(await troveManager.baseRate(), '0')

    // Check LQTY Staking ETH-fees-per-LQTY-staked before is zero
    const F_ETH_Before = await lqtyStaking.F_ETH()
    assert.equal(F_ETH_Before, '0')

    const A_balanceBefore = await simToken.balanceOf(A.address)

    // A redeems 10 LUSD
    await th.redeemCollateral(A, contracts, dec(10, 18), GAS_PRICE)

    // Check A's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(A.address), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check baseRate is now non-zero
    const baseRate_1 = await troveManager.baseRate()
    assert.isTrue(baseRate_1.gt(toBN('0')))

    // Check LQTY Staking ETH-fees-per-LQTY-staked after is non-zero
    const F_ETH_After = await lqtyStaking.F_ETH()
    assert.isTrue(F_ETH_After.gt('0'))
  })

  it("redeemCollateral(): a redemption made at a non-zero base rate send a non-zero ETHFee to LQTY staking contract", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // Check baseRate == 0
    assert.equal(await troveManager.baseRate(), '0')

    const A_balanceBefore = await simToken.balanceOf(A.address)
    const B_balanceBefore = await simToken.balanceOf(B)

    // A redeems 10 LUSD
    await th.redeemCollateral(A, contracts, dec(10, 18), GAS_PRICE)

    // Check A's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(A.address), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check baseRate is now non-zero
    const baseRate_1 = await troveManager.baseRate()
    assert.isTrue(baseRate_1.gt(toBN('0')))

    const lqtyStakingBalance_Before = toBN(await web3.eth.getBalance(lqtyStaking.address))

    // B redeems 10 LUSD
    await th.redeemCollateral(B, contracts, dec(10, 18), GAS_PRICE)

    // Check B's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(B), B_balanceBefore.sub(toBN(dec(10, 18))).toString())

    const lqtyStakingBalance_After = toBN(await web3.eth.getBalance(lqtyStaking.address))

    // check LQTY Staking balance has increased
    assert.isTrue(lqtyStakingBalance_After.gt(lqtyStakingBalance_Before))
  })

  it("redeemCollateral(): a redemption made at a non-zero base rate increases ETH-per-LQTY-staked in the staking contract", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    // Check baseRate == 0
    assert.equal(await troveManager.baseRate(), '0')

    const A_balanceBefore = await simToken.balanceOf(A.address)
    const B_balanceBefore = await simToken.balanceOf(B)

    // A redeems 10 LUSD
    await th.redeemCollateral(A, contracts, dec(10, 18), GAS_PRICE)

    // Check A's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(A.address), A_balanceBefore.sub(toBN(dec(10, 18))).toString())

    // Check baseRate is now non-zero
    const baseRate_1 = await troveManager.baseRate()
    assert.isTrue(baseRate_1.gt(toBN('0')))

    // Check LQTY Staking ETH-fees-per-LQTY-staked before is zero
    const F_ETH_Before = await lqtyStaking.F_ETH()

    // B redeems 10 LUSD
    await th.redeemCollateral(B, contracts, dec(10, 18), GAS_PRICE)

    // Check B's balance has decreased by 10 LUSD
    assert.equal(await simToken.balanceOf(B), B_balanceBefore.sub(toBN(dec(10, 18))).toString())

    const F_ETH_After = await lqtyStaking.F_ETH()

    // check LQTY Staking balance has increased
    assert.isTrue(F_ETH_After.gt(F_ETH_Before))
  })

  it("redeemCollateral(): a redemption sends the ETH remainder (ETHDrawn - ETHFee) to the redeemer", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    const { totalDebt: W_totalDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: whale } })

    const { totalDebt: A_totalDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    const { totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    const { totalDebt: C_totalDebt } = await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })
    const totalDebt = W_totalDebt.add(A_totalDebt).add(B_totalDebt).add(C_totalDebt)

    const A_balanceBefore = toBN(await web3.eth.getBalance(A))

    // Confirm baseRate before redemption is 0
    const baseRate = await troveManager.baseRate()
    assert.equal(baseRate, '0')

    // Check total LUSD supply
    const activeLUSD = await activePool.getSIMDebt()
    const defaultLUSD = await defaultPool.getSIMDebt()

    const totalLUSDSupply = activeLUSD.add(defaultLUSD)
    th.assertIsApproximatelyEqual(totalLUSDSupply, totalDebt)

    // A redeems 9 LUSD
    const redemptionAmount = toBN(dec(9, 18))
    const gasUsed = await th.redeemCollateral(A, contracts, redemptionAmount, GAS_PRICE)

    /!*
    At ETH:USD price of 200:
    ETHDrawn = (9 / 200) = 0.045 ETH
    ETHfee = (0.005 + (1/2) *( 9/260)) * ETHDrawn = 0.00100384615385 ETH
    ETHRemainder = 0.045 - 0.001003... = 0.0439961538462
    *!/

    const A_balanceAfter = toBN(await web3.eth.getBalance(A))

    // check A's ETH balance has increased by 0.045 ETH 
    const price = await priceFeed.getPrice()
    const ETHDrawn = redemptionAmount.mul(mv._1e18BN).div(price)
    th.assertIsApproximatelyEqual(
      A_balanceAfter.sub(A_balanceBefore),
      ETHDrawn.sub(
        toBN(dec(5, 15)).add(redemptionAmount.mul(mv._1e18BN).div(totalDebt).div(toBN(2)))
          .mul(ETHDrawn).div(mv._1e18BN)
      ).sub(toBN(gasUsed * GAS_PRICE)), // substract gas used for troveManager.redeemCollateral from expected received ETH
      100000
    )
  })

  it("redeemCollateral(): a full redemption (leaving trove with 0 debt), closes the trove", async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    const { netDebt: W_netDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraLUSDAmount: dec(10000, 18), extraParams: { from: whale } })

    const { netDebt: A_netDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })
    const { netDebt: D_netDebt } = await openTrove({ ICR: toBN(dec(280, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: D } })
    const redemptionAmount = A_netDebt.add(B_netDebt).add(C_netDebt).add(toBN(dec(10, 18)))

    const A_balanceBefore = toBN(await web3.eth.getBalance(A))
    const B_balanceBefore = toBN(await web3.eth.getBalance(B))
    const C_balanceBefore = toBN(await web3.eth.getBalance(C))

    // whale redeems 360 LUSD.  Expect this to fully redeem A, B, C, and partially redeem D.
    await th.redeemCollateral(whale, contracts, redemptionAmount, GAS_PRICE)

    // Check A, B, C have been closed
    assert.isFalse(await sortedTroves.contains(A.address))
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isFalse(await sortedTroves.contains(C.address))

    // Check D remains active
    assert.isTrue(await sortedTroves.contains(D.address))
  })

  const redeemCollateral3Full1Partial = async () => {
    // time fast-forwards 1 year, and multisig stakes 1 LQTY
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
    await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
    await lqtyStaking.stake(dec(1, 18), { from: multisig })

    const { netDebt: W_netDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraLUSDAmount: dec(10000, 18), extraParams: { from: whale } })

    const { netDebt: A_netDebt, collateral: A_coll } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    const { netDebt: B_netDebt, collateral: B_coll } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    const { netDebt: C_netDebt, collateral: C_coll } = await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })
    const { netDebt: D_netDebt } = await openTrove({ ICR: toBN(dec(280, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: D } })
    const redemptionAmount = A_netDebt.add(B_netDebt).add(C_netDebt).add(toBN(dec(10, 18)))

    const A_balanceBefore = toBN(await web3.eth.getBalance(A))
    const B_balanceBefore = toBN(await web3.eth.getBalance(B))
    const C_balanceBefore = toBN(await web3.eth.getBalance(C))
    const D_balanceBefore = toBN(await web3.eth.getBalance(D))

    const A_collBefore = await troveManager.getTroveColl(A)
    const B_collBefore = await troveManager.getTroveColl(B)
    const C_collBefore = await troveManager.getTroveColl(C)
    const D_collBefore = await troveManager.getTroveColl(D)

    // Confirm baseRate before redemption is 0
    const baseRate = await troveManager.baseRate()
    assert.equal(baseRate, '0')

    // whale redeems LUSD.  Expect this to fully redeem A, B, C, and partially redeem D.
    await th.redeemCollateral(whale, contracts, redemptionAmount, GAS_PRICE)

    // Check A, B, C have been closed
    assert.isFalse(await sortedTroves.contains(A.address))
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isFalse(await sortedTroves.contains(C.address))

    // Check D stays active
    assert.isTrue(await sortedTroves.contains(D.address))
    
    /!*
    At ETH:USD price of 200, with full redemptions from A, B, C:

    ETHDrawn from A = 100/200 = 0.5 ETH --> Surplus = (1-0.5) = 0.5
    ETHDrawn from B = 120/200 = 0.6 ETH --> Surplus = (1-0.6) = 0.4
    ETHDrawn from C = 130/200 = 0.65 ETH --> Surplus = (2-0.65) = 1.35
    *!/

    const A_balanceAfter = toBN(await web3.eth.getBalance(A))
    const B_balanceAfter = toBN(await web3.eth.getBalance(B))
    const C_balanceAfter = toBN(await web3.eth.getBalance(C))
    const D_balanceAfter = toBN(await web3.eth.getBalance(D))

    // Check A, B, C’s trove collateral balance is zero (fully redeemed-from troves)
    const A_collAfter = await troveManager.getTroveColl(A)
    const B_collAfter = await troveManager.getTroveColl(B)
    const C_collAfter = await troveManager.getTroveColl(C)
    assert.isTrue(A_collAfter.eq(toBN(0)))
    assert.isTrue(B_collAfter.eq(toBN(0)))
    assert.isTrue(C_collAfter.eq(toBN(0)))

    // check D's trove collateral balances have decreased (the partially redeemed-from trove)
    const D_collAfter = await troveManager.getTroveColl(D)
    assert.isTrue(D_collAfter.lt(D_collBefore))

    // Check A, B, C (fully redeemed-from troves), and D's (the partially redeemed-from trove) balance has not changed
    assert.isTrue(A_balanceAfter.eq(A_balanceBefore))
    assert.isTrue(B_balanceAfter.eq(B_balanceBefore))
    assert.isTrue(C_balanceAfter.eq(C_balanceBefore))
    assert.isTrue(D_balanceAfter.eq(D_balanceBefore))

    // D is not closed, so cannot open trove
    await assertRevert(borrowerOperations.openTrove(th._100pct, 0, ZERO_ADDRESS, ZERO_ADDRESS, { from: D, value: dec(10, 18) }), 'BorrowerOps: Trove is active')

    return {
      A_netDebt, A_coll,
      B_netDebt, B_coll,
      C_netDebt, C_coll,
    }
  }
  */

  it("redeemCollateral(): emits correct debt and coll values in each redeemed trove's TroveUpdated event", async () => {
    const { netDebt: W_netDebt } = await openTrove({ ICR: toBN(dec(20, 18)), extraLUSDAmount: dec(10000, 18), extraParams: { from: whale } })

    const { netDebt: A_netDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    const { netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    const { netDebt: C_netDebt } = await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })
    const { totalDebt: D_totalDebt, collateral: D_coll } = await openTrove({ ICR: toBN(dec(280, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: D } })
    const partialAmount = toBN(dec(15, 18))
    const redemptionAmount = A_netDebt.add(B_netDebt).add(C_netDebt).add(partialAmount)

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // whale redeems LUSD.  Expect this to fully redeem A, B, C, and partially redeem 15 LUSD from D.
    const redemptionTx = await th.redeemCollateralAndGetTxObject(whale, contracts, redemptionAmount.toString(), GAS_PRICE, th._100pct)

    // Check A, B, C have been closed
    assert.isFalse(await sortedTroves.contains(A.address))
    assert.isFalse(await sortedTroves.contains(B.address))
    assert.isFalse(await sortedTroves.contains(C.address))

    // Check D stays active
    assert.isTrue(await sortedTroves.contains(D.address))

    const troveUpdatedEvents = await th.getAllEventsByName(redemptionTx, "TroveUpdated")

    // Get each trove's emitted debt and coll 
    const [A_emittedDebt, A_emittedColl] = th.getDebtAndCollFromTroveUpdatedEvents(troveUpdatedEvents, A.address)
    const [B_emittedDebt, B_emittedColl] = th.getDebtAndCollFromTroveUpdatedEvents(troveUpdatedEvents, B.address)
    const [C_emittedDebt, C_emittedColl] = th.getDebtAndCollFromTroveUpdatedEvents(troveUpdatedEvents, C.address)
    const [D_emittedDebt, D_emittedColl] = th.getDebtAndCollFromTroveUpdatedEvents(troveUpdatedEvents, D.address)

    // Expect A, B, C to have 0 emitted debt and coll, since they were closed
    assert.equal(A_emittedDebt, '0')
    assert.equal(A_emittedColl, '0')
    assert.equal(B_emittedDebt, '0')
    assert.equal(B_emittedColl, '0')
    assert.equal(C_emittedDebt, '0')
    assert.equal(C_emittedColl, '0')

    /* Expect D to have lost 15 debt and (at ETH price of 200) 15/200 = 0.075 ETH.
    So, expect remaining debt = (85 - 15) = 70, and remaining ETH = 1 - 15/200 = 0.925 remaining. */
    const price = await priceFeed.getPrice()
    th.assertIsApproximatelyEqual(D_emittedDebt, D_totalDebt.sub(partialAmount))
    th.assertIsApproximatelyEqual(D_emittedColl, D_coll.sub(partialAmount.mul(mv._1e18BN).div(price)))
  })

  // todo ve
  /*it("redeemCollateral(): a redemption that closes a trove leaves the trove's ETH surplus (collateral - ETH drawn) available for the trove owner to claim", async () => {
    const {
      A_netDebt, A_coll,
      B_netDebt, B_coll,
      C_netDebt, C_coll,
    } = await redeemCollateral3Full1Partial()

    const A_balanceBefore = toBN(await web3.eth.getBalance(A))
    const B_balanceBefore = toBN(await web3.eth.getBalance(B))
    const C_balanceBefore = toBN(await web3.eth.getBalance(C))

    // CollSurplusPool endpoint cannot be called directly
    await assertRevert(collSurplusPool.claimColl(A), 'CollSurplusPool: Caller is not Borrower Operations')

    const A_GAS = th.gasUsed(await borrowerOperations.claimCollateral({ from: A, gasPrice: GAS_PRICE  }))
    const B_GAS = th.gasUsed(await borrowerOperations.claimCollateral({ from: B, gasPrice: GAS_PRICE  }))
    const C_GAS = th.gasUsed(await borrowerOperations.claimCollateral({ from: C, gasPrice: GAS_PRICE  }))

    const A_expectedBalance = A_balanceBefore.sub(toBN(A_GAS * GAS_PRICE))
    const B_expectedBalance = B_balanceBefore.sub(toBN(B_GAS * GAS_PRICE))
    const C_expectedBalance = C_balanceBefore.sub(toBN(C_GAS * GAS_PRICE))

    const A_balanceAfter = toBN(await web3.eth.getBalance(A))
    const B_balanceAfter = toBN(await web3.eth.getBalance(B))
    const C_balanceAfter = toBN(await web3.eth.getBalance(C))

    const price = toBN(await priceFeed.getPrice())

    th.assertIsApproximatelyEqual(A_balanceAfter, A_expectedBalance.add(A_coll.sub(A_netDebt.mul(mv._1e18BN).div(price))))
    th.assertIsApproximatelyEqual(B_balanceAfter, B_expectedBalance.add(B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price))))
    th.assertIsApproximatelyEqual(C_balanceAfter, C_expectedBalance.add(C_coll.sub(C_netDebt.mul(mv._1e18BN).div(price))))
  })

  it("redeemCollateral(): a redemption that closes a trove leaves the trove's ETH surplus (collateral - ETH drawn) available for the trove owner after re-opening trove", async () => {
    const {
      A_netDebt, A_coll: A_collBefore,
      B_netDebt, B_coll: B_collBefore,
      C_netDebt, C_coll: C_collBefore,
    } = await redeemCollateral3Full1Partial()

    const price = await priceFeed.getPrice()
    const A_surplus = A_collBefore.sub(A_netDebt.mul(mv._1e18BN).div(price))
    const B_surplus = B_collBefore.sub(B_netDebt.mul(mv._1e18BN).div(price))
    const C_surplus = C_collBefore.sub(C_netDebt.mul(mv._1e18BN).div(price))

    const { collateral: A_coll } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: A } })
    const { collateral: B_coll } = await openTrove({ ICR: toBN(dec(190, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: B } })
    const { collateral: C_coll } = await openTrove({ ICR: toBN(dec(180, 16)), extraLUSDAmount: dec(100, 18), extraParams: { from: C } })

    const A_collAfter = await troveManager.getTroveColl(A)
    const B_collAfter = await troveManager.getTroveColl(B)
    const C_collAfter = await troveManager.getTroveColl(C)

    assert.isTrue(A_collAfter.eq(A_coll))
    assert.isTrue(B_collAfter.eq(B_coll))
    assert.isTrue(C_collAfter.eq(C_coll))

    const A_balanceBefore = toBN(await web3.eth.getBalance(A))
    const B_balanceBefore = toBN(await web3.eth.getBalance(B))
    const C_balanceBefore = toBN(await web3.eth.getBalance(C))

    const A_GAS = th.gasUsed(await borrowerOperations.claimCollateral({ from: A, gasPrice: GAS_PRICE  }))
    const B_GAS = th.gasUsed(await borrowerOperations.claimCollateral({ from: B, gasPrice: GAS_PRICE  }))
    const C_GAS = th.gasUsed(await borrowerOperations.claimCollateral({ from: C, gasPrice: GAS_PRICE  }))

    const A_expectedBalance = A_balanceBefore.sub(toBN(A_GAS * GAS_PRICE))
    const B_expectedBalance = B_balanceBefore.sub(toBN(B_GAS * GAS_PRICE))
    const C_expectedBalance = C_balanceBefore.sub(toBN(C_GAS * GAS_PRICE))

    const A_balanceAfter = toBN(await web3.eth.getBalance(A))
    const B_balanceAfter = toBN(await web3.eth.getBalance(B))
    const C_balanceAfter = toBN(await web3.eth.getBalance(C))

    th.assertIsApproximatelyEqual(A_balanceAfter, A_expectedBalance.add(A_surplus))
    th.assertIsApproximatelyEqual(B_balanceAfter, B_expectedBalance.add(B_surplus))
    th.assertIsApproximatelyEqual(C_balanceAfter, C_expectedBalance.add(C_surplus))
  })*/

  it('redeemCollateral(): reverts if fee eats up all returned collateral', async () => {
    // --- SETUP ---
    const { lusdAmount } = await openTrove({ ICR: toBN(dec(200, 16)), extraLUSDAmount: dec(1, 24), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: bob } })

    const price = await priceFeed.getPrice()
    assert.equal(price.toString(), dec(200, 18))

    // --- TEST ---

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2)

    // keep redeeming until we get the base rate to the ceiling of 100%
    for (let i = 0; i < 2; i++) {
      // Find hints for redeeming
      const {
        firstRedemptionHint,
        partialRedemptionHintNICR
      } = await hintHelpers.getRedemptionHints(lusdAmount, price, 0)

      // Don't pay for gas, as it makes it easier to calculate the received Ether
      const redemptionTx = await troveManager.connect(alice).redeemCollateral(
        lusdAmount,
        firstRedemptionHint,
        ZERO_ADDRESS,
        alice.address,
        partialRedemptionHintNICR,
        0, th._100pct
      )

      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: bob } })
      await borrowerOperations.connect(alice).adjustTrove(lusdAmount.mul(mv._1e18BN).div(price), th._100pct, 0, lusdAmount, true, alice.address, alice.address)
    }

    const {
      firstRedemptionHint,
      partialRedemptionHintNICR
    } = await hintHelpers.getRedemptionHints(lusdAmount, price, 0)

    await assertRevert(
      troveManager.connect(alice).redeemCollateral(
        lusdAmount,
        firstRedemptionHint,
        ZERO_ADDRESS,
        alice.address,
        partialRedemptionHintNICR,
        0, th._100pct
      ),
      'TroveManager: Fee would eat up all returned collateral'
    )
  })

  it("getPendingSIMDebtReward(): Returns 0 if there is no pending LUSDDebt reward", async () => {
    // Make some troves
    const { totalDebt } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: dec(100, 18), extraParams: { from: defaulter_1 } })

    await openTrove({ ICR: toBN(dec(3, 18)), extraLUSDAmount: dec(20, 18), extraParams: { from: carol } })

    await openTrove({ ICR: toBN(dec(20, 18)), extraLUSDAmount: totalDebt, extraParams: { from: whale } })
    await stabilityPool.connect(whale).provideToSP(totalDebt, ZERO_ADDRESS)

    // Price drops
    await priceFeed.setPrice(dec(100, 18))

    await troveManager.liquidate(defaulter_1.address)

    // Confirm defaulter_1 liquidated
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))

    // Confirm there are no pending rewards from liquidation
    const current_L_LUSDDebt = await troveManager.L_SIMDebt()
    assert.equal(current_L_LUSDDebt.toNumber(), 0)

    const carolSnapshot_L_LUSDDebt = (await troveManager.rewardSnapshots(carol.address))[1]
    assert.equal(carolSnapshot_L_LUSDDebt.toNumber(), 0)

    const carol_PendingLUSDDebtReward = await troveManager.getPendingSIMDebtReward(carol.address)
    assert.equal(carol_PendingLUSDDebtReward.toNumber(), 0)
  })

  it("getPendingWSTETHReward(): Returns 0 if there is no pending ETH reward", async () => {
    // make some troves
    const { totalDebt } = await openTrove({ ICR: toBN(dec(2, 18)), extraLUSDAmount: dec(100, 18), extraParams: { from: defaulter_1 } })

    await openTrove({ ICR: toBN(dec(3, 18)), extraLUSDAmount: dec(20, 18), extraParams: { from: carol } })

    await openTrove({ ICR: toBN(dec(20, 18)), extraLUSDAmount: totalDebt, extraParams: { from: whale } })
    await stabilityPool.connect(whale).provideToSP(totalDebt, ZERO_ADDRESS)

    // Price drops
    await priceFeed.setPrice(dec(100, 18))

    await troveManager.liquidate(defaulter_1.address)

    // Confirm defaulter_1 liquidated
    assert.isFalse(await sortedTroves.contains(defaulter_1.address))

    // Confirm there are no pending rewards from liquidation
    const current_L_ETH = await troveManager.L_WSTETH()
    assert.equal(current_L_ETH.toNumber(), 0)

    const carolSnapshot_L_ETH = (await troveManager.rewardSnapshots(carol.address))[0]
    assert.equal(carolSnapshot_L_ETH.toNumber(), 0)

    const carol_PendingETHReward = await troveManager.getPendingWSTETHReward(carol.address)
    assert.equal(carol_PendingETHReward.toNumber(), 0)
  })

  // --- computeICR ---

  it("computeICR(): Returns 0 if trove's coll is worth 0", async () => {
    const price = 0
    const coll = dec(1, 'ether')
    const debt = dec(100, 18)

    const ICR = (await troveManager.computeICR(coll, debt, price)).toString()

    assert.equal(ICR, '0')
  })

  it("computeICR(): Returns 2^256-1 for ETH:USD = 100, coll = 1 ETH, debt = 100 LUSD", async () => {
    const price = dec(100, 18)
    const coll = dec(1, 'ether')
    const debt = dec(100, 18)

    const ICR = (await troveManager.computeICR(coll, debt, price)).toString()

    assert.equal(ICR, dec(1, 18))
  })

  it("computeICR(): returns correct ICR for ETH:USD = 100, coll = 200 ETH, debt = 30 LUSD", async () => {
    const price = dec(100, 18)
    const coll = dec(200, 'ether')
    const debt = dec(30, 18)

    const ICR = await troveManager.computeICR(coll, debt, price)

    assert.isAtMost(th.getDifference(ICR, toBN('666666666666666666666')), 1000)
  })

  it("computeICR(): returns correct ICR for ETH:USD = 250, coll = 1350 ETH, debt = 127 LUSD", async () => {
    const price = '250000000000000000000'
    const coll = '1350000000000000000000'
    const debt = '127000000000000000000'

    const ICR = (await troveManager.computeICR(coll, debt, price))

    assert.isAtMost(th.getDifference(ICR, toBN('2657480314960630000000')), 1000000)
  })

  it("computeICR(): returns correct ICR for ETH:USD = 100, coll = 1 ETH, debt = 54321 LUSD", async () => {
    const price = dec(100, 18)
    const coll = dec(1, 'ether')
    const debt = '54321000000000000000000'

    const ICR = await troveManager.computeICR(coll, debt, price)

    assert.isAtMost(th.getDifference(ICR, toBN('1840908672520756')), 1000)
  })


  it("computeICR(): Returns 2^256-1 if trove has non-zero coll and zero debt", async () => {
    const price = dec(100, 18)
    const coll = dec(1, 'ether')
    const debt = 0

    const ICR = ethers.utils.hexlify(await troveManager.computeICR(coll, debt, price))
    const maxBytes32 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

    assert.equal(ICR, maxBytes32)
  })

  // --- checkRecoveryMode ---

  //TCR < 150%
  it("checkRecoveryMode(): Returns true when TCR < 150%", async () => {
    await priceFeed.setPrice(dec(100, 18))

    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: bob } })

    await priceFeed.setPrice('99999999999999999999')

    const TCR = (await th.getTCR(contracts))

    assert.isTrue(TCR.lte(toBN('1500000000000000000')))

    assert.isTrue(await th.checkRecoveryMode(contracts))
  })

  // TCR == 150%
  it("checkRecoveryMode(): Returns false when TCR == 150%", async () => {
    await priceFeed.setPrice(dec(100, 18))

    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: bob } })

    const TCR = (await th.getTCR(contracts))

    assert.equal(TCR.toString(), '1500000000000000000')

    assert.isFalse(await th.checkRecoveryMode(contracts))
  })

  // > 150%
  it("checkRecoveryMode(): Returns false when TCR > 150%", async () => {
    await priceFeed.setPrice(dec(100, 18))

    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: bob } })

    await priceFeed.setPrice('100000000000000000001')

    const TCR = (await th.getTCR(contracts))

    assert.isTrue(TCR.gte(toBN('1500000000000000000')))

    assert.isFalse(await th.checkRecoveryMode(contracts))
  })

  // check 0
  it("checkRecoveryMode(): Returns false when TCR == 0", async () => {
    await priceFeed.setPrice(dec(100, 18))

    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
    await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: bob } })

    await priceFeed.setPrice(0)

    const TCR = (await th.getTCR(contracts)).toString()

    assert.equal(TCR, '0')

    assert.isTrue(await th.checkRecoveryMode(contracts))
  })

  // --- Getters ---

  it("getTroveStake(): Returns stake", async () => {
    const { collateral: A_coll } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: A } })
    const { collateral: B_coll } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: B } })

    const A_Stake = await troveManager.getTroveStake(A.address)
    const B_Stake = await troveManager.getTroveStake(B.address)

    assert.equal(A_Stake, A_coll.toString())
    assert.equal(B_Stake, B_coll.toString())
  })

  it("getTroveColl(): Returns coll", async () => {
    const { collateral: A_coll } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: A } })
    const { collateral: B_coll } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: B } })

    assert.equal(await troveManager.getTroveColl(A.address), A_coll.toString())
    assert.equal(await troveManager.getTroveColl(B.address), B_coll.toString())
  })

  it("getTroveDebt(): Returns debt", async () => {
    const { totalDebt: totalDebtA } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: A } })
    const { totalDebt: totalDebtB } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: B } })

    const A_Debt = await troveManager.getTroveDebt(A.address)
    const B_Debt = await troveManager.getTroveDebt(B.address)

    // Expect debt = requested + 0.5% fee + 50 (due to gas comp)

    assert.equal(A_Debt.toString(), totalDebtA.toString())
    assert.equal(B_Debt.toString(), totalDebtB.toString())
  })

  it("getTroveStatus(): Returns status", async () => {
    const { totalDebt: B_totalDebt } = await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: B } })
    await openTrove({ ICR: toBN(dec(150, 16)), extraLUSDAmount: B_totalDebt, extraParams: { from: A } })

    // to be able to repay:
    await simToken.connect(A).transfer(B.address, B_totalDebt)
    await borrowerOperations.connect(B).closeTrove()

    const A_Status = await troveManager.getTroveStatus(A.address)
    const B_Status = await troveManager.getTroveStatus(B.address)
    const C_Status = await troveManager.getTroveStatus(C.address)

    assert.equal(A_Status.toString(), '1')  // active
    assert.equal(B_Status.toString(), '2')  // closed by user
    assert.equal(C_Status.toString(), '0')  // non-existent
  })

  it("hasPendingRewards(): Returns false it trove is not active", async () => {
    assert.isFalse(await troveManager.hasPendingRewards(alice.address))
  })
})
