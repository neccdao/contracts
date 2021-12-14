const hre = require("hardhat");
const { toChainlinkPrice } = require("../test/shared/chainlink");
const { contractAt } = require("./shared/helpers");

async function main() {
  const { deployments, ethers } = hre;
  const { all } = deployments;
  const allDeployments = await all();
  const ethPriceFeed = await contractAt(
    "PriceFeed",
    allDeployments?.ETHPriceFeed?.address
  );
  const price = 5000;
  await ethPriceFeed.setLatestAnswer(toChainlinkPrice(price));
  console.log("Set ethPriceFeed to " + price);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
