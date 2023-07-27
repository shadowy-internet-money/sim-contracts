import {MoneyValues, TestHelper} from "../utils/TestHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IContracts, IOpenTroveParams} from "../utils/types";
import {BorrowerOperationsTester, CollSurplusPool, PriceFeedMock} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {assert} from "hardhat";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = MoneyValues
const timeValues = th.TimeValues

describe('CollSurplusPool', async () => {
  let A:SignerWithAddress, B: SignerWithAddress

  let contracts: IContracts
  let borrowerOperations: BorrowerOperationsTester
  let priceFeed: PriceFeedMock
  let collSurplusPool: CollSurplusPool

  const openTrove = async (params: IOpenTroveParams) => th.openTrove(contracts, params)

  beforeEach(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    contracts = f.contracts;
    [,,,,,,,,,
      A, B,
    ] = f.signers;
    priceFeed = contracts.priceFeedMock
    borrowerOperations = contracts.borrowerOperations as BorrowerOperationsTester
    collSurplusPool = contracts.collSurplusPool
  })

  it("CollSurplusPool::getETH(): Returns the ETH balance of the CollSurplusPool after redemption", async () => {
    const ETH_1 = await collSurplusPool.getWSTETH()
    assert.equal(ETH_1.toString(), '0')

    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(price)

    const { collateral: B_coll, netDebt: B_netDebt } = await openTrove({ ICR: toBN(dec(200, 16)), extraParams: { from: B } })
    await openTrove({ extraLUSDAmount: B_netDebt, extraParams: { from: A, value: dec(3000, 'ether') } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 5)

    // At ETH:USD = 100, this redemption should leave 1 ether of coll surplus
    await th.redeemCollateralAndGetTxObject(A, contracts, B_netDebt.toString())

    const ETH_2 = await collSurplusPool.getWSTETH()
    th.assertIsApproximatelyEqual(ETH_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price)))
  })

  it("CollSurplusPool: claimColl(): Reverts if caller is not Borrower Operations", async () => {
    await th.assertRevert(collSurplusPool.connect(A).claimColl(A.address), 'CollSurplusPool: Caller is not Borrower Operations')
  })

  it("CollSurplusPool: claimColl(): Reverts if nothing to claim", async () => {
    await th.assertRevert(borrowerOperations.connect(A).claimCollateral(), 'CollSurplusPool: No collateral available to claim')
  })

  it('CollSurplusPool: reverts trying to send ETH to it', async () => {
    await th.assertRevert(collSurplusPool.connect(A).receiveWSTETH(1), 'CollSurplusPool: Caller is not Active Pool')
  })

  it('CollSurplusPool: accountSurplus: reverts if caller is not Trove Manager', async () => {
    await th.assertRevert(collSurplusPool.connect(A).accountSurplus(A.address, 1), 'CollSurplusPool: Caller is not TroveManager')
  })
})
