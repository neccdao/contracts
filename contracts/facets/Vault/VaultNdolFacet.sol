// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Facet.sol";
import "./VaultLib.sol";

// import "hardhat/console.sol";

interface INDOL {
    function mint(address _account, uint256 _amount) external;

    function burn(address _account, uint256 _amount) external;
}

contract VaultNdolFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event BuyNDOL(
        address account,
        address token,
        uint256 tokenAmount,
        uint256 ndolAmount
    );
    event SellNDOL(
        address account,
        address token,
        uint256 ndolAmount,
        uint256 tokenAmount
    );
    event Swap(
        address account,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function buyNDOL(address _token, address _receiver)
        external
        returns (uint256)
    {
        VaultLib.isTokenWhitelisted(s, _token);
        uint256 _price = VaultLib.getMinPrice(_token, s.includeAmmPrice);

        uint256 _tokenAmount = VaultLib.transferIn(s, _token);
        require(_tokenAmount > 0, "Vault: invalid tokenAmount");

        VaultLib.updateCumulativeFundingRate(s, _token);

        (, uint256 _amountAfterFees) = VaultLib._collectSwapFees(
            s,
            _token,
            _tokenAmount,
            true
        );

        uint256 _ndolAmount = VaultLib.adjustForDecimals(
            s,
            _amountAfterFees.mul(_price).div(PRICE_PRECISION),
            _token,
            s.ndol
        );

        require(_ndolAmount > 0, "Vault: invalid ndolAmount");

        VaultLib._increasePoolAmount(s, _token, _amountAfterFees);
        VaultLib._increaseNDOLAmount(s, _token, _ndolAmount);

        emit BuyNDOL(_receiver, _token, _tokenAmount, _ndolAmount);

        INDOL(s.ndol).mint(_receiver, _ndolAmount);

        return _ndolAmount;
    }

    function sellNDOL(address _token, address _receiver)
        external
        returns (uint256)
    {
        VaultLib.isTokenWhitelisted(s, _token);

        uint256 _ndolAmount = VaultLib.transferIn(s, s.ndol);
        require(_ndolAmount > 0, "Vault: invalid ndolAmount");

        VaultLib.updateCumulativeFundingRate(s, _token);

        uint256 _redemptionAmount = getRedemptionAmount(_token, _ndolAmount);
        require(_redemptionAmount > 0, "Vault: invalid redemptionAmount");

        VaultLib._decreasePoolAmount(s, _token, _redemptionAmount);
        VaultLib._decreaseNDOLAmount(s, _token, _ndolAmount);

        INDOL(s.ndol).burn(address(this), _ndolAmount);

        // the _transferIn call increased the value of tokenBalances[ndol]
        // usually decreases in token balances are synced by calling _transferOut
        // however, for ndol, the tokens are burnt, so updateTokenBalance should
        // be manually called to record the decrease in tokens
        VaultLib.updateTokenBalance(s, s.ndol);

        (, uint256 _tokenAmount) = VaultLib._collectSwapFees(
            s,
            _token,
            _redemptionAmount,
            false
        );
        require(_tokenAmount > 0, "Vault: invalid tokenAmount");

        emit SellNDOL(_receiver, _token, _ndolAmount, _tokenAmount);

        VaultLib.transferOut(s, _token, _tokenAmount, _receiver);

        return _tokenAmount;
    }

    function swap(
        address _tokenIn,
        address _tokenOut,
        address _receiver
    ) external returns (uint256) {
        require(_tokenIn != _tokenOut, "Vault: invalid tokens");
        VaultLib.isTokenWhitelisted(s, _tokenIn);
        VaultLib.isTokenWhitelisted(s, _tokenOut);

        VaultLib.updateCumulativeFundingRate(s, _tokenIn);
        VaultLib.updateCumulativeFundingRate(s, _tokenOut);

        uint256 amountIn = VaultLib.transferIn(s, _tokenIn);
        require(amountIn > 0, "Vault: invalid amountIn");

        uint256 priceIn = VaultLib.getMinPrice(_tokenIn, s.includeAmmPrice);
        uint256 priceOut = VaultLib.getMaxPrice(_tokenOut, s.includeAmmPrice);

        uint256 amountOut = VaultLib.adjustForDecimals(
            s,
            amountIn.mul(priceIn).div(priceOut),
            _tokenIn,
            _tokenOut
        );
        (, uint256 amountOutAfterFees) = VaultLib._collectSwapFees(
            s,
            _tokenOut,
            amountOut,
            false
        );

        // adjust ndolAmounts by the same ndolAmount as debt is shifted between the assets
        uint256 ndolAmount = VaultLib.adjustForDecimals(
            s,
            amountIn.mul(priceIn).div(PRICE_PRECISION),
            _tokenIn,
            s.ndol
        );

        VaultLib._increaseNDOLAmount(s, _tokenIn, ndolAmount);
        VaultLib._decreaseNDOLAmount(s, _tokenOut, ndolAmount);

        VaultLib._increasePoolAmount(s, _tokenIn, amountIn);
        VaultLib._decreasePoolAmount(s, _tokenOut, amountOut);

        emit Swap(_receiver, _tokenIn, _tokenOut, amountIn, amountOutAfterFees);

        VaultLib.transferOut(s, _tokenOut, amountOutAfterFees, _receiver);

        return amountOutAfterFees;
    }

    function getRedemptionBasisPoints(address _token)
        public
        view
        returns (uint256)
    {
        return s.redemptionBasisPoints[_token];
    }

    function poolAmounts(address _token) public view returns (uint256) {
        return s.poolAmounts[_token];
    }

    function reservedAmounts(address _token) public view returns (uint256) {
        return s.reservedAmounts[_token];
    }

    function ndolAmounts(address _token) public view returns (uint256) {
        return s.ndolAmounts[_token];
    }

    function feeReserves(address _token) public view returns (uint256) {
        return s.feeReserves[_token];
    }

    function guaranteedUsd(address _token) public view returns (uint256) {
        return s.guaranteedUsd[_token];
    }

    function getRedemptionCollateral(address _token)
        public
        view
        returns (uint256)
    {
        uint256 _collateral = VaultLib.usdToTokenMin(
            s,
            _token,
            s.guaranteedUsd[_token]
        );
        return
            _collateral.add(s.poolAmounts[_token]).sub(
                s.reservedAmounts[_token]
            );
    }

    function getRedemptionCollateralUsd(address _token)
        public
        view
        returns (uint256)
    {
        return
            VaultLib.tokenToUsdMin(s, _token, getRedemptionCollateral(_token));
    }

    function availableReserve(address _token) public view returns (uint256) {
        uint256 _balance = IERC20(_token).balanceOf(address(this));
        return _balance.sub(s.reservedAmounts[_token]);
    }

    function getRedemptionAmount(address _token, uint256 _ndolAmount)
        public
        view
        returns (uint256)
    {
        uint256 _price = VaultLib.getMaxPrice(_token, s.includeAmmPrice);

        uint256 _priceBasedAmount = VaultLib.adjustForDecimals(
            s,
            _ndolAmount.mul(PRICE_PRECISION).div(_price),
            s.ndol,
            _token
        );

        uint256 _redemptionCollateral = getRedemptionCollateral(_token);
        if (_redemptionCollateral == 0) {
            return 0;
        }

        uint256 totalNdolAmount = s.ndolAmounts[_token];

        // if there is no NDOL debt then the redemption amount based just on price can be supported
        if (totalNdolAmount == 0) {
            return _priceBasedAmount;
        }

        // calculate the collateralBasedAmount from the amount of backing collateral and the
        // total debt in NDOL tokens for the asset
        uint256 _collateralBasedAmount = _ndolAmount
            .mul(_redemptionCollateral)
            .div(totalNdolAmount);

        uint256 _basisPoints = getRedemptionBasisPoints(_token);
        _collateralBasedAmount = _collateralBasedAmount.mul(_basisPoints).div(
            BASIS_POINTS_DIVISOR
        );

        return
            _collateralBasedAmount < _priceBasedAmount
                ? _collateralBasedAmount
                : _priceBasedAmount;
    }

    function getTargetAdjustedFee(address _token, uint256 _fee)
        public
        view
        returns (uint256)
    {
        uint256 _initialAmount = s.ndolAmounts[_token];
        uint256 _targetAmount = VaultLib._getTargetNDOLAmount(s, _token);

        if (_targetAmount == 0 || _initialAmount == 0) {
            return _fee;
        } else if (_initialAmount > _targetAmount) {
            return _fee;
        }
        return _fee.mul(_initialAmount).div(_targetAmount);
    }

    function ndol() public view returns (address) {
        return s.ndol;
    }

    function swapFeeBasisPoints() public pure returns (uint256) {
        return SWAP_FEE_BASIS_POINTS;
    }
}
