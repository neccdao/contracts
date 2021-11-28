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

describe("Vault.depositCollateral", function () {
  const provider = waffle.provider;
  let vault;
  let vaultNDOL;
  let vaultPriceFeed;
  let ndol;
  let router;
  let bnb;
  let bnbPriceFeed;
  let eth;
  let ethPriceFeed;
  let btc;
  let btcPriceFeed;
  let dai;
  let daiPriceFeed;
  let distributor0;
  let yieldTracker0;
  let deployer;
  let DAO;

  beforeEach(async () => {
    diamond = await deployments.fixture(["ExchangeDiamond-hardhat"]);
    [deployer, DAO, , , user3] = provider.getWallets();
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
  });

  it("deposit collateral", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await btc.mint(deployer.address, expandDecimals(1, 8));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    await btc.connect(deployer).transfer(vault.address, 117500 - 1); // 0.001174 BTC => 47

    await expect(
      vault
        .connect(deployer)
        .increasePosition(
          deployer.address,
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
    await vaultNDOL.buyNDOL(btc.address, DAO.address);
    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      toUsd("46.8584")
    );

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353); // (117500 - 1) * 0.3% => 353
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("46858400000000000000"); // (117500 - 1 - 353) * 40000
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(117500 - 1 - 353);

    await btc.connect(deployer).transfer(vault.address, 117500 - 1);
    await expect(
      vault
        .connect(deployer)
        .increasePosition(
          deployer.address,
          btc.address,
          btc.address,
          toUsd(100),
          true
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await vaultNDOL.buyNDOL(btc.address, DAO.address);

    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      toUsd("93.7168")
    );

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353 * 2); // (117500 - 1) * 0.3% * 2
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vaultNDOL.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2);

    await expect(
      vault
        .connect(deployer)
        .increasePosition(
          deployer.address,
          btc.address,
          btc.address,
          toUsd(47),
          true
        )
    ).to.be.revertedWith("Vault: insufficient collateral for fees");

    await btc.connect(deployer).transfer(vault.address, 22500);

    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);

    let position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount

    const tx0 = await vault
      .connect(deployer)
      .increasePosition(
        deployer.address,
        btc.address,
        btc.address,
        toUsd(47),
        true
      );
    await reportGasUsed(provider, tx0, "increasePosition gas used");

    expect(await vaultNDOL.poolAmounts(btc.address)).eq(256675);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(117500);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(38.047));
    expect(await vaultNDOL.getRedemptionCollateralUsd(btc.address)).eq(
      toUsd(93.7168)
    ); // (256792 - 117500) sats * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

    position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953)); // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353 * 2 + 117); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(
      (117500 - 1 - 353) * 2 + 22500 - 117
    );

    let leverage = await vault.getPositionLeverage(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(52496); // ~5.2x

    await btc.connect(deployer).transfer(vault.address, 22500);

    const tx1 = await vault
      .connect(deployer)
      .increasePosition(deployer.address, btc.address, btc.address, 0, true);
    await reportGasUsed(provider, tx1, "deposit collateral gas used");

    position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953 + 9)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353 * 2 + 117); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(
      (117500 - 1 - 353) * 2 + 22500 + 22500 - 117
    );

    leverage = await vault.getPositionLeverage(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(26179); // ~2.6x

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(51000));
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000));

    await btc.connect(deployer).transfer(vault.address, 100);
    await vault
      .connect(deployer)
      .increasePosition(deployer.address, btc.address, btc.address, 0, true);

    position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(47)); // size
    expect(position[1]).eq(toUsd(8.953 + 9 + 0.05)); // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(117500); // reserveAmount

    expect(await vaultNDOL.feeReserves(btc.address)).eq(353 * 2 + 117); // fee is 0.047 USD => 0.00000114 BTC
    expect(await vaultNDOL.ndolAmounts(btc.address)).eq("93716800000000000000"); // (117500 - 1 - 353) * 40000 * 2
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(
      (117500 - 1 - 353) * 2 + 22500 + 22500 + 100 - 117
    );

    leverage = await vault.getPositionLeverage(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(leverage).eq(26106); // ~2.6x

    await validateVaultBalance(expect, vaultNDOL, btc);
  });
});
