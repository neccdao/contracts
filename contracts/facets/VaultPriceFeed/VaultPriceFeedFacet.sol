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

    function getPrice(
        address _token,
        bool _maximise,
        bool
    ) public view returns (uint256) {
        address _priceFeed = s.priceFeeds[_token];
        uint256 _price = 0;

        if (_priceFeed != address(0)) {
            _price = getPrimaryPrice(_token, _maximise);
        }

        return _price;
    }
}
