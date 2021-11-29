// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BondDepositoryLib.sol";
import "./Facet.sol";

// import "hardhat/console.sol";

contract BondConfigFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using BondDepositoryLib for LibBondStorage.Storage;

    /**
     *  @notice allow anyone to send lost tokens (excluding principle or Necc) to the DAO
     *  @return bool
     */
    function recoverLostToken(address _token) external returns (bool) {
        require(_token != s.Necc);
        require(!EnumerableSet.contains(s.principles, _token));
        IERC20(_token).safeTransfer(
            s.DAO,
            IERC20(_token).balanceOf(address(this))
        );

        return true;
    }

    /* ======== BondDepository ======== */
    function initializeBondDepository(
        address _ndol,
        address _Necc,
        address _treasury,
        address _DAO
    ) external {
        onlyGov();
        require(_Necc != address(0));
        s.Necc = _Necc;
        require(_treasury != address(0));
        s.treasury = _treasury;
        require(_DAO != address(0));
        s.DAO = _DAO;
        require(_ndol != address(0));
        s.ndol = _ndol;
    }

    /**
     *  @notice initializes bond parameters
     *  @param _controlVariable uint
     *  @param _vestingTerm uint256
     *  @param _minimumPrice uint
     *  @param _maxPayout uint
     *  @param _fee uint
     *  @param _maxDebt uint
     *  @param _initialDebt uint
     */
    function initializeBondTerms(
        uint256 _controlVariable,
        uint256 _minimumPrice,
        uint256 _maxPayout,
        uint256 _fee,
        uint256 _maxDebt,
        uint256 _initialDebt,
        uint256 _vestingTerm,
        bool _isLiquidityBond,
        address _priceFeed,
        address _principle
    ) external {
        onlyGov();
        EnumerableSet.add(s.principles, _principle);
        uint256 _principleIndex = s.getIndexAt(_principle);
        require(
            // TODO: Remove >= into ==
            s.terms[_principleIndex].controlVariable >= 0,
            "Bonds must be initialized from 0"
        );
        s.terms[_principleIndex] = LibBondStorage.Terms({
            controlVariable: _controlVariable,
            minimumPrice: _minimumPrice,
            maxPayout: _maxPayout,
            fee: _fee,
            maxDebt: _maxDebt,
            vestingTerm: _vestingTerm,
            isLiquidityBond: _isLiquidityBond
        });
        s.totalDebt[_principleIndex] = _initialDebt;
        s.lastDecay[_principleIndex] = uint256(block.timestamp);
        if (_priceFeed != address(0)) {
            s.priceFeeds[_principleIndex] = _priceFeed;
        }
    }

    /* ======== POLICY FUNCTIONS ======== */

    /**
     *  @notice set parameters for new bonds
     *  @param _parameter PARAMETER
     *  @param _input uint
     */
    function setBondTerms(
        PARAMETER _parameter,
        uint256 _input,
        address _principle
    ) external {
        onlyGov();
        uint256 _principleIndex = s.getIndexAt(_principle);
        if (_parameter == PARAMETER.VESTING) {
            // 0
            require(_input >= 129600, "Vesting must be longer than 36 hours");
            s.terms[_principleIndex].vestingTerm = uint256(_input);
        } else if (_parameter == PARAMETER.PAYOUT) {
            // 1
            require(_input <= 1000, "Payout cannot be above 1 percent");
            s.terms[_principleIndex].maxPayout = _input;
        } else if (_parameter == PARAMETER.FEE) {
            // 2
            require(_input <= 10000, "DAO fee cannot exceed payout");
            s.terms[_principleIndex].fee = _input;
        } else if (_parameter == PARAMETER.DEBT) {
            // 3
            s.terms[_principleIndex].maxDebt = _input;
        } else if (_parameter == PARAMETER.MINPRICE) {
            // 4
            s.terms[_principleIndex].minimumPrice = _input;
        }
    }

    function setAdjustment(
        bool _addition,
        uint256 _delta,
        uint256 _timeToTargetInSeconds,
        address _principle
    ) public {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(
            (msg.sender == address(this)) || (msg.sender == ds.contractOwner),
            "BondDepository: Invalid contract owner"
        );
        uint256 _principleIndex = s.getIndexAt(_principle);

        require(
            _timeToTargetInSeconds >= s.terms[0].vestingTerm,
            "Adjustment: Change too fast"
        );

        s.bondDepositoryAdjustment[_principleIndex] = LibBondStorage
            .BondDepositoryAdjustment({
                add: _addition,
                delta: _delta,
                timeToTarget: _timeToTargetInSeconds,
                lastTime: uint256(block.timestamp)
            });
    }

    /* ======== Distributor ======== */
    function initializeDistributor(
        uint256 _epochLength,
        uint256 _nextEpochTimestamp,
        address _principle
    ) public {
        uint256 _principleIndex = s.getIndexAt(_principle);
        s.epochLength = _epochLength;
        s.nextEpochTimestamp[_principleIndex] = _nextEpochTimestamp;
    }

    /* ====== POLICY FUNCTIONS ====== */

    /**
        @notice adds recipient for distributions
        @param _recipient address
        @param _rewardRate uint
     */
    function addRecipient(address _recipient, uint256 _rewardRate) external {
        onlyGov();
        require(_recipient != address(0));
        s.info.push(
            LibBondStorage.Info({recipient: _recipient, rate: _rewardRate})
        );
    }

    /**
        @notice removes recipient for distributions
        @param _index uint
        @param _recipient address
     */
    function removeRecipient(uint256 _index, address _recipient) external {
        onlyGov();
        require(_recipient == s.info[_index].recipient);
        s.info[_index].recipient = address(0);
        s.info[_index].rate = 0;
    }

    /**
        @notice set adjustment info for a collector's reward rate
        @param _index uint
        @param _add bool
        @param _rate uint
        @param _target uint
     */
    function setAdjustment(
        uint256 _index,
        bool _add,
        uint256 _rate,
        uint256 _target
    ) external {
        onlyGov();
        s.distributorAdjustments[_index] = LibBondStorage
            .DistributorAdjustment({add: _add, rate: _rate, target: _target});
    }

    /* ======== Staking ======== */

    function initializeStaking(
        uint256 _firstEpochNumber,
        uint32 _firstEpochTime,
        address _sNecc,
        address _nNecc
    ) public {
        require(_sNecc != address(0));
        require(_nNecc != address(0));
        s.sNecc = _sNecc;
        s.nNecc = _nNecc;
        s.epoch = LibBondStorage.Epoch({
            length: s.epochLength,
            number: _firstEpochNumber,
            endTime: _firstEpochTime,
            distribute: 0
        });
    }

    /**
        @notice prevent new deposits to address (protection from malicious activity)
     */
    function toggleDepositLock(address _maliciousDepositor) external {
        onlyGov();
        s.warmupInfo[_maliciousDepositor].lock = !s
            .warmupInfo[_maliciousDepositor]
            .lock;
    }

    /**
        @notice sets the contract address for LP staking
        @param _contract address
     */
    function setContract(CONTRACTS _contract, address _address) external {
        onlyGov();
        if (_contract == CONTRACTS.LOCKER) {
            // 2
            require(
                s.locker == address(0),
                "Locker cannot be set more than once"
            );
            s.locker = _address;
        }
    }

    /**
     * @notice set warmup period in epoch's numbers for new stakers
     * @param _warmupPeriod uint
     */
    function setWarmup(uint256 _warmupPeriod) external {
        onlyGov();
        s.warmupPeriod = _warmupPeriod;
    }

    function setFarmDistributor(address _farmDistributor) external {
        onlyGov();
        s.farmDistributor = _farmDistributor;
    }
}
