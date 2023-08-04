import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments
    const { deployer,} = await getNamedAccounts()

    const troveManager = await deployments.get('TroveManager')
    const stabilityPool = await deployments.get('StabilityPool')
    const borrowerOperations = await deployments.get('BorrowerOperations')

    await deploy('SIMToken', {
        contract: 'SIMToken',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [troveManager.address, stabilityPool.address, borrowerOperations.address,],
    });
}
export default func
func.tags = ['SIMToken']
func.dependencies = ['TroveManager', 'StabilityPool', 'BorrowerOperations',]