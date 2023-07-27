import {assert} from "hardhat";
import {TestHelper} from "../utils/TestHelper";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CommunityIssuance, SHADYTokenTester, Ve} from "../typechain-types";
import {ecsign} from "ethereumjs-util";
import {defaultAbiCoder, hexlify, keccak256, solidityPack, toUtf8Bytes} from "ethers/lib/utils";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";

// the second account our hardhatenv creates (for EOA A)
// from https://github.com/liquity/dev/blob/main/packages/contracts/hardhatAccountsList2k.js#L3

const th = TestHelper
const toBN = th.toBN
const dec = th.dec
const ZERO_ADDRESS = th.ZERO_ADDRESS
const assertRevert = th.assertRevert

describe('SHADY token', async () => {
  let A:SignerWithAddress, B: SignerWithAddress, C:SignerWithAddress, D:SignerWithAddress

  let approve: {owner: string, spender: string, value: number}
  // Create the approval tx data, for use in permit()

  const A_PrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

  let contracts
  let shadyTokenTester: SHADYTokenTester
  let ve: Ve
  let communityIssuance: CommunityIssuance

  let tokenName: string
  let chainId: string
  const tokenVersion = '1'

  const sign = (digest:string, privateKey:string) => {
    return ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))
  }

  const PERMIT_TYPEHASH = keccak256(
    toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
  )

  // Gets the EIP712 domain separator
  const getDomainSeparator = (name:string, contractAddress:string, chainId:string, version:string) => {
    return keccak256(defaultAbiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes(version)),
        parseInt(chainId), contractAddress.toLowerCase()
      ]))
  }

  // Returns the EIP712 hash which should be signed by the user
  // in order to make a call to `permit`
  const getPermitDigest = (name: string, address: string, chainId:string, version:string,
    owner:string, spender:string, value:number,
    nonce:string, deadline:number) => {

    const DOMAIN_SEPARATOR = getDomainSeparator(name, address, chainId, version)
    return keccak256(solidityPack(['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      ['0x19', '0x01', DOMAIN_SEPARATOR,
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [PERMIT_TYPEHASH, owner, spender, value, nonce, deadline])),
      ]))
  }

  const mintToABC = async () => {
    // mint some tokens
    await shadyTokenTester.unprotectedMint(A.address, dec(150, 18))
    await shadyTokenTester.unprotectedMint(B.address, dec(100, 18))
    await shadyTokenTester.unprotectedMint(C.address, dec(50, 18))
  }

  const buildPermitTx = async (deadline:number) => {
    const nonce = (await shadyTokenTester.nonces(approve.owner)).toString()

    // Get the EIP712 digest
    const digest = getPermitDigest(
      tokenName, shadyTokenTester.address,
      chainId, tokenVersion,
      approve.owner, approve.spender,
      approve.value, nonce, deadline
    )

    const { v, r, s } = sign(digest, A_PrivateKey)

    const tx = shadyTokenTester.permit(
      approve.owner, approve.spender, approve.value,
      deadline, v, hexlify(r), hexlify(s)
    )

    return { v, r, s, tx }
  }

  beforeEach(async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);
    contracts = f.contracts;
    [,,,A, B, C, D] = f.signers

    ve = f.shadyContracts.ve
    shadyTokenTester = f.shadyContracts.shadyToken as SHADYTokenTester
    communityIssuance = f.shadyContracts.communityIssuance as CommunityIssuance

    tokenName = await shadyTokenTester.name()
    chainId = '31337'

    approve = {
      owner: f.signers[0].address,
      spender: f.signers[1].address,
      value: 1,
    }
  })

  it('balanceOf(): gets the balance of the account', async () => {
    await mintToABC()

    const A_Balance = (await shadyTokenTester.balanceOf(A.address)).toString()
    const B_Balance = (await shadyTokenTester.balanceOf(B.address)).toString()
    const C_Balance = (await shadyTokenTester.balanceOf(C.address)).toString()

    assert.equal(A_Balance, dec(150, 18))
    assert.equal(B_Balance, dec(100, 18))
    assert.equal(C_Balance, dec(50, 18))
  })

  it('totalSupply(): gets the total supply', async () => {
    const total = (await shadyTokenTester.totalSupply()).toString()
   
    assert.equal(total, dec(100, 24))
  })

  it("name(): returns the token's name", async () => {
    const name = await shadyTokenTester.name()
    assert.equal(name, "Shady")
  })

  it("symbol(): returns the token's symbol", async () => {
    const symbol = await shadyTokenTester.symbol()
    assert.equal(symbol, "SHADY")
  })

  /*it("version(): returns the token contract's version", async () => {
    const version = await shadyTokenTester.version()
    assert.equal(version, "1")
  })*/

  it("decimal(): returns the number of decimal digits used", async () => {
    const decimals = await shadyTokenTester.decimals()
    assert.equal(decimals.toString(), "18")
  })

  it("allowance(): returns an account's spending allowance for another account's balance", async () => {
    await mintToABC()

    await shadyTokenTester.connect(B).approve(A.address, dec(100, 18))

    const allowance_A = await shadyTokenTester.allowance(B.address, A.address)
    const allowance_D = await shadyTokenTester.allowance(B.address, D.address)

    assert.equal(allowance_A.toString(), dec(100, 18))
    assert.equal(allowance_D.toString(), '0')
  })

  it("approve(): approves an account to spend the specified ammount", async () => {
    await mintToABC()

    const allowance_A_before = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_before.toString(), '0')

    await shadyTokenTester.connect(B).approve(A.address, dec(100, 18))

    const allowance_A_after = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_after.toString(), dec(100, 18))
  })

  it("approve(): reverts when spender param is address(0)", async () => {
    await mintToABC()

    const txPromise = shadyTokenTester.connect(B).approve(ZERO_ADDRESS, dec(100, 18))
    await assertRevert(txPromise)
  })

  it("approve(): reverts when owner param is address(0)", async () => {
    await mintToABC()

    const txPromise = shadyTokenTester.connect(B).callInternalApprove(ZERO_ADDRESS, A.address, dec(100, 18))
    await assertRevert(txPromise)
  })

  it("transferFrom(): successfully transfers from an account which it is approved to transfer from", async () => {
    await mintToABC()

    const allowance_A_0 = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_0.toString(), '0')

    await shadyTokenTester.connect(B).approve(A.address, dec(50, 18))

    // Check A's allowance of B's funds has increased
    const allowance_A_1 = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_1.toString(), dec(50, 18))

    assert.equal((await shadyTokenTester.balanceOf(C.address)).toString(), dec(50, 18))

    // A transfers from B to C, using up her allowance
    await shadyTokenTester.connect(A).transferFrom(B.address, C.address, dec(50, 18))
    assert.equal((await shadyTokenTester.balanceOf(C.address)).toString(), dec(100, 18))

    // Check A's allowance of B's funds has decreased
    const allowance_A_2 = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_2.toString(), '0')

    // Check B's balance has decreased
    assert.equal((await shadyTokenTester.balanceOf(B.address)).toString(), dec(50, 18))

    // A tries to transfer more tokens from B's account to C than she's allowed
    const txPromise = shadyTokenTester.connect(A).transferFrom(B.address, C.address, dec(50, 18))
    await assertRevert(txPromise)
  })

  it("transfer(): increases the recipient's balance by the correct amount", async () => {
    await mintToABC()

    assert.equal((await shadyTokenTester.balanceOf(A.address)).toString(), dec(150, 18))

    await shadyTokenTester.connect(B).transfer(A.address, dec(37, 18))

    assert.equal((await shadyTokenTester.balanceOf(A.address)).toString(), dec(187, 18))
  })

  it("transfer(): reverts when amount exceeds sender's balance", async () => {
    await mintToABC()

    assert.equal((await shadyTokenTester.balanceOf(B.address)).toString(), dec(100, 18))

    const txPromise = shadyTokenTester.connect(B).transfer(A.address, dec(101, 18))
    await assertRevert(txPromise)
  })

  it('transfer(): transfer to a blacklisted address reverts', async () => {
    await mintToABC()

    await assertRevert(shadyTokenTester.connect(A).transfer(shadyTokenTester.address, 1))
    await assertRevert(shadyTokenTester.connect(A).transfer(ZERO_ADDRESS, 1))
    await assertRevert(shadyTokenTester.connect(A).transfer(communityIssuance.address, 1))
    await assertRevert(shadyTokenTester.connect(A).transfer(ve.address, 1))
  })

  it('transfer(): transfer to or from the zero-address reverts', async () => {
    await mintToABC()

    const txPromiseFromZero = shadyTokenTester.connect(B).callInternalTransfer(ZERO_ADDRESS, A.address, dec(100, 18))
    const txPromiseToZero = shadyTokenTester.connect(B).callInternalTransfer(A.address, ZERO_ADDRESS, dec(100, 18))
    await assertRevert(txPromiseFromZero)
    await assertRevert(txPromiseToZero)
  })

  it('mint(): issues correct amount of tokens to the given address', async () => {
    const A_balanceBefore = await shadyTokenTester.balanceOf(A.address)
    assert.equal(A_balanceBefore.toString(), '0')

    await shadyTokenTester.unprotectedMint(A.address, dec(100, 18))

    const A_BalanceAfter = await shadyTokenTester.balanceOf(A.address)
    assert.equal(A_BalanceAfter.toString(), dec(100, 18))
  })

  it('mint(): reverts when beneficiary is address(0)', async () => {
    const tx = shadyTokenTester.unprotectedMint(ZERO_ADDRESS, 100)
    await assertRevert(tx)
  })

  it("increaseAllowance(): increases an account's allowance by the correct amount", async () => {
    const allowance_A_Before = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_Before.toString(), '0')

    await shadyTokenTester.connect(B).increaseAllowance(A.address, dec(100, 18))

    const allowance_A_After = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(allowance_A_After.toString(), dec(100, 18))
  })

  it("decreaseAllowance(): decreases an account's allowance by the correct amount", async () => {
    await shadyTokenTester.connect(B).increaseAllowance(A.address, dec(100, 18))

    const A_allowance = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(A_allowance.toString(), dec(100, 18))

    await shadyTokenTester.connect(B).decreaseAllowance(A.address, dec(100, 18))

    const A_allowanceAfterDecrease = await shadyTokenTester.allowance(B.address, A.address)
    assert.equal(A_allowanceAfterDecrease.toString(), '0')
  })

  it('sendToSHADYStaking(): changes balances of SHADYStaking and calling account by the correct amounts', async () => {
    // mint some tokens to A
    await shadyTokenTester.unprotectedMint(A.address, dec(150, 18))

    // Check caller and SHADYStaking balance before
    const A_BalanceBefore = await shadyTokenTester.balanceOf(A.address)
    assert.equal(A_BalanceBefore.toString(), dec(150, 18))
    const lqtyStakingBalanceBefore = await shadyTokenTester.balanceOf(ve.address)
    assert.equal(lqtyStakingBalanceBefore.toString(), '0')

    await shadyTokenTester.connect(A).transfer(B.address, dec(37, 18))
    // await shadyTokenTester.unprotectedSendToVe(A.address, )

    // Check caller and SHADYStaking balance before
    const A_BalanceAfter = await shadyTokenTester.balanceOf(A.address)
    assert.equal(A_BalanceAfter.toString(), dec(113, 18))
    const lqtyStakingBalanceAfter = await shadyTokenTester.balanceOf(B.address)
    assert.equal(lqtyStakingBalanceAfter.toString(), dec(37, 18))
  })

  // EIP2612 tests

  it('Initializes DOMAIN_SEPARATOR correctly', async () => {
    assert.equal(await shadyTokenTester.domainSeparator(),
      getDomainSeparator(tokenName, shadyTokenTester.address, chainId, tokenVersion))
  })

  it('Initial nonce for a given address is 0', async function () {
    assert.equal(toBN(await shadyTokenTester.nonces(A.address)).toString(), '0');
  });

  it('permit(): permits and emits an Approval event (replay protected)', async () => {
    const deadline = 100000000000000

    // Approve it
    const { v, r, s, tx } = await buildPermitTx(deadline)
    const receipt = await (await tx).wait()
    // @ts-ignore
    const event = receipt.events[0]

    // Check that approval was successful
    assert.equal(event.event, 'Approval')
    assert.equal((await shadyTokenTester.nonces(approve.owner)).toNumber(), 1)
    assert.equal((await shadyTokenTester.allowance(approve.owner, approve.spender)).toNumber(), approve.value)

    // Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
    await assertRevert(shadyTokenTester.permit(
      approve.owner, approve.spender, approve.value,
      deadline, v, r, s), 'ERC20Permit: invalid signature')

    // Check that the zero address fails
    await assertRevert(shadyTokenTester.permit('0x0000000000000000000000000000000000000000',
      approve.spender, approve.value, deadline, '0x99', r, s), 'ECDSA: invalid signature')
  })

  it('permit(): fails with expired deadline', async () => {
    const deadline = 1

    const { v, r, s, tx } = await buildPermitTx(deadline)
    await assertRevert(tx, 'ERC20Permit: expired deadline')
  })

  it('permit(): fails with the wrong signature', async () => {
    const deadline = 100000000000000

    const { v, r, s } = await buildPermitTx(deadline)

    const tx = shadyTokenTester.permit(
      C.address, approve.spender, approve.value,  // Carol is passed as spender param, rather than Bob
      deadline, v, hexlify(r), hexlify(s)
    )

    await assertRevert(tx, 'ERC20Permit: invalid signature')
  })
})


