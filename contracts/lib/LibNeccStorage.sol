// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./LibDiamond.sol";

library LibNeccStorage {
    struct Layout {
        mapping(address => bool) vaults;
    }

    bytes32 internal constant STORAGE_SLOT = keccak256("necc.dao.necc.storage");

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    function _onlyVaults(Layout storage n, address _vault) internal view {
        require(n.vaults[_vault], "NDOL: only vaults");
    }

    function _onlyGov() internal view {
        LibDiamond.enforceIsContractOwner();
    }

    function _gov() internal view returns (address) {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        return ds.contractOwner;
    }

    function _addVault(Layout storage n, address _vault) internal {
        _onlyGov();
        n.vaults[_vault] = true;
    }

    function _removeVault(Layout storage n, address _vault) internal {
        _onlyGov();
        n.vaults[_vault] = false;
    }

    function _setGov(address _newGov) internal {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.contractOwner = _newGov;
    }

    function _vaults(Layout storage n, address vault)
        internal
        view
        returns (bool)
    {
        return n.vaults[vault];
    }
}
