// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {IModule} from "t-rex/compliance/modular/modules/IModule.sol";

/**
 * @title ProgrammeSanctions
 * @notice One supervisory list for the whole programme, as an ERC-3643 compliance module that every
 *         note carries from issuance (ADR 0115). An account the governance controller designates
 *         can neither send nor receive any note, at once, in one act, however many notes it holds:
 *         a sanctions designation cannot be raced note by note.
 *
 * - **Designation is the controller's alone,** a Tier 1 act with its written reason, and is lifted
 *   the same way.
 * - **Ordinary transfers only.** Issuance into the Issuer's inventory and burning at redemption
 *   are not refused, so a designated holder's units can still be redeemed and its payment held for
 *   it by the Paying Agent. A forced transfer, Tier 1's register correction, is not refused either.
 * - **Every note binds it.** It is plug and play: any note's compliance may bind it, and it keeps
 *   no state per note.
 *
 * Licensed GPL-3.0 because it implements T-REX's module interface (ADR 0087).
 */
contract ProgrammeSanctions is IModule {
    /// @notice The governance controller: the only account that designates, bound once.
    address public governance;
    address private immutable _DEPLOYER;

    mapping(address account => bool) public designated;
    mapping(address compliance => bool) private _bound;

    event Designated(address indexed account, bool designated);

    error NotGovernance(address caller);
    error NotTheCompliance(address caller);
    error AlreadyBound();

    constructor() {
        _DEPLOYER = msg.sender;
    }

    /// @notice Binds the governance controller, once; the controller and this module are
    ///         deployed together, each naming the other.
    function bindGovernance(address g) external {
        if (msg.sender != _DEPLOYER || governance != address(0) || g == address(0)) revert AlreadyBound();
        governance = g;
    }

    /// @notice Designates an account, or lifts its designation, across every note at once.
    function designate(address account, bool on) external {
        if (msg.sender != governance) revert NotGovernance(msg.sender);
        designated[account] = on;
        emit Designated(account, on);
    }

    // --- the token's compliance ---

    /// @inheritdoc IModule
    function moduleCheck(address from, address to, uint256, address) external view returns (bool) {
        if (from == address(0) || to == address(0)) return true;
        return !designated[from] && !designated[to];
    }

    /// @inheritdoc IModule
    function moduleTransferAction(address, address, uint256) external view {
        if (!_bound[msg.sender]) revert NotTheCompliance(msg.sender);
    }

    /// @inheritdoc IModule
    function moduleMintAction(address, uint256) external view {
        if (!_bound[msg.sender]) revert NotTheCompliance(msg.sender);
    }

    /// @inheritdoc IModule
    function moduleBurnAction(address, uint256) external view {
        if (!_bound[msg.sender]) revert NotTheCompliance(msg.sender);
    }

    // --- binding ---

    /// @inheritdoc IModule
    function bindCompliance(address c) external {
        if (msg.sender != c) revert NotTheCompliance(msg.sender);
        _bound[c] = true;
    }

    /// @inheritdoc IModule
    function unbindCompliance(address c) external {
        if (msg.sender != c) revert NotTheCompliance(msg.sender);
        _bound[c] = false;
    }

    /// @inheritdoc IModule
    function isComplianceBound(address c) external view returns (bool) {
        return _bound[c];
    }

    /// @inheritdoc IModule
    function canComplianceBind(address) external pure returns (bool) {
        return true;
    }

    /// @inheritdoc IModule
    function isPlugAndPlay() external pure returns (bool) {
        return true;
    }

    /// @inheritdoc IModule
    function name() external pure returns (string memory) {
        return "ProgrammeSanctions";
    }
}
