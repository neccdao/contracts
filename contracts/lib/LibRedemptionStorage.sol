// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./LibDiamond.sol";

library LibRedemptionStorage {
    struct Layout {
        address weth;
        address nNecc;
        address ndol;
        uint256 wethPrice;
        uint256 nNeccFloorPrice;
        uint256 ndolRedemptionRatio;
    }

    bytes32 internal constant STORAGE_SLOT =
        keccak256("necc.dao.redemption.storage");

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
