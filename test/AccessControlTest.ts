import {TestHelper} from "../utils/TestHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {IContracts} from "../utils/types";
import {
  ActivePool,
  BorrowerOperationsTester,
  CollSurplusPool,
  CommunityIssuance,
  DefaultPool,
  HintHelpers,
  LockupContractFactory,
  PriceFeedMock,
  SHADYToken,
  SIMTokenTester,
  SortedTroves,
  StabilityPool,
  TroveManagerTester,
  Ve
} from "../typechain-types";
import {assert} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";

const th = TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const timeValues = th.TimeValues

/* The majority of access control tests are contained in this file. However, tests for restrictions 
on the Liquity admin address's capabilities during the first year are found in:

test/launchSequenceTest/DuringLockupPeriodTest.js */

describe('Access Control: Liquity functions with the caller restricted to Liquity contract(s)', async () => {
  let
      owner:SignerWithAddress,
      alice:SignerWithAddress,
      bob:SignerWithAddress,
      carol:SignerWithAddress

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

  let ve: Ve
  let communityIssuance: CommunityIssuance
  let lockupContractFactory: LockupContractFactory

  let multisig: string
  let multisigSigner: SignerWithAddress

  before(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    contracts = f.contracts;
    [
      owner, alice, bob, carol
    ] = f.signers;
    multisig = f.multisig
    multisigSigner = f.signers[19]
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
    ve = f.shadyContracts.ve
    communityIssuance = f.shadyContracts.communityIssuance as CommunityIssuance
    lockupContractFactory = f.shadyContracts.lockupContractFactory

    for (const account of f.signers.slice(0, 10)) {
      await th.openTrove(contracts, { extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
    }

    const expectedCISupplyCap = '30000000000000000000000000' // 30mil

    // Check CI has been properly funded
    const bal = await shadyToken.balanceOf(communityIssuance.address)
    assert.equal(bal.toString(), expectedCISupplyCap)
  })

  describe('BorrowerOperations', async () => { 
    it("moveETHGainToTrove(): reverts when called by an account that is not StabilityPool", async () => {
      // Attempt call from alice
      try {
        const tx1= await borrowerOperations.connect(bob).moveWSTETHGainToTrove(bob.address, bob.address, bob.address)
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "BorrowerOps: Caller is not Stability Pool")
      }
    })
  })

  describe('TroveManager', async () => {
    // applyPendingRewards
    it("applyPendingRewards(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).applyPendingRewards(bob.address)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // updateRewardSnapshots
    it("updateRewardSnapshots(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).updateTroveRewardSnapshots(bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert" )
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // removeStake
    it("removeStake(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).removeStake(bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // updateStakeAndTotalStakes
    it("updateStakeAndTotalStakes(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).updateStakeAndTotalStakes(bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // closeTrove
    it("closeTrove(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).closeTrove(bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // addTroveOwnerToArray
    it("addTroveOwnerToArray(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).addTroveOwnerToArray(bob.address)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // setTroveStatus
    it("setTroveStatus(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).setTroveStatus(bob.address, 1)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // increaseTroveColl
    it("increaseTroveColl(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).increaseTroveColl(bob.address, 100)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // decreaseTroveColl
    it("decreaseTroveColl(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).decreaseTroveColl(bob.address, 100)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // increaseTroveDebt
    it("increaseTroveDebt(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).increaseTroveDebt(bob.address, 100)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })

    // decreaseTroveDebt
    it("decreaseTroveDebt(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.connect(alice).decreaseTroveDebt(bob.address, 100)
        
      } catch (err) {
         assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is not the BorrowerOperations contract")
      }
    })
  })

  describe('ActivePool', async () => {
    // sendETH
    it("sendETH(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.connect(alice).sendWSTETH(alice.address, 100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // increaseSIM	
    it("increaseSIMDebt(): reverts when called by an account that is not BO nor TroveM", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.connect(alice).increaseSIMDebt(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is neither BorrowerOperations nor TroveManager")
      }
    })

    // decreaseSIM
    it("decreaseSIMDebt(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.connect(alice).decreaseSIMDebt(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // fallback (payment)	
    it("fallback(): reverts when called by an account that is not Borrower Operations nor Default Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.connect(alice).receiveWSTETH(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "ActivePool: Caller is neither BO nor Default Pool")
      }
    })
  })

  describe('DefaultPool', async () => {
    // sendWSTETHToActivePool
    it("sendWSTETHToActivePool(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.connect(alice).sendWSTETHToActivePool(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is not the TroveManager")
      }
    })

    // increaseSIM
    it("increaseSIMDebt(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.connect(alice).increaseSIMDebt(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is not the TroveManager")
      }
    })

    // decreaseSIM	
    it("decreaseSIM(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.connect(alice).decreaseSIMDebt(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is not the TroveManager")
      }
    })

    // fallback (payment)	
    it("fallback(): reverts when called by an account that is not the Active Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.connect(alice).receiveWSTETH(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "DefaultPool: Caller is not the ActivePool")
      }
    })
  })

  describe('StabilityPool', async () => {
    // --- onlyTroveManager --- 

    // offset
    it("offset(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await stabilityPool.connect(alice).offset(100, 10)
        assert.fail('')
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is not TroveManager")
      }
    })

    // --- onlyActivePool ---

    // fallback (payment)	
    it("fallback(): reverts when called by an account that is not the Active Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await stabilityPool.connect(alice).receiveWSTETH(100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "StabilityPool: Caller is not ActivePool")
      }
    })
  })

  describe('SIMToken', async () => {

    //    mint
    it("mint(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      const txAlice = simToken.connect(alice).mint(bob.address, 100)
      await th.assertRevert(txAlice, "Caller is not BorrowerOperations")
    })

    // burn
    it("burn(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await simToken.connect(alice).burn(bob.address, 100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // sendToPool
    it("sendToPool(): reverts when called by an account that is not StabilityPool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await simToken.connect(alice).sendToPool(bob.address, activePool.address, 100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is not the StabilityPool")
      }
    })

    // returnFromPool
    it("returnFromPool(): reverts when called by an account that is not TroveManager nor StabilityPool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await simToken.connect(alice).returnFromPool(activePool.address, bob.address, 100)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        // assert.include(err?.toString(), "Caller is neither TroveManager nor StabilityPool")
      }
    })
  })

  describe('SortedTroves', async () => {
    // --- onlyBorrowerOperations ---
    //     insert
    it("insert(): reverts when called by an account that is not BorrowerOps or TroveM", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.connect(alice).insert(bob.address, '150000000000000000000', bob.address, bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), " Caller is neither BO nor TroveM")
      }
    })

    // --- onlyTroveManager ---
    // remove
    it("remove(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.remove(bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), " Caller is not the TroveManager")
      }
    })

    // --- onlyTroveMorBM ---
    // reinsert
    it("reinsert(): reverts when called by an account that is neither BorrowerOps nor TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.connect(alice).reInsert(bob.address, '150000000000000000000', bob.address, bob.address)
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
        assert.include(err?.toString(), "Caller is neither BO nor TroveM")
      }
    })
  })

  describe('LockupContract', async () => {
    it("withdrawSHADY(): reverts when caller is not beneficiary", async () => {
      // deploy new LC with Carol as beneficiary
      const unlockTime = (await shadyToken.getDeploymentStartTime()).add(toBN(timeValues.SECONDS_IN_ONE_YEAR))
      const deployedLCtx = await lockupContractFactory.deployLockupContract(
        carol.address,
        unlockTime)

      const LC = await th.getLCFromDeploymentTx(deployedLCtx)

      // SHADY Multisig funds the LC
      await shadyToken.connect(multisigSigner).transfer(LC.address, dec(100, 18))

      // Fast-forward one year, so that beneficiary can withdraw
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)

      // Bob attempts to withdraw SHADY
      try {
        const txBob = await LC.connect(bob).withdrawSHADY()
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
      }

      // Confirm beneficiary, Carol, can withdraw
      const txCarol = await LC.connect(carol).withdrawSHADY()
      // assert.isTrue(txCarol.receipt.status)
    })
  })

  describe('Ve', async () => {
    it("increaseF_SIM(): reverts when caller is not TroveManager", async () => {
      try {
        const txAlice = await ve.connect(alice).increaseF_SIM(dec(1, 18))
        
      } catch (err) {
        assert.include(err?.toString(), "revert")
      }
    })
  })

  describe('SHADYToken', async () => {
    it("sendToVe(): reverts when caller is not the Ve", async () => {
      // Check multisig has some SHADY
      assert.isTrue((await shadyToken.balanceOf(multisig)).gt(toBN('0')))

      // multisig tries to call it
      try {
        const tx = await shadyToken.connect(multisigSigner).sendToVe(multisig, 1)
      } catch (err) {
        assert.include(err?.toString(), "revert")
      }

      // FF >> time one year
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR)

      // Owner transfers 1 SHADY to bob
      await shadyToken.connect(multisigSigner).transfer(bob.address, dec(1, 18))
      assert.equal((await shadyToken.balanceOf(bob.address)).toString(), dec(1, 18))

      // Bob tries to call it
      try {
        const tx = await shadyToken.connect(bob).sendToVe(bob.address, dec(1, 18))
      } catch (err) {
        assert.include(err?.toString(), "revert")
      }
    })
  })

  describe('CommunityIssuance', async () => {
    it("sendSHADY(): reverts when caller is not the StabilityPool", async () => {
      const tx1 = communityIssuance.connect(alice).sendSHADY(alice.address, dec(100, 18))
      const tx2 = communityIssuance.connect(alice).sendSHADY(bob.address, dec(100, 18))
      const tx3 = communityIssuance.connect(alice).sendSHADY(stabilityPool.address, dec(100, 18))
     
      assertRevert(tx1)
      assertRevert(tx2)
      assertRevert(tx3)
    })

    it("issueSHADY(): reverts when caller is not the StabilityPool", async () => {
      const tx1 = communityIssuance.connect(alice).issueSHADY()

      assertRevert(tx1)
    })
  })

  
})


