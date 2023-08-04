import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy, execute } = deployments
    const { deployer,} = await getNamedAccounts()

    await deploy('Ve', {
        contract: 'ProxyControlled',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    })

    await execute(
        'Ve',
        {
            from: deployer,
            log: true,
        },
        'initProxy',
        (await deployments.get('VeLogic')).address
    )
}
export default func
func.tags = ['Ve']
func.dependencies = ['VeLogic']
