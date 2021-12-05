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
  const { diamond, execute, deploy } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "4") {
    return;
  }
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
  const initialRewardRate = "750";

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Large number for approval NDOL
  const largeApproval = "100000000000000000000000000000000";

  // NDOL bond BCV
  const ndolBondBCV = "369";

  // Bond vesting length in seconds. 432000 ~ 5 days
  const bondVestingLengthInSeconds = "432000";

  // Min bond price
  const minBondPrice = "50000";

  // Max bond payout
  const maxBondPayout = "50"; // 0.05%

  // 25% DAO fee for bond
  const bondFee = "2500";

  // Max debt bond can take on
  // 1M %
  const maxBondDebt = "1000000000000000";

  // Initial Bond debt
  const intialBondDebt = "0";

  // Deploy Necc
  const necc = await diamond.deploy("NeccDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["NeccFacet"],
    log: true,
  });

  // Deploy NDOL
  const NDOL = diamond.NdolDiamond;
  const ndol = await contractAt("NdolFacet", NDOL.address);
  console.log((await ndol.balanceOf(DAO.address))?.toString());

  const ExchangeDiamond = await deployments.get("ExchangeDiamond");
  const router = await contractAt("RouterFacet", ExchangeDiamond.address);
  await sendTxn(
    router.swapETHToTokens(
      [RINKEBY_TESTNET_WETH, NDOL.address],
      0,
      deployer.address,
      {
        value: ethers.utils.parseEther("0.25"),
      }
    ),
    "router.swapETHToTokens - ETH -> WETH -> NDOL (0.25 ETH)"
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

  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "initializeTreasury",
    necc.address,
    ndol.address,
    0
  );
  console.log("Treasury initializeTreasury");

  // // Deploy sNecc
  const sNecc = await diamond.deploy("sNeccDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["sNeccFacet"],
    log: true,
  });

  // Deploy nNecc
  const nNecc = await diamond.deploy("nNeccDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: ["nNeccFacet"],
    log: true,
  });

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
      "BondDepositoryLib",
    ],
    log: true,
  });
  // Deploy ndolBond
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

  await execute(
    "nNeccDiamond",
    { from: deployer.address },
    "initialize",
    staking.address,
    sNecc.address
  );
  console.log("nNecc initialize");

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

  // Initialize sNecc and set the index
  await execute(
    "sNeccDiamond",
    { from: deployer.address },
    "initialize",
    staking.address,
    nNecc.address
  );
  console.log("sNecc initialize");

  await execute(
    "sNeccDiamond",
    { from: deployer.address },
    "setIndex",
    initialIndex
  );
  console.log("sNecc setIndex");

  // Set treasury for Necc token
  await execute(
    "NeccDiamond",
    { from: deployer.address },
    "setVault",
    treasury.address
  );
  console.log("necc setVault => treasury");

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

  // Deposit 500 NDOL to treasury, 80 Necc gets minted to deployer and 420 are in treasury as excesss reserves
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    "500000000000000000000",
    ndol.address,
    "420000000000"
  );
  console.log("treasury deposit 500 NDOL");

  // Bond 500 NDOL for Necc with a max price of 60000 (max payout is 0.5%)
  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "deposit",
    "5000000000000000000",
    "60000",
    deployer.address,
    ndol.address
  );
  console.log("ndolBond deposit 5 NDOL");

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
module.exports.tags = ["rinkeby", "NeccDiamond"];
