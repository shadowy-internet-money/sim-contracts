import hre from 'hardhat';
import { VerifyUtils } from './utils/VerifyUtils';

async function main() {
  await verify('VeLogo');
  await verify('VeLogic');
}

async function verify(name: string, pkg?: string) {
  const { deployments } = hre;
  if (pkg) {
    await VerifyUtils.verifyWithContractName((await deployments.get(name)).address, `${pkg}/${name}.sol:${name}`);
  } else {
    await VerifyUtils.verify((await deployments.get(name)).address);
  }
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
