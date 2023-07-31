import {IContracts, ISHADYContracts} from "../utils/types";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {DeploymentHelper} from "../utils/DeploymentHelper";
import {assert, ethers, expect} from "hardhat";
import {
    IERC20Metadata__factory,
    PawnshopMock,
    SHADYTokenTester,
    Ve,
    WSTETHMock
} from "../typechain-types";
import {TestHelper} from "../utils/TestHelper";
import {formatUnits, parseUnits} from "ethers/lib/utils";
import {BigNumber} from "ethers";

// const {expect} = chai;
const th = TestHelper
const assertRevert = th.assertRevert
const WEEK = th.TimeValues.SECONDS_IN_ONE_WEEK;
const LOCK_PERIOD = 60 * 60 * 24 * 90;

describe('Ve', async () => {
    let multisig: string

    let contracts: IContracts
    let shadyContracts: ISHADYContracts
    let shady: SHADYTokenTester
    let ve: Ve
    let pawnshop: PawnshopMock
    let underlying2: WSTETHMock

    let owner:SignerWithAddress
    let owner2:SignerWithAddress
    let owner3:SignerWithAddress
    let multisigSigner: SignerWithAddress

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

    beforeEach(async () => {
        const f = await loadFixture(deploy);
        [owner, owner2, owner3] = f.f.signers
        contracts = f.f.contracts;
        shadyContracts = f.f.shadyContracts
        shady = shadyContracts.shadyToken as SHADYTokenTester
        ve = shadyContracts.ve
        multisig = shadyContracts.multisigAddress
        pawnshop = f.pawnshop
        underlying2 = f.f.contracts.wstETHMock
        multisigSigner = f.multisigSigner
    })


    it('erc721(): metadata', async () => {
        expect(await ve.symbol()).eq('xSHADY')
        expect(await ve.name()).eq('xSHADY')
    })

    it("init twice revert", async function () {
        await assertRevert(ve.setAddresses(th.ZERO_ADDRESS, th.ZERO_ADDRESS, th.ZERO_ADDRESS, th.ZERO_ADDRESS), 'Initializable: contract is already initialized')
    });

    it("token length test", async function () {
        assert.equal((await ve.tokensLength()).toNumber(), 1)
    });

    it("safeTransfer should revert", async function () {
        await assertRevert(ve["safeTransferFrom(address,address,uint256)"](owner.address, owner2.address, 1), 'FORBIDDEN')
    });

    it("double transfer with multiple tokens test", async function () {
        await ve.createLock(shady.address, parseUnits('1'), LOCK_PERIOD);
        await ve.createLock(shady.address, parseUnits('1'), LOCK_PERIOD);
        await pawnshop.doubleTransfer(ve.address, owner.address, pawnshop.address, 1)
    });

    it("transfer to non-support contract revert", async function () {
        await pawnshop.transfer(ve.address, owner.address, pawnshop.address, 1);
        await assertRevert(pawnshop.transfer(ve.address, pawnshop.address, shady.address, 1), 'ERC721: transfer to non ERC721Receiver implementer')
    });

    it("transfer from not owner revert", async function () {
        await shady.unprotectedMint(owner3.address, parseUnits('100'));
        await shady.connect(owner3).approve(ve.address, th.MAX_UINT);
        await ve.connect(owner3).createLock(shady.address, parseUnits('1'), LOCK_PERIOD);
        await assertRevert(pawnshop.transfer(ve.address, owner3.address, pawnshop.address, 3), 'NOT_OWNER')
    });

    it("balanceOfNft should be zero in the same block of transfer", async function () {
        expect((await pawnshop.callStatic.transferAndGetBalance(ve.address, owner.address, pawnshop.address, 1)).toNumber()).eq(0);
        await pawnshop.transferAndGetBalance(ve.address, owner.address, pawnshop.address, 1);
    });

    it("remove token from owner list for not current index test", async function () {
        await pawnshop.transfer(ve.address, owner.address, pawnshop.address, 1);
        await th.advanceNBlocks(1);
        await pawnshop.transfer(ve.address, pawnshop.address, owner.address, 1);
    });

    it("transferFrom not owner revert test", async function () {
        await assertRevert(pawnshop.transfer(ve.address, owner.address, pawnshop.address, 2), 'NOT_OWNER')
    });

    it("transferFrom zero dst revert test", async function () {
        await pawnshop.transfer(ve.address, owner.address, pawnshop.address, 1);
        await assertRevert(pawnshop.transfer(ve.address, pawnshop.address, th.ZERO_ADDRESS, 1), 'WRONG_INPUT')
    });

    it("transferFrom reset approves test", async function () {
        await ve.approve(owner2.address, 1);
        expect(await ve.isApprovedOrOwner(owner2.address, 1)).eq(true);
        await pawnshop.transfer(ve.address, owner.address, pawnshop.address, 1);
        expect(await ve.isApprovedOrOwner(owner2.address, 1)).eq(false);
    });

    it("transferFrom should revert", async function () {
        // @ts-ignore
        await assertRevert(ve.transferFrom(owner.address, pawnshop.address, 1), 'FORBIDDEN')
    });

    it("approve invalid id revert test", async function () {
        await assertRevert(ve.approve(owner2.address, 99), 'WRONG_INPUT')
    });

    it("approve from not owner revert", async function () {
        await assertRevert(ve.connect(owner2).approve(owner3.address, 1), 'NOT_OWNER')
    });

    it("approve self approve revert test", async function () {
        await assertRevert(ve.approve(owner.address, 1), 'IDENTICAL_ADDRESS')
    });

    it("setApprovalForAll operator is sender revert test", async function () {
        await assertRevert(ve.setApprovalForAll(owner.address, true), 'IDENTICAL_ADDRESS')
    });

    it("mint to zero dst revert test", async function () {
        await assertRevert(ve.createLockFor(shady.address, 1, LOCK_PERIOD, th.ZERO_ADDRESS), 'WRONG_INPUT')
    });

    it("increaseAmount for test", async function () {
        await ve.increaseAmount(shady.address, 1, parseUnits('1'));
    });

    it("create lock zero value revert", async function () {
        await assertRevert(ve.createLock(shady.address, 0, 1), 'WRONG_INPUT')
    });

    it("create lock zero period revert", async function () {
        await assertRevert(ve.createLock(shady.address, 1, 0), 'LOW_LOCK_PERIOD')
    });

    it("create lock too big period revert", async function () {
        await assertRevert(ve.createLock(shady.address, 1, 1e12), 'HIGH_LOCK_PERIOD')
    });

    it("increaseAmount zero value revert", async function () {
        await assertRevert(ve.increaseAmount(shady.address, 1, 0), 'WRONG_INPUT')
    });

    it("increaseAmount zero value revert", async function () {
        await assertRevert(ve.increaseAmount(underlying2.address, 1, 1), 'INVALID_TOKEN')
    });

    it("increaseAmount not locked revert", async function () {
        await th.fastForwardTime(LOCK_PERIOD * 2);
        await ve.withdraw(shady.address, 1);
        await assertRevert(ve.increaseAmount(shady.address, 1, 1), 'NFT_WITHOUT_POWER')
    });

    it("increaseAmount expired revert", async function () {
        await th.fastForwardTime(LOCK_PERIOD * 2);
        await assertRevert(ve.increaseAmount(shady.address, 1, 1), 'EXPIRED')
    });

    it("increaseUnlockTime not owner revert", async function () {
        await th.fastForwardTime(WEEK * 10);
        await assertRevert(ve.increaseUnlockTime(2, LOCK_PERIOD), 'NOT_OWNER')
    });

    it("increaseUnlockTime not locked revert", async function () {
        await th.fastForwardTime(LOCK_PERIOD * 2);
        await ve.withdraw(shady.address, 1);
        await assertRevert(ve.increaseUnlockTime(1, LOCK_PERIOD), 'NFT_WITHOUT_POWER')
    });

    it("withdraw not owner revert", async function () {
        await assertRevert(ve.withdraw(shady.address, 2), 'NOT_OWNER')
    });

    it("merge from revert", async function () {
        await assertRevert(ve.merge(1, 3), 'NOT_OWNER')
    });

    it("merge to revert", async function () {
        await assertRevert(ve.merge(3, 1), 'NOT_OWNER')
    });

    it("merge same revert", async function () {
        await assertRevert(ve.merge(1, 1), 'IDENTICAL_ADDRESS')
    });

    it("split zero percent revert", async function () {
        await assertRevert(ve.split(1, 0), "WRONG_INPUT")
    });

    it("split expired revert", async function () {
        await th.fastForwardTime(LOCK_PERIOD)
        await assertRevert(ve.split(1, 1), 'EXPIRED')
    });

    it("split withdrew revert", async function () {
        await th.fastForwardTime(LOCK_PERIOD)
        await ve.withdraw(shady.address, 1);
        await assertRevert(ve.split(1, 1), 'NOT_OWNER')
    });

    it("split too low percent revert", async function () {
        await assertRevert(ve.split(1, 1), "LOW_PERCENT")
    });

    it("split not owner revert", async function () {
        await assertRevert(ve.split(3, 1), "NOT_OWNER")
    });

    it("withdraw zero revert", async function () {
        await th.fastForwardTime(LOCK_PERIOD)
        await assertRevert(ve.withdraw(underlying2.address, 1), "ZERO_LOCKED");
    });

    it("withdraw not expired revert", async function () {
        await assertRevert(ve.withdraw(shady.address, 1), 'NOT_EXPIRED');
    });

    it("balanceOfNFT zero epoch test", async function () {
        expect((await ve.balanceOfNFT(99)).toNumber()).eq(0);
    });

    it("tokenURI for not exist revert", async function () {
        // @ts-ignore
        await assertRevert(ve.tokenURI(99), 'TOKEN_NOT_EXIST');
    });

    it("balanceOfNFTAt for new block revert", async function () {
        // @ts-ignore
        await assertRevert(ve.balanceOfAtNFT(1, Date.now() * 10), 'WRONG_INPUT');
    });

    it("totalSupplyAt for new block revert", async function () {
        // @ts-ignore
        await assertRevert(ve.totalSupplyAt(Date.now() * 10), 'WRONG_INPUT');
    });

    it("tokenUri for expired lock", async function () {
        await th.fastForwardTime(60 * 60 * 24 * 365 * 5);
        expect(await ve.tokenURI(1)).not.eq('');
    });

    it("totalSupplyAt for not exist epoch", async function () {
        expect((await ve.totalSupplyAt(0)).toNumber()).eq(0);
    });

    it("totalSupplyAt for first epoch", async function () {
        const start = (await ve.pointHistory(0)).blk;
        expect((await ve.totalSupplyAt(start)).toNumber()).eq(0);
        expect((await ve.totalSupplyAt(start.add(1))).toNumber()).eq(0);
    });

    it("totalSupplyAt for second epoch", async function () {
        const start = (await ve.pointHistory(1)).blk;
        expect(await ve.totalSupplyAt(start)).not.eq(0);
        expect(await ve.totalSupplyAt(start.add(1))).not.eq(0);
        const t = (await ve.pointHistory(1)).ts;
        expect((await ve.totalSupplyAtT(t.add(1))).toString()).not.eq('0');
    });

    it("checkpoint for a long period", async function () {
        await th.fastForwardTime(WEEK * 10);
        await ve.checkpoint();
    });

    it("balanceOfNFTAt with history test", async function () {
        const cp0 = (await ve.userPointHistory(2, 0));
        await ve.balanceOfAtNFT(2, cp0.blk);
        const cp1 = (await ve.userPointHistory(2, 1));
        await th.advanceNBlocks(1);
        await ve.balanceOfAtNFT(2, cp1.blk.add(1));
    });

    it("supportsInterface test", async function () {
        expect(await ve.supportsInterface('0x00000000')).is.eq(false);
    });

    it("supportsInterface positive test", async function () {
        expect(await ve.supportsInterface('0x01ffc9a7')).is.eq(true);
        expect(await ve.supportsInterface('0x80ac58cd')).is.eq(true);
        expect(await ve.supportsInterface('0x5b5e139f')).is.eq(true);
    });

    it("get_last_user_slope test", async function () {
        expect((await ve.getLastUserSlope(0)).toNumber()).is.eq(0);
    });

    it("user_point_history__ts test", async function () {
        expect((await ve.userPointHistoryTs(0, 0)).toNumber()).is.eq(0);
    });

    it("locked__end test", async function () {
        expect((await ve.lockedEnd(0)).toNumber()).is.eq(0);
    });

    it("balanceOf test", async function () {
        expect((await ve.balanceOf(owner.address)).toNumber()).is.eq(1);
    });

    it("getApproved test", async function () {
        expect(await ve.getApproved(owner.address)).is.eq(th.ZERO_ADDRESS);
    });

    it("isApprovedForAll test", async function () {
        expect(await ve.isApprovedForAll(owner.address, owner.address)).is.eq(false);
    });

    it("tokenOfOwnerByIndex test", async function () {
        expect((await ve.tokenOfOwnerByIndex(owner.address, 0)).toNumber()).is.eq(1);
    });

    it("setApprovalForAll test", async function () {
        await ve.setApprovalForAll(owner2.address, true);
    });

    it("increase_unlock_time test", async function () {
        await th.fastForwardTime(WEEK * 10);
        await ve.increaseUnlockTime(1, LOCK_PERIOD);
        await assertRevert(ve.increaseUnlockTime(1, LOCK_PERIOD * 2), 'HIGH_LOCK_PERIOD');
    });

    it("tokenURI test", async function () {
        await ve.createLock(shady.address, parseUnits('333'), LOCK_PERIOD);
        const uri = (await ve.tokenURI(3))
        console.log(uri);
        const base64 = uri.replace('data:application/json;base64,', '');
        console.log(base64);

        const uriJson = Buffer.from(base64, 'base64').toString('binary');
        console.log(uriJson);
        const imgBase64 = JSON.parse(uriJson).image.replace('data:image/svg+xml;base64,', '');
        console.log(imgBase64);
        const svg = Buffer.from(imgBase64, 'base64').toString('binary');
        console.log(svg);
        expect(svg).contains('333')
        // expect(svg).contains('88 days')
    });

    it("balanceOfNFTAt test", async function () {
        // @ts-ignore
        await assertRevert(ve.balanceOfNFTAt(1, 0), 'WRONG_INPUT');
        await ve.balanceOfNFTAt(1, 999_999_999_999);
    });

    it("ve flesh transfer + supply checks", async function () {
        await pawnshop.veFlashTransfer(ve.address, 1);
    });

    it("invalid token lock revert", async function () {
        await assertRevert(ve.createLock(owner.address, parseUnits('1'), LOCK_PERIOD), 'INVALID_TOKEN');
    });

    it("whitelist transfer not gov revert", async function () {
        await assertRevert(ve.connect(owner2).whitelistTransferFor(underlying2.address), 'FORBIDDEN');
    });

    it("whitelist transfer zero adr revert", async function () {
        await assertRevert(ve.whitelistTransferFor(th.ZERO_ADDRESS), 'WRONG_INPUT');
    });

    it("whitelist transfer time-lock revert", async function () {
        await ve.connect(multisigSigner).announceAction(2);
        await th.fastForwardTime(60 * 60 * 17);
        await assertRevert(ve.connect(multisigSigner).whitelistTransferFor(owner.address), 'TIME_LOCK');
    });

    it("add token from non gov revert", async function () {
        await assertRevert(ve.connect(owner2).addToken(underlying2.address, parseUnits('1')), 'FORBIDDEN');
    });

    it("announce from non gov revert", async function () {
        await assertRevert(ve.connect(owner2).announceAction(1), 'FORBIDDEN');
    });

    it("announce from wrong input revert", async function () {
        await assertRevert(ve.connect(multisigSigner).announceAction(0), 'WRONG_INPUT');
        await ve.connect(multisigSigner).announceAction(1);
        await assertRevert(ve.connect(multisigSigner).announceAction(1), 'WRONG_INPUT');
    });

    it("add token twice revert", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 18);
        await assertRevert(ve.connect(multisigSigner).addToken(shady.address, parseUnits('1')), 'WRONG_INPUT');
    });

    it("add token time-lock revert", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 17);
        await assertRevert(ve.connect(multisigSigner).addToken(shady.address, parseUnits('1')), 'TIME_LOCK');
    });

    it("add token wrong input revert", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 18);
        await assertRevert(ve.connect(multisigSigner).addToken(th.ZERO_ADDRESS, parseUnits('1')), 'WRONG_INPUT');
        await assertRevert(ve.connect(multisigSigner).addToken(underlying2.address, 0), 'WRONG_INPUT');
    });

    /*it("token wrong decimals revert", async function () {
        const controller = await DeployerUtils.deployMockController(owner);
        const logic = await DeployerUtils.deployContract(owner, 'VeTetu');
        const proxy = await DeployerUtils.deployContract(owner, 'ProxyControlled') as ProxyControlled;
        await proxy.initProxy(logic.address);
        await assertRevert(VeTetu__factory.connect(proxy.address, owner).init(
            underlying2.address,
            parseUnits('1'),
            controller.address
        ), 'Transaction reverted without a reason string')
    });*/

    it("deposit/withdraw test", async function () {
        let balshady = await shady.balanceOf(owner.address);

        await th.fastForwardTime(LOCK_PERIOD);

        await ve.withdraw(shady.address, 1)
        await ve.connect(owner2).withdraw(shady.address, 2);

        expect((await underlying2.balanceOf(ve.address)).toString()).eq('0');
        expect((await shady.balanceOf(ve.address)).toString()).eq('0');

        expect((await shady.balanceOf(owner.address)).toString()).eq(balshady.add(parseUnits('1')).toString());

        balshady = await shady.balanceOf(owner.address);
        const balUNDERLYING2 = await underlying2.balanceOf(owner.address);

        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 18);
        await ve.connect(multisigSigner).addToken(underlying2.address, parseUnits('10'));

        await ve.createLock(shady.address, parseUnits('0.77'), LOCK_PERIOD)
        await th.advanceNBlocks(5);
        await underlying2.approve(ve.address, th.MAX_UINT);
        await ve.increaseAmount(underlying2.address, 3, parseUnits('0.33'))
        expect((await underlying2.balanceOf(owner.address)).toString()).eq(balUNDERLYING2.sub(parseUnits('0.33')).toString());
        await ve.increaseAmount(underlying2.address, 3, parseUnits('0.37'))
        expect((await underlying2.balanceOf(owner.address)).toString()).eq(balUNDERLYING2.sub(parseUnits('0.7')).toString());

        expect(formatUnits(await ve.lockedDerivedAmount(3))).eq('0.84');
        expect(+formatUnits(await ve.balanceOfNFT(3))).above(0.6);

        await th.fastForwardTime(LOCK_PERIOD / 2);

        expect(+formatUnits(await ve.balanceOfNFT(3))).above(0.28); // the actual value is volatile...

        await th.fastForwardTime(LOCK_PERIOD / 2);

        await ve.withdrawAll(3);

        expect(await ve.ownerOf(3)).eq(th.ZERO_ADDRESS);

        expect((await underlying2.balanceOf(ve.address)).toString()).eq('0');
        expect((await shady.balanceOf(ve.address)).toString()).eq('0');

        expect((await underlying2.balanceOf(owner.address)).toString()).eq(balUNDERLYING2.toString());
        expect((await shady.balanceOf(owner.address)).toString()).eq(balshady.toString());
    });

    it("deposit/withdraw in a loop", async function () {
        // clear all locks
        await th.fastForwardTime(LOCK_PERIOD);
        await ve.withdraw(shady.address, 1)
        await ve.connect(owner2).withdraw(shady.address, 2);

        // prepare
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 18);
        await ve.connect(multisigSigner).addToken(underlying2.address, parseUnits('10'));
        await shady.unprotectedMint(owner2.address, parseUnits('1000000000'))
        await underlying2.mint(owner2.address, parseUnits('1000000000'))
        await underlying2.approve(ve.address, th.MAX_UINT);
        await underlying2.connect(owner2).approve(ve.address, th.MAX_UINT);

        const balTETUOwner1 = await shady.balanceOf(owner.address);
        const balUNDERLYING2Owner1 = await underlying2.balanceOf(owner.address);
        const balTETUOwner2 = await shady.balanceOf(owner2.address);
        const balUNDERLYING2Owner2 = await underlying2.balanceOf(owner2.address);

        const loops = 10;
        const lockDivider = Math.ceil(loops / 3);
        for (let i = 1; i < loops; i++) {
            let stakingToken;
            if (i % 2 === 0) {
                stakingToken = shady.address;
            } else {
                stakingToken = underlying2.address;
            }
            const dec = await IERC20Metadata__factory.connect(stakingToken, owner).decimals();
            const amount = parseUnits('0.123453', dec).mul(i);

            await depositOrWithdraw(
                owner,
                ve,
                stakingToken,
                amount,
                WEEK * Math.ceil(i / lockDivider)
            );
            await depositOrWithdraw(
                owner2,
                ve,
                stakingToken,
                amount,
                WEEK * Math.ceil(i / lockDivider)
            );
            await th.fastForwardTime(WEEK);
        }

        await th.fastForwardTime(LOCK_PERIOD);

        await withdrawIfExist(owner, ve, shady.address);
        await withdrawIfExist(owner, ve, underlying2.address);
        await withdrawIfExist(owner2, ve, shady.address);
        await withdrawIfExist(owner2, ve, underlying2.address);

        expect((await underlying2.balanceOf(ve.address)).toString()).eq('0');
        expect((await shady.balanceOf(ve.address)).toString()).eq('0');

        expect((await underlying2.balanceOf(owner.address)).toString()).eq(balUNDERLYING2Owner1.toString());
        expect((await shady.balanceOf(owner.address)).toString()).eq(balTETUOwner1.toString());
        expect((await underlying2.balanceOf(owner2.address)).toString()).eq(balUNDERLYING2Owner2.toString());
        expect((await shady.balanceOf(owner2.address)).toString()).eq(balTETUOwner2.toString());
    });

    it("merge test", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 24 * 30);
        await ve.connect(multisigSigner).addToken(underlying2.address, parseUnits('10'));
        await underlying2.mint(owner.address, parseUnits('100'));
        await underlying2.approve(ve.address, th.MAX_UINT);
        await ve.increaseAmount(underlying2.address, 1, parseUnits('1'))

        await ve.createLock(shady.address, parseUnits('1'), LOCK_PERIOD);

        const lock3 = await ve.lockedEnd(3);

        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('1.1').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('1').toString());

        await ve.merge(1, 3);

        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('0').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('2.1').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('2').toString());
        expect((await ve.lockedAmounts(3, underlying2.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedEnd(1)).toString()).eq('0');
        expect((await ve.lockedEnd(3)).toString()).eq(lock3.toString());
    });

    it("split test", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 24 * 30);
        await ve.connect(multisigSigner).addToken(underlying2.address, parseUnits('10'));
        await underlying2.mint(owner.address, parseUnits('100'));
        await underlying2.approve(ve.address, th.MAX_UINT);
        await ve.increaseAmount(underlying2.address, 1, parseUnits('1'))
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('1.1').toString());
        await ve.split(1, parseUnits('50'));

        const lock3 = await ve.lockedEnd(3);

        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('0.55').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('0.55').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedAmounts(3, underlying2.address)).toString()).eq(parseUnits('0.5').toString());

        await ve.merge(1, 3);
        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('0').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('1.1').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(3, underlying2.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedEnd(1)).toString()).eq('0');
        expect((await ve.lockedEnd(3)).toString()).eq(lock3.toString());
    });

    it("split without 2 und test", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 24 * 30);
        await ve.connect(multisigSigner).addToken(underlying2.address, parseUnits('10'));


        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('1').toString());

        await ve.split(1, parseUnits('50'));

        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('0.5').toString());
        expect((await ve.lockedAmounts(3, underlying2.address)).toString()).eq('0');
    });

    it("merge without und2 test", async function () {
        await ve.connect(multisigSigner).announceAction(1);
        await th.fastForwardTime(60 * 60 * 24 * 30);
        await ve.connect(multisigSigner).addToken(underlying2.address, parseUnits('10'));

        await ve.createLock(shady.address, parseUnits('1'), LOCK_PERIOD);

        const lock3 = await ve.lockedEnd(3);

        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq(parseUnits('1').toString());
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('1').toString());

        await ve.merge(1, 3);

        expect((await ve.lockedDerivedAmount(1)).toString()).eq(parseUnits('0').toString());
        expect((await ve.lockedDerivedAmount(3)).toString()).eq(parseUnits('2').toString());
        expect((await ve.lockedAmounts(1, shady.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(1, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedAmounts(3, shady.address)).toString()).eq(parseUnits('2').toString());
        expect((await ve.lockedAmounts(3, underlying2.address)).toString()).eq('0');
        expect((await ve.lockedEnd(1)).toString()).eq('0');
        expect((await ve.lockedEnd(3)).toString()).eq(lock3.toString());
    });

    it("merge with expired should revert test", async function () {

        await ve.createLock(shady.address, parseUnits('1'), 60 * 60 * 24 * 14);
        await ve.callStatic.merge(1, 3);

        await th.fastForwardTime(60 * 60 * 24 * 21)
        await assertRevert(ve.merge(1, 3), 'EXPIRED');
    });
})

