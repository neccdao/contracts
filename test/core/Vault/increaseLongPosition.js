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

describe("Vault.increaseLongPosition", function () {
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
  });

  it("increasePosition long validations", async () => {
    await expect(
      vault
        .connect(user1)
        .increasePosition(user0.address, btc.address, btc.address, 0, true)
    ).to.be.revertedWith("Vault: invalid msg.sender");
    await expect(
      vault
        .connect(user0)
        .increasePosition(user0.address, btc.address, bnb.address, 0, true)
    ).to.be.revertedWith("Vault: mismatched tokens");
    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          bnb.address,
          toUsd(1000),
          true
        )
    ).to.be.revertedWith("Vault: mismatched tokens");
    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          bnb.address,
          bnb.address,
          toUsd(1000),
          true
        )
    ).to.be.revertedWith("Vault: token not whitelisted");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(1000),
          true
        )
    ).to.be.revertedWith("Vault: insufficient collateral for fees");
    await expect(
      vault
        .connect(user0)
        .increasePosition(user0.address, btc.address, btc.address, 0, true)
    ).to.be.revertedWith("Vault: invalid position.size");

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).transfer(vault.address, 2500 - 1);

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(1000),
          true
        )
    ).to.be.revertedWith("Vault: fees exceed collateral");

    await btc.connect(user0).transfer(vault.address, 1);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(1000),
          true
        )
    ).to.be.revertedWith("Vault: fees exceed collateral");

    await btc.connect(user0).transfer(vault.address, 10000);

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(1000),
          true
        )
    ).to.be.revertedWith("Vault: liquidation fees exceed collateral");

    await btc.connect(user0).transfer(vault.address, 10000);

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(500),
          true
        )
    ).to.be.revertedWith("Vault: max leverage exceeded");

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(8),
          true
        )
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(47),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");
  });

  it("increasePosition long", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).transfer(vault.address, 117500 - 1); // 0.001174 BTC => 47

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(47),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    expect(await vaultNDOL.feeReserves(btc.address)).eq(0);
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(0);

    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(0);
    await vaultNDOL.buyNDOL(btc.address, user1.address);
    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      toUsd("46.8584")
    );

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353); // (117500 - 1) * 0.3% => 353
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("46858400000000000000"); // (117500 - 1 - 353) * 40000
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(117500 - 1 - 353);

    await btc.connect(user0).transfer(vault.address, 117500 - 1);
    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(100),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vaultNDOL.buyNDOL(btc.address, user1.address);

    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      toUsd("93.7168")
    );

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353 * 2); // (117500 - 1) * 0.3% * 2
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vaultNDOL.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2);

    await expect(
      vault
        .connect(user0)
        .increasePosition(
          user0.address,
          btc.address,
          btc.address,
          toUsd(47),
          true
        )
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await btc.connect(user0).transfer(vault.address, 22500);

    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(
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

    let tx = await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(47),
        true
      );
    await reportGasUsed(provider, tx, "increasePosition gas used");

    expect(await vaultNDOL.poolAmounts(btc.address)).eq(256675);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(117500);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(38.047));
    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      toUsd(93.7168)
    );

    position = await vault.getPosition(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953)); // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vaultNDOL.feeReserves(btc.address)).eq(823); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(256675);

    await validateVaultBalance(expect, vaultNDOL, btc);

    tx = await vault
      .connect(user0)
      .increasePosition(
        user0.address,
        btc.address,
        btc.address,
        toUsd(10),
        true
      );
    await reportGasUsed(provider, tx, "increasePosition gas used");
  });
});
