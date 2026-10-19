// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

/**
 * @title FixedImplementationAuthority
 * @notice The implementations behind every T-REX proxy of a deployment, fixed for good (ADR 0088).
 *
 * T-REX's proxies ask an implementation authority where their logic is, on every call, and only
 * that authority can point them at another. T-REX's own authority holds versions that can be added
 * and switched; in 5.0.0-beta2 one of its entry points does so without checking its owner, so on a
 * public network anyone could switch the logic of every token and registry behind it. This
 * authority answers the same questions and nothing else: it cannot add a version, switch one, or
 * move a proxy elsewhere, so the note's logic is the logic it was issued with.
 *
 * It answers T-REX's factory, which checks only that every implementation is set.
 */
contract FixedImplementationAuthority {
    address private immutable TOKEN;
    address private immutable CTR;
    address private immutable IR;
    address private immutable IRS;
    address private immutable TIR;
    address private immutable MC;

    error MissingImplementation();

    constructor(address token, address ctr, address ir, address irs, address tir, address mc) {
        if (token == address(0) || ctr == address(0) || ir == address(0) || irs == address(0) || tir == address(0) || mc == address(0)) {
            revert MissingImplementation();
        }
        (TOKEN, CTR, IR, IRS, TIR, MC) = (token, ctr, ir, irs, tir, mc);
    }

    function getTokenImplementation() external view returns (address) {
        return TOKEN;
    }

    function getCTRImplementation() external view returns (address) {
        return CTR;
    }

    function getIRImplementation() external view returns (address) {
        return IR;
    }

    function getIRSImplementation() external view returns (address) {
        return IRS;
    }

    function getTIRImplementation() external view returns (address) {
        return TIR;
    }

    function getMCImplementation() external view returns (address) {
        return MC;
    }

    /// @notice Never the reference authority: nothing can fetch or add versions through it.
    function isReferenceContract() external pure returns (bool) {
        return false;
    }
}
