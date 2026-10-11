// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardPool} from "../src/RewardPool.sol";

contract ReentrantClaimer {
    RewardPool public immutable pool;
    uint256 public immutable poolId;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(RewardPool p, uint256 id) {
        pool = p;
        poolId = id;
    }

    function claim() external {
        pool.claimReward(poolId);
    }

    receive() external payable {
        reentryAttempts++;
        try pool.claimReward(poolId) {
            reentrySucceeded = true;
        } catch {}
    }
}

contract RejectingReceiver {
    RewardPool public immutable pool;

    constructor(RewardPool p) {
        pool = p;
    }

    function claim(uint256 id) external {
        pool.claimReward(id);
    }

    receive() external payable {
        revert("no");
    }
}

contract RewardPoolTest is Test {
    RewardPool pool;
    address sponsor = makeAddr("sponsor");
    address curatorA = makeAddr("curatorA");
    address curatorB = makeAddr("curatorB");
    address stranger = makeAddr("stranger");
    uint256 id;

    event PoolCreated(uint256 indexed poolId, address indexed manager, string title);
    event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event RewardAllocated(uint256 indexed poolId, address indexed recipient, uint256 amount);
    event RewardClaimed(uint256 indexed poolId, address indexed recipient, uint256 amount);
    event PoolClosed(uint256 indexed poolId, address indexed manager, uint256 refunded);

    function setUp() public {
        pool = new RewardPool();
        vm.deal(sponsor, 100 ether);
        vm.deal(stranger, 10 ether);
        vm.prank(sponsor);
        id = pool.createPool("Test pool");
    }

    function _fund(uint256 amt) internal {
        vm.prank(sponsor);
        pool.fundPool{value: amt}(id);
    }

    function _alloc(address r, uint256 a) internal {
        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = r;
        as_[0] = a;
        vm.prank(sponsor);
        pool.allocateRewards(id, rs, as_);
    }

    // ---- creation / funding ----

    function test_createPool_setsManagerAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit PoolCreated(2, stranger, "Second");
        vm.prank(stranger);
        uint256 id2 = pool.createPool("Second");
        assertEq(id2, 2);
        (address m,,,,) = pool.getPool(id2);
        assertEq(m, stranger);
    }

    function test_fund_emitsAndAccounts() public {
        vm.expectEmit(true, true, false, true);
        emit PoolFunded(id, sponsor, 3 ether);
        _fund(3 ether);
        (, uint256 funded,,,) = pool.getPool(id);
        assertEq(funded, 3 ether);
        assertEq(address(pool).balance, 3 ether);
    }

    function test_fund_anyoneCanFund() public {
        vm.prank(stranger);
        pool.fundPool{value: 1 ether}(id);
        (, uint256 funded,,,) = pool.getPool(id);
        assertEq(funded, 1 ether);
    }

    function test_fund_zeroReverts() public {
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.ZeroAmount.selector);
        pool.fundPool{value: 0}(id);
    }

    function test_fund_unknownPoolReverts() public {
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.PoolNotFound.selector);
        pool.fundPool{value: 1}(999);
    }

    // ---- allocation ----

    function test_allocate_onlyManager() public {
        _fund(5 ether);
        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorA;
        as_[0] = 1 ether;
        vm.prank(stranger);
        vm.expectRevert(RewardPool.NotManager.selector);
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_happyPathEmitsAndSetsClaimable() public {
        _fund(5 ether);
        address[] memory rs = new address[](2);
        uint256[] memory as_ = new uint256[](2);
        rs[0] = curatorA;
        rs[1] = curatorB;
        as_[0] = 2 ether;
        as_[1] = 1 ether;
        vm.expectEmit(true, true, false, true);
        emit RewardAllocated(id, curatorA, 2 ether);
        vm.expectEmit(true, true, false, true);
        emit RewardAllocated(id, curatorB, 1 ether);
        vm.prank(sponsor);
        pool.allocateRewards(id, rs, as_);
        assertEq(pool.claimable(id, curatorA), 2 ether);
        assertEq(pool.claimable(id, curatorB), 1 ether);
        (,, uint256 allocated,,) = pool.getPool(id);
        assertEq(allocated, 3 ether);
    }

    function test_allocate_exceedingBalanceReverts() public {
        _fund(1 ether);
        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorA;
        as_[0] = 1 ether + 1;
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(RewardPool.InsufficientPoolBalance.selector, 1 ether, 1 ether + 1));
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_cumulativeCannotExceedBalance() public {
        _fund(2 ether);
        _alloc(curatorA, 1.5 ether);
        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorB;
        as_[0] = 0.6 ether;
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(RewardPool.InsufficientPoolBalance.selector, 0.5 ether, 0.6 ether));
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_lengthMismatchReverts() public {
        _fund(1 ether);
        address[] memory rs = new address[](2);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorA;
        rs[1] = curatorB;
        as_[0] = 1;
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.LengthMismatch.selector);
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_emptyReverts() public {
        _fund(1 ether);
        address[] memory rs = new address[](0);
        uint256[] memory as_ = new uint256[](0);
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.EmptyAllocation.selector);
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_zeroAmountAndZeroAddressRevert() public {
        _fund(1 ether);
        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorA;
        as_[0] = 0;
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.ZeroAmount.selector);
        pool.allocateRewards(id, rs, as_);

        rs[0] = address(0);
        as_[0] = 1;
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.ZeroAddress.selector);
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_duplicateInSameCallReverts() public {
        _fund(5 ether);
        address[] memory rs = new address[](2);
        uint256[] memory as_ = new uint256[](2);
        rs[0] = curatorA;
        rs[1] = curatorA;
        as_[0] = 1;
        as_[1] = 1;
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(RewardPool.AlreadyAllocated.selector, curatorA));
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_secondAllocationToSameRecipientReverts() public {
        _fund(5 ether);
        _alloc(curatorA, 1 ether);
        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorA;
        as_[0] = 1 ether;
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(RewardPool.AlreadyAllocated.selector, curatorA));
        pool.allocateRewards(id, rs, as_);
    }

    function test_allocate_tooManyRecipientsReverts() public {
        _fund(100 ether);
        uint256 n = pool.MAX_RECIPIENTS() + 1;
        address[] memory rs = new address[](n);
        uint256[] memory as_ = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            rs[i] = address(uint160(0x1000 + i));
            as_[i] = 1;
        }
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.TooManyRecipients.selector);
        pool.allocateRewards(id, rs, as_);
    }

    function test_failedAllocation_leavesNoPartialState() public {
        _fund(1 ether);
        address[] memory rs = new address[](2);
        uint256[] memory as_ = new uint256[](2);
        rs[0] = curatorA;
        rs[1] = curatorB;
        as_[0] = 0.5 ether;
        as_[1] = 0.6 ether; // total 1.1 > 1
        vm.prank(sponsor);
        vm.expectRevert();
        pool.allocateRewards(id, rs, as_);
        assertEq(pool.claimable(id, curatorA), 0);
        assertFalse(pool.wasAllocated(id, curatorA));
    }

    // ---- claims ----

    function test_claim_paysOnlyOwnBalanceAndEmits() public {
        _fund(5 ether);
        _alloc(curatorA, 2 ether);
        uint256 before = curatorA.balance;
        vm.expectEmit(true, true, false, true);
        emit RewardClaimed(id, curatorA, 2 ether);
        vm.prank(curatorA);
        pool.claimReward(id);
        assertEq(curatorA.balance, before + 2 ether);
        assertEq(pool.claimable(id, curatorA), 0);
        (,,, uint256 claimed,) = pool.getPool(id);
        assertEq(claimed, 2 ether);
    }

    function test_claim_strangerCannotClaimOthersReward() public {
        _fund(5 ether);
        _alloc(curatorA, 2 ether);
        vm.prank(stranger);
        vm.expectRevert(RewardPool.NothingToClaim.selector);
        pool.claimReward(id);
        assertEq(pool.claimable(id, curatorA), 2 ether);
    }

    function test_claim_doubleClaimReverts() public {
        _fund(5 ether);
        _alloc(curatorA, 2 ether);
        vm.prank(curatorA);
        pool.claimReward(id);
        vm.prank(curatorA);
        vm.expectRevert(RewardPool.NothingToClaim.selector);
        pool.claimReward(id);
    }

    function test_claim_reentrancyBlocked() public {
        ReentrantClaimer attacker = new ReentrantClaimer(pool, id);
        _fund(5 ether);
        _alloc(address(attacker), 2 ether);
        attacker.claim();
        assertEq(attacker.reentryAttempts(), 1);
        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance, 2 ether);
        assertEq(address(pool).balance, 3 ether);
    }

    function test_claim_failedTransferRevertsAndKeepsBalance() public {
        RejectingReceiver r = new RejectingReceiver(pool);
        _fund(5 ether);
        _alloc(address(r), 1 ether);
        vm.expectRevert();
        r.claim(id);
        assertEq(pool.claimable(id, address(r)), 1 ether);
    }

    function test_claim_isolatedPerPool() public {
        _fund(5 ether);
        _alloc(curatorA, 1 ether);
        vm.prank(sponsor);
        uint256 id2 = pool.createPool("Other");
        vm.prank(curatorA);
        vm.expectRevert(RewardPool.NothingToClaim.selector);
        pool.claimReward(id2);
    }

    // ---- close ----

    function test_close_refundsUnallocatedOnly_andClaimsStillWork() public {
        _fund(5 ether);
        _alloc(curatorA, 2 ether);
        uint256 before = sponsor.balance;
        vm.expectEmit(true, true, false, true);
        emit PoolClosed(id, sponsor, 3 ether);
        vm.prank(sponsor);
        pool.closePool(id);
        assertEq(sponsor.balance, before + 3 ether);
        assertEq(address(pool).balance, 2 ether);
        vm.prank(curatorA);
        pool.claimReward(id);
        assertEq(address(pool).balance, 0);
    }

    function test_close_onlyManager() public {
        vm.prank(stranger);
        vm.expectRevert(RewardPool.NotManager.selector);
        pool.closePool(id);
    }

    function test_closed_blocksFundAndAllocate() public {
        _fund(1 ether);
        vm.prank(sponsor);
        pool.closePool(id);
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.PoolIsClosed.selector);
        pool.fundPool{value: 1}(id);

        address[] memory rs = new address[](1);
        uint256[] memory as_ = new uint256[](1);
        rs[0] = curatorA;
        as_[0] = 1;
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.PoolIsClosed.selector);
        pool.allocateRewards(id, rs, as_);
    }

    function test_close_twiceReverts() public {
        vm.prank(sponsor);
        pool.closePool(id);
        vm.prank(sponsor);
        vm.expectRevert(RewardPool.PoolIsClosed.selector);
        pool.closePool(id);
    }

    // ---- fuzz / invariant-style ----

    /// @dev Contract balance must always cover everything still owed.
    function testFuzz_solvency(uint96 fundAmt, uint96 a1, uint96 a2) public {
        fundAmt = uint96(bound(fundAmt, 1, 50 ether));
        vm.deal(sponsor, uint256(fundAmt) + 1 ether);
        _fund(fundAmt);

        address[] memory rs = new address[](2);
        uint256[] memory as_ = new uint256[](2);
        rs[0] = curatorA;
        rs[1] = curatorB;
        as_[0] = bound(a1, 1, type(uint96).max);
        as_[1] = bound(a2, 1, type(uint96).max);

        vm.prank(sponsor);
        try pool.allocateRewards(id, rs, as_) {
            (, uint256 funded, uint256 allocated,,) = pool.getPool(id);
            assertLe(allocated, funded);
            assertEq(allocated, as_[0] + as_[1]);
        } catch {
            assertGt(as_[0] + as_[1], uint256(fundAmt));
        }
        assertGe(address(pool).balance, pool.claimable(id, curatorA) + pool.claimable(id, curatorB));
    }
}
