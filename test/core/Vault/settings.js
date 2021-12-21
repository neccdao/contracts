const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract, contractAt } = require("../../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
} = require("../../shared/utilities");
const { toChainlinkPrice } = require("../../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../../shared/units");
const { zeroAddress } = require("./helpers");
const { deployments } = require("hardhat");

use(solidity);

describe("Vault.settings", function () {
  const provider = waffle.provider;
  let vault;
  let vaultNDOL;
  let vaultConfig;
  let vaultPriceFeed;
  let ndol;
  let router;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
  let ethPriceFeed;
  let dai;
  let daiPriceFeed;
  let distributor0;
  let yieldTracker0;
  let diamond;
  let exchangeDiamond;
  let deployer, user0, user1, user2, user3;

  beforeEach(async () => {
    [deployer, user0, user1, user2, user3] = await hre.ethers.getSigners();
    diamond = await deployments.fixture(["ExchangeDiamond-hardhat"]);
    const { execute, deploy } = deployments;
    exchangeDiamond = diamond.ExchangeDiamond;
    const NDOL = diamond.NdolDiamond;
    ndol = await contractAt("NdolFacet", NDOL.address);

    vault = await contractAt("VaultFacet", exchangeDiamond.address);
    vaultConfig = await contractAt("VaultConfigFacet", exchangeDiamond.address);
    vaultNDOL = await contractAt("VaultNdolFacet", exchangeDiamond.address);

    bnb = await deployments.deploy("BNBToken", {
      contract: "Token",
      from: deployer.address,
    });
    bnbPriceFeed = await deployments.deploy("BNBPriceFeed", {
      from: deployer.address,
      contract: "PriceFeed",
    });
    bnbPriceFeed = await contractAt("PriceFeed", bnbPriceFeed.address);
  });

  it("inits", async () => {
    expect(await ndol.gov()).eq(deployer.address);
    expect(await ndol.vaults(vault.address)).eq(true);
    expect(await ndol.vaults(user0.address)).eq(false);
    expect(await vaultConfig.isInitialized()).eq(true);
    expect(await vaultNDOL.ndol()).eq(ndol.address);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
    expect(await vault.fundingRateFactor()).eq(600);
  });

  it("setGov", async () => {
    const gov = await vaultConfig.connect(user0).gov();
    expect(gov).eq(deployer.address);

    await vaultConfig.setGov(user0.address);
    expect(await vaultConfig.gov()).eq(user0.address);

    await vaultConfig.connect(user0).setGov(deployer.address);
    expect(await vaultConfig.gov()).eq(deployer.address);
  });

  it("fees", async () => {
    expect(await vaultNDOL.swapFeeBasisPoints()).eq(30);
    expect(await vault.marginFeeBasisPoints()).eq(10);
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5));
  });

  it("fundingRate", async () => {
    expect(await vault.fundingInterval()).eq(8 * 60 * 60);
    expect(await vault.fundingRateFactor()).eq(600);
  });

  it("setTokenConfig", async () => {
    const params = [
      bnb.address, // _token
      18, // _tokenDecimals
      0, // _minProfitBasisPoints
      bnbPriceFeed.address, // _priceFeed
      8, // _priceFeedDecimals
      0, // _priceSpreadBasisPoints
      10, // _tokenWeight
      zeroAddress,
      zeroAddress,
    ];

    await expect(vaultConfig.connect(user0).setTokenConfig(...params)).to.be
      .reverted;

    await expect(vaultConfig.setTokenConfig(...params)).to.be.reverted;

    expect(await vaultConfig.whitelistedTokenCount()).eq(2);
    expect(await vaultConfig.whitelistedTokens(bnb.address)).eq(false);
    expect(await vaultConfig.tokenDecimals(bnb.address)).eq(0);
    expect(await vaultConfig.redemptionBasisPoints(bnb.address)).eq(0);
    expect(await vaultConfig.minProfitBasisPoints(bnb.address)).eq(0);

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await vaultConfig.setTokenConfig(...params);

    expect(await vaultConfig.whitelistedTokenCount()).eq(3);
    expect(await vaultConfig.whitelistedTokens(bnb.address)).eq(true);
    expect(await vaultConfig.tokenDecimals(bnb.address)).eq(18);
    expect(await vaultConfig.redemptionBasisPoints(bnb.address)).eq(10000);
    expect(await vaultConfig.minProfitBasisPoints(bnb.address)).eq(0);
    expect(await vaultConfig.tokenWeights(bnb.address)).eq(10);
    expect(await vaultConfig.totalTokenWeight()).gt(100);
  });

  it("clearTokenConfig", async () => {
    const params = [
      bnb.address, // _token
      18, // _tokenDecimals
      0, // _minProfitBasisPoints
      bnbPriceFeed.address, // _priceFeed
      8, // _priceFeedDecimals
      0, // _priceSpreadBasisPoints
      10, // _tokenWeight
      zeroAddress,
      zeroAddress,
    ];

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await vaultConfig.setTokenConfig(...params);

    expect(await vaultConfig.whitelistedTokenCount()).eq(3);
    expect(await vaultConfig.whitelistedTokens(bnb.address)).eq(true);
    expect(await vaultConfig.tokenDecimals(bnb.address)).eq(18);
    expect(await vaultConfig.redemptionBasisPoints(bnb.address)).eq(10000);
    expect(await vaultConfig.minProfitBasisPoints(bnb.address)).eq(0);
    expect(await vaultConfig.tokenWeights(bnb.address)).eq(10);
    expect(await vaultConfig.totalTokenWeight()).gt(100);

    await expect(vaultConfig.connect(user0).clearTokenConfig(bnb.address)).to.be
      .reverted;

    await vaultConfig.clearTokenConfig(bnb.address);

    expect(await vaultConfig.whitelistedTokenCount()).eq(2);
    expect(await vaultConfig.whitelistedTokens(bnb.address)).eq(false);
    expect(await vaultConfig.tokenDecimals(bnb.address)).eq(0);
    expect(await vaultConfig.redemptionBasisPoints(bnb.address)).eq(0);
    expect(await vaultConfig.minProfitBasisPoints(bnb.address)).eq(0);
    expect(await vaultConfig.tokenWeights(bnb.address)).eq(0);
    expect(await vaultConfig.totalTokenWeight()).eq(100);

    await expect(vaultConfig.clearTokenConfig(bnb.address)).to.be.revertedWith(
      "Vault: token not whitelisted"
    );
  });
});
