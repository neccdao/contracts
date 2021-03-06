const {
  RINKEBY_TESTNET_WETH,
  RINKEBY_TESTNET_NECC,
  RINKEBY_TESTNET_TREASURY,
  RINKEBY_TESTNET_BONDING_CALCULATOR,
  RINKEBY_TESTNET_DISTRIBUTOR,
  RINKEBY_TESTNET_NNECC,
  RINKEBY_TESTNET_STAKING,
  RINKEBY_TESTNET_STAKING_HELPER,
  RINKEBY_TESTNET_NDOL_BOND,
} = require("../env.json");
const { contractAt, sendTxn } = require("../scripts/shared/helpers");

const eth = {
  address: "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB", // RINKEBY_TESTNET_WETH
};
const near = {
  address: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d", // RINKEBY_TESTNET_WNEAR
};

async function deployNecc(hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute, deploy, all } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1337") {
    return;
  }
  const allDeployments = await all();
  console.log("*** Deploying for hardhat test ***");
  console.log("Deploying contracts with the account: " + deployer.address);

  // Initial staking index
  const initialIndex = "1000000000";

  // First epoch occurs
  const firstEpochTimestamp = Math.round(Date.now() / 1000) + 360; // 1 minute from now

  // What epoch will be first epoch
  const firstEpochNumber = "1";

  // How many seconds are in each epoch - 1 hour
  const epochLengthInSeconds = "3600";

  // Initial reward rate for epoch
  const initialRewardRate = "400";

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Large number for approval NDOL
  const largeApproval = "100000000000000000000000000000000";

  // NDOL bond BCV
  const ndolBondBCV = "1000";

  // Bond vesting length in seconds. 432000 ~ 5 days
  const bondVestingLengthInSeconds = "432000";

  // Min bond price
  const minBondPrice = "20000";

  // Max bond payout
  const maxBondPayout = "75"; // 0.075%

  // 25% DAO fee for bond
  const bondFee = "2500";

  // Max debt bond can take on
  // 1M %
  const maxBondDebt = "1000000000000000";

  // Initial Bond debt
  const intialBondDebt = "0";

  // Ndol
  const NDOL = allDeployments.NdolDiamond;
  const ndol = await contractAt("NdolFacet", NDOL.address);
  console.log((await ndol.balanceOf(DAO.address))?.toString());

  const eth = allDeployments?.ETHToken;
  const ExchangeDiamond = allDeployments.ExchangeDiamond;
  const router = await contractAt("RouterFacet", ExchangeDiamond.address);
  await sendTxn(
    router.swapETHToTokens([eth.address, NDOL.address], 0, deployer.address, {
      value: ethers.utils.parseEther("1500"),
    }),
    "router.swapETHToTokens - ETH -> WETH -> NDOL (1500 ETH) (6,000,000 NDOL)"
  );
  console.log((await ndol.balanceOf(deployer.address))?.toString());
  console.log("ndol balanceOf deployer");

  // Deploy treasury
  //@dev changed function in treaury from 'valueOf' to 'valueOfToken'... solidity function was coflicting w js object property name
  const deployedTreasury = await diamond.deploy("TreasuryDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["TreasuryFacet", "BondingCalculatorFacet"],
    log: true,
  });
  const treasury = { address: deployedTreasury.address };
  // Deploy Necc
  const necc = await diamond.deploy("NeccDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["NeccFacet"],
    log: true,
  });
  console.log("Deploy Necc");
  await execute(
    "NeccDiamond",
    { from: deployer.address },
    "initialize",
    treasury.address
  );
  console.log("necc initialize");

  const NNecc = await diamond.deploy("nNeccDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["nNeccFacet"],
    log: true,
  });
  const nNecc = await contractAt("nNeccFacet", NNecc.address);

  // Deploy sNecc
  const sNecc = await diamond.deploy("sNeccDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["sNeccFacet"],
    log: true,
  });
  console.log("Deploy sNecc");

  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "initializeTreasury",
    necc.address,
    sNecc.address,
    nNecc.address,
    ndol.address,
    0
  );
  console.log("Treasury initializeTreasury");

  // // Deploy NDOL bond
  // //@dev changed function call to Treasury of 'valueOf' to 'valueOfToken' in BondDepository due to change in Treausry contract
  const deployedNDOLBond = await diamond.deploy("BondDepositoryDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: [
      "BondConfigFacet",
      "BondDepositoryLib",
      "BondDepositoryFacet",
      "DistributorFacet",
      "StakingFacet",
    ],
    log: true,
  });
  const ndolBond = { address: deployedNDOLBond.address };
  const staking = { address: deployedNDOLBond.address };

  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "initializeBondDepository",
    ndol.address,
    necc.address,
    treasury.address,
    DAO.address
  );
  console.log("BondDepository initializeBondDepository");

  await execute(
    "nNeccDiamond",
    { from: deployer.address },
    "initialize",
    staking.address,
    sNecc.address
  );
  console.log("nNecc initialize");

  // sNecc initialize
  await execute(
    "sNeccDiamond",
    { from: deployer.address },
    "initialize",
    staking.address,
    nNecc.address,
    treasury.address
  );
  console.log("sNecc initialize");

  // nNecc initialize

  // Deploy staking distributor
  const distributor = { address: deployedNDOLBond.address };
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "initializeDistributor",
    epochLengthInSeconds,
    firstEpochTimestamp,
    ndol.address
  );
  console.log("BondDepository initializeDistributor");

  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "initializeStaking",
    firstEpochNumber,
    firstEpochTimestamp,
    sNecc.address,
    nNecc.address
  );
  console.log("BondDepository initializeStaking");

  // Bonding calculator
  const bondingCalculator = { address: deployedNDOLBond.address };
  const BondingCalculator = await ethers.getContractFactory(
    "BondingCalculatorFacet"
  );
  const standardBondingCalculatorD = await BondingCalculator.attach(
    treasury.address
  );

  // Set NDOL bond terms
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "initializeBondTerms",
    ndolBondBCV,
    minBondPrice,
    maxBondPayout,
    bondFee,
    maxBondDebt,
    intialBondDebt,
    bondVestingLengthInSeconds,
    false,
    zeroAddress,
    ndol.address
  );
  console.log("BondDepository initializeBondTerms ndolBond");

  await execute(
    "sNeccDiamond",
    { from: deployer.address },
    "setIndex",
    initialIndex
  );
  console.log("sNecc setIndex");

  // Add staking contract as distributor recipient
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "addRecipient",
    staking.address,
    initialRewardRate
  );
  console.log("distributor addRecipient");

  // // queue and toggle NDOL bond reserve depositor
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "queue",
    "0",
    ndolBond.address
  );
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "toggle",
    "0",
    ndolBond.address
  );
  console.log("treasury toggle 0 ndolBond");
  // queue and toggle reward manager
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "queue",
    "8",
    distributor.address
  );
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "toggle",
    "8",
    distributor.address
  );
  console.log("treasury toggle 8 distributor");

  // queue and toggle deployer reserve depositor
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "queue",
    "0",
    deployer.address
  );
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "toggle",
    "0",
    deployer.address
  );
  console.log("treasury toggle 0 deployer");

  // queue and toggle liquidity depositor
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "queue",
    "4",
    deployer.address
  );
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "toggle",
    "4",
    deployer.address
  );
  console.log("treasury toggle 4 deployer");

  // Approve the treasury to spend NDOL
  await ndol.approve(treasury.address, largeApproval);
  console.log("ndol approve treasury");

  // Approve NDOL bonds to spend deployer's NDOL
  await ndol.approve(ndolBond.address, largeApproval);
  console.log("ndol approve ndolBond");

  // // Approve staking to spend deployer's Necc
  const neccD = await contractAt("NeccFacet", necc.address);
  let approvalTx = await neccD.approve(staking.address, largeApproval);
  await approvalTx.wait(1);
  console.log("necc approve staking");

  // Deposit NDOL to treasury, deployer gets half back
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    "5000000000000000000000000",
    ndol.address,
    "2500000000000000"
  );
  console.log("treasury deposit 5M NDOL");
  console.log("deployer receives 2.5M NECC");

  const neccBalance = await neccD.balanceOf(deployer.address);

  // Stake Necc
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "stake",
    neccBalance,
    deployer.address
  );
  console.log("stake necc for nNecc, half profit");

  const b = await neccD.balanceOf(deployer.address);
  console.log(b?.toString());
  console.log("necc balanceOf deployer");

  const n = await nNecc.balanceOf(deployer.address);
  console.log(n?.toString());
  console.log("nNecc balanceOf deployer");

  // Bond 500 NDOL for Necc with a max price of 60000 (max payout is 0.5% of circulating supply)
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "deposit",
    "5000000000000000000000",
    "60000",
    deployer.address,
    ndol.address
  );
  console.log("ndolBond deposit 5000 NDOL");

  const StakingD = await ethers.getContractFactory("StakingFacet"); // NDOL
  const stakingD = await StakingD.attach(staking.address);
  const epoch = await stakingD.epoch();
  const index = await stakingD.index();
  const NDOLBondFacet = await ethers.getContractFactory("BondDepositoryFacet");
  const ndolBondD = await NDOLBondFacet.attach(deployedNDOLBond.address);
  const terms = await ndolBondD.terms(ndol.address);
  // console.log({ terms });
  const { distribute, number, endTime } = epoch;
  console.log("staking epoch: distribute, number, endTime, index");
  console.log(distribute?.toString());
  console.log(number.toString());
  console.log(endTime.toString());
  console.log(index?.toString());
  console.log("controlVar: ", terms?.controlVariable?.toString());

  // Misc
  // await ndolBond.setBondTerms(1, maxBondPayout);
  // Adjusts BCV
  // await ndolBond.setAdjustment(true, 5, 500, 0);
  // Adjusts Reward rate
  // await distributor.setAdjustment(0, true, 500, 5000);

  console.log("NDOL: " + ndol.address);
  console.log("Necc: " + necc.address);
  console.log("sNecc: " + sNecc.address);
  console.log("nNecc: " + nNecc.address);
  console.log("Treasury: " + treasury.address);
  console.log("BondingCalculator: " + bondingCalculator.address);
  console.log("Staking: " + staking.address);
  console.log("Distributor " + distributor.address);
  console.log("BondDepository: " + ndolBond.address);
}

module.exports = deployNecc;
module.exports.tags = ["NeccDiamond-hardhat"];
