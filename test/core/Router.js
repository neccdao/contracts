const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract, contractAt } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  newWallet,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
  zeroAddress,
  validateVaultBalance,
} = require("./Vault/helpers");
const { deployments } = require("hardhat");
const { ethers } = require("ethers");

use(solidity);

describe("Router", function () {
  const provider = waffle.provider;
  const [deployer, user0, user1, user2, user3] = provider.getWallets();
  let vault;
  let vaultNDOL;
  let vaultConfig;
  let router;
  let ndol;
  let vaultPriceFeed;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
  let eth;
  let ethPriceFeed;
  let dai;
  let daiPriceFeed;
  let busd;
  let busdPriceFeed;
  let distributor0;
  let deltaYieldTracker;
  let reader;
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

  it("swap, buy NDOL", async () => {
    await eth.mint(user0.address, expandDecimals(200, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(200, 18));
    expect(await ndol.balanceOf(user0.address)).eq(0);
    expect(await vaultNDOL.feeReserves(eth.address)).eq(0);
    expect(await vaultNDOL.ndolAmounts(eth.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(eth.address)).eq(0);

    await expect(
      router
        .connect(user0)
        .swap(
          [eth.address, ndol.address],
          expandDecimals(2, 18),
          expandDecimals(9000, 18),
          user0.address
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    const tx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(2, 18),
        expandDecimals(200, 18),
        user0.address
      );

    await reportGasUsed(provider, tx, "buyNDOL gas used");
    expect(await eth.balanceOf(user0.address)).gt(0);
    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(7976, 18));
    expect(await vaultNDOL.feeReserves(eth.address)).eq(expandDecimals(6, 15)); // 2 * 0.003
    expect(await vaultNDOL.ndolAmounts(eth.address)).eq(
      expandDecimals(7976, 18) // 2 * 4000 * 0.997
    );
    expect(await vaultNDOL.poolAmounts(eth.address)).eq(
      expandDecimals(1994, 15) // 2 * 0.997
    );
  });

  it("swap (buyNDOL), swap (sellNDOL)", async () => {
    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(2, 18));
    expect(await ndol.balanceOf(user0.address)).eq(0);

    const tx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(2, 18),
        expandDecimals(200, 18),
        user0.address
      );

    await reportGasUsed(provider, tx, "buyNDOL gas used");
    expect(await eth.balanceOf(user0.address)).eq(0);
    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(7976, 18));

    await ndol
      .connect(user0)
      .approve(router.address, expandDecimals(1000000000000, 18));

    await expect(
      router
        .connect(user0)
        .swap(
          [ndol.address, eth.address],
          expandDecimals(100, 18),
          expandDecimals(5000, 18),
          user0.address
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    const sellTx = await router
      .connect(user0)
      .swap(
        [ndol.address, eth.address],
        expandDecimals(4000, 18),
        expandDecimals(5, 17),
        user0.address
      );
    await reportGasUsed(provider, sellTx, "sellNDOL gas used");

    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(997, 15)); // 0.997
    expect(await ndol.balanceOf(user0.address)).eq("3976000000000000000000"); // 3976
  });

  it("swap (buyNDOL), swap (sellNDOL) - after price increase", async () => {
    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(2, 18));
    expect(await ndol.balanceOf(user0.address)).eq(0);

    const tx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(2, 18),
        expandDecimals(200, 18),
        user0.address
      );

    await reportGasUsed(provider, tx, "buyNDOL gas used");
    expect(await eth.balanceOf(user0.address)).eq(0);
    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(7976, 18));

    await ndol
      .connect(user0)
      .approve(router.address, expandDecimals(1000000000000, 18));

    await expect(
      router
        .connect(user0)
        .swap(
          [ndol.address, eth.address],
          expandDecimals(100, 18),
          expandDecimals(5000, 18),
          user0.address
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(4400));
    console.log("ETH price increase 10% to 4400");

    const sellTx = await router
      .connect(user0)
      .swap(
        [ndol.address, eth.address],
        expandDecimals(4000, 18),
        expandDecimals(5, 17),
        user0.address
      );
    await reportGasUsed(provider, sellTx, "sellNDOL gas used");

    expect(await eth.balanceOf(user0.address)).gt(expandDecimals(9063, 14)); // 0.997 * 4000/4400
    expect(await ndol.balanceOf(user0.address)).eq("3976000000000000000000"); // 3976
  });

  it("swap (buyNDOL), swap (sellNDOL) - after price decrease", async () => {
    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(2, 18));
    expect(await ndol.balanceOf(user0.address)).eq(0);

    const tx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(2, 18),
        expandDecimals(200, 18),
        user0.address
      );

    await reportGasUsed(provider, tx, "buyNDOL gas used");
    expect(await eth.balanceOf(user0.address)).eq(0);
    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(7976, 18));

    await ndol
      .connect(user0)
      .approve(router.address, expandDecimals(1000000000000, 18));

    await expect(
      router
        .connect(user0)
        .swap(
          [ndol.address, eth.address],
          expandDecimals(100, 18),
          expandDecimals(5000, 18),
          user0.address
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3600));
    console.log("ETH price decrease 10% to 3600");

    const sellTx = await router
      .connect(user0)
      .swap(
        [ndol.address, eth.address],
        expandDecimals(4000, 18),
        expandDecimals(5, 17),
        user0.address
      );
    await reportGasUsed(provider, sellTx, "sellNDOL gas used");

    expect(await eth.balanceOf(user0.address)).gt(expandDecimals(11077, 14)); // 0.997 * 4000/3600
    expect(await ndol.balanceOf(user0.address)).eq("3976000000000000000000"); // 3976
  });

  it("swap (buyNDOL: ETH), swap (buyNDOL: BTC), swap (buyNDOL: ETH) - target adjusted fee", async () => {
    await eth.mint(user0.address, expandDecimals(3, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(3, 18));
    expect(await ndol.balanceOf(user0.address)).eq(0);

    const tx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(2, 18),
        expandDecimals(200, 18),
        user0.address
      );

    await reportGasUsed(provider, tx, "buyNDOL gas used");
    expect(await eth.balanceOf(user0.address)).gt(0);
    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(7976, 18));

    await ndol
      .connect(user0)
      .approve(router.address, expandDecimals(1000000000000, 18));

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );

    expect(await ndol.balanceOf(user0.address)).eq(
      expandDecimals(59820 + 7976, 18)
    );

    const ndolBalanceBefore = await ndol.balanceOf(user0.address);
    console.log("NDOL Balance Before: ", ndolBalanceBefore?.toString());
    const buyAdjustedFeeTx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(1, 18),
        expandDecimals(5, 17),
        user0.address
      );
    await reportGasUsed(
      provider,
      buyAdjustedFeeTx,
      "buyNDOL (ETH) - target adjusted fee gas used"
    );

    const ndolBalanceAfter = await ndol.balanceOf(user0.address);
    console.log("NDOL Balance After: ", ndolBalanceAfter?.toString());

    // 0.9994 == 1 - (0.2 * 0.003)
    // 0.997 * 8000 + 0.997 * 60000 + 4000 * 0.9994
    // 71793.6 - 67796 ==  3997.6
    expect(await ndol.balanceOf(user0.address)).gt(expandDecimals(71784, 18)); // 71793.6
  });

  it("swapETHToTokens (buyNDOL), swapTokensToETH (sellNDOL)", async () => {
    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(2, 18));
    expect(await ndol.balanceOf(user0.address)).eq(0);

    const tx = await router
      .connect(user0)
      .swapETHToTokens(
        [eth.address, ndol.address],
        expandDecimals(200, 18),
        user0.address,
        {
          value: ethers.utils.parseEther("2"),
        }
      );

    await reportGasUsed(provider, tx, "swapETHToTokens (buyNDOL) gas used");
    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(7976, 18));

    await ndol
      .connect(user0)
      .approve(router.address, expandDecimals(1000000000000, 18));

    const ethBalanceBefore = await provider.getBalance(user0.address);

    const sellTx = await router
      .connect(user0)
      .swapTokensToETH(
        [ndol.address, eth.address],
        expandDecimals(4000, 18),
        expandDecimals(5, 17),
        user0.address
      );
    await reportGasUsed(
      provider,
      sellTx,
      "swapTokensToETH (sellNDOL) gas used"
    );

    const ethBalanceAfter = await provider.getBalance(user0.address);

    expect(ethBalanceAfter.gt(ethBalanceBefore)).eq(true);
    expect(await ndol.balanceOf(user0.address)).eq("3976000000000000000000"); // 3976
  });

  it("swap (buyNDOL: BTC -> NDOL), swapETHToTokens (ETH -> BTC),  swapTokensToETH (BTC -> ETH)", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );

    expect(await ndol.balanceOf(user0.address)).eq(expandDecimals(59820, 18));

    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(200, 18));
    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(2, 18));
    const tx = await router
      .connect(user0)
      .swapETHToTokens([eth.address, btc.address], "13293300", user0.address, {
        value: ethers.utils.parseEther("2"),
      });

    await reportGasUsed(provider, tx, "swapETHToTokens (ETH -> BTC) gas used");
    expect(await btc.balanceOf(user0.address)).gt(0);

    const ethBalanceBefore = await provider.getBalance(user0.address);

    const swapBTCToETHTx = await router
      .connect(user0)
      .swapTokensToETH(
        [btc.address, eth.address],
        expandDecimals(1, 7),
        expandDecimals(5, 17),
        user0.address
      );
    await reportGasUsed(
      provider,
      swapBTCToETHTx,
      "swapTokensToETH (BTC -> ETH) gas used"
    );

    const ethBalanceAfter = await provider.getBalance(user0.address);

    expect(ethBalanceAfter.gt(ethBalanceBefore)).eq(true);
  });

  it("swap, path.length == 2", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    expect(await btc.balanceOf(user0.address)).eq(expandDecimals(1, 8));

    await expect(
      router
        .connect(user0)
        .swap(
          [btc.address, ndol.address],
          expandDecimals(1, 8),
          expandDecimals(6000000, 18),
          user0.address
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    let buyTx = await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );
    await reportGasUsed(provider, buyTx, "buyNDOL gas used (BTC)");

    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth.connect(user0).approve(router.address, expandDecimals(30000, 18));
    await expect(
      router
        .connect(user0)
        .swap(
          [eth.address, btc.address],
          expandDecimals(1, 18),
          "500000000",
          user0.address
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(2, 18));
    expect(await btc.balanceOf(user0.address)).eq(0);

    buyTx = await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(1, 18),
        expandDecimals(3980, 18),
        user0.address
      );
    await reportGasUsed(provider, buyTx, "buyNDOL gas used (ETH)");

    const tx = await router
      .connect(user0)
      .swap(
        [eth.address, btc.address],
        expandDecimals(1, 18),
        "6640000",
        user0.address
      );
    await reportGasUsed(provider, tx, "swap gas used");

    expect(await eth.balanceOf(user0.address)).eq(0);
    expect(await btc.balanceOf(user0.address)).eq("6646666"); // 0.066466 === 4000 / 60000 * 0.997
  });

  it("swap buyNDOL, swap buyNDOL, increasePositionETH (ETH -> WETH -> BTC)", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );

    console.log("BTC -> NDOL");

    await validateVaultBalance(expect, vaultNDOL, btc);
    console.log("BTC Vault Balance validated");

    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth
      .connect(user0)
      .approve(router.address, expandDecimals(200000, 18));

    await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(1, 18),
        expandDecimals(3980, 18),
        user0.address
      );
    console.log("ETH -> NDOL");

    await validateVaultBalance(expect, vaultNDOL, eth);
    console.log("WETH Vault Balance validated");

    await expect(
      router
        .connect(user0)
        .increasePositionETH(
          [eth.address, btc.address],
          btc.address,
          expandDecimals(5, 10),
          toUsd(3800),
          true,
          toNormalizedPrice(60000),
          {
            value: ethers.utils.parseEther("1"),
          }
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    await expect(
      router
        .connect(user0)
        .increasePositionETH(
          [eth.address, btc.address],
          btc.address,
          expandDecimals(1, 4),
          toUsd(3800),
          true,
          toNormalizedPrice(0),
          {
            value: ethers.utils.parseEther("1"),
          }
        )
    ).to.be.revertedWith("Router: mark price higher than limit");

    const tx = await router
      .connect(user0)
      .increasePositionETH(
        [eth.address, btc.address],
        btc.address,
        expandDecimals(1, 5),
        toUsd(4400),
        true,
        toNormalizedPrice(60000),
        {
          value: ethers.utils.parseEther("1"),
        }
      );
    await reportGasUsed(provider, tx, "increasePositionETH gas used");
  });

  it("swap (buyNDOL), increasePosition", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );

    console.log("BTC -> NDOL");

    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth
      .connect(user0)
      .approve(router.address, expandDecimals(200000, 18));

    await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(1, 18),
        expandDecimals(3980, 18),
        user0.address
      );
    console.log("ETH -> NDOL");

    await expect(
      router
        .connect(user0)
        .increasePosition(
          [eth.address, btc.address],
          btc.address,
          expandDecimals(1, 18),
          expandDecimals(5, 10),
          toUsd(3800),
          true,
          toNormalizedPrice(60000)
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    await expect(
      router
        .connect(user0)
        .increasePosition(
          [eth.address, btc.address],
          btc.address,
          expandDecimals(1, 18),
          expandDecimals(1, 4),
          toUsd(3800),
          true,
          toNormalizedPrice(0)
        )
    ).to.be.revertedWith("Router: mark price higher than limit");

    const tx = await router
      .connect(user0)
      .increasePosition(
        [eth.address, btc.address],
        btc.address,
        expandDecimals(1, 18),
        expandDecimals(1, 5),
        toUsd(4400),
        true,
        toNormalizedPrice(60000)
      );
    await reportGasUsed(provider, tx, "increasePosition gas used");
  });

  it("swap, increasePosition, decreasePosition", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );

    console.log("BTC -> NDOL");

    await eth.mint(user0.address, expandDecimals(2, 18));
    await eth
      .connect(user0)
      .approve(router.address, expandDecimals(200000, 18));

    await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(1, 18),
        expandDecimals(3980, 18),
        user0.address
      );
    console.log("ETH -> NDOL");

    await expect(
      router
        .connect(user0)
        .increasePosition(
          [eth.address, btc.address],
          btc.address,
          expandDecimals(1, 18),
          expandDecimals(5, 10),
          toUsd(3800),
          true,
          toNormalizedPrice(60000)
        )
    ).to.be.revertedWith("Router: insufficient amountOut");

    await expect(
      router
        .connect(user0)
        .increasePosition(
          [eth.address, btc.address],
          btc.address,
          expandDecimals(1, 18),
          expandDecimals(1, 4),
          toUsd(3800),
          true,
          toNormalizedPrice(0)
        )
    ).to.be.revertedWith("Router: mark price higher than limit");

    const tx = await router
      .connect(user0)
      .increasePosition(
        [eth.address, btc.address],
        btc.address,
        expandDecimals(1, 18),
        expandDecimals(1, 5),
        toUsd(4400),
        true,
        toNormalizedPrice(60000)
      );

    await reportGasUsed(provider, tx, "increasePosition gas used");

    await expect(
      router
        .connect(deployer) // position owner can decrease their own position not anyone else's
        .decreasePosition(
          btc.address,
          btc.address,
          "666667",
          "100000",
          true,
          user0.address,
          toNormalizedPrice(60000)
        )
    ).to.be.revertedWith("Vault: empty position");

    await expect(
      router.decreasePosition(
        eth.address,
        btc.address,
        "666667",
        "100000",
        true,
        user0.address,
        toNormalizedPrice(60000)
      )
    ).to.be.revertedWith("Vault: mismatched tokens");

    const decreaseTx = await router
      .connect(user0)
      .decreasePosition(
        btc.address,
        btc.address,
        "666667",
        toUsd(4400),
        true,
        user0.address,
        toNormalizedPrice(60000)
      );

    await reportGasUsed(provider, decreaseTx, "decreasePosition gas used");
  });

  it("swap, increasePositionETH, decreasePositionETH", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100000, 8));
    await router
      .connect(user0)
      .swap(
        [btc.address, ndol.address],
        expandDecimals(1, 8),
        expandDecimals(59800, 18),
        user0.address
      );

    console.log("BTC -> NDOL");

    await eth.mint(user0.address, expandDecimals(3, 18));
    await eth
      .connect(user0)
      .approve(router.address, expandDecimals(200000, 18));

    await router
      .connect(user0)
      .swap(
        [eth.address, ndol.address],
        expandDecimals(2, 18),
        expandDecimals(3980, 18),
        user0.address
      );
    console.log("ETH -> NDOL");

    await expect(
      router
        .connect(user0)
        .increasePositionETH(
          [eth.address],
          eth.address,
          expandDecimals(5, 18),
          toUsd(80000),
          true,
          toNormalizedPrice(4000),
          {
            value: ethers.utils.parseEther("1"),
          }
        )
    ).to.be.revertedWith("Vault: reserve exceeds pool");

    await expect(
      router
        .connect(user0)
        .increasePositionETH(
          [eth.address],
          eth.address,
          expandDecimals(1, 18),
          toUsd(3900),
          true,
          toNormalizedPrice(4000),
          {
            value: ethers.utils.parseEther("1"),
          }
        )
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await expect(
      router
        .connect(user0)
        .increasePositionETH(
          [eth.address],
          eth.address,
          expandDecimals(1, 18),
          toUsd(4400),
          true,
          toNormalizedPrice(0),
          {
            value: ethers.utils.parseEther("1"),
          }
        )
    ).to.be.revertedWith("Router: mark price higher than limit");

    const tx = await router
      .connect(user0)
      .increasePositionETH(
        [eth.address],
        eth.address,
        expandDecimals(1, 18),
        toUsd(4400),
        true,
        toNormalizedPrice(4000),
        {
          value: ethers.utils.parseEther("1"),
        }
      );

    await reportGasUsed(provider, tx, "increasePositionETH gas used");

    await expect(
      router
        .connect(user0)
        .decreasePositionETH(
          eth.address,
          eth.address,
          expandDecimals(1, 18),
          toUsd(1000),
          true,
          user0.address,
          toNormalizedPrice(4000)
        )
    ).to.be.revertedWith("Vault: _size must be more than _collateral");

    await expect(
      router
        .connect(user0)
        .decreasePositionETH(
          eth.address,
          eth.address,
          expandDecimals(1, 18),
          toUsd(10000),
          true,
          user0.address,
          toNormalizedPrice(4000)
        )
    ).to.be.revertedWith("Vault: position size exceeded");

    const ethBalanceBefore = await provider.getBalance(user0.address);

    const decreasePositionETHTx = await router
      .connect(user0)
      .decreasePositionETH(
        eth.address,
        eth.address,
        expandDecimals(1, 18),
        toUsd(4400),
        true,
        user0.address,
        toNormalizedPrice(4000)
      );

    await reportGasUsed(
      provider,
      decreasePositionETHTx,
      "decreasePositionETH gas used"
    );

    const ethBalanceAfter = await provider.getBalance(user0.address);

    expect(ethBalanceAfter.gt(ethBalanceBefore)).eq(true);
  });
});
