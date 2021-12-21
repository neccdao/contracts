// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface IVault {
    function getRedemptionCollateralUsd(address _token)
        external
        view
        returns (uint256);

    function setIsMintingEnabled(bool _isMintingEnabled) external;

    function setFees(
        uint256 _swapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd
    ) external;

    function setPriceFeed(address _priceFeed) external;

    function setMaxNDOL(uint256 _maxNDOLBatchSize, uint256 _maxNDOLBuffer)
        external;

    function directPoolDeposit(address _token) external;

    function buyNDOL(address _token, address _receiver)
        external
        returns (uint256);

    function sellNDOL(address _token, address _receiver)
        external
        returns (uint256);

    function swap(
        address _tokenIn,
        address _tokenOut,
        address _receiver
    ) external returns (uint256);

    function increasePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        uint256 _sizeDelta,
        bool _isLong
    ) external;

    function decreasePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver
    ) external returns (uint256);

    function priceFeed() external view returns (address);

    function fundingRateFactor() external view returns (uint256);

    function cumulativeFundingRates(address _token)
        external
        view
        returns (uint256);

    function getNextFundingRate(address _token) external view returns (uint256);

    function BASIS_POINTS_DIVISOR() external view returns (uint256);

    function swapFeeBasisPoints() external view returns (uint256);

    function feeReserves(address _token) external view returns (uint256);

    function tokenDecimals(address _token) external view returns (uint256);

    function guaranteedUsd(address _token) external view returns (uint256);

    function poolAmounts(address _token) external view returns (uint256);

    function reservedAmounts(address _token) external view returns (uint256);

    function ndolAmounts(address _token) external view returns (uint256);

    function getRedemptionAmount(address _token, uint256 _ndolAmount)
        external
        view
        returns (uint256);

    function getMaxPrice(address _token) external view returns (uint256);

    function getMinPrice(address _token) external view returns (uint256);

    function getUtilisation(address _token) external view returns (uint256);

    function getDelta(
        address _indexToken,
        uint256 _size,
        uint256 _averagePrice,
        bool _isLong,
        uint256 _lastIncreasedTime
    ) external view returns (bool, uint256);

    function getPosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong
    )
        external
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
        );

    function adjustForDecimals(
        uint256 _amount,
        address _tokenDiv,
        address _tokenMul
    ) external view returns (uint256);

    function withdrawFees(address _token, address _receiver)
        external
        returns (uint256);
}
