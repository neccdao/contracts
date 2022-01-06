const {
  AURORA_MAINNET_WETH,
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

async function deployRedemptionDiamond(hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute, all } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  console.log("Deploying contracts with the account: " + deployer.address);
  if (chainId?.toString() !== "1313161554") {
    return;
  }

  const allDeployments = await all();
  const redemption = await diamond.deploy("RedemptionDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["RedemptionFacet"],
    log: true,
  });
  console.log("Deployed RedemptionDiamond at: " + redemption.address);

  const Ndol = allDeployments.NdolDiamond;
  const nNecc = allDeployments.nNeccDiamond;

  const largeApproval = "100000000000000000000000000000000";

  // Params
  const wethDepositAmount = "";
  const ndolRedemptionRatio = 4;
  const nNeccFloorPrice = 500;
  const wethPrice = 3400;
  //

  await execute(
    "RedemptionDiamond",
    { from: deployer.address },
    "initialize",
    AURORA_MAINNET_WETH,
    Ndol.address,
    nNecc.address,
    ndolRedemptionRatio,
    nNeccFloorPrice,
    wethPrice
  );
  console.log("Redemption initialize");

  return;

  const weth = await contractAt("Token", AURORA_MAINNET_WETH);

  const wethApproval = await weth.approve(redemption.address, largeApproval);
  await wethApproval.wait(1);
  console.log("WETH Approval for RedemptionDiamond");

  await execute(
    "RedemptionDiamond",
    { from: deployer.address },
    "depositWETH",
    wethDepositAmount // multiplied by 18 decimals inside the contract
  );
  console.log("Redemption depositWETH: " + wethDepositAmount);
}

module.exports = deployRedemptionDiamond;
module.exports.tags = ["local", "Redemption"];
