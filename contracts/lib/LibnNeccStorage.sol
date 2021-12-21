// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./LibDiamond.sol";

library LibnNeccStorage {
    using SafeMath for uint256;

    struct Layout {
        address sNecc; // staked necc
        address stakingContract; // staked necc
    }

    bytes32 internal constant STORAGE_SLOT =
        keccak256("necc.dao.nNecc.storage");

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
