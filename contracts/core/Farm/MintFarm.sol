// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IDistributor {
    function rewardToken() external view returns (IERC20);

    function beneficiary() external view returns (address);

    function distribute() external;

    function nextDistribution() external view returns (uint256);

    function empty() external;
}

contract MintFarm is Ownable {
    using SafeMath for uint256;
    uint256 constant PRECISION = 1e30;

    IERC20 public stakingToken;
    IERC20 public rewardToken;
    IDistributor public rewardDistributor;

    // track stakes
    uint256 public totalStaked;
    mapping(address => uint256) public staked;

    // track overall cumulative rewards
    uint256 public cumulativeRewardPerToken;
    // track previous cumulate rewards for accounts
    mapping(address => uint256) public previousCumulatedRewardPerToken;
    // track claimable rewards for accounts
    mapping(address => uint256) public claimableReward;

    // track total rewards
    uint256 public totalClaimedRewards;
    uint256 public totalFarmRewards;

    // ======= STORAGE DECLARATION END ============

    /**
     * @dev Emitted when an account stakes
     * @param who Account staking
     * @param amountStaked Amount of tokens staked
     */
    event Stake(address indexed who, uint256 amountStaked);

    /**
     * @dev Emitted when an account unstakes
     * @param who Account unstaking
     * @param amountUnstaked Amount of tokens unstaked
     */
    event Unstake(address indexed who, uint256 amountUnstaked);

    /**
     * @dev Emitted when an account claims TRU rewards
     * @param who Account claiming
     * @param amountClaimed Amount of TRU claimed
     */
    event Claim(address indexed who, uint256 amountClaimed);

    function initialize(IDistributor _rewardDistributor, IERC20 _stakingToken)
        public
        onlyOwner
    {
        stakingToken = _stakingToken;
        rewardDistributor = _rewardDistributor;
        rewardToken = _rewardDistributor.rewardToken();
        require(
            rewardDistributor.beneficiary() == address(this),
            "MintFarm: Distributor beneficiary is not set"
        );
    }

    function stake(uint256 amount) external update {
        if (claimableReward[msg.sender] > 0) {
            _claim();
        }
        staked[msg.sender] = staked[msg.sender].add(amount);
        totalStaked = totalStaked.add(amount);
        require(stakingToken.transferFrom(msg.sender, address(this), amount));
        emit Stake(msg.sender, amount);
    }

    function _unstake(uint256 amount) internal {
        require(
            amount <= staked[msg.sender],
            "MintFarm: Cannot withdraw amount bigger than available balance"
        );
        staked[msg.sender] = staked[msg.sender].sub(amount);
        totalStaked = totalStaked.sub(amount);
        require(stakingToken.transfer(msg.sender, amount));
        emit Unstake(msg.sender, amount);
    }

    function _claim() internal {
        totalClaimedRewards = totalClaimedRewards.add(
            claimableReward[msg.sender]
        );
        uint256 rewardToClaim = claimableReward[msg.sender];
        claimableReward[msg.sender] = 0;
        require(rewardToken.transfer(msg.sender, rewardToClaim));
        emit Claim(msg.sender, rewardToClaim);
    }

    function unstake(uint256 amount) external update {
        _unstake(amount);
    }

    function claim() external update {
        _claim();
    }

    function exit(uint256 amount) external update {
        _unstake(amount);
        _claim();
    }

    function claimable(address account) external view returns (uint256) {
        if (staked[account] == 0) {
            return claimableReward[account];
        }
        // calculate total rewards (including pending)
        uint256 newTotalFarmRewards = rewardToken
            .balanceOf(address(this))
            .add(totalClaimedRewards)
            .mul(PRECISION);
        // calculate block reward
        uint256 totalBlockReward = newTotalFarmRewards.sub(totalFarmRewards);
        // calculate next cumulative reward per token
        uint256 nextcumulativeRewardPerToken = cumulativeRewardPerToken.add(
            totalBlockReward.div(totalStaked)
        );
        // return claimable reward for this account
        // prettier-ignore
        return claimableReward[account].add(
            staked[account].mul(nextcumulativeRewardPerToken.sub(previousCumulatedRewardPerToken[account])).div(PRECISION));
    }

    modifier update() {
        // pull TRU from distributor
        // only pull if there is distribution and distributor farm is set to this farm
        if (
            IERC20(rewardToken).balanceOf(address(rewardDistributor)) > 0 &&
            rewardDistributor.beneficiary() == address(this)
        ) {
            rewardDistributor.distribute();
        }
        // calculate total rewards
        uint256 newTotalFarmRewards = rewardToken
            .balanceOf(address(this))
            .add(totalClaimedRewards)
            .mul(PRECISION);
        // calculate block reward
        uint256 totalBlockReward = newTotalFarmRewards.sub(totalFarmRewards);
        // update farm rewards
        totalFarmRewards = newTotalFarmRewards;
        // if there are stakers
        if (totalStaked > 0) {
            cumulativeRewardPerToken = cumulativeRewardPerToken.add(
                totalBlockReward.div(totalStaked)
            );
        }
        // update claimable reward for sender
        claimableReward[msg.sender] = claimableReward[msg.sender].add(
            staked[msg.sender]
                .mul(
                    cumulativeRewardPerToken.sub(
                        previousCumulatedRewardPerToken[msg.sender]
                    )
                )
                .div(PRECISION)
        );
        // update previous cumulative for sender
        previousCumulatedRewardPerToken[msg.sender] = cumulativeRewardPerToken;
        _;
    }
}
