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
| MultiTroveGetter           | [0xb3Edebd5BF7c34EbB2dbDA5487C7A0Ad2987C56f](https://testnet-zkevm.polygonscan.com/address/0xb3Edebd5BF7c34EbB2dbDA5487C7A0Ad2987C56f#code) |

### Goerli testnet

|                            |                                                                                                                                             |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| TroveManager               | [0x67952505E536A83C4916a3F44728DE92e0E3EBBc](https://goerli.etherscan.io/address/0x67952505E536A83C4916a3F44728DE92e0E3EBBc#code) |
| StabilityPool              | [0x74bBa28c13771FB32eD08e5522dfEc71ea8De48c](https://goerli.etherscan.io/address/0x74bBa28c13771FB32eD08e5522dfEc71ea8De48c#code) |
| ActivePool                 | [0x4A38a264c26cA27FB1cca3cBfEC56067a3404BB7](https://goerli.etherscan.io/address/0x4A38a264c26cA27FB1cca3cBfEC56067a3404BB7#code) |
| BorrowerOperations         | [0x960FdE8a92d5Ad1245E7AD267641F230d9a39Df1](https://goerli.etherscan.io/address/0x960FdE8a92d5Ad1245E7AD267641F230d9a39Df1#code) |
| CollSurplusPool            | [0x1329Ea1d522714Ae9Cd18543e78926F71EbC0Aa0](https://goerli.etherscan.io/address/0x1329Ea1d522714Ae9Cd18543e78926F71EbC0Aa0#code) |
| DefaultPool                | [0x6BaF629618551Cb7454013F67f5d4A9119A61627](https://goerli.etherscan.io/address/0x6BaF629618551Cb7454013F67f5d4A9119A61627#code) |
| HintHelpers                | [0x57Fc539b66bdc081e19bd828e6C668B249867959](https://goerli.etherscan.io/address/0x57Fc539b66bdc081e19bd828e6C668B249867959#code) |
| SortedTroves               | [0xbf2da16f66a21f0AFF8365b98C19eD73D7f11da4](https://goerli.etherscan.io/address/0xbf2da16f66a21f0AFF8365b98C19eD73D7f11da4#code) |
| CommunityIssuance          | [0xc7d1EDF33946D65995208128F1aAFB324eFF48ec](https://goerli.etherscan.io/address/0xc7d1EDF33946D65995208128F1aAFB324eFF48ec#code) |
| Controller                 | [0xA839029F90F1eebFEAbe1b96ff226FDa3B5388Af](https://goerli.etherscan.io/address/0xA839029F90F1eebFEAbe1b96ff226FDa3B5388Af#code) |
| CrossChainRateReceiverMock | [0x498427B7062529adB0EdcAfD7304767711F44611](https://goerli.etherscan.io/address/0x498427B7062529adB0EdcAfD7304767711F44611#code) |
| LiquidityRewardsIssuance   | [0x7c0d6747738d341ba28dc9475FE0e7ffc25B7fdb](https://goerli.etherscan.io/address/0x7c0d6747738d341ba28dc9475FE0e7ffc25B7fdb#code) |
| LockupContractFactory      | [0xaE8afcd6cB936E65DA62e405c624BE59B1FE47EE](https://goerli.etherscan.io/address/0xaE8afcd6cB936E65DA62e405c624BE59B1FE47EE#code) |
| PriceFeed                  | [0xcF05bE25600286AB922c4Ea4cf160Af2d4916470](https://goerli.etherscan.io/address/0xcF05bE25600286AB922c4Ea4cf160Af2d4916470#code) |
| SHADYToken                 | [0x63B67715cc4B1556dD99a89BB9507669CF48705b](https://goerli.etherscan.io/address/0x63B67715cc4B1556dD99a89BB9507669CF48705b#code) |
| SIMToken                   | [0x3c6715B3c5Ecd82e2dBbF08018C9440B36609757](https://goerli.etherscan.io/address/0x3c6715B3c5Ecd82e2dBbF08018C9440B36609757#code) |
| WSTETHMock                 | [0xd5dE2Ef0ef986026435EEFD7143A398cD2328E27](https://goerli.etherscan.io/address/0xd5dE2Ef0ef986026435EEFD7143A398cD2328E27#code) |
| Ve                         | [0xB8876314f368868a2302eC95d78A623c926C5c61](https://goerli.etherscan.io/address/0xB8876314f368868a2302eC95d78A623c926C5c61#code) |
| MultiTroveGetter           | [0xF4fcD9079b7c96b8365e4CA80D696ee697dC2757](https://goerli.etherscan.io/address/0xF4fcD9079b7c96b8365e4CA80D696ee697dC2757#code) |


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
yarn verify-generate-inputs:goerli
yarn verify:goerli
```
