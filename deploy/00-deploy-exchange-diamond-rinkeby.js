const {
  RINKEBY_TESTNET_WETH,
  RINKEBY_TESTNET_VAULT_PRICE_FEED,
  RINKEBY_TESTNET_WBTC,
  RINKEBY_TESTNET_USDC,
  RINKEBY_TESTNET_ETH_PRICE_FEED,
  RINKEBY_TESTNET_BTC_PRICE_FEED,
} = require("../env.json");
const { contractAt } = require("../scripts/shared/helpers");

// Config variables
const eth = {
  address: RINKEBY_TESTNET_WETH,
};
const ethTokenDecimals = 18;
const ethPriceFeedDecimals = 8;
const ethTokenWeight = 60;

const btc = {
  address: RINKEBY_TESTNET_WBTC,
};
const btcTokenDecimals = 8;
const btcPriceFeedDecimals = 8;
const btcTokenWeight = 40;

// const near = {
//   address: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d", // RINKEBY_TESTNET_WNEAR
// };
// const nearTokenDecimals = 24;
// const nearPriceFeedDecimals = 18;
// const nearTokenWeight = 40;

const minProfitBasisPoints = 0;
const vaultPriceFeedSpreadBasisPoints = 5;

const zeroAddress = "0x0000000000000000000000000000000000000000";
const usdc = {
  address: RINKEBY_TESTNET_USDC,
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
  if (chainId?.toString() !== "4") {
    return;
  }

  console.log("Deploying contracts with the account: " + deployer.address);
  console.log("*** Deploying for rinkeby ***");

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
  await wait(10000);

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "initialize",
    eth.address,
    ndol.address
  );
  console.log("ExchangeDiamond initialize");
  await wait(10000);

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    eth.address,
    ethTokenDecimals,
    minProfitBasisPoints,
    ethPriceFeed.address,
    ethPriceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    ethTokenWeight,
    zeroAddress,
    zeroAddress
  );
  await wait(10000);
  console.log("ExchangeDiamond setTokenConfig ETH");

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    btc.address,
    btcTokenDecimals,
    minProfitBasisPoints,
    btcPriceFeed.address,
    btcPriceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    btcTokenWeight,
    zeroAddress,
    zeroAddress
  );
  console.log("ExchangeDiamond setTokenConfig BTC");

  console.log("ExchangeDiamond: " + exchangeDiamond.address);
  console.log("NDOL: " + ndol.address);
  console.log("VM: " + vm.address);
  console.log("TestableVM: " + testableVM.address);
};

module.exports = deployExchangeDiamond;
module.exports.tags = ["rinkeby", "ExchangeDiamond"];
