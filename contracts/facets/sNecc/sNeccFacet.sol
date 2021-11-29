// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {ERC20, ERC20Extended} from "@solidstate/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@solidstate/contracts/token/ERC20/permit/ERC20Permit.sol";
import {ERC20MetadataStorage} from "@solidstate/contracts/token/ERC20/metadata/ERC20MetadataStorage.sol";
import {ERC20BaseStorage} from "@solidstate/contracts/token/ERC20/base/ERC20BaseStorage.sol";
import "../../lib/LibsNeccStorage.sol";

// import "hardhat/console.sol";

interface InNecc is IERC20 {
    function rebase(uint256 neccProfit_, uint256 epoch_)
        external
        returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function balanceOf(address who) external view override returns (uint256);

    function gonsForBalance(uint256 amount) external view returns (uint256);

    function balanceForGons(uint256 gons) external view returns (uint256);

    function index() external view returns (uint256);
}

contract sNeccFacet is ERC20, ERC20Permit {
    using ERC20MetadataStorage for ERC20MetadataStorage.Layout;
    using LibsNeccStorage for LibsNeccStorage.Layout;
    using SafeMath for uint256;

    function initialize(address _stakingContract, address _nNecc) external {
        LibsNeccStorage._onlyGov();
        ERC20MetadataStorage.Layout storage s = ERC20MetadataStorage.layout();
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();

        s.setName("Wrapped Staked Necc");
        s.setSymbol("sNECC");
        s.setDecimals(18);
        n.stakingContract = _stakingContract;
        n.nNecc = _nNecc;
    }

    function setGov(address _newOwner) public {
        LibsNeccStorage._setGov(_newOwner);
    }

    function gov() public view returns (address) {
        return LibsNeccStorage._gov();
    }

    function mint(address _to, uint256 _amount) external {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        n._onlyStakingContract();

        _mint(_to, _amount);
    }

    /**
        @notice burn gOHM
        @param _from address
        @param _amount uint
     */
    function burn(address _from, uint256 _amount) external {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        n._onlyStakingContract();

        _burn(_from, _amount);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice pull index from sOHM token
     */
    function index() public view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return InNecc(n.nNecc).index();
    }

    /**
        @notice converts gOHM amount to OHM
        @param _amount uint
        @return uint
     */
    function balanceFrom(uint256 _amount) public view returns (uint256) {
        return _amount.mul(index()).div(10**decimals());
    }

    /**
        @notice converts OHM amount to gOHM
        @param _amount uint
        @return uint
     */
    function balanceTo(uint256 _amount) public view returns (uint256) {
        return _amount.mul(10**decimals()).div(index());
    }

    function stakingContract() public view returns (address) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();

        return n.stakingContract;
    }
}
