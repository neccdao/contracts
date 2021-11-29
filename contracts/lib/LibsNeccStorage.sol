// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./LibDiamond.sol";

interface IOracle {
    function getPrice(address _pool) external returns (uint256);
}

uint256 constant MAX_UINT256 = ~uint256(0);
uint256 constant INITIAL_FRAGMENTS_SUPPLY = 5000000 * 10**9;
// TOTAL_GONS is a multiple of INITIAL_FRAGMENTS_SUPPLY so that _gonsPerFragment is an integer.
// Use the highest value that fits in a uint256 for max granularity.
uint256 constant TOTAL_GONS = MAX_UINT256 -
    (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);
// MAX_SUPPLY = maximum integer < (sqrt(4*TOTAL_GONS + 1) - 1) / 2
uint256 constant MAX_SUPPLY = ~uint128(0); // (2^128) - 1

library LibsNeccStorage {
    using SafeMath for uint256;

    struct Rebase {
        uint256 epoch;
        uint256 rebase; // 18 decimals
        uint256 totalStakedBefore;
        uint256 totalStakedAfter;
        uint256 amountRebased;
        uint256 index;
        uint256 blockNumberOccured;
    }

    struct Layout {
        uint256 INDEX; // Index Gons - tracks rebase growth
        address stakingContract; // balance used to calc rebase
        IOracle oracle; // pulls price from pool
        address pool;
        Rebase[] rebases; // past rebase data
        uint256 _gonsPerFragment;
        mapping(address => uint256) _gonBalances;
        mapping(address => mapping(address => uint256)) _allowedValue;
    }

    bytes32 internal constant STORAGE_SLOT =
        keccak256("necc.dao.sNecc.storage");

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    function _onlyStakingContract(Layout storage n) internal view {
        require(msg.sender == n.stakingContract, "NDOL: only stakingContract");
    }

    function _onlyGov() internal view {
        LibDiamond.enforceIsContractOwner();
    }

    function _gov() internal view returns (address) {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        return ds.contractOwner;
    }

    function _setGov(address _newGov) internal {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.contractOwner = _newGov;
    }
}
