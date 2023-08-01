import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {assert, ethers, expect} from "hardhat";
import {parseUnits} from "ethers/lib/utils";
import {TestHelper} from "../utils/TestHelper";
import {IContracts, ISHADYContracts} from "../utils/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {
  PawnshopMock,
  SHADYTokenTester,
  VeDistributor,
  Ve,
  VeTester,
  VeLogo,
  ProxyControlled,
  VeTester__factory, VeDistributor__factory, SIMTokenTester
} from "../typechain-types";
import {BigNumber} from "ethers";


const WEEK = 60 * 60 * 24 * 7;
const LOCK_PERIOD = 60 * 60 * 24 * 90;

const th = TestHelper
const assertRevert = th.assertRevert
describe("Ve distributor tests", function () {
  let contracts: IContracts
  let shadyContracts: ISHADYContracts
  let owner: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let multisigSigner: SignerWithAddress
  let shady: SHADYTokenTester;

  let ve: Ve;
  let pawnshop: PawnshopMock;
  let veDist: VeDistributor;
  let simToken: SIMTokenTester;

  const deploy = async () => {
    const f = await loadFixture(DeploymentHelper.deployFixture);

    const pawnshop =  await (await ethers.getContractFactory("PawnshopMock")).deploy() as PawnshopMock
    const multisigSigner = await th.impersonate(f.multisig)
    await f.shadyContracts.ve.connect(multisigSigner).announceAction(2)
    await th.fastForwardTime(60 * 60 * 18 + 1)
    await f.shadyContracts.ve.connect(multisigSigner).whitelistTransferFor(pawnshop.address);
    const shadyToken = f.shadyContracts.shadyToken as SHADYTokenTester
    await shadyToken.unprotectedMint(f.signers[0].address, parseUnits('100000'))
    await shadyToken.unprotectedMint(f.signers[1].address, parseUnits('100'))
    await shadyToken.approve(f.shadyContracts.ve.address, th.MAX_UINT)
    await shadyToken.connect(f.signers[1]).approve(f.shadyContracts.ve.address, th.MAX_UINT)
    await f.shadyContracts.ve.createLock(shadyToken.address, parseUnits('1'), LOCK_PERIOD);
    await f.shadyContracts.ve.connect(f.signers[1]).createLock(shadyToken.address, parseUnits('1'), LOCK_PERIOD);
    await f.shadyContracts.ve.setApprovalForAll(pawnshop.address, true);
    await f.shadyContracts.ve.connect(f.signers[1]).setApprovalForAll(pawnshop.address, true);

    return {
      f,
      pawnshop,
      multisigSigner,
    }
  }

  const deployNewVe = async (signer: SignerWithAddress, controllerAddress: string, shadyAddress: string) => {
    const veLogoLib = await (await ethers.getContractFactory("VeLogo")).deploy() as VeLogo
    const veLogic = await (await ethers.getContractFactory("VeTester", {
      libraries: {
        'VeLogo': veLogoLib.address,
      }
    })).deploy() as VeTester
    const veProxy = await (await ethers.getContractFactory("ProxyControlled")).deploy() as ProxyControlled
    await veProxy.initProxy(veLogic.address)
    const ve = VeTester__factory.connect(veProxy.address, signer)
    await ve.setAddresses(contracts.troveManager.address, contracts.borrowerOperations.address, shadyAddress, controllerAddress)
    return ve
  }

  const deployNewVeDist = async (signer: SignerWithAddress, controllerAddress: string, veAddress: string, rewardTokenAddress: string) => {
    const veDistributorLogic = await (await ethers.getContractFactory("VeDistributor")).deploy() as VeDistributor
    const veDistributorProxy = await (await ethers.getContractFactory("ProxyControlled")).deploy() as ProxyControlled
    await veDistributorProxy.initProxy(veDistributorLogic.address)
    const veDistributor = VeDistributor__factory.connect(veDistributorProxy.address, signer)
    await veDistributor.init(controllerAddress, veAddress, rewardTokenAddress)
    return veDistributor
  }

  beforeEach(async () => {
    const f = await loadFixture(deploy);
    [owner, owner2, owner3] = f.f.signers
    contracts = f.f.contracts;
    shadyContracts = f.f.shadyContracts
    shady = shadyContracts.shadyToken as SHADYTokenTester
    ve = shadyContracts.ve
    // multisig = shadyContracts.multisigAddress
    pawnshop = f.pawnshop
    // underlying2 = f.f.contracts.wstETHMock
    multisigSigner = f.multisigSigner
    veDist = f.f.shadyContracts.simVeDistributor
    simToken = f.f.contracts.simToken as SIMTokenTester
  })

  it("veForAt test", async function () {
    expect((await veDist.veForAt(1, 0)).toNumber()).is.eq(0);
    assert.isTrue((await veDist.veForAt(1, (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp)).gt(0))
    await th.fastForwardTime(WEEK + 123);
    assert.isTrue((await veDist.veForAt(1, (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp)).gt(0))
  });

  it("multi checkpointToken with empty balance test", async function () {
    await shady.transfer(veDist.address, parseUnits('10'));
    await veDist.checkpoint();
    await veDist.checkpoint();
  });

  it("adjustToDistribute test", async function () {
    expect((await veDist.adjustToDistribute(100, 1, 1, 20)).toNumber()).eq(100);
    expect((await veDist.adjustToDistribute(100, 0, 1, 20)).toNumber()).eq(100);
    expect((await veDist.adjustToDistribute(100, 2, 1, 20)).toNumber()).eq(5);
  });

  it("checkpointTotalSupply dummy test", async function () {
    await ve.checkpoint();
    await veDist.checkpointTotalSupply();
    await th.fastForwardTime(WEEK * 2);
    await ve.checkpoint();
    await th.fastForwardTime(WEEK * 2);
    await ve.checkpoint();
    await th.fastForwardTime(WEEK * 2);
    await ve.checkpoint();
    await veDist.checkpointTotalSupply();
  });

  it("adjustVeSupply test", async function () {
    expect((await veDist.adjustVeSupply(100, 100, 5, 10)).toNumber()).eq(5);
    expect((await veDist.adjustVeSupply(99, 100, 5, 10)).toNumber()).eq(0);
    expect((await veDist.adjustVeSupply(200, 100, 5, 10)).toNumber()).eq(0);
    expect((await veDist.adjustVeSupply(2, 1, 20, 5)).toNumber()).eq(15);
    expect((await veDist.adjustVeSupply(3, 1, 20, 5)).toNumber()).eq(10);
  });

  it("claim for non exist token test", async function () {
    await veDist.claim(99);
  });

  it("claim without rewards test", async function () {
    await veDist.claim(1);
  });

  it("claim for early token test", async function () {
    const ve1 = await deployNewVe(owner, shadyContracts.controller.address, shadyContracts.shadyToken.address)
    await shady.approve(ve1.address, parseUnits('10000'))
    await ve1.createLock(shady.address, parseUnits('1'), 60 * 60 * 24 * 14);
    await th.fastForwardTime(WEEK * 2);
    const veDist1 = await deployNewVeDist(owner, shadyContracts.controller.address, ve1.address, contracts.simToken.address)
    await simToken.unprotectedMint(veDist1.address, parseUnits('1'))
    await veDist1.checkpoint();
    await veDist1.claim(1);
  });

  it("claimMany for early token test", async function () {
    const ve1 = await deployNewVe(owner, shadyContracts.controller.address, shadyContracts.shadyToken.address)
    await shady.approve(ve1.address, parseUnits('10000'))
    await ve1.createLock(shady.address, parseUnits('1'), 60 * 60 * 24 * 14);
    await th.fastForwardTime(WEEK * 2);
    const veDist1 = await deployNewVeDist(owner, shadyContracts.controller.address, ve1.address, contracts.simToken.address)
    await simToken.unprotectedMint(veDist1.address, parseUnits('1'))
    await veDist1.checkpoint();
    await veDist1.claimMany([1]);
  });

  it("claim for early token with delay test", async function () {
    const ve1 = await deployNewVe(owner, shadyContracts.controller.address, shadyContracts.shadyToken.address)
    await shady.approve(ve1.address, parseUnits('10000'))
    await ve1.createLock(shady.address, parseUnits('1'), 60 * 60 * 24 * 14);
    await th.fastForwardTime(WEEK * 2);
    const veDist1 = await deployNewVeDist(owner, shadyContracts.controller.address, ve1.address, contracts.simToken.address)
    await simToken.unprotectedMint(veDist1.address, parseUnits('1'))
    await veDist1.checkpoint();
    await th.fastForwardTime(WEEK * 2);
    await veDist1.claim(1);
    await veDist1.claimMany([1]);
  });

  it("claimMany for early token with delay test", async function () {
    const ve1 = await deployNewVe(owner, shadyContracts.controller.address, shadyContracts.shadyToken.address)
    await shady.approve(ve1.address, parseUnits('10000'))
    await ve1.createLock(shady.address, parseUnits('1'), 60 * 60 * 24 * 14);
    await th.fastForwardTime(WEEK * 2);
    const veDist1 = await deployNewVeDist(owner, shadyContracts.controller.address, ve1.address, contracts.simToken.address)
    await simToken.unprotectedMint(veDist1.address, parseUnits('1'))
    await veDist1.checkpoint();
    await th.fastForwardTime(WEEK * 2);
    await veDist1.claimMany([1]);
  });

  it("claim with rewards test", async function () {
    await ve.createLock(shady.address, WEEK * 2, LOCK_PERIOD);

    await th.fastForwardTime(WEEK * 2);

    await shady.transfer(veDist.address, parseUnits('1'));
    await veDist.checkpoint();
    await veDist.checkpointTotalSupply();
    await veDist.claim(2);
  });

  it("claim without checkpoints after the launch should return zero", async function () {
    await ve.createLock(shady.address, parseUnits('1'), LOCK_PERIOD);
    const maxUserEpoch = await ve.userPointEpoch(2)
    const startTime = await veDist.startTime();
    let weekCursor = await veDist.timeCursorOf(2);
    let userEpoch;
    if (weekCursor.isZero()) {
      userEpoch = await veDist.findTimestampUserEpoch(ve.address, 2, startTime, maxUserEpoch);
    } else {
      userEpoch = await veDist.userEpochOf(2);
    }
    if (userEpoch.isZero()) {
      userEpoch = BigNumber.from(1);
    }
    const userPoint = await ve.userPointHistory(2, userEpoch);
    if (weekCursor.isZero()) {
      weekCursor = userPoint.ts.add(WEEK).sub(1).div(WEEK).mul(WEEK);
    }
    const lastTokenTime = await veDist.lastTokenTime();
    expect(weekCursor.gte(lastTokenTime)).eq(true);
  });

  it("claim with rewards with minimal possible amount and lock", async function () {
    await ve.createLock(shady.address, LOCK_PERIOD, WEEK);

    await th.fastForwardTime(WEEK * 2);
    await simToken.unprotectedMint(veDist.address, parseUnits('1'))
    await veDist.checkpoint();
    await veDist.checkpointTotalSupply();

    await th.fastForwardTime(WEEK * 2);

    let bal = await ve.balanceOfNFT(2)
    expect(bal.gt(0)).eq(true)

    let balBefore = await simToken.balanceOf(owner2.address)
    await veDist.claim(2);
    let balAfter = await simToken.balanceOf(owner2.address)
    expect(balAfter.sub(balBefore).gt(0)).eq(true)

    // SECOND CLAIM

    await simToken.unprotectedMint(veDist.address, parseUnits('10000'))
    await veDist.checkpoint();

    await th.fastForwardTime(123456);

    balBefore = await simToken.balanceOf(owner2.address)
    await veDist.claim(2);
    balAfter = await simToken.balanceOf(owner2.address)
    expect(balAfter.sub(balBefore).gt(0)).eq(true)
  });

  it("claimMany on old block test", async function () {
    await ve.createLock(shady.address, LOCK_PERIOD, WEEK);
    await veDist.claimMany([1, 2, 0]);
  });

  it("timestamp test", async function () {
    expect((await veDist.timestamp()).toNumber()).above(0);
  });

  it("claimable test", async function () {
    await ve.createLock(shady.address, parseUnits('1'), WEEK);
    expect((await veDist.claimable(1)).toNumber()).eq(0);
  });

  it("claimMany test", async function () {
    await ve.createLock(shady.address, parseUnits('1'), WEEK);

    await th.fastForwardTime(WEEK * 2);

    await simToken.unprotectedMint(veDist.address, parseUnits('10000'))
    await veDist.checkpoint();

    await th.fastForwardTime(WEEK * 2);

    expect((await veDist.claimable(1)).gt(0)).eq(true);

    const balBefore = await simToken.balanceOf(owner.address)
    await veDist.claimMany([1]);

    const balAfter = await simToken.balanceOf(owner.address)
    expect(balAfter.sub(balBefore).gt(0)).eq(true)
  });

  it("calculateToDistribute with zero values test", async function () {
    await veDist.calculateToDistribute(
      0,
      0,
      999,
      {
        bias: 0,
        slope: 0,
        ts: 0,
        blk: 0,
      },
      1,
      0,
      ve.address
    );
  });

  it("claim with other unclaimed rewards", async function () {
//todo
  });


});
