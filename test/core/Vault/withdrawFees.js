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
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  zeroAddress,
} = require("./helpers");

use(solidity);

describe("Vault.withdrawFees", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3] = provider.getWallets();
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
  let dai;
  let daiPriceFeed;
  let distributor0;
  let yieldTracker0;

  beforeEach(async () => {
    diamond = await deployments.fixture(["ExchangeDiamond-hardhat"]);
    const { execute, deploy } = deployments;
    exchangeDiamond = diamond.ExchangeDiamond;

    bnb = await deployments.deploy("BNBToken", {
      contract: "Token",
      from: wallet.address,
    });
    bnb = await contractAt("Token", bnb.address);

    vault = await contractAt("VaultFacet", exchangeDiamond.address);
    vaultNDOL = await contractAt("VaultNdolFacet", exchangeDiamond.address);
    router = await contractAt("RouterFacet", exchangeDiamond.address);
    ndol = await contractAt("NdolFacet", diamond.NdolDiamond?.address);
    vaultPriceFeed = await contractAt(
      "VaultPriceFeedFacet",
      exchangeDiamond.address
    );
    reader = await contractAt("ReaderFacet", exchangeDiamond.address);

    btcPriceFeed = await deployments.get("BTCPriceFeed");
    btcPriceFeed = await contractAt("PriceFeed", btcPriceFeed.address);

    bnbPriceFeed = await deployments.deploy("BNBPriceFeed", {
      from: wallet.address,
      contract: "PriceFeed",
    });
    bnbPriceFeed = await contractAt("PriceFeed", bnbPriceFeed.address);
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    ethPriceFeed = await deployments.get("ETHPriceFeed");
    ethPriceFeed = await contractAt("PriceFeed", ethPriceFeed.address);

    eth = await contractAt(
      "Token",
      (
        await deployments.get("ETHToken")
      )?.address
    );
    btc = await contractAt(
      "Token",
      (
        await deployments.get("BTCToken")
      )?.address
    );
    vaultConfig = await contractAt("VaultConfigFacet", exchangeDiamond.address);

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
    await expect(vaultConfig.setTokenConfig(...params));
  });

  it("withdrawFees", async () => {
    await bnb.mint(user0.address, expandDecimals(900, 18));
    await bnb.connect(user0).transfer(vault.address, expandDecimals(900, 18));

    expect(await ndol.balanceOf(wallet.address)).eq(0);
    expect(await ndol.balanceOf(user1.address)).eq(0);
    expect(await vaultNDOL.feeReserves(bnb.address)).eq(0);
    expect(await vaultNDOL.ndolAmounts(bnb.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(0);

    await vaultNDOL.connect(user0).buyNDOL(bnb.address, user1.address);

    expect(await ndol.balanceOf(wallet.address)).eq(0);
    expect(await ndol.balanceOf(user1.address)).eq("448650000000000000000000"); // 269,190 NDOL, 810 fee
    expect(await vaultNDOL.feeReserves(bnb.address)).eq("2700000000000000000"); // 2.7, 900 * 0.3%
    expect(await vaultNDOL.ndolAmounts(bnb.address)).eq(
      "448650000000000000000000"
    );
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "897300000000000000000"
    ); // 897.3
    expect(await ndol.totalSupply()).eq("448650000000000000000000");

    await bnb.mint(user0.address, expandDecimals(200, 18));
    await bnb.connect(user0).transfer(vault.address, expandDecimals(200, 18));

    await btc.mint(user0.address, expandDecimals(2, 8));
    await btc.connect(user0).transfer(vault.address, expandDecimals(2, 8));

    await vaultNDOL.connect(user0).buyNDOL(btc.address, user1.address);
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq(
      "119640000000000000000000"
    ); // 119,640
    expect(await ndol.totalSupply()).eq("568290000000000000000000"); // 388,830

    await btc.mint(user0.address, expandDecimals(2, 8));
    await btc.connect(user0).transfer(vault.address, expandDecimals(2, 8));

    await vaultNDOL.connect(user0).buyNDOL(btc.address, user1.address);
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq(
      "239436000000000000000000"
    ); // 239,280

    expect(await vaultNDOL.ndolAmounts(bnb.address)).eq(
      "448650000000000000000000"
    ); // 269,190
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "897300000000000000000"
    ); // 897.3

    await vaultNDOL.connect(user0).buyNDOL(bnb.address, user1.address);

    expect(await vaultNDOL.ndolAmounts(bnb.address)).eq(
      "548350000000000000000000"
    ); // 329,010
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "1096700000000000000000"
    ); // 1096.7

    expect(await vaultNDOL.feeReserves(bnb.address)).eq("3300000000000000000"); // 3.3 BNB
    expect(await vaultNDOL.feeReserves(btc.address)).eq("940000"); // 0.012 BTC

    await expect(
      vaultConfig.connect(user0).withdrawFees(bnb.address, user2.address)
    ).to.be.revertedWith("LibDiamond: invalid contract owner");

    expect(await bnb.balanceOf(user2.address)).eq(0);
    await vaultConfig.withdrawFees(bnb.address, user2.address);
    expect(await bnb.balanceOf(user2.address)).eq("3300000000000000000");

    expect(await btc.balanceOf(user2.address)).eq(0);
    await vaultConfig.withdrawFees(btc.address, user2.address);
    expect(await btc.balanceOf(user2.address)).eq("940000");
  });
});
