const hre = require("hardhat");
const { expandDecimals } = require("../../test/shared/utilities");
const { contractAt, sendTxn } = require("../shared/helpers");
const {
  AURORA_MAINNET_WBTC,
  AURORA_MAINNET_WETH,
  AURORA_MAINNET_WNEAR,
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

  const btc = {
    address: AURORA_MAINNET_WBTC,
  };
  const eth = {
    address: AURORA_MAINNET_WETH,
  };
  const near = {
    address: AURORA_MAINNET_WNEAR,
  };

  const tokens = [btc.address, eth.address, near.address];

  const RouterFacet = await contractAt("RouterFacet", exchange.address);
  const vaultConfigFacet = await contractAt(
    "VaultConfigFacet",
    exchange.address
  );

  //   await vaultConfigFacet.withdrawFees(tokens[0], deployer.address);
  //   console.log("withdrawFees: ", tokens[0], deployer.address);

  //   await vaultConfigFacet.withdrawFees(tokens[1], deployer.address);
  //   console.log("withdrawFees: ", tokens[1], deployer.address);

  await vaultConfigFacet.withdrawFees(tokens[2], deployer.address);
  console.log("withdrawFees: ", tokens[2], deployer.address);

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
