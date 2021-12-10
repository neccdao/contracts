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
    function mint(address _to, uint256 _amount) external;

    function burn(address _from, uint256 _amount) external;

    function index() external view returns (uint256);

    function balanceFrom(uint256 _amount) external view returns (uint256);

    function balanceTo(uint256 _amount) external view returns (uint256);
}

interface IStaking {
    function supplyInWarmup() external view returns (uint256);
}

contract sNeccFacet is ERC20, ERC20Permit {
    using ERC20MetadataStorage for ERC20MetadataStorage.Layout;
    using LibsNeccStorage for LibsNeccStorage.Layout;
    using SafeMath for uint256;

    event LogSupply(
        uint256 indexed epoch,
        uint256 timestamp,
        uint256 totalSupply
    );
    event LogRebase(uint256 indexed epoch, uint256 rebase, uint256 index);
    event LogStakingContractUpdated(address stakingContract);

    function initialize(address _stakingContract, address _nNecc) external {
        LibsNeccStorage._onlyGov();
        ERC20BaseStorage.Layout storage b = ERC20BaseStorage.layout();
        ERC20MetadataStorage.Layout storage s = ERC20MetadataStorage.layout();
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();

        s.setName("Staked Necc");
        s.setSymbol("sNECC");
        s.setDecimals(9);
        b.totalSupply = INITIAL_FRAGMENTS_SUPPLY;
        n._gonsPerFragment = TOTAL_GONS.div(b.totalSupply);
        n.stakingContract = _stakingContract;
        n.nNecc = _nNecc;
        n._gonBalances[n.stakingContract] = TOTAL_GONS;

        emit Transfer(address(0x0), _stakingContract, b.totalSupply);
        emit LogStakingContractUpdated(_stakingContract);
    }

    function setGov(address _newOwner) public {
        LibsNeccStorage._setGov(_newOwner);
    }

    function gov() public view returns (address) {
        return LibsNeccStorage._gov();
    }

    function stakingContract() public view returns (address) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();

        return n.stakingContract;
    }

    /**
        @notice increases sNecc supply to increase staking balances relative to profit_
        @param profit_ uint256
        @return uint256
     */
    function rebase(uint256 profit_, uint256 epoch_) public returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        ERC20BaseStorage.Layout storage b = ERC20BaseStorage.layout();
        n._onlyStakingContract();

        uint256 rebaseAmount;
        uint256 circulatingSupply_ = circulatingSupply();

        if (profit_ == 0) {
            emit LogSupply(epoch_, block.timestamp, b.totalSupply);
            emit LogRebase(epoch_, 0, index());
            return b.totalSupply;
        } else if (circulatingSupply_ > 0) {
            rebaseAmount = profit_.mul(b.totalSupply).div(circulatingSupply_);
        } else {
            rebaseAmount = profit_;
        }

        b.totalSupply = b.totalSupply.add(rebaseAmount);

        if (b.totalSupply > MAX_SUPPLY) {
            b.totalSupply = MAX_SUPPLY;
        }
        n._gonsPerFragment = TOTAL_GONS.div(b.totalSupply);

        _storeRebase(circulatingSupply_, profit_, epoch_);

        return b.totalSupply;
    }

    /**
        @notice emits event with data about rebase
        @param previousCirculating_ uint
        @param profit_ uint
        @param epoch_ uint
        @return bool
     */
    function _storeRebase(
        uint256 previousCirculating_,
        uint256 profit_,
        uint256 epoch_
    ) internal returns (bool) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        ERC20BaseStorage.Layout storage b = ERC20BaseStorage.layout();
        uint256 rebasePercent = profit_.mul(1e18).div(previousCirculating_);

        n.rebases.push(
            LibsNeccStorage.Rebase({
                epoch: epoch_,
                rebase: rebasePercent, // 18 decimals
                totalStakedBefore: previousCirculating_,
                totalStakedAfter: circulatingSupply(),
                amountRebased: profit_,
                index: index(),
                blockNumberOccured: block.number
            })
        );

        emit LogSupply(epoch_, block.timestamp, b.totalSupply);
        emit LogRebase(epoch_, rebasePercent, index());

        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue)
        public
        override
        returns (bool)
    {
        _approve(
            msg.sender,
            spender,
            allowance(msg.sender, spender).add(addedValue)
        );
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue)
        public
        override
        returns (bool)
    {
        uint256 oldValue = allowance(msg.sender, spender);
        if (subtractedValue >= oldValue) {
            _approve(msg.sender, spender, 0);
        } else {
            _approve(msg.sender, spender, oldValue.sub(subtractedValue));
        }
        return true;
    }

    function transfer(address to, uint256 value)
        public
        override
        returns (bool)
    {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        uint256 gonValue = value.mul(n._gonsPerFragment);

        n._gonBalances[msg.sender] = n._gonBalances[msg.sender].sub(gonValue);
        n._gonBalances[to] = n._gonBalances[to].add(gonValue);

        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override returns (bool) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        decreaseAllowance(to, value);
        emit Approval(from, msg.sender, allowance(msg.sender, to));

        uint256 gonValue = gonsForBalance(value);
        n._gonBalances[from] = n._gonBalances[from].sub(gonValue);
        n._gonBalances[to] = n._gonBalances[to].add(gonValue);

        emit Transfer(from, to, value);
        return true;
    }

    function balanceOf(address who) public view override returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return n._gonBalances[who].div(n._gonsPerFragment);
    }

    function gonsForBalance(uint256 amount) public view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return amount.mul(n._gonsPerFragment);
    }

    function balanceForGons(uint256 gons) public view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return gons.div(n._gonsPerFragment);
    }

    function toN(uint256 amount) external view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return InNecc(n.nNecc).balanceTo(amount);
    }

    function fromN(uint256 amount) external view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return InNecc(n.nNecc).balanceFrom(amount);
    }

    // Staking contract holds excess sNecc
    function circulatingSupply() public view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        ERC20BaseStorage.Layout storage b = ERC20BaseStorage.layout();

        return
            b.totalSupply.sub(balanceOf(n.stakingContract)).add(
                InNecc(n.nNecc).balanceFrom(
                    IERC20(address(InNecc(n.nNecc))).totalSupply()
                )
            );
    }

    function index() public view returns (uint256) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        return balanceForGons(n.INDEX);
    }

    function setIndex(uint256 _INDEX) external returns (bool) {
        LibsNeccStorage.Layout storage n = LibsNeccStorage.layout();
        require(n.INDEX == 0, "Index already set");
        n.INDEX = gonsForBalance(_INDEX);
        return true;
    }
}
