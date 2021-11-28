const {
  RINKEBY_TESTNET_WETH,
  RINKEBY_TESTNET_VAULT_PRICE_FEED,
  RINKEBY_TESTNET_WBTC,
  RINKEBY_TESTNET_USDC,
  RINKEBY_TESTNET_ETH_PRICE_FEED,
  RINKEBY_TESTNET_BTC_PRICE_FEED,
} = require("../env.json");
const { contractAt } = require("../scripts/shared/helpers");
const { toChainlinkPrice } = require("../test/shared/chainlink");

const ethConfig = {
  tokenDecimals: 18,
  priceFeedDecimals: 8,
  tokenWeight: 60,
};
const btcConfig = {
  tokenDecimals: 8,
  priceFeedDecimals: 8,
  tokenWeight: 40,
};

// const near = {
//   address: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d", // RINKEBY_TESTNET_WNEAR
// };
// const nearTokenDecimals = 24;
// const nearPriceFeedDecimals = 18;
// const nearTokenWeight = 40;

const minProfitBasisPoints = 0;
const vaultPriceFeedSpreadBasisPoints = 0;
const zeroAddress = "0x0000000000000000000000000000000000000000";

const deployExchangeDiamond = async function (hre) {
  const { deployments, ethers } = hre;
  const { diamond, execute, deploy } = deployments;
  const [deployer, DAO] = await ethers.getSigners();
  const chainId = await getChainId();
  console.log({ chainId });
  if (chainId?.toString() !== "1337") {
    return;
  }
  console.log("Deploying contracts with the account: " + deployer.address);
  console.log("*** Deploying for hardhat test ***");

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

  let ethPriceFeed = await deployments.deploy("ETHPriceFeed", {
    contract: "PriceFeed",
    from: deployer.address,
  });
  let btcPriceFeed = await deployments.deploy("BTCPriceFeed", {
    contract: "PriceFeed",
    from: deployer.address,
  });
  const bnb = await deployments.deploy("BNBToken", {
    contract: "Token",
    from: deployer.address,
  });
  const btc = await deployments.deploy("BTCToken", {
    contract: "Token",
    from: deployer.address,
  });
  const eth = await deployments.deploy("ETHToken", {
    contract: "Token",
    from: deployer.address,
  });
  const dai = await deployments.deploy("DAIToken", {
    contract: "Token",
    from: deployer.address,
  });
  console.log("Deployed Tokens");

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
  console.log("Deployed ExchangeDiamond");

  const NDOL = await diamond.deploy("NdolDiamond", {
    from: deployer.address,
    facets: ["NdolFacet"],
    log: true,
  });
  const ndol = await contractAt("NdolFacet", NDOL.address);
  await ndol.initialize(exchangeDiamond.address);
  console.log("Ndol initialize");

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "initialize",
    eth.address,
    ndol.address
  );
  console.log("ExchangeDiamond initialize");

  ethPriceFeed = await contractAt("PriceFeed", ethPriceFeed.address);
  await ethPriceFeed.setLatestAnswer(toChainlinkPrice(4000));
  console.log("ETHPriceFeed setLatestAnswer");

  const x = await ethPriceFeed.latestAnswer();
  console.log(x?.toString());

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    eth.address,
    ethConfig.tokenDecimals,
    minProfitBasisPoints,
    ethPriceFeed.address,
    ethConfig.priceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    ethConfig.tokenWeight,
    zeroAddress,
    zeroAddress
  );
  console.log("ExchangeDiamond setTokenConfig ETH");

  btcPriceFeed = await contractAt("PriceFeed", btcPriceFeed.address);
  await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    btc.address,
    btcConfig.tokenDecimals,
    minProfitBasisPoints,
    btcPriceFeed.address,
    btcConfig.priceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    btcConfig.tokenWeight,
    zeroAddress,
    zeroAddress
  );
  console.log("ExchangeDiamond setTokenConfig BTC");

  console.log("WETH: " + eth.address);
  console.log("WBTC: " + btc.address);
  console.log("ExchangeDiamond: " + exchangeDiamond.address);
  console.log("NDOL: " + ndol.address);
  console.log("VM: " + vm.address);
  console.log("TestableVM: " + testableVM.address);
};

module.exports = deployExchangeDiamond;
module.exports.tags = ["hardhat", "ExchangeDiamond-hardhat"];
