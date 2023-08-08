import {TestHelper} from "../utils/TestHelper";
import {BorrowerOperationsTester, CommunityIssuanceTester, SHADYToken, StabilityPool} from "../typechain-types";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IContracts} from "../utils/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {assert} from "hardhat";

const th = TestHelper
const timeValues = th.TimeValues
const toBN = th.toBN
const dec = th.dec
const assertRevert = th.assertRevert

describe('Issuance arithmetic tests', async () => {
  let contracts: IContracts
  let communityIssuanceTester: CommunityIssuanceTester
  let shadyToken: SHADYToken
  let stabilityPool: StabilityPool

  let
      owner:SignerWithAddress,
      alice:SignerWithAddress

  beforeEach(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    [owner, alice] = f.signers
    contracts = f.contracts;
    communityIssuanceTester = f.shadyContracts.communityIssuance as CommunityIssuanceTester
    shadyToken = f.shadyContracts.shadyToken
    stabilityPool = f.contracts.stabilityPool
  })

  // Accuracy tests
  it("getCumulativeIssuanceFraction(): fraction doesn't increase if less than a minute has passed", async () => {
   // progress time 1 week 
    await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK)

    await communityIssuanceTester.unprotectedIssueSHADY()
   
    const issuanceFractionBefore = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.isTrue(issuanceFractionBefore.gt(th.toBN('0')))
    console.log(`issuance fraction before: ${issuanceFractionBefore}`)
    const blockTimestampBefore = th.toBN(await th.getLatestBlockTimestamp())

    // progress time 6 seconds
    await th.fastForwardTime(6)

    const issuanceFractionAfter = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const blockTimestampAfter = th.toBN(await th.getLatestBlockTimestamp())

    const timestampDiff = blockTimestampAfter.sub(blockTimestampBefore)
    // check blockTimestamp diff < 60s
    assert.isTrue(timestampDiff.lt(th.toBN(60)))

    console.log(`issuance fraction after: ${issuanceFractionBefore}`)
    assert.isTrue(issuanceFractionBefore.eq(issuanceFractionAfter))
  })

  /*--- Issuance tests for "Yearly halving" schedule.

  Total issuance year 1: 50%, year 2: 75%, year 3:   0.875, etc   
  
  Error tolerance: 1e-9
  
  ---*/

  // using the result of this to advance time by the desired amount from the deployment time, whether or not some extra time has passed in the meanwhile
  const getDuration = async (expectedDuration: number) => {
    const deploymentTime = (await communityIssuanceTester.deploymentTime()).toNumber()
    const currentTime = await th.getLatestBlockTimestamp()
    const duration = Math.max(expectedDuration - (currentTime - deploymentTime), 0)

    return duration
  }

  it("Cumulative issuance fraction is 0.0000013 after a minute", async () => {
    // console.log(`supply cap: ${await communityIssuanceTester.LQTYSupplyCap()}`)

    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MINUTE)

    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '1318772305025'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 100000000)
  })

  it("Cumulative issuance fraction is 0.000079 after an hour", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_HOUR)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '79123260066094'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.0019 after a day", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_DAY)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '1897231348441660'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.013 after a week", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_WEEK)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '13205268780628400'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.055 after a month", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '55378538087966600'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.16 after 3 months", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 3)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '157105100752037000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.29 after 6 months", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 6)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = 289528188821766000

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.5 after a year", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = dec(5, 17)

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration}, 
    //    issuanceFraction: ${issuanceFraction},  
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.75 after 2 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 2)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = dec(75, 16)

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration},
    //    issuanceFraction: ${issuanceFraction},
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.875 after 3 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 3)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = dec(875, 15)

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration},
    //    issuanceFraction: ${issuanceFraction},
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.9375 after 4 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 4)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '937500000000000000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration},
    //    issuanceFraction: ${issuanceFraction},
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.999 after 10 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 10)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '999023437500000000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration},
    //    issuanceFraction: ${issuanceFraction},
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.999999 after 20 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 20)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '999999046325684000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration},
    //    issuanceFraction: ${issuanceFraction},
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  it("Cumulative issuance fraction is 0.999999999 after 30 years", async () => {
    const initialIssuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    assert.equal(initialIssuanceFraction.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 30)
    // Fast forward time
    await th.fastForwardTime(duration)

    const issuanceFraction = await communityIssuanceTester.getCumulativeIssuanceFraction()
    const expectedIssuanceFraction = '999999999068677000'

    const absError = th.toBN(expectedIssuanceFraction).sub(issuanceFraction)
    // console.log(
    //   `time since deployment: ${duration},
    //    issuanceFraction: ${issuanceFraction},
    //    expectedIssuanceFraction: ${expectedIssuanceFraction},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(issuanceFraction, toBN(expectedIssuanceFraction)), 1000000000)
  })

  // --- Token issuance for yearly halving ---

   // Error tolerance: 1e-3, i.e. 1/1000th of a token

  it("Total LQTY tokens issued is 39.56 after a minute", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MINUTE)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '39563169150000000000'//'42200713760820460000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
    await assertRevert(communityIssuanceTester.connect(await th.impersonate(stabilityPool.address)).sendSHADY(alice.address, totalLQTYIssued.add(1)), "Issuance: not enough issued SHADY")
    await communityIssuanceTester.connect(await th.impersonate(stabilityPool.address)).sendSHADY(alice.address, totalLQTYIssued)
  })

  it("Total LQTY tokens issued is 2,373.69 after an hour", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)


    const duration = await getDuration(timeValues.SECONDS_IN_ONE_HOUR)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '2373697801938210000000'//'2531944322115010000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 56,916.94 after a day", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)


    const duration = await getDuration(timeValues.SECONDS_IN_ONE_DAY)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '56916940452158250000000'//'60711403150133240000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 396,158.06 after a week", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)


    const duration = await getDuration(timeValues.SECONDS_IN_ONE_WEEK)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '396158063411293080000000'//'422568600980110200000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 1,661,356.14 after a month", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)


    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '1661356142607978180000000'//'1772113218814930000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 4,713,153.02 after 3 months", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 3)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '4713153022478071950000000'//'5027363224065180000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 8,685,845.66 after 6 months", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_MONTH * 6)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '8685845664513004410000000'//'9264902042296516000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 16,000,000 after a year", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '15000000000000000000000000'//'16000000000000000000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 22,500,000 after 2 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 2)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '22500000000000000000000000'//'24000000000000000000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 28,000,000 after 3 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 3)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '26249999999999624250000000'//'28000000000000000000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 28,124,999 after 4 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 4)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '28124999999999749500000000'//'30000000000000000000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 29,970,703 after 10 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 10)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '29970703124999990220000000'//'31968750000000000000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 29,999,971.38 after 20 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 20)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '29999971389770507790000000'//'31999969482421880000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    /*console.log(
      `time since deployment: ${duration}, 
       totalLQTYIssued: ${totalLQTYIssued},  
       expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
       abs. error: ${absError}`
    )*/

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })

  it("Total LQTY tokens issued is 29,999,999.97 after 30 years", async () => {
    const initialIssuance = await communityIssuanceTester.totalSHADYIssued()
    assert.equal(initialIssuance.toNumber(), 0)

    const duration = await getDuration(timeValues.SECONDS_IN_ONE_YEAR * 30)
    // Fast forward time
    await th.fastForwardTime(duration)

    // Issue LQTY
    await communityIssuanceTester.unprotectedIssueSHADY()
    const totalLQTYIssued = await communityIssuanceTester.totalSHADYIssued()
    const expectedTotalLQTYIssued = '29999999972060322750000000' //'31999999970197680000000000'

    const absError = th.toBN(expectedTotalLQTYIssued).sub(totalLQTYIssued)
    // console.log(
    //   `time since deployment: ${duration},
    //    totalLQTYIssued: ${totalLQTYIssued},
    //    expectedTotalLQTYIssued: ${expectedTotalLQTYIssued},
    //    abs. error: ${absError}`
    // )

    assert.isAtMost(th.getDifference(totalLQTYIssued, expectedTotalLQTYIssued), 1000000000000000)
  })
})
