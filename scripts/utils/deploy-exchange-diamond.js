const hre = require("hardhat");
const { contractAt } = require("../shared/helpers");

async function main() {
  console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const { deployments, ethers } = hre;
  const { diamond, execute, deploy, all } = deployments;
  const allDeployments = await all();
  const [deployer] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1313161554") {
    return;
  }
  console.log(
    "Running against contracts with the account: " + deployer.address
  );

  console.info("allDeployments?.ExchangeDiamond?.address");
  console.info(allDeployments?.ExchangeDiamond?.address);

  const ExchangeDiamond = await diamond.deploy("ExchangeDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: [
      "VaultFacet",
      "VaultNdolFacet",
      "VaultConfigFacet",
      "VaultLib",
      "RouterFacet",
      "RouterLib",
      "VaultPriceFeedFacet",
      "ReaderFacet",
    ],
    log: true,
  });

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
