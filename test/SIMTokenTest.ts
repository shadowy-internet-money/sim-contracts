import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {TestHelper} from "../utils/TestHelper";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {IContracts} from "../utils/types";
import {BorrowerOperations, SIMTokenTester, StabilityPool, TroveManager} from "../typechain-types";
import {assert} from "hardhat";
import {BigNumber} from "ethers";
import {PermitHelper} from "../utils/PermitHelper";
import {hexlify} from "ethers/lib/utils";

const th = TestHelper
const { toBN, assertRevert, dec, ZERO_ADDRESS } = th

describe('SIM token', async () => {
  let owner: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress, dennis: SignerWithAddress

  let approve: {owner: string, spender: string, value: number}

  // the second account our hardhatenv creates (for Alice)
  const alicePrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

  let contracts: IContracts
  let chainId: BigNumber
  let simTokenTester: SIMTokenTester
  let stabilityPool: StabilityPool
  let troveManager: TroveManager
  let borrowerOperations: BorrowerOperations

  let tokenName: string
  const tokenVersion = '1'

  beforeEach(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    contracts = f.contracts;
    [owner,alice,bob,carol, dennis] = f.signers
    simTokenTester = f.contracts.simToken as SIMTokenTester

    chainId = await simTokenTester.getChainId()

    stabilityPool = contracts.stabilityPool
    troveManager = contracts.troveManager
    borrowerOperations = contracts.borrowerOperations

    tokenName = await simTokenTester.name()

    // mint some tokens
    await simTokenTester.unprotectedMint(alice.address, 150)
    await simTokenTester.unprotectedMint(bob.address, 100)
    await simTokenTester.unprotectedMint(carol.address, 50)

    // Create the approval tx data
    approve = {
      owner: alice.address,
      spender: bob.address,
      value: 1,
    }
  })

  it('balanceOf(): gets the balance of the account', async () => {
    const aliceBalance = (await simTokenTester.balanceOf(alice.address)).toNumber()
    const bobBalance = (await simTokenTester.balanceOf(bob.address)).toNumber()
    const carolBalance = (await simTokenTester.balanceOf(carol.address)).toNumber()

    assert.equal(aliceBalance, 150)
    assert.equal(bobBalance, 100)
    assert.equal(carolBalance, 50)
  })

  it('totalSupply(): gets the total supply', async () => {
    const total = (await simTokenTester.totalSupply()).toString()
    assert.equal(total, '300') // 300
  })

  it("name(): returns the token's name", async () => {
    const name = await simTokenTester.name()
    assert.equal(name, "Shadowy Internet Money")
  })

  it("symbol(): returns the token's symbol", async () => {
    const symbol = await simTokenTester.symbol()
    assert.equal(symbol, "SIM")
  })

  it("decimal(): returns the number of decimal digits used", async () => {
    const decimals = await simTokenTester.decimals()
    assert.equal(decimals.toString(), "18")
  })

  it("allowance(): returns an account's spending allowance for another account's balance", async () => {
    await simTokenTester.connect(bob).approve(alice.address, 100)

    const allowance_A = await simTokenTester.allowance(bob.address, alice.address)
    const allowance_D = await simTokenTester.allowance(bob.address, dennis.address)

    assert.equal(allowance_A.toNumber(), 100)
    assert.equal(allowance_D.toString(), '0')
  })

  it("approve(): approves an account to spend the specified amount", async () => {
    const allowance_A_before = await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_before.toString(), '0')

    await simTokenTester.connect(bob).approve(alice.address, 100)

    const allowance_A_after = await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_after.toNumber(), 100)
  })

  it("approve(): reverts when spender param is address(0)", async () => {
    const txPromise = simTokenTester.connect(bob).approve(ZERO_ADDRESS, 100)
    await assertRevert(txPromise)
  })

  it("approve(): reverts when owner param is address(0)", async () => {
    const txPromise = simTokenTester.connect(bob).callInternalApprove(ZERO_ADDRESS, alice.address, dec(1000, 18))
    await assertRevert(txPromise)
  })

  it("transferFrom(): successfully transfers from an account which is it approved to transfer from", async () => {
    const allowance_A_0 = await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_0.toString(), '0')

    await simTokenTester.connect(bob).approve(alice.address, 50)

    // Check A's allowance of Bob's funds has increased
    const allowance_A_1= await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_1.toNumber(), 50)


    assert.equal((await simTokenTester.balanceOf(carol.address)).toNumber(), 50)

    // Alice transfers from bob to Carol, using up her allowance
    await simTokenTester.connect(alice).transferFrom(bob.address, carol.address, 50)
    assert.equal((await simTokenTester.balanceOf(carol.address)).toNumber(), 100)

    // Check A's allowance of Bob's funds has decreased
    const allowance_A_2= await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_2.toString(), '0')

    // Check bob's balance has decreased
    assert.equal((await simTokenTester.balanceOf(bob.address)).toNumber(), 50)

    // Alice tries to transfer more tokens from bob's account to carol than she's allowed
    const txPromise = simTokenTester.connect(alice).transferFrom(bob.address, carol.address, 50)
    await assertRevert(txPromise)
  })

  it("transfer(): increases the recipient's balance by the correct amount", async () => {
    assert.equal((await simTokenTester.balanceOf(alice.address)).toNumber(), 150)

    await simTokenTester.connect(bob).transfer(alice.address, 37)

    assert.equal((await simTokenTester.balanceOf(alice.address)).toNumber(), 187)
  })

  it("transfer(): reverts if amount exceeds sender's balance", async () => {
    assert.equal((await simTokenTester.balanceOf(bob.address)).toNumber(), 100)

    const txPromise = simTokenTester.connect(bob).transfer(alice.address, 101)
    await assertRevert(txPromise)
  })

  it('transfer(): transferring to a blacklisted address reverts', async () => {
    await assertRevert(simTokenTester.connect(alice).transfer(simTokenTester.address, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(ZERO_ADDRESS, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(troveManager.address, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(stabilityPool.address, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(borrowerOperations.address, 1))
  })

  it("increaseAllowance(): increases an account's allowance by the correct amount", async () => {
    const allowance_A_Before = await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_Before.toString(), '0')

    await simTokenTester.connect(bob).increaseAllowance(alice.address, 100)

    const allowance_A_After = await simTokenTester.allowance(bob.address, alice.address)
    assert.equal(allowance_A_After.toNumber(), 100)
  })

  it('mint(): issues correct amount of tokens to the given address', async () => {
    const alice_balanceBefore = await simTokenTester.balanceOf(alice.address)
    assert.equal(alice_balanceBefore.toNumber(), 150)

    await simTokenTester.unprotectedMint(alice.address, 100)

    const alice_BalanceAfter = await simTokenTester.balanceOf(alice.address)
    assert.equal(alice_BalanceAfter.toNumber(), 250)
  })

  it('burn(): burns correct amount of tokens from the given address', async () => {
    const alice_balanceBefore = await simTokenTester.balanceOf(alice.address)
    assert.equal(alice_balanceBefore.toNumber(), 150)

    await simTokenTester.unprotectedBurn(alice.address, 70)

    const alice_BalanceAfter = await simTokenTester.balanceOf(alice.address)
    assert.equal(alice_BalanceAfter.toNumber(), 80)
  })

  // TODO: Rewrite this test - it should check the actual simTokenTester's balance.
  it('sendToPool(): changes balances of Stability pool and user by the correct amounts', async () => {
    const stabilityPool_BalanceBefore = await simTokenTester.balanceOf(stabilityPool.address)
    const bob_BalanceBefore = await simTokenTester.balanceOf(bob.address)
    assert.equal(stabilityPool_BalanceBefore.toNumber(), 0)
    assert.equal(bob_BalanceBefore.toNumber(), 100)

    await simTokenTester.unprotectedSendToPool(bob.address, stabilityPool.address, 75)

    const stabilityPool_BalanceAfter = await simTokenTester.balanceOf(stabilityPool.address)
    const bob_BalanceAfter = await simTokenTester.balanceOf(bob.address)
    assert.equal(stabilityPool_BalanceAfter.toNumber(), 75)
    assert.equal(bob_BalanceAfter.toNumber(), 25)
  })

  it('returnFromPool(): changes balances of Stability pool and user by the correct amounts', async () => {
    /// --- SETUP --- give pool 100 SIM
    await simTokenTester.unprotectedMint(stabilityPool.address, 100)

    /// --- TEST ---
    const stabilityPool_BalanceBefore = await simTokenTester.balanceOf(stabilityPool.address)
    const  bob_BalanceBefore = await simTokenTester.balanceOf(bob.address)
    assert.equal(stabilityPool_BalanceBefore.toNumber(), 100)
    assert.equal(bob_BalanceBefore.toNumber(), 100)

    await simTokenTester.unprotectedReturnFromPool(stabilityPool.address, bob.address, 75)

    const stabilityPool_BalanceAfter = await simTokenTester.balanceOf(stabilityPool.address)
    const bob_BalanceAfter = await simTokenTester.balanceOf(bob.address)
    assert.equal(stabilityPool_BalanceAfter.toNumber(), 25)
    assert.equal(bob_BalanceAfter.toNumber(), 175)
  })

  it('transfer(): transferring to a blacklisted address reverts', async () => {
    await assertRevert(simTokenTester.connect(alice).transfer(simTokenTester.address, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(ZERO_ADDRESS, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(troveManager.address, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(stabilityPool.address, 1))
    await assertRevert(simTokenTester.connect(alice).transfer(borrowerOperations.address, 1))
  })

  it('decreaseAllowance(): decreases allowance by the expected amount', async () => {
    await simTokenTester.connect(alice).approve(bob.address, dec(3, 18))
    assert.equal((await simTokenTester.allowance(alice.address, bob.address)).toString(), dec(3, 18))
    await simTokenTester.connect(alice).decreaseAllowance(bob.address, dec(1, 18))
    assert.equal((await simTokenTester.allowance(alice.address, bob.address)).toString(), dec(2, 18))
  })

  it('decreaseAllowance(): fails trying to decrease more than previously allowed', async () => {
    await simTokenTester.connect(alice).approve(bob.address, dec(3, 18))
    assert.equal((await simTokenTester.allowance(alice.address, bob.address)).toString(), dec(3, 18))
    await assertRevert(simTokenTester.connect(alice).decreaseAllowance(bob.address, dec(4, 18)), 'ERC20: decreased allowance below zero')
    assert.equal((await simTokenTester.allowance(alice.address, bob.address)).toString(), dec(3, 18))
  })

  // EIP2612 tests

  it('Initializes DOMAIN_SEPARATOR correctly', async () => {
    assert.equal(await simTokenTester.domainSeparator(),
        PermitHelper.getDomainSeparator(tokenName, simTokenTester.address, chainId.toString(), tokenVersion))
  })

  it('Initial nonce for a given address is 0', async function () {
    assert.equal(toBN(await simTokenTester.nonces(alice.address)).toString(), '0');
  });

  const buildPermitTx = async (deadline: number) => {
    const nonce = (await simTokenTester.nonces(approve.owner)).toString()

    // Get the EIP712 digest
    const digest = PermitHelper.getPermitDigest(
        tokenName, simTokenTester.address,
        chainId.toString(), tokenVersion,
        approve.owner, approve.spender,
        approve.value, nonce, deadline
    )

    const { v, r, s } = PermitHelper.sign(digest, alicePrivateKey)

    const tx = simTokenTester.permit(
        approve.owner, approve.spender, approve.value,
        deadline, v, hexlify(r), hexlify(s)
    )

    return { v, r, s, tx }
  }

  it('permits and emits an Approval event (replay protected)', async () => {
    const deadline = 100000000000000

    // Approve it
    const { v, r, s, tx } = await buildPermitTx(deadline)
    const receipt = await (await tx).wait()
    // @ts-ignore
    const event = receipt.events[0]

    // Check that approval was successful
    assert.equal(event.event, 'Approval')
    assert.equal((await simTokenTester.nonces(approve.owner)).toNumber(), 1)
    assert.equal((await simTokenTester.allowance(approve.owner, approve.spender)).toNumber(), approve.value)

    // Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
    await assertRevert(simTokenTester.permit(
        approve.owner, approve.spender, approve.value,
        deadline, v, r, s), 'ERC20Permit: invalid signature')

    // Check that the zero address fails
    await assertRevert(simTokenTester.permit('0x0000000000000000000000000000000000000000',
        approve.spender, approve.value, deadline, '0x99', r, s), 'ECDSA: invalid signature')
    // await assertAssert(simTokenTester.permit('0x0000000000000000000000000000000000000000',
    //                                           approve.spender, approve.value, deadline, '0x99', r, s))
  })

  it('permits(): fails with expired deadline', async () => {
    const deadline = 1

    const {tx } = await buildPermitTx(deadline)
    await assertRevert(tx, 'ERC20Permit: expired deadline')
  })

  it('permits(): fails with the wrong signature', async () => {
    const deadline = 100000000000000

    const { v, r, s } = await buildPermitTx(deadline)

    const tx = simTokenTester.permit(
        carol.address, approve.spender, approve.value,
        deadline, v, hexlify(r), hexlify(s)
    )

    await assertRevert(tx, 'ERC20Permit: invalid signature')
  })
})

