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
