// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/Address.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Facet.sol";
import "../../lib/FixedPoint.sol";
import "../../amm/interfaces/IUniswapV2Pair.sol";
import "../../amm/interfaces/IUniswapV2ERC20.sol";

interface IERC20Metadata is IERC20 {
    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function decimals() external view returns (uint8);
}

library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");

        return c;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return sub(a, b, "SafeMath: subtraction overflow");
    }

    function sub(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        uint256 c = a - b;

        return c;
    }

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }

        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");

        return c;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return div(a, b, "SafeMath: division by zero");
    }

    function div(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
        require(b > 0, errorMessage);
        uint256 c = a / b;
        // assert(a == b * c + a % b); // There is no case in which this doesn't hold

        return c;
    }

    function sqrrt(uint256 a) internal pure returns (uint256 c) {
        if (a > 3) {
            c = a;
            uint256 b = add(div(a, 2), 1);
            while (b < c) {
                c = b;
                b = div(add(div(a, b), b), 2);
            }
        } else if (a != 0) {
            c = 1;
        }
    }
}

contract BondingCalculatorFacet is Facet {
    using FixedPoint for *;
    using SafeMath for uint256;
    using SafeMath for uint112;

    function getKValue(address _pair) public view returns (uint256 k_) {
        uint256 token0 = IERC20Metadata(IUniswapV2Pair(_pair).token0())
            .decimals();
        uint256 token1 = IERC20Metadata(IUniswapV2Pair(_pair).token1())
            .decimals();
        uint256 decimals = token0.add(token1).sub(
            IERC20Metadata(_pair).decimals()
        );

        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(_pair)
            .getReserves();
        k_ = reserve0.mul(reserve1).div(10**decimals);
    }

    function getTotalValue(address _pair) public view returns (uint256 _value) {
        _value = getKValue(_pair).sqrrt().mul(2);
    }

    function valuation(address _pair, uint256 amount_)
        external
        view
        returns (uint256 _value)
    {
        uint256 totalValue = getTotalValue(_pair);
        uint256 totalSupply = IUniswapV2Pair(_pair).totalSupply();

        _value = totalValue
            .mul(FixedPoint.fraction(amount_, totalSupply).decode112with18())
            .div(1e18);
    }

    function markdown(address _pair) external view returns (uint256) {
        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(_pair)
            .getReserves();
        uint256 reserve;

        if (
            IUniswapV2Pair(_pair).token0() == address(s.Necc) ||
            IUniswapV2Pair(_pair).token1() == address(s.Necc)
        ) {
            if (IUniswapV2Pair(_pair).token0() == address(s.Necc)) {
                reserve = reserve1;
            } else {
                require(
                    IUniswapV2Pair(_pair).token1() == address(s.Necc),
                    "Invalid pair"
                );
                reserve = reserve0;
            }
            return
                reserve
                    .mul(2 * (10**IERC20Metadata(address(s.Necc)).decimals()))
                    .div(getTotalValue(_pair));
        } else {
            if (IUniswapV2Pair(_pair).token0() == address(s.nNecc)) {
                reserve = reserve1;
            } else {
                require(
                    IUniswapV2Pair(_pair).token1() == address(s.nNecc),
                    "Invalid pair"
                );
                reserve = reserve0;
            }
            return
                reserve
                    .mul(2 * (10**IERC20Metadata(address(s.nNecc)).decimals()))
                    .div(getTotalValue(_pair))
                    .div(1e9);
        }
    }
}
