import {IContracts, IOpenTroveParams, IWithdrawSIMParams} from "./types";
import {
    LockupContract__factory,
    TroveManagerTester,
    WSTETHMock,
} from "../typechain-types";
import {assert, ethers} from "hardhat";
import {Event, BigNumber, ContractTransaction} from "ethers";
import {parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

export class TestHelper {
    static ZERO_ADDRESS = '0x' + '0'.repeat(40)
    static maxBytes32 = '0x' + 'f'.repeat(64)
    static _100pct = '1000000000000000000'
    static latestRandomSeed = BigNumber.from(31337)

    static TimeValues = {
        SECONDS_IN_ONE_MINUTE:  60,
        SECONDS_IN_ONE_HOUR:    60 * 60,
        SECONDS_IN_ONE_DAY:     60 * 60 * 24,
        SECONDS_IN_ONE_WEEK:    60 * 60 * 24 * 7,
        SECONDS_IN_SIX_WEEKS:   60 * 60 * 24 * 7 * 6,
        SECONDS_IN_ONE_MONTH:   60 * 60 * 24 * 30,
        SECONDS_IN_ONE_YEAR:    60 * 60 * 24 * 365,
        MINUTES_IN_ONE_WEEK:    60 * 24 * 7,
        MINUTES_IN_ONE_MONTH:   60 * 24 * 30,
        MINUTES_IN_ONE_YEAR:    60 * 24 * 365
    }

    static dec(val: any, scale: any): string {
        let zerosCount

        if (scale == 'ether') {
            zerosCount = 18
        } else if (scale == 'finney')
            zerosCount = 15
        else {
            zerosCount = scale
        }

        const strVal = val.toString()
        const strZeros = ('0').repeat(zerosCount)

        return strVal.concat(strZeros)
    }

    static toBN(num: any) {
        // @ts-ignore
        // return BigNumber.from(num.toString())
        return BigNumber.from(num.toString())
    }

    static async assertRevert(txPromise: Promise<ContractTransaction>, message?:string) {
        try {
            await (await txPromise).wait()
            // console.log("tx succeeded")
            assert.isFalse(1)
        } catch (err) {
            // console.log("tx failed")
            // console.log(err)
            if (message) {
                assert.include(err?.toString(), message)
            }
        }
    }

    static async openTrove(contracts: IContracts, {
        maxFeePercentage,
        extraLUSDAmount,
        upperHint,
        lowerHint,
        ICR,
        extraParams
    }: IOpenTroveParams) {
        const signers = await ethers.getSigners()
        let signer = signers[0]
        if (extraParams?.from) {
            signer = extraParams.from
        }

        if (!maxFeePercentage) maxFeePercentage = this._100pct
        if (!extraLUSDAmount) extraLUSDAmount = this.toBN(0)
        else if (typeof extraLUSDAmount == 'string') extraLUSDAmount = this.toBN(extraLUSDAmount)
        if (!upperHint) upperHint = this.ZERO_ADDRESS
        if (!lowerHint) lowerHint = this.ZERO_ADDRESS

        const minDebt = parseUnits('2000')/*await contracts.borrowerOperations.MIN_NET_DEBT()*/
        const MIN_DEBT = (
            await this.getNetBorrowingAmount(contracts, minDebt/*.add(minDebt.div(100))*/)
        ).add(this.toBN(1)) // add 1 to avoid rounding issues
        const lusdAmount = MIN_DEBT.add(extraLUSDAmount)

        if (!ICR && !extraParams.value) ICR = this.toBN(this.dec(15, 17)) // 150%
        else if (typeof ICR == 'string') ICR = this.toBN(ICR)

        const totalDebt = await this.getOpenTroveTotalDebt(contracts, lusdAmount)
        const netDebt = totalDebt

        if (ICR) {
            const price = await contracts.priceFeedMock.getPrice()
            extraParams.value = ICR.mul(totalDebt).div(price)
        }

        await contracts.wstETHMock.connect(signer).approve(contracts.borrowerOperations.address, parseUnits('1', 30))
        const tx = await contracts.borrowerOperations.connect(signer).openTrove(extraParams.value, maxFeePercentage, lusdAmount, upperHint, lowerHint)

        return {
            lusdAmount,
            netDebt,
            totalDebt,
            ICR,
            collateral: extraParams.value,
            tx
        }
    }

    // Subtracts the borrowing fee
    static async getNetBorrowingAmount(contracts: IContracts, debtWithFee: BigNumber) {
        const borrowingRate = await contracts.troveManager.getBorrowingRateWithDecay()
        return this.toBN(debtWithFee).mul(MoneyValues._1e18BN).div(MoneyValues._1e18BN.add(borrowingRate))
    }

    static async getOpenTroveTotalDebt(contracts: IContracts, lusdAmount: number|string|BigNumber) {
        const fee = await contracts.troveManager.getBorrowingFee(lusdAmount)
        const compositeDebt = this.toBN(lusdAmount)
        return compositeDebt.add(fee)
    }

    static async getTroveEntireColl(contracts: IContracts, trove: string) {
        return this.toBN((await contracts.troveManager.getEntireDebtAndColl(trove))[1])
    }

    static async getTroveEntireDebt(contracts: IContracts, trove: string) {
        return this.toBN((await contracts.troveManager.getEntireDebtAndColl(trove))[0])
    }

    static async checkRecoveryMode(contracts: IContracts) {
        const price = await contracts.priceFeedMock.getPrice()
        return contracts.troveManager.checkRecoveryMode(price)
    }

    static getDifference(x: BigNumber|string, y: BigNumber|string) {
        const xBn = typeof x == 'string' ? this.toBN(x) : x
        const yBn = typeof y == 'string' ? this.toBN(y) : y

        return Number(xBn.sub(yBn).abs())
    }

    static async getTCR(contracts: IContracts) {
        const price = await contracts.priceFeedMock.getPrice()
        return contracts.troveManager.getTCR(price)
    }

    static assertIsApproximatelyEqual(x: BigNumber, y:BigNumber, error = 1000) {
        assert.isAtMost(this.getDifference(x, y), error)
    }

    static async fastForwardTime(seconds:number) {
        const now = await this.getLatestBlockTimestamp()
        await ethers.provider.send("evm_mine", [now + (seconds > 0 ? seconds : 1)])
    }

    static async getLatestBlockTimestamp() {
        const blockNumber = await ethers.provider.getBlockNumber()
        const block = await ethers.provider.getBlock(blockNumber)
        return block.timestamp
    }

    static async mintWSTETH(wstETHMock: WSTETHMock, accounts: string[]) {
        for (const account of accounts) {
            await wstETHMock.mint(account, ethers.utils.parseUnits('1000', 30))
        }
    }

    static async gasUsed(tx: ContractTransaction) {
        const receipt = await tx.wait()
        const gas = receipt.gasUsed
        return gas
    }

    static async getEventArgByIndex(tx: ContractTransaction, eventName: string, argIndex: number) {
        const receipt = await tx.wait()
        // @ts-ignore
        for (let i = 0; i < receipt.events.length; i++) {
            // @ts-ignore
            if (receipt.events[i].event === eventName) {
                // @ts-ignore
                return receipt.events[i].args[argIndex]
            }
        }
        throw (`The transaction logs do not contain event ${eventName}`)
    }

    static async getEmittedRedemptionValues(redemptionTx: ContractTransaction) {
        const receipt = await redemptionTx.wait()
        // @ts-ignore
        for (let i = 0; i < receipt.events.length; i++) {
            // @ts-ignore
            if (receipt.events[i].event === "Redemption") {
                // @ts-ignore
                const LUSDAmount = receipt.events[i].args[0]
                // @ts-ignore
                const totalLUSDRedeemed = receipt.events[i].args[1]
                // @ts-ignore
                const totalETHDrawn = receipt.events[i].args[2]
                // @ts-ignore
                const ETHFee = receipt.events[i].args[3]

                return [LUSDAmount, totalLUSDRedeemed, totalETHDrawn, ETHFee]
            }
        }
        throw ("The transaction logs do not contain a redemption event")
    }

    static async getEmittedLiquidationValues(liquidationTx: ContractTransaction) {
        const receipt = await liquidationTx.wait()
        // @ts-ignore
        for (let i = 0; i < receipt.events.length; i++) {
            // @ts-ignore
            if (receipt.events[i].event === "Liquidation") {
                // @ts-ignore
                const liquidatedDebt = receipt.events[i].args[0]
                // @ts-ignore
                const liquidatedColl = receipt.events[i].args[1]
                // @ts-ignore
                const collGasComp = receipt.events[i].args[2]
                // @ts-ignore
                const lusdGasComp = BigNumber.from(0)/*receipt.events[i].args[3]*/

                return [liquidatedDebt, liquidatedColl, collGasComp, lusdGasComp]
            }
        }
        throw ("The transaction logs do not contain a liquidation event")
    }

    static async getEventArgByName(tx: ContractTransaction, eventName:string, argName:string) {
        const receipt = await tx.wait()
        // @ts-ignore
        for (let i = 0; i < receipt.events.length; i++) {
            // @ts-ignore
            if (receipt.events[i].event === eventName) {
                // @ts-ignore
                const keys = Object.keys(receipt.events[i].args)
                for (let j = 0; j < keys.length; j++) {
                    if (keys[j] === argName) {
                        // @ts-ignore
                        return receipt.events[i].args[keys[j]]
                    }
                }
            }
        }

        throw (`The transaction logs do not contain event ${eventName} and arg ${argName}`)
    }

    static async getAllEventsByName(tx: ContractTransaction, eventName: string) {
        const receipt = await tx.wait()
        const events = []
        // @ts-ignore
        for (let i = 0; i < receipt.events.length; i++) {
            // @ts-ignore
            if (receipt.events[i].event === eventName) {
                // @ts-ignore
                events.push(receipt.events[i])
            }
        }
        return events
    }

    static getDebtAndCollFromTroveUpdatedEvents(troveUpdatedEvents: Event[], address:string) {
        // @ts-ignore
        const event = troveUpdatedEvents.filter(event => event.args[0] === address)[0]
        // @ts-ignore
        return [event.args[1], event.args[2]]
    }

    static async getOpenTroveLUSDAmount(contracts: IContracts, totalDebt: BigNumber|string) {
        const totalDebtBn = typeof totalDebt == 'string' ? this.toBN(totalDebt) : totalDebt
        return this.getNetBorrowingAmount(contracts, totalDebtBn)
    }

    static async withdrawLUSD(contracts: IContracts, {
        maxFeePercentage,
        lusdAmount,
        ICR,
        upperHint,
        lowerHint,
        extraParams
    }: IWithdrawSIMParams) {
        const signers = await ethers.getSigners()
        let signer = signers[0]
        if (extraParams?.from) {
            signer = extraParams.from
        }

        if (!maxFeePercentage) maxFeePercentage = this._100pct
        if (!upperHint) upperHint = this.ZERO_ADDRESS
        if (!lowerHint) lowerHint = this.ZERO_ADDRESS

        assert(!(lusdAmount && ICR) && (lusdAmount || ICR), "Specify either lusd amount or target ICR, but not both")

        let increasedTotalDebt
        if (ICR) {
            assert(extraParams.from?.address, "A from account is needed")
            const { debt, coll } = await contracts.troveManager.getEntireDebtAndColl(extraParams.from.address)
            const price = await contracts.priceFeedMock.getPrice()
            const targetDebt = coll.mul(price).div(ICR)
            assert(targetDebt > debt, "ICR is already greater than or equal to target")
            increasedTotalDebt = targetDebt.sub(debt)
            lusdAmount = await this.getNetBorrowingAmount(contracts, increasedTotalDebt)
        } else {
            increasedTotalDebt = await this.getAmountWithBorrowingFee(contracts, lusdAmount)
        }

        await contracts.borrowerOperations.connect(signer).withdrawSIM(maxFeePercentage, lusdAmount, upperHint, lowerHint)

        return {
            lusdAmount,
            increasedTotalDebt
        }
    }

    static async getAmountWithBorrowingFee(contracts: IContracts, lusdAmount: BigNumber) {
        const fee = await contracts.troveManager.getBorrowingFee(lusdAmount)
        return lusdAmount.add(fee)
    }

    static applyLiquidationFee(ethAmount: BigNumber) {
        return ethAmount.mul(this.toBN(this.dec(995, 15))).div(MoneyValues._1e18BN)
    }

    static async redeemCollateral(redeemer: SignerWithAddress, contracts: IContracts, LUSDAmount: string, gasPrice: string|number = 0, maxFee = this._100pct) {
        const price = await contracts.priceFeedMock.getPrice()
        const tx = await this.performRedemptionTx(redeemer, price, contracts, LUSDAmount, maxFee)
        // const gas = await this.gasUsed(tx)
        return tx
    }

    static async redeemCollateralAndGetTxObject(redeemer: SignerWithAddress, contracts: IContracts, LUSDAmount: string, gasPrice: string|number = '0', maxFee = this._100pct) {
        const price = await contracts.priceFeedMock.getPrice()
        const tx = await this.performRedemptionTx(redeemer, price, contracts, LUSDAmount, maxFee)
        return tx
    }

    static async performRedemptionTx(redeemer: SignerWithAddress, price: BigNumber, contracts: IContracts, LUSDAmount: string, maxFee = '0') {
        const redemptionhint = await contracts.hintHelpers.getRedemptionHints(LUSDAmount, price, 0)

        const firstRedemptionHint = redemptionhint[0]
        const partialRedemptionNewICR = redemptionhint[1]

        const {
            hintAddress: approxPartialRedemptionHint,
            latestRandomSeed
        } = await contracts.hintHelpers.getApproxHint(partialRedemptionNewICR, 50, this.latestRandomSeed)
        this.latestRandomSeed = latestRandomSeed

        const exactPartialRedemptionHint = (await contracts.sortedTroves.findInsertPosition(partialRedemptionNewICR,
            approxPartialRedemptionHint,
            approxPartialRedemptionHint))

        const tx = await contracts.troveManager.connect(redeemer).redeemCollateral(LUSDAmount,
            firstRedemptionHint,
            exactPartialRedemptionHint[0],
            exactPartialRedemptionHint[1],
            partialRedemptionNewICR,
            0, maxFee
        )

        return tx
    }

    static async ICRbetween100and110(account: SignerWithAddress, troveManager: TroveManagerTester, price: BigNumber) {
        const ICR = await troveManager.getCurrentICR(account.address, price)
        return (ICR.gt(MoneyValues._ICR100)) && (ICR.lt(MoneyValues._MCR))
    }

    static async getEntireCollAndDebt(contracts: IContracts, account: SignerWithAddress) {
        // console.log(`account: ${account}`)
        const rawColl = (await contracts.troveManager.Troves(account.address))[1]
        const rawDebt = (await contracts.troveManager.Troves(account.address))[0]
        const pendingETHReward = await contracts.troveManager.getPendingWSTETHReward(account.address)
        const pendingLUSDDebtReward = await contracts.troveManager.getPendingSIMDebtReward(account.address)
        const entireColl = rawColl.add(pendingETHReward)
        const entireDebt = rawDebt.add(pendingLUSDDebtReward)

        return { entireColl, entireDebt }
    }

    static async getLCAddressFromDeploymentTx(deployedLCTx: ContractTransaction) {
        const receipt = await deployedLCTx.wait()
        // @ts-ignore
        return receipt.events[1].args[0]
    }

    static async getLCFromDeploymentTx(deployedLCTx: ContractTransaction) {
        const deployedLCAddress = await this.getLCAddressFromDeploymentTx(deployedLCTx)  // grab addr of deployed contract from event
        const LC = await this.getLCFromAddress(deployedLCAddress)
        return LC
    }

    static async getLCFromAddress(LCAddress:string) {
        const LC = LockupContract__factory.connect(LCAddress, ethers.provider)
        return LC
    }
}


export const MoneyValues = {
    negative_5e17: "-" + ethers.utils.parseUnits('5', 17),
    negative_1e18: "-" + ethers.utils.parseUnits('1'),
    negative_10e18: "-" + ethers.utils.parseUnits('10'),
    negative_50e18: "-" + ethers.utils.parseUnits('50'),
    negative_100e18: "-" + ethers.utils.parseUnits('100'),
    negative_101e18: "-" + ethers.utils.parseUnits('101'),
    negative_eth: (amount: any) => "-" + ethers.utils.parseUnits(amount),
    // @ts-ignore
    _zeroBN: BigNumber.from('0'),
    // @ts-ignore
    _1e18BN: BigNumber.from('1000000000000000000'),
    // @ts-ignore
    _10e18BN: BigNumber.from('10000000000000000000'),
    // @ts-ignore
    _100e18BN: BigNumber.from('100000000000000000000'),
    // @ts-ignore
    _100BN: BigNumber.from('100'),
    // @ts-ignore
    _110BN: BigNumber.from('110'),
    // @ts-ignore
    _150BN: BigNumber.from('150'),
    // @ts-ignore
    _MCR: BigNumber.from('1100000000000000000'),
    // @ts-ignore
    _ICR100: BigNumber.from('1000000000000000000'),
    // @ts-ignore
    _CCR: BigNumber.from('1500000000000000000'),
}