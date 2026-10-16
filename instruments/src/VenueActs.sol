// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

/// @dev The venue's contracts are in the other compilation unit; the controller reaches them here.
interface IGovernedChecker {
    function setCredentialGate(address token, address gate) external;
    function setLiquidityApproved(address token, address account, bool approved) external;
}

interface IGovernedAdapter {
    function updateAllowedWrapper(address wrapper, bool allowed) external;
    function updateAllowedHook(address hook, bool allowed) external;
    function updateSwappingEnabled(bool enabled) external;
}

/// @dev The pool's gate: supervisory withdrawal over the pool's identity registry.
interface IGovernedPoolGate {
    function withdraw(address account, string calldata reason) external;
    function restore(address account, string calldata reason) external;
    function registry() external view returns (address);
}

interface IPoolRegistry {
    function issuersRegistry() external view returns (address);
}

interface IPoolIssuers {
    function addTrustedIssuer(address issuer, uint256[] calldata topics) external;
    function removeTrustedIssuer(address issuer) external;
}

/**
 * @title VenueActs
 * @notice The governance controller's Tier 2 acts on the conversion venue, kept in a library of
 *         their own so that the controller stays under the contract size limit. Called by
 *         delegatecall, so every downstream call is the controller's own.
 */
library VenueActs {
    uint256 private constant POOL_ACCESS = uint256(keccak256("claim.pool-access"));

    /**
     * @notice Carries out one venue act. `act` counts from the gate: 0 the credential gate, 1 a
     *         liquidity provider, 2 a router or position manager, 3 a hook, 4 a pool issuer.
     * @return gate The pool's gate after the act.
     */
    function act(uint8 act_, bytes memory args, address checker, address adapter, address deposit, address gate)
        external
        returns (address)
    {
        if (act_ == 0) {
            address next = abi.decode(args, (address));
            IGovernedChecker(checker).setCredentialGate(deposit, next);
            return next;
        } else if (act_ == 1) {
            (address account, bool approved) = abi.decode(args, (address, bool));
            IGovernedChecker(checker).setLiquidityApproved(deposit, account, approved);
        } else if (act_ == 2) {
            (address wrapper, bool allowed) = abi.decode(args, (address, bool));
            IGovernedAdapter(adapter).updateAllowedWrapper(wrapper, allowed);
        } else if (act_ == 3) {
            (address hook, bool allowed) = abi.decode(args, (address, bool));
            IGovernedAdapter(adapter).updateAllowedHook(hook, allowed);
        } else {
            (address issuer, bool trusted) = abi.decode(args, (address, bool));
            IPoolIssuers issuers = IPoolIssuers(IPoolRegistry(IGovernedPoolGate(gate).registry()).issuersRegistry());
            if (!trusted) {
                issuers.removeTrustedIssuer(issuer);
            } else {
                uint256[] memory topics = new uint256[](1);
                topics[0] = POOL_ACCESS;
                issuers.addTrustedIssuer(issuer, topics);
            }
        }
        return gate;
    }
}
