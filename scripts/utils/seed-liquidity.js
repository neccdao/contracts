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
  console.log(bondDepository.address);
  const ndolBondPrice = await bondDepositoryD.bondPriceInUSD(ndol.address);
  console.log(ndolBondPrice?.toString());
  const bondConfig = await contractAt(
    "BondConfigFacet",
    bondDepository.address
  );

  const neccD = await contractAt("NeccFacet", necc.address);
  const treasury = await contractAt(
    "TreasuryFacet",
    allDeployments?.TreasuryDiamond.address
  );

  // const minBondPrice = 9999999_00;
  // await bondConfig.setMinimumPrice(ndol.address, minBondPrice);

  // await treasury.deposit(
  //   expandDecimals(99999_9999, 18),
  //   ndol.address,
  //   expandDecimals(9999_999 9)
  // );
  // console.log("treasury deposit NDOL");
  // console.log("deployer receives NECC");

  // await execute(
  //   "BondDepositoryDiamond",
  //   { from: deployer.address },
  //   "stake",
  //   neccBalance?.toString(),
  //   deployer.address
  // );

  //

  // - Seed the NDOL-NECC pair via the router
  const ammRouter = await ethers.getContractAt(
    "IUniswapV2Router01",
    ammAddress
  );
  const ammFactory = await ethers.getContractAt(
    "IUniswapV2Factory",
    ammFactoryAddress
  );

  // const ndolMarketPrice = 9999_0000;
  // const nNECCToAddLiquidity = 999999;

  // await sendTxn(
  //   ammRouter.addLiquidity(
  //     nNecc.address,
  //     ndol.address,
  //     expandDecimals(nNECCToAddLiquidity, 18),
  //     expandDecimals(ndolMarketPrice, 18)?.mul(nNECCToAddLiquidity),
  //     0,
  //     0,
  //     deployer.address,
  //     Math.round(Date.now() / 1000) + 360
  //   ),
  //   `ammRouter.addLiquidity(
  //     ${nNecc.address},
  //     ${ndol.address},
  //     ${nNECCToAddLiquidity} nNecc,
  //     ${nNECCToAddLiquidity} * ndol bond price in NDOL,
  //     0,
  //     0,
  //     deployer.address,
  //     Math.round(Date.now() / 1000) + 360
  //   )`
  // );

  // return;

  const ERC20 = await ethers.getContractFactory("Token");
  const ndolnNeccLPPair = await ERC20.attach(
    await ammFactory.getPair(ndol.address, nNecc.address)
  );
  let ndolnNeccLPDeployerBalance = await ndolnNeccLPPair.balanceOf(
    deployer.address
  );
  const BondingCalculator = await ethers.getContractFactory(
    "BondingCalculatorFacet"
  );
  const bondingCalculator = { address: treasury.address };
  const bondingCalculatorD = await BondingCalculator.attach(
    bondingCalculator.address
  );

  const LPValuation = await bondingCalculatorD.valuation(
    nNeccNDOLLPPair.address,
    ndolnNeccLPDeployerBalance
  );

  console.log(LPValuation?.toString());

  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    ndolnNeccLPDeployerBalance,
    nNeccNDOLLPPair.address,
    LPValuation
  );

  const neccBalance = await neccD.balanceOf(deployer.address);
  console.log(neccBalance?.toString());

  // await execute(
  //   "BondDepositoryDiamond",
  //   { from: deployer.address },
  //   "stake",
  //   neccBalance?.toString(),
  //   deployer.address
  // );

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
