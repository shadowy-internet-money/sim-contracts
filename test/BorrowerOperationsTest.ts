import {assert} from "hardhat";
import {
    ActivePool,
    BorrowerOperationsTester, DefaultPool,
    PriceFeedMock, SIMTokenTester,
    SortedTroves,
    TroveManagerTester
} from "../typechain-types";
import {IContracts, IOpenTroveParams} from "../utils/types";
import {TestHelper} from "../utils/TestHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {parseUnits} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {BigNumber} from "ethers";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const ZERO_ADDRESS = th.ZERO_ADDRESS

describe('BorrowerOperations', async () => {
    let bountyAddress: string, lpRewardsAddress: string, multisig: string

    let contracts: IContracts
    let priceFeed: PriceFeedMock
    let troveManager: TroveManagerTester
    let borrowerOperations: BorrowerOperationsTester
    let activePool: ActivePool
    let sortedTroves: SortedTroves
    let simToken: SIMTokenTester
    let defaultPool: DefaultPool

    let owner:SignerWithAddress, alice:SignerWithAddress, bob:SignerWithAddress, carol:SignerWithAddress, dennis:SignerWithAddress, whale:SignerWithAddress, A:SignerWithAddress, B:SignerWithAddress, C:SignerWithAddress, D:SignerWithAddress, E:SignerWithAddress, F:SignerWithAddress, G:SignerWithAddress, H:SignerWithAddress

    let MIN_NET_DEBT: BigNumber
    let BORROWING_FEE_FLOOR: BigNumber

    const openTrove = async (params: IOpenTroveParams) => th.openTrove(contracts, params)
    const getTroveEntireColl = async (trove: string) => th.getTroveEntireColl(contracts, trove)
    const getTroveEntireDebt = async (trove: string) => th.getTroveEntireDebt(contracts, trove)
    const getNetBorrowingAmount = async (debtWithFee: BigNumber) => th.getNetBorrowingAmount(contracts, debtWithFee)
    const getOpenTroveLUSDAmount = async (totalDebt: BigNumber) => th.getOpenTroveLUSDAmount(contracts, totalDebt)

    beforeEach(async () => {
        const f = await loadFixture(DeploymentHelper.deployFixture);
        [
            owner, alice, bob, carol, dennis, whale,
            A, B, C, D, E, F, G, H,
        ] = f.signers;
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

        MIN_NET_DEBT = await borrowerOperations.MIN_NET_DEBT()
        BORROWING_FEE_FLOOR = await borrowerOperations.BORROWING_FEE_FLOOR()
    })

    it("addColl(): reverts when top-up would leave trove with ICR < MCR", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        // Price drops
        await priceFeed.setPrice(dec(100, 18))
        const price = await priceFeed.getPrice()

        assert.isFalse(await troveManager.checkRecoveryMode(price))
        assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(toBN(dec(110, 16))))

        const collTopUp = 1  // 1 wei top up

        await assertRevert(borrowerOperations.connect(alice).addColl(collTopUp, alice.address, alice.address),
            "BorrowerOps: An operation that would result in ICR < MCR is not permitted")
    })

    it("addColl(): Increases the activePool ETH and raw ether balance by correct amount", async () => {
        const { collateral: aliceColl } = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const activePool_ETH_Before = await activePool.getWSTETH()
        const activePool_RawEther_Before = await contracts.wstETHMock.balanceOf(activePool.address)

        assert.isTrue(activePool_ETH_Before.eq(aliceColl))
        assert.isTrue(activePool_RawEther_Before.eq(aliceColl))

        await borrowerOperations.connect(alice).addColl(dec(1, 'ether'), alice.address, alice.address)

        const activePool_ETH_After = await activePool.getWSTETH()
        const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_After.eq(aliceColl.add(toBN(dec(1, 'ether')))))
        assert.isTrue(activePool_RawEther_After.eq(aliceColl.add(toBN(dec(1, 'ether')))))
    })

    it("addColl(), active Trove: adds the correct collateral amount to the Trove", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const coll_before = alice_Trove_Before[1]
        const status_Before = alice_Trove_Before[3]

        // check status before
        assert.equal(status_Before, 1)

        // Alice adds second collateral
        await borrowerOperations.connect(alice).addColl(dec(1, 'ether'), alice.address, alice.address)

        const alice_Trove_After = await troveManager.Troves(alice.address)
        const coll_After = alice_Trove_After[1]
        const status_After = alice_Trove_After[3]

        // check coll increases by correct amount,and status remains active
        assert.isTrue(coll_After.eq(coll_before.add(toBN(dec(1, 'ether')))))
        assert.equal(status_After, 1)
    })

    it("addColl(), active Trove: Trove is in sortedList before and after", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // check Alice is in list before
        const aliceTroveInList_Before = await sortedTroves.contains(alice.address)
        const listIsEmpty_Before = await sortedTroves.isEmpty()
        assert.equal(aliceTroveInList_Before, true)
        assert.equal(listIsEmpty_Before, false)

        await borrowerOperations.connect(alice).addColl(dec(1, 'ether'), alice.address, alice.address)

        // check Alice is still in list after
        const aliceTroveInList_After = await sortedTroves.contains(alice.address)
        const listIsEmpty_After = await sortedTroves.isEmpty()
        assert.equal(aliceTroveInList_After, true)
        assert.equal(listIsEmpty_After, false)
    })

    it("addColl(), active Trove: updates the stake and updates the total stakes", async () => {
        //  Alice creates initial Trove with 1 ether
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const alice_Stake_Before = alice_Trove_Before[2]
        const totalStakes_Before = (await troveManager.totalStakes())

        assert.isTrue(totalStakes_Before.eq(alice_Stake_Before))

        // Alice tops up Trove collateral with 2 ether
        await borrowerOperations.connect(alice).addColl(dec(2, 'ether'), alice.address, alice.address)

        // Check stake and total stakes get updated
        const alice_Trove_After = await troveManager.Troves(alice.address)
        const alice_Stake_After = alice_Trove_After[2]
        const totalStakes_After = (await troveManager.totalStakes())

        assert.isTrue(alice_Stake_After.eq(alice_Stake_Before.add(toBN(dec(2, 'ether')))))
        assert.isTrue(totalStakes_After.eq(totalStakes_Before.add(toBN(dec(2, 'ether')))))
    })

    it("addColl(), active Trove: applies pending rewards and updates user's L_WSTETH, L_SIMDebt snapshots", async () => {
        // --- SETUP ---

        const { collateral: aliceCollBefore, totalDebt: aliceDebtBefore } = await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const { collateral: bobCollBefore, totalDebt: bobDebtBefore } = await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        // --- TEST ---

        // price drops to 1ETH:100LUSD, reducing Carol's ICR below MCR
        await priceFeed.setPrice('100000000000000000000');

        // Liquidate Carol's Trove,
        const tx = await troveManager.connect(owner).liquidate(carol.address);

        assert.isFalse(await sortedTroves.contains(carol.address))

        const L_ETH = await troveManager.L_WSTETH()
        const L_LUSDDebt = await troveManager.L_SIMDebt()

        // check Alice and Bob's reward snapshots are zero before they alter their Troves
        const alice_rewardSnapshot_Before = await troveManager.rewardSnapshots(alice.address)
        const alice_ETHrewardSnapshot_Before = alice_rewardSnapshot_Before[0]
        const alice_LUSDDebtRewardSnapshot_Before = alice_rewardSnapshot_Before[1]

        const bob_rewardSnapshot_Before = await troveManager.rewardSnapshots(bob.address)
        const bob_ETHrewardSnapshot_Before = bob_rewardSnapshot_Before[0]
        const bob_LUSDDebtRewardSnapshot_Before = bob_rewardSnapshot_Before[1]

        assert.equal(alice_ETHrewardSnapshot_Before.toString(), '0')
        assert.equal(alice_LUSDDebtRewardSnapshot_Before.toString(), '0')
        assert.equal(bob_ETHrewardSnapshot_Before.toString(), '0')
        assert.equal(bob_LUSDDebtRewardSnapshot_Before.toString(), '0')

        const alicePendingETHReward = await troveManager.getPendingWSTETHReward(alice.address)
        const bobPendingETHReward = await troveManager.getPendingWSTETHReward(bob.address)
        const alicePendingLUSDDebtReward = await troveManager.getPendingSIMDebtReward(alice.address)
        const bobPendingLUSDDebtReward = await troveManager.getPendingSIMDebtReward(bob.address)
        for (const reward of [alicePendingETHReward, bobPendingETHReward, alicePendingLUSDDebtReward, bobPendingLUSDDebtReward]) {
            assert.isTrue(reward.gt(toBN('0')))
        }

        // Alice and Bob top up their Troves
        const aliceTopUp = toBN(dec(5, 'ether'))
        const bobTopUp = toBN(dec(1, 'ether'))

        await borrowerOperations.connect(alice).addColl(aliceTopUp, alice.address, alice.address)
        await borrowerOperations.connect(bob).addColl(bobTopUp, bob.address, bob.address)

        // Check that both alice and Bob have had pending rewards applied in addition to their top-ups.
        const aliceNewColl = await getTroveEntireColl(alice.address)
        const aliceNewDebt = await getTroveEntireDebt(alice.address)
        const bobNewColl = await getTroveEntireColl(bob.address)
        const bobNewDebt = await getTroveEntireDebt(bob.address)

        assert.isTrue(aliceNewColl.eq(aliceCollBefore.add(alicePendingETHReward).add(aliceTopUp)))
        assert.isTrue(aliceNewDebt.eq(aliceDebtBefore.add(alicePendingLUSDDebtReward)))
        assert.isTrue(bobNewColl.eq(bobCollBefore.add(bobPendingETHReward).add(bobTopUp)))
        assert.isTrue(bobNewDebt.eq(bobDebtBefore.add(bobPendingLUSDDebtReward)))

        /* Check that both Alice and Bob's snapshots of the rewards-per-unit-staked metrics should be updated
         to the latest values of L_ETH and L_LUSDDebt */
        const alice_rewardSnapshot_After = await troveManager.rewardSnapshots(alice.address)
        const alice_ETHrewardSnapshot_After = alice_rewardSnapshot_After[0]
        const alice_LUSDDebtRewardSnapshot_After = alice_rewardSnapshot_After[1]

        const bob_rewardSnapshot_After = await troveManager.rewardSnapshots(bob.address)
        const bob_ETHrewardSnapshot_After = bob_rewardSnapshot_After[0]
        const bob_LUSDDebtRewardSnapshot_After = bob_rewardSnapshot_After[1]

        assert.isAtMost(th.getDifference(alice_ETHrewardSnapshot_After, L_ETH), 100)
        assert.isAtMost(th.getDifference(alice_LUSDDebtRewardSnapshot_After, L_LUSDDebt), 100)
        assert.isAtMost(th.getDifference(bob_ETHrewardSnapshot_After, L_ETH), 100)
        assert.isAtMost(th.getDifference(bob_LUSDDebtRewardSnapshot_After, L_LUSDDebt), 100)
    })

    it("addColl(), reverts if trove is non-existent or closed", async () => {
        // A, B open troves
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Carol attempts to add collateral to her non-existent trove
        await contracts.wstETHMock.connect(carol).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        try {
            await borrowerOperations.connect(carol).addColl(dec(1, 'ether'), carol.address, carol.address)
            assert.isFalse(1)
        } catch (error) {
            assert.include(error?.toString(), "revert")
            assert.include(error?.toString(), "Trove does not exist or is closed")
        }

        // Price drops
        await priceFeed.setPrice(dec(100, 18))

        // Bob gets liquidated
        await troveManager.liquidate(bob.address)

        assert.isFalse(await sortedTroves.contains(bob.address))

        // Bob attempts to add collateral to his closed trove
        try {
            await borrowerOperations.connect(bob).addColl(dec(1, 'ether'), bob.address, bob.address)
            assert.isFalse(1)
        } catch (error) {
            assert.include(error?.toString(), "revert")
            assert.include(error?.toString(), "Trove does not exist or is closed")
        }
    })

    it('addColl(): can add collateral in Recovery Mode', async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const aliceCollBefore = await getTroveEntireColl(alice.address)
        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice('105000000000000000000')

        assert.isTrue(await th.checkRecoveryMode(contracts))

        const collTopUp = toBN(dec(1, 'ether'))
        await borrowerOperations.connect(alice).addColl(collTopUp, alice.address, alice.address)

        // Check Alice's collateral
        const aliceCollAfter = (await troveManager.Troves(alice.address))[1]
        assert.isTrue(aliceCollAfter.eq(aliceCollBefore.add(collTopUp)))
    })

    it("withdrawColl(): reverts when withdrawal would leave trove with ICR < MCR", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        // Price drops
        await priceFeed.setPrice(dec(100, 18))
        const price = await priceFeed.getPrice()

        assert.isFalse(await troveManager.checkRecoveryMode(price))
        assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(toBN(dec(110, 16))))

        const collWithdrawal = 1  // 1 wei withdrawal

        await assertRevert(borrowerOperations.connect(alice).withdrawColl(1, alice.address, alice.address),
            "BorrowerOps: An operation that would result in ICR < MCR is not permitted")
    })

    it("withdrawColl(): reverts when system is in Recovery Mode", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        assert.isFalse(await th.checkRecoveryMode(contracts))

        // Withdrawal possible when recoveryMode == false
        await borrowerOperations.connect(alice).withdrawColl(1000, alice.address, alice.address)

        await priceFeed.setPrice('105000000000000000000')

        assert.isTrue(await th.checkRecoveryMode(contracts))

        //Check withdrawal impossible when recoveryMode == true
        try {
            await borrowerOperations.connect(bob).withdrawColl(1000, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawColl(): reverts when requested ETH withdrawal is > the trove's collateral", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        const carolColl = await getTroveEntireColl(carol.address)
        const bobColl = await getTroveEntireColl(bob.address)
        // Carol withdraws exactly all her collateral
        await assertRevert(
            borrowerOperations.connect(carol).withdrawColl(carolColl, carol.address, carol.address),
            'BorrowerOps: An operation that would result in ICR < MCR is not permitted'
        )

        // Bob attempts to withdraw 1 wei more than his collateral
        try {
            await borrowerOperations.connect(bob).withdrawColl(bobColl.add(toBN(1)), bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawColl(): reverts when withdrawal would bring the user's ICR < MCR", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ ICR: toBN(dec(11, 17)), extraParams: { from: bob } }) // 110% ICR

        // Bob attempts to withdraws 1 wei, Which would leave him with < 110% ICR.

        try {
            await borrowerOperations.connect(bob).withdrawColl(1, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawColl(): reverts if system is in Recovery Mode", async () => {
        // --- SETUP ---

        // A and B open troves at 150% ICR
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: bob } })
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: alice } })

        const TCR = (await th.getTCR(contracts)).toString()
        assert.equal(TCR, '1500000000000000000')

        // --- TEST ---

        // price drops to 1ETH:150LUSD, reducing TCR below 150%
        await priceFeed.setPrice('150000000000000000000');

        //Alice tries to withdraw collateral during Recovery Mode
        try {
            await borrowerOperations.connect(alice).withdrawColl('1', alice.address, alice.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), 'revert')
        }
    })

    it("withdrawColl(): doesn’t allow a user to completely withdraw all collateral from their Trove (due to gas compensation)", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceColl = (await troveManager.getEntireDebtAndColl(alice.address))[1]

        // Check Trove is active
        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const status_Before = alice_Trove_Before[3]
        assert.equal(status_Before, 1)
        assert.isTrue(await sortedTroves.contains(alice.address))

        // Alice attempts to withdraw all collateral
        await assertRevert(
            borrowerOperations.connect(alice).withdrawColl(aliceColl, alice.address, alice.address),
            'BorrowerOps: An operation that would result in ICR < MCR is not permitted'
        )
    })

    it("withdrawColl(): leaves the Trove active when the user withdraws less than all the collateral", async () => {
        // Open Trove
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // Check Trove is active
        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const status_Before = alice_Trove_Before[3]
        assert.equal(status_Before, 1)
        assert.isTrue(await sortedTroves.contains(alice.address))

        // Withdraw some collateral
        await borrowerOperations.connect(alice).withdrawColl(dec(100, 'finney'), alice.address, alice.address)

        // Check Trove is still active
        const alice_Trove_After = await troveManager.Troves(alice.address)
        const status_After = alice_Trove_After[3]
        assert.equal(status_After, 1)
        assert.isTrue(await sortedTroves.contains(alice.address))
    })

    it("withdrawColl(): reduces the Trove's collateral by the correct amount", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const aliceCollBefore = await getTroveEntireColl(alice.address)

        // Alice withdraws 1 ether
        await borrowerOperations.connect(alice).withdrawColl(dec(1, 'ether'), alice.address, alice.address)

        // Check 1 ether remaining
        const alice_Trove_After = await troveManager.Troves(alice.address)
        const aliceCollAfter = await getTroveEntireColl(alice.address)

        assert.isTrue(aliceCollAfter.eq(aliceCollBefore.sub(toBN(dec(1, 'ether')))))
    })

    it("withdrawColl(): reduces ActivePool ETH and raw ether by correct amount", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const aliceCollBefore = await getTroveEntireColl(alice.address)

        // check before
        const activePool_ETH_before = await activePool.getWSTETH()
        const activePool_RawEther_before = await contracts.wstETHMock.balanceOf(activePool.address)

        await borrowerOperations.connect(alice).withdrawColl(dec(1, 'ether'), alice.address, alice.address)

        // check after
        const activePool_ETH_After = await activePool.getWSTETH()
        const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_After.eq(activePool_ETH_before.sub(toBN(dec(1, 'ether')))))
        assert.isTrue(activePool_RawEther_After.eq(activePool_RawEther_before.sub(toBN(dec(1, 'ether')))))
    })

    it("withdrawColl(): updates the stake and updates the total stakes", async () => {
        //  Alice creates initial Trove with 2 ether
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice, value: toBN(dec(5, 'ether')) } })
        const aliceColl = await getTroveEntireColl(alice.address)
        assert.isTrue(aliceColl.gt(toBN('0')))

        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const alice_Stake_Before = alice_Trove_Before[2]
        const totalStakes_Before = (await troveManager.totalStakes())

        assert.isTrue(alice_Stake_Before.eq(aliceColl))
        assert.isTrue(totalStakes_Before.eq(aliceColl))

        // Alice withdraws 1 ether
        await borrowerOperations.connect(alice).withdrawColl(dec(1, 'ether'), alice.address, alice.address)

        // Check stake and total stakes get updated
        const alice_Trove_After = await troveManager.Troves(alice.address)
        const alice_Stake_After = alice_Trove_After[2]
        const totalStakes_After = (await troveManager.totalStakes())

        assert.isTrue(alice_Stake_After.eq(alice_Stake_Before.sub(toBN(dec(1, 'ether')))))
        assert.isTrue(totalStakes_After.eq(totalStakes_Before.sub(toBN(dec(1, 'ether')))))
    })

    it("withdrawColl(): sends the correct amount of ETH to the user", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice, value: dec(2, 'ether') } })

        const alice_ETHBalance_Before = await contracts.wstETHMock.balanceOf(alice.address)
        await borrowerOperations.connect(alice).withdrawColl(dec(1, 'ether'), alice.address, alice.address)

        const alice_ETHBalance_After = await contracts.wstETHMock.balanceOf(alice.address)
        const balanceDiff = alice_ETHBalance_After.sub(alice_ETHBalance_Before)

        assert.isTrue(balanceDiff.eq(toBN(dec(1, 'ether'))))
    })

    it("withdrawColl(): applies pending rewards and updates user's L_ETH, L_LUSDDebt snapshots", async () => {
        // --- SETUP ---
        // Alice adds 15 ether, Bob adds 5 ether, Carol adds 1 ether
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: alice, value: toBN(dec(100, 'ether')) } })
        await openTrove({ ICR: toBN(dec(3, 18)), extraParams: { from: bob, value: toBN(dec(100, 'ether')) } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol, value: toBN(dec(10, 'ether')) } })

        const aliceCollBefore = await getTroveEntireColl(alice.address)
        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        const bobCollBefore = await getTroveEntireColl(bob.address)
        const bobDebtBefore = await getTroveEntireDebt(bob.address)

        // --- TEST ---

        // price drops to 1ETH:100LUSD, reducing Carol's ICR below MCR
        await priceFeed.setPrice('100000000000000000000');

        // close Carol's Trove, liquidating her 1 ether and 180LUSD.
        await troveManager.liquidate(carol.address);

        const L_ETH = await troveManager.L_WSTETH()
        const L_LUSDDebt = await troveManager.L_SIMDebt()

        // check Alice and Bob's reward snapshots are zero before they alter their Troves
        const alice_rewardSnapshot_Before = await troveManager.rewardSnapshots(alice.address)
        const alice_ETHrewardSnapshot_Before = alice_rewardSnapshot_Before[0]
        const alice_LUSDDebtRewardSnapshot_Before = alice_rewardSnapshot_Before[1]

        const bob_rewardSnapshot_Before = await troveManager.rewardSnapshots(bob.address)
        const bob_ETHrewardSnapshot_Before = bob_rewardSnapshot_Before[0]
        const bob_LUSDDebtRewardSnapshot_Before = bob_rewardSnapshot_Before[1]

        assert.equal(alice_ETHrewardSnapshot_Before.toNumber(), 0)
        assert.equal(alice_LUSDDebtRewardSnapshot_Before.toNumber(), 0)
        assert.equal(bob_ETHrewardSnapshot_Before.toNumber(), 0)
        assert.equal(bob_LUSDDebtRewardSnapshot_Before.toNumber(), 0)

        // Check A and B have pending rewards
        const pendingCollReward_A = await troveManager.getPendingWSTETHReward(alice.address)
        const pendingDebtReward_A = await troveManager.getPendingSIMDebtReward(alice.address)
        const pendingCollReward_B = await troveManager.getPendingWSTETHReward(bob.address)
        const pendingDebtReward_B = await troveManager.getPendingSIMDebtReward(bob.address)
        for (const reward of [pendingCollReward_A, pendingDebtReward_A, pendingCollReward_B, pendingDebtReward_B]) {
            assert.isTrue(reward.gt(toBN('0')))
        }

        // Alice and Bob withdraw from their Troves
        const aliceCollWithdrawal = toBN(dec(5, 'ether'))
        const bobCollWithdrawal = toBN(dec(1, 'ether'))

        await borrowerOperations.connect(alice).withdrawColl(aliceCollWithdrawal, alice.address, alice.address)
        await borrowerOperations.connect(bob).withdrawColl(bobCollWithdrawal, bob.address, bob.address)

        // Check that both alice and Bob have had pending rewards applied in addition to their top-ups.
        const aliceCollAfter = await getTroveEntireColl(alice.address)
        const aliceDebtAfter = await getTroveEntireDebt(alice.address)
        const bobCollAfter = await getTroveEntireColl(bob.address)
        const bobDebtAfter = await getTroveEntireDebt(bob.address)

        // Check rewards have been applied to troves
        th.assertIsApproximatelyEqual(aliceCollAfter, aliceCollBefore.add(pendingCollReward_A).sub(aliceCollWithdrawal), 10000)
        th.assertIsApproximatelyEqual(aliceDebtAfter, aliceDebtBefore.add(pendingDebtReward_A), 10000)
        th.assertIsApproximatelyEqual(bobCollAfter, bobCollBefore.add(pendingCollReward_B).sub(bobCollWithdrawal), 10000)
        th.assertIsApproximatelyEqual(bobDebtAfter, bobDebtBefore.add(pendingDebtReward_B), 10000)

        /* After top up, both Alice and Bob's snapshots of the rewards-per-unit-staked metrics should be updated
         to the latest values of L_ETH and L_LUSDDebt */
        const alice_rewardSnapshot_After = await troveManager.rewardSnapshots(alice.address)
        const alice_ETHrewardSnapshot_After = alice_rewardSnapshot_After[0]
        const alice_LUSDDebtRewardSnapshot_After = alice_rewardSnapshot_After[1]

        const bob_rewardSnapshot_After = await troveManager.rewardSnapshots(bob.address)
        const bob_ETHrewardSnapshot_After = bob_rewardSnapshot_After[0]
        const bob_LUSDDebtRewardSnapshot_After = bob_rewardSnapshot_After[1]

        assert.isAtMost(th.getDifference(alice_ETHrewardSnapshot_After, L_ETH), 100)
        assert.isAtMost(th.getDifference(alice_LUSDDebtRewardSnapshot_After, L_LUSDDebt), 100)
        assert.isAtMost(th.getDifference(bob_ETHrewardSnapshot_After, L_ETH), 100)
        assert.isAtMost(th.getDifference(bob_LUSDDebtRewardSnapshot_After, L_LUSDDebt), 100)
    })

    it("withdrawSIM(): reverts when withdrawal would leave trove with ICR < MCR", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        // Price drops
        await priceFeed.setPrice(dec(100, 18))
        const price = await priceFeed.getPrice()

        assert.isFalse(await troveManager.checkRecoveryMode(price))
        assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(toBN(dec(110, 16))))

        const LUSDwithdrawal = 1  // withdraw 1 wei LUSD

        await assertRevert(borrowerOperations.connect(alice).withdrawSIM(th._100pct, LUSDwithdrawal, alice.address, alice.address),
            "BorrowerOps: An operation that would result in ICR < MCR is not permitted")
    })

    it("withdrawSIM(): decays a non-zero base rate", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(20, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(20, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(20, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        await openTrove({ extraLUSDAmount: toBN(dec(20, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        const A_LUSDBal = await simToken.balanceOf(A.address)

        // Artificially set base rate to 5%
        await troveManager.setBaseRate(dec(5, 16))

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D withdraws LUSD
        await borrowerOperations.connect(D).withdrawSIM(th._100pct, dec(1, 18), A.address, A.address)

        // Check baseRate has decreased
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.lt(baseRate_1))

        // 1 hour passes
        await th.fastForwardTime(3600)

        // E withdraws LUSD
        await borrowerOperations.connect(E).withdrawSIM(th._100pct, dec(1, 18), A.address, A.address)

        const baseRate_3 = await troveManager.baseRate()
        assert.isTrue(baseRate_3.lt(baseRate_2))
    })

    it("withdrawSIM(): reverts if max fee > 100%", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(20, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        await assertRevert(borrowerOperations.connect(A).withdrawSIM(dec(2, 18), dec(1, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await assertRevert(borrowerOperations.connect(A).withdrawSIM('1000000000000000001', dec(1, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
    })

    it("withdrawSIM(): reverts if max fee < 0.5% in Normal mode", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(20, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        await assertRevert(borrowerOperations.connect(A).withdrawSIM(0, dec(1, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await assertRevert(borrowerOperations.connect(A).withdrawSIM(1, dec(1, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await assertRevert(borrowerOperations.connect(A).withdrawSIM('4999999999999999', dec(1, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
    })

    it("withdrawSIM(): reverts if fee exceeds max fee percentage", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(60, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(60, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(70, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(80, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        await openTrove({ extraLUSDAmount: toBN(dec(180, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        const totalSupply = await simToken.totalSupply()

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        let baseRate = await troveManager.baseRate() // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))

        // 100%: 1e18,  10%: 1e17,  1%: 1e16,  0.1%: 1e15
        // 5%: 5e16
        // 0.5%: 5e15
        // actual: 0.5%, 5e15


        // LUSDFee:                  15000000558793542
        // absolute _fee:            15000000558793542
        // actual feePercentage:      5000000186264514
        // user's _maxFeePercentage: 49999999999999999

        const lessThan5pct = '49999999999999999'
        await assertRevert(borrowerOperations.connect(A).withdrawSIM(lessThan5pct, dec(3, 18), A.address, A.address), "Fee exceeded provided maximum")

        baseRate = await troveManager.baseRate() // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))
        // Attempt with maxFee 1%
        await assertRevert(borrowerOperations.connect(B).withdrawSIM(dec(1, 16), dec(1, 18), A.address, A.address), "Fee exceeded provided maximum")

        baseRate = await troveManager.baseRate()  // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))
        // Attempt with maxFee 3.754%
        await assertRevert(borrowerOperations.connect(C).withdrawSIM(dec(3754, 13), dec(1, 18), A.address, A.address), "Fee exceeded provided maximum")

        baseRate = await troveManager.baseRate()  // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))
        // Attempt with maxFee 0.5%%
        await assertRevert(borrowerOperations.connect(D).withdrawSIM(dec(5, 15), dec(1, 18), A.address, A.address), "Fee exceeded provided maximum")
    })

    it("withdrawSIM(): succeeds when fee is less than max fee percentage", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(60, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(60, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(70, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(80, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        await openTrove({ extraLUSDAmount: toBN(dec(180, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        const totalSupply = await simToken.totalSupply()

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        let baseRate = await troveManager.baseRate() // expect 5% base rate
        assert.isTrue(baseRate.eq(toBN(dec(5, 16))))

        // Attempt with maxFee > 5%
        const moreThan5pct = '50000000000000001'
        /*const tx1 = */await borrowerOperations.connect(A).withdrawSIM(moreThan5pct, dec(1, 18), A.address, A.address)
        // // assert.isTrue(tx1.receipt.status)

        baseRate = await troveManager.baseRate() // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))

        // Attempt with maxFee = 5%
        /*const tx2 = */await borrowerOperations.connect(B).withdrawSIM(dec(5, 16), dec(1, 18), A.address, A.address)
        // assert.isTrue(tx2.receipt.status)

        baseRate = await troveManager.baseRate() // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))

        // Attempt with maxFee 10%
        /*const tx3 = */await borrowerOperations.connect(C).withdrawSIM(dec(1, 17), dec(1, 18), A.address, A.address)
        // assert.isTrue(tx3.receipt.status)

        baseRate = await troveManager.baseRate() // expect 5% base rate
        assert.equal(baseRate.toString(), dec(5, 16))

        // Attempt with maxFee 37.659%
        /*const tx4 = */await borrowerOperations.connect(D).withdrawSIM(dec(37659, 13), dec(1, 18), A.address, A.address)
        // assert.isTrue(tx4.receipt.status)

        // Attempt with maxFee 100%
        /*const tx5 = */await borrowerOperations.connect(E).withdrawSIM(dec(1, 18), dec(1, 18), A.address, A.address)
        // assert.isTrue(tx5.receipt.status)
    })

    it("withdrawSIM(): doesn't change base rate if it is already zero", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D withdraws LUSD
        await borrowerOperations.connect(D).withdrawSIM(th._100pct, dec(37, 18), A.address, A.address)

        // Check baseRate is still 0
        const baseRate_2 = await troveManager.baseRate()
        assert.equal(baseRate_2.toString(), '0')

        // 1 hour passes
        await th.fastForwardTime(3600)

        // E opens trove 
        await borrowerOperations.connect(E).withdrawSIM(th._100pct, dec(12, 18), A.address, A.address)

        const baseRate_3 = await troveManager.baseRate()
        assert.equal(baseRate_3.toString(), '0')
    })

    it("withdrawSIM(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        const lastFeeOpTime_1 = await troveManager.lastFeeOperationTime()

        // 10 seconds pass
        await th.fastForwardTime(10)

        // Borrower C triggers a fee
        await borrowerOperations.connect(C).withdrawSIM(th._100pct, dec(1, 18), C.address, C.address)

        const lastFeeOpTime_2 = await troveManager.lastFeeOperationTime()

        // Check that the last fee operation time did not update, as borrower D's debt issuance occured
        // since before minimum interval had passed 
        assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))

        // 60 seconds passes
        await th.fastForwardTime(60)

        // Check that now, at least one minute has passed since lastFeeOpTime_1
        const timeNow = await th.getLatestBlockTimestamp()
        assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(60))

        // Borrower C triggers a fee
        await borrowerOperations.connect(C).withdrawSIM(th._100pct, dec(1, 18), C.address, C.address)

        const lastFeeOpTime_3 = await troveManager.lastFeeOperationTime()

        // Check that the last fee operation time DID update, as borrower's debt issuance occured
        // after minimum interval had passed 
        assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
    })
    
    it("withdrawSIM(): borrower can't grief the baseRate and stop it decaying by issuing debt at higher frequency than the decay granularity", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 30 seconds pass
        await th.fastForwardTime(30)

        // Borrower C triggers a fee, before decay interval has passed
        await borrowerOperations.connect(C).withdrawSIM(th._100pct, dec(1, 18), C.address, C.address)

        // 30 seconds pass
        await th.fastForwardTime(30)

        // Borrower C triggers another fee
        await borrowerOperations.connect(C).withdrawSIM(th._100pct, dec(1, 18), C.address, C.address)

        // Check base rate has decreased even though Borrower tried to stop it decaying
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.lt(baseRate_1))
    })

    // todo send fee to Ve
    /*it("withdrawSIM(): borrowing at non-zero base rate sends LUSD fee to LQTY staking contract", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY LUSD balance before == 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStaking_LUSDBalance_Before, '0')

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D withdraws LUSD
        await borrowerOperations.withdrawSIM(th._100pct, dec(37, 18), C.address, C.address, { from: D })

        // Check LQTY LUSD balance after has increased
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))
    })

    it("withdrawSIM(): borrowing at non-zero base records the (drawn debt + fee) on the Trove struct", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        const D_debtBefore = await getTroveEntireDebt(D)

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D withdraws LUSD
        const withdrawal_D = toBN(dec(37, 18))
        const withdrawalTx = await borrowerOperations.withdrawSIM(th._100pct, toBN(dec(37, 18)), D.address, D.address, { from: D })

        const emittedFee = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(withdrawalTx))
        assert.isTrue(emittedFee.gt(toBN('0')))

        const newDebt = (await troveManager.Troves(D))[0]

        // Check debt on Trove struct equals initial debt + withdrawal + emitted fee
        th.assertIsApproximatelyEqual(newDebt, D_debtBefore.add(withdrawal_D).add(emittedFee), 10000)
    })

    it("withdrawSIM(): Borrowing at non-zero base rate increases the LQTY staking contract LUSD fees-per-unit-staked", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY contract LUSD fees-per-unit-staked is zero
        const F_LUSD_Before = await lqtyStaking.F_LUSD()
        assert.equal(F_LUSD_Before, '0')

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D withdraws LUSD
        await borrowerOperations.withdrawSIM(th._100pct, toBN(dec(37, 18)), D.address, D.address, { from: D })

        // Check LQTY contract LUSD fees-per-unit-staked has increased
        const F_LUSD_After = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_After.gt(F_LUSD_Before))
    })

    it("withdrawSIM(): Borrowing at non-zero base rate sends requested amount to the user", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY Staking contract balance before == 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStaking_LUSDBalance_Before, '0')

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        const D_LUSDBalanceBefore = await simToken.balanceOf(D.address)

        // D withdraws LUSD
        const D_LUSDRequest = toBN(dec(37, 18))
        await borrowerOperations.withdrawSIM(th._100pct, D_LUSDRequest, D.address, D.address, { from: D })

        // Check LQTY staking LUSD balance has increased
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))

        // Check D's LUSD balance now equals their initial balance plus request LUSD
        const D_LUSDBalanceAfter = await simToken.balanceOf(D.address)
        assert.isTrue(D_LUSDBalanceAfter.eq(D_LUSDBalanceBefore.add(D_LUSDRequest)))
    })

    it("withdrawSIM(): Borrowing at zero base rate changes LUSD fees-per-unit-staked", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // A artificially receives LQTY, then stakes it
        await lqtyToken.unprotectedMint(A, dec(100, 18))
        await lqtyStaking.stake(dec(100, 18), { from: A })

        // 2 hours pass
        th.fastForwardTime(7200)

        // Check LQTY LUSD balance before == 0
        const F_LUSD_Before = await lqtyStaking.F_LUSD()
        assert.equal(F_LUSD_Before, '0')

        // D withdraws LUSD
        await borrowerOperations.withdrawSIM(th._100pct, dec(37, 18), D.address, D.address, { from: D })

        // Check LQTY LUSD balance after > 0
        const F_LUSD_After = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_After.gt('0'))
    })*/
    ///////

    it("withdrawSIM(): Borrowing at zero base rate sends debt request to user", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        await th.fastForwardTime(7200)

        const D_LUSDBalanceBefore = await simToken.balanceOf(D.address)

        // D withdraws LUSD
        const D_LUSDRequest = toBN(dec(37, 18))
        await borrowerOperations.connect(D).withdrawSIM(th._100pct, dec(37, 18), D.address, D.address)

        // Check D's LUSD balance now equals their requested LUSD
        const D_LUSDBalanceAfter = await simToken.balanceOf(D.address)

        // Check D's trove debt == D's LUSD balance + liquidation reserve
        assert.isTrue(D_LUSDBalanceAfter.eq(D_LUSDBalanceBefore.add(D_LUSDRequest)))
    })

    it("withdrawSIM(): reverts when calling address does not have active trove", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Bob successfully withdraws LUSD
        /*const txBob = */await borrowerOperations.connect(bob).withdrawSIM(th._100pct, dec(100, 18), bob.address, bob.address)
        // // assert.isTrue(txBob.receipt.status)

        // Carol with no active trove attempts to withdraw LUSD
        try {
            /*const txCarol = */await borrowerOperations.connect(carol).withdrawSIM(th._100pct, dec(100, 18), carol.address, carol.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawSIM(): reverts when requested withdrawal amount is zero LUSD", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Bob successfully withdraws 1e-18 LUSD
        /*const txBob = */await borrowerOperations.connect(bob).withdrawSIM(th._100pct, 1, bob.address, bob.address)
        // // assert.isTrue(txBob.receipt.status)

        // Alice attempts to withdraw 0 LUSD
        try {
            /*const txAlice = */await borrowerOperations.connect(alice).withdrawSIM(th._100pct, 0, alice.address, alice.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawSIM(): reverts when system is in Recovery Mode", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        assert.isFalse(await th.checkRecoveryMode(contracts))

        // Withdrawal possible when recoveryMode == false
        /*const txAlice = */await borrowerOperations.connect(alice).withdrawSIM(th._100pct, dec(100, 18), alice.address, alice.address)
        // // assert.isTrue(txAlice.receipt.status)

        await priceFeed.setPrice('50000000000000000000')

        assert.isTrue(await th.checkRecoveryMode(contracts))

        //Check LUSD withdrawal impossible when recoveryMode == true
        try {
            /*const txBob = */await borrowerOperations.connect(bob).withdrawSIM(th._100pct, 1, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawSIM(): reverts when withdrawal would bring the trove's ICR < MCR", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(11, 17)), extraParams: { from: bob } })

        // Bob tries to withdraw LUSD that would bring his ICR < MCR
        try {
            /*const txBob = */await borrowerOperations.connect(bob).withdrawSIM(th._100pct, 1, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawSIM(): reverts when a withdrawal would cause the TCR of the system to fall below the CCR", async () => {
        await priceFeed.setPrice(dec(100, 18))
        const price = await priceFeed.getPrice()

        // Alice and Bob creates troves with 150% ICR.  System TCR = 150%.
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: bob } })

        var TCR = (await th.getTCR(contracts)).toString()
        assert.equal(TCR, '1500000000000000000')

        // Bob attempts to withdraw 1 LUSD.
        // System TCR would be: ((3+3) * 100 ) / (200+201) = 600/401 = 149.62%, i.e. below CCR of 150%.
        try {
            /*const txBob = */await borrowerOperations.connect(bob).withdrawSIM(th._100pct, dec(1, 18), bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("withdrawSIM(): reverts if system is in Recovery Mode", async () => {
        // --- SETUP ---
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: bob } })

        // --- TEST ---

        // price drops to 1ETH:150LUSD, reducing TCR below 150%
        await priceFeed.setPrice('150000000000000000000');
        assert.isTrue((await th.getTCR(contracts)).lt(toBN(dec(15, 17))))

        try {
            /*const txData = */await borrowerOperations.connect(alice).withdrawSIM(th._100pct, '200', alice.address, alice.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), 'revert')
        }
    })

    it("withdrawSIM(): increases the Trove's LUSD debt by the correct amount", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // check before
        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtBefore.gt(toBN(0)))

        await borrowerOperations.connect(alice).withdrawSIM(th._100pct, await getNetBorrowingAmount(BigNumber.from(100)), alice.address, alice.address)

        // check after
        const aliceDebtAfter = await getTroveEntireDebt(alice.address)
        th.assertIsApproximatelyEqual(aliceDebtAfter, aliceDebtBefore.add(toBN(100)))
    })

    it("withdrawSIM(): increases LUSD debt in ActivePool by correct amount", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: alice, value: toBN(dec(100, 'ether')) } })

        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtBefore.gt(toBN(0)))

        // check before
        const activePool_LUSD_Before = await activePool.getSIMDebt()
        assert.isTrue(activePool_LUSD_Before.eq(aliceDebtBefore))

        await borrowerOperations.connect(alice).withdrawSIM(th._100pct, await getNetBorrowingAmount(BigNumber.from(dec(10000, 18))), alice.address, alice.address)

        // check after
        const activePool_LUSD_After = await activePool.getSIMDebt()
        th.assertIsApproximatelyEqual(activePool_LUSD_After, activePool_LUSD_Before.add(toBN(dec(10000, 18))))
    })

    it("withdrawSIM(): increases user LUSDToken balance by correct amount", async () => {
        await openTrove({ extraParams: { value: toBN(dec(100, 'ether')), from: alice } })

        // check before
        const alice_LUSDTokenBalance_Before = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_Before.gt(toBN('0')))

        await borrowerOperations.connect(alice).withdrawSIM(th._100pct, dec(10000, 18), alice.address, alice.address)

        // check after
        const alice_LUSDTokenBalance_After = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_After.eq(alice_LUSDTokenBalance_Before.add(toBN(dec(10000, 18)))))
    })

    it("repaySIM(): reverts when repayment would leave trove with ICR < MCR", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        // Price drops
        await priceFeed.setPrice(dec(100, 18))
        const price = await priceFeed.getPrice()

        assert.isFalse(await troveManager.checkRecoveryMode(price))
        assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(toBN(dec(110, 16))))

        const LUSDRepayment = 1  // 1 wei repayment

        await assertRevert(borrowerOperations.connect(alice).repaySIM(LUSDRepayment, alice.address, alice.address),
            "BorrowerOps: An operation that would result in ICR < MCR is not permitted")
    })

    it("repaySIM(): Succeeds when it would leave trove with net debt >= minimum net debt", async () => {
        // Make the LUSD request 2 wei above min net debt to correct for floor division, and make net debt = min net debt + 1 wei
        await contracts.wstETHMock.connect(A).approve(borrowerOperations.address, parseUnits('1', 36))
        await borrowerOperations.connect(A).openTrove(dec(100, 30), th._100pct, await getNetBorrowingAmount(MIN_NET_DEBT.add(toBN('2'))), A.address, A.address)

        /*const repayTxA = */await borrowerOperations.connect(A).repaySIM(1, A.address, A.address)
        // assert.isTrue(repayTxA.receipt.status)

        await contracts.wstETHMock.connect(B).approve(borrowerOperations.address, parseUnits('1', 36))
        await borrowerOperations.connect(B).openTrove(dec(100, 30), th._100pct, dec(20, 25), B.address, B.address)

        /*const repayTxB = */await borrowerOperations.connect(B).repaySIM(dec(19, 25), B.address, B.address)
        // assert.isTrue(repayTxB.receipt.status)
    })

    it("repaySIM(): reverts when it would leave trove with net debt < minimum net debt", async () => {
        // Make the LUSD request 2 wei above min net debt to correct for floor division, and make net debt = min net debt + 1 wei
        await contracts.wstETHMock.connect(A).approve(borrowerOperations.address, parseUnits('1', 36))
        await borrowerOperations.connect(A).openTrove(dec(100, 30), th._100pct, await getNetBorrowingAmount(MIN_NET_DEBT.add(toBN('2'))), A.address, A.address)

        const repayTxAPromise = borrowerOperations.connect(A).repaySIM(2, A.address, A.address)
        await assertRevert(repayTxAPromise, "BorrowerOps: Trove's net debt must be greater than minimum")
    })

    it("adjustTrove(): Reverts if repaid amount is greater than current debt", async () => {
        const { totalDebt } = await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
        // LUSD_GAS_COMPENSATION = await borrowerOperations.LUSD_GAS_COMPENSATION()
        const repayAmount = totalDebt./*sub(LUSD_GAS_COMPENSATION).*/add(toBN(1))
        await openTrove({ extraLUSDAmount: repayAmount, ICR: toBN(dec(150, 16)), extraParams: { from: bob } })

        await simToken.connect(bob).transfer(alice.address, repayAmount)

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(0, th._100pct, 0, repayAmount, false, alice.address, alice.address),
            "Arithmetic operation underflowed or overflowed outside of an unchecked block")
    })

    it("repaySIM(): reverts when calling address does not have active trove", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        // Bob successfully repays some LUSD
        const txBob = await borrowerOperations.connect(bob).repaySIM(dec(10, 18), bob.address, bob.address)
        // assert.isTrue(txBob.receipt.status)

        // Carol with no active trove attempts to repayLUSD
        try {
            const txCarol = await borrowerOperations.connect(carol).repaySIM(dec(10, 18), carol.address, carol.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("repaySIM(): reverts when attempted repayment is > the debt of the trove", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const aliceDebt = await getTroveEntireDebt(alice.address)

        // Bob successfully repays some LUSD
        const txBob = await borrowerOperations.connect(bob).repaySIM(dec(10, 18), bob.address, bob.address)
        // assert.isTrue(txBob.receipt.status)

        // Alice attempts to repay more than her debt
        try {
            const txAlice = await borrowerOperations.connect(alice).repaySIM(aliceDebt.add(toBN(dec(1, 18))), alice.address, alice.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    //repayLUSD: reduces LUSD debt in Trove
    it("repaySIM(): reduces the Trove's LUSD debt by the correct amount", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtBefore.gt(toBN('0')))

        await borrowerOperations.connect(alice).repaySIM(aliceDebtBefore.div(toBN(10)), alice.address, alice.address)  // Repays 1/10 her debt

        const aliceDebtAfter = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtAfter.gt(toBN('0')))

        th.assertIsApproximatelyEqual(aliceDebtAfter, aliceDebtBefore.mul(toBN(9)).div(toBN(10)))  // check 9/10 debt remaining
    })

    it("repaySIM(): decreases LUSD debt in ActivePool by correct amount", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtBefore.gt(toBN('0')))

        // Check before
        const activePool_LUSD_Before = await activePool.getSIMDebt()
        assert.isTrue(activePool_LUSD_Before.gt(toBN('0')))

        await borrowerOperations.connect(alice).repaySIM(aliceDebtBefore.div(toBN(10)), alice.address, alice.address)  // Repays 1/10 her debt

        // check after
        const activePool_LUSD_After = await activePool.getSIMDebt()
        th.assertIsApproximatelyEqual(activePool_LUSD_After, activePool_LUSD_Before.sub(aliceDebtBefore.div(toBN(10))))
    })

    it("repaySIM(): decreases user LUSDToken balance by correct amount", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtBefore.gt(toBN('0')))

        // check before
        const alice_LUSDTokenBalance_Before = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_Before.gt(toBN('0')))

        await borrowerOperations.connect(alice).repaySIM(aliceDebtBefore.div(toBN(10)), alice.address, alice.address)  // Repays 1/10 her debt

        // check after
        const alice_LUSDTokenBalance_After = await simToken.balanceOf(alice.address)
        th.assertIsApproximatelyEqual(alice_LUSDTokenBalance_After, alice_LUSDTokenBalance_Before.sub(aliceDebtBefore.div(toBN(10))))
    })

    it('repaySIM(): can repay debt in Recovery Mode', async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebtBefore.gt(toBN('0')))

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice('105000000000000000000')

        assert.isTrue(await th.checkRecoveryMode(contracts))

        const tx = await borrowerOperations.connect(alice).repaySIM(aliceDebtBefore.div(toBN(10)), alice.address, alice.address)
        // assert.isTrue(tx.receipt.status)

        // Check Alice's debt: 110 (initial) - 50 (repaid)
        const aliceDebtAfter = await getTroveEntireDebt(alice.address)
        th.assertIsApproximatelyEqual(aliceDebtAfter, aliceDebtBefore.mul(toBN(9)).div(toBN(10)))
    })

    it("repaySIM(): Reverts if borrower has insufficient LUSD balance to cover his debt repayment", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        const bobBalBefore = await simToken.balanceOf(B.address)
        assert.isTrue(bobBalBefore.gt(toBN('0')))

        // Bob transfers all but 5 of his LUSD to Carol
        await simToken.connect(B).transfer(C.address, bobBalBefore.sub((toBN(dec(5, 18)))))

        //Confirm B's LUSD balance has decreased to 5 LUSD
        const bobBalAfter = await simToken.balanceOf(B.address)

        assert.isTrue(bobBalAfter.eq(toBN(dec(5, 18))))

        // Bob tries to repay 6 LUSD
        const repayLUSDPromise_B = borrowerOperations.connect(B).repaySIM(toBN(dec(6, 18)), B.address, B.address)

        await assertRevert(repayLUSDPromise_B, "BorrowerOps: Caller doesnt have enough SIM to make repayment")
    })

    // --- adjustTrove() ---

    it("adjustTrove(): reverts when adjustment would leave trove with ICR < MCR", async () => {
        // alice creates a Trove and adds first collateral
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        // Price drops
        await priceFeed.setPrice(dec(100, 18))
        const price = await priceFeed.getPrice()

        assert.isFalse(await troveManager.checkRecoveryMode(price))
        assert.isTrue((await troveManager.getCurrentICR(alice.address, price)).lt(toBN(dec(110, 16))))

        const LUSDRepayment = 1  // 1 wei repayment
        const collTopUp = 1

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(collTopUp, th._100pct, 0, LUSDRepayment, false, alice.address, alice.address),
            "BorrowerOps: An operation that would result in ICR < MCR is not permitted")
    })

    it("adjustTrove(): reverts if max fee < 0.5% in Normal mode", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })

        await assertRevert(borrowerOperations.connect(A).adjustTrove(dec(2, 16), 0, 0, dec(1, 18), true, A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await assertRevert(borrowerOperations.connect(A).adjustTrove(dec(2, 16), 1, 0, dec(1, 18), true, A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await assertRevert(borrowerOperations.connect(A).adjustTrove(dec(2, 16), '4999999999999999', 0, dec(1, 18), true, A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
    })

    it("adjustTrove(): allows max fee < 0.5% in Recovery mode", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: toBN(dec(100, 'ether')) } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })

        await priceFeed.setPrice(dec(120, 18))
        assert.isTrue(await th.checkRecoveryMode(contracts))

        await borrowerOperations.connect(A).adjustTrove(dec(300, 18), 0, 0, dec(1, 9), true, A.address, A.address)
        await priceFeed.setPrice(dec(1, 18))
        assert.isTrue(await th.checkRecoveryMode(contracts))
        await borrowerOperations.connect(A).adjustTrove(dec(30000, 18), 1, 0, dec(1, 9), true, A.address, A.address)
        await priceFeed.setPrice(dec(1, 16))
        assert.isTrue(await th.checkRecoveryMode(contracts))
        await borrowerOperations.connect(A).adjustTrove(dec(3000000, 18) , '4999999999999999', 0, dec(1, 9), true, A.address, A.address)
    })

    it("adjustTrove(): decays a non-zero base rate", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D adjusts trove
        await borrowerOperations.connect(D).adjustTrove(0, th._100pct, 0, dec(37, 18), true, D.address, D.address)

        // Check baseRate has decreased
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.lt(baseRate_1))

        // 1 hour passes
        await th.fastForwardTime(3600)

        // E adjusts trove
        await borrowerOperations.connect(D).adjustTrove(0, th._100pct, 0, dec(37, 15), true, E.address, E.address)

        const baseRate_3 = await troveManager.baseRate()
        assert.isTrue(baseRate_3.lt(baseRate_2))
    })

    it("adjustTrove(): doesn't decay a non-zero base rate when user issues 0 debt", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // D opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D adjusts trove with 0 debt
        await borrowerOperations.connect(D).adjustTrove(dec(1, 'ether'), th._100pct, 0, 0, false, D.address, D.address)

        // Check baseRate has not decreased
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.eq(baseRate_1))
    })

    it("adjustTrove(): doesn't change base rate if it is already zero", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D adjusts trove
        await borrowerOperations.connect(D).adjustTrove(0, th._100pct, 0, dec(37, 18), true, D.address, D.address)

        // Check baseRate is still 0
        const baseRate_2 = await troveManager.baseRate()
        assert.equal(baseRate_2.toString(), '0')

        // 1 hour passes
        await th.fastForwardTime(3600)

        // E adjusts trove
        await borrowerOperations.connect(D).adjustTrove(0, th._100pct, 0, dec(37, 15), true, E.address, E.address)

        const baseRate_3 = await troveManager.baseRate()
        assert.equal(baseRate_3.toString(), '0')
    })

    it("adjustTrove(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        const lastFeeOpTime_1 = await troveManager.lastFeeOperationTime()

        // 10 seconds pass
        await th.fastForwardTime(10)

        // Borrower C triggers a fee
        await borrowerOperations.connect(C).adjustTrove(0, th._100pct, 0, dec(1, 18), true, C.address, C.address)

        const lastFeeOpTime_2 = await troveManager.lastFeeOperationTime()

        // Check that the last fee operation time did not update, as borrower D's debt issuance occured
        // since before minimum interval had passed
        assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))

        // 60 seconds passes
        await th.fastForwardTime(60)

        // Check that now, at least one minute has passed since lastFeeOpTime_1
        const timeNow = await th.getLatestBlockTimestamp()
        assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(60))

        // Borrower C triggers a fee
        await borrowerOperations.connect(C).adjustTrove(0, th._100pct, 0, dec(1, 18), true, C.address, C.address)

        const lastFeeOpTime_3 = await troveManager.lastFeeOperationTime()

        // Check that the last fee operation time DID update, as borrower's debt issuance occured
        // after minimum interval had passed
        assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
    })

    it("adjustTrove(): borrower can't grief the baseRate and stop it decaying by issuing debt at higher frequency than the decay granularity", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // Borrower C triggers a fee, before decay interval of 1 minute has passed
        await borrowerOperations.connect(C).adjustTrove(0, th._100pct, 0, dec(1, 18), true, C.address, C.address)

        // 1 minute passes
        await th.fastForwardTime(60)

        // Borrower C triggers another fee
        await borrowerOperations.connect(C).adjustTrove(0, th._100pct, 0, dec(1, 18), true, C.address, C.address)

        // Check base rate has decreased even though Borrower tried to stop it decaying
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.lt(baseRate_1))
    })

    // todo send fee to Ve
    /*it("adjustTrove(): borrowing at non-zero base rate sends LUSD fee to LQTY staking contract", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY LUSD balance before == 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStaking_LUSDBalance_Before, '0')

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D adjusts trove
        await openTrove({ extraLUSDAmount: toBN(dec(37, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check LQTY LUSD balance after has increased
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))
    })

    it("adjustTrove(): borrowing at non-zero base records the (drawn debt + fee) on the Trove struct", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
        const D_debtBefore = await getTroveEntireDebt(D)

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        const withdrawal_D = toBN(dec(37, 18))

        // D withdraws LUSD
        const adjustmentTx = await borrowerOperations.adjustTrove(th._100pct, 0, withdrawal_D, true, D.address, D.address, { from: D })

        const emittedFee = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(adjustmentTx))
        assert.isTrue(emittedFee.gt(toBN('0')))

        const D_newDebt = (await troveManager.Troves(D))[0]

        // Check debt on Trove struct equals initila debt plus drawn debt plus emitted fee
        assert.isTrue(D_newDebt.eq(D_debtBefore.add(withdrawal_D).add(emittedFee)))
    })

    it("adjustTrove(): Borrowing at non-zero base rate increases the LQTY staking contract LUSD fees-per-unit-staked", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY contract LUSD fees-per-unit-staked is zero
        const F_LUSD_Before = await lqtyStaking.F_LUSD()
        assert.equal(F_LUSD_Before, '0')

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D adjusts trove
        await borrowerOperations.adjustTrove(th._100pct, 0, dec(37, 18), true, D.address, D.address, { from: D })

        // Check LQTY contract LUSD fees-per-unit-staked has increased
        const F_LUSD_After = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_After.gt(F_LUSD_Before))
    })

    it("adjustTrove(): Borrowing at non-zero base rate sends requested amount to the user", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY Staking contract balance before == 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStaking_LUSDBalance_Before, '0')

        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        const D_LUSDBalanceBefore = await simToken.balanceOf(D.address)

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D adjusts trove
        const LUSDRequest_D = toBN(dec(40, 18))
        await borrowerOperations.adjustTrove(th._100pct, 0, LUSDRequest_D, true, D.address, D.address, { from: D })

        // Check LQTY staking LUSD balance has increased
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))

        // Check D's LUSD balance has increased by their requested LUSD
        const D_LUSDBalanceAfter = await simToken.balanceOf(D.address)
        assert.isTrue(D_LUSDBalanceAfter.eq(D_LUSDBalanceBefore.add(LUSDRequest_D)))
    })

    it("adjustTrove(): Borrowing at zero base rate changes LUSD balance of LQTY staking contract", async () => {
        await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(30, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(50, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        th.fastForwardTime(7200)

        // Check staking LUSD balance before > 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_Before.gt(toBN('0')))

        // D adjusts trove
        await borrowerOperations.adjustTrove(th._100pct, 0, dec(37, 18), true, D.address, D.address, { from: D })

        // Check staking LUSD balance after > staking balance before
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))
    })

    it("adjustTrove(): Borrowing at zero base rate changes LQTY staking contract LUSD fees-per-unit-staked", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: toBN(dec(100, 'ether')) } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        th.fastForwardTime(7200)

        // A artificially receives LQTY, then stakes it
        await lqtyToken.unprotectedMint(A, dec(100, 18))
        await lqtyStaking.stake(dec(100, 18), { from: A })

        // Check staking LUSD balance before == 0
        const F_LUSD_Before = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_Before.eq(toBN('0')))

        // D adjusts trove
        await borrowerOperations.adjustTrove(th._100pct, 0, dec(37, 18), true, D.address, D.address, { from: D })

        // Check staking LUSD balance increases
        const F_LUSD_After = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_After.gt(F_LUSD_Before))
    })*/

    it("adjustTrove(): Borrowing at zero base rate sends total requested LUSD to the user", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale, value: toBN(dec(100, 'ether')) } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        const D_LUSDBalBefore = await simToken.balanceOf(D.address)
        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        await th.fastForwardTime(7200)

        const DUSDBalanceBefore = await simToken.balanceOf(D.address)

        // D adjusts trove
        const LUSDRequest_D = toBN(dec(40, 18))
        await borrowerOperations.connect(D).adjustTrove(0, th._100pct, 0, LUSDRequest_D, true, D.address, D.address)

        // Check D's LUSD balance increased by their requested LUSD
        const LUSDBalanceAfter = await simToken.balanceOf(D.address)
        assert.isTrue(LUSDBalanceAfter.eq(D_LUSDBalBefore.add(LUSDRequest_D)))
    })

    it("adjustTrove(): reverts when calling address has no active trove", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Alice coll and debt increase(+1 ETH, +50LUSD)
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(50, 18), true, alice.address, alice.address)

        try {
            const txCarol = await borrowerOperations.connect(carol).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(50, 18), true, carol.address, carol.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("adjustTrove(): reverts in Recovery Mode when the adjustment would reduce the TCR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        assert.isFalse(await th.checkRecoveryMode(contracts))

        const txAlice = await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(50, 18), true, alice.address, alice.address)
        // assert.isTrue(txAlice.receipt.status)

        await priceFeed.setPrice(dec(120, 18)) // trigger drop in ETH price

        assert.isTrue(await th.checkRecoveryMode(contracts))

        try { // collateral withdrawal should also fail
            const txAlice = await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, dec(1, 'ether'), 0, false, alice.address, alice.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }

        try { // debt increase should fail
            const txBob = await borrowerOperations.connect(bob).adjustTrove(0, th._100pct, 0, dec(50, 18), true, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }

        try { // debt increase that's also a collateral increase should also fail, if ICR will be worse off
            const txBob = await borrowerOperations.connect(bob).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(111, 18), true, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("adjustTrove(): collateral withdrawal reverts in Recovery Mode", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice(dec(120, 18)) // trigger drop in ETH price

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // Alice attempts an adjustment that repays half her debt BUT withdraws 1 wei collateral, and fails
        await assertRevert(borrowerOperations.connect(alice).adjustTrove(0, th._100pct, 1, dec(5000, 18), false, alice.address, alice.address),
            "BorrowerOps: Collateral withdrawal not permitted Recovery Mode")
    })

    it("adjustTrove(): debt increase that would leave ICR < 150% reverts in Recovery Mode", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const CCR = await troveManager.CCR()

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice(dec(120, 18)) // trigger drop in ETH price
        const price = await priceFeed.getPrice()

        assert.isTrue(await th.checkRecoveryMode(contracts))

        const ICR_A = await troveManager.getCurrentICR(alice.address, price)

        const aliceDebt = await getTroveEntireDebt(alice.address)
        const aliceColl = await getTroveEntireColl(alice.address)
        const debtIncrease = toBN(dec(50, 18))
        const collIncrease = toBN(dec(1, 'ether'))

        // Check the new ICR would be an improvement, but less than the CCR (150%)
        const newICR = await troveManager.computeICR(aliceColl.add(collIncrease), aliceDebt.add(debtIncrease), price)

        assert.isTrue(newICR.gt(ICR_A) && newICR.lt(CCR))

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(collIncrease, th._100pct, 0, debtIncrease, true, alice.address, alice.address),
            "BorrowerOps: Operation must leave trove with ICR >= CCR")
    })

    it("adjustTrove(): debt increase that would reduce the ICR reverts in Recovery Mode", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const CCR = await troveManager.CCR()

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice(dec(105, 18)) // trigger drop in ETH price
        const price = await priceFeed.getPrice()

        assert.isTrue(await th.checkRecoveryMode(contracts))

        //--- Alice with ICR > 150% tries to reduce her ICR ---

        const ICR_A = await troveManager.getCurrentICR(alice.address, price)

        // Check Alice's initial ICR is above 150%
        assert.isTrue(ICR_A.gt(CCR))

        const aliceDebt = await getTroveEntireDebt(alice.address)
        const aliceColl = await getTroveEntireColl(alice.address)
        const aliceDebtIncrease = toBN(dec(150, 18))
        const aliceCollIncrease = toBN(dec(1, 'ether'))

        const newICR_A = await troveManager.computeICR(aliceColl.add(aliceCollIncrease), aliceDebt.add(aliceDebtIncrease), price)

        // Check Alice's new ICR would reduce but still be greater than 150%
        assert.isTrue(newICR_A.lt(ICR_A) && newICR_A.gt(CCR))

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(aliceCollIncrease, th._100pct, 0, aliceDebtIncrease, true, alice.address, alice.address),
            "BorrowerOps: Cannot decrease your Trove's ICR in Recovery Mode")

        //--- Bob with ICR < 150% tries to reduce his ICR ---

        const ICR_B = await troveManager.getCurrentICR(bob.address, price)

        // Check Bob's initial ICR is below 150%
        assert.isTrue(ICR_B.lt(CCR))

        const bobDebt = await getTroveEntireDebt(bob.address)
        const bobColl = await getTroveEntireColl(bob.address)
        const bobDebtIncrease = toBN(dec(450, 18))
        const bobCollIncrease = toBN(dec(1, 'ether'))

        const newICR_B = await troveManager.computeICR(bobColl.add(bobCollIncrease), bobDebt.add(bobDebtIncrease), price)

        // Check Bob's new ICR would reduce
        assert.isTrue(newICR_B.lt(ICR_B))

        await assertRevert(borrowerOperations.connect(bob).adjustTrove(bobCollIncrease, th._100pct, 0, bobDebtIncrease, true, bob.address, bob.address),
            "BorrowerOps: Operation must leave trove with ICR >= CCR")
    })

    it("adjustTrove(): A trove with ICR < CCR in Recovery Mode can adjust their trove to ICR > CCR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const CCR = await troveManager.CCR()

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice(dec(100, 18)) // trigger drop in ETH price
        const price = await priceFeed.getPrice()

        assert.isTrue(await th.checkRecoveryMode(contracts))

        const ICR_A = await troveManager.getCurrentICR(alice.address, price)
        // Check initial ICR is below 150%
        assert.isTrue(ICR_A.lt(CCR))

        const aliceDebt = await getTroveEntireDebt(alice.address)
        const aliceColl = await getTroveEntireColl(alice.address)
        const debtIncrease = toBN(dec(5000, 18))
        const collIncrease = toBN(dec(150, 'ether'))

        const newICR = await troveManager.computeICR(aliceColl.add(collIncrease), aliceDebt.add(debtIncrease), price)

        // Check new ICR would be > 150%
        assert.isTrue(newICR.gt(CCR))

        const tx = await borrowerOperations.connect(alice).adjustTrove(collIncrease, th._100pct, 0, debtIncrease, true, alice.address, alice.address)
        // assert.isTrue(tx.receipt.status)

        const actualNewICR = await troveManager.getCurrentICR(alice.address, price)
        assert.isTrue(actualNewICR.gt(CCR))
    })

    it("adjustTrove(): A trove with ICR > CCR in Recovery Mode can improve their ICR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        const CCR = await troveManager.CCR()

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice(dec(105, 18)) // trigger drop in ETH price
        const price = await priceFeed.getPrice()

        assert.isTrue(await th.checkRecoveryMode(contracts))

        const initialICR = await troveManager.getCurrentICR(alice.address, price)
        // Check initial ICR is above 150%
        assert.isTrue(initialICR.gt(CCR))

        const aliceDebt = await getTroveEntireDebt(alice.address)
        const aliceColl = await getTroveEntireColl(alice.address)
        const debtIncrease = toBN(dec(5000, 18))
        const collIncrease = toBN(dec(150, 'ether'))

        const newICR = await troveManager.computeICR(aliceColl.add(collIncrease), aliceDebt.add(debtIncrease), price)

        // Check new ICR would be > old ICR
        assert.isTrue(newICR.gt(initialICR))

        const tx = await borrowerOperations.connect(alice).adjustTrove(collIncrease, th._100pct, 0, debtIncrease, true, alice.address, alice.address)
        // assert.isTrue(tx.receipt.status)

        const actualNewICR = await troveManager.getCurrentICR(alice.address, price)
        assert.isTrue(actualNewICR.gt(initialICR))
    })

    // todo ve
    /*it("adjustTrove(): debt increase in Recovery Mode charges no fee", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(200000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        assert.isFalse(await th.checkRecoveryMode(contracts))

        await priceFeed.setPrice(dec(120, 18)) // trigger drop in ETH price

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // B stakes LQTY
        await lqtyToken.unprotectedMint(bob, dec(100, 18))
        await lqtyStaking.stake(dec(100, 18), { from: bob })

        const lqtyStakingLUSDBalanceBefore = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStakingLUSDBalanceBefore.gt(toBN('0')))

        const txAlice = await borrowerOperations.adjustTrove(th._100pct, 0, dec(50, 18), true, alice.address, alice.address, { from: alice, value: dec(100, 'ether') })
        // assert.isTrue(txAlice.receipt.status)

        // Check emitted fee = 0
        const emittedFee = toBN(await th.getEventArgByName(txAlice, 'LUSDBorrowingFeePaid', '_LUSDFee'))
        assert.isTrue(emittedFee.eq(toBN('0')))

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // Check no fee was sent to staking contract
        const lqtyStakingLUSDBalanceAfter = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStakingLUSDBalanceAfter.toString(), lqtyStakingLUSDBalanceBefore.toString())
    })*/

    it("adjustTrove(): reverts when change would cause the TCR of the system to fall below the CCR", async () => {
        await priceFeed.setPrice(dec(100, 18))

        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(15, 17)), extraParams: { from: bob } })

        // Check TCR and Recovery Mode
        const TCR = (await th.getTCR(contracts)).toString()
        assert.equal(TCR, '1500000000000000000')
        assert.isFalse(await th.checkRecoveryMode(contracts))

        // Bob attempts an operation that would bring the TCR below the CCR
        try {
            const txBob = await borrowerOperations.connect(bob).adjustTrove(0, th._100pct, 0, dec(1, 18), true, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("adjustTrove(): reverts when LUSD repaid is > debt of the trove", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const bobOpenTx = (await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })).tx

        const bobDebt = await getTroveEntireDebt(bob.address)
        assert.isTrue(bobDebt.gt(toBN('0')))

        const bobFee = toBN(await th.getEventArgByIndex(bobOpenTx, 'SIMBorrowingFeePaid', 1))
        assert.isTrue(bobFee.gt(toBN('0')))

        // Alice transfers LUSD to bob to compensate borrowing fees
        await simToken.connect(alice).transfer(bob.address, bobFee)

        const remainingDebt = (await troveManager.getTroveDebt(bob.address))/*.sub(LUSD_GAS_COMPENSATION)*/

        // Bob attempts an adjustment that would repay 1 wei more than his debt
        await assertRevert(
            borrowerOperations.connect(bob).adjustTrove(dec(1, 'ether'), th._100pct, 0, remainingDebt.add(toBN(1)), false, bob.address, bob.address),
            "revert"
        )
    })

    it("adjustTrove(): reverts when attempted ETH withdrawal is >= the trove's collateral", async () => {
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        const carolColl = await getTroveEntireColl(carol.address)

        // Carol attempts an adjustment that would withdraw 1 wei more than her ETH
        try {
            const txCarol = await borrowerOperations.connect(carol).adjustTrove(0, th._100pct, carolColl.add(toBN(1)), 0, true, carol.address, carol.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("adjustTrove(): reverts when change would cause the ICR of the trove to fall below the MCR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(100, 18)), extraParams: { from: whale } })

        await priceFeed.setPrice(dec(100, 18))

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(11, 17)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(11, 17)), extraParams: { from: bob } })

        // Bob attempts to increase debt by 100 LUSD and 1 ether, i.e. a change that constitutes a 100% ratio of coll:debt.
        // Since his ICR prior is 110%, this change would reduce his ICR below MCR.
        try {
            const txBob = await borrowerOperations.connect(bob).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(100, 18), true, bob.address, bob.address)
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("adjustTrove(): With 0 coll change, doesnt change borrower's coll or ActivePool coll", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceCollBefore = await getTroveEntireColl(alice.address)
        const activePoolCollBefore = await activePool.getWSTETH()

        assert.isTrue(aliceCollBefore.gt(toBN('0')))
        assert.isTrue(aliceCollBefore.eq(activePoolCollBefore))

        // Alice adjusts trove. No coll change, and a debt increase (+50LUSD)
        await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, 0, dec(50, 18), true, alice.address, alice.address)

        const aliceCollAfter = await getTroveEntireColl(alice.address)
        const activePoolCollAfter = await activePool.getWSTETH()

        assert.isTrue(aliceCollAfter.eq(activePoolCollAfter))
        assert.isTrue(activePoolCollAfter.eq(activePoolCollAfter))
    })

    it("adjustTrove(): With 0 debt change, doesnt change borrower's debt or ActivePool debt", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceDebtBefore = await getTroveEntireDebt(alice.address)
        const activePoolDebtBefore = await activePool.getSIMDebt()

        assert.isTrue(aliceDebtBefore.gt(toBN('0')))
        assert.isTrue(aliceDebtBefore.eq(activePoolDebtBefore))

        // Alice adjusts trove. Coll change, no debt change
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, 0, false, alice.address, alice.address)

        const aliceDebtAfter = await getTroveEntireDebt(alice.address)
        const activePoolDebtAfter = await activePool.getSIMDebt()

        assert.isTrue(aliceDebtAfter.eq(aliceDebtBefore))
        assert.isTrue(activePoolDebtAfter.eq(activePoolDebtBefore))
    })

    it("adjustTrove(): updates borrower's debt and coll with an increase in both", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const debtBefore = await getTroveEntireDebt(alice.address)
        const collBefore = await getTroveEntireColl(alice.address)
        assert.isTrue(debtBefore.gt(toBN('0')))
        assert.isTrue(collBefore.gt(toBN('0')))

        // Alice adjusts trove. Coll and debt increase(+1 ETH, +50LUSD)
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, await getNetBorrowingAmount(BigNumber.from(dec(50, 18))), true, alice.address, alice.address)

        const debtAfter = await getTroveEntireDebt(alice.address)
        const collAfter = await getTroveEntireColl(alice.address)

        th.assertIsApproximatelyEqual(debtAfter, debtBefore.add(toBN(dec(50, 18))), 10000)
        th.assertIsApproximatelyEqual(collAfter, collBefore.add(toBN(dec(1, 18))), 10000)
    })

    it("adjustTrove(): updates borrower's debt and coll with a decrease in both", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const debtBefore = await getTroveEntireDebt(alice.address)
        const collBefore = await getTroveEntireColl(alice.address)
        assert.isTrue(debtBefore.gt(toBN('0')))
        assert.isTrue(collBefore.gt(toBN('0')))

        // Alice adjusts trove coll and debt decrease (-0.5 ETH, -50LUSD)
        await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, dec(500, 'finney'), dec(50, 18), false, alice.address, alice.address)

        const debtAfter = await getTroveEntireDebt(alice.address)
        const collAfter = await getTroveEntireColl(alice.address)

        assert.isTrue(debtAfter.eq(debtBefore.sub(toBN(dec(50, 18)))))
        assert.isTrue(collAfter.eq(collBefore.sub(toBN(dec(5, 17)))))
    })

    it("adjustTrove(): updates borrower's  debt and coll with coll increase, debt decrease", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const debtBefore = await getTroveEntireDebt(alice.address)
        const collBefore = await getTroveEntireColl(alice.address)
        assert.isTrue(debtBefore.gt(toBN('0')))
        assert.isTrue(collBefore.gt(toBN('0')))

        // Alice adjusts trove - coll increase and debt decrease (+0.5 ETH, -50LUSD)
        await borrowerOperations.connect(alice).adjustTrove( dec(500, 'finney'), th._100pct, 0, dec(50, 18), false, alice.address, alice.address)

        const debtAfter = await getTroveEntireDebt(alice.address)
        const collAfter = await getTroveEntireColl(alice.address)

        th.assertIsApproximatelyEqual(debtAfter, debtBefore.sub(toBN(dec(50, 18))), 10000)
        th.assertIsApproximatelyEqual(collAfter, collBefore.add(toBN(dec(5, 17))), 10000)
    })

    it("adjustTrove(): updates borrower's debt and coll with coll decrease, debt increase", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const debtBefore = await getTroveEntireDebt(alice.address)
        const collBefore = await getTroveEntireColl(alice.address)
        assert.isTrue(debtBefore.gt(toBN('0')))
        assert.isTrue(collBefore.gt(toBN('0')))

        // Alice adjusts trove - coll decrease and debt increase (0.1 ETH, 10LUSD)
        await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, dec(1, 17), await getNetBorrowingAmount(BigNumber.from(dec(1, 18))), true, alice.address, alice.address)

        const debtAfter = await getTroveEntireDebt(alice.address)
        const collAfter = await getTroveEntireColl(alice.address)

        th.assertIsApproximatelyEqual(debtAfter, debtBefore.add(toBN(dec(1, 18))), 10000)
        th.assertIsApproximatelyEqual(collAfter, collBefore.sub(toBN(dec(1, 17))), 10000)
    })

    it("adjustTrove(): updates borrower's stake and totalStakes with a coll increase", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const stakeBefore = await troveManager.getTroveStake(alice.address)
        const totalStakesBefore = await troveManager.totalStakes();
        assert.isTrue(stakeBefore.gt(toBN('0')))
        assert.isTrue(totalStakesBefore.gt(toBN('0')))

        // Alice adjusts trove - coll and debt increase (+1 ETH, +50 LUSD)
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(50, 18), true, alice.address, alice.address)

        const stakeAfter = await troveManager.getTroveStake(alice.address)
        const totalStakesAfter = await troveManager.totalStakes();

        assert.isTrue(stakeAfter.eq(stakeBefore.add(toBN(dec(1, 18)))))
        assert.isTrue(totalStakesAfter.eq(totalStakesBefore.add(toBN(dec(1, 18)))))
    })

    it("adjustTrove(): updates borrower's stake and totalStakes with a coll decrease", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const stakeBefore = await troveManager.getTroveStake(alice.address)
        const totalStakesBefore = await troveManager.totalStakes();
        assert.isTrue(stakeBefore.gt(toBN('0')))
        assert.isTrue(totalStakesBefore.gt(toBN('0')))

        // Alice adjusts trove - coll decrease and debt decrease
        await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, dec(500, 'finney'), dec(50, 18), false, alice.address, alice.address)

        const stakeAfter = await troveManager.getTroveStake(alice.address)
        const totalStakesAfter = await troveManager.totalStakes();

        assert.isTrue(stakeAfter.eq(stakeBefore.sub(toBN(dec(5, 17)))))
        assert.isTrue(totalStakesAfter.eq(totalStakesBefore.sub(toBN(dec(5, 17)))))
    })

    it("adjustTrove(): changes LUSDToken balance by the requested decrease", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const alice_LUSDTokenBalance_Before = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_Before.gt(toBN('0')))

        // Alice adjusts trove - coll decrease and debt decrease
        await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, dec(100, 'finney'), dec(10, 18), false, alice.address, alice.address)

        // check after
        const alice_LUSDTokenBalance_After = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_After.eq(alice_LUSDTokenBalance_Before.sub(toBN(dec(10, 18)))))
    })

    it("adjustTrove(): changes LUSDToken balance by the requested increase", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const alice_LUSDTokenBalance_Before = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_Before.gt(toBN('0')))

        // Alice adjusts trove - coll increase and debt increase
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(100, 18), true, alice.address, alice.address)

        // check after
        const alice_LUSDTokenBalance_After = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDTokenBalance_After.eq(alice_LUSDTokenBalance_Before.add(toBN(dec(100, 18)))))
    })

    it("adjustTrove(): Changes the activePool ETH and raw ether balance by the requested decrease", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const activePool_ETH_Before = await activePool.getWSTETH()
        const activePool_RawEther_Before = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_Before.gt(toBN('0')))
        assert.isTrue(activePool_RawEther_Before.gt(toBN('0')))

        // Alice adjusts trove - coll decrease and debt decrease
        await borrowerOperations.connect(alice).adjustTrove(0, th._100pct, dec(100, 'finney'), dec(10, 18), false, alice.address, alice.address)

        const activePool_ETH_After = await activePool.getWSTETH()
        const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_After.eq(activePool_ETH_Before.sub(toBN(dec(1, 17)))))
        assert.isTrue(activePool_RawEther_After.eq(activePool_ETH_Before.sub(toBN(dec(1, 17)))))
    })

    it("adjustTrove(): Changes the activePool ETH and raw ether balance by the amount of ETH sent", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const activePool_ETH_Before = await activePool.getWSTETH()
        const activePool_RawEther_Before = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_Before.gt(toBN('0')))
        assert.isTrue(activePool_RawEther_Before.gt(toBN('0')))

        // Alice adjusts trove - coll increase and debt increase
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(100, 18), true, alice.address, alice.address)

        const activePool_ETH_After = await activePool.getWSTETH()
        const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_After.eq(activePool_ETH_Before.add(toBN(dec(1, 18)))))
        assert.isTrue(activePool_RawEther_After.eq(activePool_ETH_Before.add(toBN(dec(1, 18)))))
    })

    it("adjustTrove(): Changes the LUSD debt in ActivePool by requested decrease", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const activePool_LUSDDebt_Before = await activePool.getSIMDebt()
        assert.isTrue(activePool_LUSDDebt_Before.gt(toBN('0')))

        // Alice adjusts trove - coll increase and debt decrease
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, dec(30, 18), false, alice.address, alice.address)

        const activePool_LUSDDebt_After = await activePool.getSIMDebt()
        assert.isTrue(activePool_LUSDDebt_After.eq(activePool_LUSDDebt_Before.sub(toBN(dec(30, 18)))))
    })

    it("adjustTrove(): Changes the LUSD debt in ActivePool by requested increase", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const activePool_LUSDDebt_Before = await activePool.getSIMDebt()
        assert.isTrue(activePool_LUSDDebt_Before.gt(toBN('0')))

        // Alice adjusts trove - coll increase and debt increase
        await borrowerOperations.connect(alice).adjustTrove(dec(1, 'ether'), th._100pct, 0, await getNetBorrowingAmount(BigNumber.from(dec(100, 18))), true, alice.address, alice.address)

        const activePool_LUSDDebt_After = await activePool.getSIMDebt()

        th.assertIsApproximatelyEqual(activePool_LUSDDebt_After, activePool_LUSDDebt_Before.add(toBN(dec(100, 18))))
    })

    it("adjustTrove(): new coll = 0 and new debt = 0 is not allowed, as gas compensation still counts toward ICR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
        const aliceColl = await getTroveEntireColl(alice.address)
        const aliceDebt = await getTroveEntireColl(alice.address)
        const status_Before = await troveManager.getTroveStatus(alice.address)
        const isInSortedList_Before = await sortedTroves.contains(alice.address)

        assert.equal(status_Before.toNumber(), 1)  // 1: Active
        assert.isTrue(isInSortedList_Before)

        await assertRevert(
            borrowerOperations.connect(alice).adjustTrove(0, th._100pct, aliceColl, aliceDebt, true, alice.address, alice.address),
            'BorrowerOps: An operation that would result in ICR < MCR is not permitted'
        )
    })

    it("adjustTrove(): Reverts if requested debt increase and amount is zero", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(0, th._100pct, 0, 0, true, alice.address, alice.address),
            'BorrowerOps: Debt increase requires non-zero debtChange')
    })

    it("adjustTrove(): Reverts if requested coll withdrawal and ether is sent", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(dec(3, 'ether'), th._100pct, dec(1, 'ether'), dec(100, 18), true, alice.address, alice.address), 'BorrowerOperations: Cannot withdraw and add coll')
    })

    it("adjustTrove(): Reverts if it’s zero adjustment", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        await assertRevert(borrowerOperations.connect(alice).adjustTrove(0, th._100pct, 0, 0, false, alice.address, alice.address),
            'BorrowerOps: There must be either a collateral change or a debt change')
    })

    it("adjustTrove(): Reverts if requested coll withdrawal is greater than trove's collateral", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })

        const aliceColl = await getTroveEntireColl(alice.address)

        // Requested coll withdrawal > coll in the trove
        await assertRevert(borrowerOperations.connect(alice).adjustTrove(0, th._100pct, aliceColl.add(toBN(1)), 0, false, alice.address, alice.address))
        await assertRevert(borrowerOperations.connect(bob).adjustTrove(0, th._100pct, aliceColl.add(toBN(dec(37, 'ether'))), 0, false, bob.address, bob.address))
    })

    it("adjustTrove(): Reverts if borrower has insufficient LUSD balance to cover his debt repayment", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: B } })
        const bobDebt = await getTroveEntireDebt(B.address)

        // Bob transfers some LUSD to carol
        await simToken.connect(B).transfer(C.address, dec(10, 18))

        //Confirm B's LUSD balance is less than 50 LUSD
        const B_LUSDBal = await simToken.balanceOf(B.address)
        assert.isTrue(B_LUSDBal.lt(bobDebt))

        const repayLUSDPromise_B = borrowerOperations.connect(B).adjustTrove(0, th._100pct, 0, bobDebt, false, B.address, B.address)

        // B attempts to repay all his debt
        await assertRevert(repayLUSDPromise_B, "revert")
    })

    // --- Internal _adjustTrove() ---

    it("Internal _adjustTrove(): reverts when op is a withdrawal and _borrower param is not the msg.sender", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        await assertRevert(borrowerOperations.connect(bob).callInternalAdjustLoan(whale.address, dec(1, 18), dec(1, 18), true, alice.address, alice.address), "reverted with panic code 0x1 (Assertion error)")
        const txPromise_B = borrowerOperations.connect(owner).callInternalAdjustLoan(bob.address, dec(1, 18), dec(1, 18), true, alice.address, alice.address)
        await assertRevert(txPromise_B, "reverted with panic code 0x1 (Assertion error)")
        const txPromise_C = borrowerOperations.connect(bob).callInternalAdjustLoan(carol.address, dec(1, 18), dec(1, 18), true, alice.address, alice.address)
        await assertRevert(txPromise_C, "BorrowerOps: Trove does not exist or is closed")
    })

    // --- closeTrove() ---

    it("closeTrove(): reverts when it would lower the TCR below CCR", async () => {
        await openTrove({ ICR: toBN(dec(300, 16)), extraParams:{ from: alice } })
        await openTrove({ ICR: toBN(dec(120, 16)), extraLUSDAmount: toBN(dec(300, 18)), extraParams:{ from: bob } })

        const price = await priceFeed.getPrice()

        // to compensate borrowing fees
        await simToken.connect(bob).transfer(alice.address, dec(300, 18))

        assert.isFalse(await troveManager.checkRecoveryMode(price))

        await assertRevert(
            borrowerOperations.connect(alice).closeTrove(),
            "BorrowerOps: An operation that would result in TCR < CCR is not permitted"
        )
    })

    it("closeTrove(): reverts when calling address does not have active trove", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: bob } })

        // Carol with no active trove attempts to close her trove
        try {
            const txCarol = await borrowerOperations.connect(carol).closeTrove()
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("closeTrove(): reverts when system is in Recovery Mode", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        // Alice transfers her LUSD to Bob and Carol so they can cover fees
        const aliceBal = await simToken.balanceOf(alice.address)
        await simToken.connect(alice).transfer(bob.address, aliceBal.div(toBN(2)))
        await simToken.connect(alice).transfer(carol.address, aliceBal.div(toBN(2)))

        // check Recovery Mode
        assert.isFalse(await th.checkRecoveryMode(contracts))

        // Bob successfully closes his trove
        const txBob = await borrowerOperations.connect(bob).closeTrove()
        // assert.isTrue(txBob.receipt.status)

        await priceFeed.setPrice(dec(100, 18))

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // Carol attempts to close her trove during Recovery Mode
        await assertRevert(borrowerOperations.connect(carol).closeTrove(), "BorrowerOps: Operation not permitted during Recovery Mode")
    })

    it("closeTrove(): reverts when trove is the only one in the system", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // Artificially mint to Alice so she has enough to close her trove
        await simToken.unprotectedMint(alice.address, dec(100000, 18))

        // Check she has more LUSD than her trove debt
        const aliceBal = await simToken.balanceOf(alice.address)
        const aliceDebt = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceBal.gt(aliceDebt))

        // check Recovery Mode
        assert.isFalse(await th.checkRecoveryMode(contracts))

        // Alice attempts to close her trove
        await assertRevert(borrowerOperations.connect(alice).closeTrove(), "TroveManager: Only one trove in the system")
    })

    it("closeTrove(): reduces a Trove's collateral to zero", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceCollBefore = await getTroveEntireColl(alice.address)
        const dennisLUSD = await simToken.balanceOf(dennis.address)
        assert.isTrue(aliceCollBefore.gt(toBN('0')))
        assert.isTrue(dennisLUSD.gt(toBN('0')))

        // To compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, dennisLUSD.div(toBN(2)))

        // Alice attempts to close trove
        await borrowerOperations.connect(alice).closeTrove()

        const aliceCollAfter = await getTroveEntireColl(alice.address)
        assert.equal(aliceCollAfter.toString(), '0')
    })

    it("closeTrove(): reduces a Trove's debt to zero", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceDebtBefore = await getTroveEntireColl(alice.address)
        const dennisLUSD = await simToken.balanceOf(dennis.address)
        assert.isTrue(aliceDebtBefore.gt(toBN('0')))
        assert.isTrue(dennisLUSD.gt(toBN('0')))

        // To compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, dennisLUSD.div(toBN(2)))

        // Alice attempts to close trove
        await borrowerOperations.connect(alice).closeTrove()

        const aliceCollAfter = await getTroveEntireColl(alice.address)
        assert.equal(aliceCollAfter.toString(), '0')
    })

    it("closeTrove(): sets Trove's stake to zero", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceStakeBefore = await troveManager.getTroveStake(alice.address)
        assert.isTrue(aliceStakeBefore.gt(toBN('0')))

        const dennisLUSD = await simToken.balanceOf(dennis.address)
        assert.isTrue(aliceStakeBefore.gt(toBN('0')))
        assert.isTrue(dennisLUSD.gt(toBN('0')))

        // To compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, dennisLUSD.div(toBN(2)))

        // Alice attempts to close trove
        await borrowerOperations.connect(alice).closeTrove()

        const stakeAfter = ((await troveManager.Troves(alice.address))[2]).toString()
        assert.equal(stakeAfter, '0')
        // check withdrawal was successful
    })

    it("closeTrove(): zero's the troves reward snapshots", async () => {
        // Dennis opens trove and transfers tokens to alice
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Price drops
        await priceFeed.setPrice(dec(100, 18))

        // Liquidate Bob
        await troveManager.liquidate(bob.address)
        assert.isFalse(await sortedTroves.contains(bob.address))

        // Price bounces back
        await priceFeed.setPrice(dec(200, 18))

        // Alice and Carol open troves
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        // Price drops ...again
        await priceFeed.setPrice(dec(100, 18))

        // Get Alice's pending reward snapshots
        const L_ETH_A_Snapshot = (await troveManager.rewardSnapshots(alice.address))[0]
        const L_LUSDDebt_A_Snapshot = (await troveManager.rewardSnapshots(alice.address))[1]
        assert.isTrue(L_ETH_A_Snapshot.gt(toBN('0')))
        assert.isTrue(L_LUSDDebt_A_Snapshot.gt(toBN('0')))

        // Liquidate Carol
        await troveManager.liquidate(carol.address)
        assert.isFalse(await sortedTroves.contains(carol.address))

        // Get Alice's pending reward snapshots after Carol's liquidation. Check above 0
        const L_ETH_Snapshot_A_AfterLiquidation = (await troveManager.rewardSnapshots(alice.address))[0]
        const L_LUSDDebt_Snapshot_A_AfterLiquidation = (await troveManager.rewardSnapshots(alice.address))[1]

        assert.isTrue(L_ETH_Snapshot_A_AfterLiquidation.gt(toBN('0')))
        assert.isTrue(L_LUSDDebt_Snapshot_A_AfterLiquidation.gt(toBN('0')))

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        await priceFeed.setPrice(dec(200, 18))

        // Alice closes trove
        await borrowerOperations.connect(alice).closeTrove()

        // Check Alice's pending reward snapshots are zero
        const L_ETH_Snapshot_A_afterAliceCloses = (await troveManager.rewardSnapshots(alice.address))[0]
        const L_LUSDDebt_Snapshot_A_afterAliceCloses = (await troveManager.rewardSnapshots(alice.address))[1]

        assert.equal(L_ETH_Snapshot_A_afterAliceCloses.toString(), '0')
        assert.equal(L_LUSDDebt_Snapshot_A_afterAliceCloses.toString(), '0')
    })

    it("closeTrove(): sets trove's status to closed and removes it from sorted troves list", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // Check Trove is active
        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const status_Before = alice_Trove_Before[3]

        assert.equal(status_Before, 1)
        assert.isTrue(await sortedTroves.contains(alice.address))

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        // Close the trove
        await borrowerOperations.connect(alice).closeTrove()

        const alice_Trove_After = await troveManager.Troves(alice.address)
        const status_After = alice_Trove_After[3]

        assert.equal(status_After, 2)
        assert.isFalse(await sortedTroves.contains(alice.address))
    })

    it("closeTrove(): reduces ActivePool ETH and raw ether by correct amount", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const dennisColl = await getTroveEntireColl(dennis.address)
        const aliceColl = await getTroveEntireColl(alice.address)
        assert.isTrue(dennisColl.gt('0'))
        assert.isTrue(aliceColl.gt('0'))

        // Check active Pool ETH before
        const activePool_ETH_before = await activePool.getWSTETH()
        const activePool_RawEther_before = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_before.eq(aliceColl.add(dennisColl)))
        assert.isTrue(activePool_ETH_before.gt(toBN('0')))
        assert.isTrue(activePool_RawEther_before.eq(activePool_ETH_before))

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        // Close the trove
        await borrowerOperations.connect(alice).closeTrove()

        // Check after
        const activePool_ETH_After = await activePool.getWSTETH()
        const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_After.eq(dennisColl))
        assert.isTrue(activePool_RawEther_After.eq(dennisColl))
    })

    it("closeTrove(): reduces ActivePool debt by correct amount", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const dennisDebt = await getTroveEntireDebt(dennis.address)
        const aliceDebt = await getTroveEntireDebt(alice.address)
        assert.isTrue(dennisDebt.gt('0'))
        assert.isTrue(aliceDebt.gt('0'))

        // Check before
        const activePool_Debt_before = await activePool.getSIMDebt()
        assert.isTrue(activePool_Debt_before.eq(aliceDebt.add(dennisDebt)))
        assert.isTrue(activePool_Debt_before.gt(toBN('0')))

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        // Close the trove
        await borrowerOperations.connect(alice).closeTrove()

        // Check after
        const activePool_Debt_After = await activePool.getSIMDebt()
        th.assertIsApproximatelyEqual(activePool_Debt_After, dennisDebt)
    })

    it("closeTrove(): updates the the total stakes", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Get individual stakes
        const aliceStakeBefore = await troveManager.getTroveStake(alice.address)
        const bobStakeBefore = await troveManager.getTroveStake(bob.address)
        const dennisStakeBefore = await troveManager.getTroveStake(dennis.address)
        assert.isTrue(aliceStakeBefore.gt('0'))
        assert.isTrue(bobStakeBefore.gt('0'))
        assert.isTrue(dennisStakeBefore.gt('0'))

        const totalStakesBefore = await troveManager.totalStakes()

        assert.isTrue(totalStakesBefore.eq(aliceStakeBefore.add(bobStakeBefore).add(dennisStakeBefore)))

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        // Alice closes trove
        await borrowerOperations.connect(alice).closeTrove()

        // Check stake and total stakes get updated
        const aliceStakeAfter = await troveManager.getTroveStake(alice.address)
        const totalStakesAfter = await troveManager.totalStakes()

        assert.equal(aliceStakeAfter.toNumber(), 0)
        assert.isTrue(totalStakesAfter.eq(totalStakesBefore.sub(aliceStakeBefore)))
    })

    it("closeTrove(): sends the correct amount of ETH to the user", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceColl = await getTroveEntireColl(alice.address)
        assert.isTrue(aliceColl.gt(toBN('0')))

        const alice_ETHBalance_Before = await contracts.wstETHMock.balanceOf(alice.address)

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        await borrowerOperations.connect(alice).closeTrove()

        const alice_ETHBalance_After = await contracts.wstETHMock.balanceOf(alice.address)
        const balanceDiff = alice_ETHBalance_After.sub(alice_ETHBalance_Before)

        assert.isTrue(balanceDiff.eq(aliceColl))
    })

    it("closeTrove(): subtracts the debt of the closed Trove from the Borrower's LUSDToken balance", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        const aliceDebt = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebt.gt(toBN('0')))

        // to compensate borrowing fees
        await simToken.connect(dennis).transfer(alice.address, await simToken.balanceOf(dennis.address))

        const alice_LUSDBalance_Before = await simToken.balanceOf(alice.address)
        assert.isTrue(alice_LUSDBalance_Before.gt(toBN('0')))

        // close trove
        await borrowerOperations.connect(alice).closeTrove()

        // check alice LUSD balance after
        const alice_LUSDBalance_After = await simToken.balanceOf(alice.address)
        th.assertIsApproximatelyEqual(alice_LUSDBalance_After, alice_LUSDBalance_Before.sub(aliceDebt/*.sub(LUSD_GAS_COMPENSATION)*/))
    })

    it("closeTrove(): applies pending rewards", async () => {
        // --- SETUP ---
        await openTrove({ extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        const whaleDebt = await getTroveEntireDebt(whale.address)
        const whaleColl = await getTroveEntireColl(whale.address)

        await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        const carolDebt = await getTroveEntireDebt(carol.address)
        const carolColl = await getTroveEntireColl(carol.address)

        // Whale transfers to A and B to cover their fees
        await simToken.connect(whale).transfer(alice.address, dec(10000, 18))
        await simToken.connect(whale).transfer(bob.address, dec(10000, 18))

        // --- TEST ---

        // price drops to 1ETH:100LUSD, reducing Carol's ICR below MCR
        await priceFeed.setPrice(dec(100, 18));
        const price = await priceFeed.getPrice()

        // liquidate Carol's Trove, Alice and Bob earn rewards.
        const liquidationTx = await troveManager.liquidate(carol.address);
        const [liquidatedDebt_C, liquidatedColl_C, gasComp_C] = await th.getEmittedLiquidationValues(liquidationTx)

        // Dennis opens a new Trove
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        // check Alice and Bob's reward snapshots are zero before they alter their Troves
        const alice_rewardSnapshot_Before = await troveManager.rewardSnapshots(alice.address)
        const alice_ETHrewardSnapshot_Before = alice_rewardSnapshot_Before[0]
        const alice_LUSDDebtRewardSnapshot_Before = alice_rewardSnapshot_Before[1]

        const bob_rewardSnapshot_Before = await troveManager.rewardSnapshots(bob.address)
        const bob_ETHrewardSnapshot_Before = bob_rewardSnapshot_Before[0]
        const bob_LUSDDebtRewardSnapshot_Before = bob_rewardSnapshot_Before[1]

        assert.equal(alice_ETHrewardSnapshot_Before.toNumber(), 0)
        assert.equal(alice_LUSDDebtRewardSnapshot_Before.toNumber(), 0)
        assert.equal(bob_ETHrewardSnapshot_Before.toNumber(), 0)
        assert.equal(bob_LUSDDebtRewardSnapshot_Before.toNumber(), 0)

        const defaultPool_ETH = await defaultPool.getWSTETH()
        const defaultPool_LUSDDebt = await defaultPool.getSIMDebt()

        // Carol's liquidated coll (1 ETH) and drawn debt should have entered the Default Pool
        assert.isAtMost(th.getDifference(defaultPool_ETH, liquidatedColl_C), 100)
        assert.isAtMost(th.getDifference(defaultPool_LUSDDebt, liquidatedDebt_C), 100)

        const pendingCollReward_A = await troveManager.getPendingWSTETHReward(alice.address)
        const pendingDebtReward_A = await troveManager.getPendingSIMDebtReward(alice.address)
        assert.isTrue(pendingCollReward_A.gt('0'))
        assert.isTrue(pendingDebtReward_A.gt('0'))

        // Close Alice's trove. Alice's pending rewards should be removed from the DefaultPool when she close.
        await borrowerOperations.connect(alice).closeTrove()

        const defaultPool_ETH_afterAliceCloses = await defaultPool.getWSTETH()
        const defaultPool_LUSDDebt_afterAliceCloses = await defaultPool.getSIMDebt()

        assert.isAtMost(th.getDifference(defaultPool_ETH_afterAliceCloses,
            defaultPool_ETH.sub(pendingCollReward_A)), 1000)
        assert.isAtMost(th.getDifference(defaultPool_LUSDDebt_afterAliceCloses,
            defaultPool_LUSDDebt.sub(pendingDebtReward_A)), 1000)

        // whale adjusts trove, pulling their rewards out of DefaultPool
        await borrowerOperations.connect(whale).adjustTrove(0, th._100pct, 0, dec(1, 18), true, whale.address, whale.address)

        // Close Bob's trove. Expect DefaultPool coll and debt to drop to 0, since closing pulls his rewards out.
        await borrowerOperations.connect(bob).closeTrove()

        const defaultPool_ETH_afterBobCloses = await defaultPool.getWSTETH()
        const defaultPool_LUSDDebt_afterBobCloses = await defaultPool.getSIMDebt()

        assert.isAtMost(th.getDifference(defaultPool_ETH_afterBobCloses, BigNumber.from(0)), 100000)
        assert.isAtMost(th.getDifference(defaultPool_LUSDDebt_afterBobCloses, BigNumber.from(0)), 100000)
    })

    it("closeTrove(): reverts if borrower has insufficient LUSD balance to repay his entire debt", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

        //Confirm Bob's LUSD balance is less than his trove debt
        const B_LUSDBal = await simToken.balanceOf(B.address)
        const B_troveDebt = await getTroveEntireDebt(B.address)

        assert.isTrue(B_LUSDBal.lt(B_troveDebt))

        const closeTrovePromise_B = borrowerOperations.connect(B).closeTrove()

        // Check closing trove reverts
        await assertRevert(closeTrovePromise_B, "BorrowerOps: Caller doesnt have enough SIM to make repayment")
    })

    // --- openTrove() ---

    it("openTrove(): emits a TroveUpdated event with the correct collateral and debt", async () => {
        const txA = (await openTrove({ extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })).tx
        const txB = (await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })).tx
        const txC = (await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })).tx

        const A_Coll = await getTroveEntireColl(A.address)
        const B_Coll = await getTroveEntireColl(B.address)
        const C_Coll = await getTroveEntireColl(C.address)
        const A_Debt = await getTroveEntireDebt(A.address)
        const B_Debt = await getTroveEntireDebt(B.address)
        const C_Debt = await getTroveEntireDebt(C.address)

        const A_emittedDebt = toBN(await th.getEventArgByName(txA, "TroveUpdated", "_debt"))
        const A_emittedColl = toBN(await th.getEventArgByName(txA, "TroveUpdated", "_coll"))
        const B_emittedDebt = toBN(await th.getEventArgByName(txB, "TroveUpdated", "_debt"))
        const B_emittedColl = toBN(await th.getEventArgByName(txB, "TroveUpdated", "_coll"))
        const C_emittedDebt = toBN(await th.getEventArgByName(txC, "TroveUpdated", "_debt"))
        const C_emittedColl = toBN(await th.getEventArgByName(txC, "TroveUpdated", "_coll"))

        // Check emitted debt values are correct
        assert.isTrue(A_Debt.eq(A_emittedDebt))
        assert.isTrue(B_Debt.eq(B_emittedDebt))
        assert.isTrue(C_Debt.eq(C_emittedDebt))

        // Check emitted coll values are correct
        assert.isTrue(A_Coll.eq(A_emittedColl))
        assert.isTrue(B_Coll.eq(B_emittedColl))
        assert.isTrue(C_Coll.eq(C_emittedColl))

        const baseRateBefore = await troveManager.baseRate()

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        assert.isTrue((await troveManager.baseRate()).gt(baseRateBefore))

        const txD = (await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })).tx
        const txE = (await openTrove({ extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })).tx
        const D_Coll = await getTroveEntireColl(D.address)
        const E_Coll = await getTroveEntireColl(E.address)
        const D_Debt = await getTroveEntireDebt(D.address)
        const E_Debt = await getTroveEntireDebt(E.address)

        const D_emittedDebt = toBN(await th.getEventArgByName(txD, "TroveUpdated", "_debt"))
        const D_emittedColl = toBN(await th.getEventArgByName(txD, "TroveUpdated", "_coll"))

        const E_emittedDebt = toBN(await th.getEventArgByName(txE, "TroveUpdated", "_debt"))
        const E_emittedColl = toBN(await th.getEventArgByName(txE, "TroveUpdated", "_coll"))

        // Check emitted debt values are correct
        assert.isTrue(D_Debt.eq(D_emittedDebt))
        assert.isTrue(E_Debt.eq(E_emittedDebt))

        // Check emitted coll values are correct
        assert.isTrue(D_Coll.eq(D_emittedColl))
        assert.isTrue(E_Coll.eq(E_emittedColl))
    })

    it("openTrove(): Opens a trove with net debt >= minimum net debt", async () => {
        // Add 1 wei to correct for rounding error in helper function
        await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('100', 30))
        const txA = await borrowerOperations.connect(A).openTrove(dec(100, 30), th._100pct, await getNetBorrowingAmount(MIN_NET_DEBT.add(toBN(1))), A.address, A.address)
        // assert.isTrue(txA.receipt.status)
        assert.isTrue(await sortedTroves.contains(A.address))

        await contracts.wstETHMock.connect(C).approve(contracts.borrowerOperations.address, parseUnits('100', 30))
        const txC = await borrowerOperations.connect(C).openTrove(dec(100, 30), th._100pct, await getNetBorrowingAmount(MIN_NET_DEBT.add(toBN(dec(47789898, 22)))), A.address, A.address)
        // assert.isTrue(txC.receipt.status)
        assert.isTrue(await sortedTroves.contains(C.address))
    })

    it("openTrove(): reverts if net debt < minimum net debt", async () => {
        const txAPromise = borrowerOperations.connect(A).openTrove(dec(100, 30), th._100pct, 0, A.address, A.address)
        await assertRevert(txAPromise, "revert")

        const txBPromise = borrowerOperations.connect(B).openTrove(dec(100, 30), th._100pct, await getNetBorrowingAmount(MIN_NET_DEBT.sub(toBN(1))), B.address, B.address)
        await assertRevert(txBPromise, "revert")

        const txCPromise = borrowerOperations.connect(C).openTrove(dec(100, 30), th._100pct, MIN_NET_DEBT.sub(toBN(dec(173, 18))), C.address, C.address)
        await assertRevert(txCPromise, "revert")
    })

    it("openTrove(): decays a non-zero base rate", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(37, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate has decreased
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.lt(baseRate_1))

        // 1 hour passes
        await th.fastForwardTime(3600)

        // E opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(12, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        const baseRate_3 = await troveManager.baseRate()
        assert.isTrue(baseRate_3.lt(baseRate_2))
    })

    it("openTrove(): doesn't change base rate if it is already zero", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        await th.fastForwardTime(7200)

        // D opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(37, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check baseRate is still 0
        const baseRate_2 = await troveManager.baseRate()
        assert.equal(baseRate_2.toString(), '0')

        // 1 hour passes
        await th.fastForwardTime(3600)

        // E opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(12, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        const baseRate_3 = await troveManager.baseRate()
        assert.equal(baseRate_3.toString(), '0')
    })

    it("openTrove(): lastFeeOpTime doesn't update if less time than decay interval has passed since the last fee operation", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        const lastFeeOpTime_1 = await troveManager.lastFeeOperationTime()

        // Borrower D triggers a fee
        await openTrove({ extraLUSDAmount: toBN(dec(1, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        const lastFeeOpTime_2 = await troveManager.lastFeeOperationTime()

        // Check that the last fee operation time did not update, as borrower D's debt issuance occured
        // since before minimum interval had passed
        assert.isTrue(lastFeeOpTime_2.eq(lastFeeOpTime_1))

        // 1 minute passes
        await th.fastForwardTime(60)

        // Check that now, at least one minute has passed since lastFeeOpTime_1
        const timeNow = await th.getLatestBlockTimestamp()
        assert.isTrue(toBN(timeNow).sub(lastFeeOpTime_1).gte(60))

        // Borrower E triggers a fee
        await openTrove({ extraLUSDAmount: toBN(dec(1, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        const lastFeeOpTime_3 = await troveManager.lastFeeOperationTime()

        // Check that the last fee operation time DID update, as borrower's debt issuance occured
        // after minimum interval had passed
        assert.isTrue(lastFeeOpTime_3.gt(lastFeeOpTime_1))
    })

    it("openTrove(): reverts if max fee > 100%", async () => {
        await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await assertRevert(borrowerOperations.connect(A).openTrove(dec(1000, 'ether'), dec(2, 18), dec(10000, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await contracts.wstETHMock.connect(B).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await assertRevert(borrowerOperations.connect(B).openTrove(dec(1000, 'ether'), '1000000000000000001', dec(20000, 18), B.address, B.address), "Max fee percentage must be between 0.5% and 100%")
    })

    it("openTrove(): reverts if max fee < 0.5% in Normal mode", async () => {
        await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await assertRevert(borrowerOperations.connect(A).openTrove(dec(1200, 'ether'), 0, dec(195000, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await assertRevert(borrowerOperations.connect(A).openTrove(dec(1000, 'ether'), 1, dec(195000, 18), A.address, A.address), "Max fee percentage must be between 0.5% and 100%")
        await contracts.wstETHMock.connect(B).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await assertRevert(borrowerOperations.connect(B).openTrove(dec(1200, 'ether'), '4999999999999999', dec(195000, 18), B.address, B.address), "Max fee percentage must be between 0.5% and 100%")
    })

    it("openTrove(): allows max fee < 0.5% in Recovery Mode", async () => {
        await contracts.wstETHMock.connect(A).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(A).openTrove(dec(2000, 'ether'), th._100pct, dec(195000, 18), A.address, A.address)

        await priceFeed.setPrice(dec(100, 18))
        assert.isTrue(await th.checkRecoveryMode(contracts))

        await contracts.wstETHMock.connect(B).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(B).openTrove(dec(3100, 'ether'), 0, dec(19500, 18), B.address, B.address)
        await priceFeed.setPrice(dec(50, 18))
        assert.isTrue(await th.checkRecoveryMode(contracts))
        await contracts.wstETHMock.connect(C).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(C).openTrove(dec(3100, 'ether'), 1, dec(19500, 18), C.address, C.address)
        await priceFeed.setPrice(dec(25, 18))
        assert.isTrue(await th.checkRecoveryMode(contracts))
        await contracts.wstETHMock.connect(D).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(D).openTrove(dec(3100, 'ether'), '4999999999999999', dec(19500, 18), D.address, D.address)
    })

    it("openTrove(): reverts if fee exceeds max fee percentage", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        const totalSupply = await simToken.totalSupply()

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        //       actual fee percentage: 0.005000000186264514
        // user's max fee percentage:  0.0049999999999999999
        let borrowingRate = await troveManager.getBorrowingRate() // expect max(0.5 + 5%, 5%) rate
        assert.equal(borrowingRate.toString(), dec(5, 16))

        const lessThan5pct = '49999999999999999'
        await contracts.wstETHMock.connect(D).approve(contracts.borrowerOperations.address, parseUnits('1000', 30))
        await assertRevert(borrowerOperations.connect(D).openTrove(dec(1000, 'ether'), lessThan5pct, dec(30000, 18), A.address, A.address), "Fee exceeded provided maximum")

        borrowingRate = await troveManager.getBorrowingRate() // expect 5% rate
        assert.equal(borrowingRate.toString(), dec(5, 16))
        // Attempt with maxFee 1%
        await contracts.wstETHMock.connect(D).approve(contracts.borrowerOperations.address, parseUnits('1000', 30))
        await assertRevert(borrowerOperations.connect(D).openTrove(dec(1000, 'ether'), dec(1, 16), dec(30000, 18), A.address, A.address), "Fee exceeded provided maximum")

        borrowingRate = await troveManager.getBorrowingRate() // expect 5% rate
        assert.equal(borrowingRate.toString(), dec(5, 16))
        // Attempt with maxFee 3.754%
        await contracts.wstETHMock.connect(D).approve(contracts.borrowerOperations.address, parseUnits('1000', 30))
        await assertRevert(borrowerOperations.connect(D).openTrove(dec(1000, 'ether'), dec(3754, 13), dec(30000, 18), A.address, A.address), "Fee exceeded provided maximum")

        borrowingRate = await troveManager.getBorrowingRate() // expect 5% rate
        assert.equal(borrowingRate.toString(), dec(5, 16))
        // Attempt with maxFee 1e-16%
        await contracts.wstETHMock.connect(D).approve(contracts.borrowerOperations.address, parseUnits('1000', 30))
        await assertRevert(borrowerOperations.connect(D).openTrove(dec(1000, 'ether'), dec(5, 15), dec(30000, 18), A.address, A.address), "Fee exceeded provided maximum")
    })

    it("openTrove(): succeeds when fee is less than max fee percentage", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        let borrowingRate = await troveManager.getBorrowingRate() // expect min(0.5 + 5%, 5%) rate
        assert.equal(borrowingRate.toString(), dec(5, 16))

        // Attempt with maxFee > 5%
        const moreThan5pct = '50000000000000001'
        await contracts.wstETHMock.connect(D).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        const tx1 = await borrowerOperations.connect(D).openTrove(dec(100, 'ether'), moreThan5pct, dec(10000, 18), A.address, A.address)
        // assert.isTrue(tx1.receipt.status)

        borrowingRate = await troveManager.getBorrowingRate() // expect 5% rate
        assert.equal(borrowingRate.toString(), dec(5, 16))

        // Attempt with maxFee = 5%
        await contracts.wstETHMock.connect(H).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        /*const tx2 = */await borrowerOperations.connect(H).openTrove(dec(100, 'ether'), dec(5, 16), dec(10000, 18), A.address, A.address)
        // assert.isTrue(tx2.receipt.status)

        borrowingRate = await troveManager.getBorrowingRate() // expect 5% rate
        assert.equal(borrowingRate.toString(), dec(5, 16))

        // Attempt with maxFee 10%
        await contracts.wstETHMock.connect(E).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        /*const tx3 = */await borrowerOperations.connect(E).openTrove(dec(100, 'ether'), dec(1, 17), dec(10000, 18), A.address, A.address)
        // assert.isTrue(tx3.receipt.status)

        borrowingRate = await troveManager.getBorrowingRate() // expect 5% rate
        assert.equal(borrowingRate.toString(), dec(5, 16))

        // Attempt with maxFee 37.659%
        await contracts.wstETHMock.connect(F).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        /*const tx4 = */await borrowerOperations.connect(F).openTrove(dec(100, 'ether'), dec(37659, 13), dec(10000, 18), A.address, A.address)
        // assert.isTrue(tx4.receipt.status)

        // Attempt with maxFee 100%
        await contracts.wstETHMock.connect(G).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        /*const tx5 = */await borrowerOperations.connect(G).openTrove(dec(100, 'ether'), dec(1, 18), dec(10000, 18), A.address, A.address)
        // assert.isTrue(tx5.receipt.status)
    })

    it("openTrove(): borrower can't grief the baseRate and stop it decaying by issuing debt at higher frequency than the decay granularity", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 59 minutes pass
        await th.fastForwardTime(3540)

        // Assume Borrower also owns accounts D and E
        // Borrower triggers a fee, before decay interval has passed
        await openTrove({ extraLUSDAmount: toBN(dec(1, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // 1 minute pass
        await th.fastForwardTime(3540)

        // Borrower triggers another fee
        await openTrove({ extraLUSDAmount: toBN(dec(1, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })

        // Check base rate has decreased even though Borrower tried to stop it decaying
        const baseRate_2 = await troveManager.baseRate()
        assert.isTrue(baseRate_2.lt(baseRate_1))
    })

    // todo ve
    /*it("openTrove(): borrowing at non-zero base rate sends LUSD fee to LQTY staking contract", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY LUSD balance before == 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStaking_LUSDBalance_Before, '0')

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check LQTY LUSD balance after has increased
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))
    })

    it("openTrove(): borrowing at non-zero base records the (drawn debt + fee  + liq. reserve) on the Trove struct", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        const D_LUSDRequest = toBN(dec(20000, 18))

        // D withdraws LUSD
        const openTroveTx = await borrowerOperations.openTrove(th._100pct, D_LUSDRequest, ZERO_ADDRESS, ZERO_ADDRESS, { from: D, value: dec(200, 'ether') })

        const emittedFee = toBN(th.getLUSDFeeFromLUSDBorrowingEvent(openTroveTx))
        assert.isTrue(toBN(emittedFee).gt(toBN('0')))

        const newDebt = (await troveManager.Troves(D))[0]

        // Check debt on Trove struct equals drawn debt plus emitted fee
        th.assertIsApproximatelyEqual(newDebt, D_LUSDRequest.add(emittedFee).add(LUSD_GAS_COMPENSATION), 100000)
    })

    it("openTrove(): Borrowing at non-zero base rate increases the LQTY staking contract LUSD fees-per-unit-staked", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY contract LUSD fees-per-unit-staked is zero
        const F_LUSD_Before = await lqtyStaking.F_LUSD()
        assert.equal(F_LUSD_Before, '0')

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is now non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(37, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check LQTY contract LUSD fees-per-unit-staked has increased
        const F_LUSD_After = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_After.gt(F_LUSD_Before))
    })

    it("openTrove(): Borrowing at non-zero base rate sends requested amount to the user", async () => {
        // time fast-forwards 1 year, and multisig stakes 1 LQTY
        await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)
        await lqtyToken.approve(lqtyStaking.address, dec(1, 18), { from: multisig })
        await lqtyStaking.stake(dec(1, 18), { from: multisig })

        // Check LQTY Staking contract balance before == 0
        const lqtyStaking_LUSDBalance_Before = await simToken.balanceOf(lqtyStaking.address)
        assert.equal(lqtyStaking_LUSDBalance_Before, '0')

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Artificially make baseRate 5%
        await troveManager.setBaseRate(dec(5, 16))
        await troveManager.setLastFeeOpTimeToNow()

        // Check baseRate is non-zero
        const baseRate_1 = await troveManager.baseRate()
        assert.isTrue(baseRate_1.gt(toBN('0')))

        // 2 hours pass
        th.fastForwardTime(7200)

        // D opens trove
        const LUSDRequest_D = toBN(dec(40000, 18))
        await borrowerOperations.openTrove(th._100pct, LUSDRequest_D, D.address, D.address, { from: D, value: dec(500, 'ether') })

        // Check LQTY staking LUSD balance has increased
        const lqtyStaking_LUSDBalance_After = await simToken.balanceOf(lqtyStaking.address)
        assert.isTrue(lqtyStaking_LUSDBalance_After.gt(lqtyStaking_LUSDBalance_Before))

        // Check D's LUSD balance now equals their requested LUSD
        const LUSDBalance_D = await simToken.balanceOf(D.address)
        assert.isTrue(LUSDRequest_D.eq(LUSDBalance_D))
    })

    it("openTrove(): Borrowing at zero base rate changes the LQTY staking contract LUSD fees-per-unit-staked", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

        // Check baseRate is zero
        const baseRate_1 = await troveManager.baseRate()
        assert.equal(baseRate_1.toString(), '0')

        // 2 hours pass
        th.fastForwardTime(7200)

        // Check LUSD reward per LQTY staked == 0
        const F_LUSD_Before = await lqtyStaking.F_LUSD()
        assert.equal(F_LUSD_Before, '0')

        // A stakes LQTY
        await lqtyToken.unprotectedMint(A, dec(100, 18))
        await lqtyStaking.stake(dec(100, 18), { from: A })

        // D opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(37, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

        // Check LUSD reward per LQTY staked > 0
        const F_LUSD_After = await lqtyStaking.F_LUSD()
        assert.isTrue(F_LUSD_After.gt(toBN('0')))
    })*/

    it("openTrove(): Borrowing at zero base rate charges minimum fee", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

        const LUSDRequest = toBN(dec(10000, 18))
        await contracts.wstETHMock.connect(C).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        const txC = await borrowerOperations.connect(C).openTrove(dec(100, 'ether'), th._100pct, LUSDRequest, ZERO_ADDRESS, ZERO_ADDRESS)
        const _LUSDFee = toBN(await th.getEventArgByName(txC, "SIMBorrowingFeePaid", "_SIMFee"))

        const expectedFee = BORROWING_FEE_FLOOR.mul(toBN(LUSDRequest)).div(toBN(dec(1, 18)))
        assert.isTrue(_LUSDFee.eq(expectedFee))
    })

    it("openTrove(): reverts when system is in Recovery Mode and ICR < CCR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        assert.isFalse(await th.checkRecoveryMode(contracts))

        // price drops, and Recovery Mode kicks in
        await priceFeed.setPrice(dec(105, 18))

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // Bob tries to open a trove with 149% ICR during Recovery Mode
        try {
            const txBob = await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(149, 16)), extraParams: { from: alice } })
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("openTrove(): reverts when trove ICR < MCR", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        assert.isFalse(await th.checkRecoveryMode(contracts))

        // Bob attempts to open a 109% ICR trove in Normal Mode
        try {
            const txBob = (await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(109, 16)), extraParams: { from: bob } })).tx
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }

        // price drops, and Recovery Mode kicks in
        await priceFeed.setPrice(dec(105, 18))

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // Bob attempts to open a 109% ICR trove in Recovery Mode
        try {
            const txBob = await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(109, 16)), extraParams: { from: bob } })
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("openTrove(): reverts when opening the trove would cause the TCR of the system to fall below the CCR", async () => {
        await priceFeed.setPrice(dec(100, 18))

        // Alice creates trove with 150% ICR.  System TCR = 150%.
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: alice } })

        const TCR = await th.getTCR(contracts)
        assert.equal(TCR.toString(), dec(150, 16))

        // Bob attempts to open a trove with ICR = 149%
        // System TCR would fall below 150%
        try {
            const txBob = await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(149, 16)), extraParams: { from: bob } })
            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), "revert")
        }
    })

    it("openTrove(): reverts if trove is already active", async () => {
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: bob } })

        try {
            const txB_1 = await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(3, 18)), extraParams: { from: bob } })

            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), 'revert')
        }

        try {
            const txB_2 = await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

            assert.isFalse(1)
        } catch (err) {
            assert.include(err?.toString(), 'revert')
        }
    })

    it("openTrove(): Can open a trove with ICR >= CCR when system is in Recovery Mode", async () => {
        // --- SETUP ---
        //  Alice and Bob add coll and withdraw such  that the TCR is ~150%
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: bob } })

        const TCR = (await th.getTCR(contracts)).toString()
        assert.equal(TCR, '1500000000000000000')

        // price drops to 1ETH:100LUSD, reducing TCR below 150%
        await priceFeed.setPrice('100000000000000000000');
        const price = await priceFeed.getPrice()

        assert.isTrue(await th.checkRecoveryMode(contracts))

        // Carol opens at 150% ICR in Recovery Mode
        /*const txCarol = (*/await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: carol } })/*).tx*/
        // assert.isTrue(txCarol.receipt.status)
        assert.isTrue(await sortedTroves.contains(carol.address))

        const carol_TroveStatus = await troveManager.getTroveStatus(carol.address)
        assert.equal(carol_TroveStatus.toNumber(), 1)

        const carolICR = await troveManager.getCurrentICR(carol.address, price)
        assert.isTrue(carolICR.gt(toBN(dec(150, 16))))
    })

    it("openTrove(): Reverts opening a trove with min debt when system is in Recovery Mode", async () => {
        // --- SETUP ---
        //  Alice and Bob add coll and withdraw such  that the TCR is ~150%
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: bob } })

        const TCR = (await th.getTCR(contracts)).toString()
        assert.equal(TCR, '1500000000000000000')

        // price drops to 1ETH:100LUSD, reducing TCR below 150%
        await priceFeed.setPrice('100000000000000000000');

        assert.isTrue(await th.checkRecoveryMode(contracts))

        await assertRevert(borrowerOperations.connect(carol).openTrove(dec(1, 'ether'), th._100pct, await getNetBorrowingAmount(MIN_NET_DEBT), carol.address, carol.address))
    })

    it("openTrove(): creates a new Trove and assigns the correct collateral and debt amount", async () => {
        const debt_Before = await getTroveEntireDebt(alice.address)
        const coll_Before = await getTroveEntireColl(alice.address)
        const status_Before = await troveManager.getTroveStatus(alice.address)

        // check coll and debt before
        assert.equal(debt_Before.toNumber(), 0)
        assert.equal(coll_Before.toNumber(), 0)

        // check non-existent status
        assert.equal(status_Before.toNumber(), 0)

        const LUSDRequest = MIN_NET_DEBT
        await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(alice).openTrove(dec(100, 'ether'), th._100pct, MIN_NET_DEBT, carol.address, carol.address)

        // Get the expected debt based on the LUSD request (adding fee and liq. reserve on top)
        const expectedDebt = LUSDRequest
            .add(await troveManager.getBorrowingFee(LUSDRequest))
            /*.add(LUSD_GAS_COMPENSATION)*/

        const debt_After = await getTroveEntireDebt(alice.address)
        const coll_After = await getTroveEntireColl(alice.address)
        const status_After = await troveManager.getTroveStatus(alice.address)

        // check coll and debt after
        assert.isTrue(coll_After.gt('0'))
        assert.isTrue(debt_After.gt('0'))

        assert.isTrue(debt_After.eq(expectedDebt))

        // check active status
        assert.equal(status_After.toNumber(), 1)
    })

    it("openTrove(): adds Trove owner to TroveOwners array", async () => {
        const TroveOwnersCount_Before = (await troveManager.getTroveOwnersCount()).toString();
        assert.equal(TroveOwnersCount_Before, '0')

        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(15, 17)), extraParams: { from: alice } })

        const TroveOwnersCount_After = (await troveManager.getTroveOwnersCount()).toString();
        assert.equal(TroveOwnersCount_After, '1')
    })

    it("openTrove(): creates a stake and adds it to total stakes", async () => {
        const aliceStakeBefore = await troveManager.getTroveStake(alice.address)
        const totalStakesBefore = await troveManager.totalStakes()

        assert.equal(aliceStakeBefore.toString(), '0')
        assert.equal(totalStakesBefore.toString(), '0')

        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const aliceCollAfter = await getTroveEntireColl(alice.address)
        const aliceStakeAfter = await troveManager.getTroveStake(alice.address)
        assert.isTrue(aliceCollAfter.gt(toBN('0')))
        assert.isTrue(aliceStakeAfter.eq(aliceCollAfter))

        const totalStakesAfter = await troveManager.totalStakes()

        assert.isTrue(totalStakesAfter.eq(aliceStakeAfter))
    })

    it("openTrove(): inserts Trove to Sorted Troves list", async () => {
        // Check before
        const aliceTroveInList_Before = await sortedTroves.contains(alice.address)
        const listIsEmpty_Before = await sortedTroves.isEmpty()
        assert.equal(aliceTroveInList_Before, false)
        assert.equal(listIsEmpty_Before, true)

        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // check after
        const aliceTroveInList_After = await sortedTroves.contains(alice.address)
        const listIsEmpty_After = await sortedTroves.isEmpty()
        assert.equal(aliceTroveInList_After, true)
        assert.equal(listIsEmpty_After, false)
    })

    it("openTrove(): Increases the activePool ETH and raw ether balance by correct amount", async () => {
        const activePool_ETH_Before = await activePool.getWSTETH()
        const activePool_RawEther_Before = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.equal(activePool_ETH_Before.toNumber(), 0)
        assert.equal(activePool_RawEther_Before.toNumber(), 0)

        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const aliceCollAfter = await getTroveEntireColl(alice.address)

        const activePool_ETH_After = await activePool.getWSTETH()
        const activePool_RawEther_After = await contracts.wstETHMock.balanceOf(activePool.address)
        assert.isTrue(activePool_ETH_After.eq(aliceCollAfter))
        assert.isTrue(activePool_RawEther_After.eq(aliceCollAfter))
    })

    it("openTrove(): records up-to-date initial snapshots of L_ETH and L_LUSDDebt", async () => {
        // --- SETUP ---

        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        // --- TEST ---

        // price drops to 1ETH:100LUSD, reducing Carol's ICR below MCR
        await priceFeed.setPrice(dec(100, 18));

        // close Carol's Trove, liquidating her 1 ether and 180LUSD.
        const liquidationTx = await troveManager.connect(owner).liquidate(carol.address);
        const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

        /* with total stakes = 10 ether, after liquidation, L_ETH should equal 1/10 ether per-ether-staked,
         and L_LUSD should equal 18 LUSD per-ether-staked. */

        const L_ETH = await troveManager.L_WSTETH()
        const L_LUSD = await troveManager.L_SIMDebt()

        assert.isTrue(L_ETH.gt(toBN('0')))
        assert.isTrue(L_LUSD.gt(toBN('0')))

        // Bob opens trove
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

        // Check Bob's snapshots of L_ETH and L_LUSD equal the respective current values
        const bob_rewardSnapshot = await troveManager.rewardSnapshots(bob.address)
        const bob_ETHrewardSnapshot = bob_rewardSnapshot[0]
        const bob_LUSDDebtRewardSnapshot = bob_rewardSnapshot[1]

        assert.isAtMost(th.getDifference(bob_ETHrewardSnapshot, L_ETH), 1000)
        assert.isAtMost(th.getDifference(bob_LUSDDebtRewardSnapshot, L_LUSD), 1000)
    })

    it("openTrove(): allows a user to open a Trove, then close it, then re-open it", async () => {
        // Open Troves
        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

        // Check Trove is active
        const alice_Trove_1 = await troveManager.Troves(alice.address)
        const status_1 = alice_Trove_1[3]
        assert.equal(status_1, 1)
        assert.isTrue(await sortedTroves.contains(alice.address))

        // to compensate borrowing fees
        await simToken.connect(whale).transfer(alice.address, dec(10000, 18))

        // Repay and close Trove
        await borrowerOperations.connect(alice).closeTrove()

        // Check Trove is closed
        const alice_Trove_2 = await troveManager.Troves(alice.address)
        const status_2 = alice_Trove_2[3]
        assert.equal(status_2, 2)
        assert.isFalse(await sortedTroves.contains(alice.address))

        // Re-open Trove
        await openTrove({ extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

        // Check Trove is re-opened
        const alice_Trove_3 = await troveManager.Troves(alice.address)
        const status_3 = alice_Trove_3[3]
        assert.equal(status_3, 1)
        assert.isTrue(await sortedTroves.contains(alice.address))
    })

    it("openTrove(): increases the Trove's LUSD debt by the correct amount", async () => {
        // check before
        const alice_Trove_Before = await troveManager.Troves(alice.address)
        const debt_Before = alice_Trove_Before[0]
        assert.equal(debt_Before.toNumber(), 0)

        await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(alice).openTrove(dec(100, 'ether'), th._100pct, await getOpenTroveLUSDAmount(toBN(dec(10000, 18))), alice.address, alice.address)

        // check after
        const alice_Trove_After = await troveManager.Troves(alice.address)
        const debt_After = alice_Trove_After[0]
        th.assertIsApproximatelyEqual(debt_After, toBN(dec(10000, 18)), 10000)
    })

    it("openTrove(): increases LUSD debt in ActivePool by the debt of the trove", async () => {
        const activePool_LUSDDebt_Before = await activePool.getSIMDebt()
        assert.equal(activePool_LUSDDebt_Before.toNumber(), 0)

        await openTrove({ extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
        const aliceDebt = await getTroveEntireDebt(alice.address)
        assert.isTrue(aliceDebt.gt(toBN('0')))

        const activePool_LUSDDebt_After = await activePool.getSIMDebt()
        assert.isTrue(activePool_LUSDDebt_After.eq(aliceDebt))
    })

    it("openTrove(): increases user LUSDToken balance by correct amount", async () => {
        // check before
        const alice_LUSDTokenBalance_Before = await simToken.balanceOf(alice.address)
        assert.equal(alice_LUSDTokenBalance_Before.toNumber(), 0)

        await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        await borrowerOperations.connect(alice).openTrove(dec(100, 'ether'), th._100pct, dec(10000, 18), alice.address, alice.address)

        // check after
        const alice_LUSDTokenBalance_After = await simToken.balanceOf(alice.address)
        assert.equal(alice_LUSDTokenBalance_After.toString(), dec(10000, 18))
    })

    //  --- getNewICRFromTroveChange - (external wrapper in Tester contract calls internal function) ---

    describe("getNewICRFromTroveChange() returns the correct ICR", async () => {

        let price: BigNumber
        // 0, 0
        it("collChange = 0, debtChange = 0", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = 0
            const debtChange = 0

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, true, debtChange, true, price)).toString()
            assert.equal(newICR, '2000000000000000000')
        })

        it("collChange = 0, debtChange is positive", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = 0
            const debtChange = dec(50, 18)

            const newICR = await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, true, debtChange, true, price)
            assert.isAtMost(th.getDifference(newICR, toBN('1333333333333333333')), 100)
        })

        it("collChange = 0, debtChange is negative", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = 0
            const debtChange = dec(50, 18)

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, true, debtChange, false, price)).toString()
            assert.equal(newICR, '4000000000000000000')
        })

        it("collChange is positive, debtChange is 0", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = dec(1, 'ether')
            const debtChange = 0

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, true, debtChange, true, price)).toString()
            assert.equal(newICR, '4000000000000000000')
        })

        // -ve, 0
        it("collChange is negative, debtChange is 0", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = dec(5, 17)
            const debtChange = 0

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, false, debtChange, true, price)).toString()
            assert.equal(newICR, '1000000000000000000')
        })

        // -ve, -ve
        it("collChange is negative, debtChange is negative", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = dec(5, 17)
            const debtChange = dec(50, 18)

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, false, debtChange, false, price)).toString()
            assert.equal(newICR, '2000000000000000000')
        })

        // +ve, +ve
        it("collChange is positive, debtChange is positive", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = dec(1, 'ether')
            const debtChange = dec(100, 18)

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, true, debtChange, true, price)).toString()
            assert.equal(newICR, '2000000000000000000')
        })

        it("collChange is positive, debtChange is negative", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = dec(1, 'ether')
            const debtChange = dec(50, 18)

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, true, debtChange, false, price)).toString()
            assert.equal(newICR, '8000000000000000000')
        })

        it("collChange is negative, debtChange is positive", async () => {
            price = await priceFeed.getPrice()
            const initialColl = dec(1, 'ether')
            const initialDebt = dec(100, 18)
            const collChange = dec(5, 17)
            const debtChange = dec(100, 18)

            const newICR = (await borrowerOperations.getNewICRFromTroveChange(initialColl, initialDebt, collChange, false, debtChange, true, price)).toString()
            assert.equal(newICR, '500000000000000000')
        })
    })

    // --- getCompositeDebt ---

    /*it("getCompositeDebt(): returns debt + gas comp", async () => {
        const res1 = await borrowerOperations.getCompositeDebt('0')
        assert.equal(res1, LUSD_GAS_COMPENSATION.toString())

        const res2 = await borrowerOperations.getCompositeDebt(dec(90, 18))
        th.assertIsApproximatelyEqual(res2, LUSD_GAS_COMPENSATION.add(toBN(dec(90, 18))))

        const res3 = await borrowerOperations.getCompositeDebt(dec(24423422357345049, 12))
        th.assertIsApproximatelyEqual(res3, LUSD_GAS_COMPENSATION.add(toBN(dec(24423422357345049, 12))))
    })*/

    //  --- getNewTCRFromTroveChange  - (external wrapper in Tester contract calls internal function) ---

    describe("getNewTCRFromTroveChange() returns the correct TCR", async () => {

        it("collChange = 0, debtChange = 0", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = 0
            const debtChange = 0
            const newTCR = await borrowerOperations.getNewTCRFromTroveChange(collChange, true, debtChange, true, price)

            const expectedTCR = (troveColl.add(liquidatedColl)).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        it("collChange = 0, debtChange is positive", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = 0
            const debtChange = dec(200, 18)
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, true, debtChange, true, price))

            const expectedTCR = (troveColl.add(liquidatedColl)).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt).add(toBN(debtChange)))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        it("collChange = 0, debtChange is negative", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()
            // --- TEST ---
            const collChange = 0
            const debtChange = dec(100, 18)
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, true, debtChange, false, price))

            const expectedTCR = (troveColl.add(liquidatedColl)).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt).sub(toBN(dec(100, 18))))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        it("collChange is positive, debtChange is 0", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()
            // --- TEST ---
            const collChange = dec(2, 'ether')
            const debtChange = 0
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, true, debtChange, true, price))

            const expectedTCR = (troveColl.add(liquidatedColl).add(toBN(collChange))).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        it("collChange is negative, debtChange is 0", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = dec(1, 18)
            const debtChange = 0
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, false, debtChange, true, price))

            const expectedTCR = (troveColl.add(liquidatedColl).sub(toBN(dec(1, 'ether')))).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        // -ve, -ve
        it("collChange is negative, debtChange is negative", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = dec(1, 18)
            const debtChange = dec(100, 18)
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, false, debtChange, false, price))

            const expectedTCR = (troveColl.add(liquidatedColl).sub(toBN(dec(1, 'ether')))).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt).sub(toBN(dec(100, 18))))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        // +ve, +ve
        it("collChange is positive, debtChange is positive", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = dec(1, 'ether')
            const debtChange = dec(100, 18)
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, true, debtChange, true, price))

            const expectedTCR = (troveColl.add(liquidatedColl).add(toBN(dec(1, 'ether')))).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt).add(toBN(dec(100, 18))))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        it("collChange is positive, debtChange is negative", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = dec(1, 'ether')
            const debtChange = dec(100, 18)
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, true, debtChange, false, price))

            const expectedTCR = (troveColl.add(liquidatedColl).add(toBN(dec(1, 'ether')))).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt).sub(toBN(dec(100, 18))))

            assert.isTrue(newTCR.eq(expectedTCR))
        })

        it("collChange is negative, debtChange is positive", async () => {
            // --- SETUP --- Create a Liquity instance with an Active Pool and pending rewards (Default Pool)
            const troveColl = toBN(dec(1000, 'ether'))
            const troveTotalDebt = toBN(dec(100000, 18))
            const troveLUSDAmount = await getOpenTroveLUSDAmount(troveTotalDebt)
            await contracts.wstETHMock.connect(alice).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(alice).openTrove(troveColl, th._100pct, troveLUSDAmount, alice.address, alice.address)
            await contracts.wstETHMock.connect(bob).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
            await borrowerOperations.connect(bob).openTrove(troveColl, th._100pct, troveLUSDAmount, bob.address, bob.address)

            await priceFeed.setPrice(dec(100, 18))

            const liquidationTx = await troveManager.liquidate(bob.address)
            assert.isFalse(await sortedTroves.contains(bob.address))

            const [liquidatedDebt, liquidatedColl, gasComp] = await th.getEmittedLiquidationValues(liquidationTx)

            await priceFeed.setPrice(dec(200, 18))
            const price = await priceFeed.getPrice()

            // --- TEST ---
            const collChange = dec(1, 18)
            const debtChange = await getNetBorrowingAmount(toBN(dec(200, 18)))
            const newTCR = (await borrowerOperations.getNewTCRFromTroveChange(collChange, false, debtChange, true, price))

            const expectedTCR = (troveColl.add(liquidatedColl).sub(toBN(collChange))).mul(price)
                .div(troveTotalDebt.add(liquidatedDebt).add(toBN(debtChange)))

            assert.isTrue(newTCR.eq(expectedTCR))
        })
    })

    /*if (!withProxy) {
        it('closeTrove(): fails if owner cannot receive ETH', async () => {
            const nonPayable = await NonPayable.new()

            // we need 2 troves to be able to close 1 and have 1 remaining in the system
            await borrowerOperations.openTrove(th._100pct, dec(100000, 18), alice.address, alice.address, { from: alice, value: dec(1000, 18) })

            // Alice sends LUSD to NonPayable so its LUSD balance covers its debt
            await simToken.transfer(nonPayable.address, dec(10000, 18), {from: alice})

            // open trove from NonPayable proxy contract
            const _100pctHex = '0xde0b6b3a7640000'
            const _1e25Hex = '0xd3c21bcecceda1000000'
            const openTroveData = th.getTransactionData('openTrove(uint256,uint256,address,address)', [_100pctHex, _1e25Hex, '0x0', '0x0'])
            await nonPayable.forward(borrowerOperations.address, openTroveData, { value: dec(10000, 'ether') })
            assert.equal((await troveManager.getTroveStatus(nonPayable.address)).toString(), '1', 'NonPayable proxy should have a trove')
            assert.isFalse(await th.checkRecoveryMode(contracts), 'System should not be in Recovery Mode')
            // open trove from NonPayable proxy contract
            const closeTroveData = th.getTransactionData('closeTrove()', [])
            await th.assertRevert(nonPayable.forward(borrowerOperations.address, closeTroveData), 'ActivePool: sending ETH failed')
        })
    }*/
})