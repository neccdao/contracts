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
  validateVaultBalance,
  zeroAddress,
} = require("./helpers");

use(solidity);

describe("Vault.closeLongPosition", function () {
  const provider = waffle.provider;
  const [deployer, user0, user1, user2, user3] = provider.getWallets();
  let vault;
  let vaultNDOL;
  let vaultConfig;
  let vaultPriceFeed;
  let ndol;
  let router;
  let diamond;
  let exchangeDiamond;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
  let eth;
  let ethPriceFeed;
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

  it("close long position", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(deployer.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, deployer.address);

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(110),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");
    await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(90),
        true
      );

    let position = await vault.getPosition(
      user0.address,
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

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274025);

    let delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(22.5));

    const deployerBtcBalanceBefore = await btc.balanceOf(deployer.address);

    const tx = await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(4),
        toUsd(90),
        true,
        deployer.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    const deployerBtcBalanceAfter = await btc.balanceOf(deployer.address);

    position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true);

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975 + 180); // 0.0036 * 50000 => 180
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274025 - 64820); // 0.00045 * 50000 => ~22.5 USD

    console.log(deployerBtcBalanceBefore?.toString());
    console.log(deployerBtcBalanceAfter?.toString());
    // 99725000
    // 99789640
    expect(deployerBtcBalanceAfter.gt(deployerBtcBalanceBefore)).eq(true); // 99789640

    await validateVaultBalance(expect, vaultNDOL, btc);
  });

  it("close long position with loss", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(deployer.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, deployer.address);

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(110),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(90),
        true
      );

    let position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274025);

    let delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq(toUsd(2.25)); // 2.25

    const deployerBtcBalanceBefore = await btc.balanceOf(deployer.address);

    const tx = await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(4),
        toUsd(90),
        true,
        deployer.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true);

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975 + 230); // 0.0036 * 39000 => 230
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274025 - 19641); // 0.00019641 * 39000 => ~7.65999 USD
    const deployerBtcBalanceAfter = await btc.balanceOf(deployer.address);

    expect(deployerBtcBalanceAfter.gt(deployerBtcBalanceBefore)).eq(true); // 99744410

    await validateVaultBalance(expect, vaultNDOL, btc, 1);
  });
});
