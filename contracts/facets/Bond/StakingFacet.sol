// SPDX-License-Identifier: AGPL-3.0-or-later
pragma abicoder v2;
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../lib/LibBondStorage.sol";
import "./Facet.sol";

interface IDistributor {
    function distribute() external returns (uint256);
}

interface InNecc is IERC20 {
    function mint(address _to, uint256 _amount) external;

    function burn(address _from, uint256 _amount) external;

    function index() external view returns (uint256);

    function balanceFrom(uint256 _amount) external view returns (uint256);

    function balanceTo(uint256 _amount) external view returns (uint256);

    function migrate(address _staking, address _sOHM) external;
}

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

contract StakingFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for IsNecc;

    /**
        @notice stake Necc to enter warmup
        @param _amount uint
        @return bool
     */
    function stake(uint256 _amount, address _recipient)
        external
        returns (bool)
    {
        rebase();

        IERC20(s.Necc).safeTransferFrom(msg.sender, address(this), _amount);

        if (s.warmupPeriod == 0) {
            _send(_recipient, _amount);
        } else {
            LibBondStorage.Claim memory info = s.warmupInfo[_recipient];
            require(!info.lock, "Deposits for account are locked");

            s.warmupInfo[_recipient] = LibBondStorage.Claim({
                deposit: info.deposit.add(_amount),
                gons: info.gons.add(IsNecc(s.sNecc).gonsForBalance(_amount)),
                expiry: s.epoch.number.add(s.warmupPeriod),
                lock: false
            });

            s.gonsInWarmup = s.gonsInWarmup.add(
                IsNecc(s.sNecc).gonsForBalance(_amount)
            );
        }
        return true;
    }

    /**
        @notice retrieve sNecc from warmup
        @param _recipient address
     */
    function claim(address _recipient) public {
        LibBondStorage.Claim memory info = s.warmupInfo[_recipient];
        if (!info.lock) {
            require(
                _recipient == msg.sender,
                "External claims for account are locked"
            );
        }

        if (s.epoch.number >= info.expiry && info.expiry != 0) {
            delete s.warmupInfo[_recipient];
            s.gonsInWarmup = s.gonsInWarmup.sub(info.gons);

            _send(_recipient, IsNecc(s.sNecc).balanceForGons(info.gons));
        }
    }

    /**
        @notice forfeit sNecc in warmup and retrieve Necc
     */
    function forfeit() external {
        LibBondStorage.Claim memory info = s.warmupInfo[msg.sender];
        delete s.warmupInfo[msg.sender];
        s.gonsInWarmup = s.gonsInWarmup.sub(info.gons);

        IERC20(s.Necc).safeTransfer(msg.sender, info.deposit);
    }

    /**
        @notice redeem sNecc for Necc
        @param _amount uint
        @param _trigger bool
     */
    function unstake(uint256 _amount, bool _trigger) external {
        if (_trigger) {
            rebase();
        }
        IERC20(s.sNecc).safeTransferFrom(msg.sender, address(this), _amount);
        IERC20(s.Necc).safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice send staker their amount as sOHM or gOHM
     * @param _recipient address
     * @param _amount uint
     */
    function _send(address _recipient, uint256 _amount)
        internal
        returns (uint256)
    {
        IsNecc(s.sNecc).safeTransfer(_recipient, _amount); // send as sOHM (equal unit as OHM)
        return _amount;
    }

    /**
     * @notice convert _amount sNecc into nBalance_ nNecc
     * @param _to address
     * @param _amount uint
     * @return nBalance_ uint
     */
    function wrap(address _to, uint256 _amount)
        external
        returns (uint256 nBalance_)
    {
        IsNecc(s.sNecc).safeTransferFrom(msg.sender, address(this), _amount);

        nBalance_ = InNecc(s.nNecc).balanceTo(_amount);
        InNecc(s.nNecc).mint(_to, nBalance_);
    }

    /**
     * @notice convert _amount s.nNecc into sBalance_ s.sNecc
     * @param _to address
     * @param _amount uint
     * @return sBalance_ uint
     */
    function unwrap(address _to, uint256 _amount)
        external
        returns (uint256 sBalance_)
    {
        InNecc(s.nNecc).burn(msg.sender, _amount);

        sBalance_ = InNecc(s.nNecc).balanceFrom(_amount);
        IsNecc(s.sNecc).safeTransfer(_to, sBalance_);
    }

    //

    /**
        @notice returns the sNecc index, which tracks rebase growth
        @return uint
     */
    function index() public view returns (uint256) {
        return IsNecc(s.sNecc).index();
    }

    /**
        @notice trigger rebase if epoch over
     */
    function rebase() public {
        if (s.epoch.endTime <= uint256(block.timestamp)) {
            IsNecc(s.sNecc).rebase(s.epoch.distribute, s.epoch.number);

            s.epoch.endTime = s.epoch.endTime.add(s.epoch.length);
            s.epoch.number++;

            IDistributor(address(this)).distribute();

            if (contractBalance() <= totalStaked()) {
                s.epoch.distribute = 0;
            } else {
                s.epoch.distribute = contractBalance().sub(totalStaked());
            }
        }
    }

    /**
        @notice returns contract Necc holdings, including bonuses provided
        @return uint
     */
    function contractBalance() public view returns (uint256) {
        return IERC20(s.Necc).balanceOf(address(this)).add(s.totalBonus);
    }

    /**
        @notice provide bonus to locked staking contract
        @param _amount uint
     */
    function giveLockBonus(uint256 _amount) external {
        require(msg.sender == s.locker);
        s.totalBonus = s.totalBonus.add(_amount);
        IERC20(s.sNecc).safeTransfer(s.locker, _amount);
    }

    /**
        @notice reclaim bonus from locked staking contract
        @param _amount uint
     */
    function returnLockBonus(uint256 _amount) external {
        require(msg.sender == s.locker);
        s.totalBonus = s.totalBonus.sub(_amount);
        IERC20(s.sNecc).safeTransferFrom(s.locker, address(this), _amount);
    }

    function epoch() public view returns (LibBondStorage.Epoch memory) {
        return s.epoch;
    }

    function warmupInfo(address _recipient)
        public
        view
        returns (LibBondStorage.Claim memory)
    {
        return s.warmupInfo[_recipient];
    }

    function supplyInWarmup() public view returns (uint256) {
        return IsNecc(s.sNecc).balanceForGons(s.gonsInWarmup);
    }

    function totalStaked() public view returns (uint256) {
        return IsNecc(s.sNecc).circulatingSupply();
    }
}
