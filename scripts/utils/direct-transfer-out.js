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

  const BTCToken = await contractAt("Token", tokens[0]);
  const ETHToken = await contractAt("Token", tokens[1]);
  const NEARToken = await contractAt("Token", tokens[2]);

  const ethTokenBalanceDeployer = await ETHToken.balanceOf(deployer.address);
  const nearTokenBalanceDeployer = await NEARToken.balanceOf(deployer.address);
  const nearTokenBalanceExchange = await NEARToken.balanceOf(exchange.address);

  console.log((await BTCToken.balanceOf(deployer.address)).toString());
  console.log(ethTokenBalanceDeployer.toString());
  console.log(nearTokenBalanceDeployer.toString());
  console.log(nearTokenBalanceExchange.toString());

  // 2885944
  // 103136034500082095363
  // 12825138240384001308916684315

  // 0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB

  // const largeApproval = "100000000000000000000000000000000";
  // await NEARToken.transfer(exchange.address, nearTokenBalanceDeployer);
  // return;
  // await NEARToken.approve(exchange.address, largeApproval);
  // console.log("Approve NEARToken");
  // 12825138240384001308916684315
  // 100000000000000000000000000000000

  console.log(allDeployments?.ExchangeDiamond?.address);

  const vaultConfigFacet = await contractAt(
    "VaultConfigFacet",
    exchange.address
  );
  const vaultNdolFacet = await contractAt("VaultNdolFacet", exchange.address);

  try {
    console.log("AAAYyy");
    console.log(deployer.address);
    await vaultConfigFacet.directTransferOut(
      AURORA_MAINNET_WNEAR,
      deployer.address,
      expandDecimals(1000, 24)
    );

    console.log("Withdrew 1000");
    return;
    // await vaultConfigFacet.updateTokenBalance(tokens[2]);
    // console.log("vc");

    return;

    // await routerFacet.directPoolDeposit(tokens[1], ethTokenBalanceDeployer);
    // console.log(
    //   "directPoolDeposit: " +
    //     tokens[1] +
    //     " : " +
    //     ethTokenBalanceDeployer?.toString()
    // );
    // await routerFacet.directPoolDeposit(tokens[2], nearTokenBalanceDeployer);
    // console.log(
    //   "directPoolDeposit: " +
    //     tokens[2] +
    //     " : " +
    //     nearTokenBalanceDeployer?.toString()
    // );
    console.info("*** AAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  } catch (err) {
    console.log(err);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
