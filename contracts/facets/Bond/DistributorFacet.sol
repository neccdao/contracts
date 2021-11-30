// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./Facet.sol";
import "../../lib/LibBondStorage.sol";
import "./BondDepositoryLib.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface ITreasury {
    function mintRewards(address _recipient, uint256 _amount) external;
}

contract DistributorFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using BondDepositoryLib for LibBondStorage.Storage;

    /* ====== PUBLIC FUNCTIONS ====== */

    /**
        @notice send epoch reward to staking contract
     */
    function distribute() external returns (bool) {
        uint256 _principleLength = EnumerableSet.length(s.principles);
        bool _success = true;
        for (
            uint256 _principleIndex = 0;
            _principleIndex < _principleLength;
            _principleIndex++
        ) {
            if (s.nextEpochTimestamp[_principleIndex] <= block.timestamp) {
                s.nextEpochTimestamp[_principleIndex] = s
                    .nextEpochTimestamp[_principleIndex]
                    .add(s.epochLength); // set next epoch timestamp

                // distribute rewards to each recipient
                for (uint256 i = 0; i < s.info.length; i++) {
                    if (s.info[i].rate > 0) {
                        ITreasury(s.treasury).mintRewards( // mint and send from treasury
                            s.info[i].recipient,
                            nextRewardAt(s.info[i].rate)
                        );
                        adjust(i); // check for adjustment
                    }
                }
            } else {
                _success = false;
            }
        }

        return _success;
    }

    /* ====== INTERNAL FUNCTIONS ====== */

    /**
        @notice increment reward rate for collector
     */
    function adjust(uint256 _index) internal {
        LibBondStorage.DistributorAdjustment storage adjustment = s
            .distributorAdjustments[_index];

        if (adjustment.rate != 0) {
            if (adjustment.add) {
                // if rate should increase
                s.info[_index].rate = s.info[_index].rate.add(adjustment.rate); // raise rate
                if (s.info[_index].rate >= adjustment.target) {
                    // if target met
                    s.distributorAdjustments[_index].rate = 0; // turn off distributorAdjustment
                }
            } else {
                // if rate should decrease
                if (s.info[_index].rate > adjustment.rate) {
                    // protect from underflow
                    s.info[_index].rate = s.info[_index].rate.sub(
                        adjustment.rate
                    ); // lower rate
                } else {
                    s.info[_index].rate = 0;
                }

                if (s.info[_index].rate <= adjustment.target) {
                    // if target met
                    s.distributorAdjustments[_index].rate = 0; // turn off adjustment
                    s.info[_index].rate = adjustment.target; // set to target
                }
            }
        }
    }

    /* ====== VIEW FUNCTIONS ====== */

    /**
        @notice view function for next reward at given rate
        @param _rate uint
        @return uint
     */
    function nextRewardAt(uint256 _rate) public view returns (uint256) {
        return IERC20(s.Necc).totalSupply().mul(_rate).div(1000000);
    }

    /**
        @notice view function for next reward for specified address
        @param _recipient address
        @return uint
     */
    function nextRewardFor(address _recipient) public view returns (uint256) {
        uint256 reward;
        for (uint256 i = 0; i < s.info.length; i++) {
            if (s.info[i].recipient == _recipient) {
                reward = nextRewardAt(s.info[i].rate);
            }
        }
        return reward;
    }
}
