# Shadowy Internet Money contracts

[![codecov](https://codecov.io/gh/shadowy-internet-money/sim-contracts/branch/main/graph/badge.svg?token=NVYGWNTOWF)](https://codecov.io/gh/shadowy-internet-money/sim-contracts)

Shadowy Internet Money is a collateralized debt platform on zkEVM network. Users can lock up wstETH, and issue stablecoin tokens (SIM).

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

Install deps, build, run tests and coverage
```
yarn
yarn test
yarn coverage
```
