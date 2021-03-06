const {
  AURORA_MAINNET_WETH,
  AURORA_MAINNET_DAO_ADDRESS,
} = require("../env.json");
const { contractAt, sendTxn } = require("../scripts/shared/helpers");
const { expandDecimals } = require("../test/shared/utilities");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deployNecc(hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute, deploy, all } = deployments;
  const [deployer] = await ethers.getSigners();
  const DAO = { address: AURORA_MAINNET_DAO_ADDRESS };
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1313161554") {
    return;
  }
  // if (chainId?.toString() !== "1337") {
  //   return;
  // }
  const allDeployments = await all();
  console.log("Deploying contracts with the account: " + deployer.address);

  // Initial staking index
  const initialIndex = "1000000000";

  // First epoch occurs
  /*
  Epoch timestamp: 1639918800
  Timestamp in milliseconds: 1639918800000
  Date and time (GMT): Sunday, 19 December 2021 13:00:00
  Date and time (your time zone): Sunday, 19 December 2021 13:00:00 GMT+00:00
  */
  const firstEpochTimestamp = 1639918800;

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
  const ndolBondBCV = "300";

  // Bond vesting length in seconds. 432000 ~ 5 days
  const bondVestingLengthInSeconds = "432000";

  // Min bond price
  const minBondPrice = "20000";

  // Max bond payout
  const maxBondPayout = "100"; // 0.1%

  // 20% DAO fee for bond
  const bondFee = "2000";

  // Max debt bond can take on
  const maxBondDebt = "2000000000000000";

  // Initial Bond debt
  const intialBondDebt = "0";

  // Ndol
  const NDOL = allDeployments.NdolDiamond;
  const ndol = await contractAt("NdolFacet", NDOL.address);
  console.log((await ndol.balanceOf(DAO.address))?.toString());

  const eth = await contractAt("Token", AURORA_MAINNET_WETH);
  const ExchangeDiamond = allDeployments.ExchangeDiamond;
  const router = await contractAt("RouterFacet", ExchangeDiamond.address);
  await sendTxn(
    router.swapETHToTokens([eth.address, NDOL.address], 0, deployer.address, {
      value: ethers.utils.parseEther("1.25"),
    }),
    "router.swapETHToTokens - ETH -> WETH -> NDOL (1.25 ETH) (~5000 NDOL)"
  );
  await wait(5000);
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

  // Deploy sNecc
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
  const bondDepositoryDiamond = await diamond.deploy("BondDepositoryDiamond", {
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
  const ndolBond = { address: bondDepositoryDiamond.address };
  const staking = { address: bondDepositoryDiamond.address };

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

  // Deploy staking distributor
  const distributor = { address: bondDepositoryDiamond.address };
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
  const bondingCalculator = { address: bondDepositoryDiamond.address };
  const BondingCalculator = await ethers.getContractFactory(
    "BondingCalculatorFacet"
  );
  const standardBondingCalculatorD = await BondingCalculator.attach(
    bondingCalculator.address
  );
  const treasuryD = await contractAt("TreasuryFacet", treasury.address);

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
    "nNeccDiamond",
    { from: deployer.address },
    "initialize",
    staking.address,
    sNecc.address
  );
  console.log("nNecc initialize");

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
  await treasuryD.queue("8", bondDepositoryDiamond.address);
  await treasuryD.toggle("8", bondDepositoryDiamond.address);
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

  const sNeccD = await contractAt("sNeccFacet", sNecc.address);
  approvalTx = await sNeccD.approve(staking.address, largeApproval);
  await approvalTx.wait(1);
  console.log("sNecc approve staking");

  const nNeccD = await contractAt("nNeccFacet", nNecc.address);

  const ndolAmount = 12;
  // Deposit NDOL to treasury, deployer gets half back
  await execute(
    "TreasuryDiamond",
    { from: deployer.address },
    "deposit",
    expandDecimals(ndolAmount, 18),
    ndol.address,
    expandDecimals(ndolAmount / 2, 9)
  );
  console.log(`treasury deposit ${ndolAmount} NDOL`);
  console.log(`deployer receives ${ndolAmount / 2} NECC`);

  let neccBalance = await neccD.balanceOf(deployer.address);
  console.log(neccBalance?.toString());
  console.log("necc balanceOf deployer");

  await execute(
    "BondDepositoryDiamond",
    { from: deployer.address },
    "stake",
    neccBalance?.toString(),
    deployer.address
  );

  console.log("deployer stake necc balance");
  neccBalance = await neccD.balanceOf(deployer.address);
  console.log(neccBalance?.toString());
  console.log("necc balanceOf deployer");
  const sNeccBalance = await sNeccD.balanceOf(deployer.address);
  console.log(sNeccBalance?.toString());
  console.log("sNecc balanceOf deployer");

  const nNeccBalance = await nNeccD.balanceOf(deployer.address);
  console.log(nNeccBalance?.toString());
  console.log("nNecc balanceOf deployer");

  const StakingD = await ethers.getContractFactory("StakingFacet"); // NDOL
  const stakingD = await StakingD.attach(staking.address);
  const epoch = await stakingD.epoch();
  const index = await stakingD.index();
  const NDOLBondFacet = await ethers.getContractFactory("BondDepositoryFacet");
  const ndolBondD = await NDOLBondFacet.attach(bondDepositoryDiamond.address);
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
