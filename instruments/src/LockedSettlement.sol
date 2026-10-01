// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

interface INoteLeg {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function canTransfer(address from, address to, uint256 value) external view returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function getFrozenTokens(address account) external view returns (uint256);
    function freezePartialTokens(address account, uint256 value) external;
    function unfreezePartialTokens(address account, uint256 value) external;
    function paused() external view returns (bool);
}

interface ICashLeg {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function canTransfer(address from, address to, uint256 value) external view returns (bool);
}

/**
 * @title LockedSettlement
 * @notice Delivery versus payment by offer, each side's asset locked until the offer settles or
 *         ends (ADR 0081). One party offers; the other accepts before the deadline, and both legs
 *         move in that transaction, or neither does.
 *
 * - **An offer to sell** freezes the seller's units in its own wallet (the debt standard's partial
 *   freeze). The units stay the seller's, so the seller remains the holder of record at any
 *   Record Time, and nothing is parked here: this contract can never hold the note.
 * - **An offer to buy** holds the price in the deposit here, as the Paying Agent holds a
 *   distribution, until the offer settles or ends. The contract may hold the deposit but never
 *   the note: it is onboarded without the Regulation S flag the note requires.
 * - **Named or open.** An offer names its counterparty, or none, when any account the note and the
 *   deposit both accept may take it. The instruments' own views decide who can.
 * - **Ending.** The proposer may cancel, and a named counterparty may decline, until it settles.
 *   Anyone may release an offer past its deadline, or once the note is paused: opening a
 *   redemption pauses it, and frozen units could not otherwise be burned at redemption.
 *
 * Placement (the Issuer's inventory sells), secondary transfer, and buy-back (the inventory buys)
 * all settle here.
 */
