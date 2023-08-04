import { HardhatUserConfig } from "hardhat/config";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import "@nomicfoundation/hardhat-network-helpers";
import "hardhat-contract-sizer";
import 'solidity-coverage'
import {config as dotEnvConfig} from "dotenv";
import "@nomicfoundation/hardhat-verify";
import 'hardhat-deploy';

dotEnvConfig()

const ZKEVM_RPC_URL = process.env.ZKEVM_RPC_URL || 'https://zkevm-rpc.com'
const ZKEVM_TESTNET_RPC_URL = process.env.ZKEVM_TESTNET_RPC_URL || 'https://rpc.public.zkevm-test.net'
const PRIVATE_KEY = process.env.PRIVATE_KEY || '85bb5fa78d5c4ed1fde856e9d0d1fe19973d7a79ce9ed6c0358ee06a4550504e'
const ETHERSCAN_ZKEVM_API_KEY = process.env.ETHERSCAN_ZKEVM_API_KEY || 'aaa'
const ZERO_ADDRESS = '0x' + '0'.repeat(40)

const namedAccounts = {
  deployer: 0,
  api3Proxy: {
    'hardhat': ZERO_ADDRESS,
    'zkevmtestnet': '0x26690F9f17FdC26D419371315bc17950a0FC90eD',
    'zkevm': '0x26690F9f17FdC26D419371315bc17950a0FC90eD',
  },
  pyth: {
    'hardhat': ZERO_ADDRESS,
    'zkevmtestnet': '0xd54bf1758b1C932F86B178F8b1D5d1A7e2F62C2E',
    'zkevm': '0xC5E56d6b40F3e3B5fbfa266bCd35C37426537c65',
  },
  rateReceiver: {
    'hardhat': ZERO_ADDRESS,
    'zkevmtestnet': ZERO_ADDRESS,
    'zkevm': '0x00346D2Fd4B2Dc3468fA38B857409BC99f832ef8',
  },
  wstETH: {
    'hardhat': ZERO_ADDRESS,
    'zkevmtestnet': ZERO_ADDRESS,
    'zkevm': '0x5d8cff95d7a57c0bf50b30b43c7cc0d52825d4a9',
  },
  spender: {
    'hardhat': 1,
    'zkevmtestnet': '0x326471C46A622bDf4AED5e1AEebB7527b1Dac72e',
    'zkevm': 0, // todo
  },
  multisig: {
    'hardhat': 2,
    'zkevmtestnet': '0x644A94A6835e75fFf282D3319eA39E9129dbC857',
    'zkevm': 2, // todo
  },
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
  networks: {
    hardhat: {
      loggingEnabled: false,
    },
    zkevm: {
      url: ZKEVM_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 1101,
    },
    zkevmtestnet: {
      url: ZKEVM_TESTNET_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 1442,
    }
  },
  etherscan: {
    apiKey: {
      zkevm: ETHERSCAN_ZKEVM_API_KEY,
      zkevmtestnet: ETHERSCAN_ZKEVM_API_KEY
    },
    customChains: [
      {
        network: "zkevm",
        chainId: 1101,
        urls: {
          apiURL: "https://api-zkevm.polygonscan.com/api", //https://explorer.mainnet.zkevm-test.net/api",
          browserURL: "https://zkevm.polygonscan.com/", //https://explorer.mainnet.zkevm-test.net/"
        }
      },
      {
        network: "zkevmtestnet",
        chainId: 1442,
        urls: {
          apiURL: "https://api-testnet-zkevm.polygonscan.com/api", //https://explorer.public.zkevm-test.net/api",
          browserURL: "https://testnet-zkevm.polygonscan.com/", //"https://explorer.public.zkevm-test.net/"
        }
      }
    ],
  },
  verify: {
    etherscan: {
      apiKey: ETHERSCAN_ZKEVM_API_KEY,
    },
  },
  namedAccounts,
};

export default config;
