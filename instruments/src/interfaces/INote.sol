// SPDX-License-Identifier: MPL-2.0
pragma solidity ^0.8.24;

/**
 * The note's surface as an ERC-3643 token (T-REX), declared here so that the lifecycle and
 * governance contracts reach it through an interface and never compile T-REX's code into their
 * own (ADR 0087).
 */

/// @dev The agent powers T-REX lets a token's owner switch off, one agent at a time (ADR 0085).
///      Field for field T-REX's `TokenRoles`, so the two encode identically.
struct AgentRestrictions {
    bool disableMint;
    bool disableBurn;
    bool disablePartialFreeze;
    bool disableAddressFreeze;
    bool disableRecovery;
    bool disableForceTransfer;
    bool disablePause;
}

interface INote {
    // ERC-20
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);

    // ERC-3643
    function identityRegistry() external view returns (address);
    function compliance() external view returns (address);
    function paused() external view returns (bool);
    function isFrozen(address account) external view returns (bool);
    function getFrozenTokens(address account) external view returns (uint256);

    // agents
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function pause() external;
    function unpause() external;
    function forcedTransfer(address from, address to, uint256 amount) external returns (bool);
    function freezePartialTokens(address account, uint256 amount) external;
    function unfreezePartialTokens(address account, uint256 amount) external;
    function setAddressFrozen(address account, bool frozen) external;
    function recoveryAddress(address lostWallet, address newWallet, address identity) external returns (bool);

    // owner
    function addAgent(address agent) external;
    function removeAgent(address agent) external;
    function isAgent(address agent) external view returns (bool);
    function setAgentRestrictions(address agent, AgentRestrictions calldata restrictions) external;
    function getAgentRestrictions(address agent) external view returns (AgentRestrictions memory);
}

/// @dev An ERC-3643 identity registry, as far as eligibility is read from it.
interface IVerifies {
    function isVerified(address account) external view returns (bool);
}

/// @dev An ERC-3643 compliance, as far as a transfer is tested against it.
interface ICompliance {
    function canTransfer(address from, address to, uint256 value) external view returns (bool);
}

/// @dev Two-step ownership, as T-REX's contracts and the venue's have it.
interface IOwnable2Step {
    function transferOwnership(address newOwner) external;
    function acceptOwnership() external;
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

/// @dev The note's record dates (RecordDateModule).
interface IRecordDates {
    function balanceAt(address account, uint256 time) external view returns (uint256);
    function totalSupplyAt(uint256 time) external view returns (uint256);
    function transfersOpen() external view returns (bool);
    function sync(address[] calldata accounts) external;
}
