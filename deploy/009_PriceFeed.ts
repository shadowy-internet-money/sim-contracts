import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";
import {parseUnits} from "ethers/lib/utils";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy, execute } = deployments
    const { deployer, api3Proxy, pyth, rateReceiver,} = await getNamedAccounts()
    let api3ProxyTarget
    let pythTarget
    let rateReceiverTarget

    const pythFeedId: {[networkName in string]: string} = {
            'hardhat': '0x' + '0'.repeat(64),
            'zkevmtestnet': '0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6',
            'zkevm': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    }

    const ZERO_ADDRESS = '0x' + '0'.repeat(40)

    await deploy('PriceFeed', {
        contract: 'PriceFeed',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });

    if (api3Proxy === ZERO_ADDRESS) {
        const deployResult = await deploy('Api3ProxyMock', {
            contract: 'Api3ProxyMock',
            from: deployer,
            log: true,
            skipIfAlreadyDeployed: true,
        })

        api3ProxyTarget = deployResult.address

        await execute(
            'Api3ProxyMock',
            {
                from: deployer,
                log: true,
            },
            'setPrice',
            parseUnits('1800')
        )

        const blockNumber = await hre.ethers.provider.getBlockNumber()
        const block = await hre.ethers.provider.getBlock(blockNumber)
        const ts = block.timestamp

        await execute(
            'Api3ProxyMock',
            {
                from: deployer,
                log: true,
            },
            'setUpdateTime',
            ts
        )
    } else {
        api3ProxyTarget = api3Proxy
    }

    if (pyth === ZERO_ADDRESS) {
        const deployResult = await deploy('PythMock', {
            contract: 'PythMock',
            from: deployer,
            log: true,
            skipIfAlreadyDeployed: true,
        })

        await execute(
            'PythMock',
            {
                from: deployer,
                log: true,
            },
            'setFeedId',
            pythFeedId[hre.network.name]
        )

        pythTarget = deployResult.address
    } else {
        pythTarget = pyth
    }

    if (rateReceiver === ZERO_ADDRESS) {
        const deployResult = await deploy('CrossChainRateReceiverMock', {
            contract: 'CrossChainRateReceiverMock',
            from: deployer,
            log: true,
            skipIfAlreadyDeployed: true,
        })

        await execute(
            'CrossChainRateReceiverMock',
            {
                from: deployer,
                log: true,
            },
            'setRate',
            parseUnits('1')
        )

        rateReceiverTarget = deployResult.address
    } else {
        rateReceiverTarget = rateReceiver
    }

    await execute(
        'PriceFeed',
        {
            from: deployer,
            log: true,
        },
        'setAddresses',
        api3ProxyTarget,
        pythTarget,
        rateReceiverTarget,
        pythFeedId[hre.network.name]
    )
}
export default func
func.tags = ['PriceFeed']
