const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract, contractAt } = require("../../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  newWallet,
} = require("../../shared/utilities");
const { toChainlinkPrice } = require("../../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../../shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
  zeroAddress,
} = require("../../core/Vault/helpers");

use(solidity);

const weiroll = require("@weiroll/weiroll.js");

function getPositionQuery(tokens) {
  const collateralTokens = [];
  const indexTokens = [];
  const isLong = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    collateralTokens.push(token.address);
    indexTokens.push(token.address);
    isLong.push(true);
  }

  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    collateralTokens.push(token.address);
    indexTokens.push(token.address);
    isLong.push(false);
  }

  return { collateralTokens, indexTokens, isLong };
}

describe("Vault.liquidateLongPosition (with weiroll)", function () {
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
  let tokens;
  let planner;
  let wrVault;

  beforeEach(async () => {
    diamond = await deployments.fixture(["ExchangeDiamond-hardhat"]);
    const { execute, deploy } = deployments;
    exchangeDiamond = diamond.ExchangeDiamond;

    bnb = await deployments.deploy("BNBToken", {
      contract: "Token",
      from: deployer.address,
    });
    bnb = await contractAt("Token", bnb.address);
    btc = await deployments.get("BTCToken");
    btc = await contractAt("Token", btc.address);
    eth = await deployments.get("ETHToken");
    eth = await contractAt("Token", eth.address);

    vault = await contractAt("VaultFacet", exchangeDiamond.address);
    vaultNDOL = await contractAt("VaultNdolFacet", exchangeDiamond.address);
    router = await contractAt("RouterFacet", exchangeDiamond.address);
    ndol = await contractAt("NdolFacet", diamond.NdolDiamond?.address);
    vaultPriceFeed = await contractAt(
      "VaultPriceFeedFacet",
      exchangeDiamond.address
    );
    reader = await contractAt("ReaderFacet", exchangeDiamond.address);

    planner = new weiroll.Planner();
    vm = await deployments.get("TestableVM");
    vm = await contractAt("TestableVM", vm.address);
    wrVault = await weiroll.Contract.createContract(vault);

    bnbPriceFeed = await deployments.deploy("BNBPriceFeed", {
      from: deployer.address,
      contract: "PriceFeed",
    });
    bnbPriceFeed = await contractAt("PriceFeed", bnbPriceFeed.address);
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500));

    ethPriceFeed = await deployments.get("ETHPriceFeed");
    ethPriceFeed = await contractAt("PriceFeed", ethPriceFeed.address);

    btcPriceFeed = await deployments.get("BTCPriceFeed");
    btcPriceFeed = await contractAt("PriceFeed", btcPriceFeed.address);

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

    tokens = [
      {
        name: "Bitcoin (WBTC)",
        symbol: "BTC",
        decimals: 8,
        address: btc.address,
      },
      {
        name: "ETH",
        symbol: "ETH",
        decimals: 18,
        address: ethers.constants.AddressZero,
      },
      {
        name: "Wrapped Ethereum",
        symbol: "WETH",
        decimals: 18,
        address: eth.address,
        isWrapped: true, // NOTE - Seems required even though shown in from token selector list
      },
    ];
  });

  it("liquidate long x2 in same block", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));

    // **
    // setup user0 for liquidation

    await btc.mint(deployer.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD
    await vaultNDOL.buyNDOL(btc.address, deployer.address);

    await btc.mint(user0.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 25000); // 0.00025 BTC => 10 USD
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

    expect(
      (
        await vault.validateLiquidation(
          user0.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));

    let delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(true);
    expect(delta[1]).eq("7875000000000000000000000000000"); // ~7.875
    expect(
      (
        await vault.validateLiquidation(
          user0.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("2250000000000000000000000000000"); // ~2.25
    expect(
      (
        await vault.validateLiquidation(
          user0.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(0);

    await expect(
      vault.liquidatePosition(
        user0.address,
        btc.address,
        btc.address,
        true,
        deployer.address
      )
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36700));
    delta = await vault.getPositionDelta(
      user0.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta[0]).eq(false);
    expect(delta[1]).eq("7425000000000000000000000000000"); // ~5.04
    expect(
      (
        await vault.validateLiquidation(
          user0.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(1);

    position = await vault.getPosition(
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

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(225000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(80.09));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(274250 - 225);
    expect(await btc.balanceOf(user0.address)).eq(100000000);

    // **
    // setup deployer for liquidation

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000));
    await btc.mint(deployer.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 250000); // 0.0025 BTC => 100 USD

    await vaultNDOL.buyNDOL(btc.address, deployer.address);

    await btc.mint(deployer.address, expandDecimals(1, 8));
    await btc.connect(deployer).transfer(vault.address, 27000); // 0.00025 BTC => 10.4 USD

    await vault
      .connect(deployer)
      .increasePosition(
        deployer.address,
        btc.address,
        btc.address,
        toUsd(90),
        true
      );

    let position2 = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position2[0]).eq(toUsd(90)); // size
    expect(position2[1]).eq(toUsd(10.71)); // collateral, 10 - 90 * 0.1%
    expect(position2[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position2[3]).eq(0); // entryFundingRate
    expect(position2[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    expect(
      (
        await vault.validateLiquidation(
          deployer.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500));

    delta2 = await vault.getPositionDelta(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta2[0]).eq(true);
    expect(delta2[1]).eq("7875000000000000000000000000000"); // ~5.48
    expect(
      (
        await vault.validateLiquidation(
          deployer.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(0);

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000));
    delta2 = await vault.getPositionDelta(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta2[0]).eq(false);
    expect(delta2[1]).eq("2250000000000000000000000000000"); // ~2.25
    expect(
      (
        await vault.validateLiquidation(
          deployer.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(0);

    await expect(
      vault.liquidatePosition(
        deployer.address,
        btc.address,
        btc.address,
        true,
        deployer.address
      )
    ).to.be.revertedWith("Vault: position cannot be liquidated");

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(37500));
    delta2 = await vault.getPositionDelta(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(delta2[0]).eq(false);
    expect(
      (
        await vault.validateLiquidation(
          deployer.address,
          btc.address,
          btc.address,
          true,
          false
        )
      )[0]
    ).eq(1);

    position = await vault.getPosition(
      deployer.address,
      btc.address,
      btc.address,
      true
    );
    expect(position[0]).eq(toUsd(90)); // size
    expect(position[1]).eq(toUsd(10.71)); // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(225000); // reserveAmount, 0.00225 * 40,000 => 90

    expect(await vaultNDOL.feeReserves(btc.address)).eq(975 * 2);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(450000);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(toUsd(159.38));
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(550050);

    // **
    // liquidate user0 and deployer positions in the same block with user2 liquidation fee receiver

    const ipEventFilter = vault.filters.IncreasePosition();
    // fromBlock 0 on first
    const ipEvents = await vault.queryFilter(ipEventFilter, 0, "latest");

    const addresses = ipEvents.map((o) => o?.args?.account);
    const uniqueAddresses = ipEvents
      .filter(
        ({ args: { account } }, index) =>
          !addresses.includes(account, index + 1)
      )
      .map(({ args: { account } }) => account);

    // From frontend, most maintain tokens array
    const positionQuery = getPositionQuery(tokens);
    const positionPromises = uniqueAddresses.map(async (_account) => {
      return await reader.getPositions(
        vault.address,
        _account,
        positionQuery.collateralTokens,
        positionQuery.indexTokens,
        positionQuery.isLong
      );
    });

    const uniqueAddressPositions = await Promise.all(positionPromises);
    // console.log(uniqueAddressPositions);

    // [
    // uniqueAddress1: [position1 properties], ...[positionN properties],
    // ...uniqueAddressN: [..., ...]
    // ]
    const positionPropsLength = 9;
    const uniqueAddressPositionsToValidate = uniqueAddressPositions.map(
      (positionsForAddress, uniqueAddressIndex) => {
        const validateLiquidationPositionsForUniqueAddress = [];
        for (let i = 0; i < positionQuery.collateralTokens.length; i++) {
          // no position size so ignore
          if (positionsForAddress[positionPropsLength * i]?.toString() == "0") {
            continue;
          }
          const account = uniqueAddresses[uniqueAddressIndex];
          const collateralToken = positionQuery.collateralTokens[i];
          const indexToken = positionQuery.indexTokens[i];
          const isLong = positionQuery.isLong[i];
          const isRaise = false;

          const positionToValidateForLiquidation = [
            account,
            collateralToken,
            indexToken,
            isLong,
            isRaise,
          ];

          validateLiquidationPositionsForUniqueAddress.push(
            positionToValidateForLiquidation
          );
        }

        return validateLiquidationPositionsForUniqueAddress;
      }
    );
    /*
    uniqueAddressPositionsToValidate ===
    [
      address 1 => [[ position1 ], ...[]],
      address n => [[ position1 ], ...[]],
    ]
    */
    const uniqueAddressPositionsToValidatePromises =
      uniqueAddressPositionsToValidate
        .map(async (uniqueAddressPositions, uniqueAddressIndex) => {
          const validationPromises = uniqueAddressPositions.map(
            async (positionToValidate) => {
              const [liquidationState] = await vault.validateLiquidation(
                ...positionToValidate
              );
              if (liquidationState.gt(0)) {
                const result = await positionToValidate;
                return result;
              }
            }
          );

          const validationResults = await Promise.all(validationPromises);
          return validationResults;
        })
        .flat();

    const uniqueAddressesPositionsToLiquidate = await Promise.all(
      uniqueAddressPositionsToValidatePromises
    );

    if (uniqueAddressesPositionsToLiquidate.length === 0) {
      console.log(
        "Empty uniqueAddressesPositionsToLiquidate: ",
        uniqueAddressesPositionsToLiquidate
      );
    }

    uniqueAddressesPositionsToLiquidate.map((liquidablePositions) => {
      liquidablePositions.map((positionToLiquidate) => {
        // remove isRaise boolean since not needed in liquidatePosition
        positionToLiquidate.pop();
        planner.add(
          wrVault.liquidatePosition(...positionToLiquidate, deployer.address)
        );
      });
    });

    // Execute weiroll plan with deployed VM with user0 who is the liquidation fee receiver

    const deployerBTCBalanceBefore = await btc.balanceOf(deployer.address);
    // 299448000
    // 22988
    // 299474666

    const { commands, state } = planner.plan();
    const tx = await vm.execute(commands, state);
    const receipt = await tx.wait();
    await reportGasUsed(provider, tx, "liquidatePosition x2 gas used");

    const eventFilter = vault.filters.LiquidatePosition();
    const events = await vault.queryFilter(eventFilter, "latest");
    expect(events.length).eq(2);
    expect(events[0].blockNumber).eq(events[1].blockNumber);
    expect(events[0].event).eq(events[1].event);
    expect(events[0].args.account).not.to.eq(events[1].args.account);

    // **
    // positions liquidated, deployer paid liquidation fees in btc

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

    position = await vault.getPosition(
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

    expect(await vaultNDOL.feeReserves(btc.address)).eq(2430);
    expect(await vaultNDOL.reservedAmounts(btc.address)).eq(0);
    expect(await vaultNDOL.guaranteedUsd(btc.address)).eq(0);
    expect(await vaultNDOL.poolAmounts(btc.address)).eq(523384);

    // liquidation fee is set to 5 usd paid in collateral token
    // deployer is receiver of 2 liquidations
    expect(await btc.balanceOf(deployer.address)).eq(
      deployerBTCBalanceBefore.add(13333 * 2)
    );

    expect(await btc.balanceOf(vault.address)).eq(525334);

    let balance = await btc.balanceOf(vault.address);
    let poolAmount = await vaultNDOL.poolAmounts(btc.address);
    const feeReserve = await vaultNDOL.feeReserves(btc.address);
    expect(poolAmount.add(feeReserve).sub(balance)).eq(240 * 2);
    expect(balance).gt(poolAmount);

    await btc.mint(vault.address, 1000);
    await vaultNDOL.buyNDOL(btc.address, user0.address);
    await btc.mint(vault.address, 1000);
    await vaultNDOL.buyNDOL(btc.address, deployer.address);
    balance = await btc.balanceOf(vault.address);
    poolAmount = await vaultNDOL.poolAmounts(btc.address);
    expect(balance).gt(poolAmount);
  });
});
