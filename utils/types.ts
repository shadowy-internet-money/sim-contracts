import {
    ActivePool,
    BorrowerOperations,
    CollSurplusPool,
    CommunityIssuance,
    DefaultPool,
    HintHelpers,
    LockupContractFactory,
    PriceFeedMock,
    SHADYToken,
    SIMToken,
    SortedTroves,
    StabilityPool,
    TroveManager,
    WSTETHMock,
    Ve,
    TroveManagerTester,
    BorrowerOperationsTester,
    SIMTokenTester,
    CommunityIssuanceTester,
    LiquidityRewardsIssuance, SHADYTokenTester
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
    shadyToken: SHADYToken|SHADYTokenTester
    communityIssuance: CommunityIssuance|CommunityIssuanceTester
    liquidityRewardsIssuance: LiquidityRewardsIssuance
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

export interface IWithdrawSIMParams {
    maxFeePercentage?: any
    lusdAmount?: any
    ICR?: any
    upperHint?: any
    lowerHint?: any
    extraParams?: any
}