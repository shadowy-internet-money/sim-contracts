import {IContracts, ISHADYContracts} from "./types";
import {ethers} from "hardhat";
import {
    ActivePool,
    BorrowerOperations,
    CollSurplusPool,
    DefaultPool,
    HintHelpers,
    LockupContractFactory,
    PriceFeedMock,
    SIMToken,
    SortedTroves,
    StabilityPool,
    TroveManager,
    WSTETHMock,
    TroveManagerTester,
    BorrowerOperationsTester,
    SIMTokenTester,
    CommunityIssuanceTester,
    LiquidityRewardsIssuance, SHADYTokenTester, VeTester
} from "../typechain-types";
import {TestHelper} from "./TestHelper";

export class DeploymentHelper {
    static async deploySHADY(bountyAddress: string, multisigAddress: string): Promise<ISHADYContracts> {
        const
            communityIssuance = await (await ethers.getContractFactory("CommunityIssuanceTester")).deploy() as CommunityIssuanceTester,
            liquidityRewardsIssuance = await (await ethers.getContractFactory("LiquidityRewardsIssuance")).deploy() as LiquidityRewardsIssuance,
            lockupContractFactory = await (await ethers.getContractFactory("LockupContractFactory")).deploy() as LockupContractFactory,
            ve = await (await ethers.getContractFactory("VeTester")).deploy() as VeTester

        return {
            communityIssuance,
            liquidityRewardsIssuance,
            lockupContractFactory,
            ve,
            shadyToken: await (await ethers.getContractFactory("SHADYTokenTester")).deploy(
                communityIssuance.address,
                liquidityRewardsIssuance.address,
                ve.address,
                lockupContractFactory.address,
                bountyAddress,
                multisigAddress
            ) as SHADYTokenTester,
        }
    }

    static async connectSHADYContracts(shadyContracts: ISHADYContracts) {
        await shadyContracts.lockupContractFactory.setSHADYTokenAddress(shadyContracts.shadyToken.address)
    }

    static async deployCore(): Promise<IContracts> {
        const
            troveManager = await (await ethers.getContractFactory("TroveManager")).deploy() as TroveManager,
            stabilityPool = await (await ethers.getContractFactory("StabilityPool")).deploy() as StabilityPool,
            borrowerOperations = await (await ethers.getContractFactory("BorrowerOperations")).deploy() as BorrowerOperations

        return {
            troveManager,
            borrowerOperations,
            stabilityPool,
            activePool: await (await ethers.getContractFactory("ActivePool")).deploy() as ActivePool,
            defaultPool: await (await ethers.getContractFactory("DefaultPool")).deploy() as DefaultPool,
            collSurplusPool: await (await ethers.getContractFactory("CollSurplusPool")).deploy() as CollSurplusPool,
            hintHelpers: await (await ethers.getContractFactory("HintHelpers")).deploy() as HintHelpers,
            sortedTroves: await (await ethers.getContractFactory("SortedTroves")).deploy() as SortedTroves,
            priceFeedMock: await (await ethers.getContractFactory("PriceFeedMock")).deploy() as PriceFeedMock,
            simToken: await (await ethers.getContractFactory("SIMToken")).deploy(troveManager.address, stabilityPool.address, borrowerOperations.address) as SIMToken,
            wstETHMock: await (await ethers.getContractFactory("WSTETHMock")).deploy() as WSTETHMock,
        }
    }

    static async connectCoreContracts(contracts: IContracts, shadyContracts: ISHADYContracts) {
        const maxBytes32 = '0x' + 'f'.repeat(64)

        await contracts.sortedTroves.setParams(
            maxBytes32,
            contracts.troveManager.address,
            contracts.borrowerOperations.address
        )

        await contracts.troveManager.setAddresses(
            contracts.borrowerOperations.address,
            contracts.activePool.address,
            contracts.defaultPool.address,
            contracts.stabilityPool.address,
            contracts.collSurplusPool.address,
            contracts.priceFeedMock.address,
            contracts.simToken.address,
            contracts.sortedTroves.address,
            shadyContracts.shadyToken.address,
            shadyContracts.ve.address
        )

        await contracts.borrowerOperations.setAddresses(
            contracts.wstETHMock.address,
            contracts.troveManager.address,
            contracts.activePool.address,
            contracts.defaultPool.address,
            contracts.stabilityPool.address,
            contracts.collSurplusPool.address,
            contracts.priceFeedMock.address,
            contracts.sortedTroves.address,
            contracts.simToken.address,
            shadyContracts.ve.address
        )

        await contracts.stabilityPool.setAddresses(
            contracts.wstETHMock.address,
            contracts.borrowerOperations.address,
            contracts.troveManager.address,
            contracts.activePool.address,
            contracts.simToken.address,
            contracts.sortedTroves.address,
            contracts.priceFeedMock.address,
            shadyContracts.communityIssuance.address
        )

        await contracts.activePool.setAddresses(
            contracts.wstETHMock.address,
            contracts.borrowerOperations.address,
            contracts.troveManager.address,
            contracts.stabilityPool.address,
            contracts.defaultPool.address,
            contracts.collSurplusPool.address
        )

        await contracts.defaultPool.setAddresses(
            contracts.wstETHMock.address,
            contracts.troveManager.address,
            contracts.activePool.address,
        )

        await contracts.collSurplusPool.setAddresses(
            contracts.wstETHMock.address,
            contracts.borrowerOperations.address,
            contracts.troveManager.address,
            contracts.activePool.address,
        )

        await contracts.hintHelpers.setAddresses(
            contracts.sortedTroves.address,
            contracts.troveManager.address
        )
    }

    static async connectSHADYContractsToCore(shadyContracts: ISHADYContracts, coreContracts: IContracts) {
        // todo connect ve

        await shadyContracts.communityIssuance.setAddresses(
            shadyContracts.shadyToken.address,
            coreContracts.stabilityPool.address
        )
    }

    static async deployFixture() {
        const signers = await ethers.getSigners();
        const [bountyAddress, lpRewardsAddress, multisig] = [signers[17].address, signers[18].address,signers[19].address]
        const contracts = await DeploymentHelper.deployCore()
        contracts.troveManager = await (await ethers.getContractFactory("TroveManagerTester")).deploy() as TroveManagerTester
        contracts.borrowerOperations = await (await ethers.getContractFactory("BorrowerOperationsTester")).deploy() as BorrowerOperationsTester
        contracts.simToken = await (await ethers.getContractFactory("SIMTokenTester")).deploy(contracts.troveManager.address, contracts.stabilityPool.address, contracts.borrowerOperations.address) as SIMTokenTester
        const shadyContracts = await DeploymentHelper.deploySHADY(bountyAddress, multisig)
        await DeploymentHelper.connectSHADYContracts(shadyContracts)
        await DeploymentHelper.connectCoreContracts(contracts, shadyContracts)
        await DeploymentHelper.connectSHADYContractsToCore(shadyContracts, contracts)

        await TestHelper.mintWSTETH(contracts.wstETHMock, signers.map(s => s.address))

        return {contracts, shadyContracts, signers, bountyAddress, lpRewardsAddress, multisig}
    }
}