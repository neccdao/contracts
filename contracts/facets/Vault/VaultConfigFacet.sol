// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./VaultLib.sol";
import "./Facet.sol";

// import "hardhat/console.sol";

contract VaultConfigFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event DirectPoolDeposit(address token, uint256 amount);
    event WithdrawFees(address _token, address _receiver, uint256 _amount);
    event SetTokenConfig(
        address _token,
        uint256 _tokenDecimals,
        uint256 _minProfitBasisPoints,
        address _priceFeed,
        uint256 _priceDecimals,
        uint256 _priceSpreadBasisPoints,
        uint256 _tokenWeight,
        address _baseTokenPair,
        address _tokenPair
    );
    event ClearTokenConfig(address _token);
    event SetRedemptionBasisPoints(address _token, uint256 _basisPoints);
    event SetPriceSpreadBasisPoints(
        address _token,
        uint256 _priceSpreadBasisPoints
    );

    function initialize(address _weth, address _ndol) external {
        onlyGov();
        require(!s.isInitialized, "Vault: already initialized");
        require(_weth != address(0), "Vault: invalid WETH address");
        require(_ndol != address(0), "Vault: invalid _ndol address");

        s.isInitialized = true;
        s.includeAmmPrice = true;

        s.weth = _weth;
        s.ndol = _ndol;
    }

    function isInitialized() public view returns (bool) {
        return s.isInitialized;
    }

    function setTokenConfig(
        address _token,
        uint256 _tokenDecimals,
        uint256 _minProfitBasisPoints,
        address _priceFeed,
        uint256 _priceDecimals,
        uint256 _priceSpreadBasisPoints,
        uint256 _tokenWeight,
        address _baseTokenPair,
        address _tokenPair
    ) external {
        onlyGov();
        EnumerableSet.add(s.tokens, _token);
        s.whitelistedTokens[_token] = true;
        s.tokenDecimals[_token] = _tokenDecimals;
        s.minProfitBasisPoints[_token] = _minProfitBasisPoints;
        s.priceFeeds[_token] = _priceFeed;
        s.priceDecimals[_token] = _priceDecimals;
        s.priceSpreadBasisPoints[_token] = _priceSpreadBasisPoints;

        if (s.tokenWeights[_token] == 0) {
            s.totalTokenWeight = s.totalTokenWeight.add(_tokenWeight);
        } else {
            s.totalTokenWeight = s.totalTokenWeight.sub(s.tokenWeights[_token]);
            s.totalTokenWeight = s.totalTokenWeight.add(_tokenWeight);
        }
        s.tokenWeights[_token] = _tokenWeight;
        s.redemptionBasisPoints[_token] = BASIS_POINTS_DIVISOR;

        if (_baseTokenPair != address(0)) {
            s.baseTokenPairs[_token] = _baseTokenPair;
            s.tokenPairs[_token] = _tokenPair;
        }

        // validate price feed
        VaultLib.getMaxPrice(_token, s.includeAmmPrice);
        emit SetTokenConfig(
            _token,
            _tokenDecimals,
            _minProfitBasisPoints,
            _priceFeed,
            _priceDecimals,
            _priceSpreadBasisPoints,
            _tokenWeight,
            _baseTokenPair,
            _tokenPair
        );
    }

    function setTokenWeight(address _token, uint256 _tokenWeight) external {
        onlyGov();
        if (s.tokenWeights[_token] == 0) {
            s.totalTokenWeight = s.totalTokenWeight.add(_tokenWeight);
        } else {
            s.totalTokenWeight = s.totalTokenWeight.sub(s.tokenWeights[_token]);
            s.totalTokenWeight = s.totalTokenWeight.add(_tokenWeight);
        }
        s.tokenWeights[_token] = _tokenWeight;
    }

    function clearTokenConfig(address _token) external {
        onlyGov();
        VaultLib.isTokenWhitelisted(s, _token);

        EnumerableSet.remove(s.tokens, _token);
        delete s.whitelistedTokens[_token];
        delete s.tokenDecimals[_token];
        delete s.redemptionBasisPoints[_token];
        delete s.minProfitBasisPoints[_token];
        delete s.priceFeeds[_token];
        delete s.priceDecimals[_token];
        delete s.priceSpreadBasisPoints[_token];

        if (s.tokenWeights[_token] != 0) {
            s.totalTokenWeight = s.totalTokenWeight.sub(s.tokenWeights[_token]);
            delete s.tokenWeights[_token];
        }

        delete s.redemptionBasisPoints[_token];
        delete s.baseTokenPairs[_token];
        delete s.tokenPairs[_token];

        emit ClearTokenConfig(_token);
    }

    function withdrawFees(address _token, address _receiver)
        external
        returns (uint256)
    {
        onlyGov();
        uint256 _amount = s.feeReserves[_token];
        if (_amount == 0) {
            return 0;
        }
        s.feeReserves[_token] = 0;
        VaultLib.transferOut(s, _token, _amount, _receiver);

        emit WithdrawFees(_token, _receiver, _amount);
        return _amount;
    }

    function directPoolDeposit(address _token) external {
        VaultLib.isTokenWhitelisted(s, _token);
        uint256 _tokenAmount = VaultLib.transferIn(s, _token);
        require(_tokenAmount > 0, "Vault: invalid _tokenAmount");
        VaultLib._increasePoolAmount(s, _token, _tokenAmount);

        emit DirectPoolDeposit(_token, _tokenAmount);
    }

    /**
        @notice
        Uses:
        - Balance out pool weights backing NDOL
        - NDOL is below peg so we set -ve interest rates
        - Give out free monies

        s.redemptionBasisPoints[_token] defaults to BASIS_POINTS_DIVISOR === 10000
        redemptionAmount.mul(
            _redemptionBasisPoints.div(BASIS_POINTS_DIVISOR)
        );
    */
    function setRedemptionBasisPoints(
        address _token,
        uint256 _redemptionBasisPoints
    ) external {
        onlyGov();
        s.redemptionBasisPoints[_token] = _redemptionBasisPoints;

        emit SetRedemptionBasisPoints(_token, _redemptionBasisPoints);
    }

    /**
        @notice
        Uses:
        - Tweak capital efficiency
        - Increase monies via fees

        s.priceSpreadBasisPoints[_token] defaults to 5
        if maximise price, 
            price.mul(
                BASIS_POINTS_DIVISOR.add(_priceSpreadBasisPoints)
            ).div(BASIS_POINTS_DIVISOR);
        else,
            price.mul(
                BASIS_POINTS_DIVISOR.sub(_priceSpreadBasisPoints)
            ).div(BASIS_POINTS_DIVISOR);
    */
    function setPriceSpreadBasisPoints(
        address _token,
        uint256 _priceSpreadBasisPoints
    ) external {
        require(
            _priceSpreadBasisPoints < BASIS_POINTS_DIVISOR,
            "Vault: price spread too large"
        );
        onlyGov();
        s.priceSpreadBasisPoints[_token] = _priceSpreadBasisPoints;

        emit SetPriceSpreadBasisPoints(_token, _priceSpreadBasisPoints);
    }

    function setGov(address _newGov) public {
        _setGov(_newGov);
    }

    function whitelistedTokenCount() public view returns (uint256) {
        return EnumerableSet.length(s.tokens);
    }

    function whitelistedTokens(address _token) public view returns (bool) {
        return EnumerableSet.contains(s.tokens, _token);
    }

    function gov() public view returns (address) {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        return ds.contractOwner;
    }

    function tokenDecimals(address _token) public view returns (uint256) {
        return s.tokenDecimals[_token];
    }

    function tokenWeights(address _token) public view returns (uint256) {
        return s.tokenWeights[_token];
    }

    function totalTokenWeight() public view returns (uint256) {
        return s.totalTokenWeight;
    }

    function minProfitBasisPoints(address _token)
        public
        view
        returns (uint256)
    {
        return s.minProfitBasisPoints[_token];
    }

    function redemptionBasisPoints(address _token)
        public
        view
        returns (uint256)
    {
        return s.redemptionBasisPoints[_token];
    }
}
