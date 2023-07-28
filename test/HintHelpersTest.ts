import {TestHelper} from "../utils/TestHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {HintHelpers, PriceFeedMock, SortedTroves, TroveManager} from "../typechain-types";
import {IContracts} from "../utils/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {assert} from "hardhat";

const th = TestHelper
const {dec, toBN} = th

describe('HintHelpers', async () => {
    let owner: SignerWithAddress
    let signers: SignerWithAddress[]

    let sortedTroves: SortedTroves
    let troveManager: TroveManager
    let hintHelpers: HintHelpers
    let priceFeed: PriceFeedMock

    let contracts: IContracts

    let numAccounts = 0;
    let latestRandomSeed = toBN(31337)


    // Sequentially add coll and withdraw LUSD, 1 account at a time
    const makeTrovesInSequence = async (signers: SignerWithAddress[], n: number) => {
        const activeAccounts = signers.slice(0, n)
        // console.log(`number of accounts used is: ${activeAccounts.length}`)

        let ICR = 200

        // console.time('makeTrovesInSequence')
        for (const account of activeAccounts) {
            const ICR_BN = toBN(ICR.toString().concat('0'.repeat(16)))
            await th.openTrove(contracts, {
                extraLUSDAmount: toBN(dec(10000, 18)),
                ICR: ICR_BN,
                extraParams: {from: account}
            })

            ICR += 1
        }
        // console.timeEnd('makeTrovesInSequence')
    }

    beforeEach(async () => {
        const f = await loadFixture(DeploymentHelper.deployFixture);
        owner = f.signers[0]
        signers = f.signers
        contracts = f.contracts

        troveManager = contracts.troveManager
        sortedTroves = contracts.sortedTroves
        hintHelpers = contracts.hintHelpers
        priceFeed = contracts.priceFeedMock

        numAccounts = 10

        await priceFeed.setPrice(dec(100, 18))
        const r = await hintHelpers.getApproxHint(0, 10, latestRandomSeed)
        assert.isTrue(r.hintAddress == th.ZERO_ADDRESS)
        assert.isTrue(r.diff.eq(0))
        await makeTrovesInSequence(f.signers, numAccounts)
    })

    it("setup: makes accounts with nominal ICRs increasing by 1% consecutively", async () => {
        // check first 10 accounts
        const ICR_0 = await troveManager.getNominalICR(signers[0].address)
        const ICR_1 = await troveManager.getNominalICR(signers[1].address)
        const ICR_2 = await troveManager.getNominalICR(signers[2].address)
        const ICR_3 = await troveManager.getNominalICR(signers[3].address)
        const ICR_4 = await troveManager.getNominalICR(signers[4].address)
        const ICR_5 = await troveManager.getNominalICR(signers[5].address)
        const ICR_6 = await troveManager.getNominalICR(signers[6].address)
        const ICR_7 = await troveManager.getNominalICR(signers[7].address)
        const ICR_8 = await troveManager.getNominalICR(signers[8].address)
        const ICR_9 = await troveManager.getNominalICR(signers[9].address)

        assert.isTrue(ICR_0.eq(toBN(dec(200, 16))))
        assert.isTrue(ICR_1.eq(toBN(dec(201, 16))))
        assert.isTrue(ICR_2.eq(toBN(dec(202, 16))))
        assert.isTrue(ICR_3.eq(toBN(dec(203, 16))))
        assert.isTrue(ICR_4.eq(toBN(dec(204, 16))))
        assert.isTrue(ICR_5.eq(toBN(dec(205, 16))))
        assert.isTrue(ICR_6.eq(toBN(dec(206, 16))))
        assert.isTrue(ICR_7.eq(toBN(dec(207, 16))))
        assert.isTrue(ICR_8.eq(toBN(dec(208, 16))))
        assert.isTrue(ICR_9.eq(toBN(dec(209, 16))))
    })

    it("getApproxHint(): returns the address of a Trove within sqrt(length) positions of the correct insert position", async () => {
        const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

        /* As per the setup, the ICRs of Troves are monotonic and seperated by 1% intervals. Therefore, the difference in ICR between
        the given CR and the ICR of the hint address equals the number of positions between the hint address and the correct insert position
        for a Trove with the given CR. */

        // CR = 250%
        const CR_250 = '2500000000000000000'
        const CRPercent_250 = Number(toBN(CR_250)) * 100

        let hintAddress

            // const hintAddress_250 = await functionCaller.troveManager_getApproxHint(CR_250, sqrtLength * 10)
        ;({hintAddress, latestRandomSeed} = await hintHelpers.getApproxHint(CR_250, sqrtLength * 10, latestRandomSeed))
        const ICR_hintAddress_250 = await troveManager.getNominalICR(hintAddress)
        const ICRPercent_hintAddress_250 = Number(toBN(ICR_hintAddress_250)) * 100

        // check the hint position is at most sqrtLength positions away from the correct position
        const ICR_Difference_250 = (ICRPercent_hintAddress_250 - CRPercent_250)
        assert.isBelow(ICR_Difference_250, sqrtLength)

        // CR = 287%
        const CR_287 = '2870000000000000000'
        const CRPercent_287 = Number(toBN(CR_287)) * 100

            // const hintAddress_287 = await functionCaller.troveManager_getApproxHint(CR_287, sqrtLength * 10)
        ;({hintAddress, latestRandomSeed} = await hintHelpers.getApproxHint(CR_287, sqrtLength * 10, latestRandomSeed))
        const ICR_hintAddress_287 = await troveManager.getNominalICR(hintAddress)
        const ICRPercent_hintAddress_287 = Number(toBN(ICR_hintAddress_287)) * 100

        // check the hint position is at most sqrtLength positions away from the correct position
        const ICR_Difference_287 = (ICRPercent_hintAddress_287 - CRPercent_287)
        assert.isBelow(ICR_Difference_287, sqrtLength)

        // CR = 213%
        const CR_213 = '2130000000000000000'
        const CRPercent_213 = Number(toBN(CR_213)) * 100

            // const hintAddress_213 = await functionCaller.troveManager_getApproxHint(CR_213, sqrtLength * 10)
        ;({hintAddress, latestRandomSeed} = await hintHelpers.getApproxHint(CR_213, sqrtLength * 10, latestRandomSeed))
        const ICR_hintAddress_213 = await troveManager.getNominalICR(hintAddress)
        const ICRPercent_hintAddress_213 = Number(toBN(ICR_hintAddress_213)) * 100

        // check the hint position is at most sqrtLength positions away from the correct position
        const ICR_Difference_213 = (ICRPercent_hintAddress_213 - CRPercent_213)
        assert.isBelow(ICR_Difference_213, sqrtLength)

        // CR = 201%
        const CR_201 = '2010000000000000000'
        const CRPercent_201 = Number(toBN(CR_201)) * 100

            //  const hintAddress_201 = await functionCaller.troveManager_getApproxHint(CR_201, sqrtLength * 10)
        ;({hintAddress, latestRandomSeed} = await hintHelpers.getApproxHint(CR_201, sqrtLength * 10, latestRandomSeed))
        const ICR_hintAddress_201 = await troveManager.getNominalICR(hintAddress)
        const ICRPercent_hintAddress_201 = Number(toBN(ICR_hintAddress_201)) * 100

        // check the hint position is at most sqrtLength positions away from the correct position
        const ICR_Difference_201 = (ICRPercent_hintAddress_201 - CRPercent_201)
        assert.isBelow(ICR_Difference_201, sqrtLength)
    })

    /* Pass 100 random collateral ratios to getApproxHint(). For each, check whether the returned hint address is within
    sqrt(length) positions of where a Trove with that CR should be inserted. */
    // it("getApproxHint(): for 100 random CRs, returns the address of a Trove within sqrt(length) positions of the correct insert position", async () => {
    //   const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

    //   for (i = 0; i < 100; i++) {
    //     // get random ICR between 200% and (200 + numAccounts)%
    //     const min = 200
    //     const max = 200 + numAccounts
    //     const ICR_Percent = (Math.floor(Math.random() * (max - min) + min))

    //     // Convert ICR to a duint
    //     const ICR = web3.utils.toWei((ICR_Percent * 10).toString(), 'finney')

    //     const hintAddress = await hintHelpers.getApproxHint(ICR, sqrtLength * 10)
    //     const ICR_hintAddress = await troveManager.getNominalICR(hintAddress)
    //     const ICRPercent_hintAddress = Number(web3.utils.fromWei(ICR_hintAddress, 'ether')) * 100

    //     // check the hint position is at most sqrtLength positions away from the correct position
    //     ICR_Difference = (ICRPercent_hintAddress - ICR_Percent)
    //     assert.isBelow(ICR_Difference, sqrtLength)
    //   }
    // })

    it("getApproxHint(): returns the head of the list if the CR is the max uint256 value", async () => {
        const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

        // CR = Maximum value, i.e. 2**256 -1
        const CR_Max = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

        let hintAddress

            // const hintAddress_Max = await functionCaller.troveManager_getApproxHint(CR_Max, sqrtLength * 10)
        ;({hintAddress, latestRandomSeed} = await hintHelpers.getApproxHint(CR_Max, sqrtLength * 10, latestRandomSeed))

        const ICR_hintAddress_Max = await troveManager.getNominalICR(hintAddress)
        const ICRPercent_hintAddress_Max = Number(toBN(ICR_hintAddress_Max)) * 100

        const firstTrove = await sortedTroves.getFirst()
        const ICR_FirstTrove = await troveManager.getNominalICR(firstTrove)
        const ICRPercent_FirstTrove = Number(toBN(ICR_FirstTrove)) * 100

        // check the hint position is at most sqrtLength positions away from the correct position
        const ICR_Difference_Max = (ICRPercent_hintAddress_Max - ICRPercent_FirstTrove)
        assert.isBelow(ICR_Difference_Max, sqrtLength)
    })

    it("getApproxHint(): returns the tail of the list if the CR is lower than ICR of any Trove", async () => {
        const sqrtLength = Math.ceil(Math.sqrt(numAccounts))

        // CR = MCR
        const CR_Min = '1100000000000000000'

        let hintAddress

            //  const hintAddress_Min = await functionCaller.troveManager_getApproxHint(CR_Min, sqrtLength * 10)
        ;({hintAddress, latestRandomSeed} = await hintHelpers.getApproxHint(CR_Min, sqrtLength * 10, latestRandomSeed))
        const ICR_hintAddress_Min = await troveManager.getNominalICR(hintAddress)
        const ICRPercent_hintAddress_Min = Number(toBN(ICR_hintAddress_Min)) * 100

        const lastTrove = await sortedTroves.getLast()
        const ICR_LastTrove = await troveManager.getNominalICR(lastTrove)
        const ICRPercent_LastTrove = Number(toBN(ICR_LastTrove)) * 100

        // check the hint position is at most sqrtLength positions away from the correct position
        const ICR_Difference_Min = (ICRPercent_hintAddress_Min - ICRPercent_LastTrove)
        assert.isBelow(ICR_Difference_Min, sqrtLength)
    })

    it('computeNominalCR()', async () => {
        const NICR = await hintHelpers.computeNominalCR(dec(3, 18), dec(200, 18))
        assert.equal(NICR.toString(), dec(150, 16))
    })

    it('computeCR()', async () => {
        const NICR = await hintHelpers.computeCR(dec(3, 18), dec(200, 18), dec(100, 18))
        assert.equal(NICR.toString(), dec(150, 16))
    })
})

// Gas usage:  See gas costs spreadsheet. Cost per trial = 10k-ish.
