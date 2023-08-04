import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy, execute } = deployments
    const { deployer,} = await getNamedAccounts()

    await deploy('Controller', {
        contract: 'ProxyControlled',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    })

    await execute(
        'Controller',
        {
            from: deployer,
            log: true,
        },
        'initProxy',
        (await deployments.get('ControllerLogic')).address
    )
}
export default func
func.tags = ['Controller']
func.dependencies = ['ControllerLogic']
