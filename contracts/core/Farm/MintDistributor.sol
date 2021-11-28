// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MintDistributor is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public rewardToken;
    address public beneficiary;
    uint256 public amount;
    bool public halted;

    event Distributed(uint256 amount);

    function initialize(address _beneficiary, IERC20 _rewardToken)
        public
        onlyOwner
    {
        beneficiary = _beneficiary;
        rewardToken = _rewardToken;
        amount = IERC20(_rewardToken).balanceOf(address(this));
    }

    function onlyBeneficiary() internal view {
        require(
            msg.sender == beneficiary,
            "ArbitraryDistributor: Only beneficiary can receive tokens"
        );
    }

    function checkHalted() internal view {
        if (halted == true) {
            return;
        }
    }

    function distribute() public {
        onlyBeneficiary();
        checkHalted();

        uint256 _amount = IERC20(rewardToken).balanceOf(address(this));
        IERC20(rewardToken).transfer(beneficiary, _amount);

        emit Distributed(_amount);
    }

    function empty() public onlyOwner {
        rewardToken.safeTransfer(
            msg.sender,
            rewardToken.balanceOf(address(this))
        );

        halt();
    }

    function halt() public onlyOwner {
        halted = true;
    }

    function unHalt() public onlyOwner {
        halted = false;
    }
}
