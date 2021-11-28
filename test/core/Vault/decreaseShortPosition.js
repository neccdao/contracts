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

describe("Vault.decreaseShortPosition", function () {
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

  it("decreasePosition short", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault
        .connect(user1)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          0,
          0,
          false,
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
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: mismatched tokens");

    await bnb.mint(user0.address, expandDecimals(1000, 18));
    await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18));
    await vaultNDOL.buyNDOL(bnb.address, user1.address);

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await bnb.connect(user0).transfer(vault.address, expandDecimals(10, 18));
    await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        bnb.address,
        bnb.address,
        toUsd(27000),
        false
      );

    let position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(toUsd(27000)); // size
    expect(position[1]).eq(toUsd(2973)); // collateral
    expect(position[2]).eq(toNormalizedPrice(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    //
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(270));

    let delta = await vault.getPositionDelta(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq(toUsd(2700));

    let leverage = await vault.getPositionLeverage(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(leverage).eq(90817); // ~9X leverage

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(300),
          toUsd(90000),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: position size exceeded");

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(4000),
          toUsd(3000),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: position collateral exceeded");

    // yay!
    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(2950),
          toUsd(6000),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    expect(await vaultNDOL.feeReserves(bnb.address)).eq("390000000000000000"); // 0.31, 0.3 + 0.01 minted + margin
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(
      expandDecimals(90, 18)
    );
    // position size - collateral
    // 3000000000000000000000000000000
    // 24027000000000000000000000000000000
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(toUsd(24027));
    // 109690000000000000000
    // minus fees
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "109610000000000000000"
    ); // 109.61
    expect(await bnb.balanceOf(user2.address)).eq(0);

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(270));

    const tx = await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        bnb.address,
        bnb.address,
        toUsd(2000),
        toUsd(500),
        false,
        user2.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    // 2500000000000000000000000000000000
    // 26500000000000000000000000000000000
    expect(position[0]).eq(toUsd(26500)); // size
    // 973000000000000000000000000000000
    // 997000000000000000000000000000000
    expect(position[1]).eq(toUsd(2973 - 2000)); // collateral
    expect(position[2]).eq(toNormalizedPrice(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("88333333333333333334"); // reserveAmount
    // 50000000000000000000000000000000
    expect(position[5]).eq(toUsd(50)); // pnl = (500/27000) * (300-270) = ~50
    expect(position[6]).eq(true); // hasRealisedProfit

    expect(await vaultNDOL.feeReserves(bnb.address)).eq("391851851851851851"); // 0.31185, 0.3 + 0.01 + 0.00185
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(
      "88333333333333333334"
    );
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(toUsd(25527));
    // 102097407407407407408
    // 49961250000000000000
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "102017407407407407408"
    ); // 102.017
    // 7590740740740740740
    expect(await bnb.balanceOf(user2.address)).eq("7590740740740740740"); // 7.59074074 = 2000 USD collateral returned + 50 pnl / 270 price

    // (3000-500)  / (2997-2000) => 2.5x
    leverage = await vault.getPositionLeverage(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(leverage).eq(272353); // ~27X leverage
  });

  it("decreasePosition short with loss", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));

    await expect(
      vault
        .connect(user1)
        .decreasePosition(
          user0.address,
          btc.address,
          btc.address,
          0,
          0,
          false,
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
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: mismatched tokens");

    await bnb.mint(user0.address, expandDecimals(1000, 18));
    await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18));
    await vaultNDOL.buyNDOL(bnb.address, user1.address);

    await bnb.connect(user0).transfer(vault.address, expandDecimals(10, 18));
    await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        bnb.address,
        bnb.address,
        toUsd(27000),
        false
      );

    let position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(toUsd(27000)); // size
    expect(position[1]).eq(toUsd(2973)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)); // reserveAmount
    expect(position[5]).eq(0); // pnl
    expect(position[6]).eq(true); // hasRealisedProfit

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(330));

    let delta = await vault.getPositionDelta(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(delta[0]).eq(false);
    // 2700000000000000000000000000000000
    // 300000000000000000000000000000000
    expect(delta[1]).eq(toUsd(2700));

    let leverage = await vault.getPositionLeverage(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(leverage).eq(90817); // ~9X leverage

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(300),
          toUsd(45000),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: position size exceeded");

    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(4000),
          toUsd(3000),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: position collateral exceeded");

    // liquidation with losses
    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(2000),
          toUsd(6000),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: losses exceed collateral");

    // max leverage exceeded, half life liquidation wow
    await expect(
      vault
        .connect(user0)
        .decreasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(100),
          toUsd(100),
          false,
          user2.address
        )
    ).to.be.revertedWith("Vault: max leverage exceeded");

    expect(await vaultNDOL.feeReserves(bnb.address)).eq("390000000000000000"); // 0.31, 0.3 + 0.01 minted + margin
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(
      expandDecimals(90, 18)
    );
    // position size - collateral
    // 3000000000000000000000000000000
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(toUsd(24027));
    // 109690000000000000000
    // minus fees
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "109610000000000000000"
    ); // 109.69
    expect(await bnb.balanceOf(user2.address)).eq(0);

    const tx = await vault
      .connect(user0)
      .decreasePosition(
        user0.address,
        bnb.address,
        bnb.address,
        toUsd(0),
        toUsd(25000),
        false,
        user2.address
      );
    await reportGasUsed(provider, tx, "decreasePosition gas used");

    position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    // 2000000000000000000000000000000000
    // 2500000000000000000000000000000000
    expect(position[0]).eq(toUsd(2000)); // size
    // 373000000000000000000000000000000
    // 947000000000000000000000000000000
    // 9x * 10% loss, collateral - fees, collateral 10% up
    expect(position[1]).eq(toUsd(2948 - 2500)); // collateral
    expect(position[2]).eq(toNormalizedPrice(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq("6666666666666666667"); // reserveAmount
    // 50000000000000000000000000000000
    // 2500000000000000000000000000000000
    expect(position[5]).eq(toUsd(2500)); // pnl = (500/3000) * (2700-3000) = ~-50
    expect(position[6]).eq(false); // hasRealisedProfit => position.realisedPnl >= 0, // 6

    expect(await vaultNDOL.feeReserves(bnb.address)).eq("465757575757575757");
    expect(await vaultNDOL.reservedAmounts(bnb.address)).eq(
      "6666666666666666667"
    );
    expect(await vaultNDOL.guaranteedUsd(bnb.address)).eq(toUsd(1552));
    // 109534242424242424243
    // 49961250000000000000
    expect(await vaultNDOL.poolAmounts(bnb.address)).eq(
      "109534242424242424243"
    ); // 103.629
    // 7590740740740740740
    expect(await bnb.balanceOf(user2.address)).eq("0"); // no collateral returned, position still open

    leverage = await vault.getPositionLeverage(
      user0.address,
      bnb.address,
      bnb.address,
      false
    );
    expect(leverage).eq(44642); // ~4.4X leverage
  });
});
