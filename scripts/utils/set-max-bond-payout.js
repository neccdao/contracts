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
  const ndolBondPrice = await bondDepositoryD.bondPriceInUSD(ndol.address);
  console.log(ndolBondPrice?.toString());

  const neccD = await contractAt("NeccFacet", necc.address);
  const treasury = await contractAt(
    "TreasuryFacet",
    allDeployments?.TreasuryDiamond.address
  );
  // await treasury.deposit(
  //   expandDecimals(300_000, 18),
  //   ndol.address,
  //   expandDecimals(240_000, 9)
  // );
  // console.log("treasury deposit NDOL");
  // console.log("deployer receives NECC");

  const neccBalance = await neccD.balanceOf(deployer.address);
  console.log(neccBalance?.toString());

  // Stake Necc
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "setMaxBondPayout",
    1
    ndol.address,
    0
  );
  console.log("stake necc for nNecc");

  return;
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

  const ndolMarketPrice = 277;
  const nNECCToAddLiquidity = 50_000 / ndolMarketPrice;

  await sendTxn(
    ammRouter.addLiquidity(
      nNecc.address,
      ndol.address,
      expandDecimals(nNECCToAddLiquidity, 18),
      expandDecimals(ndolMarketPrice, 18)?.mul(nNECCToAddLiquidity),
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    ),
    `ammRouter.addLiquidity(
      ${nNECC.address},
      ${NDOL.address},
      ${nNECCToAddLiquidity} nNecc,
      ${nNECCToAddLiquidity} * ndol bond price in NDOL,
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    )`
  );

  const ERC20 = await ethers.getContractFactory("Token");
  const ndolnNeccLPPair = await ERC20.attach(
    await ammFactory.getPair(ndol.address, nNecc.address)
  );
  let ndolnNeccLPDeployerBalance = await ndolnNeccLPPair.balanceOf(
    deployer.address
  );

  const LPValuation = await bondingCalculatorD.valuation(
    nNeccNDOLLPPair.address,
    ndolnNeccLPDeployerBalance?.mul(99)?.div(100)
  );

  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    ndolnNeccLPDeployerBalance.mul(99).div(100),
    nNeccNDOLLPPair.address,
    LPValuation?.mul(99)?.div(100)?.div(2)
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
