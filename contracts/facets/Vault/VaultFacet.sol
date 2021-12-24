// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./VaultLib.sol";
import "./Facet.sol";

contract VaultFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event IncreasePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        uint256 price,
        uint256 fee
    );
    event DecreasePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        uint256 price,
        uint256 fee
    );
    event LiquidatePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 reserveAmount,
        int256 realisedPnl,
        uint256 markPrice
    );
    event UpdatePosition(
        bytes32 key,
        uint256 size,
        uint256 collateral,
        uint256 averagePrice,
        uint256 entryFundingRate,
        uint256 reserveAmount,
        int256 realisedPnl
    );
    event ClosePosition(
        bytes32 key,
        uint256 size,
        uint256 collateral,
        uint256 averagePrice,
        uint256 entryFundingRate,
        uint256 reserveAmount,
        int256 realisedPnl
    );

    function increasePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        uint256 _sizeDelta,
        bool _isLong
    ) external {
        VaultLib._validateRouter(_account);
        VaultLib.validateTokens(s, _collateralToken, _indexToken);
        VaultLib.updateCumulativeFundingRate(s, _collateralToken);

        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position storage position = s.positions[key];

        uint256 price = _isLong
            ? VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice)
            : VaultLib.getMinPrice(_indexToken, s.includeAmmPrice);

        if (position.size == 0) {
            position.averagePrice = price;
        }

        if (position.size > 0 && _sizeDelta > 0) {
            position.averagePrice = getNextAveragePrice(
                _indexToken,
                position.size,
                position.averagePrice,
                _isLong,
                price,
                _sizeDelta,
                position.lastIncreasedTime
            );
        }

        uint256 fee = VaultLib._collectMarginFees(
            s,
            _collateralToken,
            _sizeDelta,
            position.size,
            position.entryFundingRate
        );
        uint256 collateralDelta = VaultLib.transferIn(s, _collateralToken);
        uint256 collateralDeltaUsd = VaultLib.tokenToUsdMin(
            s,
            _collateralToken,
            collateralDelta
        );

        position.collateral = position.collateral.add(collateralDeltaUsd);
        require(
            position.collateral >= fee,
            "Vault: insufficient collateral for fees"
        );

        position.collateral = position.collateral.sub(fee);
        position.entryFundingRate = s.cumulativeFundingRates[_collateralToken];
        position.size = position.size.add(_sizeDelta);
        position.lastIncreasedTime = block.timestamp;

        require(position.size > 0, "Vault: invalid position.size");
        VaultLib.validatePosition(position.size, position.collateral);
        validateLiquidation(
            _account,
            _collateralToken,
            _indexToken,
            _isLong,
            true
        );

        // reserve tokens to pay profits on the position
        uint256 reserveDelta = VaultLib.usdToTokenMax(
            s,
            _collateralToken,
            _sizeDelta,
            s.includeAmmPrice
        );
        position.reserveAmount = position.reserveAmount.add(reserveDelta);
        VaultLib._increaseReservedAmount(s, _collateralToken, reserveDelta);

        // guaranteedUsd stores the sum of (position.size - position.collateral) for all positions
        // if a fee is charged on the collateral then guaranteedUsd should be increased by that fee amount
        // since (position.size - position.collateral) would have increased by `fee`
        VaultLib._increaseGuaranteedUsd(
            s,
            _collateralToken,
            _sizeDelta.add(fee)
        );
        VaultLib._decreaseGuaranteedUsd(
            s,
            _collateralToken,
            collateralDeltaUsd
        );
        // treat the deposited collateral as part of the pool
        VaultLib._increasePoolAmount(s, _collateralToken, collateralDelta);
        // fees need to be deducted from the pool since fees are deducted from position.collateral
        // and collateral is treated as part of the pool
        VaultLib._decreasePoolAmount(
            s,
            _collateralToken,
            VaultLib.usdToTokenMin(s, _collateralToken, fee)
        );

        emit IncreasePosition(
            key,
            _account,
            _collateralToken,
            _indexToken,
            collateralDeltaUsd,
            _sizeDelta,
            _isLong,
            price,
            fee
        );
        emit UpdatePosition(
            key,
            position.size,
            position.collateral,
            position.averagePrice,
            position.entryFundingRate,
            position.reserveAmount,
            position.realisedPnl
        );
    }

    function decreasePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver
    ) external returns (uint256) {
        VaultLib._validateRouter(_account);
        VaultLib.validateTokens(s, _collateralToken, _indexToken);

        uint256 _amountOutAfterFees = _decreasePosition(
            _account,
            _collateralToken,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            _receiver
        );

        return _amountOutAfterFees;
    }

    function _decreasePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver
    ) private returns (uint256) {
        VaultLib.updateCumulativeFundingRate(s, _collateralToken);

        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position storage position = s.positions[key];
        require(position.size > 0, "Vault: empty position");
        require(position.size >= _sizeDelta, "Vault: position size exceeded");
        require(
            position.collateral >= _collateralDelta,
            "Vault: position collateral exceeded"
        );

        uint256 collateral = position.collateral;
        // scope variables to avoid stack too deep errors
        {
            uint256 reserveDelta = position.reserveAmount.mul(_sizeDelta).div(
                position.size
            );
            position.reserveAmount = position.reserveAmount.sub(reserveDelta);
            VaultLib._decreaseReservedAmount(s, _collateralToken, reserveDelta);
        }

        (uint256 _usdOut, uint256 _usdOutAfterFee) = VaultLib._reduceCollateral(
            s,
            _account,
            _collateralToken,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong
        );

        if (position.size != _sizeDelta) {
            position.entryFundingRate = s.cumulativeFundingRates[
                _collateralToken
            ];
            position.size = position.size.sub(_sizeDelta);

            VaultLib.validatePosition(position.size, position.collateral);
            validateLiquidation(
                _account,
                _collateralToken,
                _indexToken,
                _isLong,
                true
            );

            VaultLib._increaseGuaranteedUsd(
                s,
                _collateralToken,
                collateral.sub(position.collateral)
            );
            VaultLib._decreaseGuaranteedUsd(s, _collateralToken, _sizeDelta);

            uint256 price = _isLong
                ? VaultLib.getMinPrice(_indexToken, s.includeAmmPrice)
                : VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice);
            emit DecreasePosition(
                key,
                _account,
                _collateralToken,
                _indexToken,
                _collateralDelta,
                _sizeDelta,
                _isLong,
                price,
                _usdOut.sub(_usdOutAfterFee)
            );
            emit UpdatePosition(
                key,
                position.size,
                position.collateral,
                position.averagePrice,
                position.entryFundingRate,
                position.reserveAmount,
                position.realisedPnl
            );
        } else {
            VaultLib._increaseGuaranteedUsd(s, _collateralToken, collateral);
            VaultLib._decreaseGuaranteedUsd(s, _collateralToken, _sizeDelta);

            uint256 price = _isLong
                ? VaultLib.getMinPrice(_indexToken, s.includeAmmPrice)
                : VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice);
            emit DecreasePosition(
                key,
                _account,
                _collateralToken,
                _indexToken,
                _collateralDelta,
                _sizeDelta,
                _isLong,
                price,
                _usdOut.sub(_usdOutAfterFee)
            );
            emit ClosePosition(
                key,
                position.size,
                position.collateral,
                position.averagePrice,
                position.entryFundingRate,
                position.reserveAmount,
                position.realisedPnl
            );

            delete s.positions[key];
        }

        return
            VaultLib._transferRemainingCollateral(
                s,
                _collateralToken,
                _receiver,
                _usdOut,
                _usdOutAfterFee
            );
    }

    function liquidatePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        address _feeReceiver
    ) external {
        // set INCLUDE_AMM_PRICE to false prevent manipulated liquidations
        s.includeAmmPrice = false;

        VaultLib.validateTokens(s, _collateralToken, _indexToken);
        VaultLib.updateCumulativeFundingRate(s, _collateralToken);

        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position memory position = s.positions[key];
        require(position.size > 0, "Vault: empty position");

        (uint256 liquidationState, uint256 marginFees) = validateLiquidation(
            _account,
            _collateralToken,
            _indexToken,
            _isLong,
            false
        );
        require(liquidationState != 0, "Vault: position cannot be liquidated");
        // max leverage exceeded but there is collateral remaining after deducting losses
        // so decreasePosition instead by a half to keep alive
        if (liquidationState == 2) {
            _decreasePosition(
                _account,
                _collateralToken,
                _indexToken,
                0,
                position.size.mul(5).div(10), // div by 2
                _isLong,
                _account
            );
            return;
        }

        s.feeReserves[_collateralToken] = s.feeReserves[_collateralToken].add(
            VaultLib.usdToTokenMin(s, _collateralToken, marginFees)
        );

        VaultLib._decreaseReservedAmount(
            s,
            _collateralToken,
            position.reserveAmount
        );
        VaultLib._decreaseGuaranteedUsd(
            s,
            _collateralToken,
            position.size.sub(position.collateral)
        );

        uint256 markPrice = _isLong
            ? VaultLib.getMinPrice(_indexToken, s.includeAmmPrice)
            : VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice);

        emit LiquidatePosition(
            key,
            _account,
            _collateralToken,
            _indexToken,
            _isLong,
            position.size,
            position.collateral,
            position.reserveAmount,
            position.realisedPnl,
            markPrice
        );

        delete s.positions[key];

        // pay the fee receiver using the pool,
        // we assume that in general the liquidated amount should be sufficient to cover
        // the liquidation fees
        VaultLib._decreasePoolAmount(
            s,
            _collateralToken,
            VaultLib.usdToTokenMin(s, _collateralToken, LIQUIDATION_FEE_USD)
        );

        s.includeAmmPrice = true;

        VaultLib.transferOut(
            s,
            _collateralToken,
            VaultLib.usdToTokenMin(s, _collateralToken, LIQUIDATION_FEE_USD),
            _feeReceiver
        );
    }

    function validateLiquidation(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        bool _raise
    )
        public
        view
        returns (
            // returns (state, fees)
            uint256,
            uint256
        )
    {
        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position memory position = s.positions[key];

        (bool hasProfit, uint256 delta) = getDelta(
            _indexToken,
            position.size,
            position.averagePrice,
            _isLong,
            position.lastIncreasedTime
        );
        uint256 marginFees = getFundingFee(
            _collateralToken,
            position.size,
            position.entryFundingRate
        );
        marginFees = marginFees.add(getPositionFee(position.size));

        if (!hasProfit && position.collateral < delta) {
            if (_raise) {
                revert("Vault: losses exceed collateral");
            }
            return (1, marginFees);
        }

        uint256 remainingCollateral = position.collateral;
        if (!hasProfit) {
            remainingCollateral = position.collateral.sub(delta);
        }

        if (remainingCollateral < marginFees) {
            if (_raise) {
                revert("Vault: fees exceed collateral");
            }
            // cap the fees to the remainingCollateral
            return (1, remainingCollateral);
        }

        if (remainingCollateral < marginFees.add(LIQUIDATION_FEE_USD)) {
            if (_raise) {
                revert("Vault: liquidation fees exceed collateral");
            }
            return (1, marginFees);
        }

        if (
            remainingCollateral.mul(MAX_LEVERAGE) <
            position.size.mul(BASIS_POINTS_DIVISOR)
        ) {
            if (_raise) {
                revert("Vault: max leverage exceeded");
            }
            return (2, marginFees);
        }

        return (0, marginFees);
    }

    function getPosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong
    )
        public
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            bool,
            uint256
        )
    {
        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position memory position = s.positions[key];
        uint256 realisedPnl = position.realisedPnl > 0
            ? uint256(position.realisedPnl)
            : uint256(-position.realisedPnl);
        return (
            position.size, // 0
            position.collateral, // 1
            position.averagePrice, // 2
            position.entryFundingRate, // 3
            position.reserveAmount, // 4
            realisedPnl, // 5
            position.realisedPnl >= 0, // 6
            position.lastIncreasedTime // 7
        );
    }

    function getNextFundingRate(address _token) public view returns (uint256) {
        return VaultLib._getNextFundingRate(s, _token);
    }

    function getUtilisation(address _token) public view returns (uint256) {
        uint256 poolAmount = s.poolAmounts[_token];
        if (poolAmount == 0) {
            return 0;
        }

        return
            s.reservedAmounts[_token].mul(FUNDING_RATE_PRECISION).div(
                poolAmount
            );
    }

    function getPositionLeverage(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong
    ) public view returns (uint256) {
        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position memory position = s.positions[key];
        require(position.collateral > 0, "Vault: invalid position");
        return position.size.mul(BASIS_POINTS_DIVISOR).div(position.collateral);
    }

    // // for longs: nextAveragePrice = (nextPrice * nextSize)/ (nextSize + delta)
    // // for shorts: nextAveragePrice = (nextPrice * nextSize) / (nextSize - delta)
    function getNextAveragePrice(
        address _indexToken,
        uint256 _size,
        uint256 _averagePrice,
        bool _isLong,
        uint256 _nextPrice,
        uint256 _sizeDelta,
        uint256 _lastIncreasedTime
    ) public view returns (uint256) {
        (bool hasProfit, uint256 delta) = getDelta(
            _indexToken,
            _size,
            _averagePrice,
            _isLong,
            _lastIncreasedTime
        );
        uint256 nextSize = _size.add(_sizeDelta);
        uint256 divisor;
        if (_isLong) {
            divisor = hasProfit ? nextSize.add(delta) : nextSize.sub(delta);
        } else {
            divisor = hasProfit ? nextSize.sub(delta) : nextSize.add(delta);
        }
        return _nextPrice.mul(nextSize).div(divisor);
    }

    function getPositionDelta(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong
    ) public view returns (bool, uint256) {
        bytes32 key = VaultLib.getPositionKey(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );
        LibExchangeStorage.Position memory position = s.positions[key];
        return
            getDelta(
                _indexToken,
                position.size,
                position.averagePrice,
                _isLong,
                position.lastIncreasedTime
            );
    }

    function getDelta(
        address _indexToken,
        uint256 _size,
        uint256 _averagePrice,
        bool _isLong,
        uint256 _lastIncreasedTime
    ) public view returns (bool, uint256) {
        return
            VaultLib._getDelta(
                s,
                _indexToken,
                _size,
                _averagePrice,
                _isLong,
                _lastIncreasedTime
            );
    }

    function getFundingFee(
        address _token,
        uint256 _size,
        uint256 _entryFundingRate
    ) public view returns (uint256) {
        return VaultLib._getFundingFee(s, _token, _size, _entryFundingRate);
    }

    function getPositionFee(uint256 _sizeDelta) public pure returns (uint256) {
        return VaultLib._getPositionFee(_sizeDelta);
    }

    function liquidationFeeUsd() public pure returns (uint256) {
        return LIQUIDATION_FEE_USD;
    }

    function fundingRateFactor() public pure returns (uint256) {
        return FUNDING_RATE_FACTOR;
    }

    function fundingInterval() public pure returns (uint256) {
        return FUNDING_INTERVAL;
    }

    function marginFeeBasisPoints() public pure returns (uint256) {
        return MARGIN_FEE_BASIS_POINTS;
    }

    function cumulativeFundingRates(address _token)
        public
        view
        returns (uint256)
    {
        return s.cumulativeFundingRates[_token];
    }

    function lastFundingTimes(address _token) public view returns (uint256) {
        return s.lastFundingTimes[_token];
    }
}
