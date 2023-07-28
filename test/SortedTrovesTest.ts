import {IContracts, IOpenTroveParams} from "../utils/types";
import {TestHelper} from "../utils/TestHelper";
import {assert, ethers} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  BorrowerOperations,
  PriceFeedMock,
  SIMToken,
  SortedTroves,
  SortedTrovesTester,
  TroveManager
} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {toHex} from "hardhat/internal/util/bigint";


const th = TestHelper
const dec = th.dec
const toBN = th.toBN

describe('SortedTroves', async () => {
  
  let owner: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress, dennis: SignerWithAddress, erin: SignerWithAddress, defaulter_1: SignerWithAddress,
      A:SignerWithAddress, B:SignerWithAddress, C:SignerWithAddress, D:SignerWithAddress, E:SignerWithAddress, F:SignerWithAddress, G:SignerWithAddress, H:SignerWithAddress, I:SignerWithAddress, J:SignerWithAddress, whale:SignerWithAddress
  

  let priceFeed: PriceFeedMock
  let sortedTroves: SortedTroves
  let troveManager: TroveManager
  let borrowerOperations: BorrowerOperations
  let simToken: SIMToken

  let contracts: IContracts

  const openTrove = async (params: IOpenTroveParams) => th.openTrove(contracts, params)

  describe('SortedTroves', () => {
    beforeEach(async () => {
      const f = await loadFixture(DeploymentHelper.deployFixture);
      [
        owner, alice, bob, carol, dennis, erin, whale,
        A, B, C, D, E, F, G, H, I, J,
      ] = f.signers;

      contracts = f.contracts
      priceFeed = contracts.priceFeedMock
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      borrowerOperations = contracts.borrowerOperations
      simToken = contracts.simToken
    })

    it('contains(): returns true for addresses that have opened troves', async () => {
      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
      await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: bob } })
      await openTrove({ ICR: toBN(dec(2000, 18)), extraParams: { from: carol } })

      // Confirm trove statuses became active
      assert.equal((await troveManager.Troves(alice.address))[3].toString(), '1')
      assert.equal((await troveManager.Troves(bob.address))[3].toString(), '1')
      assert.equal((await troveManager.Troves(carol.address))[3].toString(), '1')

      // Check sorted list contains troves
      assert.isTrue(await sortedTroves.contains(alice.address))
      assert.isTrue(await sortedTroves.contains(bob.address))
      assert.isTrue(await sortedTroves.contains(carol.address))
    })

    it('contains(): returns false for addresses that have not opened troves', async () => {
      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
      await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: bob } })
      await openTrove({ ICR: toBN(dec(2000, 18)), extraParams: { from: carol } })

      // Confirm troves have non-existent status
      assert.equal((await troveManager.Troves(dennis.address))[3].toString(), '0')
      assert.equal((await troveManager.Troves(erin.address))[3].toString(), '0')

      // Check sorted list do not contain troves
      assert.isFalse(await sortedTroves.contains(dennis.address))
      assert.isFalse(await sortedTroves.contains(erin.address))
    })

    it('contains(): returns false for addresses that opened and then closed a trove', async () => {
      await openTrove({ ICR: toBN(dec(1000, 18)), extraLUSDAmount: toBN(dec(3000, 18)), extraParams: { from: whale } })

      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
      await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: bob } })
      await openTrove({ ICR: toBN(dec(2000, 18)), extraParams: { from: carol } })

      // to compensate borrowing fees
      await simToken.connect(whale).transfer(alice.address, dec(1000, 18))
      await simToken.connect(whale).transfer(bob.address, dec(1000, 18))
      await simToken.connect(whale).transfer(carol.address, dec(1000, 18))

      // A, B, C close troves
      await borrowerOperations.connect(alice).closeTrove()
      await borrowerOperations.connect(bob).closeTrove()
      await borrowerOperations.connect(carol).closeTrove()

      // Confirm trove statuses became closed
      assert.equal((await troveManager.Troves(alice.address))[3].toString(), '2')
      assert.equal((await troveManager.Troves(bob.address))[3].toString(), '2')
      assert.equal((await troveManager.Troves(carol.address))[3].toString(), '2')

      // Check sorted list does not contain troves
      assert.isFalse(await sortedTroves.contains(alice.address))
      assert.isFalse(await sortedTroves.contains(bob.address))
      assert.isFalse(await sortedTroves.contains(carol.address))
    })

    // true for addresses that opened -> closed -> opened a trove
    it('contains(): returns true for addresses that opened, closed and then re-opened a trove', async () => {
      await openTrove({ ICR: toBN(dec(1000, 18)), extraLUSDAmount: toBN(dec(3000, 18)), extraParams: { from: whale } })

      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })
      await openTrove({ ICR: toBN(dec(20, 18)), extraParams: { from: bob } })
      await openTrove({ ICR: toBN(dec(2000, 18)), extraParams: { from: carol } })

      // to compensate borrowing fees
      await simToken.connect(whale).transfer(alice.address, dec(1000, 18))
      await simToken.connect(whale).transfer(bob.address, dec(1000, 18))
      await simToken.connect(whale).transfer(carol.address, dec(1000, 18))

      // A, B, C close troves
      await borrowerOperations.connect(alice).closeTrove()
      await borrowerOperations.connect(bob).closeTrove()
      await borrowerOperations.connect(carol).closeTrove()

      // Confirm trove statuses became closed
      assert.equal((await troveManager.Troves(alice.address))[3].toString(), '2')
      assert.equal((await troveManager.Troves(bob.address))[3].toString(), '2')
      assert.equal((await troveManager.Troves(carol.address))[3].toString(), '2')

      await openTrove({ ICR: toBN(dec(1000, 16)), extraParams: { from: alice } })
      await openTrove({ ICR: toBN(dec(2000, 18)), extraParams: { from: bob } })
      await openTrove({ ICR: toBN(dec(3000, 18)), extraParams: { from: carol } })

      // Confirm trove statuses became open again
      assert.equal((await troveManager.Troves(alice.address))[3].toString(), '1')
      assert.equal((await troveManager.Troves(bob.address))[3].toString(), '1')
      assert.equal((await troveManager.Troves(carol.address))[3].toString(), '1')

      // Check sorted list does  contain troves
      assert.isTrue(await sortedTroves.contains(alice.address))
      assert.isTrue(await sortedTroves.contains(bob.address))
      assert.isTrue(await sortedTroves.contains(carol.address))
    })

    // false when list size is 0
    it('contains(): returns false when there are no troves in the system', async () => {
      assert.isFalse(await sortedTroves.contains(alice.address))
      assert.isFalse(await sortedTroves.contains(bob.address))
      assert.isFalse(await sortedTroves.contains(carol.address))
    })

    // true when list size is 1 and the trove the only one in system
    it('contains(): true when list size is 1 and the trove the only one in system', async () => {
      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })

      assert.isTrue(await sortedTroves.contains(alice.address))
    })

    // false when list size is 1 and trove is not in the system
    it('contains(): false when list size is 1 and trove is not in the system', async () => {
      await openTrove({ ICR: toBN(dec(150, 16)), extraParams: { from: alice } })

      assert.isFalse(await sortedTroves.contains(bob.address))
    })

    // --- getMaxSize ---

    it("getMaxSize(): Returns the maximum list size", async () => {
      const max = await sortedTroves.getMaxSize()
      assert.equal(toHex(max.toBigInt()), th.maxBytes32)
    })

    // --- findInsertPosition ---

    it("Finds the correct insert position given two addresses that loosely bound the correct position", async () => { 
      await priceFeed.setPrice(dec(100, 18))

      // NICR sorted in descending order
      await openTrove({ ICR: toBN(dec(500, 18)), extraParams: { from: whale } })
      await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: A } })
      await openTrove({ ICR: toBN(dec(5, 18)), extraParams: { from: B } })
      await openTrove({ ICR: toBN(dec(250, 16)), extraParams: { from: C } })
      await openTrove({ ICR: toBN(dec(166, 16)), extraParams: { from: D } })
      await openTrove({ ICR: toBN(dec(125, 16)), extraParams: { from: E } })

      // Expect a trove with NICR 300% to be inserted between B and C
      const targetNICR = dec(3, 18)

      // Pass addresses that loosely bound the right postiion
      const hints = await sortedTroves.findInsertPosition(targetNICR, A.address, E.address)

      // Expect the exact correct insert hints have been returned
      assert.equal(hints[0], B.address )
      assert.equal(hints[1], C.address )

      // The price doesn’t affect the hints
      await priceFeed.setPrice(dec(500, 18))
      const hints2 = await sortedTroves.findInsertPosition(targetNICR, A.address, E.address)

      // Expect the exact correct insert hints have been returned
      assert.equal(hints2[0], B.address )
      assert.equal(hints2[1], C.address )
    })

    it("validInsertPosition getter", async () => {
      const r = await sortedTroves.validInsertPosition(0, th.ZERO_ADDRESS, th.ZERO_ADDRESS)
      assert.isTrue(r)
    })
  })

  describe('SortedTroves with mock dependencies', () => {
    let sortedTrovesTester: SortedTrovesTester

    beforeEach(async () => {
      sortedTroves = await (await ethers.getContractFactory("SortedTroves")).deploy() as SortedTroves
      sortedTrovesTester = await (await ethers.getContractFactory("SortedTrovesTester")).deploy() as SortedTrovesTester
      await sortedTrovesTester.setSortedTroves(sortedTroves.address)
    })

    context('when params are wrongly set', () => {
      it('setParams(): reverts if size is zero', async () => {
        await th.assertRevert(sortedTroves.setParams(0, sortedTrovesTester.address, sortedTrovesTester.address), 'SortedTroves: Size cant be zero')
      })
    })

    context('when params are properly set', () => {
      beforeEach('set params', async() => {
        await sortedTroves.setParams(2, sortedTrovesTester.address, sortedTrovesTester.address)
      })

      it('insert(): fails if list is full', async () => {
        await sortedTrovesTester.insert(alice.address, 1, alice.address, alice.address)
        await sortedTrovesTester.insert(bob.address, 1, alice.address, alice.address)
        await th.assertRevert(sortedTrovesTester.insert(carol.address, 1, alice.address, alice.address), 'SortedTroves: List is full')
      })

      it('insert(): fails if list already contains the node', async () => {
        await sortedTrovesTester.insert(alice.address, 1, alice.address, alice.address)
        await th.assertRevert(sortedTrovesTester.insert(alice.address, 1, alice.address, alice.address), 'SortedTroves: List already contains the node')
      })

      it('insert(): fails if id is zero', async () => {
        await th.assertRevert(sortedTrovesTester.insert(th.ZERO_ADDRESS, 1, alice.address, alice.address), 'SortedTroves: Id cannot be zero')
      })

      it('insert(): fails if NICR is zero', async () => {
        await th.assertRevert(sortedTrovesTester.insert(alice.address, 0, alice.address, alice.address), 'SortedTroves: NICR must be positive')
      })

      it('remove(): fails if id is not in the list', async () => {
        await th.assertRevert(sortedTrovesTester.remove(alice.address), 'SortedTroves: List does not contain the id')
      })

      it('reInsert(): fails if list doesn’t contain the node', async () => {
        await th.assertRevert(sortedTrovesTester.reInsert(alice.address, 1, alice.address, alice.address), 'SortedTroves: List does not contain the id')
      })

      it('reInsert(): fails if new NICR is zero', async () => {
        await sortedTrovesTester.insert(alice.address, 1, alice.address, alice.address)
        assert.isTrue(await sortedTroves.contains(alice.address), 'list should contain element')
        await th.assertRevert(sortedTrovesTester.reInsert(alice.address, 0, alice.address, alice.address), 'SortedTroves: NICR must be positive')
        assert.isTrue(await sortedTroves.contains(alice.address), 'list should contain element')
      })

      it('findInsertPosition(): No prevId for hint - ascend list starting from nextId, result is after the tail', async () => {
        await sortedTrovesTester.insert(alice.address, 1, alice.address, alice.address)
        const pos = await sortedTroves.findInsertPosition(1, th.ZERO_ADDRESS, alice.address)
        assert.equal(pos[0], alice.address, 'prevId result should be nextId param')
        assert.equal(pos[1], th.ZERO_ADDRESS, 'nextId result should be zero')
      })
    })
  })
})
