// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../interfaces/IVault.sol";
import "../interfaces/IVaultPriceFeed.sol";
import "../../amm/interfaces/IUniswapV2Factory.sol";
import "../Vault/VaultLib.sol";
import "../Vault/Facet.sol";

contract ReaderFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    function getMaxAmountIn(
        IVault,
        address _tokenIn,
        address _tokenOut
    ) public view returns (uint256) {
        uint256 priceIn = VaultLib.getMinPrice(_tokenIn, s.includeAmmPrice);
        uint256 priceOut = VaultLib.getMaxPrice(_tokenOut, s.includeAmmPrice);
        uint256 poolAmount = s.poolAmounts[_tokenOut];
        uint256 reservedAmount = s.reservedAmounts[_tokenOut];
        uint256 availableAmount = poolAmount.sub(reservedAmount);
        uint256 _amountIn = availableAmount.mul(priceOut).div(priceIn);

        return VaultLib.adjustForDecimals(s, _amountIn, _tokenOut, _tokenIn);
    }

    function getAmountOut(
        IVault,
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn
    ) public view returns (uint256, uint256) {
        uint256 priceIn = VaultLib.getMinPrice(_tokenIn, s.includeAmmPrice);
        uint256 priceOut = VaultLib.getMaxPrice(_tokenOut, s.includeAmmPrice);
        uint256 amountOut = _amountIn.mul(priceIn).div(priceOut);
        uint256 amountOutAfterFees = amountOut
            .mul(BASIS_POINTS_DIVISOR.sub(SWAP_FEE_BASIS_POINTS))
            .div(BASIS_POINTS_DIVISOR);
        uint256 feeAmount = amountOut.sub(amountOutAfterFees);

        return (amountOutAfterFees, feeAmount);
    }

    function getFees(address, address[] memory _tokens)
        public
        view
        returns (uint256[] memory)
    {
        uint256[] memory amounts = new uint256[](_tokens.length);

        for (uint256 i = 0; i < _tokens.length; i++) {
            amounts[i] = s.feeReserves[_tokens[i]];
        }

        return amounts;
    }

    // TODO: getTotalContributedCollateral()

    function getPairInfo(address _factory, address[] memory _tokens)
        public
        view
        returns (uint256[] memory)
    {
        uint256 inputLength = 2;
        uint256 propsLength = 2;
        uint256[] memory amounts = new uint256[](
            (_tokens.length / inputLength) * propsLength
        );

        for (uint256 i = 0; i < _tokens.length / inputLength; i++) {
            address token0 = _tokens[i * inputLength];
            address token1 = _tokens[i * inputLength + 1];
            address pair = IUniswapV2Factory(_factory).getPair(token0, token1);

            amounts[i * propsLength] = IERC20(token0).balanceOf(pair);
            amounts[i * propsLength + 1] = IERC20(token1).balanceOf(pair);
        }

        return amounts;
    }

    function getFundingRates(
        address,
        address _weth,
        address[] memory _tokens
    ) public view returns (uint256[] memory) {
        uint256 propsLength = 2;
        uint256[] memory fundingRates = new uint256[](
            _tokens.length * propsLength
        );

        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }

            uint256 reservedAmount = s.reservedAmounts[token];
            uint256 poolAmount = s.poolAmounts[token];

            if (poolAmount > 0) {
                fundingRates[i * propsLength] = FUNDING_RATE_FACTOR
                    .mul(reservedAmount)
                    .div(poolAmount);
            }

            if (s.cumulativeFundingRates[token] > 0) {
                uint256 nextRate = VaultLib._getNextFundingRate(s, token);
                uint256 baseRate = s.cumulativeFundingRates[token];
                fundingRates[i * propsLength + 1] = baseRate.add(nextRate);
            }
        }

        return fundingRates;
    }

    function getTokenSupply(IERC20 _token, address[] memory _excludedAccounts)
        public
        view
        returns (uint256)
    {
        uint256 supply = _token.totalSupply();
        for (uint256 i = 0; i < _excludedAccounts.length; i++) {
            address account = _excludedAccounts[i];
            uint256 balance = _token.balanceOf(account);
            supply = supply.sub(balance);
        }

        return supply;
    }

    function getTokenBalances(address _account, address[] memory _tokens)
        public
        view
        returns (uint256[] memory)
    {
        uint256[] memory balances = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                balances[i] = _account.balance;
                continue;
            }
            balances[i] = IERC20(token).balanceOf(_account);
        }
        return balances;
    }

    function getTokenBalancesWithSupplies(
        address _account,
        address[] memory _tokens
    ) public view returns (uint256[] memory) {
        uint256 propsLength = 2;
        uint256[] memory balances = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                balances[i * propsLength] = _account.balance;
                balances[i * propsLength + 1] = 0;
                continue;
            }
            balances[i * propsLength] = IERC20(token).balanceOf(_account);
            balances[i * propsLength + 1] = IERC20(token).totalSupply();
        }
        return balances;
    }

    function getVaultTokenInfo(
        address,
        address _weth,
        uint256 _ndolAmount,
        address[] memory _tokens
    ) public view returns (uint256[] memory) {
        uint256 propsLength = 9;

        IVault vault = IVault(address(this));
        IVaultPriceFeed priceFeed = IVaultPriceFeed(address(this));

        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }
            if (token != s.ndol) {
                amounts[i * propsLength] = s.poolAmounts[token];
                amounts[i * propsLength + 1] = s.reservedAmounts[token];
                amounts[i * propsLength + 2] = s.ndolAmounts[token];
                amounts[i * propsLength + 3] = vault.getRedemptionAmount(
                    token,
                    _ndolAmount
                );
                amounts[i * propsLength + 4] = VaultLib.getMinPrice(
                    token,
                    s.includeAmmPrice
                );
                amounts[i * propsLength + 5] = VaultLib.getMaxPrice(
                    token,
                    s.includeAmmPrice
                );
                amounts[i * propsLength + 6] = s.guaranteedUsd[token];
                amounts[i * propsLength + 7] = priceFeed.getPrice(
                    token,
                    false,
                    false
                );
                amounts[i * propsLength + 8] = priceFeed.getPrice(
                    token,
                    true,
                    false
                );
            }
        }

        return amounts;
    }

    function getPositions(
        address,
        address _account,
        address[] memory _collateralTokens,
        address[] memory _indexTokens,
        bool[] memory _isLong
    ) public view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](
            _collateralTokens.length * POSITION_PROPS_LENGTH
        );

        for (uint256 i = 0; i < _collateralTokens.length; i++) {
            {
                (
                    uint256 size,
                    uint256 collateral,
                    uint256 averagePrice,
                    uint256 entryFundingRate,
                    ,
                    /* reserveAmount */
                    uint256 realisedPnl,
                    bool hasRealisedProfit,
                    uint256 lastIncreasedTime
                ) = IVault(address(this)).getPosition(
                        _account,
                        _collateralTokens[i],
                        _indexTokens[i],
                        _isLong[i]
                    );

                amounts[i * POSITION_PROPS_LENGTH] = size;
                amounts[i * POSITION_PROPS_LENGTH + 1] = collateral;
                amounts[i * POSITION_PROPS_LENGTH + 2] = averagePrice;
                amounts[i * POSITION_PROPS_LENGTH + 3] = entryFundingRate;
                amounts[i * POSITION_PROPS_LENGTH + 4] = hasRealisedProfit
                    ? 1
                    : 0;
                amounts[i * POSITION_PROPS_LENGTH + 5] = realisedPnl;
                amounts[i * POSITION_PROPS_LENGTH + 6] = lastIncreasedTime;
            }

            uint256 _size = amounts[i * POSITION_PROPS_LENGTH];
            uint256 _averagePrice = amounts[i * POSITION_PROPS_LENGTH + 2];
            uint256 _lastIncreasedTime = amounts[i * POSITION_PROPS_LENGTH + 6];
            if (_averagePrice > 0) {
                (bool hasProfit, uint256 delta) = IVault(address(this))
                    .getDelta(
                        _indexTokens[i],
                        _size,
                        _averagePrice,
                        _isLong[i],
                        _lastIncreasedTime
                    );
                amounts[i * POSITION_PROPS_LENGTH + 7] = hasProfit ? 1 : 0;
                amounts[i * POSITION_PROPS_LENGTH + 8] = delta;
            }
        }

        return amounts;
    }
}
