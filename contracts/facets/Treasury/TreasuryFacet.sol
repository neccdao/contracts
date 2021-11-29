// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./Facet.sol";

interface IBondCalculator {
    function valuation(address pair_, uint256 amount_)
        external
        view
        returns (uint256 _value);
}

interface IERC20Mintable {
    function decimals() external view returns (uint256);

    function mint(uint256 amount_) external;

    function mint(address account_, uint256 ammount_) external;

    function burnFrom(address account_, uint256 amount_) external;
}

contract TreasuryFacet is Facet {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event Deposit(address indexed token, uint256 amount, uint256 value);
    event Withdrawal(address indexed token, uint256 amount, uint256 value);
    event CreateDebt(
        address indexed debtor,
        address indexed token,
        uint256 amount,
        uint256 value
    );
    event RepayDebt(
        address indexed debtor,
        address indexed token,
        uint256 amount,
        uint256 value
    );
    event ReservesManaged(address indexed token, uint256 amount);
    event ReservesUpdated(uint256 indexed totalReserves);
    event ReservesAudited(uint256 indexed totalReserves);
    event RewardsMinted(
        address indexed caller,
        address indexed recipient,
        uint256 amount
    );
    event ChangeQueued(MANAGING indexed managing, address queued);
    event ChangeActivated(
        MANAGING indexed managing,
        address activated,
        bool result
    );

    enum MANAGING {
        RESERVEDEPOSITOR,
        RESERVESPENDER,
        RESERVETOKEN,
        RESERVEMANAGER,
        LIQUIDITYDEPOSITOR,
        LIQUIDITYTOKEN,
        LIQUIDITYMANAGER,
        DEBTOR,
        REWARDMANAGER,
        NNECC
    }

    function initializeTreasury(
        address _Necc,
        address _NDOL,
        uint256 _blocksNeededForQueue
    ) external {
        onlyGov();
        require(_Necc != address(0));
        s.Necc = _Necc;

        s.isReserveToken[_NDOL] = true;
        s.reserveTokens.push(_NDOL);

        s.blocksNeededForQueue = _blocksNeededForQueue;
    }

    /**
        @notice send epoch reward to staking contract
     */
    function mintRewards(address _recipient, uint256 _amount) external {
        require(s.isRewardManager[msg.sender], "Treasury: Not approved");
        require(_amount <= excessReserves(), "Treasury: Insufficient reserves");

        IERC20Mintable(s.Necc).mint(_recipient, _amount);

        emit RewardsMinted(msg.sender, _recipient, _amount);
    }

    /**
        @notice allow approved address to deposit an asset for Necc
        @param _amount uint
        @param _token address
        @param _profit uint
        @return send_ uint
     */
    function deposit(
        uint256 _amount,
        address _token,
        uint256 _profit
    ) external returns (uint256 send_) {
        require(
            s.isReserveToken[_token] || s.isLiquidityToken[_token],
            "Treasury: Not accepted"
        );
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        if (s.isReserveToken[_token]) {
            require(s.isReserveDepositor[msg.sender], "Treasury: Not approved");
        } else {
            require(
                s.isLiquidityDepositor[msg.sender],
                "Treasury: Not approved"
            );
        }

        uint256 value = valueOfToken(_token, _amount);
        // mint Necc needed and store amount of rewards for distribution
        send_ = value.sub(_profit);
        IERC20Mintable(s.Necc).mint(msg.sender, send_);

        s.totalReserves = s.totalReserves.add(value);
        emit ReservesUpdated(s.totalReserves);

        emit Deposit(_token, _amount, value);

        return send_;
    }

    /**
        @notice allow approved address to burn Necc for reserves
        @param _amount uint
        @param _token address
     */
    function withdraw(uint256 _amount, address _token) external {
        require(s.isReserveToken[_token], "Treasury: Not accepted"); // Only reserves can be used for redemptions
        require(
            s.isReserveSpender[msg.sender] == true,
            "Treasury: Not approved"
        );

        uint256 _value = valueOfToken(_token, _amount);
        IERC20Mintable(s.Necc).burnFrom(msg.sender, _value);

        s.totalReserves = s.totalReserves.sub(_value);
        emit ReservesUpdated(s.totalReserves);

        IERC20(_token).safeTransfer(msg.sender, _amount);

        emit Withdrawal(_token, _amount, _value);
    }

    /**
        @notice allow approved address to borrow reserves
        @param _amount uint
        @param _token address
     */
    function incurDebt(uint256 _amount, address _token) external {
        require(s.isDebtor[msg.sender], "Treasury: Not approved");
        require(s.isReserveToken[_token], "Treasury: Not accepted");

        uint256 _value = valueOfToken(_token, _amount);

        uint256 maximumDebt = IERC20(s.sNecc).balanceOf(msg.sender); // Can only borrow against sNecc held
        uint256 availableDebt = maximumDebt.sub(s.debtorBalance[msg.sender]);
        require(_value <= availableDebt, "Exceeds debt limit");

        s.debtorBalance[msg.sender] = s.debtorBalance[msg.sender].add(_value);
        s.totalDebt = s.totalDebt.add(_value);

        s.totalReserves = s.totalReserves.sub(_value);
        emit ReservesUpdated(s.totalReserves);

        IERC20(_token).transfer(msg.sender, _amount);

        emit CreateDebt(msg.sender, _token, _amount, _value);
    }

    /**
        @notice allow approved address to repay borrowed reserves with reserves
        @param _amount uint
        @param _token address
     */
    function repayDebtWithReserve(uint256 _amount, address _token) external {
        require(s.isDebtor[msg.sender], "Treasury: Not approved");
        require(s.isReserveToken[_token], "Treasury: Not accepted");

        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        uint256 _value = valueOfToken(_token, _amount);
        s.debtorBalance[msg.sender] = s.debtorBalance[msg.sender].sub(_value);
        s.totalDebt = s.totalDebt.sub(_value);

        s.totalReserves = s.totalReserves.add(_value);
        emit ReservesUpdated(s.totalReserves);

        emit RepayDebt(msg.sender, _token, _amount, _value);
    }

    /**
        @notice allow approved address to repay borrowed reserves with Necc
        @param _amount uint
     */
    function repayDebtWithNecc(uint256 _amount) external {
        require(s.isDebtor[msg.sender], "Treasury: Not approved");

        IERC20Mintable(s.Necc).burnFrom(msg.sender, _amount);

        s.debtorBalance[msg.sender] = s.debtorBalance[msg.sender].sub(_amount);
        s.totalDebt = s.totalDebt.sub(_amount);

        emit RepayDebt(msg.sender, s.Necc, _amount, _amount);
    }

    /**
        @notice allow approved address to withdraw assets
        @param _token address
        @param _amount uint
     */
    function manage(address _token, uint256 _amount) external {
        if (s.isLiquidityToken[_token]) {
            require(s.isLiquidityManager[msg.sender], "Treasury: Not approved");
        } else {
            require(s.isReserveManager[msg.sender], "Treasury: Not approved");
        }

        uint256 _value = valueOfToken(_token, _amount);
        (_token, _amount);
        require(_value <= excessReserves(), "Treasury: Insufficient reserves");

        s.totalReserves = s.totalReserves.sub(_value);
        emit ReservesUpdated(s.totalReserves);

        IERC20(_token).safeTransfer(msg.sender, _amount);

        emit ReservesManaged(_token, _amount);
    }

    /**
        @notice returns excess reserves not backing tokens
        @return uint
     */
    function excessReserves() public view returns (uint256) {
        return
            s.totalReserves.sub(IERC20(s.Necc).totalSupply().sub(s.totalDebt));
    }

    /**
        @notice takes inventory of all tracked assets
        @notice always consolidate to recognized reserves before audit
     */
    function auditReserves() external {
        onlyGov();
        uint256 reserves;
        for (uint256 i = 0; i < s.reserveTokens.length; i++) {
            reserves = reserves.add(
                valueOfToken(
                    s.reserveTokens[i],
                    IERC20(s.reserveTokens[i]).balanceOf(address(this))
                )
            );
        }
        for (uint256 i = 0; i < s.liquidityTokens.length; i++) {
            reserves = reserves.add(
                valueOfToken(
                    s.liquidityTokens[i],
                    IERC20(s.liquidityTokens[i]).balanceOf(address(this))
                )
            );
        }
        s.totalReserves = reserves;
        emit ReservesUpdated(reserves);
        emit ReservesAudited(reserves);
    }

    /**
        @notice returns Necc valuation of asset
        @param _token address
        @param _amount uint
        @return _value uint
     */
    function valueOfToken(address _token, uint256 _amount)
        public
        view
        returns (uint256 _value)
    {
        if (s.isReserveToken[_token]) {
            // convert amount to match Necc decimals
            _value = _amount.mul(10**IERC20Mintable(s.Necc).decimals()).div(
                10**IERC20Mintable(_token).decimals()
            );
        } else if (s.isLiquidityToken[_token]) {
            _value = IBondCalculator(address(this)).valuation(_token, _amount);
        }
    }

    /**
        @notice queue address to change boolean in mapping
        @param _managing MANAGING
        @param _address address
        @return bool
     */
    function queue(MANAGING _managing, address _address)
        external
        returns (bool)
    {
        onlyGov();
        require(_address != address(0));
        if (_managing == MANAGING.RESERVEDEPOSITOR) {
            // 0
            s.reserveDepositorQueue[_address] = block.number.add(
                s.blocksNeededForQueue
            );
        } else if (_managing == MANAGING.RESERVESPENDER) {
            // 1
            s.reserveSpenderQueue[_address] = block.number.add(
                s.blocksNeededForQueue
            );
        } else if (_managing == MANAGING.RESERVETOKEN) {
            // 2
            s.reserveTokenQueue[_address] = block.number.add(
                s.blocksNeededForQueue
            );
        } else if (_managing == MANAGING.RESERVEMANAGER) {
            // 3
            s.ReserveManagerQueue[_address] = block.number.add(
                s.blocksNeededForQueue.mul(2)
            );
        } else if (_managing == MANAGING.LIQUIDITYDEPOSITOR) {
            // 4
            s.LiquidityDepositorQueue[_address] = block.number.add(
                s.blocksNeededForQueue
            );
        } else if (_managing == MANAGING.LIQUIDITYTOKEN) {
            // 5
            s.LiquidityTokenQueue[_address] = block.number.add(
                s.blocksNeededForQueue
            );
        } else if (_managing == MANAGING.LIQUIDITYMANAGER) {
            // 6
            s.LiquidityManagerQueue[_address] = block.number.add(
                s.blocksNeededForQueue.mul(2)
            );
        } else if (_managing == MANAGING.DEBTOR) {
            // 7
            s.debtorQueue[_address] = block.number.add(s.blocksNeededForQueue);
        } else if (_managing == MANAGING.REWARDMANAGER) {
            // 8
            s.rewardManagerQueue[_address] = block.number.add(
                s.blocksNeededForQueue
            );
        } else if (_managing == MANAGING.NNECC) {
            // 9
            s.sNeccQueue = block.number.add(s.blocksNeededForQueue);
        } else return false;

        emit ChangeQueued(_managing, _address);
        return true;
    }

    /**
        @notice verify queue then set boolean in mapping
        @param _managing MANAGING
        @param _address address
        @return bool
     */
    function toggle(MANAGING _managing, address _address)
        external
        returns (bool)
    {
        onlyGov();
        require(_address != address(0));
        bool _result;
        if (_managing == MANAGING.RESERVEDEPOSITOR) {
            // 0
            if (
                requirements(
                    s.reserveDepositorQueue,
                    s.isReserveDepositor,
                    _address
                )
            ) {
                s.reserveDepositorQueue[_address] = 0;
                if (!listContains(s.reserveDepositors, _address)) {
                    s.reserveDepositors.push(_address);
                }
            }
            _result = !s.isReserveDepositor[_address];
            s.isReserveDepositor[_address] = _result;
        } else if (_managing == MANAGING.RESERVESPENDER) {
            // 1
            if (
                requirements(
                    s.reserveSpenderQueue,
                    s.isReserveSpender,
                    _address
                )
            ) {
                s.reserveSpenderQueue[_address] = 0;
                if (!listContains(s.reserveSpenders, _address)) {
                    s.reserveSpenders.push(_address);
                }
            }
            _result = !s.isReserveSpender[_address];
            s.isReserveSpender[_address] = _result;
        } else if (_managing == MANAGING.RESERVETOKEN) {
            // 2
            if (requirements(s.reserveTokenQueue, s.isReserveToken, _address)) {
                s.reserveTokenQueue[_address] = 0;
                if (!listContains(s.reserveTokens, _address)) {
                    s.reserveTokens.push(_address);
                }
            }
            _result = !s.isReserveToken[_address];
            s.isReserveToken[_address] = _result;
        } else if (_managing == MANAGING.RESERVEMANAGER) {
            // 3
            if (
                requirements(
                    s.ReserveManagerQueue,
                    s.isReserveManager,
                    _address
                )
            ) {
                s.reserveManagers.push(_address);
                s.ReserveManagerQueue[_address] = 0;
                if (!listContains(s.reserveManagers, _address)) {
                    s.reserveManagers.push(_address);
                }
            }
            _result = !s.isReserveManager[_address];
            s.isReserveManager[_address] = _result;
        } else if (_managing == MANAGING.LIQUIDITYDEPOSITOR) {
            // 4
            if (
                requirements(
                    s.LiquidityDepositorQueue,
                    s.isLiquidityDepositor,
                    _address
                )
            ) {
                s.liquidityDepositors.push(_address);
                s.LiquidityDepositorQueue[_address] = 0;
                if (!listContains(s.liquidityDepositors, _address)) {
                    s.liquidityDepositors.push(_address);
                }
            }
            _result = !s.isLiquidityDepositor[_address];
            s.isLiquidityDepositor[_address] = _result;
        } else if (_managing == MANAGING.LIQUIDITYTOKEN) {
            // 5
            if (
                requirements(
                    s.LiquidityTokenQueue,
                    s.isLiquidityToken,
                    _address
                )
            ) {
                s.LiquidityTokenQueue[_address] = 0;
                if (!listContains(s.liquidityTokens, _address)) {
                    s.liquidityTokens.push(_address);
                }
            }
            _result = !s.isLiquidityToken[_address];
            s.isLiquidityToken[_address] = _result;
        } else if (_managing == MANAGING.LIQUIDITYMANAGER) {
            // 6
            if (
                requirements(
                    s.LiquidityManagerQueue,
                    s.isLiquidityManager,
                    _address
                )
            ) {
                s.LiquidityManagerQueue[_address] = 0;
                if (!listContains(s.liquidityManagers, _address)) {
                    s.liquidityManagers.push(_address);
                }
            }
            _result = !s.isLiquidityManager[_address];
            s.isLiquidityManager[_address] = _result;
        } else if (_managing == MANAGING.DEBTOR) {
            // 7
            if (requirements(s.debtorQueue, s.isDebtor, _address)) {
                s.debtorQueue[_address] = 0;
                if (!listContains(s.debtors, _address)) {
                    s.debtors.push(_address);
                }
            }
            _result = !s.isDebtor[_address];
            s.isDebtor[_address] = _result;
        } else if (_managing == MANAGING.REWARDMANAGER) {
            // 8
            if (
                requirements(s.rewardManagerQueue, s.isRewardManager, _address)
            ) {
                s.rewardManagerQueue[_address] = 0;
                if (!listContains(s.rewardManagers, _address)) {
                    s.rewardManagers.push(_address);
                }
            }
            _result = !s.isRewardManager[_address];
            s.isRewardManager[_address] = _result;
        } else if (_managing == MANAGING.NNECC) {
            // 9
            s.sNeccQueue = 0;
            s.sNecc = _address;
            _result = true;
        } else return false;

        emit ChangeActivated(_managing, _address, _result);
        return true;
    }

    /**
        @notice checks requirements and returns altered structs
        @param queue_ mapping( address => uint )
        @param status_ mapping( address => bool )
        @param _address address
        @return bool 
     */
    function requirements(
        mapping(address => uint256) storage queue_,
        mapping(address => bool) storage status_,
        address _address
    ) internal view returns (bool) {
        if (!status_[_address]) {
            require(queue_[_address] != 0, "Must queue");
            require(queue_[_address] <= block.number, "Queue not expired");
            return true;
        }
        return false;
    }

    /**
        @notice checks array to ensure against duplicate
        @param _list address[]
        @param _token address
        @return bool
     */
    function listContains(address[] storage _list, address _token)
        internal
        view
        returns (bool)
    {
        for (uint256 i = 0; i < _list.length; i++) {
            if (_list[i] == _token) {
                return true;
            }
        }
        return false;
    }
}
