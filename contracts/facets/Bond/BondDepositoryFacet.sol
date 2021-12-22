pragma abicoder v2;
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../lib/FixedPoint.sol";
import "../../lib/FullMath.sol";
import "../../lib/LibBondStorage.sol";
import "./BondDepositoryLib.sol";
import "./Facet.sol";

interface ITreasury {
    function baseSupply() external view returns (uint256);

    function mintRewards(address _recipient, uint256 _amount) external;

    function deposit(
        uint256 _amount,
        address _token,
        uint256 _profit
    ) external returns (uint256 send_);

    function valueOfToken(address _token, uint256 _amount)
        external
        view
        returns (uint256 value_);
}

interface IBondCalculator {
    function valuation(address _LP, uint256 _amount)
        external
        view
        returns (uint256);

    function markdown(address _LP) external view returns (uint256);
}

interface IStaking {
    function stake(uint256 _amount, address _recipient) external returns (bool);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

contract BondDepositoryFacet is Facet {
    using FixedPoint for *;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using BondDepositoryLib for LibBondStorage.Storage;

    /* ======== EVENTS ======== */

    event BondCreated(
        uint256 deposit,
        uint256 indexed payout,
        uint256 indexed expires,
        uint256 indexed priceInUSD
    );
    event BondRedeemed(
        address indexed recipient,
        uint256 payout,
        uint256 remaining
    );
    event BondPriceChanged(
        uint256 indexed priceInUSD,
        uint256 indexed internalPrice,
        uint256 indexed debtRatio
    );
    event ControlVariableAdjustment(
        uint256 initialBCV,
        uint256 newBCV,
        uint256 adjustment,
        bool addition
    );

    /* ======== ERRORS ======== */
    error InvalidPrinciple(address _principle);

    /* ======== USER FUNCTIONS ======== */

    /**
     *  @notice deposit bond
     *  @param _amount uint
     *  @param _maxPrice uint
     *  @param _depositor address
     *  @return uint
     */
    function deposit(
        uint256 _amount,
        uint256 _maxPrice,
        address _depositor,
        address _principle
    ) external returns (uint256) {
        require(_depositor != address(0), "Invalid address");
        uint256 _principleIndex = s.getIndexAt(_principle);
        LibBondStorage.Terms memory _terms = s.terms[_principleIndex];

        decayDebt(_principle);

        require(
            s.totalDebt[_principleIndex] <= _terms.maxDebt,
            "Max capacity reached"
        );

        uint256 priceInUSD = bondPriceInUSD(_principle); // Stored in bond info
        uint256 nativePrice = _bondPrice(_principle);

        require(
            _maxPrice >= nativePrice,
            "Slippage limit: more than max price"
        ); // slippage protection

        uint256 value = ITreasury(s.treasury).valueOfToken(_principle, _amount);
        uint256 payout = payoutFor(value, _principle); // payout to bonder is computed
        require(payout >= 10000000, "Bond too small"); // must be > 0.01 Necc ( underflow protection )
        require(payout <= maxPayout(_principle), "Bond too large"); // size protection because there is no slippage

        /**
            principle is transferred in
            approved and
            deposited into the treasury, returning (_amount - profit) Necc
         */
        //  Profit > 0
        if (payout.sub(payout.mul(_terms.fee).div(10000)) > 0) {
            if (s.terms[_principleIndex].isLiquidityBond) {
                IERC20(_principle).safeTransferFrom(
                    msg.sender,
                    address(this),
                    _amount
                );
                IERC20(_principle).approve(address(s.treasury), _amount);
                ITreasury(s.treasury).deposit(
                    _amount,
                    _principle,
                    value.sub(payout).sub(payout.mul(_terms.fee).div(10000))
                );
            } else if (_principle == s.ndol) {
                IERC20(_principle).safeTransferFrom(
                    msg.sender,
                    address(this),
                    _amount
                );
                IERC20(_principle).approve(address(s.treasury), _amount);
                ITreasury(s.treasury).deposit(
                    _amount,
                    _principle,
                    value.sub(payout).sub(payout.mul(_terms.fee).div(10000))
                );
            } else {
                revert InvalidPrinciple(_principle);
            }

            // fee is transferred to dao in nNecc
            if (s.DAO != address(0)) {
                s.bondFees[s.DAO] = s.bondFees[s.DAO].add(
                    payout.mul(_terms.fee).div(10000)
                );
            }
            if (s.farmDistributor != address(0)) {
                s.bondFees[s.farmDistributor] = s
                    .bondFees[s.farmDistributor]
                    .add(payout.mul(100).div(10000));
            }
        }

        // total debt is increased
        s.totalDebt[_principleIndex] = s.totalDebt[_principleIndex].add(value);

        // depositor info is stored
        s.bondInfo[_depositor][_principleIndex] = LibBondStorage.Bond({
            payout: s.bondInfo[_depositor][_principleIndex].payout.add(payout),
            vesting: _terms.vestingTerm,
            lastTime: uint256(block.timestamp),
            pricePaid: priceInUSD
        });

        // indexed events are emitted
        emit BondCreated(
            _amount,
            payout,
            block.timestamp.add(_terms.vestingTerm),
            priceInUSD
        );

        // TODO:
        // adjust(_principle); // control variable is adjusted
        // emit BondPriceChanged(
        //     bondPriceInUSD(_principle),
        //     _bondPrice(_principle),
        //     debtRatio(_principle)
        // );

        return payout;
    }

    function distributeFees() external {
        onlyGov();

        if (s.DAO != address(0) && s.bondFees[s.DAO] != 0) {
            require(
                stake(s.DAO, s.bondFees[s.DAO]) != 0,
                "Failed to distribute fees for DAO"
            );
            s.bondFees[s.DAO] = 0;
        }
        if (
            s.farmDistributor != address(0) &&
            s.bondFees[s.farmDistributor] != 0
        ) {
            require(
                stake(s.farmDistributor, s.bondFees[s.farmDistributor]) != 0,
                "Failed to distribute fees for farm"
            );
            s.bondFees[s.farmDistributor] = 0;
        }
    }

    function bondFees(address _recipient) external view returns (uint256) {
        return s.bondFees[_recipient];
    }

    /**
     *  @notice redeem bond for user
     *  @param _recipient address
     *  @param _principle address
     *  @return uint
     */
    function redeem(address _recipient, address _principle)
        external
        returns (uint256)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        LibBondStorage.Bond memory info = s.bondInfo[_recipient][
            _principleIndex
        ];
        // (seconds since last interaction / vesting term remaining)
        uint256 percentVested = percentVestedFor(_recipient, _principle);

        if (percentVested >= 10000) {
            // if fully vested
            delete s.bondInfo[_recipient][_principleIndex]; // delete user info
            emit BondRedeemed(_recipient, info.payout, 0); // emit bond data
            return stake(_recipient, info.payout); // pay user everything due
        } else {
            // if unfinished
            // calculate payout vested
            uint256 payout = info.payout.mul(percentVested).div(10000);
            // store updated deposit info
            s.bondInfo[_recipient][_principleIndex] = LibBondStorage.Bond({
                payout: info.payout.sub(payout),
                vesting: info.vesting.sub(
                    uint256(block.timestamp).sub(info.lastTime)
                ),
                lastTime: uint256(block.timestamp),
                pricePaid: info.pricePaid
            });

            emit BondRedeemed(
                _recipient,
                payout,
                s.bondInfo[_recipient][_principleIndex].payout
            );
            return stake(_recipient, payout);
        }
    }

