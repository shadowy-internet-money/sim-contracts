import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";
import {parseUnits} from "ethers/lib/utils";
import {BorrowerOperations, Controller, SHADYToken, SIMToken, Ve, VeDistributor, WSTETHMock} from "../typechain-types";
import {expect} from "hardhat";
import {TestHelper} from "../utils/TestHelper";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy, execute } = deployments
    const { deployer, wstETH, spender, multisig,} = await getNamedAccounts()
    const ZERO_ADDRESS = '0x' + '0'.repeat(40)

    let wstETHTarget

    if (wstETH === ZERO_ADDRESS) {
        const deployResult = await deploy('WSTETHMock', {
            contract: 'WSTETHMock',
            from: deployer,
            log: true,
            skipIfAlreadyDeployed: true,
        })

        await execute(
            'WSTETHMock',
            {
                from: deployer,
                log: true,
            },
            'mint',
            deployer,
            parseUnits('1')
        )

        wstETHTarget = deployResult.address
    } else {
        wstETHTarget = wstETH
    }

    const communityIssuance = await deployments.get('CommunityIssuance')
    const liquidityRewardsIssuance = await deployments.get('LiquidityRewardsIssuance')
    const ve = await deployments.get('Ve')
    const lockupContractFactory = await deployments.get('LockupContractFactory')
    const troveManager = await deployments.get('TroveManager')
    const borrowerOperations = await deployments.get('BorrowerOperations')
    const stabilityPool = await deployments.get('StabilityPool')
    const activePool = await deployments.get('ActivePool')
    const defaultPool = await deployments.get('DefaultPool')
    const collSurplusPool = await deployments.get('CollSurplusPool')
    const sortedTroves = await deployments.get('SortedTroves')
    const priceFeed = await deployments.get('PriceFeed')
    const simToken = await deployments.get('SIMToken')
    const simVeDistributor = await deployments.get('SIMVeDistributor')
    const wstETHVeDistributor = await deployments.get('WSTETHVeDistributor')
    const controller = await deployments.get('Controller')

    const shadyTokenDeployResult = await deploy('SHADYToken', {
        contract: 'SHADYToken',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [
            communityIssuance.address,
            liquidityRewardsIssuance.address,
            ve.address,
            lockupContractFactory.address,
            spender,
            multisig
        ]
    })

    // connect all contact
    await execute(
        'SortedTroves',
        {
            from: deployer,
            log: true,
        },
        'setParams',
        '0x' + 'f'.repeat(64),
        troveManager.address,
        borrowerOperations.address
    )

    await execute(
        'TroveManager',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        borrowerOperations.address,
        activePool.address,
        defaultPool.address,
        stabilityPool.address,
        collSurplusPool.address,
        priceFeed.address,
        simToken.address,
        sortedTroves.address,
        shadyTokenDeployResult.address,
        wstETHVeDistributor.address
    )

    await execute(
        'BorrowerOperations',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        wstETHTarget,
        troveManager.address,
        activePool.address,
        defaultPool.address,
        stabilityPool.address,
        collSurplusPool.address,
        priceFeed.address,
        sortedTroves.address,
        simToken.address,
        simVeDistributor.address,
        multisig
    )

    await execute(
        'StabilityPool',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        wstETHTarget,
        borrowerOperations.address,
        troveManager.address,
        activePool.address,
        simToken.address,
        sortedTroves.address,
        priceFeed.address,
        communityIssuance.address
    )

    await execute(
        'ActivePool',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        wstETHTarget,
        borrowerOperations.address,
        troveManager.address,
        stabilityPool.address,
        defaultPool.address,
        collSurplusPool.address
    )

    await execute(
        'DefaultPool',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        wstETHTarget,
        troveManager.address,
        activePool.address
    )

    await execute(
        'CollSurplusPool',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        wstETHTarget,
        borrowerOperations.address,
        troveManager.address,
        activePool.address
    )

    await execute(
        'HintHelpers',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        sortedTroves.address,
        troveManager.address
    )

    await execute(
        'LockupContractFactory',
        {
            from: deployer,
            log: true,
        },
        'setSHADYTokenAddress',
        shadyTokenDeployResult.address
    )

    const controllerContract = await hre.ethers.getContractAt(
        'Controller',
        controller.address,
    ) as Controller
    let tx = await controllerContract.init(multisig)
    let receipt = await tx.wait()
    console.log(`executing Controller.init (tx: ${tx.hash}) ...: performed with ${receipt.gasUsed} gas`)

    const veContract = await hre.ethers.getContractAt(
        'Ve',
        ve.address,
    ) as Ve
    tx = await veContract.setAddresses(
        troveManager.address,
        borrowerOperations.address,
        shadyTokenDeployResult.address,
        controller.address
    )
    receipt = await tx.wait()
    console.log(`executing Ve.setAddresses (tx: ${tx.hash}) ...: performed with ${receipt.gasUsed} gas`)

    await execute(
        'CommunityIssuance',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        shadyTokenDeployResult.address,
        stabilityPool.address
    )

    const simVeDistributorContract = await hre.ethers.getContractAt(
        'VeDistributor',
        simVeDistributor.address,
    ) as VeDistributor
    tx = await simVeDistributorContract.init(
        controller.address,
        ve.address,
        simToken.address
    )
    receipt = await tx.wait()
    console.log(`executing SIMVeDistributor.init (tx: ${tx.hash}) ...: performed with ${receipt.gasUsed} gas`)

    const wstETHVeDistributorContract = await hre.ethers.getContractAt(
        'VeDistributor',
        wstETHVeDistributor.address,
    ) as VeDistributor
    tx = await wstETHVeDistributorContract.init(
        controller.address,
        ve.address,
        wstETHTarget
    )
    receipt = await tx.wait()
    console.log(`executing WSTETHVeDistributor.init (tx: ${tx.hash}) ...: performed with ${receipt.gasUsed} gas`)

    // TEST
    if (hre.network.name === 'hardhat') {
        const wstETHContract = await hre.ethers.getContractAt(
            'WSTETHMock',
            wstETHTarget,
        ) as WSTETHMock
        const simContract = await hre.ethers.getContractAt(
            'SIMToken',
            simToken.address,
        ) as SIMToken
        const shadyContract = await hre.ethers.getContractAt(
            'SHADYToken',
            shadyTokenDeployResult.address,
        ) as SHADYToken

        const veLockAmount = parseUnits('10')
        const spenderSigner = await TestHelper.impersonate(spender)
        await shadyContract.connect(spenderSigner).transfer(deployer, veLockAmount)
        await shadyContract.approve(veContract.address, veLockAmount)
        await veContract.createLock(shadyTokenDeployResult.address, veLockAmount, 86400*7*10)
        await TestHelper.fastForwardTime(86400*7*2)

        const colAmount = parseUnits('1')
        const simAmount = parseUnits('100')
        await wstETHContract.approve(borrowerOperations.address, colAmount)
        const balanceWSTETHBefore = await wstETHContract.balanceOf(deployer)
        const borrowingOperationsContract = await hre.ethers.getContractAt(
            'BorrowerOperations',
            borrowerOperations.address,
        ) as BorrowerOperations
        const _100pct = '1000000000000000000'
        await borrowingOperationsContract.openTrove(parseUnits('1'), _100pct, simAmount, deployer, deployer)
        const balanceWSTETHAfter = await wstETHContract.balanceOf(deployer)
        expect(balanceWSTETHAfter.toString()).eq(balanceWSTETHBefore.sub(colAmount).toString())
        const balanceSIM = await simContract.balanceOf(deployer)
        expect(balanceSIM.toString()).eq(simAmount.toString())
        await simVeDistributorContract.claim(1)
        const balanceSIMAfter = await simContract.balanceOf(deployer)
        expect(balanceSIMAfter.sub(balanceSIM).gt(0)).eq(true)
    }
}
export default func
func.tags = ['SHADYToken']
func.dependencies = [
    'TroveManager',
    'StabilityPool',
    'BorrowerOperations',
    'ActivePool',
    'DefaultPool',
    'CollSurplusPool',
    'HintHelpers',
    'SortedTroves',
    'PriceFeed',
    'SIMToken',
    'CommunityIssuance',
    'LiquidityRewardsIssuance',
    'LockupContractFactory',
    'Ve',
    'SIMVeDistributor',
    'WSTETHVeDistributor',
    'Controller',
]
