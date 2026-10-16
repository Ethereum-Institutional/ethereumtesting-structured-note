// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {IDeterminationAgent} from "./interfaces/IDeterminationAgent.sol";
import {IProgrammeRoles} from "./interfaces/IProgrammeRoles.sol";

interface INoteServicing {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function burn(address account, uint256 value) external;
    function pause() external;
    function paused() external view returns (bool);
}

interface ICashLeg {
    function balanceOf(address account) external view returns (uint256);
    function forcedTransfer(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function canTransfer(address from, address to, uint256 value) external view returns (bool);
}

interface IRecordDates {
    function balanceAt(address account, uint256 time) external view returns (uint256);
    function totalSupplyAt(uint256 time) external view returns (uint256);
}

/**
 * @title PayingAgent
 * @notice Coupons, Mandatory Early Redemption and final redemption, paid in the tokenized deposit
 *         to holders of record at each Record Time.
 *
 * - **Opening** an event takes the amount per Calculation Amount from the accepted determination,
 *   fixes the units entitled as the note's supply at the Record Time less the Issuer's inventory
 *   (E2), and debits the whole amount from the Agent's deposit account in one transfer. Opening a
 *   redemption also pauses the note, so its views agree with the stop the record-date engine
 *   already applies (E4).
 * - **Paying** takes holders in batches from the Register. Each holder's units are its balance at
 *   the Record Time, never a figure supplied with the call. A holder is paid once per event, the
 *   inventory never. At a redemption the holder's units are burned as it is paid.
 * - **Closing** is automatic, when the units paid equal the units entitled. A Register that omits
 *   a holder therefore cannot close the event, and one that invents a holder cannot pay it. At a
 *   redemption the inventory's units are burned, not paid, on closing (E2).
 * - **A holder the deposit cannot credit** (a lapsed or withdrawn grant) is not skipped. Its
 *   amount is held here against it and the event, and it or anyone for it can claim it once the
 *   deposit accepts it again. The event still closes for everyone else.
 *
 * - **Reversal and restatement** (ADR 0014) belong to the governance controller alone. A coupon is
 *   reversed holder by holder against its original credit, by a forced transfer on the deposit
 *   back to the funding account, the written reason emitted with it; a shortfall is recorded, never
 *   hidden, and an amount that was held and never paid is cancelled instead. The original
 *   distribution stays on record, marked reversed. It may then be restated against a corrected
 *   Record Time, as a new distribution paid in the ordinary way.
 *
 * Amounts per holder are the amount per Calculation Amount times the holder's units (R1), so the
 * total paid equals the amount per CA times the units entitled, with nothing to allocate.
 * Custody accounts are paid as holders of record, as nominee (E3).
 *
 * **Roles are the programme's** (ADR 0115). Who opens and pays (the servicing wallet), whose account
 * funds a distribution (the Agent's), and who reverses and restates (the governance controller) are
 * read from the programme's roles at each act, so a rotation is one act for the whole book. A
 * distribution draws only what the funder approved for it when it opened: no standing approval.
 *
 * Deployed once as an implementation and cloned for each note, initialised in the transaction that
 * creates it.
 */
contract PayingAgent {

    enum Kind {
        Coupon,
        Redemption
    }

    struct Distribution {
        uint48 recordTime;
        uint64 perCa;
        uint64 unitsEntitled;
        uint64 unitsPaid;
        bool open;
        bool closed;
        Kind kind;
        bool reversed;
        uint64 unitsReversed;
        uint256 dateIndex;
    }

    INoteServicing public NOTE;
    ICashLeg public CASH;
    IDeterminationAgent public DETERMINATIONS;
    IRecordDates public RECORD_DATES;
    /// @notice The Issuer's inventory: excluded from coupons, burned at redemption (E2).
    address public INVENTORY;
    /// @notice The programme's roles: the servicing wallet, the funder, the governance controller.
    IProgrammeRoles public roles;

    mapping(bytes32 id => Distribution) public distributions;
    mapping(bytes32 id => mapping(address holder => bool)) public settled;
    mapping(bytes32 id => mapping(address holder => uint256)) public held;
    mapping(bytes32 id => mapping(address holder => bool)) public reversedFor;

    event Opened(bytes32 indexed id, uint256 indexed dateIndex, Kind kind, uint256 perCa, uint256 unitsEntitled);
    event Paid(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount);
    event Held(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount);
    event Claimed(bytes32 indexed id, address indexed holder, uint256 amount);
    event Closed(bytes32 indexed id, uint256 unitsPaid, uint256 inventoryBurned);
    /// @notice One holder's credit reversed, against the original. `shortfall` could not be recovered.
    event Reversed(bytes32 indexed id, address indexed holder, uint256 recovered, uint256 cancelledHeld, uint256 shortfall);
    /// @notice The whole distribution is reversed; the reason is emitted in full.
    event DistributionReversed(bytes32 indexed id, string reason);
    event Restated(bytes32 indexed original, bytes32 indexed restatement, uint48 recordTime, string reason);

    error NothingDue(uint256 dateIndex, Kind kind);
    error BeforePaymentDate(uint48 paymentDate);
    error AlreadyOpen(bytes32 id);
    error NotOpen(bytes32 id);
    error AlreadySettled(address holder);
    error NotAHolderOfRecord(address holder);
    error InventoryIsNotPaid();
    error NothingHeld(address holder);
    error CannotReceive(address holder);
    error OnlyCouponsReverse();
    error NotClosed(bytes32 id);
    error NotSettled(address holder);
    error AlreadyReversed(address holder);
    error NotReversed(bytes32 id);
    error RecordTimeNotPassed(uint48 recordTime);
    error NoReason();
    error AlreadyInitialized();
    error NotServicingWallet(address caller);
    error NotGovernance(address caller);

    /// @dev The implementation itself is never initialised: only its clones are.
    constructor() {
        NOTE = INoteServicing(address(1));
    }

    /// @notice Points a clone at its note, the deposit, its terms and record dates, the Issuer's
    ///         inventory and the programme's roles, once.
    function initialize(
        INoteServicing note,
        ICashLeg cash,
        IDeterminationAgent determinations,
        IRecordDates recordDates,
        address inventory,
        IProgrammeRoles roles_
    ) external {
        if (address(NOTE) != address(0)) revert AlreadyInitialized();
        NOTE = note;
        CASH = cash;
        DETERMINATIONS = determinations;
        RECORD_DATES = recordDates;
        INVENTORY = inventory;
        roles = roles_;
    }

    modifier onlyPayer() {
        if (msg.sender != roles.servicingWallet()) revert NotServicingWallet(msg.sender);
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != roles.governance()) revert NotGovernance(msg.sender);
        _;
    }

