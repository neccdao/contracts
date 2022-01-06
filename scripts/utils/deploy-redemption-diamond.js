const hre = require("hardhat");
const { contractAt } = require("../shared/helpers");

async function main() {
  console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const { deployments, ethers } = hre;
  const { diamond, execute, deploy, all } = deployments;
  const [deployer] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1313161554") {
    return;
  }
  console.log(
    "Running against contracts with the account: " + deployer.address
  );

  const redemption = await diamond.deploy("RedemptionDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["RedemptionFacet"],
    log: true,
  });

  const allDeployments = await all();
  console.log("allDeployments?.RedemptionDiamond?.address");
  console.log(allDeployments?.RedemptionDiamond?.address);

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
