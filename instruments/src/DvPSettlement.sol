// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

interface ISettlementLeg {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function canTransfer(address from, address to, uint256 value) external view returns (bool);
}

/**
 * @title DvPSettlement
 * @notice Delivery versus payment between the note and the cash leg: both legs or neither.
 *
 * Placement (the Issuer's inventory sells), secondary transfer, and buy-back (the inventory buys,
 * so notional returns to pending with no further instruction) all settle here.
 *
 * One party proposes a trade and the other accepts it, which settles it: two separate acts on the
 * record. Either party may cancel until then. Both legs are tested against the registry, through
 * each instrument's own view, before either moves, so an ineligible counterparty fails the whole
 * settlement with the failing leg named rather than leaving one leg delivered. The contract never
 * holds either token; it moves each under the allowance its owner gave it.
 *
 * The cash leg is a constructor parameter, so the same contract settles against whatever
 * permissioned cash instrument is supplied.
 */
contract DvPSettlement {
    enum State {
        None,
        Proposed,
        Settled,
        Cancelled
    }

    struct Trade {
        address seller;
        address buyer;
        address proposer;
        uint64 units;
        uint48 deadline;
        State state;
        uint256 price;
    }

    ISettlementLeg public immutable NOTE;
    ISettlementLeg public immutable CASH;

    uint256 public tradeCount;
    mapping(uint256 id => Trade) public trades;

    event Proposed(
        uint256 indexed id, address indexed seller, address indexed buyer, address proposer, uint256 units,
        uint256 price, uint256 deadline
    );
    event Settled(uint256 indexed id, address indexed seller, address indexed buyer, uint256 units, uint256 price);
    event Cancelled(uint256 indexed id, address by);

    error NotAParty(address caller);
    error ProposerCannotAccept();
    error NotProposed(uint256 id);
    error Expired(uint256 id);
    error InvalidTrade();
    error NoteLegRefused(address seller, address buyer, uint256 units);
    error CashLegRefused(address buyer, address seller, uint256 price);

    constructor(ISettlementLeg note, ISettlementLeg cash) {
        NOTE = note;
        CASH = cash;
    }

    /// @notice Records a trade. The caller must be its seller or its buyer.
    function propose(address seller, address buyer, uint64 units, uint256 price, uint48 deadline)
        external
        returns (uint256 id)
    {
        if (msg.sender != seller && msg.sender != buyer) revert NotAParty(msg.sender);
        if (seller == buyer || units == 0 || deadline < block.timestamp) revert InvalidTrade();
        id = ++tradeCount;
        trades[id] = Trade(seller, buyer, msg.sender, units, deadline, State.Proposed, price);
        emit Proposed(id, seller, buyer, msg.sender, units, price, deadline);
    }

    /// @notice The counterparty accepts, and both legs settle in this transaction.
    function accept(uint256 id) external {
        Trade storage t = trades[id];
        if (t.state != State.Proposed) revert NotProposed(id);
        if (block.timestamp > t.deadline) revert Expired(id);
        if (msg.sender != t.seller && msg.sender != t.buyer) revert NotAParty(msg.sender);
        if (msg.sender == t.proposer) revert ProposerCannotAccept();

        if (!NOTE.canTransfer(t.seller, t.buyer, t.units)) revert NoteLegRefused(t.seller, t.buyer, t.units);
        if (!CASH.canTransfer(t.buyer, t.seller, t.price)) revert CashLegRefused(t.buyer, t.seller, t.price);

        t.state = State.Settled;
        NOTE.transferFrom(t.seller, t.buyer, t.units);
        CASH.transferFrom(t.buyer, t.seller, t.price);
        emit Settled(id, t.seller, t.buyer, t.units, t.price);
    }

    function cancel(uint256 id) external {
        Trade storage t = trades[id];
        if (t.state != State.Proposed) revert NotProposed(id);
        if (msg.sender != t.seller && msg.sender != t.buyer) revert NotAParty(msg.sender);
        t.state = State.Cancelled;
        emit Cancelled(id, msg.sender);
    }
}
