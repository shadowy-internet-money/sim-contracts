# Shadowy Internet Money contracts

[![codecov](https://codecov.io/gh/shadowy-internet-money/sim-contracts/branch/main/graph/badge.svg?token=NVYGWNTOWF)](https://codecov.io/gh/shadowy-internet-money/sim-contracts)

Shadowy Internet Money is a collateralized debt platform on zkEVM network. Users can lock up wstETH, and issue
stablecoin tokens (SIM).

## Deployments

### zkEVM testnet

|                            |                                                                                                                                             |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| TroveManager               | [0x4D7D07196E24D15d8E5B97216aeDCf4518b23A66](https://testnet-zkevm.polygonscan.com/address/0x4D7D07196E24D15d8E5B97216aeDCf4518b23A66#code) |
| StabilityPool              | [0x108aBca337e88a9fc1DE96b0ec323f476b35cD44](https://testnet-zkevm.polygonscan.com/address/0x108aBca337e88a9fc1DE96b0ec323f476b35cD44#code) |
| ActivePool                 | [0xA1bDdeeEF252989729AF9d3676E78A6C5Ed40cAC](https://testnet-zkevm.polygonscan.com/address/0xA1bDdeeEF252989729AF9d3676E78A6C5Ed40cAC#code) |
| BorrowerOperations         | [0x3fa5F9c876BEbB41B8924633850b1a9922f7E4F9](https://testnet-zkevm.polygonscan.com/address/0x3fa5F9c876BEbB41B8924633850b1a9922f7E4F9#code) |
| CollSurplusPool            | [0x7f1Ea9A4986F354372c49826e28E733693f4f577](https://testnet-zkevm.polygonscan.com/address/0x7f1Ea9A4986F354372c49826e28E733693f4f577#code) |
| DefaultPool                | [0x21160EA4ebc4E644777514774965a506a98D01c6](https://testnet-zkevm.polygonscan.com/address/0x21160EA4ebc4E644777514774965a506a98D01c6#code) |
| HintHelpers                | [0x152231B068b498612966Ce2D8618895dA8728972](https://testnet-zkevm.polygonscan.com/address/0x152231B068b498612966Ce2D8618895dA8728972#code) |
| SortedTroves               | [0x43D358363A57F48c5e3b07e54C98417554Ee2d17](https://testnet-zkevm.polygonscan.com/address/0x43D358363A57F48c5e3b07e54C98417554Ee2d17#code) |
| CommunityIssuance          | [0xC4b0E5AF4B04A2BE7F0EF7CCD5B867b0bAcde880](https://testnet-zkevm.polygonscan.com/address/0xC4b0E5AF4B04A2BE7F0EF7CCD5B867b0bAcde880#code) |
| Controller                 | [0x69678E6bf7c11e6796016Df7449DB51C43FCb3fD](https://testnet-zkevm.polygonscan.com/address/0x69678E6bf7c11e6796016Df7449DB51C43FCb3fD#code) |
| CrossChainRateReceiverMock | [0xd4A5f0A6Bf09c1DC042254329ac144D99412f3a5](https://testnet-zkevm.polygonscan.com/address/0xd4A5f0A6Bf09c1DC042254329ac144D99412f3a5#code) |
| LiquidityRewardsIssuance   | [0xCe297D0aBD4c2198f350DeF8EA01166cDf912502](https://testnet-zkevm.polygonscan.com/address/0xCe297D0aBD4c2198f350DeF8EA01166cDf912502#code) |
| LockupContractFactory      | [0xf81FCd61b18BAb470418161B6cFaF95a3796762b](https://testnet-zkevm.polygonscan.com/address/0xf81FCd61b18BAb470418161B6cFaF95a3796762b#code) |
| PriceFeed                  | [0x48469a0481254d5945E7E56c1Eb9861429c02f44](https://testnet-zkevm.polygonscan.com/address/0x48469a0481254d5945E7E56c1Eb9861429c02f44#code) |
| SHADYToken                 | [0xE452CDC71B9f488333fa9a999B421BaC0cD988fc](https://testnet-zkevm.polygonscan.com/address/0xE452CDC71B9f488333fa9a999B421BaC0cD988fc#code) |
| SIMToken                   | [0x29353bB4c9010c6112a77d702Ac890e70CD73d53](https://testnet-zkevm.polygonscan.com/address/0x29353bB4c9010c6112a77d702Ac890e70CD73d53#code) |
| WSTETHMock                 | [0x29E4d6c08e3AD060Dc2fC8DCE70AaB8C8c57563F](https://testnet-zkevm.polygonscan.com/address/0x29E4d6c08e3AD060Dc2fC8DCE70AaB8C8c57563F#code) |
| Ve                         | [0xDFd33dF050c85B9efB3D3601456e2BdD4659ABCC](https://testnet-zkevm.polygonscan.com/address/0xDFd33dF050c85B9efB3D3601456e2BdD4659ABCC#code) |

## Differences from Liquity

* ETH -> wstETH
* ChainLink, Tellor -> API3, Pyth + wstETH rate provider
* liquidation reserve (gas compensation) 200.0 LUSD -> 0 SIM
* MIN_NET_DEBT 1800 LUSD -> 1 SIM
* LQTYStaking -> veSHADY
* no frontend operators rewards
* BOOTSTRAP_PERIOD 14 -> 30 days
* LiquidityRewardsIssuance
* Half of borrow fees goes to feeReceiver address (for use in POL)
* tokenomics changes
    * 30m CommunityIssuance
    * 30m LiquidityRewardsIssuance
    * 26m multisig (1 year lock: 1% to Service Providers, 25% to Team and Advisors)
    * 14m spenderAddress (5% Public Sale, 4% Community Reserve, 5% Liquidity)

## Development

### Install deps, build, run tests and coverage

```
yarn
yarn test
yarn coverage
```

### Deploy amd verify
```
yarn deploy
yarn deploy:zkevmtestnet
# verify VeLogo and VeLogic by hands with generated minimal inputs in tmp folder
yarn verify-generate-inputs:zkevmtestnet
# verify other contracts by API
yarn verify:zkevmtestnet
```
