const hre = require("hardhat");
const { contractAt } = require("../shared/helpers");
const { AURORA_MAINNET_DAO_ADDRESS } = require("../../env.json");

async function main() {
  const farmDistributor = {
    address: "0xCfbE1FbBEbe1530fFB44c01AD2497280f60C67f9",
  };

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
  console.info("allDeployments?.BondDepositoryDiamond?.address");
  console.info(allDeployments?.BondDepositoryDiamond?.address);

  const bondDepositoryDiamond = await contractAt(
    "BondDepositoryFacet",
    allDeployments?.BondDepositoryDiamond?.address
  );

  // const bondConfigDiamond = await contractAt(
  //   "BondConfigFacet",
  //   allDeployments?.BondDepositoryDiamond?.address
  // );
  // await bondConfigDiamond.setFarmDistributor(
  //   allDeployments?.MintDistributor?.address
  // );
  // await bondConfigDiamond.setDAO(AURORA_MAINNET_DAO_ADDRESS);
  // await bondConfigDiamond.setTreasury(allDeployments?.TreasuryDiamond?.address);

  console.log(await bondDepositoryDiamond.DAO());
  console.log(await bondDepositoryDiamond.farmDistributor());
  console.log(await bondDepositoryDiamond.treasury());

  const daoFees = await bondDepositoryDiamond.bondFees(
    AURORA_MAINNET_DAO_ADDRESS
  );
  console.info("Fees for DAO are: " + daoFees?.toString());
  const farmDistributorFees = await bondDepositoryDiamond.bondFees(
    farmDistributor?.address
  );
  console.info(
    "Fees for farmDistributor are: " + farmDistributorFees?.toString()
  );

  await bondDepositoryDiamond.distributeFees();
  console.info("Distributed fees for DAO and farmDistributor");

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
