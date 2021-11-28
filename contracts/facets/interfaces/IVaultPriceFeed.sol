// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface IVaultPriceFeed {
    function setIsAmmEnabled(bool _isEnabled) external;

    function setFavorPrimaryPrice(bool _favorPrimaryPrice) external;

    function setIsSecondaryPriceEnabled(bool _isEnabled) external;

    function setSpreadBasisPoints(address _token, uint256 _spreadBasisPoints)
        external;

    function setSpreadThresholdBasisPoints(uint256 _spreadThresholdBasisPoints)
        external;

    function setPriceSampleSpace(uint256 _priceSampleSpace) external;

    function setMaxStrictPriceDeviation(uint256 _maxStrictPriceDeviation)
        external;

    function getPrice(
        address _token,
        bool _maximise,
        bool _includeAmmPrice
    ) external view returns (uint256);

    function getAmmPrice(address _token) external view returns (uint256);
}
