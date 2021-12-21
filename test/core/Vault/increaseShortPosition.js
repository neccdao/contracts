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
  getDaiConfig,
  zeroAddress,
  validateVaultBalance,
} = require("./helpers");

use(solidity);

describe("Vault.increaseShortPosition", function () {
  const provider = waffle.provider;
  const [deployer, user0, user1, user2, user3] = provider.getWallets();
  let vault;
  let vaultNDOL;
  let vaultConfig;
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
      from: deployer.address,
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
      from: deployer.address,
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

  it("increasePosition short", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btc.mint(user0.address, expandDecimals(1000, 18));
    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8));

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(99),
          false
        )
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(40000),
          false
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vaultNDOL.feeReserves(btc.address)).eq(0);
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(0);

    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(0);
    await vaultNDOL.buyNDOL(btc.address, user1.address);
    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      "39880000000000000000000000000000000"
    );

    expect(await vaultNDOL.feeReserves(btc.address)).eq("300000"); // 0.003
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq(
      "39880000000000000000000"
    ); // 39880
    expect(await vaultNDOL.poolAmounts(btc.address)).eq("99700000"); // 0.997
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq("0"); // 0.997
    expect(await vaultNDOL.poolAmounts(btc.address)).eq("99700000"); // 0.997

    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 7));
    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(40000),
          false
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    let tx = await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(39000),
        false
      );
    await reportGasUsed(provider, tx, "increasePosition gas used");

    expect(await vaultNDOL.poolAmounts(btc.address)).eq("109602500");
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq("97500000");
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(
      "35039000000000000000000000000000000"
    );
    // 39026.3416
    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      "39880000000000000000000000000000000"
    );

    position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(39000)); // size
    // 3961000000000000000000000000000000
    // 39610000000000000000000000000000000
    expect(position[1]).eq(toUsd(3961)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("97500000"); // reserveAmount

    expect(await vaultNDOL.feeReserves(btc.address)).eq("397500"); // 0.00395121
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq(
      "39880000000000000000000"
    ); // 39880
    expect(await vaultNDOL.poolAmounts(btc.address)).eq("109602500");

    await validateVaultBalance(expect, vaultNDOL, btc);

    tx = await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(1000),
        false
      );
    await reportGasUsed(provider, tx, "increasePosition gas used");
  });
});