async function depositOrWithdraw(
    owner: SignerWithAddress,
    ve: Ve,
    stakingToken: string,
    amount: BigNumber,
    lock: number,
) {
    const veIdLength = await ve.balanceOf(owner.address);
    expect(veIdLength.toNumber()).below(2);
    if (veIdLength.isZero()) {
        console.log('create lock')
        await ve.connect(owner).createLock(stakingToken, amount, lock);
    } else {
        const veId = await ve.tokenOfOwnerByIndex(owner.address, 0);
        const locked = await ve.lockedAmounts(veId, stakingToken);
        if (!locked.isZero()) {
            const lockEnd = (await ve.lockedEnd(veId)).toNumber();
            const now = (await ve.blockTimestamp()).toNumber()
            if (now >= lockEnd) {
                console.log('withdraw', veId.toNumber())
                await ve.connect(owner).withdraw(stakingToken, veId);
            } else {
                console.log('lock not ended yet', lockEnd, lockEnd - now, veId.toNumber());
            }
        } else {
            console.log('no lock for this token')
        }
    }
}

async function withdrawIfExist(
    owner: SignerWithAddress,
    ve: Ve,
    stakingToken: string
) {
    const veIdLength = await ve.balanceOf(owner.address);
    expect(veIdLength.toNumber()).below(2);
    if (!veIdLength.isZero()) {
        const veId = await ve.tokenOfOwnerByIndex(owner.address, 0);
        const locked = await ve.lockedAmounts(veId, stakingToken);
        if (!locked.isZero()) {
            const lockEnd = (await ve.lockedEnd(veId)).toNumber();
            const now = (await ve.blockTimestamp()).toNumber()
            if (now >= lockEnd) {
                console.log('withdraw', veId.toNumber())
                await ve.connect(owner).withdraw(stakingToken, veId);
            }
        }
    }
}
