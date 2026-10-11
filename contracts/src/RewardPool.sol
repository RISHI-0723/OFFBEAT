// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OFFBEAT RewardPool
/// @notice Minimal native-MON escrow for discovery rewards. TESTNET PROTOTYPE.
/// @dev Trust model: scores are computed OFF-CHAIN by the OFFBEAT backend. The pool manager (the
///      sponsor wallet that created the pool) decides which amounts to allocate. The contract
///      guarantees only that (a) allocations never exceed funded balance, (b) a recipient can
///      claim only their own allocation, once, and (c) every step emits an auditable event.
///      It does NOT verify scores, check-ins or identities.
contract RewardPool {
    struct Pool {
        address manager;
        uint256 funded;
        uint256 allocated;
        uint256 claimed;
        bool closed;
    }

    uint256 public constant MAX_RECIPIENTS = 50;

    uint256 public nextPoolId = 1;
    mapping(uint256 => Pool) private _pools;
    mapping(uint256 => mapping(address => uint256)) public claimable;
    mapping(uint256 => mapping(address => bool)) public wasAllocated;

    uint256 private _lock = 1;

    event PoolCreated(uint256 indexed poolId, address indexed manager, string title);
    event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event RewardAllocated(uint256 indexed poolId, address indexed recipient, uint256 amount);
    event RewardClaimed(uint256 indexed poolId, address indexed recipient, uint256 amount);
    event PoolClosed(uint256 indexed poolId, address indexed manager, uint256 refunded);

    error NotManager();
    error PoolNotFound();
    error PoolIsClosed();
    error ZeroAmount();
    error LengthMismatch();
    error EmptyAllocation();
    error TooManyRecipients();
    error ZeroAddress();
    error AlreadyAllocated(address recipient);
    error InsufficientPoolBalance(uint256 available, uint256 requested);
    error NothingToClaim();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier poolExists(uint256 poolId) {
        if (_pools[poolId].manager == address(0)) revert PoolNotFound();
        _;
    }

    modifier onlyManager(uint256 poolId) {
        if (_pools[poolId].manager == address(0)) revert PoolNotFound();
        if (msg.sender != _pools[poolId].manager) revert NotManager();
        _;
    }

    function createPool(string calldata title) external returns (uint256 poolId) {
        poolId = nextPoolId++;
        _pools[poolId].manager = msg.sender;
        emit PoolCreated(poolId, msg.sender, title);
    }

    /// @notice Anyone may add testnet MON to an open pool.
    function fundPool(uint256 poolId) external payable poolExists(poolId) {
        if (_pools[poolId].closed) revert PoolIsClosed();
        if (msg.value == 0) revert ZeroAmount();
        _pools[poolId].funded += msg.value;
        emit PoolFunded(poolId, msg.sender, msg.value);
    }

    /// @notice Manager allocates claimable rewards. Each recipient may be allocated once per pool.
    function allocateRewards(uint256 poolId, address[] calldata recipients, uint256[] calldata amounts)
        external
        onlyManager(poolId)
    {
        Pool storage p = _pools[poolId];
        if (p.closed) revert PoolIsClosed();
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0) revert EmptyAllocation();
        if (recipients.length > MAX_RECIPIENTS) revert TooManyRecipients();

        uint256 total;
        for (uint256 i = 0; i < recipients.length; i++) {
            address r = recipients[i];
            uint256 a = amounts[i];
            if (r == address(0)) revert ZeroAddress();
            if (a == 0) revert ZeroAmount();
            if (wasAllocated[poolId][r]) revert AlreadyAllocated(r); // also rejects duplicates in-call
            wasAllocated[poolId][r] = true;
            claimable[poolId][r] = a;
            total += a;
            emit RewardAllocated(poolId, r, a);
        }

        uint256 available = p.funded - p.allocated;
        if (total > available) revert InsufficientPoolBalance(available, total);
        p.allocated += total;
    }

    /// @notice Recipient claims their own allocation. Checks-effects-interactions + reentrancy guard.
    function claimReward(uint256 poolId) external nonReentrant poolExists(poolId) {
        uint256 amount = claimable[poolId][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[poolId][msg.sender] = 0;
        _pools[poolId].claimed += amount;
        emit RewardClaimed(poolId, msg.sender, amount);
        // forge-lint: disable-next-line(reentrancy-eth) -- guarded by nonReentrant; see test_claim_reentrancyBlocked
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Manager closes the pool and recovers MON that was never allocated. Claims stay open.
    function closePool(uint256 poolId) external nonReentrant onlyManager(poolId) {
        Pool storage p = _pools[poolId];
        if (p.closed) revert PoolIsClosed();
        p.closed = true;
        uint256 refund = p.funded - p.allocated;
        p.funded = p.allocated; // unallocated funds leave the pool
        emit PoolClosed(poolId, msg.sender, refund);
        if (refund > 0) {
            // forge-lint: disable-next-line(reentrancy-eth) -- guarded by nonReentrant; state is updated before the call
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    function getPool(uint256 poolId)
        external
        view
        poolExists(poolId)
        returns (address manager, uint256 funded, uint256 allocated, uint256 claimed, bool closed)
    {
        Pool storage p = _pools[poolId];
        return (p.manager, p.funded, p.allocated, p.claimed, p.closed);
    }
}
