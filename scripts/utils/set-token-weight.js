const hre = require("hardhat");
const { expandDecimals } = require("../../test/shared/utilities");
const { contractAt, sendTxn } = require("../shared/helpers");
const {
  AURORA_MAINNET_AMM,
  AURORA_MAINNET_AMM_FACTORY,
  AURORA_MAINNET_WETH,
  AURORA_MAINNET_WNEAR,
  AURORA_MAINNET_WBTC,
} = require("../../env.json");

async function main() {
  console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

  const { deployments, ethers } = hre;
  const { all, execute } = deployments;
  const allDeployments = await all();
  const [deployer] = await ethers.getSigners();
  console.log(
    "Running against contracts with the account: " + deployer.address
  );

  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1313161554") {
    return;
  }
  // console.log(Object.keys(allDeployments));
  const exchange = {
    address: allDeployments?.ExchangeDiamond.address,
  };
  const vaultConfig = await contractAt("VaultConfigFacet", exchange.address);
  //
  const setTokenWeightAddress = AURORA_MAINNET_WNEAR;
  const weighting = 10;
  //

  const tokenWeight = await vaultConfig.tokenWeights(setTokenWeightAddress);
  console.log("tokenWeight.toString()");
  console.log(tokenWeight.toString());

  const totalTokenWeight = await vaultConfig.totalTokenWeight();
  console.log("totalTokenWeight.toString()");
  console.log(totalTokenWeight.toString());

  await vaultConfig.setTokenWeight(setTokenWeightAddress, weighting);
  console.log("setTokenWeight: " + setTokenWeightAddress + " " + weighting);

  const pTokenWeight = await vaultConfig.tokenWeights(setTokenWeightAddress);
  console.log("pTokenWeight.toString()");
  console.log(pTokenWeight.toString());

  const pTotalTokenWeight = await vaultConfig.totalTokenWeight();
  console.log("pTotalTokenWeight.toString()");
  console.log(pTotalTokenWeight.toString());

  console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
