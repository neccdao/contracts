// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../tokens/interfaces/IWETH.sol";
import "../interfaces/IVaultPriceFeed.sol";
import "../interfaces/IVault.sol";
import "../Vault/VaultLib.sol";

library RouterLib {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using RouterLib for LibExchangeStorage.Storage;

    function _transferETHToVault(LibExchangeStorage.Storage storage s)
        internal
    {
        IWETH(s.weth).deposit{value: msg.value}();
        IERC20(s.weth).safeTransfer(address(this), msg.value);
    }

    function _transferOutETH(
        LibExchangeStorage.Storage storage s,
        uint256 _amountOut,
        address payable _receiver
    ) internal {
        IWETH(s.weth).withdraw(_amountOut);

        _sendValue(s, _receiver, _amountOut);
    }

    function _sendValue(
        LibExchangeStorage.Storage storage,
        address payable _recipient,
        uint256 amount
    ) internal {
        require(
            address(this).balance >= amount,
            "Address: insufficient balance"
        );

        // solhint-disable-next-line avoid-low-level-calls, avoid-call-value
        (bool success, ) = _recipient.call{value: amount}("");
        require(
            success,
            "Address: unable to send value, _crecipient may have reverted"
        );
    }

    function _swap(
        LibExchangeStorage.Storage storage s,
        address[] memory _path,
        uint256 _minOut,
        address _receiver
    ) internal returns (uint256) {
        if (_path.length == 2) {
            return s._vaultSwap(_path[0], _path[1], _minOut, _receiver);
        }

        revert("Router: invalid _path.length");
    }

    function _vaultSwap(
        LibExchangeStorage.Storage storage s,
        address _tokenIn,
        address _tokenOut,
        uint256 _minOut,
        address _receiver
    )
        internal
        returns (
            // uint256 _amountIn
            uint256
        )
    {
        uint256 _amountOut;

        if (_tokenOut == s.ndol) {
            // buyNDOL
            _amountOut = IVault(address(this)).buyNDOL(_tokenIn, _receiver);
        } else if (_tokenIn == s.ndol) {
            // sellNDOL
            _amountOut = IVault(address(this)).sellNDOL(_tokenOut, _receiver);
        } else {
            // swap
            _amountOut = IVault(address(this)).swap(
                _tokenIn,
                _tokenOut,
                _receiver
            );
        }

        require(_amountOut >= _minOut, "Router: insufficient amountOut");

        return _amountOut;
    }

    function _sender() private view returns (address) {
        return msg.sender;
    }

    function _increasePosition(
        LibExchangeStorage.Storage storage s,
        address _collateralToken,
        address _indexToken,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) internal {
        if (_isLong) {
            require(
                VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice) <= _price,
                "Router: mark price higher than limit"
            );
        } else {
            require(
                VaultLib.getMinPrice(_indexToken, s.includeAmmPrice) >= _price,
                "Router: mark price lower than limit"
            );
        }

        IVault(address(this)).increasePosition(
            _sender(),
            _collateralToken,
            _indexToken,
            _sizeDelta,
            _isLong
        );
    }

    function _decreasePosition(
        LibExchangeStorage.Storage storage s,
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price
    ) internal returns (uint256) {
        if (_isLong) {
            require(
                VaultLib.getMinPrice(_indexToken, s.includeAmmPrice) >= _price,
                "Router: mark price lower than limit"
            );
        } else {
            require(
                VaultLib.getMaxPrice(_indexToken, s.includeAmmPrice) <= _price,
                "Router: mark price higher than limit"
            );
        }

        uint256 _amountOut = IVault(address(this)).decreasePosition(
            _sender(),
            _collateralToken,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            _receiver
        );

        return _amountOut;
    }
}
