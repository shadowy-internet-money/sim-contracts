import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Controller, Controller__factory, ProxyControlled, ProxyControlled__factory} from "../typechain-types";
import {TestHelper} from "../utils/TestHelper";
import {ethers, expect} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";


const th = TestHelper
const assertRevert = th.assertRevert
const LOCK = 60 * 60 * 48;

describe("controller tests", function () {
  let multisigSigner: SignerWithAddress
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;

  let controller: Controller;

  const deploy = async () => {
    const signers = await ethers.getSigners();
    const controllerLogic = await (await ethers.getContractFactory("Controller")).deploy() as Controller
    const controllerProxy = await (await ethers.getContractFactory("ProxyControlled")).deploy() as ProxyControlled
    await controllerProxy.initProxy(controllerLogic.address)
    const controller = Controller__factory.connect(controllerProxy.address, (await ethers.getSigners())[0])

    const multisig = signers[10].address
    await controller.init(multisig)

    return {
      signers,
      controller,
      multisig,
      multisigSigner: signers[10]
    }
  }

  beforeEach(async function () {
    const f = await loadFixture(deploy);
    [signer, signer2, signer3] = f.signers
    controller = f.controller
    multisigSigner = f.multisigSigner
  });


  // ********** ADDRESS CHANGE *****

  it("change governance test", async function () {
    await controller.connect(multisigSigner).announceAddressChange(1, signer2.address);
    expect((await controller.addressAnnouncesList())[0]._type.toNumber()).eq(1)
    expect((await controller.addressAnnouncesList())[0].newAddress).eq(signer2.address)
    expect((await controller.addressAnnouncesList())[0].timeLockAt.toNumber()).above(0)
    await th.fastForwardTime(LOCK);
    await controller.connect(multisigSigner).changeAddress(1);
    expect(await controller.governance()).eq(signer2.address);
    expect((await controller.addressAnnouncesList()).length).eq(0)
  });

  it("remove address announce test", async function () {
    await controller.connect(multisigSigner).announceAddressChange(1, signer2.address);
    await controller.connect(multisigSigner).removeAddressAnnounce(1);
    expect((await controller.addressAnnouncesList()).length).eq(0)
  });

  it("change address already announced revert", async function () {
    await controller.connect(multisigSigner).announceAddressChange(1, signer2.address);
    await assertRevert(controller.announceAddressChange(1, signer2.address), 'ANNOUNCED');
  });

  it("change address not announced revert", async function () {
    await assertRevert(controller.connect(multisigSigner).changeAddress(1), 'EnumerableMap: nonexistent key');
  });

  it("change address unknown revert", async function () {
    await controller.connect(multisigSigner).announceAddressChange(0, signer2.address);
    await assertRevert(controller.connect(multisigSigner).changeAddress(0), 'UNKNOWN');
  });

  it("change address too early revert", async function () {
    await controller.connect(multisigSigner).announceAddressChange(1, signer2.address);
    await assertRevert(controller.changeAddress(1), 'LOCKED');
  });

  it("announce zero address revert", async function () {
    await assertRevert(controller.announceAddressChange(1, th.ZERO_ADDRESS), 'ZERO_VALUE');
  });

  it("announce not gov revert", async function () {
    await assertRevert(controller.connect(signer2).announceAddressChange(1, th.ZERO_ADDRESS), 'DENIED');
  });

  it("change adr not gov revert", async function () {
    await assertRevert(controller.connect(signer2).changeAddress(1), 'DENIED');
  });

  it("remove adr announce not gov revert", async function () {
    await assertRevert(controller.connect(signer2).removeAddressAnnounce(1), 'DENIED');
  });

  // ********** PROXY UPDATE *****

  it("proxy upgrade test", async function () {
    const logic = await (await ethers.getContractFactory("Controller")).deploy() as Controller
    await controller.connect(multisigSigner).announceProxyUpgrade([controller.address], [logic.address]);
    expect((await controller.proxyAnnouncesList())[0].proxy).eq(controller.address)
    expect((await controller.proxyAnnouncesList())[0].implementation).eq(logic.address)
    expect((await controller.proxyAnnouncesList())[0].timeLockAt.toNumber()).above(0)
    await th.fastForwardTime(LOCK);
    await controller.connect(multisigSigner).upgradeProxy([controller.address]);
    expect(await ProxyControlled__factory.connect(controller.address, signer).implementation()).eq(logic.address);
    expect((await controller.proxyAnnouncesList()).length).eq(0)
  });

  it("proxy upgrade already announcer revert", async function () {
    await controller.connect(multisigSigner).announceProxyUpgrade([controller.address], [signer2.address]);
    await assertRevert(controller.connect(multisigSigner).announceProxyUpgrade([controller.address], [signer2.address]), 'ANNOUNCED');
  });

  it("remove proxy announce test", async function () {
    await controller.connect(multisigSigner).announceProxyUpgrade([controller.address], [signer2.address]);
    await controller.connect(multisigSigner).removeProxyAnnounce(controller.address);
    expect((await controller.proxyAnnouncesList()).length).eq(0)
    expect(await controller.proxyAnnounces(controller.address)).eq(th.ZERO_ADDRESS)
  });

  it("proxy upgrade not announced revert", async function () {
    await assertRevert(controller.connect(multisigSigner).upgradeProxy([controller.address]), 'EnumerableMap: nonexistent key');
  });

  it("proxy upgrade zero adr revert", async function () {
    await assertRevert(controller.connect(multisigSigner).announceProxyUpgrade([controller.address], [th.ZERO_ADDRESS]), 'ZERO_IMPL');
  });

  it("proxy upgrade early revert", async function () {
    await controller.connect(multisigSigner).announceProxyUpgrade([controller.address], [signer2.address]);
    await assertRevert(controller.connect(multisigSigner).upgradeProxy([controller.address]), 'LOCKED');
  });

  it("announce proxy not gov revert", async function () {
    await assertRevert(controller.connect(signer2).announceProxyUpgrade([], []), 'DENIED');
  });

  it("change adr not gov revert", async function () {
    await assertRevert(controller.connect(signer2).upgradeProxy([]), 'DENIED');
  });

  it("remove proxy announce not gov revert", async function () {
    await assertRevert(controller.connect(signer2).removeProxyAnnounce(signer.address), 'DENIED');
  });
});
