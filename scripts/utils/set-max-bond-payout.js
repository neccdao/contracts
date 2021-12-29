const hre = require("hardhat");
const { expandDecimals } = require("../../test/shared/utilities");
const { contractAt, sendTxn } = require("../shared/helpers");
const {
  AURORA_MAINNET_AMM,
  AURORA_MAINNET_AMM_FACTORY,
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
  // console.log(Object.keys(allDeployments));
  let ammAddress = AURORA_MAINNET_AMM;
  let ammFactoryAddress = AURORA_MAINNET_AMM_FACTORY;
  const nNeccNDOLLPPair = {
    address: "0xad5779da21408E70973Ac56ab91Dbf201B45b652",
  };
  const ndol = { address: allDeployments?.NdolDiamond.address };
  const necc = { address: allDeployments?.NeccDiamond.address };
  const sNecc = { address: allDeployments?.sNeccDiamond.address };
  const nNecc = { address: allDeployments?.nNeccDiamond.address };
  const staking = { address: allDeployments?.BondDepositoryDiamond.address };
  const bondDepository = {
    address: allDeployments?.BondDepositoryDiamond.address,
  };

  const BondDepositoryD = await ethers.getContractFactory(
    "BondDepositoryFacet"
  ); // ndolNeccLP
  const bondDepositoryD = await BondDepositoryD.attach(bondDepository.address);
  const ndolBondPrice = await bondDepositoryD.bondPriceInUSD(
    nNeccNDOLLPPair.address
  );
  console.log(ndolBondPrice?.toString());

  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "setBondTerms",
    1,
    1,
    nNeccNDOLLPPair.address
  );

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
