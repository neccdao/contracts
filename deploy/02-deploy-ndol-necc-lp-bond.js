const {
  RINKEBY_TESTNET_AMM,
  RINKEBY_TESTNET_AMM_FACTORY,
  RINKEBY_TESTNET_ETH_PRICE_FEED,
  RINKEBY_TESTNET_NDOL_NECC_PAIR,
  RINKEBY_TESTNET_NECC,
  RINKEBY_TESTNET_TREASURY,
  RINKEBY_TESTNET_BONDING_CALCULATOR,
  RINKEBY_TESTNET_DISTRIBUTOR,
  RINKEBY_TESTNET_NNECC,
  RINKEBY_TESTNET_STAKING,
  RINKEBY_TESTNET_STAKING_HELPER,
  RINKEBY_TESTNET_NDOL_BOND,
} = require("../env.json");
const { sendTxn } = require("../scripts/shared/helpers");
const { expandDecimals } = require("../test/shared/utilities.js");

async function deployNDOLNeccLPBond(hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  return;
  console.log("Deploying contracts with the account: " + deployer.address);
  // Initial staking index
  const initialIndex = "1000000000";

  // First epoch occurs
  const firstEpochTimestamp = Math.round(Date.now() / 1000) + 360; // 1 minute from now

  // What epoch will be first epoch
  const firstEpochNumber = "1";

  // How many seconds are in each epoch
  const epochLengthInTimestamp = "33000";

  // Initial reward rate for epoch
  const initialRewardRate = "3000";

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Large number for approval NDOL
  const largeApproval = "100000000000000000000000000000000";

  // ndolNeccLP bond BCV
  const ndolNeccLPBondBCV = "300";

  // Bond vesting length in seconds. 432000 ~ 5 days
  const bondVestingLengthInSeconds = "432000";

  // Min bond price
  const minBondPrice = "1600";

  // Max bond payout
  const maxBondPayout = "50"; // 0.05%

  // 25% DAO fee for bond
  const bondFee = "2500";

  // Max debt bond can take on
  // 33000 %
  const maxBondDebt = "33000000000000";

  // Initial Bond debt
  const intialBondDebt = "0";

  // - Seed the NDOL-NECC pair via the router
  const ammRouter = await ethers.getContractAt(
    "IUniswapV2Router01",
    "0x2CB45Edb4517d5947aFdE3BEAbF95A582506858B" || RINKEBY_TESTNET_AMM
  );
  const ammFactory = await ethers.getContractAt(
    "IUniswapV2Factory",
    "0xc66F594268041dB60507F00703b152492fb176E7" || RINKEBY_TESTNET_AMM_FACTORY
  );
  const NDOL = diamond.NdolDiamond;
  const Necc = await deployments.get("Necc");
  // Approve the router to spend NDOL and Necc
  const NeccD = await ethers.getContractFactory("Necc");
  const necc = await NeccD.attach(Necc.address);
  await necc.approve(ammRouter.address, largeApproval);
  console.log("Necc approved for AMM router");
  const NDOLD = await ethers.getContractFactory("NDOL");
  const ndol = await NDOLD.attach(NDOL.address);
  await ndol.approve(ammRouter.address, largeApproval);
  console.log("NDOL approved for AMM router");

  // Add 50k:50k worth to the reserve
  // 62.5NDOL:1Necc
  // $500 bond is ~8 Necc
  // 50000 / 62.5 = ~800 Necc

  // ... external returns (uint amountA, uint amountB, uint liquidity);
  await sendTxn(
    ammRouter.addLiquidity(
      Necc.address,
      NDOL.address,
      expandDecimals(800, 9),
      expandDecimals(50000, 18),
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    ),
    `ammRouter.addLiquidity(
      ${Necc.address},
      ${NDOL.address},
      800 Necc,
      50k NDOL,
      0,
      0,
      deployer.address,
      Math.round(Date.now() / 1000) + 360
    )`
  );

  const ERC20 = await ethers.getContractFactory("Token");
  const ndolNeccLPPair = await ERC20.attach(
    await ammFactory.getPair(NDOL.address, Necc.address)
  );

  const bondDepository = await deployments.get("BondDepositoryDiamond");
  const treasury = await deployments.get("TreasuryDiamond");

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
    ndolNeccLPBondBCV,
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
  console.log("BondDepository ndolNeccLPPair init terms");

  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "queue",
    "4",
    bondDepository.address
  );
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "toggle",
    "4",
    bondDepository.address
  );
  console.log("treasury toggle 4 BondDepository");
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

  // Approve ndolNeccLPPair bonds to spend deployer's ndolNeccLPPair
  await ndolNeccLPPair.approve(bondDepository.address, largeApproval);
  console.log("ndolNeccLPPair approve BondDepository");

  const ndolNeccLPDeployerBalance = await ndolNeccLPPair.balanceOf(
    deployer.address
  );
  console.log(ndolNeccLPDeployerBalance?.toString());
  console.log("ndolNeccLPPair balanceOf deployer");

  const BdD = await ethers.getContractFactory("BondDepositoryFacet"); // ndolNeccLPPair
  const bdD = await BdD.attach(bondDepository.address);
  const TreasuryD = await ethers.getContractFactory("BondingCalculatorFacet"); // ndolNeccLPPair
  const treasuryD = await TreasuryD.attach(bondDepository.address);
  console.log(
    (
      await bdD.payoutFor(ndolNeccLPDeployerBalance, ndolNeccLPPair.address)
    )?.toString()
  );
  console.log("bdD payoutFor ndolNeccLPPair deployer");

  const BondingCalculatorD = await ethers.getContractFactory(
    "BondingCalculatorFacet"
  ); // ndolNeccLP
  const bondingCalculatorD = await BondingCalculatorD.attach(
    bondDepository.address
  );

  const LPValuation = await bondingCalculatorD.valuation(
    ndolNeccLPPair.address,
    ndolNeccLPDeployerBalance
  );

  // ~0.1 == 6324.555320335 Necc == 50k
  // ~0.2 == 12649.11 Necc == 100k
  console.log(LPValuation?.toString());
  console.log(
    "bondingCalculatorD LPValuation ndolNeccLPPair deployer - 0.2 SLP"
  );

  // 14200 Necc
  let neccBalanceDeployer = await necc.balanceOf(deployer.address);
  console.log(neccBalanceDeployer?.toString());
  console.log("necc balanceOf deployer before");

  // Deposit 0.1994 = ~100,000 NDOL worth of ndolNeccLP to treasury
  // ~2012 Necc gets minted to deployer and 10600 (~84%) are in treasury as excesss reserves
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    "199400000000000000", // 0.1994 SLP
    ndolNeccLPPair.address,
    "10600000000000"
  );
  console.log("treasury deposit 0.1994 ndolNeccLPPair");

  // 16212 Necc
  neccBalanceDeployer = await necc.balanceOf(deployer.address);
  console.log(neccBalanceDeployer?.toString());
  console.log("necc balanceOf deployer after");

  // Stake 1 Necc
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "stake",
    "1000000000",
    deployer.address
  );
  console.log("deployer BondDepositoryDiamond stake 1 necc");

  const BondDepositoryD = await ethers.getContractFactory(
    "BondDepositoryFacet"
  ); // ndolNeccLP
  const bondDepositoryD = await BondDepositoryD.attach(bondDepository.address);
  console.log(
    (await bondDepositoryD.maxPayout(ndolNeccLPPair.address))?.toString()
  );
  console.log("BondDepositoryDiamond maxPayout ndolNeccLP");
  console.log(
    (await bondDepositoryD.bondPriceInUSD(ndolNeccLPPair.address))?.toString()
  );
  console.log("BondDepositoryDiamond bondPriceInUSD ndolNeccLP");

  console.log(
    (await bdD.payoutFor("500000000000000", ndolNeccLPPair.address))?.toString()
  );
  console.log("bdD payoutFor 0.0005 ndolNeccLPPair");

  // Bond 0.0005 ~500USD ndolNeccLPPair for Necc with a max price of 60000 (max payout is 0.5%)
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "deposit",
    "500000000000000",
    "60000",
    deployer.address,
    ndolNeccLPPair.address
  );
  console.log(
    "deployer BondDepositoryDiamond deposit 0.0005 ndolNeccLPPair ~500USD"
  );

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

  console.log("ndolNeccLPPair: " + ndolNeccLPPair.address);
}

module.exports = deployNDOLNeccLPBond;
module.exports.tags = ["local", "ndolNeccLPBond"];
