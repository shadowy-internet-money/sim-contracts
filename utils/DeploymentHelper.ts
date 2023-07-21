import {IContracts, ISHADYContracts} from "./types";
import {ethers} from "hardhat";
import {
    ActivePool,
    BorrowerOperations,
    CollSurplusPool, CommunityIssuance,
    DefaultPool, HintHelpers, LockupContractFactory, PriceFeedMock, SIMToken, SortedTroves,
    StabilityPool,
    TroveManager, WSTETHMock, Ve, SHADYToken
} from "../typechain-types";

export class DeploymentHelper {
    static async deploySHADY(bountyAddress: string, lpRewardsAddress: string, multisigAddress: string): Promise<ISHADYContracts> {
        const
            communityIssuance = await (await ethers.getContractFactory("CommunityIssuance")).deploy() as CommunityIssuance,
            lockupContractFactory = await (await ethers.getContractFactory("LockupContractFactory")).deploy() as LockupContractFactory,
            ve = await (await ethers.getContractFactory("Ve")).deploy() as Ve

        return {
            communityIssuance,
            lockupContractFactory,
            ve,
            shadyToken: await (await ethers.getContractFactory("SHADYToken")).deploy(
                communityIssuance.address,
                ve.address,
                lockupContractFactory.address,
                bountyAddress,
                lpRewardsAddress,
                multisigAddress
            ) as SHADYToken,
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
            contracts.defaultPool.address
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
}