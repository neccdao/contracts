const hre = require("hardhat");
const { bigNumberify } = require("../../test/shared/utilities");
const { contractAt } = require("../shared/helpers");

function expandDecimals(n, decimals) {
  return bigNumberify(n).mul(bigNumberify(10).pow(decimals));
}

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

  console.info("allDeployments?.BondDepositoryDiamond?.address");
  console.info(allDeployments?.BondDepositoryDiamond?.address);

  const Necc = await contractAt(
    "NeccFacet",
    allDeployments?.NeccDiamond?.address
  );
  const sNecc = await contractAt(
    "sNeccFacet",
    allDeployments?.sNeccDiamond?.address
  );
  const nNecc = await contractAt(
    "nNeccFacet",
    allDeployments?.nNeccDiamond?.address
  );
  const staking = await contractAt(
    "StakingFacet",
    allDeployments?.BondDepositoryDiamond?.address
  );

  console.log("await Necc.balanceOf(deployer.address)?.toString()");
  console.log((await Necc.balanceOf(deployer.address))?.toString());

  console.log("await sNecc.balanceOf(deployer.address)?.toString()");
  console.log((await sNecc.balanceOf(deployer.address))?.toString());

  console.log("await nNecc.balanceOf(deployer.address)?.toString()");
  console.log((await nNecc.balanceOf(deployer.address))?.toString());

  //

  console.log(
    "await Necc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)?.toString()"
  );
  console.log(
    (
      await Necc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)
    )?.toString()
  );

  console.log(
    "await sNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)?.toString()"
  );
  console.log(
    (
      await sNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)
    )?.toString()
  );

  console.log(
    "await nNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)?.toString()"
  );
  console.log(
    (
      await nNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)
    )?.toString()
  );

  //

  const nNeccAllowance = await nNecc.allowance(
    deployer.address,
    allDeployments?.BondDepositoryDiamond?.address
  );

  console.log("nNeccAllowance?.toString()");
  console.log(nNeccAllowance?.toString());

  const nNeccBalanceDeployer = await nNecc.balanceOf(deployer.address);

  // const largeApproval = "100000000000000000000000000000000";
  // await nNecc.approve(
  //   allDeployments?.BondDepositoryDiamond?.address,
  //   largeApproval
  // );
  // console.log("*** Approved nNecc ***");

  await staking.govBurn(expandDecimals(100, 18));
  console.log("*** Gov Burned ***");

  await staking.rebase();
  console.log("*** Rebased ***");

  console.log("await Necc.balanceOf(deployer.address)?.toString()");
  console.log((await Necc.balanceOf(deployer.address))?.toString());

  console.log("await sNecc.balanceOf(deployer.address)?.toString()");
  console.log((await sNecc.balanceOf(deployer.address))?.toString());

  console.log("await nNecc.balanceOf(deployer.address)?.toString()");
  console.log((await nNecc.balanceOf(deployer.address))?.toString());

  console.log("await sNecc.circulatingSupply()?.toString()");
  console.log((await sNecc.circulatingSupply())?.toString());
  //

  console.log(
    "await Necc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)?.toString()"
  );
  console.log(
    (
      await Necc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)
    )?.toString()
  );

  console.log(
    "await sNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)?.toString()"
  );
  console.log(
    (
      await sNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)
    )?.toString()
  );

  console.log(
    "await nNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)?.toString()"
  );
  console.log(
    (
      await nNecc.balanceOf(allDeployments?.BondDepositoryDiamond?.address)
    )?.toString()
  );

  // 2512425901762710000000000 - 2512325901762710000000000
  // 2517707151762710 - 2517607151762710
  // 5212342560662832 - 5213189693866373
  // 5212342.56066283 - 5213189.69386637
  // 131527.47916297

  // 5212342560662832
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
