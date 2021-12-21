// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

// import "hardhat/console.sol";
uint256 constant _NOT_ENTERED = 1;
uint256 constant _ENTERED = 2;

uint256 constant BASIS_POINTS_DIVISOR = 10000;
uint256 constant FUNDING_RATE_PRECISION = 10**6;
uint256 constant PRICE_PRECISION = 10**30;
uint256 constant NDOL_DECIMALS = 18;
uint256 constant ONE_USD = PRICE_PRECISION;
uint256 constant POSITION_PROPS_LENGTH = 9;

uint256 constant PRICE_SAMPLE_SPACE = 1;
uint256 constant MAX_LEVERAGE = 50 * 10000; // 50x
uint256 constant LIQUIDATION_FEE_USD = 5 * PRICE_PRECISION; // 5 USD
uint256 constant SWAP_FEE_BASIS_POINTS = 30; // 0.3%
uint256 constant MARGIN_FEE_BASIS_POINTS = 10; // 0.1%
uint256 constant MIN_PROFIT_TIME = 60 * 15; // 15 minutes
uint256 constant FUNDING_RATE_FACTOR = 600; // out of 1000
uint256 constant FUNDING_INTERVAL = 8 hours;

library LibExchangeStorage {
    bytes32 constant STORAGE_POSITION = keccak256("necc.dao.exchange.storage");

    struct Position {
        uint256 size;
        uint256 collateral;
        uint256 averagePrice;
        uint256 entryFundingRate;
        uint256 reserveAmount;
        int256 realisedPnl;
        uint256 lastIncreasedTime;
    }

    // Single global store
    struct Storage {
        bool contractEntered;
        address btc;
        address weth;
        address ndol;
        bool includeAmmPrice;
        bool isInitialized;
        EnumerableSet.AddressSet tokens;
        mapping(address => bool) whitelistedTokens;
        mapping(bytes32 => Position) positions;
        mapping(address => uint256) tokenDecimals;
        mapping(address => uint256) redemptionBasisPoints;
        mapping(address => uint256) minProfitBasisPoints;
        mapping(address => uint256) tokenBalances;
        mapping(address => uint256) ndolAmounts;
        mapping(address => uint256) poolAmounts;
        mapping(address => uint256) reservedAmounts;
        mapping(address => uint256) guaranteedUsd;
        mapping(address => uint256) cumulativeFundingRates;
        mapping(address => uint256) lastFundingTimes;
        mapping(address => uint256) feeReserves;
        mapping(address => uint256) tokenWeights;
        uint256 totalTokenWeight;
        // Router
        mapping(address => bool) plugins;
        // PriceFeed
        mapping(address => address) priceFeeds;
        mapping(address => uint256) priceDecimals;
        mapping(address => uint256) priceSpreadBasisPoints;
        mapping(address => address) baseTokenPairs; // x*y=k AMM Base Pair address i.e. wXUSDC
        mapping(address => address) tokenPairs; // x*y=k AMM Pair address i.e. wETHwX
        //
        int256 answer;
        uint80 roundId;
        mapping(uint80 => int256) answers;
        //
        uint256 totalNDOLMinted;
        mapping(address => mapping(address => int256)) ndolMinted; // [address][token] => amount
        // Always add new storage variable to the end of this struct
    }
}
