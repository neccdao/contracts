// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import {ERC20, ERC20Extended} from "@solidstate/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@solidstate/contracts/token/ERC20/permit/ERC20Permit.sol";
import {ERC20MetadataStorage} from "@solidstate/contracts/token/ERC20/metadata/ERC20MetadataStorage.sol";
import {ERC20BaseStorage} from "@solidstate/contracts/token/ERC20/base/ERC20BaseStorage.sol";
import {LibNeccStorage} from "../../lib/LibNeccStorage.sol";

contract NeccFacet is ERC20, ERC20Permit {
    using ERC20MetadataStorage for ERC20MetadataStorage.Layout;
    using LibNeccStorage for LibNeccStorage.Layout;

    function initialize(address _vault) external {
        LibNeccStorage._onlyGov();
        ERC20MetadataStorage.Layout storage s = ERC20MetadataStorage.layout();
        LibNeccStorage.Layout storage n = LibNeccStorage.layout();

        s.setName("Necc");
        s.setSymbol("NECC");
        s.setDecimals(9);
        n._addVault(_vault);
    }

    function setGov(address _newOwner) public {
        LibNeccStorage._setGov(_newOwner);
    }

    function gov() public view returns (address) {
        return LibNeccStorage._gov();
    }

    function vaults(address vault) public view returns (bool) {
        LibNeccStorage.Layout storage n = LibNeccStorage.layout();
        return n._vaults(vault);
    }

    function addVault(address _vault) external {
        LibNeccStorage.Layout storage n = LibNeccStorage.layout();
        n._addVault(_vault);
    }

    function removeVault(address _vault) external {
        LibNeccStorage.Layout storage n = LibNeccStorage.layout();
        n._removeVault(_vault);
    }

    function mint(address _account, uint256 _amount) external {
        LibNeccStorage.Layout storage n = LibNeccStorage.layout();
        n._onlyVaults(msg.sender);
        _mint(_account, _amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFrom(address _account, uint256 _amount) public virtual {
        _burnFrom(_account, _amount);
    }

    function _burnFrom(address _account, uint256 _amount) internal {
        decreaseAllowance(_account, _amount);
        _burn(_account, _amount);
    }
}
