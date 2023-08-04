import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy, execute } = deployments
    const { deployer,} = await getNamedAccounts()

    await deploy('WSTETHVeDistributor', {
        contract: 'ProxyControlled',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    })

    await execute(
        'WSTETHVeDistributor',
        {
            from: deployer,
            log: true,
        },
        'initProxy',
        (await deployments.get('VeDistributorLogic')).address
    )
}
export default func
func.tags = ['WSTETHVeDistributor']
func.dependencies = ['VeDistributorLogic']
