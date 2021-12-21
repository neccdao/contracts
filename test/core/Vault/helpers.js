const { expandDecimals } = require("../../shared/utilities");
const { toUsd } = require("../../shared/units");

const zeroAddress = "0x0000000000000000000000000000000000000000";

async function initVault(vault, router, ndol, priceFeed) {
  await vault
    .initialize
    // router.address, // router
    // ndol.address, // ndol
    // priceFeed.address, // priceFeed
    // expandDecimals(600 * 1000, 18), // maxNDOLBatchSize
    // expandDecimals(100 * 1000, 18), // maxNDOLBuffer
    // toUsd(5), // liquidationFeeUsd
    // 600, // fundingRateFactor
    // 20000 // maxDebtBasisPoints
    ();
}

async function validateVaultBalance(expect, vault, token, offset) {
  if (!offset) {
    offset = 0;
  }
  const poolAmount = await vault.poolAmounts(token.address);
  const feeReserve = await vault.feeReserves(token.address);
  const balance = await token.balanceOf(vault.address);
  let amount = poolAmount.add(feeReserve);
  expect(balance).gt(0);
  expect(poolAmount.add(feeReserve).add(offset)).gte(balance);
}

function getBnbConfig(bnb, bnbPriceFeed) {
  return [
    bnb.address, // _token
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    true, // _isShortable
  ];
}

function getEthConfig(eth, ethPriceFeed) {
  return [
    eth.address, // _token
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    true, // _isShortable
  ];
}

function getBtcConfig(btc, btcPriceFeed) {
  return [
    btc.address, // _token
    8, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    true, // _isShortable
  ];
}

function getDaiConfig(dai, daiPriceFeed) {
  return [
    dai.address, // _token
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false, // _isShortable
  ];
}

module.exports = {
  initVault,
  validateVaultBalance,
  getBnbConfig,
  getBtcConfig,
  getEthConfig,
  getDaiConfig,
  zeroAddress,
};
