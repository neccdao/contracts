const {
  AURORA_MAINNET_WETH,
  AURORA_MAINNET_WBTC,
  AURORA_MAINNET_WNEAR,
  AURORA_MAINNET_ETH_PRICE_FEED,
  AURORA_MAINNET_BTC_PRICE_FEED,
  AURORA_MAINNET_NEAR_PRICE_FEED,
} = require("../env.json");
const { contractAt } = require("../scripts/shared/helpers");

const ethConfig = {
  address: AURORA_MAINNET_WETH,
  tokenDecimals: 18,
  priceFeedAddress: AURORA_MAINNET_ETH_PRICE_FEED,
  priceFeedDecimals: 16,
  tokenWeight: 30,
};
const btcConfig = {
  address: AURORA_MAINNET_WBTC,
  tokenDecimals: 8,
  priceFeedAddress: AURORA_MAINNET_BTC_PRICE_FEED,
  priceFeedDecimals: 16,
  tokenWeight: 20,
};

const nearConfig = {
  address: AURORA_MAINNET_WNEAR,
  tokenDecimals: 24,
  priceFeedAddress: AURORA_MAINNET_NEAR_PRICE_FEED,
  priceFeedDecimals: 16,
  tokenWeight: 50,
};

const minProfitBasisPoints = 0;
const vaultPriceFeedSpreadBasisPoints = 0;
const zeroAddress = "0x0000000000000000000000000000000000000000";

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
    ethConfig.address,
    ndol.address
  );
  console.log("ExchangeDiamond initialize");

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    ethConfig.address,
    ethConfig.tokenDecimals,
    minProfitBasisPoints,
    ethConfig.priceFeedAddress,
    ethConfig.priceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    ethConfig.tokenWeight,
    zeroAddress,
    zeroAddress
  );
  console.log("ExchangeDiamond setTokenConfig ETH");

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    btcConfig.address,
    btcConfig.tokenDecimals,
    minProfitBasisPoints,
    btcConfig.priceFeedAddress,
    btcConfig.priceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    btcConfig.tokenWeight,
    zeroAddress,
    zeroAddress
  );
  console.log("ExchangeDiamond setTokenConfig BTC");

  await execute(
    "ExchangeDiamond",
    { from: deployer.address },
    "setTokenConfig",
    nearConfig.address,
    nearConfig.tokenDecimals,
    minProfitBasisPoints,
    nearConfig.priceFeedAddress,
    nearConfig.priceFeedDecimals,
    vaultPriceFeedSpreadBasisPoints,
    nearConfig.tokenWeight,
    zeroAddress,
    zeroAddress
  );
  console.log("ExchangeDiamond setTokenConfig NEAR");

  console.log("WETH: " + ethConfig.address);
  console.log("WBTC: " + btcConfig.address);
  console.log("WNEAR: " + nearConfig.address);
  console.log("ExchangeDiamond: " + exchangeDiamond.address);
  console.log("NDOL: " + ndol.address);
  console.log("VM: " + vm.address);
  console.log("TestableVM: " + testableVM.address);
};

module.exports = deployExchangeDiamond;
module.exports.tags = ["hardhat", "ExchangeDiamond-hardhat"];
