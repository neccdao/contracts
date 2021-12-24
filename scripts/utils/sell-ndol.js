const hre = require("hardhat");
const { contractAt } = require("../shared/helpers");
const { AURORA_MAINNET_WNEAR } = require("../../env.json");
const { expandDecimals } = require("../../test/shared/utilities");

async function main() {
  console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
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

  const RouterFacet = await contractAt(
    "RouterFacet",
    allDeployments?.ExchangeDiamond.address
  );

  console.log("RouterFacet: ", RouterFacet.address);

  await RouterFacet.swap(
    [ndol.address, AURORA_MAINNET_WNEAR],
    expandDecimals(1, 18),
    0,
    deployer.address
  );
  console.log("SellNDOL");

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
