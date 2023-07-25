import {MoneyValues, TestHelper} from "../utils/TestHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IContracts, IOpenTroveParams} from "../utils/types";
import {
  ActivePool,
  BorrowerOperationsTester, CollSurplusPool, DefaultPool, HintHelpers,
  PriceFeedMock, SHADYToken, SIMTokenTester,
  SortedTroves, StabilityPool,
  TroveManagerTester
} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {BigNumber} from "ethers";
import {assert} from "hardhat";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = MoneyValues
const timeValues = th.TimeValues


const ZERO = toBN('0')
const ZERO_ADDRESS = th.ZERO_ADDRESS

describe('StabilityPool', async () => {

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
      I:SignerWithAddress,
      erin: SignerWithAddress,
      defaulter_1: SignerWithAddress,
      defaulter_2: SignerWithAddress,
      defaulter_3: SignerWithAddress,
      defaulter_4: SignerWithAddress,
      flyn: SignerWithAddress,
      graham: SignerWithAddress,
      harriet: SignerWithAddress,
      ida: SignerWithAddress,
      freddy: SignerWithAddress,
      greta: SignerWithAddress,
      harry: SignerWithAddress

  let bountyAddress: string, lpRewardsAddress: string, multisig: string

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
  let shadyToken: SHADYToken

  const getOpenTroveLUSDAmount = async (totalDebt: BigNumber) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const openTrove = async (params: IOpenTroveParams) => th.openTrove(contracts, params)
  const assertRevert = th.assertRevert

  describe("Stability Pool Mechanisms", async () => {

    beforeEach(async () => {
      const f = await loadFixture(DeploymentHelper.deployFixture);
      [
        owner, alice, bob, carol, dennis, whale,
        A, B, C, D, E, F, G, H, I, erin,
      ] = f.signers;
      [ defaulter_1, defaulter_2, defaulter_3, defaulter_4] = [F, E, C, D];
      [ flyn, graham, harriet, ida, freddy, greta, harry] = [A, B, C, D, G, H, E]
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
      shadyToken = f.shadyContracts.shadyToken
    })

    // --- provideToSP() ---
    // increases recorded LUSD at Stability Pool
    it("provideToSP(): increases the Stability Pool LUSD balance", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ extraLUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---

      // provideToSP()
      await stabilityPool.connect(alice).provideToSP(200, ZERO_ADDRESS)

      // check LUSD balances after
      const stabilityPool_LUSD_After = await stabilityPool.getTotalSIMDeposits()
      assert.equal(stabilityPool_LUSD_After.toNumber(), 200)
    })

    it("provideToSP(): updates the user's deposit record in StabilityPool", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ extraLUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---
      // check user's deposit record before
      const alice_depositRecord_Before = await stabilityPool.deposits(alice.address)
      assert.equal(alice_depositRecord_Before[0].toNumber(), 0)

      // provideToSP()
      await stabilityPool.connect(alice).provideToSP(200, ZERO_ADDRESS)

      // check user's deposit record after
      const alice_depositRecord_After = (await stabilityPool.deposits(alice.address))[0]
      assert.equal(alice_depositRecord_After.toNumber(), 200)
    })

    it("provideToSP(): reduces the user's LUSD balance by the correct amount", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ extraLUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---
      // get user's deposit record before
      const alice_LUSDBalance_Before = await simToken.balanceOf(alice.address)

      // provideToSP()
      await stabilityPool.connect(alice).provideToSP(200, ZERO_ADDRESS)

      // check user's LUSD balance change
      const alice_LUSDBalance_After = await simToken.balanceOf(alice.address)
      assert.equal(alice_LUSDBalance_Before.sub(alice_LUSDBalance_After).toString(), '200')
    })

    it("provideToSP(): increases totalLUSDDeposits by correct amount", async () => {
      // --- SETUP ---

      // Whale opens Trove with 50 ETH, adds 2000 LUSD to StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(2000, 18), ZERO_ADDRESS)

      const totalLUSDDeposits = await stabilityPool.getTotalSIMDeposits()
      assert.equal(totalLUSDDeposits.toString(), dec(2000, 18))
    })

    it('provideToSP(): Correctly updates user snapshots of accumulated rewards per unit staked', async () => {
      // --- SETUP ---

      // Whale opens Trove and deposits to SP
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      const whaleLUSD = await simToken.balanceOf(whale.address)
      await stabilityPool.connect(whale).provideToSP(whaleLUSD, ZERO_ADDRESS)

      // 2 Troves opened, each withdraws minimum debt
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, } })
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, } })

      // Alice makes Trove and withdraws 100 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(5, 18)), extraParams: { from: alice, value: dec(50, 'ether') } })


      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(dec(105, 18));

      const SPLUSD_Before = await stabilityPool.getTotalSIMDeposits()

      // Troves are closed
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))
      assert.isFalse(await sortedTroves.contains(defaulter_2.address))

      // Confirm SP has decreased
      const SPLUSD_After = await stabilityPool.getTotalSIMDeposits()
      assert.isTrue(SPLUSD_After.lt(SPLUSD_Before))

      // --- TEST ---
      const P_Before = (await stabilityPool.P())
      const S_Before = (await stabilityPool.epochToScaleToSum(0, 0))
      const G_Before = (await stabilityPool.epochToScaleToG(0, 0))
      assert.isTrue(P_Before.gt(toBN('0')))
      assert.isTrue(S_Before.gt(toBN('0')))

      // Check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice.address)
      const alice_snapshot_S_Before = alice_snapshot_Before[0].toString()
      const alice_snapshot_P_Before = alice_snapshot_Before[1].toString()
      const alice_snapshot_G_Before = alice_snapshot_Before[2].toString()
      assert.equal(alice_snapshot_S_Before, '0')
      assert.equal(alice_snapshot_P_Before, '0')
      assert.equal(alice_snapshot_G_Before, '0')

      // Make deposit
      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)

      // Check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice.address)
      const alice_snapshot_S_After = alice_snapshot_After[0].toString()
      const alice_snapshot_P_After = alice_snapshot_After[1].toString()
      const alice_snapshot_G_After = alice_snapshot_After[2].toString()

      assert.equal(alice_snapshot_S_After, S_Before.toString())
      assert.equal(alice_snapshot_P_After, P_Before.toString())
      assert.equal(alice_snapshot_G_After, G_Before.toString())
    })

    it("provideToSP(), multiple deposits: updates user's deposit and snapshots", async () => {
      // --- SETUP ---
      // Whale opens Trove and deposits to SP
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      const whaleLUSD = await simToken.balanceOf(whale.address)
      await stabilityPool.connect(whale).provideToSP(whaleLUSD, ZERO_ADDRESS)

      // 3 Troves opened. Two users withdraw 160 LUSD each
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, value: dec(50, 'ether') } })
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, value: dec(50, 'ether') } })
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_3, value: dec(50, 'ether') } })

      // --- TEST ---

      // Alice makes deposit #1: 150 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(250, 18)), ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(150, 18), ZERO_ADDRESS)

      const alice_Snapshot_0 = await stabilityPool.depositSnapshots(alice.address)
      const alice_Snapshot_S_0 = alice_Snapshot_0[0]
      const alice_Snapshot_P_0 = alice_Snapshot_0[1]
      assert.equal(alice_Snapshot_S_0.toNumber(), 0)
      assert.equal(alice_Snapshot_P_0.toString(), '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 users with Trove with 180 LUSD drawn are closed
      await troveManager.liquidate(defaulter_1.address)  // 180 LUSD closed
      await troveManager.liquidate(defaulter_2.address) // 180 LUSD closed

      const alice_compoundedDeposit_1 = await stabilityPool.getCompoundedSIMDeposit(alice.address)

      // Alice makes deposit #2
      const alice_topUp_1 = toBN(dec(100, 18))
      await stabilityPool.connect(alice).provideToSP(alice_topUp_1, ZERO_ADDRESS)

      const alice_newDeposit_1 = ((await stabilityPool.deposits(alice.address))[0]).toString()
      assert.equal(alice_compoundedDeposit_1.add(alice_topUp_1).toString(), alice_newDeposit_1)

      // get system reward terms
      const P_1 = await stabilityPool.P()
      const S_1 = await stabilityPool.epochToScaleToSum(0, 0)
      assert.isTrue(P_1.lt(toBN(dec(1, 18))))
      assert.isTrue(S_1.gt(toBN('0')))

      // check Alice's new snapshot is correct
      const alice_Snapshot_1 = await stabilityPool.depositSnapshots(alice.address)
      const alice_Snapshot_S_1 = alice_Snapshot_1[0]
      const alice_Snapshot_P_1 = alice_Snapshot_1[1]
      assert.isTrue(alice_Snapshot_S_1.eq(S_1))
      assert.isTrue(alice_Snapshot_P_1.eq(P_1))

      // Bob withdraws LUSD and deposits to StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await stabilityPool.connect(alice).provideToSP(dec(427, 18), ZERO_ADDRESS)

      // Defaulter 3 Trove is closed
      await troveManager.liquidate(defaulter_3.address)

      const alice_compoundedDeposit_2 = await stabilityPool.getCompoundedSIMDeposit(alice.address)

      const P_2 = await stabilityPool.P()
      const S_2 = await stabilityPool.epochToScaleToSum(0, 0)
      assert.isTrue(P_2.lt(P_1))
      assert.isTrue(S_2.gt(S_1))

      // Alice makes deposit #3:  100LUSD
      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)

      // check Alice's new snapshot is correct
      const alice_Snapshot_2 = await stabilityPool.depositSnapshots(alice.address)
      const alice_Snapshot_S_2 = alice_Snapshot_2[0]
      const alice_Snapshot_P_2 = alice_Snapshot_2[1]
      assert.isTrue(alice_Snapshot_S_2.eq(S_2))
      assert.isTrue(alice_Snapshot_P_2.eq(P_2))
    })

    it("provideToSP(): reverts if user tries to provide more than their LUSD balance", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice, value: dec(50, 'ether') } })
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob, value: dec(50, 'ether') } })
      const aliceLUSDbal = await simToken.balanceOf(alice.address)
      const bobLUSDbal = await simToken.balanceOf(bob.address)

      // Alice, attempts to deposit 1 wei more than her balance

      const aliceTxPromise = stabilityPool.connect(alice).provideToSP(aliceLUSDbal.add(toBN(1)), ZERO_ADDRESS)
      await assertRevert(aliceTxPromise, "revert")

      // Bob, attempts to deposit 235534 more than his balance

      const bobTxPromise = stabilityPool.connect(bob).provideToSP(bobLUSDbal.add(toBN(dec(235534, 18))), ZERO_ADDRESS)
      await assertRevert(bobTxPromise, "revert")
    })

    it("provideToSP(): reverts if user tries to provide 2^256-1 LUSD, which exceeds their balance", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice, value: dec(50, 'ether') } })
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob, value: dec(50, 'ether') } })

      const maxBytes32 = toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

      // Alice attempts to deposit 2^256-1 LUSD
      try {
        await stabilityPool.connect(alice).provideToSP(maxBytes32, ZERO_ADDRESS)
        assert.isFalse(1)
      } catch (error) {
        assert.include(error?.toString(), "revert")
      }
    })

    /*it("provideToSP(): reverts if cannot receive ETH Gain", async () => {
      // --- SETUP ---
      // Whale deposits 1850 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })
      await stabilityPool.provideToSP(dec(1850, 18), ZERO_ADDRESS, { from: whale })

      // Defaulter Troves opened
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      const nonPayable = await NonPayable.new()
      await simToken.transfer(nonPayable.address, dec(250, 18), { from: whale })

      // NonPayable makes deposit #1: 150 LUSD
      const txData1 = th.getTransactionData('provideToSP(uint256,address)', [web3.utils.toHex(dec(150, 18)), frontEnd_1])
      const tx1 = await nonPayable.forward(stabilityPool.address, txData1)

      const gain_0 = await stabilityPool.getDepositorWSTETHGain(nonPayable.address)
      assert.isTrue(gain_0.eq(toBN(0)), 'NonPayable should not have accumulated gains')

      // price drops: defaulters' Troves fall below MCR, nonPayable and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 defaulters are closed
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)

      const gain_1 = await stabilityPool.getDepositorWSTETHGain(nonPayable.address)
      assert.isTrue(gain_1.gt(toBN(0)), 'NonPayable should have some accumulated gains')

      // NonPayable tries to make deposit #2: 100LUSD (which also attempts to withdraw ETH gain)
      const txData2 = th.getTransactionData('provideToSP(uint256,address)', [web3.utils.toHex(dec(100, 18)), frontEnd_1])
      await th.assertRevert(nonPayable.forward(stabilityPool.address, txData2), 'StabilityPool: sending ETH failed')
    })*/

    it("provideToSP(): doesn't impact other users' deposits or ETH gains", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.connect(alice).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(2000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(3000, 18), ZERO_ADDRESS)

      // D opens a trove
      await openTrove({ extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Would-be defaulters open troves
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))
      assert.isFalse(await sortedTroves.contains(defaulter_2.address))

      const alice_LUSDDeposit_Before = (await stabilityPool.getCompoundedSIMDeposit(alice.address)).toString()
      const bob_LUSDDeposit_Before = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
      const carol_LUSDDeposit_Before = (await stabilityPool.getCompoundedSIMDeposit(carol.address)).toString()

      const alice_ETHGain_Before = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_Before = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()
      const carol_ETHGain_Before = (await stabilityPool.getDepositorWSTETHGain(carol.address)).toString()

      //check non-zero LUSD and ETHGain in the Stability Pool
      const LUSDinSP = await stabilityPool.getTotalSIMDeposits()
      const ETHinSP = await stabilityPool.getWSTETH()
      assert.isTrue(LUSDinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))

      // D makes an SP deposit
      await stabilityPool.connect(dennis).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      assert.equal((await stabilityPool.getCompoundedSIMDeposit(dennis.address)).toString(), dec(1000, 18))

      const alice_LUSDDeposit_After = (await stabilityPool.getCompoundedSIMDeposit(alice.address)).toString()
      const bob_LUSDDeposit_After = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
      const carol_LUSDDeposit_After = (await stabilityPool.getCompoundedSIMDeposit(carol.address)).toString()

      const alice_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()
      const carol_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(carol.address)).toString()

      // Check compounded deposits and ETH gains for A, B and C have not changed
      assert.equal(alice_LUSDDeposit_Before, alice_LUSDDeposit_After)
      assert.equal(bob_LUSDDeposit_Before, bob_LUSDDeposit_After)
      assert.equal(carol_LUSDDeposit_Before, carol_LUSDDeposit_After)

      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)
      assert.equal(carol_ETHGain_Before, carol_ETHGain_After)
    })

    it("provideToSP(): doesn't impact system debt, collateral or TCR", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.connect(alice).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(2000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(3000, 18), ZERO_ADDRESS)

      // D opens a trove
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Would-be defaulters open troves
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))
      assert.isFalse(await sortedTroves.contains(defaulter_2.address))

      const activeDebt_Before = (await activePool.getSIMDebt()).toString()
      const defaultedDebt_Before = (await defaultPool.getSIMDebt()).toString()
      const activeColl_Before = (await activePool.getWSTETH()).toString()
      const defaultedColl_Before = (await defaultPool.getWSTETH()).toString()
      const TCR_Before = (await th.getTCR(contracts)).toString()

      // D makes an SP deposit
      await stabilityPool.connect(dennis).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      assert.equal((await stabilityPool.getCompoundedSIMDeposit(dennis.address)).toString(), dec(1000, 18))

      const activeDebt_After = (await activePool.getSIMDebt()).toString()
      const defaultedDebt_After = (await defaultPool.getSIMDebt()).toString()
      const activeColl_After = (await activePool.getWSTETH()).toString()
      const defaultedColl_After = (await defaultPool.getWSTETH()).toString()
      const TCR_After = (await th.getTCR(contracts)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)
    })

    it("provideToSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A and B provide to SP
      await stabilityPool.connect(alice).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(2000, 18), ZERO_ADDRESS)

      // D opens a trove
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManager.Troves(whale.address))[0].toString()
      const alice_Debt_Before = (await troveManager.Troves(alice.address))[0].toString()
      const bob_Debt_Before = (await troveManager.Troves(bob.address))[0].toString()
      const carol_Debt_Before = (await troveManager.Troves(carol.address))[0].toString()
      const dennis_Debt_Before = (await troveManager.Troves(dennis.address))[0].toString()

      const whale_Coll_Before = (await troveManager.Troves(whale.address))[1].toString()
      const alice_Coll_Before = (await troveManager.Troves(alice.address))[1].toString()
      const bob_Coll_Before = (await troveManager.Troves(bob.address))[1].toString()
      const carol_Coll_Before = (await troveManager.Troves(carol.address))[1].toString()
      const dennis_Coll_Before = (await troveManager.Troves(dennis.address))[1].toString()

      const whale_ICR_Before = (await troveManager.getCurrentICR(whale.address, price)).toString()
      const alice_ICR_Before = (await troveManager.getCurrentICR(alice.address, price)).toString()
      const bob_ICR_Before = (await troveManager.getCurrentICR(bob.address, price)).toString()
      const carol_ICR_Before = (await troveManager.getCurrentICR(carol.address, price)).toString()
      const dennis_ICR_Before = (await troveManager.getCurrentICR(dennis.address, price)).toString()

      // D makes an SP deposit
      await stabilityPool.connect(dennis).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      assert.equal((await stabilityPool.getCompoundedSIMDeposit(dennis.address)).toString(), dec(1000, 18))

      const whale_Debt_After = (await troveManager.Troves(whale.address))[0].toString()
      const alice_Debt_After = (await troveManager.Troves(alice.address))[0].toString()
      const bob_Debt_After = (await troveManager.Troves(bob.address))[0].toString()
      const carol_Debt_After = (await troveManager.Troves(carol.address))[0].toString()
      const dennis_Debt_After = (await troveManager.Troves(dennis.address))[0].toString()

      const whale_Coll_After = (await troveManager.Troves(whale.address))[1].toString()
      const alice_Coll_After = (await troveManager.Troves(alice.address))[1].toString()
      const bob_Coll_After = (await troveManager.Troves(bob.address))[1].toString()
      const carol_Coll_After = (await troveManager.Troves(carol.address))[1].toString()
      const dennis_Coll_After = (await troveManager.Troves(dennis.address))[1].toString()

      const whale_ICR_After = (await troveManager.getCurrentICR(whale.address, price)).toString()
      const alice_ICR_After = (await troveManager.getCurrentICR(alice.address, price)).toString()
      const bob_ICR_After = (await troveManager.getCurrentICR(bob.address, price)).toString()
      const carol_ICR_After = (await troveManager.getCurrentICR(carol.address, price)).toString()
      const dennis_ICR_After = (await troveManager.getCurrentICR(dennis.address, price)).toString()

      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)
      assert.equal(dennis_Debt_Before, dennis_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)
      assert.equal(dennis_Coll_Before, dennis_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)
      assert.equal(dennis_ICR_Before, dennis_ICR_After)
    })

    it("provideToSP(): doesn't protect the depositor's trove from liquidation", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B provide 100 LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(1000, 18), ZERO_ADDRESS)

      // Confirm Bob has an active trove in the system
      assert.isTrue(await sortedTroves.contains(bob.address))
      assert.equal((await troveManager.getTroveStatus(bob.address)).toString(), '1')  // Confirm Bob's trove status is active

      // Confirm Bob has a Stability deposit
      assert.equal((await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString(), dec(1000, 18))

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Liquidate bob
      await troveManager.liquidate(bob.address)

      // Check Bob's trove has been removed from the system
      assert.isFalse(await sortedTroves.contains(bob.address))
      assert.equal((await troveManager.getTroveStatus(bob.address)).toString(), '3')  // check Bob's trove status was closed by liquidation
    })

    it("provideToSP(): providing 0 LUSD reverts", async () => {
      // --- SETUP ---
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B, C provides 100, 50, 30 LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(50, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30, 18), ZERO_ADDRESS)

      const bob_Deposit_Before = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
      const LUSDinSP_Before = (await stabilityPool.getTotalSIMDeposits()).toString()

      assert.equal(LUSDinSP_Before, dec(180, 18))

      // Bob provides 0 LUSD to the Stability Pool 
      const txPromise_B = stabilityPool.connect(bob).provideToSP(0, ZERO_ADDRESS)
      await th.assertRevert(txPromise_B)
    })

    // --- LQTY functionality ---
    it("provideToSP(), new deposit: when SP > 0, triggers LQTY reward event - increases the sum G", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A provides to SP
      await stabilityPool.connect(A).provideToSP(dec(1000, 18), ZERO_ADDRESS)

      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // B provides to SP
      await stabilityPool.connect(B).provideToSP(dec(1000, 18), ZERO_ADDRESS)

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Expect G has increased from the LQTY reward event triggered
      assert.isTrue(G_After.gt(G_Before))
    })

    it("provideToSP(), new deposit: when SP is empty, doesn't update G", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A provides to SP
      await stabilityPool.connect(A).provideToSP(dec(1000, 18), ZERO_ADDRESS)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A withdraws
      await stabilityPool.connect(A).withdrawFromSP(dec(1000, 18))

      // Check SP is empty
      assert.equal((await stabilityPool.getTotalSIMDeposits()).toString(), '0')

      // Check G is non-zero
      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      assert.isTrue(G_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // B provides to SP
      await stabilityPool.connect(B).provideToSP(dec(1000, 18), ZERO_ADDRESS)

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Expect G has not changed
      assert.isTrue(G_After.eq(G_Before))
    })

    /*it("provideToSP(), new deposit: sets the correct front end tag", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, C, D open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // Check A, B, C D have no front end tags
      const A_tagBefore = await getFrontEndTag(stabilityPool, A)
      const B_tagBefore = await getFrontEndTag(stabilityPool, B)
      const C_tagBefore = await getFrontEndTag(stabilityPool, C)
      const D_tagBefore = await getFrontEndTag(stabilityPool, D)

      assert.equal(A_tagBefore, ZERO_ADDRESS)
      assert.equal(B_tagBefore, ZERO_ADDRESS)
      assert.equal(C_tagBefore, ZERO_ADDRESS)
      assert.equal(D_tagBefore, ZERO_ADDRESS)

      // A, B, C, D provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(4000, 18), ZERO_ADDRESS, { from: D })  // transacts directly, no front end

      // Check A, B, C D have no front end tags
      const A_tagAfter = await getFrontEndTag(stabilityPool, A)
      const B_tagAfter = await getFrontEndTag(stabilityPool, B)
      const C_tagAfter = await getFrontEndTag(stabilityPool, C)
      const D_tagAfter = await getFrontEndTag(stabilityPool, D)

      // Check front end tags are correctly set
      assert.equal(A_tagAfter, frontEnd_1)
      assert.equal(B_tagAfter, frontEnd_2)
      assert.equal(C_tagAfter, frontEnd_3)
      assert.equal(D_tagAfter, ZERO_ADDRESS)
    })*/

    it("provideToSP(), new deposit: depositor does not receive any LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: dec(50, 'ether') } })

      // A, B, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // Get A, B, C LQTY balances before and confirm they're zero
      const A_LQTYBalance_Before = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_Before = await shadyToken.balanceOf(B.address)

      assert.equal(A_LQTYBalance_Before.toString(), '0')
      assert.equal(B_LQTYBalance_Before.toString(), '0')

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A, B provide to SP
      await stabilityPool.connect(A).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(2000, 18), ZERO_ADDRESS)

      // Get A, B, C LQTY balances after, and confirm they're still zero
      const A_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_After = await shadyToken.balanceOf(B.address)

      assert.equal(A_LQTYBalance_After.toString(), '0')
      assert.equal(B_LQTYBalance_After.toString(), '0')
    })

    it("provideToSP(), new deposit after past full withdrawal: depositor does not receive any LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP --- 

      const initialDeposit_A = await simToken.balanceOf(A.address)
      const initialDeposit_B = await simToken.balanceOf(B.address)
      // A, B provide to SP
      await stabilityPool.connect(A).provideToSP(initialDeposit_A, ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(initialDeposit_B, ZERO_ADDRESS)

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // C deposits. A, and B earn LQTY
      await stabilityPool.connect(C).provideToSP(dec(5, 18), ZERO_ADDRESS)

      // Price drops, defaulter is liquidated, A, B and C earn ETH
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      // price bounces back to 200 
      await priceFeed.setPrice(dec(200, 18))

      // A and B fully withdraw from the pool
      await stabilityPool.connect(A).withdrawFromSP(initialDeposit_A)
      await stabilityPool.connect(B).withdrawFromSP(initialDeposit_B)

      // --- TEST --- 

      // Get A, B, C LQTY balances before and confirm they're non-zero
      const A_LQTYBalance_Before = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_Before = await shadyToken.balanceOf(B.address)
      assert.isTrue(A_LQTYBalance_Before.gt(toBN('0')))
      assert.isTrue(B_LQTYBalance_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A, B provide to SP
      await stabilityPool.connect(A).provideToSP(dec(100, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(200, 18), ZERO_ADDRESS)

      // Get A, B, C LQTY balances after, and confirm they have not changed
      const A_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_After = await shadyToken.balanceOf(B.address)

      assert.isTrue(A_LQTYBalance_After.eq(A_LQTYBalance_Before))
      assert.isTrue(B_LQTYBalance_After.eq(B_LQTYBalance_Before))
    })

    /*it("provideToSP(), new eligible deposit: tagged front end receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // D, E, F provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: D })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: F })

      // Get F1, F2, F3 LQTY balances before, and confirm they're zero
      const frontEnd_1_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_1)
      const frontEnd_2_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_2)
      const frontEnd_3_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_3)

      assert.equal(frontEnd_1_LQTYBalance_Before, '0')
      assert.equal(frontEnd_2_LQTYBalance_Before, '0')
      assert.equal(frontEnd_3_LQTYBalance_Before, '0')

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // console.log(`LQTYSupplyCap before: ${await communityIssuance.LQTYSupplyCap()}`)
      // console.log(`totalLQTYIssued before: ${await communityIssuance.totalLQTYIssued()}`)
      // console.log(`LQTY balance of CI before: ${await shadyToken.balanceOf(communityIssuance.address)}`)

      // A, B, C provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: C })

      // console.log(`LQTYSupplyCap after: ${await communityIssuance.LQTYSupplyCap()}`)
      // console.log(`totalLQTYIssued after: ${await communityIssuance.totalLQTYIssued()}`)
      // console.log(`LQTY balance of CI after: ${await shadyToken.balanceOf(communityIssuance.address)}`)

      // Get F1, F2, F3 LQTY balances after, and confirm they have increased
      const frontEnd_1_LQTYBalance_After = await shadyToken.balanceOf(frontEnd_1)
      const frontEnd_2_LQTYBalance_After = await shadyToken.balanceOf(frontEnd_2)
      const frontEnd_3_LQTYBalance_After = await shadyToken.balanceOf(frontEnd_3)

      assert.isTrue(frontEnd_1_LQTYBalance_After.gt(frontEnd_1_LQTYBalance_Before))
      assert.isTrue(frontEnd_2_LQTYBalance_After.gt(frontEnd_2_LQTYBalance_Before))
      assert.isTrue(frontEnd_3_LQTYBalance_After.gt(frontEnd_3_LQTYBalance_Before))
    })

    it("provideToSP(), new eligible deposit: tagged front end's stake increases", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // Get front ends' stakes before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      const deposit_A = dec(1000, 18)
      const deposit_B = dec(2000, 18)
      const deposit_C = dec(3000, 18)

      // A, B, C provide to SP
      await stabilityPool.provideToSP(deposit_A, ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      const F1_Diff = F1_Stake_After.sub(F1_Stake_Before)
      const F2_Diff = F2_Stake_After.sub(F2_Stake_Before)
      const F3_Diff = F3_Stake_After.sub(F3_Stake_Before)

      // Check front ends' stakes have increased by amount equal to the deposit made through them 
      assert.equal(F1_Diff, deposit_A)
      assert.equal(F2_Diff, deposit_B)
      assert.equal(F3_Diff, deposit_C)
    })

    it("provideToSP(), new eligible deposit: tagged front end's snapshots update", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // D opens trove
      await openTrove({ extraLUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP ---

      await stabilityPool.provideToSP(dec(2000, 18), ZERO_ADDRESS, { from: D })

      // fastforward time then  make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)
      await stabilityPool.provideToSP(dec(2000, 18), ZERO_ADDRESS, { from: D })

      // Perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // Get front ends' snapshots before
      for (frontEnd of [ZERO_ADDRESS, frontEnd_2, frontEnd_3]) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends, since S corresponds to ETH gain)
        assert.equal(snapshot[1], '0')  // P 
        assert.equal(snapshot[2], '0')  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }

      const deposit_A = dec(1000, 18)
      const deposit_B = dec(2000, 18)
      const deposit_C = dec(3000, 18)

      // --- TEST ---

      // A, B, C provide to SP
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_A, ZERO_ADDRESS, { from: A })

      const G2 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })

      const G3 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      const frontEnds = [ZERO_ADDRESS, frontEnd_2, frontEnd_3]
      const G_Values = [G1, G2, G3]

      // Map frontEnds to the value of G at time the deposit was made
      frontEndToG = th.zipToObject(frontEnds, G_Values)

      // Get front ends' snapshots after
      for (const [frontEnd, G] of Object.entries(frontEndToG)) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        // Check snapshots are the expected values
        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends)
        assert.isTrue(snapshot[1].eq(P_Before))  // P 
        assert.isTrue(snapshot[2].eq(G))  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }
    })*/

    it("provideToSP(), new deposit: depositor does not receive ETH gains", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers LUSD to A, B
      await simToken.connect(whale).transfer(A.address, dec(100, 18))
      await simToken.connect(whale).transfer(B.address, dec(200, 18))

      // C, D open troves
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await contracts.wstETHMock.balanceOf(A.address)
      const B_ETHBalance_Before = await contracts.wstETHMock.balanceOf(B.address)
      const C_ETHBalance_Before = await contracts.wstETHMock.balanceOf(C.address)
      const D_ETHBalance_Before = await contracts.wstETHMock.balanceOf(D.address)

      // A, B, C, D provide to SP
      const A_GAS_Used = th.gasUsed(await stabilityPool.connect(A).provideToSP(dec(100, 18), ZERO_ADDRESS))
      const B_GAS_Used = th.gasUsed(await stabilityPool.connect(B).provideToSP(dec(200, 18), ZERO_ADDRESS))
      const C_GAS_Used = th.gasUsed(await stabilityPool.connect(C).provideToSP(dec(300, 18), ZERO_ADDRESS))
      const D_GAS_Used = th.gasUsed(await stabilityPool.connect(D).provideToSP(dec(400, 18), ZERO_ADDRESS))


      // ETH balances before minus gas used
      const A_expectedBalance = A_ETHBalance_Before/* - A_GAS_Used*/;
      const B_expectedBalance = B_ETHBalance_Before/* - B_GAS_Used*/;
      const C_expectedBalance = C_ETHBalance_Before/* - C_GAS_Used*/;
      const D_expectedBalance = D_ETHBalance_Before/* - D_GAS_Used*/;


      // Get  ETH balances after
      const A_ETHBalance_After = await contracts.wstETHMock.balanceOf(A.address)
      const B_ETHBalance_After = await contracts.wstETHMock.balanceOf(B.address)
      const C_ETHBalance_After = await contracts.wstETHMock.balanceOf(C.address)
      const D_ETHBalance_After = await contracts.wstETHMock.balanceOf(D.address)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After.toString(), A_expectedBalance.toString())
      assert.equal(B_ETHBalance_After.toString(), B_expectedBalance.toString())
      assert.equal(C_ETHBalance_After.toString(), C_expectedBalance.toString())
      assert.equal(D_ETHBalance_After.toString(), D_expectedBalance.toString())
    })

    it("provideToSP(), new deposit after past full withdrawal: depositor does not receive ETH gains", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers LUSD to A, B
      await simToken.connect(whale).transfer(A.address, dec(1000, 18))
      await simToken.connect(whale).transfer(B.address, dec(1000, 18))

      // C, D open troves
      await openTrove({ extraLUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP ---
      // A, B, C, D provide to SP
      await stabilityPool.connect(A).provideToSP(dec(105, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(105, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(105, 18), ZERO_ADDRESS)
      await stabilityPool.connect(D).provideToSP(dec(105, 18), ZERO_ADDRESS)

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // B deposits. A,B,C,D earn LQTY
      await stabilityPool.connect(B).provideToSP(dec(5, 18), ZERO_ADDRESS)

      // Price drops, defaulter is liquidated, A, B, C, D earn ETH
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      // Price bounces back
      await priceFeed.setPrice(dec(200, 18))

      // A B,C, D fully withdraw from the pool
      await stabilityPool.connect(A).withdrawFromSP(dec(105, 18))
      await stabilityPool.connect(B).withdrawFromSP(dec(105, 18))
      await stabilityPool.connect(C).withdrawFromSP(dec(105, 18))
      await stabilityPool.connect(D).withdrawFromSP(dec(105, 18))

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await contracts.wstETHMock.balanceOf(A.address)
      const B_ETHBalance_Before = await contracts.wstETHMock.balanceOf(B.address)
      const C_ETHBalance_Before = await contracts.wstETHMock.balanceOf(C.address)
      const D_ETHBalance_Before = await contracts.wstETHMock.balanceOf(D.address)

      // A, B, C, D provide to SP
      const A_GAS_Used = th.gasUsed(await stabilityPool.connect(A).provideToSP(dec(100, 18), ZERO_ADDRESS))
      const B_GAS_Used = th.gasUsed(await stabilityPool.connect(B).provideToSP(dec(200, 18), ZERO_ADDRESS))
      const C_GAS_Used = th.gasUsed(await stabilityPool.connect(C).provideToSP(dec(300, 18), ZERO_ADDRESS))
      const D_GAS_Used = th.gasUsed(await stabilityPool.connect(D).provideToSP(dec(400, 18), ZERO_ADDRESS))

      // ETH balances before minus gas used
      const A_expectedBalance = A_ETHBalance_Before/* - A_GAS_Used*/;
      const B_expectedBalance = B_ETHBalance_Before/* - B_GAS_Used*/;
      const C_expectedBalance = C_ETHBalance_Before/* - C_GAS_Used*/;
      const D_expectedBalance = D_ETHBalance_Before/* - D_GAS_Used*/;

      // Get  ETH balances after
      const A_ETHBalance_After = await contracts.wstETHMock.balanceOf(A.address)
      const B_ETHBalance_After = await contracts.wstETHMock.balanceOf(B.address)
      const C_ETHBalance_After = await contracts.wstETHMock.balanceOf(C.address)
      const D_ETHBalance_After = await contracts.wstETHMock.balanceOf(D.address)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After.toString(), A_expectedBalance.toString())
      assert.equal(B_ETHBalance_After.toString(), B_expectedBalance.toString())
      assert.equal(C_ETHBalance_After.toString(), C_expectedBalance.toString())
      assert.equal(D_ETHBalance_After.toString(), D_expectedBalance.toString())
    })

    it("provideToSP(), topup: triggers LQTY reward event - increases the sum G", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C provide to SP
      await stabilityPool.connect(A).provideToSP(dec(100, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(50, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(50, 18), ZERO_ADDRESS)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // B tops up
      await stabilityPool.connect(B).provideToSP(dec(100, 18), ZERO_ADDRESS)

      const G_After = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the LQTY reward event triggered by B's topup
      assert.isTrue(G_After.gt(G_Before))
    })

    /*it("provideToSP(), topup from different front end: doesn't change the front end tag", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // whale transfer to troves D and E
      await simToken.connect(whale).transfer(D.address, dec(100, 18))
      await simToken.connect(whale).transfer(E.address, dec(200, 18))

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })


      // A, B, C, D, E provide to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })
      await stabilityPool.provideToSP(dec(40, 18), ZERO_ADDRESS, { from: D })
      await stabilityPool.provideToSP(dec(50, 18), ZERO_ADDRESS, { from: E })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A, B, C, D, E top up, from different front ends
      await stabilityPool.provideToSP(dec(10, 18), frontEnd_2, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(15, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: D })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: E })

      const frontEndTag_A = (await stabilityPool.deposits(A.address))[1]
      const frontEndTag_B = (await stabilityPool.deposits(B.address))[1]
      const frontEndTag_C = (await stabilityPool.deposits(C.address))[1]
      const frontEndTag_D = (await stabilityPool.deposits(D))[1]
      const frontEndTag_E = (await stabilityPool.deposits(E))[1]

      // Check deposits are still tagged with their original front end
      assert.equal(frontEndTag_A, frontEnd_1)
      assert.equal(frontEndTag_B, frontEnd_2)
      assert.equal(frontEndTag_C, ZERO_ADDRESS)
      assert.equal(frontEndTag_D, frontEnd_1)
      assert.equal(frontEndTag_E, ZERO_ADDRESS)
    })*/

    it("provideToSP(), topup: depositor receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.connect(A).provideToSP(dec(10, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(20, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(30, 18), ZERO_ADDRESS)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get A, B, C LQTY balance before
      const A_LQTYBalance_Before = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_Before = await shadyToken.balanceOf(B.address)
      const C_LQTYBalance_Before = await shadyToken.balanceOf(C.address)

      // A, B, C top up
      await stabilityPool.connect(A).provideToSP(dec(10, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(20, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(30, 18), ZERO_ADDRESS)

      // Get LQTY balance after
      const A_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_After = await shadyToken.balanceOf(B.address)
      const C_LQTYBalance_After = await shadyToken.balanceOf(C.address)

      // Check LQTY Balance of A, B, C has increased
      assert.isTrue(A_LQTYBalance_After.gt(A_LQTYBalance_Before))
      assert.isTrue(B_LQTYBalance_After.gt(B_LQTYBalance_Before))
      assert.isTrue(C_LQTYBalance_After.gt(C_LQTYBalance_Before))
    })

    /*it("provideToSP(), topup: tagged front end receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get front ends' LQTY balance before
      const F1_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_1)
      const F2_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_2)
      const F3_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_3)

      // A, B, C top up  (front end param passed here is irrelevant)
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })  // provides no front end param
      await stabilityPool.provideToSP(dec(20, 18), ZERO_ADDRESS, { from: B })  // provides front end that doesn't match his tag
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C }) // provides front end that matches his tag

      // Get front ends' LQTY balance after
      const F1_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const F2_LQTYBalance_After = await shadyToken.balanceOf(B.address)
      const F3_LQTYBalance_After = await shadyToken.balanceOf(C.address)

      // Check LQTY Balance of front ends has increased
      assert.isTrue(F1_LQTYBalance_After.gt(F1_LQTYBalance_Before))
      assert.isTrue(F2_LQTYBalance_After.gt(F2_LQTYBalance_Before))
      assert.isTrue(F3_LQTYBalance_After.gt(F3_LQTYBalance_Before))
    })

    it("provideToSP(), topup: tagged front end's stake increases", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, D, E, F open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: D })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: F })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get front ends' stake before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      // A, B, C top up  (front end param passed here is irrelevant)
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })  // provides no front end param
      await stabilityPool.provideToSP(dec(20, 18), ZERO_ADDRESS, { from: B })  // provides front end that doesn't match his tag
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C }) // provides front end that matches his tag

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      // Check front ends' stakes have increased
      assert.isTrue(F1_Stake_After.gt(F1_Stake_Before))
      assert.isTrue(F2_Stake_After.gt(F2_Stake_Before))
      assert.isTrue(F3_Stake_After.gt(F3_Stake_Before))
    })

    it("provideToSP(), topup: tagged front end's snapshots update", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(400, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(600, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // D opens trove
      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP ---

      const deposit_A = dec(100, 18)
      const deposit_B = dec(200, 18)
      const deposit_C = dec(300, 18)

      // A, B, C make their initial deposits
      await stabilityPool.provideToSP(deposit_A, ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      // fastforward time then make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      await stabilityPool.provideToSP(await simToken.balanceOf(D), ZERO_ADDRESS, { from: D })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(100, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // Get front ends' snapshots before
      for (frontEnd of [ZERO_ADDRESS, frontEnd_2, frontEnd_3]) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends, since S corresponds to ETH gain)
        assert.equal(snapshot[1], dec(1, 18))  // P 
        assert.equal(snapshot[2], '0')  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }

      // --- TEST ---

      // A, B, C top up their deposits. Grab G at each stage, as it can increase a bit
      // between topups, because some block.timestamp time passes (and LQTY is issued) between ops
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_A, ZERO_ADDRESS, { from: A })

      const G2 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })

      const G3 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      const frontEnds = [ZERO_ADDRESS, frontEnd_2, frontEnd_3]
      const G_Values = [G1, G2, G3]

      // Map frontEnds to the value of G at time the deposit was made
      frontEndToG = th.zipToObject(frontEnds, G_Values)

      // Get front ends' snapshots after
      for (const [frontEnd, G] of Object.entries(frontEndToG)) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        // Check snapshots are the expected values
        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends)
        assert.isTrue(snapshot[1].eq(P_Before))  // P 
        assert.isTrue(snapshot[2].eq(G))  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }
    })*/

    it("provideToSP(): reverts when amount is zero", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({ extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // Whale transfers LUSD to C, D
      await simToken.connect(whale).transfer(C.address, dec(100, 18))
      await simToken.connect(whale).transfer(D.address, dec(100, 18))

      const txPromise_A = stabilityPool.connect(A).provideToSP(0, ZERO_ADDRESS)
      const txPromise_B = stabilityPool.connect(B).provideToSP(0, ZERO_ADDRESS)
      const txPromise_C = stabilityPool.connect(C).provideToSP(0, ZERO_ADDRESS)
      const txPromise_D = stabilityPool.connect(D).provideToSP(0, ZERO_ADDRESS)

      await th.assertRevert(txPromise_A, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_B, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_C, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_D, 'StabilityPool: Amount must be non-zero')
    })

    /*it("provideToSP(): reverts if user is a registered front end", async () => {
      // C, D, E, F open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // C, E, F registers as front end
      await stabilityPool.registerFrontEnd(dec(1, 18), { from: C })
      await stabilityPool.registerFrontEnd(dec(1, 18), { from: E })
      await stabilityPool.registerFrontEnd(dec(1, 18), { from: F })

      const txPromise_C = stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: C })
      const txPromise_E = stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: E })
      const txPromise_F = stabilityPool.provideToSP(dec(10, 18), F, { from: F })
      await th.assertRevert(txPromise_C, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(txPromise_E, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(txPromise_F, "StabilityPool: must not already be a registered front end")

      const txD = await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: D })
      assert.isTrue(txD.receipt.status)
    })

    it("provideToSP(): reverts if provided tag is not a registered front end", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

      const txPromise_C = stabilityPool.provideToSP(dec(10, 18), A, { from: C })  // passes another EOA
      const txPromise_D = stabilityPool.provideToSP(dec(10, 18), troveManager.address, { from: D })
      const txPromise_E = stabilityPool.provideToSP(dec(10, 18), stabilityPool.address, { from: E })
      const txPromise_F = stabilityPool.provideToSP(dec(10, 18), F, { from: F }) // passes itself

      await th.assertRevert(txPromise_C, "StabilityPool: Tag must be a registered front end, or the zero address")
      await th.assertRevert(txPromise_D, "StabilityPool: Tag must be a registered front end, or the zero address")
      await th.assertRevert(txPromise_E, "StabilityPool: Tag must be a registered front end, or the zero address")
      await th.assertRevert(txPromise_F, "StabilityPool: Tag must be a registered front end, or the zero address")
    })*/

    // --- withdrawFromSP ---

    it("withdrawFromSP(): reverts when user has no active deposit", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)

      const alice_initialDeposit = ((await stabilityPool.deposits(alice.address))[0]).toString()
      const bob_initialDeposit = ((await stabilityPool.deposits(bob.address))[0]).toString()

      assert.equal(alice_initialDeposit, dec(100, 18))
      assert.equal(bob_initialDeposit, '0')

      const txAlice = await stabilityPool.connect(alice).withdrawFromSP(dec(100, 18))
      // assert.isTrue(txAlice.receipt.status)


      try {
        const txBob = await stabilityPool.connect(bob).withdrawFromSP(dec(100, 18))
        assert.isFalse(1)
      } catch (err) {
        assert.include(err?.toString(), "revert")
        // TODO: infamous issue #99
        //assert.include(err?.toString(), "User must have a non-zero deposit")

      }
    })

    it("withdrawFromSP(): reverts when amount > 0 and system has an undercollateralized trove", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)

      const alice_initialDeposit = ((await stabilityPool.deposits(alice.address))[0]).toString()
      assert.equal(alice_initialDeposit, dec(100, 18))

      // defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // ETH drops, defaulter is in liquidation range (but not liquidated yet)
      await priceFeed.setPrice(dec(100, 18))

      await th.assertRevert(stabilityPool.connect(alice).withdrawFromSP(dec(100, 18)))
    })

    it("withdrawFromSP(): partial retrieval - retrieves correct LUSD amount and the entire ETH Gain, and updates deposit", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 users with Trove with 170 LUSD drawn are closed
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1.address)  // 170 LUSD closed
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2.address) // 170 LUSD closed

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice LUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedLUSDLoss_A = (liquidatedDebt_1.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedLUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedLUSDLoss_A)
      const compoundedLUSDDeposit_A = await stabilityPool.getCompoundedSIMDeposit(alice.address)

      assert.isAtMost(th.getDifference(expectedCompoundedLUSDDeposit_A, compoundedLUSDDeposit_A), 100000)

      // Alice retrieves part of her entitled LUSD: 9000 LUSD
      await stabilityPool.connect(alice).withdrawFromSP(dec(9000, 18))

      const expectedNewDeposit_A = (compoundedLUSDDeposit_A.sub(toBN(dec(9000, 18))))

      // check Alice's deposit has been updated to equal her compounded deposit minus her withdrawal
      const newDeposit = (await stabilityPool.deposits(alice.address))[0]
      assert.isAtMost(th.getDifference(newDeposit, expectedNewDeposit_A), 100000)

      // Expect Alice has withdrawn all ETH gain
      const alice_pendingETHGain = await stabilityPool.getDepositorWSTETHGain(alice.address)
      assert.equal(alice_pendingETHGain.toNumber(), 0)
    })

    it("withdrawFromSP(): partial retrieval - leaves the correct amount of LUSD in the Stability Pool", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      const SP_LUSD_Before = await stabilityPool.getTotalSIMDeposits()
      assert.equal(SP_LUSD_Before.toString(), dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 users liquidated
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1.address)
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2.address)

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice retrieves part of her entitled LUSD: 9000 LUSD
      await stabilityPool.connect(alice).withdrawFromSP(dec(9000, 18))

      /* Check SP has reduced from 2 liquidations and Alice's withdrawal
      Expect LUSD in SP = (200000 - liquidatedDebt_1 - liquidatedDebt_2 - 9000) */
      const expectedSPLUSD = toBN(dec(200000, 18))
        .sub(toBN(liquidatedDebt_1))
        .sub(toBN(liquidatedDebt_2))
        .sub(toBN(dec(9000, 18)))

      const SP_LUSD_After = await stabilityPool.getTotalSIMDeposits()

      th.assertIsApproximatelyEqual(SP_LUSD_After, expectedSPLUSD)
    })

    it("withdrawFromSP(): full retrieval - leaves the correct amount of LUSD in the Stability Pool", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      const SP_LUSD_Before = await stabilityPool.getTotalSIMDeposits()
      assert.equal(SP_LUSD_Before.toString(), dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 defaulters liquidated
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1.address)
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2.address)

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice LUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedLUSDLoss_A = (liquidatedDebt_1.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedLUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedLUSDLoss_A)
      const compoundedLUSDDeposit_A = await stabilityPool.getCompoundedSIMDeposit(alice.address)

      assert.isAtMost(th.getDifference(expectedCompoundedLUSDDeposit_A, compoundedLUSDDeposit_A), 100000)

      const LUSDinSPBefore = await stabilityPool.getTotalSIMDeposits()

      // Alice retrieves all of her entitled LUSD:
      await stabilityPool.connect(alice).withdrawFromSP(dec(15000, 18))

      const expectedLUSDinSPAfter = LUSDinSPBefore.sub(compoundedLUSDDeposit_A)

      const LUSDinSPAfter = await stabilityPool.getTotalSIMDeposits()
      assert.isAtMost(th.getDifference(expectedLUSDinSPAfter, LUSDinSPAfter), 100000)
    })

    it("withdrawFromSP(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero ETH", async () => {
      // --- SETUP ---
      // Whale deposits 1850 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(18500, 18), ZERO_ADDRESS)

      // 2 defaulters open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // defaulters liquidated
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)

      // Alice retrieves all of her entitled LUSD:
      await stabilityPool.connect(alice).withdrawFromSP(dec(15000, 18))
      assert.equal((await stabilityPool.getDepositorWSTETHGain(alice.address)).toNumber(), 0)

      // Alice makes second deposit
      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      assert.equal((await stabilityPool.getDepositorWSTETHGain(alice.address)).toNumber(), 0)

      const ETHinSP_Before = (await stabilityPool.getWSTETH()).toString()

      // Alice attempts second withdrawal
      await stabilityPool.connect(alice).withdrawFromSP(dec(10000, 18))
      assert.equal((await stabilityPool.getDepositorWSTETHGain(alice.address)).toNumber(), 0)

      // Check ETH in pool does not change
      const ETHinSP_1 = (await stabilityPool.getWSTETH()).toString()
      assert.equal(ETHinSP_Before, ETHinSP_1)

      // Third deposit
      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      assert.equal((await stabilityPool.getDepositorWSTETHGain(alice.address)).toNumber(), 0)

      // Alice attempts third withdrawal (this time, frm SP to Trove)
      const txPromise_A = stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)
      await th.assertRevert(txPromise_A)
    })

    it("withdrawFromSP(): it correctly updates the user's LUSD and ETH snapshots of entitled reward per unit staked", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // 2 defaulters open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice.address)
      const alice_snapshot_S_Before = alice_snapshot_Before[0].toString()
      const alice_snapshot_P_Before = alice_snapshot_Before[1].toString()
      assert.equal(alice_snapshot_S_Before, '0')
      assert.equal(alice_snapshot_P_Before, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // 2 defaulters liquidated
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address);

      // Alice retrieves part of her entitled LUSD: 9000 LUSD
      await stabilityPool.connect(alice).withdrawFromSP(dec(9000, 18))

      const P = (await stabilityPool.P()).toString()
      const S = (await stabilityPool.epochToScaleToSum(0, 0)).toString()
      // check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice.address)
      const alice_snapshot_S_After = alice_snapshot_After[0].toString()
      const alice_snapshot_P_After = alice_snapshot_After[1].toString()
      assert.equal(alice_snapshot_S_After, S)
      assert.equal(alice_snapshot_P_After, P)
    })

    it("withdrawFromSP(): decreases StabilityPool ETH", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // 1 defaulter opens
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // price drops: defaulter's Trove falls below MCR, alice and whale Trove remain active
      await priceFeed.setPrice('100000000000000000000');

      // defaulter's Trove is closed.
      const liquidationTx_1 = await troveManager.liquidate(defaulter_1.address)  // 180 LUSD closed
      const [, liquidatedColl,] = await th.getEmittedLiquidationValues(liquidationTx_1)

      //Get ActivePool and StabilityPool Ether before retrieval:
      const active_ETH_Before = await activePool.getWSTETH()
      const stability_ETH_Before = await stabilityPool.getWSTETH()

      // Expect alice to be entitled to 15000/200000 of the liquidated coll
      const aliceExpectedETHGain = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const aliceETHGain = await stabilityPool.getDepositorWSTETHGain(alice.address)
      assert.isTrue(aliceExpectedETHGain.eq(aliceETHGain))

      // Alice retrieves all of her deposit
      await stabilityPool.connect(alice).withdrawFromSP(dec(15000, 18))

      const active_ETH_After = await activePool.getWSTETH()
      const stability_ETH_After = await stabilityPool.getWSTETH()

      const active_ETH_Difference = (active_ETH_Before.sub(active_ETH_After))
      const stability_ETH_Difference = (stability_ETH_Before.sub(stability_ETH_After))

      assert.equal(active_ETH_Difference.toString(), '0')

      // Expect StabilityPool to have decreased by Alice's ETHGain
      assert.isAtMost(th.getDifference(stability_ETH_Difference, aliceETHGain), 10000)
    })

    it("withdrawFromSP(): All depositors are able to withdraw from the SP to their account", async () => {
      // Whale opens trove 
      await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // 1 defaulter open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (const account of depositors) {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.connect(account).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(defaulter_1.address)

      await priceFeed.setPrice(dec(200, 18))

      // All depositors attempt to withdraw
      await stabilityPool.connect(alice).withdrawFromSP(dec(10000, 18))
      assert.equal(((await stabilityPool.deposits(alice.address))[0]).toString(), '0')
      await stabilityPool.connect(bob).withdrawFromSP(dec(10000, 18))
      assert.equal(((await stabilityPool.deposits(alice.address))[0]).toString(), '0')
      await stabilityPool.connect(carol).withdrawFromSP(dec(10000, 18))
      assert.equal(((await stabilityPool.deposits(alice.address))[0]).toString(), '0')
      await stabilityPool.connect(dennis).withdrawFromSP(dec(10000, 18))
      assert.equal(((await stabilityPool.deposits(alice.address))[0]).toString(), '0')
      await stabilityPool.connect(erin).withdrawFromSP(dec(10000, 18))
      assert.equal(((await stabilityPool.deposits(alice.address))[0]).toString(), '0')
      await stabilityPool.connect(flyn).withdrawFromSP(dec(10000, 18))
      assert.equal(((await stabilityPool.deposits(alice.address))[0]).toString(), '0')

      const totalDeposits = await stabilityPool.getTotalSIMDeposits()

      assert.isAtMost(th.getDifference(totalDeposits, toBN('0')), 100000)
    })

    it("withdrawFromSP(): increases depositor's LUSD token balance by the expected amount", async () => {
      // Whale opens trove 
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // 1 defaulter opens trove
      await contracts.wstETHMock.connect(defaulter_1).approve(borrowerOperations.address, dec(100, 'ether'))
      await borrowerOperations.connect(defaulter_1).openTrove(dec(100, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(10000, 18))), defaulter_1.address, defaulter_1.address)

      const defaulterDebt = (await troveManager.getEntireDebtAndColl(defaulter_1.address))[0]

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (const account of depositors) {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.connect(account).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(defaulter_1.address)

      const aliceBalBefore = await simToken.balanceOf(alice.address)
      const bobBalBefore = await simToken.balanceOf(bob.address)

      /* From an offset of 10000 LUSD, each depositor receives
      LUSDLoss = 1666.6666666666666666 LUSD

      and thus with a deposit of 10000 LUSD, each should withdraw 8333.3333333333333333 LUSD (in practice, slightly less due to rounding error)
      */

      // Price bounces back to $200 per ETH
      await priceFeed.setPrice(dec(200, 18))

      // Bob issues a further 5000 LUSD from his trove 
      await borrowerOperations.connect(bob).withdrawSIM(th._100pct, dec(5000, 18), bob.address, bob.address)

      // Expect Alice's LUSD balance increase be very close to 8333.3333333333333333 LUSD
      await stabilityPool.connect(alice).withdrawFromSP(dec(10000, 18))
      const aliceBalance = (await simToken.balanceOf(alice.address))

      assert.isAtMost(th.getDifference(aliceBalance.sub(aliceBalBefore), toBN('8333333333333333333333')), 100000)

      // expect Bob's LUSD balance increase to be very close to  13333.33333333333333333 LUSD
      await stabilityPool.connect(bob).withdrawFromSP(dec(10000, 18))
      const bobBalance = (await simToken.balanceOf(bob.address))
      assert.isAtMost(th.getDifference(bobBalance.sub(bobBalBefore), toBN('13333333333333333333333')), 100000)
    })

    it("withdrawFromSP(): doesn't impact other users Stability deposits or ETH gains", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(20000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30000, 18), ZERO_ADDRESS)

      // Would-be defaulters open troves
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))
      assert.isFalse(await sortedTroves.contains(defaulter_2.address))

      const alice_LUSDDeposit_Before = (await stabilityPool.getCompoundedSIMDeposit(alice.address)).toString()
      const bob_LUSDDeposit_Before = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()

      const alice_ETHGain_Before = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_Before = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()

      //check non-zero LUSD and ETHGain in the Stability Pool
      const LUSDinSP = await stabilityPool.getTotalSIMDeposits()
      const ETHinSP = await stabilityPool.getWSTETH()
      assert.isTrue(LUSDinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))

      // Price rises
      await priceFeed.setPrice(dec(200, 18))

      // Carol withdraws her Stability deposit 
      assert.equal(((await stabilityPool.deposits(carol.address))[0]).toString(), dec(30000, 18))
      await stabilityPool.connect(carol).withdrawFromSP(dec(30000, 18))
      assert.equal(((await stabilityPool.deposits(carol.address))[0]).toString(), '0')

      const alice_LUSDDeposit_After = (await stabilityPool.getCompoundedSIMDeposit(alice.address)).toString()
      const bob_LUSDDeposit_After = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()

      const alice_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_After = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()

      // Check compounded deposits and ETH gains for A and B have not changed
      assert.equal(alice_LUSDDeposit_Before, alice_LUSDDeposit_After)
      assert.equal(bob_LUSDDeposit_Before, bob_LUSDDeposit_After)

      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)
    })

    it("withdrawFromSP(): doesn't impact system debt, collateral or TCR ", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(20000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30000, 18), ZERO_ADDRESS)

      // Would-be defaulters open troves
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1.address)
      await troveManager.liquidate(defaulter_2.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))
      assert.isFalse(await sortedTroves.contains(defaulter_2.address))

      // Price rises
      await priceFeed.setPrice(dec(200, 18))

      const activeDebt_Before = (await activePool.getSIMDebt()).toString()
      const defaultedDebt_Before = (await defaultPool.getSIMDebt()).toString()
      const activeColl_Before = (await activePool.getWSTETH()).toString()
      const defaultedColl_Before = (await defaultPool.getWSTETH()).toString()
      const TCR_Before = (await th.getTCR(contracts)).toString()

      // Carol withdraws her Stability deposit 
      assert.equal(((await stabilityPool.deposits(carol.address))[0]).toString(), dec(30000, 18))
      await stabilityPool.connect(carol).withdrawFromSP(dec(30000, 18))
      assert.equal(((await stabilityPool.deposits(carol.address))[0]).toString(), '0')

      const activeDebt_After = (await activePool.getSIMDebt()).toString()
      const defaultedDebt_After = (await defaultPool.getSIMDebt()).toString()
      const activeColl_After = (await activePool.getWSTETH()).toString()
      const defaultedColl_After = (await defaultPool.getWSTETH()).toString()
      const TCR_After = (await th.getTCR(contracts)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)
    })

    it("withdrawFromSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B and C provide to SP
      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(20000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30000, 18), ZERO_ADDRESS)

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManager.Troves(whale.address))[0].toString()
      const alice_Debt_Before = (await troveManager.Troves(alice.address))[0].toString()
      const bob_Debt_Before = (await troveManager.Troves(bob.address))[0].toString()
      const carol_Debt_Before = (await troveManager.Troves(carol.address))[0].toString()

      const whale_Coll_Before = (await troveManager.Troves(whale.address))[1].toString()
      const alice_Coll_Before = (await troveManager.Troves(alice.address))[1].toString()
      const bob_Coll_Before = (await troveManager.Troves(bob.address))[1].toString()
      const carol_Coll_Before = (await troveManager.Troves(carol.address))[1].toString()

      const whale_ICR_Before = (await troveManager.getCurrentICR(whale.address, price)).toString()
      const alice_ICR_Before = (await troveManager.getCurrentICR(alice.address, price)).toString()
      const bob_ICR_Before = (await troveManager.getCurrentICR(bob.address, price)).toString()
      const carol_ICR_Before = (await troveManager.getCurrentICR(carol.address, price)).toString()

      // price rises
      await priceFeed.setPrice(dec(200, 18))

      // Carol withdraws her Stability deposit 
      assert.equal(((await stabilityPool.deposits(carol.address))[0]).toString(), dec(30000, 18))
      await stabilityPool.connect(carol).withdrawFromSP(dec(30000, 18))
      assert.equal(((await stabilityPool.deposits(carol.address))[0]).toString(), '0')

      const whale_Debt_After = (await troveManager.Troves(whale.address))[0].toString()
      const alice_Debt_After = (await troveManager.Troves(alice.address))[0].toString()
      const bob_Debt_After = (await troveManager.Troves(bob.address))[0].toString()
      const carol_Debt_After = (await troveManager.Troves(carol.address))[0].toString()

      const whale_Coll_After = (await troveManager.Troves(whale.address))[1].toString()
      const alice_Coll_After = (await troveManager.Troves(alice.address))[1].toString()
      const bob_Coll_After = (await troveManager.Troves(bob.address))[1].toString()
      const carol_Coll_After = (await troveManager.Troves(carol.address))[1].toString()

      const whale_ICR_After = (await troveManager.getCurrentICR(whale.address, price)).toString()
      const alice_ICR_After = (await troveManager.getCurrentICR(alice.address, price)).toString()
      const bob_ICR_After = (await troveManager.getCurrentICR(bob.address, price)).toString()
      const carol_ICR_After = (await troveManager.getCurrentICR(carol.address, price)).toString()

      // Check all troves are unaffected by Carol's Stability deposit withdrawal
      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)
    })

    it("withdrawFromSP(): succeeds when amount is 0 and system has an undercollateralized trove", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })

      await stabilityPool.connect(A).provideToSP(dec(100, 18), ZERO_ADDRESS)

      const A_initialDeposit = ((await stabilityPool.deposits(A.address))[0]).toString()
      assert.equal(A_initialDeposit, dec(100, 18))

      // defaulters opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // ETH drops, defaulters are in liquidation range
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManager, price))

      await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK)

      // Liquidate d1
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      // Check d2 is undercollateralized
      assert.isTrue(await th.ICRbetween100and110(defaulter_2, troveManager, price))
      assert.isTrue(await sortedTroves.contains(defaulter_2.address))


      const A_ETHBalBefore = await contracts.wstETHMock.balanceOf(A.address)
      const A_LQTYBalBefore = await shadyToken.balanceOf(A.address)

      // Check Alice has gains to withdraw
      const A_pendingETHGain = await stabilityPool.getDepositorWSTETHGain(A.address)
      const A_pendingLQTYGain = await stabilityPool.getDepositorSHADYGain(A.address)
      assert.isTrue(A_pendingETHGain.gt(toBN('0')))
      assert.isTrue(A_pendingLQTYGain.gt(toBN('0')))

      // Check withdrawal of 0 succeeds
      const tx = await stabilityPool.connect(A).withdrawFromSP(0)
      // assert.isTrue(tx.receipt.status)

      const A_expectedBalance = A_ETHBalBefore/*.sub((toBN(th.gasUsed(tx) * GAS_PRICE)))*/
  
      const A_ETHBalAfter = await contracts.wstETHMock.balanceOf(A.address)

      const A_LQTYBalAfter = await shadyToken.balanceOf(A.address)
      const A_LQTYBalDiff = A_LQTYBalAfter.sub(A_LQTYBalBefore)

      // Check A's ETH and LQTY balances have increased correctly
      assert.isTrue(A_ETHBalAfter.sub(A_expectedBalance).eq(A_pendingETHGain))
      assert.isAtMost(th.getDifference(A_LQTYBalDiff, A_pendingLQTYGain), 1000)
    })

    it("withdrawFromSP(): withdrawing 0 LUSD doesn't alter the caller's deposit or the total LUSD in the Stability Pool", async () => {
      // --- SETUP ---
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B, C provides 100, 50, 30 LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(50, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30, 18), ZERO_ADDRESS)

      const bob_Deposit_Before = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
      const LUSDinSP_Before = (await stabilityPool.getTotalSIMDeposits()).toString()

      assert.equal(LUSDinSP_Before, dec(180, 18))

      // Bob withdraws 0 LUSD from the Stability Pool 
      await stabilityPool.connect(bob).withdrawFromSP(0)

      // check Bob's deposit and total LUSD in Stability Pool has not changed
      const bob_Deposit_After = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()
      const LUSDinSP_After = (await stabilityPool.getTotalSIMDeposits()).toString()

      assert.equal(bob_Deposit_Before, bob_Deposit_After)
      assert.equal(LUSDinSP_Before, LUSDinSP_After)
    })

    it("withdrawFromSP(): withdrawing 0 ETH Gain does not alter the caller's ETH balance, their trove collateral, or the ETH  in the Stability Pool", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // Would-be defaulter open trove
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts))

      // Defaulter 1 liquidated, full offset
      await troveManager.liquidate(defaulter_1.address)

      // Dennis opens trove and deposits to Stability Pool
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
      await stabilityPool.connect(dennis).provideToSP(dec(100, 18), ZERO_ADDRESS)

      // Check Dennis has 0 ETHGain
      const dennis_ETHGain = (await stabilityPool.getDepositorWSTETHGain(dennis.address)).toString()
      assert.equal(dennis_ETHGain, '0')

      const dennis_ETHBalance_Before = (await contracts.wstETHMock.balanceOf(dennis.address)).toString()
      const dennis_Collateral_Before = ((await troveManager.Troves(dennis.address))[1]).toString()
      const ETHinSP_Before = (await stabilityPool.getWSTETH()).toString()

      await priceFeed.setPrice(dec(200, 18))

      // Dennis withdraws his full deposit and ETHGain to his account
      await stabilityPool.connect(dennis).withdrawFromSP(dec(100, 18))

      // Check withdrawal does not alter Dennis' ETH balance or his trove's collateral
      const dennis_ETHBalance_After = (await contracts.wstETHMock.balanceOf(dennis.address)).toString()
      const dennis_Collateral_After = ((await troveManager.Troves(dennis.address))[1]).toString()
      const ETHinSP_After = (await stabilityPool.getWSTETH()).toString()

      assert.equal(dennis_ETHBalance_Before, dennis_ETHBalance_After)
      assert.equal(dennis_Collateral_Before, dennis_Collateral_After)

      // Check withdrawal has not altered the ETH in the Stability Pool
      assert.equal(ETHinSP_Before, ETHinSP_After)
    })

    it("withdrawFromSP(): Request to withdraw > caller's deposit only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C provide LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(20000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30000, 18), ZERO_ADDRESS)

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1.address)

      const alice_LUSD_Balance_Before = await simToken.balanceOf(alice.address)
      const bob_LUSD_Balance_Before = await simToken.balanceOf(bob.address)

      const alice_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(alice.address)
      const bob_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(bob.address)

      const LUSDinSP_Before = await stabilityPool.getTotalSIMDeposits()

      await priceFeed.setPrice(dec(200, 18))

      // Bob attempts to withdraws 1 wei more than his compounded deposit from the Stability Pool
      await stabilityPool.connect(bob).withdrawFromSP(bob_Deposit_Before.add(toBN(1)))

      // Check Bob's LUSD balance has risen by only the value of his compounded deposit
      const bob_expectedLUSDBalance = (bob_LUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const bob_LUSD_Balance_After = (await simToken.balanceOf(bob.address)).toString()
      assert.equal(bob_LUSD_Balance_After, bob_expectedLUSDBalance)

      // Alice attempts to withdraws 2309842309.000000000000000000 LUSD from the Stability Pool 
      await stabilityPool.connect(alice).withdrawFromSP('2309842309000000000000000000')

      // Check Alice's LUSD balance has risen by only the value of her compounded deposit
      const alice_expectedLUSDBalance = (alice_LUSD_Balance_Before.add(alice_Deposit_Before)).toString()
      const alice_LUSD_Balance_After = (await simToken.balanceOf(alice.address)).toString()
      assert.equal(alice_LUSD_Balance_After, alice_expectedLUSDBalance)

      // Check LUSD in Stability Pool has been reduced by only Alice's compounded deposit and Bob's compounded deposit
      const expectedLUSDinSP = (LUSDinSP_Before.sub(alice_Deposit_Before).sub(bob_Deposit_Before)).toString()
      const LUSDinSP_After = (await stabilityPool.getTotalSIMDeposits()).toString()
      assert.equal(LUSDinSP_After, expectedLUSDinSP)
    })

    it("withdrawFromSP(): Request to withdraw 2^256-1 LUSD only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C provides 100, 50, 30 LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(100, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(50, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(30, 18), ZERO_ADDRESS)

      // Price drops
      await priceFeed.setPrice(dec(100, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1.address)

      const bob_LUSD_Balance_Before = await simToken.balanceOf(bob.address)

      const bob_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(bob.address)

      const LUSDinSP_Before = await stabilityPool.getTotalSIMDeposits()

      const maxBytes32 = toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

      // Price drops
      await priceFeed.setPrice(dec(200, 18))

      // Bob attempts to withdraws maxBytes32 LUSD from the Stability Pool
      await stabilityPool.connect(bob).withdrawFromSP(maxBytes32)

      // Check Bob's LUSD balance has risen by only the value of his compounded deposit
      const bob_expectedLUSDBalance = (bob_LUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const bob_LUSD_Balance_After = (await simToken.balanceOf(bob.address)).toString()
      assert.equal(bob_LUSD_Balance_After, bob_expectedLUSDBalance)

      // Check LUSD in Stability Pool has been reduced by only  Bob's compounded deposit
      const expectedLUSDinSP = (LUSDinSP_Before.sub(bob_Deposit_Before)).toString()
      const LUSDinSP_After = (await stabilityPool.getTotalSIMDeposits()).toString()
      assert.equal(LUSDinSP_After, expectedLUSDinSP)
    })

    it("withdrawFromSP(): caller can withdraw full deposit and ETH gain during Recovery Mode", async () => {
      // --- SETUP ---

      // Price doubles
      await priceFeed.setPrice(dec(400, 18))
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      // Price halves
      await priceFeed.setPrice(dec(200, 18))

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: carol } })

      await contracts.wstETHMock.connect(defaulter_1).approve(borrowerOperations.address, dec(100, 'ether'))
      await borrowerOperations.connect(defaulter_1).openTrove(dec(100, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(10000, 18))), defaulter_1.address, defaulter_1.address)

      // A, B, C provides 10000, 5000, 3000 LUSD to SP
      const A_GAS_Used = th.gasUsed(await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS))
      const B_GAS_Used = th.gasUsed(await stabilityPool.connect(bob).provideToSP(dec(5000, 18), ZERO_ADDRESS))
      const C_GAS_Used = th.gasUsed(await stabilityPool.connect(carol).provideToSP(dec(3000, 18), ZERO_ADDRESS))

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      assert.isTrue(await th.checkRecoveryMode(contracts))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      const alice_LUSD_Balance_Before = await simToken.balanceOf(alice.address)
      const bob_LUSD_Balance_Before = await simToken.balanceOf(bob.address)
      const carol_LUSD_Balance_Before = await simToken.balanceOf(carol.address)

      const alice_ETH_Balance_Before = await contracts.wstETHMock.balanceOf(alice.address)
      const bob_ETH_Balance_Before = await contracts.wstETHMock.balanceOf(bob.address)
      const carol_ETH_Balance_Before = await contracts.wstETHMock.balanceOf(carol.address)

      const alice_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(alice.address)
      const bob_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(bob.address)
      const carol_Deposit_Before = await stabilityPool.getCompoundedSIMDeposit(carol.address)

      const alice_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(alice.address)
      const bob_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(bob.address)
      const carol_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(carol.address)

      const LUSDinSP_Before = await stabilityPool.getTotalSIMDeposits()

      // Price rises
      await priceFeed.setPrice(dec(220, 18))

      assert.isTrue(await th.checkRecoveryMode(contracts))

      // A, B, C withdraw their full deposits from the Stability Pool
      const A_GAS_Deposit = th.gasUsed(await stabilityPool.connect(alice).withdrawFromSP(dec(10000, 18)))
      const B_GAS_Deposit = th.gasUsed(await stabilityPool.connect(bob).withdrawFromSP(dec(5000, 18)))
      const C_GAS_Deposit = th.gasUsed(await stabilityPool.connect(carol).withdrawFromSP(dec(3000, 18)))

      // Check LUSD balances of A, B, C have risen by the value of their compounded deposits, respectively
      const alice_expectedLUSDBalance = (alice_LUSD_Balance_Before.add(alice_Deposit_Before)).toString()

      const bob_expectedLUSDBalance = (bob_LUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const carol_expectedLUSDBalance = (carol_LUSD_Balance_Before.add(carol_Deposit_Before)).toString()

      const alice_LUSD_Balance_After = (await simToken.balanceOf(alice.address)).toString()
 
      const bob_LUSD_Balance_After = (await simToken.balanceOf(bob.address)).toString()
      const carol_LUSD_Balance_After = (await simToken.balanceOf(carol.address)).toString()



      assert.equal(alice_LUSD_Balance_After, alice_expectedLUSDBalance)
      assert.equal(bob_LUSD_Balance_After, bob_expectedLUSDBalance)
      assert.equal(carol_LUSD_Balance_After, carol_expectedLUSDBalance)

      // Check ETH balances of A, B, C have increased by the value of their ETH gain from liquidations, respectively
      const alice_expectedETHBalance = (alice_ETH_Balance_Before.add(alice_ETHGain_Before)).toString()
      const bob_expectedETHBalance = (bob_ETH_Balance_Before.add(bob_ETHGain_Before)).toString()
      const carol_expectedETHBalance = (carol_ETH_Balance_Before.add(carol_ETHGain_Before)).toString()

      const alice_ETHBalance_After = (await contracts.wstETHMock.balanceOf(alice.address)).toString()
      const bob_ETHBalance_After = (await contracts.wstETHMock.balanceOf(bob.address)).toString()
      const carol_ETHBalance_After = (await contracts.wstETHMock.balanceOf(carol.address)).toString()

      // ETH balances before minus gas used
      const alice_ETHBalance_After_Gas = alice_ETHBalance_After/*- A_GAS_Used*/;
      const bob_ETHBalance_After_Gas = bob_ETHBalance_After/*- B_GAS_Used*/;
      const carol_ETHBalance_After_Gas = carol_ETHBalance_After/*- C_GAS_Used*/;

      assert.equal(alice_expectedETHBalance, alice_ETHBalance_After_Gas)
      assert.equal(bob_expectedETHBalance, bob_ETHBalance_After_Gas)
      assert.equal(carol_expectedETHBalance, carol_ETHBalance_After_Gas)

      // Check LUSD in Stability Pool has been reduced by A, B and C's compounded deposit
      const expectedLUSDinSP = (LUSDinSP_Before
        .sub(alice_Deposit_Before)
        .sub(bob_Deposit_Before)
        .sub(carol_Deposit_Before))
        .toString()
      const LUSDinSP_After = (await stabilityPool.getTotalSIMDeposits()).toString()
      assert.equal(LUSDinSP_After, expectedLUSDinSP)

      // Check ETH in SP has reduced to zero
      const ETHinSP_After = await stabilityPool.getWSTETH()
      assert.isAtMost(th.getDifference(ETHinSP_After, toBN('0')), 100000)
    })

    it("getDepositorWSTETHGain(): depositor does not earn further ETH gains from liquidations while their compounded deposit == 0: ", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // defaulters open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_3 } })

      // A, B, provide 10000, 5000 LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(5000, 18), ZERO_ADDRESS)

      //price drops
      await priceFeed.setPrice(dec(105, 18))

      // Liquidate defaulter 1. Empties the Pool
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      const LUSDinSP = (await stabilityPool.getTotalSIMDeposits()).toString()
      assert.equal(LUSDinSP, '0')

      // Check Stability deposits have been fully cancelled with debt, and are now all zero
      const alice_Deposit = (await stabilityPool.getCompoundedSIMDeposit(alice.address)).toString()
      const bob_Deposit = (await stabilityPool.getCompoundedSIMDeposit(bob.address)).toString()

      assert.equal(alice_Deposit, '0')
      assert.equal(bob_Deposit, '0')

      // Get ETH gain for A and B
      const alice_ETHGain_1 = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_1 = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()

      // Whale deposits 10000 LUSD to Stability Pool
      await stabilityPool.connect(whale).provideToSP(dec(1, 24), ZERO_ADDRESS)

      // Liquidation 2
      await troveManager.liquidate(defaulter_2.address)
      assert.isFalse(await sortedTroves.contains(defaulter_2.address))

      // Check Alice and Bob have not received ETH gain from liquidation 2 while their deposit was 0
      const alice_ETHGain_2 = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_2 = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_2)
      assert.equal(bob_ETHGain_1, bob_ETHGain_2)

      // Liquidation 3
      await troveManager.liquidate(defaulter_3.address)
      assert.isFalse(await sortedTroves.contains(defaulter_3.address))

      // Check Alice and Bob have not received ETH gain from liquidation 3 while their deposit was 0
      const alice_ETHGain_3 = (await stabilityPool.getDepositorWSTETHGain(alice.address)).toString()
      const bob_ETHGain_3 = (await stabilityPool.getDepositorWSTETHGain(bob.address)).toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_3)
      assert.equal(bob_ETHGain_1, bob_ETHGain_3)
    })

    // --- LQTY functionality ---
    it("withdrawFromSP(): triggers LQTY reward event - increases the sum G", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A and B provide to SP
      await stabilityPool.connect(A).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A withdraws from SP
      await stabilityPool.connect(A).withdrawFromSP(dec(5000, 18))

      const G_1 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the LQTY reward event triggered
      assert.isTrue(G_1.gt(G_Before))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A withdraws from SP
      await stabilityPool.connect(B).withdrawFromSP(dec(5000, 18))

      const G_2 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the LQTY reward event triggered
      assert.isTrue(G_2.gt(G_1))
    })

    /*it("withdrawFromSP(), partial withdrawal: doesn't change the front end tag", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // whale transfer to troves D and E
      await simToken.connect(whale).transfer(D.address, dec(100, 18), { from: whale })
      await simToken.connect(whale).transfer(E.address, dec(200, 18), { from: whale })

      // A, B, C open troves
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, D, E provide to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), ZERO_ADDRESS, { from: C })
      await stabilityPool.provideToSP(dec(40, 18), ZERO_ADDRESS, { from: D })
      await stabilityPool.provideToSP(dec(50, 18), ZERO_ADDRESS, { from: E })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // A, B, C, D, E withdraw, from different front ends
      await stabilityPool.withdrawFromSP(dec(5, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(10, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(15, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(20, 18), { from: D })
      await stabilityPool.withdrawFromSP(dec(25, 18), { from: E })

      const frontEndTag_A = (await stabilityPool.deposits(A.address))[1]
      const frontEndTag_B = (await stabilityPool.deposits(B.address))[1]
      const frontEndTag_C = (await stabilityPool.deposits(C.address))[1]
      const frontEndTag_D = (await stabilityPool.deposits(D))[1]
      const frontEndTag_E = (await stabilityPool.deposits(E))[1]

      // Check deposits are still tagged with their original front end
      assert.equal(frontEndTag_A, frontEnd_1)
      assert.equal(frontEndTag_B, frontEnd_2)
      assert.equal(frontEndTag_C, ZERO_ADDRESS)
      assert.equal(frontEndTag_D, frontEnd_1)
      assert.equal(frontEndTag_E, ZERO_ADDRESS)
    })*/

    it("withdrawFromSP(), partial withdrawal: depositor receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.connect(A).provideToSP(dec(10, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(20, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(30, 18), ZERO_ADDRESS)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get A, B, C LQTY balance before
      const A_LQTYBalance_Before = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_Before = await shadyToken.balanceOf(B.address)
      const C_LQTYBalance_Before = await shadyToken.balanceOf(C.address)

      // A, B, C withdraw
      await stabilityPool.connect(A).withdrawFromSP(dec(1, 18))
      await stabilityPool.connect(B).withdrawFromSP(dec(2, 18))
      await stabilityPool.connect(C).withdrawFromSP(dec(3, 18))

      // Get LQTY balance after
      const A_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_After = await shadyToken.balanceOf(B.address)
      const C_LQTYBalance_After = await shadyToken.balanceOf(C.address)

      // Check LQTY Balance of A, B, C has increased
      assert.isTrue(A_LQTYBalance_After.gt(A_LQTYBalance_Before))
      assert.isTrue(B_LQTYBalance_After.gt(B_LQTYBalance_Before))
      assert.isTrue(C_LQTYBalance_After.gt(C_LQTYBalance_Before))
    })

    /*it("withdrawFromSP(), partial withdrawal: tagged front end receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get front ends' LQTY balance before
      const F1_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_1)
      const F2_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_2)
      const F3_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_3)

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      // Get front ends' LQTY balance after
      const F1_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const F2_LQTYBalance_After = await shadyToken.balanceOf(B.address)
      const F3_LQTYBalance_After = await shadyToken.balanceOf(C.address)

      // Check LQTY Balance of front ends has increased
      assert.isTrue(F1_LQTYBalance_After.gt(F1_LQTYBalance_Before))
      assert.isTrue(F2_LQTYBalance_After.gt(F2_LQTYBalance_Before))
      assert.isTrue(F3_LQTYBalance_After.gt(F3_LQTYBalance_Before))
    })

    it("withdrawFromSP(), partial withdrawal: tagged front end's stake decreases", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, D, E, F open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })

      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: D })
      await stabilityPool.provideToSP(dec(20, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(30, 18), frontEnd_3, { from: F })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get front ends' stake before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      // A, B, C withdraw 
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      // Check front ends' stakes have decreased
      assert.isTrue(F1_Stake_After.lt(F1_Stake_Before))
      assert.isTrue(F2_Stake_After.lt(F2_Stake_Before))
      assert.isTrue(F3_Stake_After.lt(F3_Stake_Before))
    })

    it("withdrawFromSP(), partial withdrawal: tagged front end's snapshots update", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(60000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // D opens trove
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP ---

      const deposit_A = dec(10000, 18)
      const deposit_B = dec(20000, 18)
      const deposit_C = dec(30000, 18)

      // A, B, C make their initial deposits
      await stabilityPool.provideToSP(deposit_A, ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      // fastforward time then make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: D })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // Get front ends' snapshots before
      for (frontEnd of [ZERO_ADDRESS, frontEnd_2, frontEnd_3]) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends, since S corresponds to ETH gain)
        assert.equal(snapshot[1], dec(1, 18))  // P 
        assert.equal(snapshot[2], '0')  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }

      // --- TEST ---

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C top withdraw part of their deposits. Grab G at each stage, as it can increase a bit
      // between topups, because some block.timestamp time passes (and LQTY is issued) between ops
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })

      const G2 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })

      const G3 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      const frontEnds = [ZERO_ADDRESS, frontEnd_2, frontEnd_3]
      const G_Values = [G1, G2, G3]

      // Map frontEnds to the value of G at time the deposit was made
      frontEndToG = th.zipToObject(frontEnds, G_Values)

      // Get front ends' snapshots after
      for (const [frontEnd, G] of Object.entries(frontEndToG)) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        // Check snapshots are the expected values
        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends)
        assert.isTrue(snapshot[1].eq(P_Before))  // P 
        assert.isTrue(snapshot[2].eq(G))  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }
    })*/

    /*it("withdrawFromSP(), full withdrawal: removes deposit's front end tag", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers to A, B 
      await simToken.transfer(A, dec(10000, 18), { from: whale })
      await simToken.transfer(B, dec(20000, 18), { from: whale })

      //C, D open troves
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // A, B, C, D make their initial deposits
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), ZERO_ADDRESS, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), frontEnd_2, { from: C })
      await stabilityPool.provideToSP(dec(40000, 18), ZERO_ADDRESS, { from: D })

      // Check deposits are tagged with correct front end 
      const A_tagBefore = await getFrontEndTag(stabilityPool, A)
      const B_tagBefore = await getFrontEndTag(stabilityPool, B)
      const C_tagBefore = await getFrontEndTag(stabilityPool, C)
      const D_tagBefore = await getFrontEndTag(stabilityPool, D)

      assert.equal(A_tagBefore, frontEnd_1)
      assert.equal(B_tagBefore, ZERO_ADDRESS)
      assert.equal(C_tagBefore, frontEnd_2)
      assert.equal(D_tagBefore, ZERO_ADDRESS)

      // All depositors make full withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

      // Check all deposits now have no front end tag
      const A_tagAfter = await getFrontEndTag(stabilityPool, A)
      const B_tagAfter = await getFrontEndTag(stabilityPool, B)
      const C_tagAfter = await getFrontEndTag(stabilityPool, C)
      const D_tagAfter = await getFrontEndTag(stabilityPool, D)

      assert.equal(A_tagAfter, ZERO_ADDRESS)
      assert.equal(B_tagAfter, ZERO_ADDRESS)
      assert.equal(C_tagAfter, ZERO_ADDRESS)
      assert.equal(D_tagAfter, ZERO_ADDRESS)
    })*/

    it("withdrawFromSP(), full withdrawal: zero's depositor's snapshots", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({  ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to make G, S > 0 and P < 1  

      // E opens trove and makes a deposit
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: E } })
      await stabilityPool.connect(E).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      // Fast-forward time and make a second deposit, to trigger LQTY reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)
      await stabilityPool.connect(E).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // --- TEST ---

      // Whale transfers to A, B
      await simToken.connect(whale).transfer(A.address, dec(10000, 18))
      await simToken.connect(whale).transfer(B.address, dec(20000, 18))

      await priceFeed.setPrice(dec(200, 18))

      // C, D open troves
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: D } })

      // A, B, C, D make their initial deposits
      await stabilityPool.connect(A).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(20000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(30000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(D).provideToSP(dec(40000, 18), ZERO_ADDRESS)

      // Check deposits snapshots are non-zero

      for (const depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor.address)

        const ZERO = toBN('0')
        // Check S,P, G snapshots are non-zero
        assert.isTrue(snapshot[0].eq(S_Before))  // S 
        assert.isTrue(snapshot[1].eq(P_Before))  // P 
        assert.isTrue(snapshot[2].gt(ZERO))  // GL increases a bit between each depositor op, so just check it is non-zero
        assert.equal(snapshot[3].toString(), '0')  // scale
        assert.equal(snapshot[4].toString(), '0')  // epoch
      }

      // All depositors make full withdrawal
      await stabilityPool.connect(A).withdrawFromSP(dec(10000, 18))
      await stabilityPool.connect(B).withdrawFromSP(dec(20000, 18))
      await stabilityPool.connect(C).withdrawFromSP(dec(30000, 18))
      await stabilityPool.connect(D).withdrawFromSP(dec(40000, 18))

      // Check all depositors' snapshots have been zero'd
      for (const depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor.address)

        // Check S, P, G snapshots are now zero
        assert.equal(snapshot[0].toString(), '0')  // S
        assert.equal(snapshot[1].toString(), '0')  // P
        assert.equal(snapshot[2].toString(), '0')  // G
        assert.equal(snapshot[3].toString(), '0')  // scale
        assert.equal(snapshot[4].toString(), '0')  // epoch
      }
    })

    /*it("withdrawFromSP(), full withdrawal that reduces front end stake to 0: zero’s the front end’s snapshots", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to make G, S > 0 and P < 1  

      // E opens trove and makes a deposit
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_3, { from: E })

      // Fast-forward time and make a second deposit, to trigger LQTY reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)
      await stabilityPool.provideToSP(dec(10000, 18), frontEnd_3, { from: E })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // --- TEST ---

      // A, B open troves
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // A, B, make their initial deposits
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_2, { from: B })

      // Check frontend snapshots are non-zero
      for (frontEnd of [ZERO_ADDRESS, frontEnd_2]) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        const ZERO = toBN('0')
        // Check S,P, G snapshots are non-zero
        assert.equal(snapshot[0], '0')  // S  (always zero for front-end)
        assert.isTrue(snapshot[1].eq(P_Before))  // P 
        assert.isTrue(snapshot[2].gt(ZERO))  // GL increases a bit between each depositor op, so just check it is non-zero
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }

      await priceFeed.setPrice(dec(200, 18))

      // All depositors make full withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })

      // Check all front ends' snapshots have been zero'd
      for (frontEnd of [ZERO_ADDRESS, frontEnd_2]) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        // Check S, P, G snapshots are now zero
        assert.equal(snapshot[0], '0')  // S  (always zero for front-end)
        assert.equal(snapshot[1], '0')  // P 
        assert.equal(snapshot[2], '0')  // G 
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }
    })*/

    it("withdrawFromSP(), reverts when initial deposit value is 0", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A opens trove and join the Stability Pool
      await openTrove({ extraLUSDAmount: toBN(dec(10100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await stabilityPool.connect(A).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to trigger LQTY and ETH rewards for depositor A

      // Fast-forward time and make a second deposit, to trigger LQTY reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)
      await stabilityPool.connect(A).provideToSP(dec(100, 18), ZERO_ADDRESS)

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      await priceFeed.setPrice(dec(200, 18))

      // A successfully withraws deposit and all gains
      await stabilityPool.connect(A).withdrawFromSP(dec(10100, 18))

      // Confirm A's recorded deposit is 0
      const A_deposit = (await stabilityPool.deposits(A.address))[0]  // get initialValue property on deposit struct
      assert.equal(A_deposit.toString(), '0')

      // --- TEST ---
      const expectedRevertMessage = "StabilityPool: User must have a non-zero deposit"

      // Further withdrawal attempt from A
      const withdrawalPromise_A = stabilityPool.connect(A).withdrawFromSP(dec(10000, 18))
      await th.assertRevert(withdrawalPromise_A, expectedRevertMessage)

      // Withdrawal attempt of a non-existent deposit, from C
      const withdrawalPromise_C = stabilityPool.connect(C).withdrawFromSP(dec(10000, 18))
      await th.assertRevert(withdrawalPromise_C, expectedRevertMessage)
    })

    // --- withdrawETHGainToTrove ---

    it("withdrawWSTETHGainToTrove(): reverts when user has no active deposit", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      const alice_initialDeposit = ((await stabilityPool.deposits(alice.address))[0]).toString()
      const bob_initialDeposit = ((await stabilityPool.deposits(bob.address))[0]).toString()

      assert.equal(alice_initialDeposit, dec(10000, 18))
      assert.equal(bob_initialDeposit, '0')

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      const txAlice = await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)
      // assert.isTrue(txAlice.receipt.status)

      const txPromise_B = stabilityPool.connect(bob).withdrawWSTETHGainToTrove(bob.address, bob.address)
      await th.assertRevert(txPromise_B)
    })

    it("withdrawWSTETHGainToTrove(): Applies LUSDLoss to user's deposit, and redirects ETH reward to user's Trove", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // Defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // check Alice's Trove recorded ETH Before:
      const aliceTrove_Before = await troveManager.Troves(alice.address)
      const aliceTrove_ETH_Before = aliceTrove_Before[1]
      assert.isTrue(aliceTrove_ETH_Before.gt(toBN('0')))

      // price drops: defaulter's Trove falls below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18));

      // Defaulter's Trove is closed
      const liquidationTx_1 = await troveManager.liquidate(defaulter_1.address)
      const [liquidatedDebt, liquidatedColl, ,] = await th.getEmittedLiquidationValues(liquidationTx_1)

      const ETHGain_A = await stabilityPool.getDepositorWSTETHGain(alice.address)
      const compoundedDeposit_A = await stabilityPool.getCompoundedSIMDeposit(alice.address)

      // Alice should receive rewards proportional to her deposit as share of total deposits
      const expectedETHGain_A = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const expectedLUSDLoss_A = liquidatedDebt.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const expectedCompoundedDeposit_A = toBN(dec(15000, 18)).sub(expectedLUSDLoss_A)

      assert.isAtMost(th.getDifference(expectedCompoundedDeposit_A, compoundedDeposit_A), 100000)

      // Alice sends her ETH Gains to her Trove
      await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)

      // check Alice's LUSDLoss has been applied to her deposit expectedCompoundedDeposit_A
      const alice_deposit_afterDefault = ((await stabilityPool.deposits(alice.address))[0])
      assert.isAtMost(th.getDifference(alice_deposit_afterDefault, expectedCompoundedDeposit_A), 100000)

      // check alice's Trove recorded ETH has increased by the expected reward amount
      const aliceTrove_After = await troveManager.Troves(alice.address)
      const aliceTrove_ETH_After = aliceTrove_After[1]

      const Trove_ETH_Increase = (aliceTrove_ETH_After.sub(aliceTrove_ETH_Before)).toString()

      assert.equal(Trove_ETH_Increase, ETHGain_A.toString())
    })

    it("withdrawWSTETHGainToTrove(): reverts if it would leave trove with ICR < MCR", async () => {
      // --- SETUP ---
      // Whale deposits 1850 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // check alice's Trove recorded ETH Before:
      const aliceTrove_Before = await troveManager.Troves(alice.address)
      const aliceTrove_ETH_Before = aliceTrove_Before[1]
      assert.isTrue(aliceTrove_ETH_Before.gt(toBN('0')))

      // price drops: defaulter's Trove falls below MCR
      await priceFeed.setPrice(dec(100, 18));

      // defaulter's Trove is closed.
      await troveManager.liquidate(defaulter_1.address)

      // Alice attempts to  her ETH Gains to her Trove
      await assertRevert(stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address),
      "BorrowerOps: An operation that would result in ICR < MCR is not permitted")
    })

    it("withdrawWSTETHGainToTrove(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero ETH", async () => {
      // --- SETUP ---
      // Whale deposits 1850 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // check alice's Trove recorded ETH Before:
      const aliceTrove_Before = await troveManager.Troves(alice.address)
      const aliceTrove_ETH_Before = aliceTrove_Before[1]
      assert.isTrue(aliceTrove_ETH_Before.gt(toBN('0')))

      // price drops: defaulter's Trove falls below MCR
      await priceFeed.setPrice(dec(105, 18));

      // defaulter's Trove is closed.
      await troveManager.liquidate(defaulter_1.address)

      // price bounces back
      await priceFeed.setPrice(dec(200, 18));

      // Alice sends her ETH Gains to her Trove
      await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)

      assert.equal((await stabilityPool.getDepositorWSTETHGain(alice.address)).toNumber(), 0)

      const ETHinSP_Before = (await stabilityPool.getWSTETH()).toString()

      // Alice attempts second withdrawal from SP to Trove - reverts, due to 0 ETH Gain
      const txPromise_A = stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)
      await th.assertRevert(txPromise_A)

      // Check ETH in pool does not change
      const ETHinSP_1 = (await stabilityPool.getWSTETH()).toString()
      assert.equal(ETHinSP_Before, ETHinSP_1)

      await priceFeed.setPrice(dec(200, 18));

      // Alice attempts third withdrawal (this time, from SP to her own account)
      await stabilityPool.connect(alice).withdrawFromSP(dec(15000, 18))

      // Check ETH in pool does not change
      const ETHinSP_2 = (await stabilityPool.getWSTETH()).toString()
      assert.equal(ETHinSP_Before, ETHinSP_2)
    })

    it("withdrawWSTETHGainToTrove(): decreases StabilityPool ETH and increases activePool ETH", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.connect(whale).provideToSP(dec(185000, 18), ZERO_ADDRESS)

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await stabilityPool.connect(alice).provideToSP(dec(15000, 18), ZERO_ADDRESS)

      // price drops: defaulter's Trove falls below MCR
      await priceFeed.setPrice(dec(100, 18));

      // defaulter's Trove is closed.
      const liquidationTx = await troveManager.liquidate(defaulter_1.address)
      const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

      // Expect alice to be entitled to 15000/200000 of the liquidated coll
      const aliceExpectedETHGain = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const aliceETHGain = await stabilityPool.getDepositorWSTETHGain(alice.address)
      assert.isTrue(aliceExpectedETHGain.eq(aliceETHGain))

      // price bounces back
      await priceFeed.setPrice(dec(200, 18));

      //check activePool and StabilityPool Ether before retrieval:
      const active_ETH_Before = await activePool.getWSTETH()
      const stability_ETH_Before = await stabilityPool.getWSTETH()

      // Alice retrieves redirects ETH gain to her Trove
      await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)

      const active_ETH_After = await activePool.getWSTETH()
      const stability_ETH_After = await stabilityPool.getWSTETH()

      const active_ETH_Difference = (active_ETH_After.sub(active_ETH_Before)) // AP ETH should increase
      const stability_ETH_Difference = (stability_ETH_Before.sub(stability_ETH_After)) // SP ETH should decrease

      // check Pool ETH values change by Alice's ETHGain, i.e 0.075 ETH
      assert.isAtMost(th.getDifference(active_ETH_Difference, aliceETHGain), 10000)
      assert.isAtMost(th.getDifference(stability_ETH_Difference, aliceETHGain), 10000)
    })

    it("withdrawWSTETHGainToTrove(): All depositors are able to withdraw their ETH gain from the SP to their Trove", async () => {
      // Whale opens trove 
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (const account of depositors) {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.connect(account).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(defaulter_1.address)

      // price bounces back
      await priceFeed.setPrice(dec(200, 18));

      // All depositors attempt to withdraw
      const tx1 = await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)
      // assert.isTrue(tx1.receipt.status)
      const tx2 = await stabilityPool.connect(bob).withdrawWSTETHGainToTrove(bob.address, bob.address)
      // assert.isTrue(tx1.receipt.status)
      const tx3 = await stabilityPool.connect(carol).withdrawWSTETHGainToTrove(carol.address, carol.address)
      // assert.isTrue(tx1.receipt.status)
      const tx4 = await stabilityPool.connect(dennis).withdrawWSTETHGainToTrove(dennis.address, dennis.address)
      // assert.isTrue(tx1.receipt.status)
      const tx5 = await stabilityPool.connect(erin).withdrawWSTETHGainToTrove(erin.address, erin.address)
      // assert.isTrue(tx1.receipt.status)
      const tx6 = await stabilityPool.connect(flyn).withdrawWSTETHGainToTrove(flyn.address, flyn.address)
      // assert.isTrue(tx1.receipt.status)
    })

    it("withdrawWSTETHGainToTrove(): All depositors withdraw, each withdraw their correct ETH gain", async () => {
      // Whale opens trove 
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (const account of depositors) {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.connect(account).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      }
      const collBefore = (await troveManager.Troves(alice.address))[1] // all troves have same coll before

      await priceFeed.setPrice(dec(105, 18))
      const liquidationTx = await troveManager.liquidate(defaulter_1.address)
      const [, liquidatedColl, ,] = await th.getEmittedLiquidationValues(liquidationTx)


      /* All depositors attempt to withdraw their ETH gain to their Trove. Each depositor
      receives (liquidatedColl/ 6).

      Thus, expected new collateral for each depositor with 1 Ether in their trove originally, is 
      (1 + liquidatedColl/6)
      */

      const expectedCollGain= liquidatedColl.div(toBN('6'))

      await priceFeed.setPrice(dec(200, 18))

      await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)
      const aliceCollAfter = (await troveManager.Troves(alice.address))[1]
      assert.isAtMost(th.getDifference(aliceCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPool.connect(bob).withdrawWSTETHGainToTrove(bob.address, bob.address)
      const bobCollAfter = (await troveManager.Troves(bob.address))[1]
      assert.isAtMost(th.getDifference(bobCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPool.connect(carol).withdrawWSTETHGainToTrove(carol.address, carol.address)
      const carolCollAfter = (await troveManager.Troves(carol.address))[1]
      assert.isAtMost(th.getDifference(carolCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPool.connect(dennis).withdrawWSTETHGainToTrove(dennis.address, dennis.address)
      const dennisCollAfter = (await troveManager.Troves(dennis.address))[1]
      assert.isAtMost(th.getDifference(dennisCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPool.connect(erin).withdrawWSTETHGainToTrove(erin.address, erin.address)
      const erinCollAfter = (await troveManager.Troves(erin.address))[1]
      assert.isAtMost(th.getDifference(erinCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPool.connect(flyn).withdrawWSTETHGainToTrove(flyn.address, flyn.address)
      const flynCollAfter = (await troveManager.Troves(flyn.address))[1]
      assert.isAtMost(th.getDifference(flynCollAfter.sub(collBefore), expectedCollGain), 10000)
    })

    it("withdrawWSTETHGainToTrove(): caller can withdraw full deposit and ETH gain to their trove during Recovery Mode", async () => {
      // --- SETUP ---

     // Defaulter opens
     await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })
      
      // A, B, C provides 10000, 5000, 3000 LUSD to SP
      await stabilityPool.connect(alice).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(bob).provideToSP(dec(5000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(carol).provideToSP(dec(3000, 18), ZERO_ADDRESS)

      assert.isFalse(await th.checkRecoveryMode(contracts))

      // Price drops to 105, 
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      assert.isTrue(await th.checkRecoveryMode(contracts))

      // Check defaulter 1 has ICR: 100% < ICR < 110%.
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManager, price))

      const alice_Collateral_Before = (await troveManager.Troves(alice.address))[1]
      const bob_Collateral_Before = (await troveManager.Troves(bob.address))[1]
      const carol_Collateral_Before = (await troveManager.Troves(carol.address))[1]

      // Liquidate defaulter 1
      assert.isTrue(await sortedTroves.contains(defaulter_1.address))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      const alice_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(alice.address)
      const bob_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(bob.address)
      const carol_ETHGain_Before = await stabilityPool.getDepositorWSTETHGain(carol.address)

      // A, B, C withdraw their full ETH gain from the Stability Pool to their trove
      await stabilityPool.connect(alice).withdrawWSTETHGainToTrove(alice.address, alice.address)
      await stabilityPool.connect(bob).withdrawWSTETHGainToTrove(bob.address, bob.address)
      await stabilityPool.connect(carol).withdrawWSTETHGainToTrove(carol.address, carol.address)

      // Check collateral of troves A, B, C has increased by the value of their ETH gain from liquidations, respectively
      const alice_expectedCollateral = (alice_Collateral_Before.add(alice_ETHGain_Before)).toString()
      const bob_expectedColalteral = (bob_Collateral_Before.add(bob_ETHGain_Before)).toString()
      const carol_expectedCollateral = (carol_Collateral_Before.add(carol_ETHGain_Before)).toString()

      const alice_Collateral_After = (await troveManager.Troves(alice.address))[1]
      const bob_Collateral_After = (await troveManager.Troves(bob.address))[1]
      const carol_Collateral_After = (await troveManager.Troves(carol.address))[1]

      assert.equal(alice_expectedCollateral, alice_Collateral_After.toString())
      assert.equal(bob_expectedColalteral, bob_Collateral_After.toString())
      assert.equal(carol_expectedCollateral, carol_Collateral_After.toString())

      // Check ETH in SP has reduced to zero
      const ETHinSP_After = await stabilityPool.getWSTETH()
      assert.isAtMost(th.getDifference(ETHinSP_After, toBN('0')), 100000)
    })

    it("withdrawWSTETHGainToTrove(): reverts if user has no trove", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })
      
     // Defaulter opens
     await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A transfers LUSD to D
      await simToken.connect(alice).transfer(dennis.address, dec(10000, 18))

      // D deposits to Stability Pool
      await stabilityPool.connect(dennis).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      //Price drops
      await priceFeed.setPrice(dec(105, 18))

      //Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      await priceFeed.setPrice(dec(200, 18))

      // D attempts to withdraw his ETH gain to Trove
      await th.assertRevert(stabilityPool.connect(dennis).withdrawWSTETHGainToTrove(dennis.address, dennis.address), "caller must have an active trove to withdraw WSTETHGain to")
    })

    it("withdrawWSTETHGainToTrove(): triggers LQTY reward event - increases the sum G", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      
      // A and B provide to SP
      await stabilityPool.connect(A).provideToSP(dec(10000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(10000, 18), ZERO_ADDRESS)

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      await priceFeed.setPrice(dec(200, 18))

      // A withdraws from SP
      await stabilityPool.connect(A).withdrawFromSP(dec(50, 18))

      const G_1 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the LQTY reward event triggered
      assert.isTrue(G_1.gt(G_Before))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Check B has non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(B.address)).gt(ZERO))

      // B withdraws to trove
      await stabilityPool.connect(B).withdrawWSTETHGainToTrove(B.address, B.address)

      const G_2 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the LQTY reward event triggered
      assert.isTrue(G_2.gt(G_1))
    })

    /*it("withdrawWSTETHGainToTrove(), partial withdrawal: doesn't change the front end tag", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      
      // A, B, C, D, E provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), ZERO_ADDRESS, { from: C })

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({  ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(A.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(B.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(C.address)).gt(ZERO))

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C withdraw to trove
      await stabilityPool.withdrawWSTETHGainToTrove(A, A, { from: A })
      await stabilityPool.withdrawWSTETHGainToTrove(B, B, { from: B })
      await stabilityPool.withdrawWSTETHGainToTrove(C, C, { from: C })

      const frontEndTag_A = (await stabilityPool.deposits(A.address))[1]
      const frontEndTag_B = (await stabilityPool.deposits(B.address))[1]
      const frontEndTag_C = (await stabilityPool.deposits(C.address))[1]

      // Check deposits are still tagged with their original front end
      assert.equal(frontEndTag_A, frontEnd_1)
      assert.equal(frontEndTag_B, frontEnd_2)
      assert.equal(frontEndTag_C, ZERO_ADDRESS)
    })*/

    it("withdrawWSTETHGainToTrove(), eligible deposit: depositor receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

       // A, B, C open troves 
       await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
       await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
       await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
       
      // A, B, C, provide to SP
      await stabilityPool.connect(A).provideToSP(dec(1000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(2000, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(3000, 18), ZERO_ADDRESS)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      // Get A, B, C LQTY balance before
      const A_LQTYBalance_Before = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_Before = await shadyToken.balanceOf(B.address)
      const C_LQTYBalance_Before = await shadyToken.balanceOf(C.address)

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(A.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(B.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(C.address)).gt(ZERO))

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C withdraw to trove
      await stabilityPool.connect(A).withdrawWSTETHGainToTrove(A.address, A.address)
      await stabilityPool.connect(B).withdrawWSTETHGainToTrove(B.address, B.address)
      await stabilityPool.connect(C).withdrawWSTETHGainToTrove(C.address, C.address)

      // Get LQTY balance after
      const A_LQTYBalance_After = await shadyToken.balanceOf(A.address)
      const B_LQTYBalance_After = await shadyToken.balanceOf(B.address)
      const C_LQTYBalance_After = await shadyToken.balanceOf(C.address)

      // Check LQTY Balance of A, B, C has increased
      assert.isTrue(A_LQTYBalance_After.gt(A_LQTYBalance_Before))
      assert.isTrue(B_LQTYBalance_After.gt(B_LQTYBalance_Before))
      assert.isTrue(C_LQTYBalance_After.gt(C_LQTYBalance_Before))
    })

    /*it("withdrawWSTETHGainToTrove(), eligible deposit: tagged front end receives LQTY rewards", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

     // A, B, C open troves 
     await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
     await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
     await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
     
      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({  ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
     await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      // Get front ends' LQTY balance before
      const F1_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_1)
      const F2_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_2)
      const F3_LQTYBalance_Before = await shadyToken.balanceOf(frontEnd_3)

      await priceFeed.setPrice(dec(200, 18))

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(A.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(B.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(C.address)).gt(ZERO))

      // A, B, C withdraw
      await stabilityPool.withdrawWSTETHGainToTrove(A, A, { from: A })
      await stabilityPool.withdrawWSTETHGainToTrove(B, B, { from: B })
      await stabilityPool.withdrawWSTETHGainToTrove(C, C, { from: C })

      // Get front ends' LQTY balance after
      const F1_LQTYBalance_After = await shadyToken.balanceOf(frontEnd_1)
      const F2_LQTYBalance_After = await shadyToken.balanceOf(frontEnd_2)
      const F3_LQTYBalance_After = await shadyToken.balanceOf(frontEnd_3)

      // Check LQTY Balance of front ends has increased
      assert.isTrue(F1_LQTYBalance_After.gt(F1_LQTYBalance_Before))
      assert.isTrue(F2_LQTYBalance_After.gt(F2_LQTYBalance_Before))
      assert.isTrue(F3_LQTYBalance_After.gt(F3_LQTYBalance_Before))
    })

    it("withdrawWSTETHGainToTrove(), eligible deposit: tagged front end's stake decreases", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, D, E, F open troves 
     await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
     await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
     await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })
      
      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: C })
      await stabilityPool.provideToSP(dec(1000, 18), ZERO_ADDRESS, { from: D })
      await stabilityPool.provideToSP(dec(2000, 18), frontEnd_2, { from: E })
      await stabilityPool.provideToSP(dec(3000, 18), frontEnd_3, { from: F })

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({  ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      await troveManager.liquidate(defaulter_1.address)
      assert.isFalse(await sortedTroves.contains(defaulter_1.address))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      // Get front ends' stake before
      const F1_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_Before = await stabilityPool.frontEndStakes(frontEnd_3)

      await priceFeed.setPrice(dec(200, 18))

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(A.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(B.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(C.address)).gt(ZERO))

      // A, B, C withdraw to trove
      await stabilityPool.withdrawWSTETHGainToTrove(A, A, { from: A })
      await stabilityPool.withdrawWSTETHGainToTrove(B, B, { from: B })
      await stabilityPool.withdrawWSTETHGainToTrove(C, C, { from: C })

      // Get front ends' stakes after
      const F1_Stake_After = await stabilityPool.frontEndStakes(frontEnd_1)
      const F2_Stake_After = await stabilityPool.frontEndStakes(frontEnd_2)
      const F3_Stake_After = await stabilityPool.frontEndStakes(frontEnd_3)

      // Check front ends' stakes have decreased
      assert.isTrue(F1_Stake_After.lt(F1_Stake_Before))
      assert.isTrue(F2_Stake_After.lt(F2_Stake_Before))
      assert.isTrue(F3_Stake_After.lt(F3_Stake_Before))
    })

    it("withdrawWSTETHGainToTrove(), eligible deposit: tagged front end's snapshots update", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
     await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
     await openTrove({ extraLUSDAmount: toBN(dec(60000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
     
      // D opens trove
      await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
     
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
     
      // --- SETUP ---

      const deposit_A = dec(100, 18)
      const deposit_B = dec(200, 18)
      const deposit_C = dec(300, 18)

      // A, B, C make their initial deposits
      await stabilityPool.provideToSP(deposit_A, ZERO_ADDRESS, { from: A })
      await stabilityPool.provideToSP(deposit_B, frontEnd_2, { from: B })
      await stabilityPool.provideToSP(deposit_C, frontEnd_3, { from: C })

      // fastforward time then make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)

      await stabilityPool.provideToSP(dec(10000, 18), ZERO_ADDRESS, { from: D })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))

      await troveManager.liquidate(defaulter_1.address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // Get front ends' snapshots before
      for (frontEnd of [ZERO_ADDRESS, frontEnd_2, frontEnd_3]) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends, since S corresponds to ETH gain)
        assert.equal(snapshot[1], dec(1, 18))  // P 
        assert.equal(snapshot[2], '0')  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }

      // --- TEST ---

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(A.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(B.address)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorWSTETHGain(C.address)).gt(ZERO))

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C withdraw ETH gain to troves. Grab G at each stage, as it can increase a bit
      // between topups, because some block.timestamp time passes (and LQTY is issued) between ops
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawWSTETHGainToTrove(A, A, { from: A })

      const G2 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawWSTETHGainToTrove(B, B, { from: B })

      const G3 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawWSTETHGainToTrove(C, C, { from: C })

      const frontEnds = [ZERO_ADDRESS, frontEnd_2, frontEnd_3]
      const G_Values = [G1, G2, G3]

      // Map frontEnds to the value of G at time the deposit was made
      frontEndToG = th.zipToObject(frontEnds, G_Values)

      // Get front ends' snapshots after
      for (const [frontEnd, G] of Object.entries(frontEndToG)) {
        const snapshot = await stabilityPool.frontEndSnapshots(frontEnd)

        // Check snapshots are the expected values
        assert.equal(snapshot[0], '0')  // S (should always be 0 for front ends)
        assert.isTrue(snapshot[1].eq(P_Before))  // P 
        assert.isTrue(snapshot[2].eq(G))  // G
        assert.equal(snapshot[3], '0')  // scale
        assert.equal(snapshot[4], '0')  // epoch
      }
    })*/

    it("withdrawWSTETHGainToTrove(): reverts when depositor has no ETH gain", async () => {
      await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers LUSD to A, B
      await simToken.connect(whale).transfer(A.address, dec(10000, 18))
      await simToken.connect(whale).transfer(B.address, dec(20000, 18))

      // C, D open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      
      // A, B, C, D provide to SP
      await stabilityPool.connect(A).provideToSP(dec(10, 18), ZERO_ADDRESS)
      await stabilityPool.connect(B).provideToSP(dec(20, 18), ZERO_ADDRESS)
      await stabilityPool.connect(C).provideToSP(dec(30, 18), ZERO_ADDRESS)
      await stabilityPool.connect(D).provideToSP(dec(40, 18), ZERO_ADDRESS)

      // fastforward time, and E makes a deposit, creating LQTY rewards for all
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR)
      await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      await stabilityPool.connect(E).provideToSP(dec(3000, 18), ZERO_ADDRESS)

      // Confirm A, B, C have zero ETH gain
      assert.equal((await stabilityPool.getDepositorWSTETHGain(A.address)).toString(), '0')
      assert.equal((await stabilityPool.getDepositorWSTETHGain(B.address)).toString(), '0')
      assert.equal((await stabilityPool.getDepositorWSTETHGain(C.address)).toString(), '0')

      // Check withdrawETHGainToTrove reverts for A, B, C
      const txPromise_A = stabilityPool.connect(A).withdrawWSTETHGainToTrove(A.address, A.address)
      const txPromise_B = stabilityPool.connect(B).withdrawWSTETHGainToTrove(B.address, B.address)
      const txPromise_C = stabilityPool.connect(C).withdrawWSTETHGainToTrove(C.address, C.address)
      const txPromise_D = stabilityPool.connect(D).withdrawWSTETHGainToTrove(D.address, D.address)

      await th.assertRevert(txPromise_A)
      await th.assertRevert(txPromise_B)
      await th.assertRevert(txPromise_C)
      await th.assertRevert(txPromise_D)
    })

    /*it("registerFrontEnd(): registers the front end and chosen kickback rate", async () => {
      const unregisteredFrontEnds = [A, B, C, D, E]

      for (const frontEnd of unregisteredFrontEnds) {
        assert.isFalse((await stabilityPool.frontEnds(frontEnd))[1])  // check inactive
        assert.equal((await stabilityPool.frontEnds(frontEnd))[0], '0') // check no chosen kickback rate
      }

      await stabilityPool.registerFrontEnd(dec(1, 18), { from: A })
      await stabilityPool.registerFrontEnd('897789897897897', { from: B })
      await stabilityPool.registerFrontEnd('99990098', { from: C })
      await stabilityPool.registerFrontEnd('37', { from: D })
      await stabilityPool.registerFrontEnd('0', { from: E })

      // Check front ends are registered as active, and have correct kickback rates
      assert.isTrue((await stabilityPool.frontEnds(A.address))[1])
      assert.equal((await stabilityPool.frontEnds(A.address))[0], dec(1, 18))

      assert.isTrue((await stabilityPool.frontEnds(B.address))[1])
      assert.equal((await stabilityPool.frontEnds(B.address))[0], '897789897897897')

      assert.isTrue((await stabilityPool.frontEnds(C.address))[1])
      assert.equal((await stabilityPool.frontEnds(C.address))[0], '99990098')

      assert.isTrue((await stabilityPool.frontEnds(D))[1])
      assert.equal((await stabilityPool.frontEnds(D))[0], '37')

      assert.isTrue((await stabilityPool.frontEnds(E))[1])
      assert.equal((await stabilityPool.frontEnds(E))[0], '0')
    })

    it("registerFrontEnd(): reverts if the front end is already registered", async () => {

      await stabilityPool.registerFrontEnd(dec(1, 18), { from: A })
      await stabilityPool.registerFrontEnd('897789897897897', { from: B })
      await stabilityPool.registerFrontEnd('99990098', { from: C })

      const _2ndAttempt_A = stabilityPool.registerFrontEnd(dec(1, 18), { from: A })
      const _2ndAttempt_B = stabilityPool.registerFrontEnd('897789897897897', { from: B })
      const _2ndAttempt_C = stabilityPool.registerFrontEnd('99990098', { from: C })

      await th.assertRevert(_2ndAttempt_A, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(_2ndAttempt_B, "StabilityPool: must not already be a registered front end")
      await th.assertRevert(_2ndAttempt_C, "StabilityPool: must not already be a registered front end")
    })

    it("registerFrontEnd(): reverts if the kickback rate >1", async () => {

      const invalidKickbackTx_A = stabilityPool.registerFrontEnd(dec(1, 19), { from: A })
      const invalidKickbackTx_B = stabilityPool.registerFrontEnd('1000000000000000001', { from: A })
      const invalidKickbackTx_C = stabilityPool.registerFrontEnd(dec(23423, 45), { from: A })
      const invalidKickbackTx_D = stabilityPool.registerFrontEnd(maxBytes32, { from: A })

      await th.assertRevert(invalidKickbackTx_A, "StabilityPool: Kickback rate must be in range [0,1]")
      await th.assertRevert(invalidKickbackTx_B, "StabilityPool: Kickback rate must be in range [0,1]")
      await th.assertRevert(invalidKickbackTx_C, "StabilityPool: Kickback rate must be in range [0,1]")
      await th.assertRevert(invalidKickbackTx_D, "StabilityPool: Kickback rate must be in range [0,1]")
    })

    it("registerFrontEnd(): reverts if address has a non-zero deposit already", async () => {
      // C, D, E open troves 
      await openTrove({ extraLUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ extraLUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
      await openTrove({ extraLUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
      
      // C, E provides to SP
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: C })
      await stabilityPool.provideToSP(dec(10, 18), ZERO_ADDRESS, { from: E })

      const txPromise_C = stabilityPool.registerFrontEnd(dec(1, 18), { from: C })
      const txPromise_E = stabilityPool.registerFrontEnd(dec(1, 18), { from: E })
      await th.assertRevert(txPromise_C, "StabilityPool: User must have no deposit")
      await th.assertRevert(txPromise_E, "StabilityPool: User must have no deposit")

      // D, with no deposit, successfully registers a front end
      const txD = await stabilityPool.registerFrontEnd(dec(1, 18), { from: D })
      assert.isTrue(txD.receipt.status)
    })*/

  })
})
