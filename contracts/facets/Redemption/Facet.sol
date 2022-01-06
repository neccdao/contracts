// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "../../lib/LibDiamond.sol";

contract Facet {
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
