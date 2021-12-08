const {
  RINKEBY_TESTNET_AMM,
  RINKEBY_TESTNET_AMM_FACTORY,
  RINKEBY_TESTNET_ETH_PRICE_FEED,
  nRINKEBY_TESTNET_NDOL_NECC_PAIR,
  nRINKEBY_TESTNET_NECC,
  RINKEBY_TESTNET_TREASURY,
  RINKEBY_TESTNET_BONDING_CALCULATOR,
  RINKEBY_TESTNET_DISTRIBUTOR,
  nRINKEBY_TESTNET_NNECC,
  RINKEBY_TESTNET_STAKING,
  RINKEBY_TESTNET_STAKING_HELPER,
  RINKEBY_TESTNET_NDOL_BOND,
} = require("../env.json");
const { sendTxn, contractAt } = require("../scripts/shared/helpers");
const { expandDecimals } = require("../test/shared/utilities.js");

async function ndeployNeccFarm(hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute, all } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  console.log("Deploying contracts with the account: " + deployer.address);

  const allDeployments = await all();
  const MintFarm = await deployments.deploy("MintFarm", {
    from: deployer.address,
    log: true,
  });
  console.log("Deployed MintFarm");

  const MintDistributor = await deployments.deploy("MintDistributor", {
    from: deployer.address,
    log: true,
  });
  console.log("Deployed MintDistributor");
  const NDOL = allDeployments.NdolDiamond;
  const nNecc = allDeployments.nNeccDiamond;

  await execute(
    "MintDistributor",
    { from: deployer.address },
    "initialize",
    MintFarm.address,
    nNecc.address
  );
  console.log("MintDistributor initialize");

  await execute(
    "MintFarm",
    { from: deployer.address },
    "initialize",
    MintDistributor.address,
    NDOL.address
  );
  console.log("MintFarm initialize");

  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "setFarmDistributor",
    MintDistributor.address
  );
  console.log("BondDepositoryDiamond setFarmDistributor");

  console.log("MintFarm: " + MintFarm.address);
  console.log("MintDistributor: " + MintDistributor.address);
  console.log(
    Object.keys(allDeployments).map((key) =>
      console.log({
        [key]: allDeployments[key].address,
      })
    )
  );
}

module.exports = ndeployNeccFarm;
module.exports.tags = ["local", "nNeccFarm"];
