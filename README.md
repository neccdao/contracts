# Necc Contracts

Contracts for the Necc Token and Necc Treasury.

## Setup Environment

Setup an env vars file, add your deployment private key  
`cp sample-env.json env.json`

## Install Dependencies

If npx is not installed yet:
`npm install -g npx`

Install packages:
`yarn`

## Compile Contracts

`yarn compile`

## Run Tests

`yarn test`

## Vault

The Vault contract handles buying NDOL, selling NDOL, swapping, increasing positions, decreasing positions and liquidations.
Overview: https://docs.necc.io

### Buying NDOL

- NDOL can be bought with any whitelisted token
- The oracle price is used to determine the amount of NDOL that should be minted to the receiver, with 1 NDOL being valued at 1 USD
- Fees are collected based on `swapFeeBasisPoints * ( current NDOL minted for collateral / ( target weighting for collateral * total NDOL ) )`
- `ndolAmounts` is increased to track the NDOL debt of the token
- `poolAmounts` is increased to track the amount of tokens that can be used for swaps or borrowed for margin trading

### Selling NDOL

- NDOL can be sold for any whitelisted token
- The oracle price is used to determine the amount of tokens that should be sent to the receiver
- The amount of tokens sent out is additionally capped by the redemption collateral
- To calculate the redemption collateral:
  - Convert the value in `guaranteedUsd[token]` from USD to tokens
  - Add `poolAmounts[token]`
  - Subtract `reservedAmounts[token]`
- The reason for this calculation is because traders can open long positions by borrowing whitelisted tokens, when these tokens are borrowed the USD value in `guaranteedUsd[token]` is guaranteed until the positions are closed or liquidated
- `reservedAmounts[token]` tracks the amount of tokens in the pool reserved for open positions
- The redemption amount is capped by: `(NDOL sold) / (NDOL debt) * (redemption collateral) * (redemptionBasisPoints[token]) / BASIS_POINTS_DIVISOR`
- redemptionBasisPoints can be adjusted to allow a larger or smaller amount of redemption
- Fees are collected based on `swapFeeBasisPoints`
- `ndolAmounts` is decreased to reduce the NDOL debt of the token
- `poolAmounts` is decreased to reflect the reduction in available collateral for redemption

### Swap

- Any whitelisted tokens can be swapped for one another
- The oracle prices are used to determine the amount of tokens that should be sent to the receiver
- NDOL debt is transferred from the \_tokenOut to the \_tokenIn
- Fees are collected based on `swapFeeBasisPoints`
- `poolAmounts` are updated to reflect the change in tokens

### IncreasePosition

- Traders can long and short whitelisted tokens
- For longs and shorts, the collateral token must be the same as the index token (the token being speculated)
- For both longs and shorts, the token borrowed from the pool is based on the collateral token
- Fees are collected based on `marginFeeBasisPoints` and funding rates
- Funding rates are calculated based on the `fundingRateFactor` and utilisation of the pool for the token being borrowed
- `reservedAmounts[token]` is increased to ensure there are sufficient tokens to pay profits on the position
- For longs and shorts:
  - `guaranteedUsd[token]` is updated based on the difference between the position size and the collateral
  - `poolAmounts[token]` is increased by the collateral received and considered as part of the pool

### DecreasePosition

- `reservedAmounts[token]` is decreased proportional to the decrease in position size
- For longs and shorts:
  - The `guaranteedUsd[token]` is updated based on the new difference between the position size and the collateral
  - `poolAmounts[token]` is decreased by the amount of USD sent out, since the position's collateral and the position's size are treated as a part of the pool

### LiquidatePosition

- Any user can liquidate a position if the remaining collateral after losses is lower than `liquidationFeeUsd` or if the `maxLeverage` is exceeded
- `reservedAmounts[token]` is decreased since it is no longer needed for the position
- For longs and shorts:
  - `guaranteedUsd[token]` is decreased based on the different between the position size and the collateral
