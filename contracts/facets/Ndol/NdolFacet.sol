// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import {ERC20} from "@solidstate/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@solidstate/contracts/token/ERC20/permit/ERC20Permit.sol";
import {ERC20MetadataStorage} from "@solidstate/contracts/token/ERC20/metadata/ERC20MetadataStorage.sol";
import {LibNdolStorage} from "../../lib/LibNdolStorage.sol";

contract NdolFacet is ERC20, ERC20Permit {
    using ERC20MetadataStorage for ERC20MetadataStorage.Layout;
    using LibNdolStorage for LibNdolStorage.Layout;

    function initialize(address _vault) external {
        LibNdolStorage.Layout storage n = LibNdolStorage.layout();
        ERC20MetadataStorage.Layout storage s = ERC20MetadataStorage.layout();
        LibNdolStorage._onlyGov();

        s.setName("Necc Dollars");
        s.setSymbol("NDOL");
        s.setDecimals(18);
        n._addVault(_vault);
    }

    function addVault(address _vault) external {
        LibNdolStorage.Layout storage n = LibNdolStorage.layout();
        n._addVault(_vault);
    }

    function removeVault(address _vault) external {
        LibNdolStorage.Layout storage n = LibNdolStorage.layout();
        n._removeVault(_vault);
    }

    function mint(address _account, uint256 _amount) external {
        LibNdolStorage.Layout storage n = LibNdolStorage.layout();
        n._onlyVaults(msg.sender);
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external {
        LibNdolStorage.Layout storage n = LibNdolStorage.layout();
        n._onlyVaults(msg.sender);
        _burn(_account, _amount);
    }

    function setGov(address _newOwner) public {
        LibNdolStorage._setGov(_newOwner);
    }

    function gov() public view returns (address) {
        return LibNdolStorage._gov();
    }

    function vaults(address vault) public view returns (bool) {
        LibNdolStorage.Layout storage n = LibNdolStorage.layout();
        return n._vaults(vault);
    }
}