    /**
     *  @notice reduce total debt
     */
    function decayDebt(address _principle) internal {
        uint256 _principleIndex = s.getIndexAt(_principle);
        s.totalDebt[_principleIndex] = s.totalDebt[_principleIndex].sub(
            debtDecay(_principle)
        );
        s.lastDecay[_principleIndex] = uint256(block.timestamp);
    }

    /* ======== VIEW FUNCTIONS ======== */

    /**
     *  @notice determine maximum bond size
     *  @return uint
     */
    function maxPayout(address _principle) public view returns (uint256) {
        uint256 _principleIndex = s.getIndexAt(_principle);
        return
            ITreasury(s.treasury)
                .baseSupply()
                .mul(s.terms[_principleIndex].maxPayout)
                .div(100000);
    }

    /**
     *  @notice calculate interest due for new bond
     *  @param _value uint
     *  @return uint
     */
    function payoutFor(uint256 _value, address _principle)
        public
        view
        returns (uint256)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);

        if (s.terms[_principleIndex].isLiquidityBond) {
            return
                FixedPoint
                    .fraction(_value, bondPrice(_principle))
                    .decode112with18()
                    .div(1e16);
        } else if (_principle == s.ndol) {
            return
                FixedPoint
                    .fraction(_value, bondPrice(_principle))
                    .decode112with18()
                    .div(1e16);
        } else {
            revert InvalidPrinciple(_principle);
        }
    }

    /**
     *  @notice calculate current bond premium
     *  @return price_ uint
     */
    function bondPrice(address _principle)
        public
        view
        returns (uint256 price_)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        if (s.terms[_principleIndex].isLiquidityBond) {
            price_ = s
                .terms[_principleIndex]
                .controlVariable
                .mul(debtRatio(_principle))
                .add(1000000000)
                .div(1e7);
        } else if (_principle == s.ndol) {
            price_ = s
                .terms[_principleIndex]
                .controlVariable
                .mul(debtRatio(_principle))
                .add(1000000000)
                .div(1e7);
        }
        if (price_ < s.terms[_principleIndex].minimumPrice) {
            price_ = s.terms[_principleIndex].minimumPrice;
        }
    }

    /**
     *  @notice calculate current bond price and remove floor if above
     *  @return price_ uint
     */
    function _bondPrice(address _principle) internal returns (uint256 price_) {
        uint256 _principleIndex = s.getIndexAt(_principle);

        if (s.terms[_principleIndex].isLiquidityBond) {
            price_ = s
                .terms[_principleIndex]
                .controlVariable
                .mul(debtRatio(_principle))
                .add(1000000000)
                .div(1e7);
        } else if (_principle == s.ndol) {
            price_ = s
                .terms[_principleIndex]
                .controlVariable
                .mul(debtRatio(_principle))
                .add(1000000000)
                .div(1e7);
        }
        if (price_ < s.terms[_principleIndex].minimumPrice) {
            price_ = s.terms[_principleIndex].minimumPrice;
        } else if (s.terms[_principleIndex].minimumPrice != 0) {
            s.terms[_principleIndex].minimumPrice = 0;
        }
    }

    /**
     *  @notice converts bond price to DAI value
     *  @return price_ uint
     */
    function bondPriceInUSD(address _principle)
        public
        view
        returns (uint256 price_)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);

        if (s.terms[_principleIndex].isLiquidityBond) {
            price_ = bondPrice(_principle)
                .mul(IBondCalculator(s.treasury).markdown(_principle))
                .div(100);
        } else if (_principle == s.ndol) {
            price_ = bondPrice(_principle)
                .mul(10**IERC20Decimals(_principle).decimals())
                .div(100);
        } else {
            revert InvalidPrinciple(_principle);
        }
    }

    /**
     *  @notice calculate current ratio of debt to Necc supply
     *  @return debtRatio_ uint
     */
    function debtRatio(address _principle)
        public
        view
        returns (uint256 debtRatio_)
    {
        debtRatio_ = FixedPoint
            .fraction(
                currentDebt(_principle).mul(1e9),
                ITreasury(s.treasury).baseSupply()
            )
            .decode112with18()
            .div(1e18);
    }

    /**
     *  @notice debt ratio in same terms for reserve or liquidity bonds
     *  @return uint
     */
    function standardizedDebtRatio(address _principle)
        external
        view
        returns (uint256)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);

        if (s.terms[_principleIndex].isLiquidityBond) {
            return
                debtRatio(_principle)
                    .mul(IBondCalculator(s.treasury).markdown(_principle))
                    .div(1e9);
        } else if (_principle == s.ndol) {
            return debtRatio(_principle);
        } else {
            revert InvalidPrinciple(_principle);
        }
    }

    /**
     *  @notice calculate debt factoring in decay
     *  @return uint
     */
    function currentDebt(address _principle) public view returns (uint256) {
        uint256 _principleIndex = s.getIndexAt(_principle);

        return s.totalDebt[_principleIndex].sub(debtDecay(_principle));
    }

    /**
     *  @notice amount to decay total debt by
     *  @return decay_ uint
     */
    function debtDecay(address _principle)
        public
        view
        returns (uint256 decay_)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        uint256 timeSinceLast = uint256(block.timestamp).sub(
            s.lastDecay[_principleIndex]
        );
        decay_ = s.totalDebt[_principleIndex].mul(timeSinceLast).div(
            s.terms[_principleIndex].vestingTerm
        );
        if (decay_ > s.totalDebt[_principleIndex]) {
            decay_ = s.totalDebt[_principleIndex];
        }
    }

    /**
     *  @notice calculate how far into vesting a depositor is
     *  @param _depositor address
     *  @return percentVested_ uint
     */
    function percentVestedFor(address _depositor, address _principle)
        public
        view
        returns (uint256 percentVested_)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        LibBondStorage.Bond memory bond = s.bondInfo[_depositor][
            _principleIndex
        ];
        uint256 secondsSinceLast = uint256(block.timestamp).sub(bond.lastTime);
        uint256 vesting = bond.vesting;

        if (vesting > 0) {
            percentVested_ = secondsSinceLast.mul(10000).div(vesting);
        } else {
            percentVested_ = 0;
        }
    }

    /**
     *  @notice calculate amount of Necc available for claim by depositor
     *  @param _depositor address
     *  @return pendingPayout_ uint
     */
    function pendingPayoutFor(address _depositor, address _principle)
        external
        view
        returns (uint256 pendingPayout_)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        uint256 percentVested = percentVestedFor(_depositor, _principle);
        uint256 payout = s.bondInfo[_depositor][_principleIndex].payout;

        if (percentVested >= 10000) {
            pendingPayout_ = payout;
        } else {
            pendingPayout_ = payout.mul(percentVested).div(10000);
        }
    }

    /**
     *  @notice allow user to stake payout automatically
     *  @param _recipient address
     *  @param _amount uint
     *  @return uint
     */
    function stake(address _recipient, uint256 _amount)
        internal
        returns (uint256)
    {
        IERC20(s.Necc).approve(address(this), _amount);
        IStaking(address(this)).stake(_amount, _recipient);

        return _amount;
    }

    /**
     *  @notice makes incremental adjustment to control variable
     */
    function adjust(address _principle) internal {
        uint256 _principleIndex = s.getIndexAt(_principle);
        LibBondStorage.BondDepositoryAdjustment storage adjustment = s
            .bondDepositoryAdjustment[_principleIndex];
        LibBondStorage.Terms storage _bondTerms = s.terms[_principleIndex];

        if (adjustment.delta > 0 && adjustment.timeToTarget > 0) {
            uint256 initial = _bondTerms.controlVariable;
            uint256 timeSinceLast = block.timestamp.sub(adjustment.lastTime);
            uint256 change = changeBy(_principle);

            if (adjustment.delta >= change) {
                adjustment.delta = adjustment.delta.sub(change);
            } else {
                adjustment.delta = 0;
            }
            if (adjustment.timeToTarget >= timeSinceLast) {
                adjustment.timeToTarget = adjustment.timeToTarget.sub(
                    timeSinceLast
                );
            } else {
                adjustment.timeToTarget = 0;
            }

            if (adjustment.add) {
                _bondTerms.controlVariable = _bondTerms.controlVariable.add(
                    change
                );
            } else {
                _bondTerms.controlVariable = _bondTerms.controlVariable.sub(
                    change
                );
            }

            adjustment.lastTime = block.timestamp;

            emit ControlVariableAdjustment(
                initial,
                _bondTerms.controlVariable,
                change,
                adjustment.add
            );
        }
    }

    function changeBy(address _principle)
        internal
        view
        returns (uint256 changeBy_)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        LibBondStorage.BondDepositoryAdjustment memory adjustment = s
            .bondDepositoryAdjustment[_principleIndex];

        uint256 timeSinceLast = block.timestamp.sub(adjustment.lastTime);

        changeBy_ = adjustment.delta.mul(timeSinceLast).div(
            adjustment.timeToTarget
        );

        if (changeBy_ > adjustment.delta) {
            changeBy_ = adjustment.delta;
        }
    }

    function bondInfo(address _depositor, address _principle)
        public
        view
        returns (LibBondStorage.Bond memory)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        return s.bondInfo[_depositor][_principleIndex];
    }

    function BCV(address _principle) public view returns (uint256 BCV_) {
        uint256 _principleIndex = s.getIndexAt(_principle);
        LibBondStorage.BondDepositoryAdjustment storage _bondAdjustment = s
            .bondDepositoryAdjustment[_principleIndex];

        uint256 change = changeBy(_principle);

        if (_bondAdjustment.add) {
            BCV_ = s.terms[_principleIndex].controlVariable.add(change);
        } else {
            if (s.terms[_principleIndex].controlVariable > change) {
                BCV_ = s.terms[_principleIndex].controlVariable.sub(change);
            } else {
                BCV_ = 1;
            }
        }
    }

    function terms(address _principle)
        public
        view
        returns (LibBondStorage.Terms memory)
    {
        uint256 _principleIndex = s.getIndexAt(_principle);
        return s.terms[_principleIndex];
    }

    function DAO() external view returns (address) {
        return s.DAO;
    }

    function farmDistributor() external view returns (address) {
        return s.farmDistributor;
    }

    function treasury() external view returns (address) {
        return s.treasury;
    }
}
