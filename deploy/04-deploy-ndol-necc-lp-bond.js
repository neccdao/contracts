const {
  RINKEBY_TESTNET_AMM,
  RINKEBY_TESTNET_AMM_FACTORY,
  RINKEBY_TESTNET_ETH_PRICE_FEED,
  nRINKEBY_TESTNET_NDOL_NECC_PAIR,
  nRINKEBY_TESTNET_NECC,
  RINKEBY_TESTNET_TREASURY,
  RINKEBY_TESTNET_BONDING_CALCULATOR,
  RINKEBY_TESTNET_DISTRIBUTOR,
  RINKEBY_TESTNET_NNECC,
  RINKEBY_TESTNET_STAKING,
  RINKEBY_TESTNET_STAKING_HELPER,
  RINKEBY_TESTNET_NDOL_BOND,
} = require("../env.json");
const { sendTxn, contractAt } = require("../scripts/shared/helpers");
const { expandDecimals } = require("../test/shared/utilities.js");

async function deployNDOLNeccLPBond(hre) {
  const { deployments, ethers, getChainId } = hre;
  const { diamond, execute, all } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const allDeployments = await all();
  const chainId = await getChainId();
  let ammAddress;
  let ammFactoryAddress;
  console.log({ chainId });
  if (chainId?.toString() === "4") {
    // Don't do anything for Rinkeby for now
    return;
    ammAddress = RINKEBY_TESTNET_AMM;
    ammFactoryAddress = RINKEBY_TESTNET_AMM_FACTORY;
  } else if (chainId?.toString() === "1337") {
    ammAddress = AURORA_MAINNET_AMM;
    ammFactoryAddress = AURORA_MAINNET_AMM_FACTORY;
  } else if (chainId?.toString() === "1313161554") {
    ammAddress = AURORA_MAINNET_AMM;
    ammFactoryAddress = AURORA_MAINNET_AMM_FACTORY;
  } else {
    return;
  }
  console.log("Deploying contracts with the account: " + deployer.address);
  // First epoch occurs
  /*
  Epoch timestamp: 1639918800
  Timestamp in milliseconds: 1639918800000
  Date and time (GMT): Sunday, 19 December 2021 13:00:00
  Date and time (your time zone): Sunday, 19 December 2021 13:00:00 GMT+00:00
  */
  const firstEpochTimestamp = 1639918800;

  // How many seconds are in each epoch
  const epochLengthInTimestamp = "3600";

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Large number for approval NDOL
  const largeApproval = "100000000000000000000000000000000";

  // dolnNeccLP bond BCV
  const dolnNeccLPBondBCV = "200";

  // Bond vesting length in seconds. 432000 ~ 5 days
  const bondVestingLengthInSeconds = "432000";

  // Min bond price
  const minBondPrice = "4500"; // 4500 / 1.58

  // Max bond payout
  const maxBondPayout = "100"; // 0.1%

  // 20% DAO fee for bond
  const bondFee = "2000";

  // Max debt bond can take on
  const maxBondDebt = "2000000000000000";

  // Initial Bond debt
  const intialBondDebt = "0";

  // - Seed the NDOL-NECC pair via the router
  const ammRouter = await ethers.getContractAt(
    "IUniswapV2Router01",
    ammAddress
  );
  const ammFactory = await ethers.getContractAt(
    "IUniswapV2Factory",
    ammFactoryAddress
  );

  const eth = allDeployments?.ETHToken || { address: AURORA_MAINNET_WETH };
  const Exchange = await allDeployments?.ExchangeDiamond;
  const NDOL = await allDeployments?.NdolDiamond;
  const NECCD = await allDeployments?.NeccDiamond;
  const bondDepository = allDeployments?.BondDepositoryDiamond;
  const treasury = allDeployments?.TreasuryDiamond;

  const router = await contractAt("RouterFacet", Exchange.address);
  // Approve the router to spend NDOL and NECC
  const NECC = await contractAt("NeccFacet", NECCD.address);
  await NECC.approve(ammRouter.address, largeApproval);
  console.log("Necc approved for AMM router");
  const NDOLD = await ethers.getContractFactory("NdolFacet");
  const ndol = await NDOLD.attach(NDOL.address);
  await ndol.approve(ammRouter.address, largeApproval);
  console.log("NDOL approved for AMM router");

  const BondDepositoryD = await ethers.getContractFactory(
    "BondDepositoryFacet"
  ); // ndolNeccLP
  const bondDepositoryD = await BondDepositoryD.attach(bondDepository.address);
  const ndolBondPrice = await bondDepositoryD.bondPriceInUSD(NDOL.address);
  console.log(ndolBondPrice?.toString());
  console.log("ndolBondPrice?.toString()");

  console.log((await NECC.balanceOf(deployer.address))?.toString());
  console.log("NECC.balanceOf(deployer.address)");
  let NECCToAddLiquidity = 0;
  if (chainId?.toString() === "1313161554") {
    NECCToAddLiquidity = 2;
  }
  if (chainId?.toString() === "4") {
    NECCToAddLiquidity = 2;
  }
  if (chainId?.toString() === "1337") {
    NECCToAddLiquidity = 300;

    // Get more NDOL
    await sendTxn(
      router.swapETHToTokens([eth.address, NDOL.address], 0, deployer.address, {
        value: ethers.utils.parseEther("1500"),
      }),
      "router.swapETHToTokens - ETH -> WETH -> NDOL (1500 ETH) (6,000,000 NDOL)"
    );
  }

  const stakingFacet = await contractAt("StakingFacet", bondDepository.address);

  await stakingFacet.unstake(
    expandDecimals(NECCToAddLiquidity, 18),
    deployer.address
  );
  console.log("Unstake nNECC for NECCToAddLiquidity");

  await sendTxn(
    ammRouter.addLiquidity(
      NECC.address,
      NDOL.address,
      expandDecimals(NECCToAddLiquidity, 18),
      ndolBondPrice?.mul(NECCToAddLiquidity),
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    ),
    `ammRouter.addLiquidity(
      ${NECC.address},
      ${NDOL.address},
      ${NECCToAddLiquidity} Necc,
      ${NECCToAddLiquidity} * ndol bond price in NDOL,
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    )`
  );

  const ERC20 = await ethers.getContractFactory("Token");
  const ndolNeccLPPair = await ERC20.attach(
    await ammFactory.getPair(NDOL.address, NECCD.address)
  );

  // Deploy staking distributor
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "initializeDistributor",
    epochLengthInTimestamp,
    firstEpochTimestamp,
    ndolNeccLPPair.address
  );
  console.log("BondDepository iniitalizeDistributor");

  // Set ndolNeccLPPair bond terms
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "initializeBondTerms",
    dolnNeccLPBondBCV,
    minBondPrice,
    maxBondPayout,
    bondFee,
    maxBondDebt,
    intialBondDebt,
    bondVestingLengthInSeconds,
    true,
    zeroAddress,
    ndolNeccLPPair.address
  );
  console.log("BondDepository dolnNeccLPPair init terms");

  //
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "queue",
    "5",
    ndolNeccLPPair.address
  );
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "toggle",
    "5",
    ndolNeccLPPair.address
  );
  console.log("treasury toggle 5 ndolNeccLPPair");

  // Approve the treasury to spend NDOL
  await ndolNeccLPPair.approve(treasury.address, largeApproval);
  console.log("ndolNeccLPPair approve treasury");

  // Approve ndolNeccLPPair bonds to spend deployer's dolnNeccLPPair
  await ndolNeccLPPair.approve(bondDepository.address, largeApproval);
  console.log("dolnNeccLPPair approve BondDepository");

  let ndolNeccLPDeployerBalance = await ndolNeccLPPair.balanceOf(
    deployer.address
  );
  console.log(ndolNeccLPDeployerBalance?.toString());
  console.log("ndolNeccLPPair balanceOf deployer");

  const BdD = await ethers.getContractFactory("BondDepositoryFacet");
  const bdD = await BdD.attach(bondDepository.address);
  console.log(
    (
      await bdD.payoutFor(ndolNeccLPDeployerBalance, ndolNeccLPPair.address)
    )?.toString()
  );
  console.log("bdD payoutFor ndolnNeccLPPair deployer");

  const bondingCalculatorD = await contractAt(
    "BondingCalculatorFacet",
    treasury.address
  );

  const LPValuation = await bondingCalculatorD.valuation(
    ndolNeccLPPair.address,
    ndolNeccLPDeployerBalance?.mul(99)?.div(100)
  );

  console.log(LPValuation?.toString());
  console.log("bondingCalculatorD LPValuation dolnNeccLPPair deployer");

  let NeccBalanceDeployer = await NECC.balanceOf(deployer.address);
  console.log(NeccBalanceDeployer?.toString());
  console.log("Necc balanceOf deployer before");

  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    ndolNeccLPDeployerBalance.mul(99).div(100),
    ndolNeccLPPair.address,
    LPValuation?.mul(99)?.div(100)?.div(2)
  );
  console.log("treasury deposit 99% of ndolNeccLPPair, get half profit");

  const neccBalance = await necc.balanceOf(deployer.address);
  console.log(neccBalance?.toString());
  console.log("necc balanceOf deployer");

  await necc.approve(bondDepository.address, largeApproval);
  console.log("necc approved for BondDepository");

  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "stake",
    neccBalance?.toString(),
    deployer.address
  );

  NeccBalanceDeployer = await NECC.balanceOf(deployer.address);
  console.log(NeccBalanceDeployer?.toString());
  console.log("Necc balanceOf deployer after");

  ndolNeccLPDeployerBalance = await ndolNeccLPPair.balanceOf(deployer.address);
  console.log(ndolNeccLPDeployerBalance?.toString());
  console.log("dolnNeccLPPair balanceOf deployer");

  console.log(
    (await bondDepositoryD.maxPayout(ndolNeccLPPair.address))?.toString()
  );
  console.log("BondDepositoryDiamond maxPayout dolnNeccLP");
  console.log(
    (await bondDepositoryD.bondPriceInUSD(ndolNeccLPPair.address))?.toString()
  );
  console.log("BondDepositoryDiamond bondPriceInUSD ndolNeccLP");

  console.log(
    (
      await bdD.payoutFor(ndolNeccLPDeployerBalance, ndolNeccLPPair.address)
    )?.toString()
  );
  console.log("bdD payoutFor 1% remaining ndolNeccLPPair");

  if (chainId?.toString() === "1337") {
    await sendTxn(
      ammRouter.addLiquidity(
        NECC.address,
        NDOL.address,
        expandDecimals(4000, 18),
        ndolBondPrice?.mul(4000),
        0,
        0,
        deployer.address,
        Math.round(Date.now() / 1000) + 360
      ),
      `ammRouter.addLiquidity(
      ${NECC.address},
      ${NDOL.address},
      10k Necc,
      10k * ndol bond price,
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    )`
    );
  }

  // Bond 0.0005 ~500USD ndolNeccLPPair for Necc with a max price of 60000 (max payout is 0.5%)
  // await execute(
  //   "BondDepositoryDiamond",
  //   { from: deployer.address },
  //   "deposit",
  //   dolnNeccLPDeployerBalance,
  //   "60000",
  //   deployer.address,
  //   dolnNeccLPPair.address
  // );
  const depositTx = await bondDepositoryD.deposit(
    ndolNeccLPDeployerBalance,
    "60000",
    deployer.address,
    ndolNeccLPPair.address
  );
  console.log(
    "deployer BondDepositoryDiamond deposit 1% ndolNeccLPPair ~500USD"
  );

  await reportGasUsed(
    hre.ethers.provider,
    depositTx,
    "BondDepository.deposit -  gas used"
  );

  NeccBalance = await NECC.balanceOf(deployer.address);
  console.log(NeccBalance?.toString());
  console.log("Necc balanceOf deployer");

  const StakingD = await ethers.getContractFactory("StakingFacet"); // ndolNeccLPPair
  const stakingD = await StakingD.attach(bondDepository.address);
  const epoch = await stakingD.epoch();
  const index = await stakingD.index();
  const ndolNeccLPPairFacet = await ethers.getContractFactory(
    "BondDepositoryFacet"
  );
  const ndolNeccLPPairD = await ndolNeccLPPairFacet.attach(
    bondDepository.address
  );
  const terms = await ndolNeccLPPairD.terms(ndolNeccLPPair.address);
  console.log(terms?.toString());
  console.log({ terms });
  const { distribute, number, endTime } = epoch;
  console.log(distribute?.toString());
  console.log(number.toString());
  console.log(endTime.toString());
  console.log(index?.toString());
  console.log("staking epoch: distribute, number, endTime, index");
  console.log("controlVar: ", terms?.controlVariable?.toString());

  // Misc
  // await ndolNeccLPPair.setBondTerms(1, maxBondPayout);
  // Adjusts BCV
  // await ndolNeccLPPair.setAdjustment(true, 5, 500, 0);
  // Adjusts Reward rate
  // await distributor.setAdjustment(0, true, 500, 5000);

  console.log("dolnNeccLPPair: " + ndolNeccLPPair.address);
}

module.exports = deployNDOLNeccLPBond;
module.exports.tags = ["local", "NeccFarm"];
