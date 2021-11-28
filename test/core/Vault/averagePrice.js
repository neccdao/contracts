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
  getEthConfig,
  getBtcConfig,
  getDaiConfig,
  validateVaultBalance,
  zeroAddress,
} = require("./helpers");

use(solidity);

describe("Vault.averagePrice", function () {
  const provider = waffle.provider;
  const [deployer, DAO, user1, user2, user3] = provider.getWallets();
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

  it("position.averagePrice, buyPrice != markPrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault
        .connect(DAO)
        .increasePosition(
          DAO.address,
          btc.address,
          btc.address,
          toUsd(110),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));

    let leverage = await vault.getPositionLeverage(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(DAO.address)).eq(199725000);

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    // 15975000000000000000000000000000
    // 9000000000000000000000000000000
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(15.975));

    await expect(
      vault
        .connect(DAO)
        .increasePosition(
          DAO.address,
          btc.address,
          btc.address,
          toUsd(90),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(10), true);

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(100)); // size
    expect(position[1]).eq(toUsd(9.9)); // collateral, 10 - 90 * 0.1% - 10 * 0.1%
    expect(position[2]).eq("40612200905367536106919594740245742"); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(246231); // reserveAmount, 0.00225 * 40,000 => 90, 0.00022172 * 45100 => ~10

    leverage = await vault.getPositionLeverage(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(101010); // ~10X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(969 + 27); // 0.00000021 * 45100 => 0.01 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(246231);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(90.1));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274004);
    expect(await btc.balanceOf(DAO.address)).eq(199725000);

    // profits will decrease slightly as there is a difference between the buy price and the mark price
    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("15975000000000000000000000000000"); // ~4.37

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(15.975));

    await validateVaultBalance(expect, vaultNDOL, btc);
  });

  it("position.averagePrice, buyPrice == markPrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault
        .connect(DAO)
        .increasePosition(
          DAO.address,
          btc.address,
          btc.address,
          toUsd(110),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));

    let leverage = await vault.getPositionLeverage(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(DAO.address)).eq(199725000);

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(11.475));

    await expect(
      vault
        .connect(DAO)
        .increasePosition(
          DAO.address,
          btc.address,
          btc.address,
          toUsd(90),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(10), true);

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(100)); // size
    expect(position[1]).eq(toUsd(9.9)); // collateral, 10 - 90 * 0.1% - 10 * 0.1%
    expect(position[2]).eq("40457501681991477909845256784032294"); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000 + 22172); // reserveAmount, 0.00225 * 40,000 => 90, 0.00022172 * 45100 => ~10

    leverage = await vault.getPositionLeverage(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(101010); // ~10X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(969 + 28); // 0.00000021 * 45100 => 0.01 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000 + 22172);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(90.1));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274003);
    expect(await btc.balanceOf(DAO.address)).eq(199725000);

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(11.475));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("1340909090909090909090909090909");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("23586474501108647450110864745011");

    await validateVaultBalance(expect, vaultNDOL, btc);
  });

  it("position.averagePrice, buyPrice < averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault
        .connect(DAO)
        .increasePosition(
          DAO.address,
          btc.address,
          btc.address,
          toUsd(110),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36900));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36900));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36900));

    let leverage = await vault.getPositionLeverage(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(DAO.address)).eq(199725000);

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(6.975));

    await expect(
      vault
        .connect(DAO)
        .increasePosition(
          DAO.address,
          btc.address,
          btc.address,
          toUsd(90),
          true
        )
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    await btc.connect(DAO).transfer(vault.address, 25000);
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(10), true);

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(100)); // size
    expect(position[1]).eq(toUsd(9.91 + 9.215)); // collateral, 0.00025 * 36900 => 9.225, 0.01 fees
    expect(position[2]).eq("39666756248320343993550120935232464"); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000 + 27100); // reserveAmount, 0.000271 * 36900 => ~10

    leverage = await vault.getPositionLeverage(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(52287); // ~5.2X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(1002); // 0.00000027 * 36900 => 0.01 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000 + 27100);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.875));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(298998);
    expect(await btc.balanceOf(DAO.address)).eq(199700000);

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("6974999999999999999999999999999");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("3361111111111111111111111111111");

    await validateVaultBalance(expect, vaultNDOL, btc);
  });

  it("long position.averagePrice, buyPrice == averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(0);

    await btc.connect(DAO).transfer(vault.address, 25000);
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(10), true);

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(100)); // size
    expect(position[1]).eq(toUsd(9.91 + 9.99)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000 + 25000); // reserveAmount

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(0);

    await validateVaultBalance(expect, vaultNDOL, btc);
  });

  it("long position.averagePrice, buyPrice > averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(22.5));

    await btc.connect(DAO).transfer(vault.address, 25000);
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(10), true);

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(100)); // size
    expect(position[2]).eq("40816326530612244897959183673469387"); // averagePrice

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(22.5));

    await validateVaultBalance(expect, vaultNDOL, btc);
  });

  it("long position.averagePrice, buyPrice < averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 125000); // 0.000125 BTC => 50 USD
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(90), true);

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq("49910000000000000000000000000000"); // collateral, 50 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(30000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(30000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(30000));

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(22.5));

    await btc.connect(DAO).transfer(vault.address, 25000);
    await vault
      .connect(DAO)
      .increasePosition(DAO.address, btc.address, btc.address, toUsd(10), true);

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(100)); // size
    expect(position[2]).eq("38709677419354838709677419354838709"); // averagePrice

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("22499999999999999999999999999999");
  });

  it("short position.averagePrice, buyPrice == averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(101, 18));
    await btc.connect(DAO).transfer(vault.address, expandDecimals(2, 8));
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(50, 18));
    await btc.connect(DAO).transfer(vault.address, expandDecimals(1, 8));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        btc.address,
        btc.address,
        toUsd(40000),
        false
      );

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(40000)); // size
    expect(position[1]).eq("39960000000000000000000000000000000"); // collateral, 50 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(1, 8));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(0);

    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        btc.address,
        btc.address,
        toUsd(40000),
        false
      );

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(80000)); // size
    expect(position[1]).eq("39920000000000000000000000000000000"); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(2, 8)); // reserveAmount

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(0);
  });

  it("short position.averagePrice, buyPrice > averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(101, 18));
    await btc.connect(DAO).transfer(vault.address, expandDecimals(2, 8));
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(50, 18));
    await btc.connect(DAO).transfer(vault.address, expandDecimals(1, 8));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        btc.address,
        btc.address,
        toUsd(40000),
        false
      );

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(40000)); // size
    expect(position[1]).eq("39960000000000000000000000000000000"); // collateral, 50 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(1, 8));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(10000));

    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        btc.address,
        btc.address,
        toUsd(40000),
        false
      );

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(80000)); // size
    expect(position[1]).eq("39920000000000000000000000000000000"); // collateral
    expect(position[2]).eq("44444444444444444444444444444444444"); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(18, 7)); // reserveAmount

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(10000));
  });

  it("short position.averagePrice, buyPrice < averagePrice", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(101, 18));
    await btc.connect(DAO).transfer(vault.address, expandDecimals(2, 8));
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(DAO.address, expandDecimals(50, 18));
    await btc.connect(DAO).transfer(vault.address, expandDecimals(1, 8));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        btc.address,
        btc.address,
        toUsd(40000),
        false
      );

    let position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(40000)); // size
    expect(position[1]).eq("39960000000000000000000000000000000"); // collateral, 50 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(1, 8));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(30000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(30000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(30000));

    let delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(10000));

    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        btc.address,
        btc.address,
        toUsd(40000),
        false
      );

    position = await vault.getPosition(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(position[0]).eq(toUsd(80000)); // size
    expect(position[1]).eq("39920000000000000000000000000000000"); // collateral
    expect(position[2]).eq("34285714285714285714285714285714285"); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("233333333"); // reserveAmount

    delta = await vault.getPositionDelta(
      DAO.address,
      btc.address,
      btc.address,
      false
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).gte(toUsd(9999));
  });

  it("long position.averagePrice, buyPrice < averagePrice", async () => {
    await ethPriceFeed.setLatestAnswer("251382560787");
    await ethPriceFeed.setLatestAnswer("252145037536");
    await ethPriceFeed.setLatestAnswer("252145037536");

    await eth.mint(DAO.address, expandDecimals(10, 18));
    await eth.connect(DAO).transfer(vault.address, expandDecimals(10, 18));
    await vaultNDOL.buyNDOL(eth.address, DAO.address);

    await eth.mint(DAO.address, expandDecimals(1, 18));
    await eth.connect(DAO).transfer(vault.address, expandDecimals(1, 18));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        eth.address,
        eth.address,
        "5050322181222357947081599665915068",
        true
      );

    let position = await vault.getPosition(
      DAO.address,
      eth.address,
      eth.address,
      true
    );
    expect(position[0]).eq("5050322181222357947081599665915068"); // size
    expect(position[1]).eq("2516400053178777642052918400334084"); // averagePrice
    expect(position[2]).eq("2521450375360000000000000000000000"); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate

    await ethPriceFeed.setLatestAnswer("237323502539");
    await ethPriceFeed.setLatestAnswer("237323502539");
    await ethPriceFeed.setLatestAnswer("237323502539");

    let delta = await vault.getPositionDelta(
      DAO.address,
      eth.address,
      eth.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("296866944860754376482796517102673");

    await eth.mint(DAO.address, expandDecimals(1, 18));
    await eth.connect(DAO).transfer(vault.address, expandDecimals(1, 18));
    await vault
      .connect(DAO)
      .increasePosition(
        DAO.address,
        eth.address,
        eth.address,
        "4746470050780000000000000000000000",
        true
      );

    position = await vault.getPosition(
      DAO.address,
      eth.address,
      eth.address,
      true
    );
    expect(position[0]).eq("9796792232002357947081599665915068"); // size
    expect(position[2]).eq("2447397190894361457116367555285124"); // averagePrice
  });
});
