import {
    ActivePool,
    BorrowerOperations,
    CollSurplusPool, CommunityIssuance,
    DefaultPool, HintHelpers, LockupContractFactory, PriceFeedMock, SHADYToken, SIMToken, SortedTroves,
    StabilityPool,
    TroveManager, WSTETHMock, Ve, TroveManagerTester, BorrowerOperationsTester, SIMTokenTester
} from "../typechain-types";

export interface IContracts {
    troveManager: TroveManager|TroveManagerTester
    borrowerOperations: BorrowerOperations|BorrowerOperationsTester
    activePool: ActivePool
    stabilityPool: StabilityPool
    defaultPool: DefaultPool
    collSurplusPool: CollSurplusPool
    simToken: SIMToken|SIMTokenTester
    priceFeedMock: PriceFeedMock
    sortedTroves: SortedTroves
    hintHelpers: HintHelpers
    wstETHMock: WSTETHMock
}

export interface ISHADYContracts {
    shadyToken: SHADYToken
    communityIssuance: CommunityIssuance
    lockupContractFactory: LockupContractFactory
    ve: Ve
}

export interface IOpenTroveParams {
    maxFeePercentage?: any
    extraLUSDAmount?: any
    upperHint?: any
    lowerHint?: any
    ICR?: any
    extraParams?: any
}
