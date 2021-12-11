// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

// import "hardhat/console.sol";

library LibTreasuryStorage {
    bytes32 constant STORAGE_POSITION = keccak256("necc.dao.treasury.storage");

    // Single global store
    struct Storage {
        address Necc;
        address sNecc;
        address nNecc;
        uint256 blocksNeededForQueue;
        address[] reserveTokens; // Push only, beware false-positives.
        uint256 sNeccQueue; // Delays change to sNecc address
        uint256 totalReserves; // Risk-free value of all assets
        uint256 totalDebt;
        uint256 neccDebt;
        mapping(address => bool) isReserveToken;
        mapping(address => uint256) reserveTokenQueue; // Delays changes to mapping.
        address[] reserveDepositors; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isReserveDepositor;
        mapping(address => uint256) reserveDepositorQueue; // Delays changes to mapping.
        address[] reserveSpenders; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isReserveSpender;
        mapping(address => uint256) reserveSpenderQueue; // Delays changes to mapping.
        address[] liquidityTokens; // Push only, beware false-positives.
        mapping(address => bool) isLiquidityToken;
        mapping(address => uint256) LiquidityTokenQueue; // Delays changes to mapping.
        address[] liquidityDepositors; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isLiquidityDepositor;
        mapping(address => uint256) LiquidityDepositorQueue; // Delays changes to mapping.
        address[] reserveManagers; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isReserveManager;
        mapping(address => uint256) ReserveManagerQueue; // Delays changes to mapping.
        address[] liquidityManagers; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isLiquidityManager;
        mapping(address => uint256) LiquidityManagerQueue; // Delays changes to mapping.
        address[] debtors; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isDebtor;
        mapping(address => uint256) debtorQueue; // Delays changes to mapping.
        address[] rewardManagers; // Push only, beware false-positives. Only for viewing.
        mapping(address => bool) isRewardManager;
        mapping(address => uint256) rewardManagerQueue; // Delays changes to mapping.
        // Always add new storage variable to the end of this struct
    }
}
