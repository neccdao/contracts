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
} = require("./helpers");

use(solidity);

describe("Vault.closeShortPosition", function () {
  const provider = waffle.provider;
  const [deployer, DAO, , , user3] = provider.getWallets();
  let vault;
  let vaultNDOL;
  let vaultPriceFeed;
  let ndol;
  let router;
  let eth;
  let ethPriceFeed;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
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

    bnbPriceFeed = await deployments.deploy("BNBPriceFeed", {
      from: deployer.address,
      contract: "PriceFeed",
    });
    bnbPriceFeed = await contractAt("PriceFeed", bnbPriceFeed.address);
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    btcPriceFeed = await deployments.get("BTCPriceFeed");
    btcPriceFeed = await contractAt("PriceFeed", btcPriceFeed.address);
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

  it("close short position", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await bnb.mint(DAO.address, expandDecimals(1000, 18));
    await bnb.connect(DAO).transfer(vault.address, expandDecimals(100, 18));
    await vaultNDOL.buyNDOL(bnb.address, DAO.address);
    expect(await vaultNDOL.feeReserves(bnb.address)).eq("300000000000000000"); // 0.3
    expect(await bnb.balanceOf(DAO.address)).eq("900000000000000000000");

    await bnb.connect(DAO).transfer(vault.address, expandDecimals(10, 18));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        bnb.address,
        bnb.address,
        toUsd(3000),
        false
      );
    console.log("Increased position");
    let position = await vault.getPosition(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    // 3100000000000000000000000000000000
    // 90000000000000000000000000000000
    expect(position[0]).eq(toUsd(3000)); // size
    // 2997000000000000000000000000000000
    // 9910000000000000000000000000000
    expect(position[1]).eq(toUsd(2997)); // collateral, 3000 - 3000 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    // 10000000000000000000
    // 90000000000000000000
    // NOTE - Now in collateral token (BNB)
    expect(position[4]).eq(expandDecimals(10, 18)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    // 10% down in price
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(270));
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(270));
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(270));
    let delta = await vault.getPositionDelta(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(delta[0]).eq(true);
    // 300000000000000000000000000000000
    // 9000000000000000000000000000000
    expect(delta[1]).eq(toUsd(300));

    let leverage = await vault.getPositionLeverage(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(leverage).eq(10010); // ~1X leverage
    // 310000000000000000
    // 130000000000000000
    expect(await vaultNDOL.feeReserves(bnb.address)).eq("310000000000000000"); // 0.31, 0.3 + 0.01
    // 10000000000000000000
    // 90000000000000000000
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(
      expandDecimals(10, 18)
    );
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(toUsd(3));
    // 109690000000000000000
    // 99960000000000000000
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "109690000000000000000"
    ); // 109.69 == 110 - 0.31 feeReserves
    expect(await bnb.balanceOf(DAO.address)).eq("890000000000000000000");
    const tx = await vault
      .connect(DAO)
      .decreasePosition(
        DAO.address,
        bnb.address,
        bnb.address,
        toUsd(300),
        toUsd(3000),
        false,
        DAO.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    position = await vault.getPosition(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    // 321111111111111111
    // 220000000000000000
    expect(await vaultNDOL.feeReserves(bnb.address)).eq("321111111111111111"); // 0.32, 0.3 + 0.01 + 0.01
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(0);
    // 109690000000000000000

    // 97478888888888888889
    // 97.8
    // 90960000000000000000
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq("97478888888888888889"); // 109.69 == 110 - 0.32 feeReserves - ( 10 + 2.2 ) profit
    // 12200000000000000000
    // 18820000000000000000
    // (Open and close margin fees + ~10% profit on collateral but price is 10% lower @ 270 now)
    // 1.1 * 3000 = 3300 - fees = 3300 / 270 = ~12.2
    expect(await bnb.balanceOf(DAO.address)).eq("902200000000000000000"); // 12.20 = 12.2 * 270 = 3294 = ~3300 * 0.999 * 0.999
  });

  it("close short position with loss", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await bnb.mint(DAO.address, expandDecimals(1000, 18));
    await bnb.connect(DAO).transfer(vault.address, expandDecimals(100, 18));
    await vaultNDOL.buyNDOL(bnb.address, DAO.address);
    expect(await vaultNDOL.feeReserves(bnb.address)).eq("300000000000000000"); // 0.3

    await bnb.connect(DAO).transfer(vault.address, expandDecimals(10, 18));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        bnb.address,
        bnb.address,
        toUsd(3000),
        false
      );

    let position = await vault.getPosition(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(toUsd(3000)); // size
    expect(position[1]).eq(toUsd(2997)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(10, 18)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(330));
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(330));
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(330));
    let delta = await vault.getPositionDelta(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(300)); // 2.25

    let leverage = await vault.getPositionLeverage(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(leverage).eq(10010); // ~9X leverage

    expect(await vaultNDOL.feeReserves(bnb.address)).eq("310000000000000000"); // 0.31, 0.3 + 0.01
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(
      expandDecimals(10, 18)
    );
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(toUsd(3));
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "109690000000000000000"
    ); // 109.69 == 110 - 0.31 feeReserves
    expect(await bnb.balanceOf(DAO.address)).eq("890000000000000000000");

    const tx = await vault
      .connect(DAO)
      .decreasePosition(
        DAO.address,
        bnb.address,
        bnb.address,
        toUsd(300),
        toUsd(3000),
        false,
        DAO.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    position = await vault.getPosition(
      DAO.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    // 319090909090909090
    // 220000000000000000
    // 0.31909091
    expect(await vaultNDOL.feeReserves(bnb.address)).eq("319090909090909090"); // 0.319, 0.3 + 0.01 + (0.01 * 0.9 because 10% greater price)
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(0);
    // 101517272727272727273
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "101517272727272727273"
    ); // 109.681 == 110 - 0.319 feeReserves - ( 10 - 1.8362 ) loss
    // (Open and close margin fees + ~10% profit on collateral but price is 10% higher @ 330 now)
    // 0.9 * 3000 = 2700 - ( fees = 0.1% ^ 2 ) = ~2694.6027 / 330 = ~8.16
    expect(await bnb.balanceOf(DAO.address)).eq("898163636363636363636"); // 8.163636363636363 = 8.16 * 330 = 2692
  });
});
