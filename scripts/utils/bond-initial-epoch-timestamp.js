const hre = require("hardhat");
const { contractAt } = require("../shared/helpers");

async function main() {
  console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

  // Date and time (GMT): Thursday, 23 December 2021 04:00:00
  const firstEpochTimestamp = 1640232000;
  // What epoch will be first epoch
  const firstEpochNumber = "1";
  // How many seconds are in each epoch - 1 hour
  const epochLengthInSeconds = "3600";

  const { deployments, ethers } = hre;
  const { all } = deployments;
  const allDeployments = await all();
  const [deployer] = await ethers.getSigners();
  console.log(
    "Running against contracts with the account: " + deployer.address
  );
  // console.log(Object.keys(allDeployments));
  const nNeccNDOLLPPair = {
    address: "0xad5779da21408E70973Ac56ab91Dbf201B45b652",
  };
  const ndol = { address: allDeployments?.NdolDiamond.address };
  const sNecc = { address: allDeployments?.sNeccDiamond.address };
  const nNecc = { address: allDeployments?.nNeccDiamond.address };

  const bondConfig = await contractAt(
    "BondConfigFacet",
    allDeployments?.BondDepositoryDiamond.address
  );

  await bondConfig.initializeDistributor(
    epochLengthInSeconds,
    firstEpochTimestamp,
    ndol.address
  );
  console.log("InitializeDistributor - NDOL");

  await bondConfig.initializeDistributor(
    epochLengthInSeconds,
    firstEpochTimestamp,
    nNeccNDOLLPPair.address
  );
  console.log("InitializeDistributor - LP");

  await bondConfig.initializeStaking(
    firstEpochNumber,
    firstEpochTimestamp,
    sNecc.address,
    nNecc.address
  );
  console.log("InitializeStaking");

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
