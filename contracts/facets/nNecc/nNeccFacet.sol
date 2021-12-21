// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {ERC20, ERC20Extended} from "@solidstate/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@solidstate/contracts/token/ERC20/permit/ERC20Permit.sol";
import {ERC20MetadataStorage} from "@solidstate/contracts/token/ERC20/metadata/ERC20MetadataStorage.sol";
import {ERC20BaseStorage} from "@solidstate/contracts/token/ERC20/base/ERC20BaseStorage.sol";
import "../../lib/LibnNeccStorage.sol";

// import "hardhat/console.sol";

interface IsNecc is IERC20 {
    function rebase(uint256 neccProfit_, uint256 epoch_)
        external
        returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function balanceOf(address who) external view override returns (uint256);

    function gonsForBalance(uint256 amount) external view returns (uint256);

    function balanceForGons(uint256 gons) external view returns (uint256);

    function index() external view returns (uint256);
}

contract nNeccFacet is ERC20, ERC20Permit {
    using ERC20MetadataStorage for ERC20MetadataStorage.Layout;
    using LibnNeccStorage for LibnNeccStorage.Layout;
    using SafeMath for uint256;

    function initialize(address _stakingContract, address _sNecc) external {
        LibnNeccStorage._onlyGov();
        ERC20MetadataStorage.Layout storage s = ERC20MetadataStorage.layout();
        LibnNeccStorage.Layout storage n = LibnNeccStorage.layout();

        s.setName("Wrapped Staked Necc");
        s.setSymbol("nNECC");
        s.setDecimals(18);
        n.stakingContract = _stakingContract;
        n.sNecc = _sNecc;
    }

    function setGov(address _newOwner) public {
        LibnNeccStorage._setGov(_newOwner);
    }

    function gov() public view returns (address) {
        return LibnNeccStorage._gov();
    }

    function mint(address _to, uint256 _amount) external {
        LibnNeccStorage.Layout storage n = LibnNeccStorage.layout();
        n._onlyStakingContract();

        _mint(_to, _amount);
    }

    /**
        @notice burn nNecc
        @param _from address
        @param _amount uint
     */
    function burn(address _from, uint256 _amount) external {
        LibnNeccStorage.Layout storage n = LibnNeccStorage.layout();
        n._onlyStakingContract();

        _burn(_from, _amount);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice pull index from sNecc token
     */
    function index() public view returns (uint256) {
        LibnNeccStorage.Layout storage n = LibnNeccStorage.layout();
        return IsNecc(n.sNecc).index();
    }

    /**
        @notice converts nNecc amount to Necc
        @param _amount uint
        @return uint
     */
    function balanceFrom(uint256 _amount) public view returns (uint256) {
        return _amount.mul(index()).div(10**decimals());
    }

    /**
        @notice converts Necc amount to nNecc
        @param _amount uint
        @return uint
     */
    function balanceTo(uint256 _amount) public view returns (uint256) {
        return _amount.mul(10**decimals()).div(index());
    }

    function stakingContract() public view returns (address) {
        LibnNeccStorage.Layout storage n = LibnNeccStorage.layout();

        return n.stakingContract;
    }
}
