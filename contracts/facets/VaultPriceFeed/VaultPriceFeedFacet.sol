// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../Vault/Facet.sol";

contract VaultPriceFeedFacet is Facet {
    using SafeMath for uint256;

    function getPrimaryPrice(address _token, bool _maximise)
        public
        view
        returns (uint256)
    {
        address priceFeedAddress = s.priceFeeds[_token];
        require(
            priceFeedAddress != address(0),
            "PriceFeed: invalid price feed"
        );
        IPriceFeed priceFeed = IPriceFeed(priceFeedAddress);

        uint256 price = 0;
        uint80 roundId = priceFeed.latestRound();

        for (uint80 i = 0; i < PRICE_SAMPLE_SPACE; i++) {
            if (roundId <= i) {
                break;
            }
            uint256 p;

            if (i == 0) {
                int256 _p = priceFeed.latestAnswer();
                require(_p > 0, "PriceFeed: invalid price");
                p = uint256(_p);
            } else {
                (, int256 _p, , , ) = priceFeed.getRoundData(roundId - i);
                require(_p > 0, "PriceFeed: invalid price");
                p = uint256(_p);
            }

            if (price == 0) {
                price = p;
                continue;
            }

            if (_maximise && p > price) {
                price = p;
                continue;
            }

            if (!_maximise && p < price) {
                price = p;
            }
        }

        require(price > 0, "PriceFeed: could not fetch price");
        // normalise price precision
        uint256 _priceDecimals = s.priceDecimals[_token];
        return price.mul(PRICE_PRECISION).div(10**_priceDecimals);
    }

    // if divByReserve0: calculate price as reserve1 / reserve0
    // if !divByReserve1: calculate price as reserve0 / reserve1
    function getPairPrice(address _pair, bool _divByReserve0)
        public
        view
        returns (uint256)
    {
        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(_pair)
            .getReserves();
        if (_divByReserve0) {
            if (reserve0 == 0) {
                return 0;
            }
            return reserve1.mul(PRICE_PRECISION).div(reserve0);
        }
        if (reserve1 == 0) {
            return 0;
        }
        return reserve0.mul(PRICE_PRECISION).div(reserve1);
    }

    function getAmmPrice(address _token, uint256 _primaryPrice)
        public
        view
        returns (uint256)
    {
        // Usually wXUSDC
        address _basePair = s.baseTokenPairs[_token];
        // Usually xETHwX
        address _tokenPair = s.tokenPairs[_token];

        uint256 _price0 = getPairPrice(_basePair, false);
        uint256 _price1 = getPairPrice(_tokenPair, false);

        if (_basePair == _tokenPair) {
            return _price0.mul(10**(s.priceDecimals[_token]));
        } else if (_price0 == 0 || _price1 == 0) {
            return _primaryPrice;
        }

        // this calculation could overflow if (price0 / 10**30) * (price1 / 10**30) is more than 10**17
        return
            _price0.mul(_price1).mul(10**(s.priceDecimals[_token])).div(
                PRICE_PRECISION
            );
    }

    function getPrice(
        address _token,
        bool _maximise,
        bool _includeAmmPrice
    ) public view returns (uint256) {
        address _priceFeed = s.priceFeeds[_token];
        uint256 _priceSpreadBasisPoints = s.priceSpreadBasisPoints[_token];
        uint256 _price = 0;

        if (_priceFeed != address(0)) {
            _price = getPrimaryPrice(_token, _maximise);
        } else if (
            _includeAmmPrice &&
            s.baseTokenPairs[_token] != address(0) &&
            s.tokenPairs[_token] != address(0)
        ) {
            _price = getAmmPrice(_token, _price);
        }

        if (_price == 0) {
            return _price;
        }

        if (_maximise) {
            return
                _price
                    .mul(BASIS_POINTS_DIVISOR.add(_priceSpreadBasisPoints))
                    .div(BASIS_POINTS_DIVISOR);
        }

        return
            _price.mul(BASIS_POINTS_DIVISOR.sub(_priceSpreadBasisPoints)).div(
                BASIS_POINTS_DIVISOR
            );
    }
}
