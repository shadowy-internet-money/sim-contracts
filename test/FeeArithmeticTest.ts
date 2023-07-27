import {TestHelper} from "../utils/TestHelper";
import {IContracts} from "../utils/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {assert} from "hardhat";
import {TroveManagerTester} from "../typechain-types";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const getDifference = th.getDifference

describe('Fee arithmetic tests', async () => {
  let contracts: IContracts
  let troveManagerTester: TroveManagerTester
  
  // see: https://docs.google.com/spreadsheets/d/1RbD8VGzq7xFgeK1GOkz_9bbKVIx-xkOz0VsVelnUFdc/edit#gid=0
  // Results array, maps seconds to expected hours passed output (rounded down to nearest hour).

  const secondsToMinutesRoundedDown = [
    [0, 0],
    [1, 0],
    [3, 0],
    [37, 0],
    [432, 7],
    [1179, 19],
    [2343, 39],
    [3599, 59],
    [3600, 60],
    [10000, 166],
    [15000, 250],
    [17900, 298],
    [18000, 300],
    [61328, 1022],
    [65932, 1098],
    [79420, 1323],
    [86147, 1435],
    [86400, 1440],
    [35405, 590],
    [100000, 1666],
    [604342, 10072],
    [604800, 10080],
    [1092099, 18201],
    [2591349, 43189],
    [2592000, 43200],
    [5940183, 99003],
    [8102940, 135049],
    [31535342, 525589],
    [31536000, 525600],
    [56809809, 946830],
    [315360000, 5256000],
    [793450405, 13224173],
    [1098098098, 18301634],
    [3153600000, 52560000],
    [4098977899, 68316298],
    [9999999999, 166666666],
    [31535999000, 525599983],
    [31536000000, 525600000],
    [50309080980, 838484683],
  ]

  /* Object holds arrays for seconds passed, and the corresponding expected decayed base rate, given an initial
  base rate */

  const decayBaseRateResults = {
    'seconds': [
      0,
      1,
      3,
      37,
      432,
      1179,
      2343,
      3547,
      3600,	 // 1 hour
      10000,
      15000,
      17900,
      18000,	  // 5 hours
      61328,
      65932,
      79420,
      86147,
      86400,	  // 1 day
      35405,
      100000,
      604342,
      604800,	  // 1 week
      1092099,
      2591349,
      2592000,	  // 1 month
      5940183,
      8102940,
      31535342,
      31536000, // 1 year
      56809809,
      315360000,	  // 10 years
      793450405,
      1098098098,
      3153600000,	  // 100 years
      4098977899,
      9999999999,
      31535999000,
      31536000000,	 // 1000 years
      50309080980,
    ],
    '0.01': [
      10000000000000000,
      10000000000000000,
      10000000000000000,
      10000000000000000,
      9932837247526310,
      9818748881063180,
      9631506200700280,
      9447834221836550,
      9438743126816710,
      8523066208268240,
      7860961982890640,
      7505973548021970,
      7491535384382500,
      3738562496681640,
      3474795549604300,
      2798062319068760,
      2512062814236710,
      2499999999998550,
      5666601111155830,
      2011175814816220,
      615070415779,
      610351562497,
      245591068,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ],
    '0.1': [
      100000000000000000,
      100000000000000000,
      100000000000000000,
      100000000000000000,
      99328372475263100,
      98187488810631800,
      96315062007002900,
      94478342218365500,
      94387431268167100,
      85230662082682400,
      78609619828906400,
      75059735480219700,
      74915353843825000,
      37385624966816400,
      34747955496043000,
      27980623190687600,
      25120628142367100,
      24999999999985500,
      56666011111558300,
      20111758148162200,
      6150704157794,
      6103515624975,
      2455910681,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ],
    '0.34539284': [
      345392840000000000,
      345392840000000000,
      345392840000000000,
      345392840000000000,
      343073086618089000,
      339132556127723000,
      332665328013748000,
      326321429372932000,
      326007429460170000,
      294380604318180000,
      271511998440263000,
      259250952071618000,
      258752268237236000,
      129127271824636000,
      120016950329719000,
      96643069088014400,
      86764850966761100,
      86348209999949800,
      195720345092927000,
      69464572641868900,
      21244091770604,
      21081105956945,
      8482539649,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ],
    '0.9976': [
      997600000000000000,
      997600000000000000,
      997600000000000000,
      997600000000000000,
      990899843813224000,
      979518388374863000,
      960839058581860000,
      942515941970414000,
      941609014331235000,
      850261084936840000,
      784209567413171000,
      748795921150671000,
      747355569945998000,
      372958994668961000,
      346645604028525000,
      279134696950299000,
      250603386348255000,
      249399999999855000,
      565300126848906000,
      200634899286066000,
      61359424678158,
      60888671874752,
      24500164955,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]
  }

  beforeEach(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    contracts = f.contracts;
    troveManagerTester = contracts.troveManager as TroveManagerTester
  })

  it("minutesPassedSinceLastFeeOp(): returns minutes passed for no time increase", async () => {
    await troveManagerTester.setLastFeeOpTimeToNow()
    const minutesPassed = await troveManagerTester.minutesPassedSinceLastFeeOp()

    assert.equal(minutesPassed.toString(), '0')
  })

  it("minutesPassedSinceLastFeeOp(): returns minutes passed between time of last fee operation and current block.timestamp, rounded down to nearest minutes", async () => {
    for (const testPair of secondsToMinutesRoundedDown) {
      await troveManagerTester.setLastFeeOpTimeToNow()

      const seconds = testPair[0]
      const expectedHoursPassed = testPair[1]

      await th.fastForwardTime(seconds)

      const minutesPassed = await troveManagerTester.minutesPassedSinceLastFeeOp()

      assert.equal(expectedHoursPassed.toString(), minutesPassed.toString())
    }
  })

  it("decayBaseRateFromBorrowing(): returns the initial base rate for no time increase", async () => {
    await troveManagerTester.setBaseRate(dec(5, 17))
    await troveManagerTester.setLastFeeOpTimeToNow()

    const baseRateBefore = await troveManagerTester.baseRate()
    assert.equal(baseRateBefore.toString(), dec(5, 17))

    await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
    const baseRateAfter = await troveManagerTester.baseRate()

    assert.isTrue(baseRateBefore.eq(baseRateAfter))
  })

  it("decayBaseRateFromBorrowing(): returns the initial base rate for less than one minute passed ", async () => {
    await troveManagerTester.setBaseRate(dec(5, 17))
    await troveManagerTester.setLastFeeOpTimeToNow()

    // 1 second
    const baseRateBefore_1 = await troveManagerTester.baseRate()
    assert.equal(baseRateBefore_1.toString(), dec(5, 17))

    await th.fastForwardTime(1)

    await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
    const baseRateAfter_1 = await troveManagerTester.baseRate()

    assert.isTrue(baseRateBefore_1.eq(baseRateAfter_1))

    // 17 seconds
    await troveManagerTester.setLastFeeOpTimeToNow()

    const baseRateBefore_2 = await troveManagerTester.baseRate()
    await th.fastForwardTime(17)

    await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
    const baseRateAfter_2 = await troveManagerTester.baseRate()

    assert.isTrue(baseRateBefore_2.eq(baseRateAfter_2))

    // 29 seconds
    await troveManagerTester.setLastFeeOpTimeToNow()

    const baseRateBefore_3 = await troveManagerTester.baseRate()
    await th.fastForwardTime(29)

    await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
    const baseRateAfter_3 = await troveManagerTester.baseRate()

    assert.isTrue(baseRateBefore_3.eq(baseRateAfter_3))

    // 50 seconds
    await troveManagerTester.setLastFeeOpTimeToNow()

    const baseRateBefore_4 = await troveManagerTester.baseRate()
    await th.fastForwardTime(50)

    await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
    const baseRateAfter_4 = await troveManagerTester.baseRate()

    assert.isTrue(baseRateBefore_4.eq(baseRateAfter_4))

    // (cant quite test up to 59 seconds, as execution of the final tx takes >1 second before the block is mined)
  })

  it("decayBaseRateFromBorrowing(): returns correctly decayed base rate, for various durations. Initial baseRate = 0.01", async () => {
    // baseRate = 0.01
    for (let i = 0; i < decayBaseRateResults.seconds.length; i++) {
      // Set base rate to 0.01 in TroveManager
      await troveManagerTester.setBaseRate(dec(1, 16))
      const contractBaseRate = await troveManagerTester.baseRate()
      assert.equal(contractBaseRate.toString(), dec(1, 16))

      const startBaseRate = '0.01'

      const secondsPassed = decayBaseRateResults.seconds[i]
      const expectedDecayedBaseRate = decayBaseRateResults[startBaseRate][i]
      await troveManagerTester.setLastFeeOpTimeToNow()

      // Progress time 
      await th.fastForwardTime(secondsPassed)

      await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
      const decayedBaseRate = await troveManagerTester.baseRate()

      const minutesPassed = secondsPassed / 60

      const error = decayedBaseRate.sub(toBN(expectedDecayedBaseRate))
      // console.log(
      //   `starting baseRate: ${startBaseRate}, 
      //   minutesPassed: ${minutesPassed}, 
      //   expectedDecayedBaseRate: ${expectedDecayedBaseRate}, 
      //   decayedBaseRate: ${decayedBaseRate}, 
      //   error: ${error}`
      // )
      assert.isAtMost(getDifference(toBN(expectedDecayedBaseRate), decayedBaseRate), 100000) // allow absolute error tolerance of 1e-13
    }
  })

  it("decayBaseRateFromBorrowing(): returns correctly decayed base rate, for various durations. Initial baseRate = 0.1", async () => {
    // baseRate = 0.1
    for (let i = 0; i < decayBaseRateResults.seconds.length; i++) {
      // Set base rate to 0.1 in TroveManager
      await troveManagerTester.setBaseRate(dec(1, 17))
      const contractBaseRate = await troveManagerTester.baseRate()
      assert.equal(contractBaseRate.toString(), dec(1, 17))

      const startBaseRate = '0.1'

      const secondsPassed = decayBaseRateResults.seconds[i]
      const expectedDecayedBaseRate = decayBaseRateResults['0.1'][i]
      await troveManagerTester.setLastFeeOpTimeToNow()

      // Progress time 
      await th.fastForwardTime(secondsPassed)

      await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
      const decayedBaseRate = await troveManagerTester.baseRate()

      const minutesPassed = secondsPassed / 60

      const error = decayedBaseRate.sub(toBN(expectedDecayedBaseRate))
      // console.log(
      //   `starting baseRate: ${startBaseRate}, 
      //   minutesPassed: ${minutesPassed}, 
      //   expectedDecayedBaseRate: ${expectedDecayedBaseRate}, 
      //   decayedBaseRate: ${decayedBaseRate}, 
      //   error: ${error}`
      // )
      assert.isAtMost(getDifference(toBN(expectedDecayedBaseRate), decayedBaseRate), 1000000) // allow absolute error tolerance of 1e-12
    }
  })

  it("decayBaseRateFromBorrowing(): returns correctly decayed base rate, for various durations. Initial baseRate = 0.34539284", async () => {
    // baseRate = 0.34539284
    for (let i = 0; i < decayBaseRateResults.seconds.length; i++) {
      // Set base rate to 0.1 in TroveManager
      await troveManagerTester.setBaseRate('345392840000000000')
      const contractBaseRate = await troveManagerTester.baseRate()
      await troveManagerTester.setBaseRate('345392840000000000')

      const startBaseRate = '0.34539284'

      const secondsPassed = decayBaseRateResults.seconds[i]
      const expectedDecayedBaseRate = decayBaseRateResults[startBaseRate][i]
      await troveManagerTester.setLastFeeOpTimeToNow()

      // Progress time 
      await th.fastForwardTime(secondsPassed)

      await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
      const decayedBaseRate = await troveManagerTester.baseRate()

      const minutesPassed = secondsPassed / 60

      const error = decayedBaseRate.sub(toBN(expectedDecayedBaseRate))
      // console.log(
      //   `starting baseRate: ${startBaseRate}, 
      //   minutesPassed: ${minutesPassed}, 
      //   expectedDecayedBaseRate: ${expectedDecayedBaseRate}, 
      //   decayedBaseRate: ${decayedBaseRate}, 
      //   error: ${error}`
      // )

      assert.isAtMost(getDifference(toBN(expectedDecayedBaseRate), decayedBaseRate), 1000000) // allow absolute error tolerance of 1e-12
    }
  })

  it("decayBaseRateFromBorrowing(): returns correctly decayed base rate, for various durations. Initial baseRate = 0.9976", async () => {
    // baseRate = 0.9976
    for (let i = 0; i < decayBaseRateResults.seconds.length; i++) {
      // Set base rate to 0.9976 in TroveManager
      await troveManagerTester.setBaseRate('997600000000000000')
      await troveManagerTester.setBaseRate('997600000000000000')

      const startBaseRate = '0.9976'

      const secondsPassed = decayBaseRateResults.seconds[i]
      const expectedDecayedBaseRate = decayBaseRateResults[startBaseRate][i]
      await troveManagerTester.setLastFeeOpTimeToNow()

      // progress time 
      await th.fastForwardTime(secondsPassed)

      await troveManagerTester.unprotectedDecayBaseRateFromBorrowing()
      const decayedBaseRate = await troveManagerTester.baseRate()

      const minutesPassed = secondsPassed / 60

      const error = decayedBaseRate.sub(toBN(expectedDecayedBaseRate))

      // console.log(
      //   `starting baseRate: ${startBaseRate}, 
      //   minutesPassed: ${minutesPassed}, 
      //   expectedDecayedBaseRate: ${expectedDecayedBaseRate}, 
      //   decayedBaseRate: ${decayedBaseRate}, 
      //   error: ${error}`
      // )

      assert.isAtMost(getDifference(toBN(expectedDecayedBaseRate), decayedBaseRate), 10000000) // allow absolute error tolerance of 1e-11
    }
  })
})