    /// @notice The deposit account distributions are drawn from now: the programme's funder.
    function FUNDER() public view returns (address) {
        return roles.funder();
    }

    function idOf(uint256 dateIndex, Kind kind) public pure returns (bytes32) {
        return keccak256(abi.encode(dateIndex, kind));
    }

    // --- servicing ---

    function open(uint256 dateIndex, Kind kind) external onlyPayer returns (bytes32 id) {
        id = idOf(dateIndex, kind);
        if (!DETERMINATIONS.determined(dateIndex)) revert NothingDue(dateIndex, kind);
        IDeterminationAgent.Observation memory obs = DETERMINATIONS.observation(dateIndex);
        if (block.timestamp < obs.paymentDate) revert BeforePaymentDate(obs.paymentDate);
        _open(id, dateIndex, kind, obs.recordTime);
    }

    function _open(bytes32 id, uint256 dateIndex, Kind kind, uint48 recordTime) private {
        if (distributions[id].open) revert AlreadyOpen(id);
        IDeterminationAgent.Outcome memory o = DETERMINATIONS.outcomeOf(dateIndex);
        if (kind == Kind.Coupon ? !o.couponPaid : !o.redeemed) revert NothingDue(dateIndex, kind);

        uint256 perCa = kind == Kind.Coupon ? o.couponPerCa : o.redemptionPerCa;
        uint256 entitled = RECORD_DATES.totalSupplyAt(recordTime) - RECORD_DATES.balanceAt(INVENTORY, recordTime);
        distributions[id] =
            Distribution(recordTime, uint64(perCa), uint64(entitled), 0, true, false, kind, false, 0, dateIndex);
        emit Opened(id, dateIndex, kind, perCa, entitled);

        if (kind == Kind.Redemption && !NOTE.paused()) NOTE.pause();
        if (perCa * entitled > 0) CASH.transferFrom(FUNDER(), address(this), perCa * entitled);
        if (entitled == 0) _close(id);
    }

    // --- reversal and restatement (ADR 0014) ---

