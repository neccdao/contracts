// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

enum PARAMETER {
    VESTING,
    PAYOUT,
    FEE,
    DEBT,
    MINPRICE
}

enum CONTRACTS {
    DISTRIBUTOR,
    WARMUP,
    LOCKER
}

uint256 constant BCV_ADJUSTMENT_EPOCH_PERIOD = 1; // how many epochs to spread an adjustment across

library LibBondStorage {
    bytes32 constant STORAGE_POSITION = keccak256("necc.dao.bond.storage");

    struct Payout {
        uint256 amount; // Necc paid
        uint256 blockTimestamp; // block number occurred
    }

    struct Info {
        uint256 rate; // in ten-thousandths ( 5000 = 0.5% )
        address recipient;
    }

    struct DistributorAdjustment {
        bool add;
        uint256 rate;
        uint256 target;
    }

    struct Terms {
        uint256 controlVariable; // scaling variable for price
        uint256 minimumPrice; // vs principle value
        uint256 maxPayout; // in thousandths of a %. i.e. 500 = 0.5%
        uint256 fee; // as % of bond payout, in hundreths. ( 500 = 5% = 0.05 for every 1 paid)
        uint256 maxDebt; // 9 decimal debt ratio, max % total supply created as debt
        uint256 vestingTerm; // in seconds
        bool isLiquidityBond; // Reserve and LP tokens are treated differently, LP uses bond calculator
    }

    // Info for bond holder
    struct Bond {
        uint256 payout; // Necc remaining to be paid
        uint256 pricePaid; // In DAI, for front end viewing
        uint256 lastTime; // Last interaction
        uint256 vesting; // Seconds left to vest
    }

    // Info for incremental adjustments to control variable
    struct BondDepositoryAdjustment {
        bool add; // addition or subtraction
        uint256 delta; // increment
        uint256 timeToTarget; // seconds till target
        uint256 lastTime; // time when last adjustment made
    }
    struct Epoch {
        uint256 number;
        uint256 distribute;
        uint256 length;
        uint256 endTime;
    }

    struct Claim {
        uint256 deposit;
        uint256 gons;
        uint256 expiry;
        bool lock; // prevents malicious delays
    }

    // Single global store
    struct Storage {
        address Necc; // token given as payment for bond
        address nNecc; // token given for staking
        address ndol; // principle token without price feed
        address treasury; // mints Necc when receives principle
        address DAO; // receives profit share from bond
        address farmDistributor; // receives profit share from bond to distribute to minters
        address staking; // to auto-stake payout
        //
        EnumerableSet.AddressSet principles;
        mapping(uint256 => Terms) terms; // stores terms for new bonds
        mapping(uint256 => BondDepositoryAdjustment) bondDepositoryAdjustment; // stores adjustment to BCV data
        mapping(address => mapping(uint256 => Bond)) bondInfo; // stores bond information for depositors
        mapping(uint256 => uint256) totalDebt; // total value of outstanding bonds; used for pricing
        mapping(uint256 => uint256) lastDecay; // reference time for debt decay
        mapping(uint256 => uint256) nextEpochTimestamp; // block number of next epoch
        mapping(uint256 => address) priceFeeds; // price feed of reserve principle not NDOL
        //
        Info[] info; // stores infof or distribution recipients
        mapping(uint256 => DistributorAdjustment) distributorAdjustments;
        //
        Epoch epoch;
        uint256 epochLength;
        address distributor;
        address locker;
        uint256 totalBonus;
        uint256 warmupPeriod;
        mapping(address => Claim) warmupInfo;
        //
        uint256 targetSum; // target total Necc as payouts during period
        mapping(uint256 => Payout[]) payouts; // storage of all past payouts
        uint256 gonsInWarmup; // total gons in warmup period
        //
        // Always add new storage variable to the end of this struct
    }
}
