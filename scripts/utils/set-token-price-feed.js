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
  const setTokenPriceFeedAddress = AURORA_MAINNET_WETH;
  const newPriceFeedAddress = "";
  const newPriceDecimals = 8;
  //

  const priceDecimals = await vaultConfig.priceDecimals(
    setTokenPriceFeedAddress
  );
  console.log("priceDecimals.toString()");
  console.log(priceDecimals.toString());

  const priceFeed = await vaultConfig.priceFeed(setTokenPriceFeedAddress);
  console.log("priceFeed.toString()");
  console.log(priceFeed.toString());

  return;

  await vaultConfig.setTokenPriceFeedConfig(
    setTokenPriceFeedAddress,
    newPriceFeedAddress,
    newPriceDecimals
  );
  console.log(
    "  await vaultConfig.setTokenPriceFeedConfig(setTokenPriceFeedAddress, newPriceFeedAddress, newPriceDecimals); " +
      setTokenPriceFeedAddress +
      " : " +
      newPriceFeedAddress +
      " : " +
      newPriceDecimals
  );

  const ppriceDecimals = await vaultConfig.priceDecimals(
    setTokenPriceFeedAddress
  );
  console.log("ppriceDecimals.toString()");
  console.log(ppriceDecimals.toString());

  const ppriceFeed = await vaultConfig.priceFeed(setTokenPriceFeedAddress);
  console.log("ppriceFeed.toString()");
  console.log(ppriceFeed.toString());

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
