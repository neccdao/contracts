// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "../../lib/LibTreasuryStorage.sol";
import "../../lib/LibDiamond.sol";

contract Facet {
    LibTreasuryStorage.Storage internal s;

    function onlyGov() internal view {
        LibDiamond.enforceIsContractOwner();
    }
}
