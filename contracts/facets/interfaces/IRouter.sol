// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface IRouter {
    function addPlugin(address _plugin) external;

    function ndol() external view returns (address);

    function swap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        address _receiver
    ) external;

    function vault() external view returns (address);
}
