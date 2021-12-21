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
  getDaiConfig,
  validateVaultBalance,
} = require("./helpers");

use(solidity);

describe("Vault.fundingRates", function () {
  const provider = waffle.provider;
  const [deployer, DAO, ,] = provider.getWallets();
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
  let diamond;
  let exchangeDiamond;

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

    btcPriceFeed = await deployments.deploy("BTCPriceFeed", {
      from: deployer.address,
      contract: "PriceFeed",
    });
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

  it("funding rate", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(DAO.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    await btc.mint(deployer.address, expandDecimals(1, 8));
    await btc.connect(DAO).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
    await expect(
      vault
        .connect(deployer)
        .increasePosition(
          deployer.address,
          btc.address,
          btc.address,
          toUsd(110),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vault
      .connect(deployer)
      .increasePosition(
        deployer.address,
        btc.address,
        btc.address,
        toUsd(90),
        true
      );

    let position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(9.91)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100));

    let leverage = await vault.getPositionLeverage(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(90817); // ~9X leverage

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(DAO.address)).eq("99725000");

    const tx0 = await vault
      .connect(deployer)
      .decreasePosition(
        deployer.address,
        btc.address,
        btc.address,
        toUsd(3),
        toUsd(50),
        true,
        DAO.address
      );
    await reportGasUsed(provider, tx0, "decreasePosition gas used");

    leverage = await vault.getPositionLeverage(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(57887); // ~5.8X leverage

    position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(7.625)); // pnl
    expect(position[6]).eq(true);

    expect(await vaultNDOL.feeReserves(btc.address)).eq(969 + 114); // 0.00000106 * 45100 => ~0.05 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(33.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(250978); // 257046
    expect(await btc.balanceOf(DAO.address)).eq(99747939); // 0.00016878 * 47100 => 7.949538 USD

    await increaseTime(provider, 8 * 60 * 60);
    await mineBlock(provider);

    await expect(
      vault
        .connect(deployer)
        .decreasePosition(
          deployer.address,
          btc.address,
          btc.address,
          toUsd(3),
          0,
          true,
          DAO.address
        )
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    const tx1 = await vault
      .connect(deployer)
      .decreasePosition(
        deployer.address,
        btc.address,
        btc.address,
        toUsd(1),
        0,
        true,
        DAO.address
      );
    await reportGasUsed(provider, tx1, "withdraw collateral gas used");

    position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3 - 1)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(239); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(7.625)); // pnl
    expect(position[6]).eq(true);

    expect(await vault.getUtilisation(btc.address)).eq("401914"); // 100000 / 254923 => ~39.2%

    // funding rate factor => 600 / 1000000 (0.06%)
    // utilisation => ~39.1%
    // funding fee % => 0.02351628%
    // position size => 40 USD
    // funding fee  => 0.0094 USD
    // 0.00000019 BTC => 0.00000019 * 47100 => ~0.009 USD

    expect(await vaultNDOL.feeReserves(btc.address)).eq(969 + 106 + 28);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(34.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(248809); // 0.00002123* 47100 => 1 USD
    expect(await btc.balanceOf(DAO.address)).eq(99750087);

    await validateVaultBalance(expect, vaultNDOL, btc, 2);
  });
});
