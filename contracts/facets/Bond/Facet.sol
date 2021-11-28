// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "../../lib/LibBondStorage.sol";
import "../../lib/LibDiamond.sol";

contract Facet {
    LibBondStorage.Storage internal s;

    function onlyGov() internal view {
        LibDiamond.enforceIsContractOwner();
    }
}
