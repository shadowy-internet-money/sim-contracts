import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  Api3ProxyMock,
  CrossChainRateReceiverMock,
  PriceFeedMock,
  PriceFeedTester,
  PythMock
} from "../typechain-types";
import {assert, ethers} from "hardhat";
import {TestHelper} from "../utils/TestHelper";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert

describe('PriceFeed', async () => {
  let owner: SignerWithAddress
  let alice: SignerWithAddress

  let priceFeed: PriceFeedTester
  let priceFeedMock: PriceFeedMock
  let zeroAddressPriceFeed: PriceFeedTester
  let api3ProxyMock: Api3ProxyMock
  let pythMock: PythMock
  const pythFeedId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
  let rateReceiver: CrossChainRateReceiverMock

  const setAddresses = async () => {
    await priceFeed.setAddresses(api3ProxyMock.address, pythMock.address, rateReceiver.address,  pythFeedId)
  }

  async function deployPriceFeedFixture() {
    const signers = await ethers.getSigners()
    const owner = signers[0];
    const alice = signers[1]
    const priceFeed = await (await ethers.getContractFactory("PriceFeedTester")).deploy() as PriceFeedTester
    const priceFeedMock = await (await ethers.getContractFactory("PriceFeedMock")).deploy() as PriceFeedMock
    const zeroAddressPriceFeed = await (await ethers.getContractFactory("PriceFeedTester")).deploy() as PriceFeedTester
    const api3ProxyMock = await (await ethers.getContractFactory("Api3ProxyMock")).deploy() as Api3ProxyMock
    const pythMock = await (await ethers.getContractFactory("PythMock")).deploy() as PythMock
    const rateReceiver = await (await ethers.getContractFactory("CrossChainRateReceiverMock")).deploy() as CrossChainRateReceiverMock
    return {owner, alice, priceFeed, priceFeedMock, zeroAddressPriceFeed, api3ProxyMock, pythMock, rateReceiver}
  }

  beforeEach(async () => {
    const f = await loadFixture(deployPriceFeedFixture)
    owner = f.owner
    alice = f.alice
    priceFeed = f.priceFeed
    priceFeedMock = f.priceFeedMock
    zeroAddressPriceFeed = f.zeroAddressPriceFeed
    api3ProxyMock = f.api3ProxyMock
    pythMock = f.pythMock
    rateReceiver = f.rateReceiver

    //Set current and prev prices in both oracles
    await api3ProxyMock.setPrice(dec(100, 18))
    await pythMock.setPrice(dec(100, 8))
    await pythMock.setExpo(-8)
    await pythMock.setFeedId(pythFeedId)
    await rateReceiver.setRate(dec(1, 18))

    // Set mock price updateTimes in both oracles to very recent
    const now = await th.getLatestBlockTimestamp()
    await api3ProxyMock.setUpdateTime(now)
    await pythMock.setUpdateTime(now)
  })

  describe('PriceFeed internal testing contract', async () => {
    it("fetchPrice before setPrice should return the default price", async () => {
      const price = await priceFeedMock.getPrice()
      assert.equal(price.toString(), dec(200, 18))
    })
    it("should be able to fetchPrice after setPrice, output of former matching input of latter", async () => {
      await priceFeedMock.setPrice(dec(100, 18))
      const price = await priceFeedMock.getPrice()
      assert.equal(price.toString(), dec(100, 18))
    })
  })

  describe('Mainnet PriceFeed setup', async () => {
    it("fetchPrice should fail on contract with no addresses set", async () => {
      try {
        await zeroAddressPriceFeed.fetchPrice()
      } catch (err) {
        // console.log(err?.toString())
        assert.include(err?.toString(), "function returned an unexpected amount of data")
      }
    })

    it("setAddresses should fail whe called by nonOwner", async () => {
      await assertRevert(
        priceFeed.connect(alice).setAddresses(api3ProxyMock.address, pythMock.address, rateReceiver.address, pythFeedId),
        "Ownable: caller is not the owner"
      )
    })

    it("setAddresses should fail after address has already been set", async () => {
      // Owner can successfully set any address
      await priceFeed.setAddresses(api3ProxyMock.address, pythMock.address, rateReceiver.address, pythFeedId)

      await assertRevert(
          priceFeed.setAddresses(api3ProxyMock.address, pythMock.address, rateReceiver.address, pythFeedId),
        "Ownable: caller is not the owner"
      )

      await assertRevert(
          priceFeed.connect(alice).setAddresses(api3ProxyMock.address, pythMock.address, rateReceiver.address, pythFeedId),
        "Ownable: caller is not the owner"
      )
    })
  })

  it("C1 API3 working: fetchPrice should return the correct price", async () => {
    await setAddresses()

    // Oracle price price is 10.000000000000000000
    await api3ProxyMock.setPrice(dec(10, 18))
    await priceFeed.fetchPrice()
    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(10, 18))

    await rateReceiver.setRate(dec(11, 17))
    await priceFeed.fetchPrice()
    price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(11, 18))
  })

  // --- API3 breaks ---
  it("C1 API3 breaks, Pyth working: fetchPrice should return the correct Pyth price", async () => {
    await setAddresses()
    // --- API3 fails, system switches to Pyth ---
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    // API3 breaks with zero price
    await api3ProxyMock.setPrice("0")

    await pythMock.setPrice(dec(123, 8))
    await api3ProxyMock.setUpdateTime(0)

    await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '1') // status 1: using Pyth, API3 untrusted

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))

    // Pyth price is 10 at 8-digit precision
    await pythMock.setPrice(dec(10, 8))
    await priceFeed.fetchPrice()
    price = await priceFeed.lastGoodPrice()
    // Check SIM PriceFeed gives 10, with 18 digit precision
    assert.equal(price.toString(), dec(10, 18))

    // Pyth price is 1e9 at 8-digit expo
    await pythMock.setPrice(dec(1, 17))
    await priceFeed.fetchPrice()
    price = await priceFeed.lastGoodPrice()
    // Check SIM PriceFeed gives 1e9, with 18 digit precision
    assert.equal(price.toString(), dec(1, 27))

    // Pyth price is 0.0001 at 8-digit precision
    await pythMock.setPrice(10000)
    await priceFeed.fetchPrice()
    price = await priceFeed.lastGoodPrice()
    // Check SIM PriceFeed gives 0.0001 with 18 digit precision

    assert.equal(price.toString(), dec(1, 14))

    // Pyth price is 1234.56789 at 8-digit precision
    await pythMock.setPrice(dec(1234567890, 0))
    await priceFeed.fetchPrice()
    price = await priceFeed.lastGoodPrice()
    // Check SIM PriceFeed gives 0.01 with 18 digit precision
    assert.equal(price.toString(), '12345678900000000000')
  })

  it("C1 api3Working: API3 broken by zero price, Pyth working: use Pyth price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(0)
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '1') // status 1: using Pyth, API3 untrusted

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C1 api3Working: API3 broken by future timestamp, Pyth working, switch to status 1: using Pyth, API3 untrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))

    const now = await th.getLatestBlockTimestamp()
    const future = toBN(now).add(toBN('1000'))

    await pythMock.setPrice(dec(123, 6))
    await api3ProxyMock.setUpdateTime(future)

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '1') // status 1: using Pyth, API3 untrusted
  })

  it("C1 api3Working: API3 broken by future timestamp, Pyth working, return Pyth price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 18))

    const now = await th.getLatestBlockTimestamp()
    const future = toBN(now).add(toBN('1000'))

    await pythMock.setPrice(dec(123, 8))
    await api3ProxyMock.setUpdateTime(future)

    const priceFetchTx = await priceFeed.fetchPrice()

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C1 api3Working: API3 broken by negative price, Pyth working,  switch to status 1: using Pyth, API3 untrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await priceFeed.setLastGoodPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 6))
    await api3ProxyMock.setPrice("-5000")

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '1') // status 1: using Pyth, API3 untrusted
  })

  it("C1 api3Working: API3 broken by negative price, Pyth working, return Pyth price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await priceFeed.setLastGoodPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))
    await api3ProxyMock.setPrice("-5000")

    const priceFetchTx = await priceFeed.fetchPrice()

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })
  
  it("C1 api3Working: API3 broken - call reverted, Pyth working, switch to status 1: using Pyth, API3 untrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 6))
    await api3ProxyMock.setRevert(true)

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '1') // status 1: using Pyth, API3 untrusted
  })

  it("C1 api3Working: API3 broken - call reverted, Pyth working, return Pyth price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 8))
    await api3ProxyMock.setRevert(true)

    const priceFetchTx = await priceFeed.fetchPrice()

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  // --- API3 timeout --- 

  it("C1 api3Working: API3 frozen, Pyth working: switch to usingPythAPI3Frozen", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))

    await th.fastForwardTime(14400) // fast forward 4 hours
    const now = await th.getLatestBlockTimestamp()

    // Pyth price is recent
    await pythMock.setUpdateTime(now)
    await pythMock.setPrice(dec(123, 6))

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '2') // status 3: using Pyth, API3 frozen
  })

  it("C1 api3Working: API3 frozen, Pyth working: return Pyth price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours
    const now = await th.getLatestBlockTimestamp()
    // Pyth price is recent
    await pythMock.setUpdateTime(now)
    await pythMock.setPrice(dec(123, 8))

    const priceFetchTx = await priceFeed.fetchPrice()

    let price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C1 api3Working: API3 frozen, Pyth frozen: switch to usingPythAPI3Frozen", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '2') // status 3: using Pyth, API3 frozen
  })

  it("C1 api3Working: API3 frozen, Pyth frozen: return last good price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    const priceFetchTx = await priceFeed.fetchPrice()
    let price = await priceFeed.lastGoodPrice()
    // Expect lastGoodPrice has not updated
    assert.equal(price.toString(), dec(999, 18))
  })

  it("C1 api3Working: API3 times out, Pyth broken by 0 price: switch to usingAPI3PythUntrusted", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // Pyth breaks by 0 price
    await pythMock.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '4') // status 4: using API3, Pyth untrusted
  })

  it("C1 api3Working: API3 times out, Pyth broken by 0 price: return last good price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(999, 8))
    await priceFeed.setLastGoodPrice(dec(999, 18))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    await pythMock.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice()
    let price = await priceFeed.lastGoodPrice()

    // Expect lastGoodPrice has not updated
    assert.equal(price.toString(), dec(999, 18))
  })

  it("C1 api3Working: API3 is out of date by <3hrs: remain api3Working", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(1234, 8))
    await th.fastForwardTime(10740) // fast forward 2hrs 59 minutes 

    const priceFetchTx = await priceFeed.fetchPrice()
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '0') // status 0: API3 working
  })

  it("C1 api3Working: API3 is out of date by <3hrs: return API3 price", async () => {
    await setAddresses()
    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(1234, 18))
    await th.fastForwardTime(10740) // fast forward 2hrs 59 minutes 

    const priceFetchTx = await priceFeed.fetchPrice()
    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(1234, 18))
  })

  // -- API3 is working 
  it("C1 api3Working: API3 is working and Pyth is working - remain on api3Working", async () => { 
    await setAddresses()
    await priceFeed.setLastGoodPrice(dec(1200, 18))

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(102, 18))

    await pythMock.setPrice(dec(103, 8))

    const priceFetchTx = await priceFeed.fetchPrice()

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '0') // status 0: API3 working
  })

  it("C1 api3Working: API3 is working and Pyth is working - return API3 price", async () => { 
    await setAddresses()
    await priceFeed.setLastGoodPrice(dec(1200, 18))

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(102, 18))

    await pythMock.setPrice(dec(103, 8))

    const priceFetchTx = await priceFeed.fetchPrice()
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is current API3 price
    assert.equal(price.toString(), dec(102, 18))
  })

  it("C1 api3Working: API3 is working and Pyth freezes - remain on api3Working", async () => { 
    await setAddresses()
    await priceFeed.setLastGoodPrice(dec(1200, 18))

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(102, 18))

    await pythMock.setPrice(dec(103, 8))

    // 4 hours pass with no Pyth updates
    await th.fastForwardTime(14400)

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await api3ProxyMock.setUpdateTime(now) // API3's price is current

    const priceFetchTx = await priceFeed.fetchPrice()

    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '0') // status 0: API3 working
  })

  it("C1 api3Working: API3 is working and Pyth freezes - return API3 price", async () => { 
    await setAddresses()
    await priceFeed.setLastGoodPrice(dec(1200, 18))

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(102, 18))

    await pythMock.setPrice(dec(103, 8))

    // 4 hours pass with no Pyth updates
    await th.fastForwardTime(14400)

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))
  
    await api3ProxyMock.setUpdateTime(now) // API3's price is current
    
    const priceFetchTx = await priceFeed.fetchPrice()
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is current API3 price
    assert.equal(price.toString(), dec(102, 18))
  })

  it("C1 api3Working: API3 is working and Pyth breaks: switch to usingAPI3PythUntrusted", async () => { 
    await setAddresses()
    await priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(102, 8))

    await pythMock.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice()
  
    const statusAfter = await priceFeed.status()
    assert.equal(statusAfter.toString(), '4') // status 4: usingAPI3PythUntrusted
  })

  it("C1 api3Working: API3 is working and Pyth breaks: return API3 price", async () => { 
    await setAddresses()
    await priceFeed.setLastGoodPrice(dec(1200, 18)) // establish a "last good price" from the previous price fetch

    const statusBefore = await priceFeed.status()
    assert.equal(statusBefore.toString(), '0') // status 0: API3 working

    await api3ProxyMock.setPrice(dec(102, 18))

    await pythMock.setPrice(0)

    const priceFetchTx = await priceFeed.fetchPrice()
    let price = await priceFeed.lastGoodPrice()

    // Check that the returned price is current API3 price
    assert.equal(price.toString(), dec(102, 18))
  })

  // --- Case 2: Using Pyth ---

  // Using Pyth, Pyth breaks
  it("C2 usingPythAPI3Untrusted: Pyth breaks by zero price: switch to bothOraclesSuspect", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await api3ProxyMock.setPrice(dec(999, 18))

    await priceFeed.setLastGoodPrice(dec(123, 18))

    const now = await th.getLatestBlockTimestamp()
    await pythMock.setUpdateTime(now)
    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: both oracles untrusted
  })

  it("C2 usingPythAPI3Untrusted: Pyth breaks by zero price: return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await api3ProxyMock.setPrice(dec(999, 18))

    await priceFeed.setLastGoodPrice(dec(123, 18))

    const now = await th.getLatestBlockTimestamp()
    await pythMock.setUpdateTime(now)
    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price.toString(), dec(123, 18))
  })

  // Using Pyth, Pyth breaks
  it("C2 usingPythAPI3Untrusted: Pyth breaks by call reverted: switch to bothOraclesSuspect", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    await api3ProxyMock.setPrice(dec(999, 8))
    await pythMock.setPrice(dec(999, 6))

    await pythMock.setRevert(true)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: both oracles untrusted
  })

  it("C2 usingPythAPI3Untrusted: Pyth breaks by call reverted: return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    await api3ProxyMock.setPrice(dec(999, 18))
    await pythMock.setPrice(dec(999, 6))

    await pythMock.setRevert(true)
   
    await priceFeed.fetchPrice()
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price.toString(), dec(123, 18))
  })

  // Using Pyth, Pyth breaks
  it("C2 usingPythAPI3Untrusted: Pyth breaks by zero timestamp: switch to bothOraclesSuspect", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    await api3ProxyMock.setPrice(dec(999, 8))
    await pythMock.setPrice(dec(999, 6))

    await pythMock.setUpdateTime(0)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: both oracles untrusted
  })

  it("C2 usingPythAPI3Untrusted: Pyth breaks by zero timestamp: return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await priceFeed.setLastGoodPrice(dec(123, 18))

    await api3ProxyMock.setPrice(dec(999, 8))
    await pythMock.setPrice(dec(999, 6))

    await pythMock.setUpdateTime(0)
   
    await priceFeed.fetchPrice()
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price.toString(), dec(123, 18))
  })

  // Using Pyth, Pyth freezes
  it("C2 usingPythAPI3Untrusted: Pyth freezes - remain usingAPI3PythUntrusted", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await api3ProxyMock.setPrice(dec(999, 8))

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await pythMock.setPrice(dec(123, 6))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await api3ProxyMock.setUpdateTime(now)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Pyth, API3 untrusted
  })

  it("C2 usingPythAPI3Untrusted: Pyth freezes - return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await api3ProxyMock.setPrice(dec(999, 8))

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await pythMock.setPrice(dec(123, 6))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await api3ProxyMock.setUpdateTime(now)

    await priceFeed.fetchPrice()
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price.toString(), dec(246, 18))
  })
  
  // Using Pyth, both API3 & Pyth go live

  it("C2 usingPythAPI3Untrusted: both Pyth and API3 are live and <= 5% price difference - switch to api3Working", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted
  
    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice(dec(105, 18)) // price = 105: 5% difference from API3

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: API3 working
  })

  it("C2 usingPythAPI3Untrusted: both Pyth and API3 are live and <= 5% price difference - return API3 price", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted
  
    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice(dec(105, 18)) // price = 105: 5% difference from API3

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(105, 18))
  })

  it("C2 usingPythAPI3Untrusted: both Pyth and API3 are live and > 5% price difference - remain usingAPI3PythUntrusted", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice('10500000001') // price = 105.00000001: > 5% difference from Pyth

    await priceFeed.fetchPrice()
   
    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Pyth, API3 untrusted
  })

  it("C2 usingPythAPI3Untrusted: both Pyth and API3 are live and > 5% price difference - return Pyth price", async () => {
    await setAddresses()
    await priceFeed.setStatus(1) // status 1: using Pyth, API3 untrusted

    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice('10500000001') // price = 105.00000001: > 5% difference from Pyth

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(100, 18))
  })


  // --- Case 3: Both Oracles suspect

  it("C3 bothOraclesUntrusted: both Pyth and API3 are live and > 5% price difference remain bothOraclesSuspect", async () => {
    await setAddresses()
    await priceFeed.setStatus(3) // status 3: both oracles untrusted

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice('10500000001') // price = 105.00000001: > 5% difference from Pyth

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: both oracles untrusted
  })

  it("C3 bothOraclesUntrusted: both Pyth and API3 are live and > 5% price difference, return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(3) // status 3: both oracles untrusted

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice('10500000001') // price = 105.00000001: > 5% difference from Pyth

    await priceFeed.fetchPrice()
    const price = await priceFeed.lastGoodPrice()

    assert.equal(price.toString(), dec(50, 18))
  })

  it("C3 bothOraclesUntrusted: both Pyth and API3 are live and <= 5% price difference, switch to api3Working", async () => {
    await setAddresses()
    await priceFeed.setStatus(3) // status 3: both oracles untrusted

    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice(dec(105, 18)) // price = 105: 5% difference from Pyth

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: API3 working
  })

  it("C3 bothOraclesUntrusted: both Pyth and API3 are live and <= 5% price difference, return API3 price", async () => {
    await setAddresses()
    await priceFeed.setStatus(3) // status 3: both oracles untrusted

    await pythMock.setPrice(dec(100, 8)) // price = 100
    await api3ProxyMock.setPrice(dec(105, 18)) // price = 105: 5% difference from Pyth

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(105, 18))
  })

  // --- Case 4 ---
  it("C4 usingPythAPI3Frozen: when both API3 and Pyth break, switch to bothOraclesSuspect", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    // Both API3 and Pyth break with 0 price
    await api3ProxyMock.setPrice(0)
    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: both oracles untrusted
  })

  it("C4 usingPythAPI3Frozen: when both API3 and Pyth break, return last good price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using tellor, chainlink frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    // Both API3 and Pyth break with 0 price
    await api3ProxyMock.setPrice(0)
    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(50, 18))
  })

  it("C4 usingPythAPI3Frozen: when API3 breaks and Pyth freezes, switch to usingAPI3PythUntrusted", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    // API3 breaks
    await api3ProxyMock.setPrice(0)

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Pyth, API3 untrusted
  })

  it("C4 usingPythAPI3Frozen: when API3 breaks and Pyth freezes, return last good price", async () => { 
    await setAddresses()
    priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    // API3 breaks
    await api3ProxyMock.setPrice(0)

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(50, 18))
  })

  it("C4 usingPythAPI3Frozen: when API3 breaks and Pyth live, switch to usingAPI3PythUntrusted", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    // API3 breaks
    await api3ProxyMock.setPrice(0)

    await pythMock.setPrice(dec(123, 6))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: using Pyth, API3 untrusted
  })

  it("C4 usingPythAPI3Frozen: when API3 breaks and Pyth live, return Pyth price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    // API3 breaks
    await api3ProxyMock.setPrice(0)

    await pythMock.setPrice(dec(123, 8))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth is live with <5% price difference, switch back to api3Working", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(998, 8))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: API3 working
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth is live with <5% price difference, return API3 current price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(998, 8))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(999, 18))  // API3 price
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth is live with >5% price difference, switch back to usingAPI3PythUntrusted", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 1)  // status 1: Using Pyth, API3 untrusted
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth is live with >5% price difference, return API3 current price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 8))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))  // Pyth price
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth is live with similar price, switch back to api3Working", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(998, 8))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: API3 working
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth is live with similar price, return API3 current price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(998, 8))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(999, 18))  // API3 price
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth breaks, switch to usingAPI3PythUntrusted", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: Using API3, Pyth untrusted
  })

  it("C4 usingPythAPI3Frozen: when API3 is live and Pyth breaks, return API3 current price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(999, 18))
  })

  it("C4 usingPythAPI3Frozen: when API3 still frozen and Pyth breaks, switch to usingAPI3PythUntrusted", async () => {
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime()
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // set tellor broken
    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using API3, Pyth untrusted
  })

  it("C4 usingPythAPI3Frozen: when API3 still frozen and Pyth broken, return last good price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // set tellor broken
    await pythMock.setPrice(0)

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(50, 18))
  })

  it("C4 usingPythAPI3Frozen: when API3 still frozen and Pyth live, remain usingPythAPI3Frozen", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // set Pyth to current time
    await pythMock.setUpdateTime(now)

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: using Pyth, API3 frozen
  })

  it("C4 usingPythAPI3Frozen: when API3 still frozen and Pyth live, return Pyth price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    // set Pyth to current time
    await pythMock.setUpdateTime(now)

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(123, 18))
  })

  it("C4 usingPythAPI3Frozen: when API3 still frozen and Pyth freezes, remain usingPythAPI3Frozen", async () => { 
    await setAddresses()
    await priceFeed.setStatus(2) // status 2: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 6))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

     // check Pyth price timestamp is out of date by > 4 hours
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 2)  // status 2: using Pyth, API3 frozen
  })

  it("C4 usingPythAPI3Frozen: when API3 still frozen and Pyth freezes, return last good price", async () => { 
    await setAddresses()
    await priceFeed.setStatus(3) // status 3: using Pyth, API3 frozen

    await priceFeed.setLastGoodPrice(dec(50, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

     // check Pyth price timestamp is out of date by > 4 hours
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(50, 18))
  })

  // --- Case 5 ---
  it("C5 usingAPI3PythUntrusted: when API3 is live and Pyth price >5% - no status change", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4: using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))  // Greater than 5% difference with chainlink

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using API3, Pyth untrusted
  })

  it("C5 usingAPI3PythUntrusted: when API3 is live and Pyth price >5% - return API3 price", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4: using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))  // Greater than 5% difference with chainlink

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(999, 18))
  })

  it("C5 usingAPI3PythUntrusted: when API3 is live and Pyth price within <5%, switch to api3Working", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4:  using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(998, 8))  // within 5% of API3

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 0)  // status 0: API3 working
  })

  it("C5 usingAPI3PythUntrusted: when API3 is live, Pyth price not within 5%, return API3 price", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4:  using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(998, 8))  // within 5% of API3

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(999, 18))
  })

  // ---------

  it("C5 usingAPI3PythUntrusted: when API3 is live, <50% price deviation from previous, Pyth price not within 5%, remain on usingAPI3PythUntrusted", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4:  using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(998, 18))
    await pythMock.setPrice(dec(123, 8))  // Pyth not close to current API3
 
    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using API3, Pyth untrusted
  })

  it("C5 usingAPI3PythUntrusted: when API3 is live, <50% price deviation from previous, Pyth price not within 5%, return API3 price", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4:  using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(998, 18))
    await pythMock.setPrice(dec(123, 8))  // Pyth not close to current API3

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(998, 18))
  })

  // -------

  it("C5 usingAPI3PythUntrusted: when API3 is live, <50% price deviation from previous, and Pyth is frozen, remain on usingAPI3PythUntrusted", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4:  using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))

    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await api3ProxyMock.setPrice(dec(998, 8))
    await api3ProxyMock.setUpdateTime(now) // API3 is current

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 4)  // status 4: using API3, Pyth untrusted
  })

  it("C5 usingAPI3PythUntrusted: when API3 is live, <50% price deviation from previous, Pyth is frozen, return API3 price", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4:  using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 6))

    await th.fastForwardTime(14400) // fast forward 4 hours

    // check Pyth price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const tellorUpdateTime = await pythMock.getUpdateTime()
    assert.isTrue(tellorUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await api3ProxyMock.setPrice(dec(998, 18))
    await api3ProxyMock.setUpdateTime(now) // API3 is current

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(998, 18))
  })

  it("C5 usingAPI3PythUntrusted: when API3 frozen, remain on usingAPI3PythUntrusted", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4: using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))
   
    await pythMock.setPrice(dec(123, 8))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 4) // status 4: using API3, Pyth untrusted
  })

  it("C5 usingAPI3PythUntrusted: when API3 frozen, return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4: using API3, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 8))

    await pythMock.setPrice(dec(123, 6))

    await th.fastForwardTime(14400) // Fast forward 4 hours

    // check API3 price timestamp is out of date by > 4 hours
    const now = await th.getLatestBlockTimestamp()
    const chainlinkUpdateTime = await api3ProxyMock.getUpdateTime() 
    assert.isTrue(chainlinkUpdateTime.lt(toBN(now).sub(toBN(14400))))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(246, 18))
  })

  it("C5 usingAPI3PythUntrusted: when API3 breaks too, switch to bothOraclesSuspect", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4: using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 18))
    await api3ProxyMock.setUpdateTime(0)  // API3 breaks by 0 timestamp

    await pythMock.setPrice(dec(123, 6))

    await priceFeed.fetchPrice()

    const status = await priceFeed.status()
    assert.equal(status, 3)  // status 3: both oracles untrusted
  })

  it("C5 usingAPI3PythUntrusted: API3 breaks too, return last good price", async () => {
    await setAddresses()
    await priceFeed.setStatus(4) // status 4: using chainlink, Pyth untrusted

    await priceFeed.setLastGoodPrice(dec(246, 18))

    await api3ProxyMock.setPrice(dec(999, 8))
    await api3ProxyMock.setUpdateTime(0)  // API3 breaks by 0 timestamp

    await pythMock.setPrice(dec(123, 6))

    await priceFeed.fetchPrice()

    const price = await priceFeed.lastGoodPrice()
    assert.equal(price.toString(), dec(246, 18))
  })
})

