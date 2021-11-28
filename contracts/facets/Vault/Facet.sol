// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "../../lib/LibExchangeStorage.sol";
import "../../lib/LibDiamond.sol";

contract Facet {
    LibExchangeStorage.Storage internal s;

    constructor() {
        s.contractEntered = false;
    }

    function onlyGov() internal view {
        LibDiamond.enforceIsContractOwner();
    }

    function _setGov(address _newGov) internal {
        onlyGov();
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.contractOwner = _newGov;
    }

    function contractEntered() internal {
        require(!s.contractEntered, "Contract already entered");
        s.contractEntered = true;
    }

    function contractExited() internal {
        s.contractEntered = false;
    }
}
