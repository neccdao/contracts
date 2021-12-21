// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IVaultPriceFeed.sol";
import "../../lib/LibExchangeStorage.sol";

// import "hardhat/console.sol";

library VaultLib {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event IncreaseNDOLAmount(address token, uint256 amount);
    event DecreaseNDOLAmount(address token, uint256 amount);
    event CollectSwapFees(address token, uint256 feeUsd, uint256 feeTokens);
    event CollectMarginFees(address token, uint256 feeUsd, uint256 feeTokens);
    event IncreasePoolAmount(address token, uint256 amount);
    event DecreasePoolAmount(address token, uint256 amount);
    event UpdateFundingRate(address token, uint256 fundingRate);
    event UpdatePnl(bytes32 key, bool hasProfit, uint256 delta);
    event IncreaseReservedAmount(address token, uint256 amount);
    event DecreaseReservedAmount(address token, uint256 amount);
    event IncreaseGuaranteedUsd(address token, uint256 amount);
    event DecreaseGuaranteedUsd(address token, uint256 amount);

    function _getNextFundingRate(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal view returns (uint256) {
        if (
            s.lastFundingTimes[_token].add(FUNDING_INTERVAL) > block.timestamp
        ) {
            return 0;
        }

        uint256 _intervals = block
            .timestamp
            .sub(s.lastFundingTimes[_token])
            .div(FUNDING_INTERVAL);
        uint256 _poolAmount = s.poolAmounts[_token];
        if (_poolAmount == 0) {
            return 0;
        }

        return
            FUNDING_RATE_FACTOR
                .mul(s.reservedAmounts[_token])
                .mul(_intervals)
                .div(_poolAmount);
    }

    function updateCumulativeFundingRate(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal {
        if (s.lastFundingTimes[_token] == 0) {
            s.lastFundingTimes[_token] = block
                .timestamp
                .div(FUNDING_INTERVAL)
                .mul(FUNDING_INTERVAL);
            return;
        }

        if (
            s.lastFundingTimes[_token].add(FUNDING_INTERVAL) > block.timestamp
        ) {
            return;
        }

        uint256 fundingRate = _getNextFundingRate(s, _token);
        s.cumulativeFundingRates[_token] = s.cumulativeFundingRates[_token].add(
            fundingRate
        );
        s.lastFundingTimes[_token] = block.timestamp.div(FUNDING_INTERVAL).mul(
            FUNDING_INTERVAL
        );

        emit UpdateFundingRate(_token, s.cumulativeFundingRates[_token]);
    }

    function adjustForDecimals(
        LibExchangeStorage.Storage storage s,
        uint256 _amount,
        address _tokenDiv,
        address _tokenMul
    ) internal view returns (uint256) {
        uint256 _decimalsDiv = _tokenDiv == s.ndol
            ? NDOL_DECIMALS
            : s.tokenDecimals[_tokenDiv];
        uint256 _decimalsMul = _tokenMul == s.ndol
            ? NDOL_DECIMALS
            : s.tokenDecimals[_tokenMul];

        return _amount.mul(10**_decimalsMul).div(10**_decimalsDiv);
    }

    function getMinPrice(address _token, bool includeAmmPrice)
        internal
        view
        returns (uint256)
    {
        return
            IVaultPriceFeed(address(this)).getPrice(
                _token,
                false,
                includeAmmPrice
            );
    }

    function getMaxPrice(address _token, bool includeAmmPrice)
        internal
        view
        returns (uint256)
    {
        return
            IVaultPriceFeed(address(this)).getPrice(
                _token,
                true,
                includeAmmPrice
            );
    }

    function isTokenWhitelisted(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal view {
        require(s.whitelistedTokens[_token], "Vault: token not whitelisted");
    }

    function isPoolAmountBelowBalance(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal view {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(s.poolAmounts[_token] <= balance, "Vault: invalid increase");
    }

    function transferIn(LibExchangeStorage.Storage storage s, address _token)
        internal
        returns (uint256)
    {
        uint256 prevBalance = s.tokenBalances[_token];
        uint256 nextBalance = IERC20(_token).balanceOf(address(this));
        s.tokenBalances[_token] = nextBalance;

        return nextBalance.sub(prevBalance);
    }

    function transferOut(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount,
        address _receiver
    ) internal {
        s.tokenBalances[_token] = IERC20(_token).balanceOf(address(this)).sub(
            _amount
        );

        IERC20(_token).safeTransfer(_receiver, _amount);
    }

    function tokenToUsdMin(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _tokenAmount
    ) internal view returns (uint256) {
        if (_tokenAmount == 0) {
            return 0;
        }
        uint256 _price = getMinPrice(_token, s.includeAmmPrice);
        uint256 _decimals = s.tokenDecimals[_token];

        return _tokenAmount.mul(_price).div(10**_decimals);
    }

    function usdToTokenMin(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _usdAmount
    ) internal view returns (uint256) {
        if (_usdAmount == 0) {
            return 0;
        }
        return
            usdToToken(
                s,
                _token,
                _usdAmount,
                getMaxPrice(_token, s.includeAmmPrice)
            );
    }

    function usdToToken(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _usdAmount,
        uint256 _price
    ) internal view returns (uint256) {
        if (_usdAmount == 0) {
            return 0;
        }
        uint256 _decimals = s.tokenDecimals[_token];

        return _usdAmount.mul(10**_decimals).div(_price);
    }

    function tokenToUsdMax(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _tokenAmount,
        bool includeAmmPrice
    ) internal view returns (uint256) {
        if (_tokenAmount == 0) {
            return 0;
        }
        uint256 _price = getMaxPrice(_token, includeAmmPrice);
        uint256 _decimals = s.tokenDecimals[_token];
        return _tokenAmount.mul(_price).div(10**_decimals);
    }

    function usdToTokenMax(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _usdAmount,
        bool includeAmmPrice
    ) internal view returns (uint256) {
        if (_usdAmount == 0) {
            return 0;
        }
        return
            usdToToken(
                s,
                _token,
                _usdAmount,
                getMinPrice(_token, includeAmmPrice)
            );
    }

    function updateTokenBalance(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal {
        uint256 _nextBalance = IERC20(_token).balanceOf(address(this));

        s.tokenBalances[_token] = _nextBalance;
    }

    function validatePosition(uint256 _size, uint256 _collateral)
        internal
        pure
    {
        if (_size == 0) {
            require(_collateral == 0, "Vault: collateral should be withdrawn");
            return;
        }
        require(
            _size >= _collateral,
            "Vault: _size must be more than _collateral"
        );
    }

    function _validateRouter(address _account) internal view {
        if (msg.sender == _account) {
            return;
        }
        if (msg.sender == address(this)) {
            return;
        }
        revert("Vault: invalid msg.sender");
    }

    function validateTokens(
        LibExchangeStorage.Storage storage s,
        address _collateralToken,
        address _indexToken
    ) internal view {
        require(_collateralToken == _indexToken, "Vault: mismatched tokens");
        isTokenWhitelisted(s, _collateralToken);
        isTokenWhitelisted(s, _indexToken);
    }

    function getPositionKey(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    _account,
                    _collateralToken,
                    _indexToken,
                    _isLong
                )
            );
    }

    function _collectSwapFees(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount,
        bool _isBuyingNDOL
    ) internal returns (uint256, uint256) {
        uint256 _targetAdjustedFee = _getTargetAdjustedFee(
            s,
            _token,
            SWAP_FEE_BASIS_POINTS
        );
        uint256 _afterFeeAmount = _amount
            .mul(
                BASIS_POINTS_DIVISOR.sub(
                    _isBuyingNDOL ? _targetAdjustedFee : SWAP_FEE_BASIS_POINTS
                )
            )
            .div(BASIS_POINTS_DIVISOR);
        uint256 _feeAmount = _amount.sub(_afterFeeAmount);

        s.feeReserves[_token] = s.feeReserves[_token].add(_feeAmount);

        emit CollectSwapFees(
            _token,
            VaultLib.tokenToUsdMin(s, _token, _feeAmount),
            _feeAmount
        );
        return (_feeAmount, _afterFeeAmount);
    }

    function _increasePoolAmount(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount
    ) internal returns (uint256) {
        s.poolAmounts[_token] = s.poolAmounts[_token].add(_amount);
        isPoolAmountBelowBalance(s, _token);

        emit IncreasePoolAmount(_token, _amount);

        return s.poolAmounts[_token];
    }

    function _decreasePoolAmount(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount
    ) internal {
        s.poolAmounts[_token] = s.poolAmounts[_token].sub(
            _amount,
            "Vault: poolAmount exceeded"
        );
        isReservedAmountBelowPoolAmount(s, _token);
        isPoolAmountBelowBalance(s, _token);

        emit DecreasePoolAmount(_token, _amount);
    }

    function isReservedAmountBelowPoolAmount(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal view {
        require(
            s.reservedAmounts[_token] <= s.poolAmounts[_token],
            "Vault: reserve exceeds pool"
        );
    }

    function _transferRemainingCollateral(
        LibExchangeStorage.Storage storage s,
        address _collateralToken,
        address _receiver,
        uint256 _usdOut,
        uint256 _usdOutAfterFee
    ) internal returns (uint256) {
        if (_usdOut > 0) {
            VaultLib._decreasePoolAmount(
                s,
                _collateralToken,
                VaultLib.usdToTokenMin(s, _collateralToken, _usdOut)
            );
            uint256 _amountOutAfterFees = VaultLib.usdToTokenMin(
                s,
                _collateralToken,
                _usdOutAfterFee
            );
            VaultLib.transferOut(
                s,
                _collateralToken,
                _amountOutAfterFees,
                _receiver
            );

            return _amountOutAfterFees;
        } else {
            return 0;
        }
    }

    function _increaseNDOLAmount(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount
    ) internal {
        s.ndolAmounts[_token] = s.ndolAmounts[_token].add(_amount);

        emit IncreaseNDOLAmount(_token, _amount);
    }

    function _decreaseNDOLAmount(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount
    ) internal {
        uint256 _value = s.ndolAmounts[_token];
        // since NDOL can be minted using multiple assets
        // it is possible for the NDOL debt for a single asset to be less than zero
        // the NDOL debt is capped to zero for this case
        if (_value <= _amount) {
            s.ndolAmounts[_token] = 0;
            emit DecreaseNDOLAmount(_token, _value);
            return;
        }
        s.ndolAmounts[_token] = _value.sub(_amount);

        emit DecreaseNDOLAmount(_token, _amount);
    }

    function _reduceCollateral(
        LibExchangeStorage.Storage storage s,
        address _account,
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong
    ) internal returns (uint256, uint256) {
        LibExchangeStorage.Position storage position = s.positions[
            getPositionKey(_account, _collateralToken, _indexToken, _isLong)
        ];

        uint256 fee = _collectMarginFees(
            s,
            _collateralToken,
            _sizeDelta,
            position.size,
            position.entryFundingRate
        );
        bool hasProfit;
        uint256 adjustedDelta;

        // scope variables to avoid stack too deep errors
        {
            (bool _hasProfit, uint256 delta) = _getDelta(
                s,
                _indexToken,
                position.size,
                position.averagePrice,
                _isLong,
                position.lastIncreasedTime
            );
            hasProfit = _hasProfit;
            // get the proportional change in pnl
            adjustedDelta = _sizeDelta.mul(delta).div(position.size);
        }

        uint256 usdOut;
        // transfer profits out
        if (hasProfit && adjustedDelta > 0) {
            usdOut = adjustedDelta;
            position.realisedPnl = position.realisedPnl + int256(adjustedDelta);
        }

        if (!hasProfit && adjustedDelta > 0) {
            position.collateral = position.collateral.sub(adjustedDelta);
            position.realisedPnl = position.realisedPnl - int256(adjustedDelta);
        }

        // reduce the position's collateral by _collateralDelta
        // transfer _collateralDelta out
        if (_collateralDelta > 0) {
            usdOut = usdOut.add(_collateralDelta);
            position.collateral = position.collateral.sub(_collateralDelta);
        }

        // if the position will be closed, then transfer the remaining collateral out
        if (position.size == _sizeDelta) {
            usdOut = usdOut.add(position.collateral);
            position.collateral = 0;
        }

        // if the usdOut is more than the fee then deduct the fee from the usdOut directly
        // else deduct the fee from the position's collateral
        if (usdOut < fee) {
            position.collateral = position.collateral.sub(fee);
            uint256 feeTokens = VaultLib.usdToTokenMin(
                s,
                _collateralToken,
                fee
            );
            VaultLib._decreasePoolAmount(s, _collateralToken, feeTokens);
        }

        emit UpdatePnl(
            getPositionKey(_account, _collateralToken, _indexToken, _isLong),
            hasProfit,
            adjustedDelta
        );

        return (usdOut, usdOut > fee ? usdOut.sub(fee) : usdOut);
    }

    function _collectMarginFees(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _sizeDelta,
        uint256 _size,
        uint256 _entryFundingRate
    ) internal returns (uint256) {
        uint256 feeUsd = _getPositionFee(_sizeDelta);

        uint256 fundingFee = _getFundingFee(
            s,
            _token,
            _size,
            _entryFundingRate
        );
        feeUsd = feeUsd.add(fundingFee);

        uint256 feeTokens = VaultLib.usdToTokenMin(s, _token, feeUsd);
        s.feeReserves[_token] = s.feeReserves[_token].add(feeTokens);

        emit CollectMarginFees(_token, feeUsd, feeTokens);
        return feeUsd;
    }

    function _increaseReservedAmount(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount
    ) internal {
        s.reservedAmounts[_token] = s.reservedAmounts[_token].add(_amount);
        require(
            s.reservedAmounts[_token] <= s.poolAmounts[_token],
            "Vault: reserve exceeds pool"
        );

        emit IncreaseReservedAmount(_token, _amount);
    }

    function _decreaseReservedAmount(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _amount
    ) internal {
        s.reservedAmounts[_token] = s.reservedAmounts[_token].sub(
            _amount,
            "Vault: insufficient reserve"
        );

        emit DecreaseReservedAmount(_token, _amount);
    }

    function _increaseGuaranteedUsd(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _usdAmount
    ) internal {
        s.guaranteedUsd[_token] = s.guaranteedUsd[_token].add(_usdAmount);

        emit IncreaseGuaranteedUsd(_token, _usdAmount);
    }

    function _decreaseGuaranteedUsd(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _usdAmount
    ) internal {
        s.guaranteedUsd[_token] = s.guaranteedUsd[_token].sub(_usdAmount);

        emit DecreaseGuaranteedUsd(_token, _usdAmount);
    }

    function _getDelta(
        LibExchangeStorage.Storage storage s,
        address _indexToken,
        uint256 _size,
        uint256 _averagePrice,
        bool _isLong,
        uint256 _lastIncreasedTime
    ) internal view returns (bool, uint256) {
        require(_averagePrice > 0, "Vault: invalid _averagePrice");
        uint256 price = _isLong
            ? VaultLib.getMinPrice(_indexToken, s.includeAmmPrice)
            : VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice);
        uint256 priceDelta = _averagePrice > price
            ? _averagePrice.sub(price)
            : price.sub(_averagePrice);
        uint256 delta = _size.mul(priceDelta).div(_averagePrice);

        bool hasProfit;

        if (_isLong) {
            hasProfit = price > _averagePrice;
        } else {
            hasProfit = _averagePrice > price;
        }

        // if the minProfitTime has passed then there will be no min profit threshold
        // the min profit threshold helps to prevent front-running issues
        uint256 minBps = block.timestamp >
            _lastIncreasedTime.add(MIN_PROFIT_TIME)
            ? 0
            : s.minProfitBasisPoints[_indexToken];
        if (hasProfit && delta.mul(BASIS_POINTS_DIVISOR) <= _size.mul(minBps)) {
            delta = 0;
        }

        return (hasProfit, delta);
    }

    function _getFundingFee(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _size,
        uint256 _entryFundingRate
    ) internal view returns (uint256) {
        if (_size == 0) {
            return 0;
        }

        uint256 fundingRate = s.cumulativeFundingRates[_token].sub(
            _entryFundingRate
        );
        if (fundingRate == 0) {
            return 0;
        }

        return _size.mul(fundingRate).div(FUNDING_RATE_PRECISION);
    }

    function _getPositionFee(uint256 _sizeDelta)
        internal
        pure
        returns (uint256)
    {
        if (_sizeDelta == 0) {
            return 0;
        }
        uint256 afterFeeUsd = _sizeDelta
            .mul(BASIS_POINTS_DIVISOR.sub(MARGIN_FEE_BASIS_POINTS))
            .div(BASIS_POINTS_DIVISOR);
        return _sizeDelta.sub(afterFeeUsd);
    }

    function _getTargetAdjustedFee(
        LibExchangeStorage.Storage storage s,
        address _token,
        uint256 _fee
    ) internal view returns (uint256) {
        uint256 _initialAmount = s.ndolAmounts[_token];
        uint256 _targetAmount = _getTargetNDOLAmount(s, _token);

        if (_targetAmount == 0 || _initialAmount == 0) {
            return _fee;
        } else if (_initialAmount > _targetAmount) {
            return _fee;
        }
        return _fee.mul(_initialAmount).div(_targetAmount);
    }

    function _getTargetNDOLAmount(
        LibExchangeStorage.Storage storage s,
        address _token
    ) internal view returns (uint256) {
        uint256 _ndolSupply = IERC20(s.ndol).totalSupply();
        if (_ndolSupply == 0) {
            return 0;
        }
        uint256 _tokenWeight = s.tokenWeights[_token];

        return _ndolSupply.mul(_tokenWeight).div(s.totalTokenWeight);
    }
}
