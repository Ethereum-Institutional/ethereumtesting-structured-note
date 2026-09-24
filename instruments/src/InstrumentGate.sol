// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";
import {IERC7551Compliance} from "debt-standard/interfaces/tokenization/draft-IERC7551.sol";
import {IERC3643ComplianceRead, IERC3643IComplianceContract} from
    "debt-standard/interfaces/tokenization/IERC3643Partial.sol";
import {IEligibilityGate} from "./interfaces/IEligibilityGate.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title InstrumentGate
 * @notice One instrument's eligibility test against the Identity Registry. Immutable once
 *         deployed: changing what an instrument requires means deploying a new gate, which the
 *         token then points at, and that replacement is itself a privileged, recorded act.
 *
 * An account may receive when its live grant carries every flag in `RECEIVE_MASK`, and send
 * when it carries every flag in `SEND_MASK`. Settlement infrastructure, which the debt standard
 * requires to pass `canSend` before it can be given an allowance, qualifies to send by carrying
 * every flag in `SETTLEMENT_MASK` instead, with no investor attribute and no right to hold or
 * receive, so nothing can be parked in it (ADR 0013). A zero settlement mask admits none. Where the gate was built with a set of permitted
 * jurisdictions, the account's jurisdiction must also be in it. A Regulation S note requires
 * the Regulation S flag; reissuing under Rule 144A means a gate with a different mask, not a
 * different contract.
 *
 * Obligations from spike 2, which the token relies on for correctness:
 * - **G1.** The transfer callback reverts exactly when {canTransfer} is false, and
 *   {canTransfer} is false whenever {canSend} of the sender or {canReceive} of the recipient
 *   is. A mint tests only the recipient.
 * - **G2.** Every view is one registry read and at most one read here, far inside the token's
 *   100,000 gas bound.
 * - **G3.** A burn (recipient zero) tests nothing here. Only the token's burner can burn, and
 *   redemption must succeed for a holder whose grant has lapsed by maturity, which the ERC-7943
 *   Final text allows a permissioned burn to do. Recorded as a Wave 2 default, to be confirmed
 *   before the contract surface is frozen.
 *
 * The gate keeps no state, so zero-value notifications, which any address can trigger through
 * the token, carry no risk to it. The spender of an allowance is not tested: a settlement
 * contract moving units between two eligible holders is not itself a holder.
 */
contract InstrumentGate is IEligibilityGate {
    IIdentityRegistry public immutable REGISTRY;
    uint32 public immutable SEND_MASK;
    uint32 public immutable RECEIVE_MASK;
    uint32 public immutable SETTLEMENT_MASK;
    /// @dev False when every jurisdiction is permitted.
    bool public immutable RESTRICTS_JURISDICTION;

    mapping(uint16 code => bool) public jurisdictionPermitted;

    error NotEligible(address from, address to);

    constructor(
        IIdentityRegistry registry,
        uint32 sendMask,
        uint32 receiveMask,
        uint32 settlementMask,
        uint16[] memory jurisdictions
    ) {
        REGISTRY = registry;
        SEND_MASK = sendMask;
        RECEIVE_MASK = receiveMask;
        SETTLEMENT_MASK = settlementMask;
        RESTRICTS_JURISDICTION = jurisdictions.length > 0;
        for (uint256 i = 0; i < jurisdictions.length; ++i) {
            jurisdictionPermitted[jurisdictions[i]] = true;
        }
    }

    // --- account views ---

    function canSend(address account) public view returns (bool) {
        return _holds(account, SEND_MASK) || (SETTLEMENT_MASK != 0 && _holds(account, SETTLEMENT_MASK));
    }

    function canReceive(address account) public view returns (bool) {
        return _holds(account, RECEIVE_MASK);
    }

    // --- transfer views ---

    /// @inheritdoc IERC3643ComplianceRead
    function canTransfer(address from, address to, uint256) public view returns (bool) {
        if (to == address(0)) return true; // G3
        return (from == address(0) || canSend(from)) && canReceive(to);
    }

    /// @inheritdoc IERC7551Compliance
    function canTransferFrom(address, address from, address to, uint256 value) external view returns (bool) {
        return canTransfer(from, to, value);
    }

    // --- callbacks (G1) ---

    /// @inheritdoc IERC3643IComplianceContract
    function transferred(address from, address to, uint256 value) public view {
        if (!canTransfer(from, to, value)) revert NotEligible(from, to);
    }

    /// @inheritdoc IRuleEngine
    function transferred(address, address from, address to, uint256 value) external view {
        transferred(from, to, value);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IRuleEngine).interfaceId || interfaceId == type(IEligibilityGate).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    // --- internal ---

    function _holds(address account, uint32 mask) private view returns (bool) {
        (uint32 flags, uint16 jurisdiction) = REGISTRY.liveFlags(account);
        if (flags & mask != mask || flags == 0) return false;
        return !RESTRICTS_JURISDICTION || jurisdictionPermitted[jurisdiction];
    }
}
