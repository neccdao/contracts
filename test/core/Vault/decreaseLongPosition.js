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

describe("Vault.decreaseLongPosition", function () {
  const provider = waffle.provider;
  const [deployer, user0, user1, user2, user3] = provider.getWallets();
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

  it("decreasePosition long", async () => {
    await expect(
      vault
        .connect(user1)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          0,
          0,
          true,
          user2.address
        )
    ).to.be.revertedWith("Vault: invalid msg.sender");
    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          btc.address,
          bnb.address,
          0,
          toUsd(1000),
          true,
          user2.address
        )
    ).to.be.revertedWith("Vault: mismatched tokens");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          0,
          toUsd(1000),
          true,
          user2.address
        )
    ).to.be.revertedWith("Vault: empty position");

    await btc.mint(user1.address, expandDecimals(1, 8));
    await btc.connect(user1).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, user1.address);

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user1).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 - 1));
    let delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("2247750000000000000000000000000"); // ~0.00219512195 USD

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307)); // 41000 * 0.75% => 307.5
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 307));
    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("2940750000000000000000000000000");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 308));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 308));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000 + 308));
    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("2943000000000000000000000000000"); // ~0.676 USD

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100));

    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("11475000000000000000000000000000"); // ~2.1951

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100));
    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).gte(toUsd(1.3275)); // ~2.1951

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100));
    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).gte(toUsd(1.5975));

    let leverage = await vault.getPositionLeverage(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(90817); // ~9X leverage

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          0,
          toUsd(100),
          true,
          user2.address
        )
    ).to.be.revertedWith("Vault: position size exceeded");

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(10),
          toUsd(50),
          true,
          user2.address
        )
    ).to.be.revertedWith("Vault: position collateral exceeded");

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(8.91),
          toUsd(50),
          true,
          user2.address
        )
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(user2.address)).eq(0);

    const tx = await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(3),
        toUsd(50),
        true,
        user2.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    leverage = await vault.getPositionLeverage(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(57887); // ~5.8X leverage

    position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.91 - 3)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq((225000 / 90) * 40); // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(8.875)); // pnl
    expect(position[6]).eq(true);

    expect(await vaultNDOL.feeReserves(btc.address)).eq(969 + 112); // 0.00000106 * 45100 => ~0.05 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq((225000 / 90) * 40);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(33.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(248813);
    expect(await btc.balanceOf(user2.address)).eq(25106); // ~11.824926 USD

    await validateVaultBalance(expect, vaultNDOL, btc, 1);
  });

  it("decreasePosition long with loss", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.mint(user1.address, expandDecimals(1, 8));
    await btc.connect(user1).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, user1.address);

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user1).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39590));

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(user2.address)).eq(0);

    let delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    // 922500000000000000000000000000
    // 1327499999900000000000000000000
    expect(delta[1]).eq(toUsd(0.9225));

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(4),
          toUsd(50),
          true,
          user2.address
        )
    ).to.be.revertedWith("liquidation fees exceed collateral");

    const tx = await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(0),
        toUsd(50),
        true,
        user2.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(40)); // size
    expect(position[1]).eq(toUsd(9.3475)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(100000); // reserveAmount, 0.00100 * 40,000 => 40
    expect(position[5]).eq(toUsd(0.5125)); // pnl
    expect(position[6]).eq(false);

    expect(await vaultNDOL.feeReserves(btc.address)).eq(1101); // 0.00000122 * 40790 => ~0.05 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(100000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(30.6525));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(273899);
    expect(await btc.balanceOf(user2.address)).eq(0);

    await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(0),
        toUsd(40),
        true,
        user2.address
      );

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
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true);

    expect(await vaultNDOL.feeReserves(btc.address)).eq(1202); // 0.00000098 * 40790 => ~0.04 USD
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(btc.address)).eq("251324");
    expect(await btc.balanceOf(user2.address)).eq(22474); // ~8.89 USD

    await validateVaultBalance(expect, vaultNDOL, btc);
  });
});
