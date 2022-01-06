// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {LibRedemptionStorage} from "../../lib/LibRedemptionStorage.sol";
import {Facet} from "./Facet.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

contract RedemptionFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using LibRedemptionStorage for LibRedemptionStorage.Layout;

    event WithdrawWETH(address _withdrawer, uint256 _amount);
    event DepositWETH(address _depositor, uint256 _amount);

    event RedeemNdol(
        address _redeemer,
        address _ndol,
        uint256 _redemptionAmount,
        address _weth,
        uint256 _wethReturned
    );

    event RedeemnNecc(
        address _redeemer,
        address _nNecc,
        uint256 _redemptionAmount,
        address _weth,
        uint256 _wethReturned
    );

    function initialize(
        address _weth,
        address _ndol,
        address _nNecc,
        uint256 _ndolRedemptionRatio,
        uint256 _nNeccFloorPrice,
        uint256 _wethPrice
    ) external {
        _onlyGov();
        require(_weth != address(0), "Redemption: invalid WETH address");
        require(_ndol != address(0), "Redemption: invalid _ndol address");
        require(_nNecc != address(0), "Redemption: invalid _nNecc address");
        require(
            _ndolRedemptionRatio < 10,
            "Redemption: invalid ndolRedemptionRatio"
        );
        require(
            _nNeccFloorPrice < 1000,
            "Redemption: invalid _nNeccFloorPrice"
        );
        require(_wethPrice < 4000, "Redemption: invalid _wethPrice");

        LibRedemptionStorage.Layout storage s = LibRedemptionStorage.layout();

        s.weth = _weth;
        s.ndol = _ndol;
        s.nNecc = _nNecc;

        s.ndolRedemptionRatio = _ndolRedemptionRatio; // will be divided by 10
        s.nNeccFloorPrice = _nNeccFloorPrice;
        s.wethPrice = _wethPrice;
    }

    function redeemNdol(uint256 _redemptionAmount) external {
        LibRedemptionStorage.Layout storage s = LibRedemptionStorage.layout();

        // Transfer NDOL to the contract
        IERC20(s.ndol).safeTransferFrom(
            msg.sender,
            address(this),
            _redemptionAmount
        );

        // Multiply deposit by the ndol redemption rate
        uint256 _ndolRedemptionAmount = _redemptionAmount
            .mul(s.ndolRedemptionRatio)
            .div(10);

        // Divide Redemption amount against price of ETH to calculate how much ETH to return back
        // for deposited NDOL
        uint256 _wethReturned = _ndolRedemptionAmount.div(s.wethPrice);

        // Transfer ETH back to the sender
        require(
            IERC20(s.weth).balanceOf(address(this)) >= _wethReturned,
            "Redemption: failed to transfer WETH"
        );
        IERC20(s.weth).safeTransfer(msg.sender, _wethReturned);

        // Emit event about ndol redemption
        emit RedeemNdol(
            msg.sender,
            s.ndol,
            _redemptionAmount,
            s.weth,
            _wethReturned
        );
    }

    function redeemnNecc(uint256 _redemptionAmount) external {
        LibRedemptionStorage.Layout storage s = LibRedemptionStorage.layout();

        // Transfer nNecc to the contract
        IERC20(s.nNecc).safeTransferFrom(
            msg.sender,
            address(this),
            _redemptionAmount
        );

        // Multiply deposit by the nNecc floor price
        uint256 _nNeccRedemptionAmount = _redemptionAmount.mul(
            s.nNeccFloorPrice
        );

        // Divide Redemption amount against price of ETH to calculate how much ETH to return back
        // for deposited nNecc
        uint256 _wethReturned = _nNeccRedemptionAmount.div(s.wethPrice);

        // Transfer ETH back to the sender
        require(
            IERC20(s.weth).balanceOf(address(this)) >= _wethReturned,
            "Redemption: failed to transfer WETH"
        );
        IERC20(s.weth).safeTransfer(msg.sender, _wethReturned);

        // Emit event about nNecc redemption
        emit RedeemnNecc(
            msg.sender,
            s.nNecc,
            _redemptionAmount,
            s.weth,
            _wethReturned
        );
    }

    function withdrawWETH(uint256 _amount) external {
        _onlyGov();
        LibRedemptionStorage.Layout storage s = LibRedemptionStorage.layout();

        uint256 _withdrawalAmount = _amount.mul(
            10**IERC20Decimals(s.weth).decimals()
        );

        require(
            IERC20(s.weth).balanceOf(address(this)) >= _withdrawalAmount,
            "Redemption: failed to withdraw WETH"
        );

        IERC20(s.weth).safeTransfer(msg.sender, _withdrawalAmount);

        emit WithdrawWETH(msg.sender, _withdrawalAmount);
    }

    function depositWETH(uint256 _amount) external {
        _onlyGov();
        LibRedemptionStorage.Layout storage s = LibRedemptionStorage.layout();

        uint256 _depositedAmount = _amount.mul(
            10**IERC20Decimals(s.weth).decimals()
        );
        require(
            IERC20(s.weth).balanceOf(msg.sender) >= _depositedAmount,
            "Redemption: failed to deposit WETH"
        );

        IERC20(s.weth).safeTransferFrom(
            msg.sender,
            address(this),
            _depositedAmount
        );

        emit DepositWETH(msg.sender, _depositedAmount);
    }
}
