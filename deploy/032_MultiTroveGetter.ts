import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments
    const { deployer,} = await getNamedAccounts()

    await deploy('MultiTroveGetter', {
        contract: 'MultiTroveGetter',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [
            (await deployments.get('TroveManager')).address,
            (await deployments.get('SortedTroves')).address,
        ],
    });
}
export default func
func.tags = ['MultiTroveGetter']
func.dependencies = [
    'TroveManager',
    'SortedTroves',
]