contract LockedSettlement {
    enum Side {
        Sell,
        Buy
    }

    enum State {
        None,
        Open,
        Settled,
        Cancelled,
        Released
    }

    struct Offer {
        address proposer;
        /// @dev Zero for an open offer.
        address counterparty;
        Side side;
        uint64 units;
        uint48 deadline;
        State state;
        uint256 price;
    }

    INoteLeg public immutable NOTE;
    ICashLeg public immutable CASH;

    uint256 public offerCount;
    mapping(uint256 id => Offer) public offers;
    /// @notice The units this contract has frozen for each account, across its open offers.
    mapping(address account => uint256) public lockedUnits;

    event Offered(
        uint256 indexed id,
        address indexed proposer,
        address indexed counterparty,
        Side side,
        uint256 units,
        uint256 price,
        uint256 deadline
    );
    event Settled(uint256 indexed id, address indexed seller, address indexed buyer, uint256 units, uint256 price);
    event Cancelled(uint256 indexed id, address by);
    event Released(uint256 indexed id, address by);

    error InvalidOffer();
    error NotOpen(uint256 id);
    error Expired(uint256 id);
    error NotTheCounterparty(address taker);
    error ProposerCannotAccept();
    error NotAParty(address caller);
    error StillLive(uint256 id);
    error UnitsUnavailable(address seller, uint256 units, uint256 available);
    error NoAllowance(address owner, uint256 needed);
    error NoteLegRefused(address seller, address buyer, uint256 units);
    error CashLegRefused(address buyer, address seller, uint256 price);

    constructor(INoteLeg note, ICashLeg cash) {
        NOTE = note;
        CASH = cash;
    }

    /**
     * @notice Offers to sell or buy `units` for `price` in the deposit until `deadline`, to
     *         `counterparty` or, if it is zero, to anyone the instruments accept. Locks the
     *         proposer's side: its units frozen in its wallet, or the price held here.
     */
    function offer(Side side, address counterparty, uint64 units, uint256 price, uint48 deadline)
        external
        returns (uint256 id)
    {
        if (units == 0 || price == 0 || deadline <= block.timestamp || counterparty == msg.sender) revert InvalidOffer();
        id = ++offerCount;
        offers[id] = Offer(msg.sender, counterparty, side, units, deadline, State.Open, price);
        emit Offered(id, msg.sender, counterparty, side, units, price, deadline);

        if (side == Side.Sell) {
            uint256 available = NOTE.balanceOf(msg.sender) - NOTE.getFrozenTokens(msg.sender);
            if (available < units) revert UnitsUnavailable(msg.sender, units, available);
            // Delivered at acceptance under this allowance; frozen until then.
            if (NOTE.allowance(msg.sender, address(this)) < units) revert NoAllowance(msg.sender, units);
            lockedUnits[msg.sender] += units;
            NOTE.freezePartialTokens(msg.sender, units);
        } else {
            CASH.transferFrom(msg.sender, address(this), price);
        }
    }

    /// @notice The counterparty, or for an open offer anyone, accepts: both legs settle now.
    function accept(uint256 id) external {
        Offer storage o = offers[id];
        if (o.state != State.Open) revert NotOpen(id);
        if (block.timestamp > o.deadline) revert Expired(id);
        if (msg.sender == o.proposer) revert ProposerCannotAccept();
        if (o.counterparty != address(0) && msg.sender != o.counterparty) revert NotTheCounterparty(msg.sender);
        o.state = State.Settled;

        if (o.side == Side.Sell) {
            (address seller, address buyer) = (o.proposer, msg.sender);
            _unlock(seller, o.units);
            if (!NOTE.canTransfer(seller, buyer, o.units)) revert NoteLegRefused(seller, buyer, o.units);
            if (!CASH.canTransfer(buyer, seller, o.price)) revert CashLegRefused(buyer, seller, o.price);
            NOTE.transferFrom(seller, buyer, o.units);
            CASH.transferFrom(buyer, seller, o.price);
            emit Settled(id, seller, buyer, o.units, o.price);
        } else {
            (address seller, address buyer) = (msg.sender, o.proposer);
            if (!NOTE.canTransfer(seller, buyer, o.units)) revert NoteLegRefused(seller, buyer, o.units);
            if (!CASH.canTransfer(address(this), seller, o.price)) revert CashLegRefused(buyer, seller, o.price);
            NOTE.transferFrom(seller, buyer, o.units);
            CASH.transfer(seller, o.price);
            emit Settled(id, seller, buyer, o.units, o.price);
        }
    }

    /// @notice The proposer withdraws its offer, or a named counterparty declines it; its lock ends.
    function cancel(uint256 id) external {
        Offer storage o = offers[id];
        if (o.state != State.Open) revert NotOpen(id);
        if (msg.sender != o.proposer && (o.counterparty == address(0) || msg.sender != o.counterparty)) revert NotAParty(msg.sender);
        o.state = State.Cancelled;
        _end(o);
        emit Cancelled(id, msg.sender);
    }

    /// @notice Anyone ends an offer past its deadline, or once the note is paused, returning its lock.
    function release(uint256 id) external {
        Offer storage o = offers[id];
        if (o.state != State.Open) revert NotOpen(id);
        if (block.timestamp <= o.deadline && !NOTE.paused()) revert StillLive(id);
        o.state = State.Released;
        _end(o);
        emit Released(id, msg.sender);
    }

    function _end(Offer storage o) private {
        if (o.side == Side.Sell) _unlock(o.proposer, o.units);
        else CASH.transfer(o.proposer, o.price);
    }

    /// @dev Unfreezes what this contract froze, never more than is still frozen: the note's
    ///      enforcer may have unfrozen the account meanwhile.
    function _unlock(address account, uint256 units) private {
        lockedUnits[account] -= units;
        uint256 frozen = NOTE.getFrozenTokens(account);
        uint256 amount = units < frozen ? units : frozen;
        if (amount > 0) NOTE.unfreezePartialTokens(account, amount);
    }
}
