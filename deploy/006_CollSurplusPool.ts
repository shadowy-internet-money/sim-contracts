import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/dist/types";

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre
    const { deploy } = deployments
    const { deployer,} = await getNamedAccounts()

    await deploy('CollSurplusPool', {
        contract: 'CollSurplusPool',
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
    });
}
export default func
func.tags = ['CollSurplusPool']