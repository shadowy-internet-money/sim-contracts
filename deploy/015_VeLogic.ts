import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments
    const { deployer,} = await getNamedAccounts()

    await deploy('VeLogic', {
        contract: 'Ve',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        libraries: {
            VeLogo: (await deployments.get('VeLogo')).address,
        },
    })
}
export default func
func.tags = ['VeLogic']
func.dependencies = ['VeLogo']