    /**
     * @notice Reverses a closed coupon for the given holders, each against its original credit.
     *         Recovered cash goes back to the funding account; a held amount is cancelled.
     */
    function reverse(bytes32 id, address[] calldata holders, string calldata reason)
        external
        onlyGovernance
    {
        if (bytes(reason).length == 0) revert NoReason();
        Distribution storage d = distributions[id];
        if (d.kind != Kind.Coupon) revert OnlyCouponsReverse();
        if (!d.closed) revert NotClosed(id);
        for (uint256 k = 0; k < holders.length; ++k) {
            d.unitsReversed += uint64(_reverseOne(id, d, holders[k]));
        }
        if (d.unitsReversed == d.unitsPaid && !d.reversed) {
            d.reversed = true;
            emit DistributionReversed(id, reason);
        }
    }

    function _reverseOne(bytes32 id, Distribution storage d, address h)
        private
        returns (uint256 units)
    {
        if (!settled[id][h]) revert NotSettled(h);
        if (reversedFor[id][h]) revert AlreadyReversed(h);
        reversedFor[id][h] = true;
        units = RECORD_DATES.balanceAt(h, d.recordTime);

        uint256 cancelled = held[id][h];
        if (cancelled > 0) {
            delete held[id][h];
            CASH.transfer(FUNDER(), cancelled);
            emit Reversed(id, h, 0, cancelled, 0);
            return units;
        }
        uint256 due = uint256(d.perCa) * units;
        uint256 balance = CASH.balanceOf(h);
        uint256 recovered = due < balance ? due : balance;
        if (recovered > 0) CASH.forcedTransfer(h, FUNDER(), recovered);
        emit Reversed(id, h, recovered, 0, due - recovered);
    }

    /// @notice Pays a reversed coupon again against a corrected Record Time, as a new distribution.
    function restate(bytes32 original, uint48 recordTime, string calldata reason)
        external
        onlyGovernance
        returns (bytes32 id)
    {
        if (bytes(reason).length == 0) revert NoReason();
        Distribution storage o = distributions[original];
        if (!o.reversed) revert NotReversed(original);
        if (block.timestamp <= recordTime) revert RecordTimeNotPassed(recordTime);
        id = keccak256(abi.encode(original, recordTime));
        _open(id, o.dateIndex, Kind.Coupon, recordTime);
        emit Restated(original, id, recordTime, reason);
    }

    function pay(bytes32 id, address[] calldata holders) external onlyPayer {
        Distribution storage d = distributions[id];
        if (!d.open || d.closed) revert NotOpen(id);
        uint256 perCa = d.perCa;
        for (uint256 k = 0; k < holders.length; ++k) {
            address h = holders[k];
            if (h == INVENTORY) revert InventoryIsNotPaid();
            if (settled[id][h]) revert AlreadySettled(h);
            uint256 units = RECORD_DATES.balanceAt(h, d.recordTime);
            if (units == 0) revert NotAHolderOfRecord(h);
            settled[id][h] = true;
            d.unitsPaid += uint64(units);

            if (d.kind == Kind.Redemption) NOTE.burn(h, units);
            uint256 amount = perCa * units;
            if (amount == 0) {
                emit Paid(id, h, units, 0);
            } else if (CASH.canTransfer(address(this), h, amount)) {
                CASH.transfer(h, amount);
                emit Paid(id, h, units, amount);
            } else {
                held[id][h] = amount;
                emit Held(id, h, units, amount);
            }
        }
        if (d.unitsPaid == d.unitsEntitled) _close(id);
    }

    /// @notice Pays a held amount to its holder once the deposit accepts it. Anyone may call.
    function claim(bytes32 id, address holder) external {
        uint256 amount = held[id][holder];
        if (amount == 0) revert NothingHeld(holder);
        if (!CASH.canTransfer(address(this), holder, amount)) revert CannotReceive(holder);
        delete held[id][holder];
        CASH.transfer(holder, amount);
        emit Claimed(id, holder, amount);
    }

    // --- inventory ---

    /// @notice Units returned to the Issuer and not cancelled.
    function pending() external view returns (uint256) {
        return NOTE.balanceOf(INVENTORY);
    }

    /// @notice Units held in the market. Derived from balances, so it cannot diverge from them.
    function live() external view returns (uint256) {
        return NOTE.totalSupply() - NOTE.balanceOf(INVENTORY);
    }

    function _close(bytes32 id) private {
        Distribution storage d = distributions[id];
        d.closed = true;
        uint256 burned;
        if (d.kind == Kind.Redemption) {
            burned = NOTE.balanceOf(INVENTORY);
            if (burned > 0) NOTE.burn(INVENTORY, burned);
        }
        emit Closed(id, d.unitsPaid, burned);
    }
}
