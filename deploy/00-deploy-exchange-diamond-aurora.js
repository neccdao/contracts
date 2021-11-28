const {
  RINKEBY_TESTNET_WETH,
  RINKEBY_TESTNET_VAULT_PRICE_FEED,
  RINKEBY_TESTNET_WBTC,
  RINKEBY_TESTNET_ETH_PRICE_FEED,
  RINKEBY_TESTNET_BTC_PRICE_FEED,
} = require("../env.json");
const { contractAt } = require("../scripts/shared/helpers");

// Config variables
const eth = {
  address: "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB", // RINKEBY_TESTNET_WETH
};
const ethTokenDecimals = 18;
const ethPriceFeedDecimals = 12;
const ethTokenWeight = 60;

const btc = {
  address: "0xF4eB217Ba2454613b15dBdea6e5f22276410e89e", // RINKEBY_TESTNET_WBTC
};
const btcTokenDecimals = 8;
const btcPriceFeedDecimals = 8;
const btcTokenWeight = 40;

const near = {
  address: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d", // RINKEBY_TESTNET_WNEAR
};
const nearTokenDecimals = 24;
const nearPriceFeedDecimals = 18;
const nearTokenWeight = 40;

const minProfitBasisPoints = 0;
const vaultPriceFeedSpreadBasisPoints = 5;

const zeroAddress = "0x0000000000000000000000000000000000000000";
const usdc = {
  address: "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802", // RINKEBY_TESTNET_USDC
};
// Chainlink Price feed
const ethPriceFeed = {
  address: RINKEBY_TESTNET_ETH_PRICE_FEED,
};
const btcPriceFeed = {
  address: RINKEBY_TESTNET_BTC_PRICE_FEED,
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const deployExchangeDiamond = async function (hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute, deploy } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1313161554") {
    return;
  }
  console.log("Deploying contracts with the account: " + deployer.address);

  const vm = await deploy("VM", {
    from: deployer.address,
    log: true,
  });
  console.log("Deployed VM");
  const testableVM = await deploy("TestableVM", {
    from: deployer.address,
    args: [vm.address],
    log: true,
  });
  console.log("Deployed TestableVM");

  const ammFactory = await ethers.getContractAt(
    "IUniswapV2Factory",
    "0xc66F594268041dB60507F00703b152492fb176E7"
  );

  const btcNEARPair = await ammFactory.getPair(btc.address, near.address);
  console.log("BTC/NEAR pair", btcNEARPair);

  const nearUSDCPair = await ammFactory.getPair(near.address, usdc.address);
  console.log("NEAR/USDC pair", nearUSDCPair);

  const ethNEARPair = await ammFactory.getPair(eth.address, near.address);
  console.log("ETH/NEAR pair", ethNEARPair);

  const ethUSDCPair = await ammFactory.getPair(eth.address, usdc.address);
  console.log("ETH/USDC pair", ethUSDCPair);

  const exchangeDiamond = await diamond.deploy("ExchangeDiamond", {
    from: deployer.address,
    owner: deployer.address,
    facets: [
      "VaultFacet",
      "VaultNdolFacet",
      "VaultConfigFacet",
      "VaultLib",
      "RouterFacet",
      "RouterLib",
      "ReaderFacet",
      "VaultPriceFeedFacet",
    ],
    log: true,
  });

  const NDOL = await diamond.deploy("NdolDiamond", {
    from: deployer.address,
    facets: ["NdolFacet"],
    log: true,
  });
  const ndol = await contractAt("NdolFacet", NDOL.address);
  await ndol.initialize(exchangeDiamond.address);
  console.log("Ndol initialize");
  await wait(1000);

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "initialize",
    eth.address, // RINKEBY_TESTNET_WETH,
    ndol.address
  );
  console.log("ExchangeDiamond initialize");
  await wait(1000);

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    eth.address,
    ethTokenDecimals,
    minProfitBasisPoints,
    zeroAddress, // ethPriceFeed.address,
    ethPriceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    ethTokenWeight,
    nearUSDCPair,
    ethNEARPair
  );
  await wait(1000);
  console.log("ExchangeDiamond setTokenConfig ETH");

  // TODO: Uncomment for mainnet once BTC pair has liquidity
  // await execute(
  //   "ExchangeDiamond",
  //   { from: deployer.address },
  //   "setTokenConfig",
  //   btc.address, // _token
  //   btcTokenDecimals,
  //   minProfitBasisPoints,
  //   zeroAddress, // btcPriceFeed.address,
  //   32, // btcPriceFeedDecimals,
  //   vaultPriceFeedSpreadBasisPoints,
  //   btcTokenWeight,
  //   wNearUSDCPair,
  //   btcWNEARPair
  // );
  // console.log("ExchangeDiamond setTokenConfig BTC");

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    near.address, // _token
    nearTokenDecimals,
    minProfitBasisPoints,
    zeroAddress, // wNEARPriceFeed.address,
    nearPriceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    nearTokenWeight,
    nearUSDCPair,
    nearUSDCPair
  );
  console.log("ExchangeDiamond setTokenConfig NEAR");

  console.log("ExchangeDiamond: " + exchangeDiamond.address);
  console.log("NDOL: " + ndol.address);
  console.log("VM: " + vm.address);
  console.log("TestableVM: " + testableVM.address);
};

module.exports = deployExchangeDiamond;
module.exports.tags = ["aurora", "ExchangeDiamond"];
