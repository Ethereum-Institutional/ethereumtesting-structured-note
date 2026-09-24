// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDeterminationAgent} from "./interfaces/IDeterminationAgent.sol";

interface INoteServicing {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function burn(address account, uint256 value) external;
    function pause() external;
    function paused() external view returns (bool);
}

interface ICashLeg {
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
 * Amounts per holder are the amount per Calculation Amount times the holder's units (R1), so the
 * total paid equals the amount per CA times the units entitled, with nothing to allocate.
 * Custody accounts are paid as holders of record, as nominee (E3).
 */
contract PayingAgent is AccessControl {
    bytes32 public constant PAYER_ROLE = keccak256("PAYER_ROLE");

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
    }

    INoteServicing public immutable NOTE;
    ICashLeg public immutable CASH;
    IDeterminationAgent public immutable DETERMINATIONS;
    IRecordDates public immutable RECORD_DATES;
    /// @notice The Issuer's inventory: excluded from coupons, burned at redemption (E2).
    address public immutable INVENTORY;
    /// @notice The deposit account every distribution is debited from.
    address public immutable FUNDER;

    mapping(bytes32 id => Distribution) public distributions;
    mapping(bytes32 id => mapping(address holder => bool)) public settled;
    mapping(bytes32 id => mapping(address holder => uint256)) public held;

    event Opened(bytes32 indexed id, uint256 indexed dateIndex, Kind kind, uint256 perCa, uint256 unitsEntitled);
    event Paid(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount);
    event Held(bytes32 indexed id, address indexed holder, uint256 units, uint256 amount);
    event Claimed(bytes32 indexed id, address indexed holder, uint256 amount);
    event Closed(bytes32 indexed id, uint256 unitsPaid, uint256 inventoryBurned);

    error NothingDue(uint256 dateIndex, Kind kind);
    error BeforePaymentDate(uint48 paymentDate);
    error AlreadyOpen(bytes32 id);
    error NotOpen(bytes32 id);
    error AlreadySettled(address holder);
    error NotAHolderOfRecord(address holder);
    error InventoryIsNotPaid();
    error NothingHeld(address holder);
    error CannotReceive(address holder);

    constructor(
        INoteServicing note,
        ICashLeg cash,
        IDeterminationAgent determinations,
        IRecordDates recordDates,
        address inventory,
        address funder,
        address admin,
        address payer
    ) {
        NOTE = note;
        CASH = cash;
        DETERMINATIONS = determinations;
        RECORD_DATES = recordDates;
        INVENTORY = inventory;
        FUNDER = funder;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAYER_ROLE, payer);
    }

    function idOf(uint256 dateIndex, Kind kind) public pure returns (bytes32) {
        return keccak256(abi.encode(dateIndex, kind));
    }

    // --- servicing ---

    function open(uint256 dateIndex, Kind kind) external onlyRole(PAYER_ROLE) returns (bytes32 id) {
        id = idOf(dateIndex, kind);
        if (distributions[id].open) revert AlreadyOpen(id);
        if (!DETERMINATIONS.determined(dateIndex)) revert NothingDue(dateIndex, kind);
        IDeterminationAgent.Outcome memory o = DETERMINATIONS.outcomeOf(dateIndex);
        IDeterminationAgent.Observation memory obs = DETERMINATIONS.observation(dateIndex);
        if (kind == Kind.Coupon ? !o.couponPaid : !o.redeemed) revert NothingDue(dateIndex, kind);
        if (block.timestamp < obs.paymentDate) revert BeforePaymentDate(obs.paymentDate);

        uint256 perCa = kind == Kind.Coupon ? o.couponPerCa : o.redemptionPerCa;
        uint256 entitled = RECORD_DATES.totalSupplyAt(obs.recordTime)
            - RECORD_DATES.balanceAt(INVENTORY, obs.recordTime);
        distributions[id] = Distribution(obs.recordTime, uint64(perCa), uint64(entitled), 0, true, false, kind);
        emit Opened(id, dateIndex, kind, perCa, entitled);

        if (kind == Kind.Redemption && !NOTE.paused()) NOTE.pause();
        if (perCa * entitled > 0) CASH.transferFrom(FUNDER, address(this), perCa * entitled);
        if (entitled == 0) _close(id);
    }

    function pay(bytes32 id, address[] calldata holders) external onlyRole(PAYER_ROLE) {
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
