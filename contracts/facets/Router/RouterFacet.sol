// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../Vault/VaultLib.sol";
import "./RouterLib.sol";
import "../Vault/Facet.sol";

contract RouterFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event Swap(
        address account,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    receive() external payable {
        require(msg.sender == s.weth, "Router: invalid sender");
    }

    function _sender() private view returns (address) {
        return msg.sender;
    }

    function directPoolDeposit(address _token, uint256 _amount) external {
        IERC20(_token).safeTransferFrom(_sender(), address(this), _amount);
        IVault(address(this)).directPoolDeposit(_token);
    }

    function swap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        address _receiver
    ) external {
        IERC20(_path[0]).safeTransferFrom(_sender(), address(this), _amountIn);
        uint256 _amountOut = RouterLib._swap(s, _path, _minOut, _receiver);

        emit Swap(
            msg.sender,
            _path[0],
            _path[_path.length - 1],
            _amountIn,
            _amountOut
        );
    }

    function swapETHToTokens(
        address[] memory _path,
        uint256 _minOut,
        address _receiver
    ) external payable {
        require(_path[0] == s.weth, "Router: weth not first in _path");
        RouterLib._transferETHToVault(s);
        uint256 amountOut = RouterLib._swap(s, _path, _minOut, _receiver);

        emit Swap(
            msg.sender,
            _path[0],
            _path[_path.length - 1],
            msg.value,
            amountOut
        );
    }

    function swapTokensToETH(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        address payable _receiver
    ) external {
        require(_path[_path.length - 1] == s.weth, "Router: invalid _path");
        IERC20(_path[0]).safeTransferFrom(_sender(), address(this), _amountIn);
        uint256 amountOut = RouterLib._swap(s, _path, _minOut, address(this));
        RouterLib._transferOutETH(s, amountOut, _receiver);

        emit Swap(
            msg.sender,
            _path[0],
            _path[_path.length - 1],
            _amountIn,
            amountOut
        );
    }

    function increasePosition(
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) external {
        if (_amountIn > 0) {
            IERC20(_path[0]).safeTransferFrom(
                _sender(),
                address(this),
                _amountIn
            );
        }
        if (_path.length > 1 && _amountIn > 0) {
            uint256 _amountOut = RouterLib._swap(
                s,
                _path,
                _minOut,
                address(this)
            );
            IERC20(_path[_path.length - 1]).safeTransfer(
                address(this),
                _amountOut
            );
        }
        RouterLib._increasePosition(
            s,
            _path[_path.length - 1],
            _indexToken,
            _sizeDelta,
            _isLong,
            _price
        );
    }

    function increasePositionETH(
        address[] memory _path,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) external payable {
        require(_path[0] == s.weth, "Router: invalid _path");
        if (msg.value > 0) {
            RouterLib._transferETHToVault(s);
        }
        if (_path.length > 1 && msg.value > 0) {
            uint256 _amountOut = RouterLib._swap(
                s,
                _path,
                _minOut,
                address(this)
            );
            IERC20(_path[_path.length - 1]).safeTransfer(
                address(this),
                _amountOut
            );
        }

        RouterLib._increasePosition(
            s,
            _path[_path.length - 1],
            _indexToken,
            _sizeDelta,
            _isLong,
            _price
        );
    }

    function decreasePosition(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price
    ) external {
        RouterLib._decreasePosition(
            s,
            _collateralToken,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            _receiver,
            _price
        );
    }

    function decreasePositionETH(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price
    ) external {
        uint256 _amountOut = RouterLib._decreasePosition(
            s,
            _collateralToken,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            address(this),
            _price
        );

        RouterLib._transferOutETH(s, _amountOut, _receiver);
    }
}
