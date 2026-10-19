// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// Stand-in for an institution's multi-signature wallet: reports a threshold and
/// executes calls for its owner. The integration test uses the real wallet.
contract MockWallet {
    uint256 public threshold;
    address private immutable _owner;

    constructor(uint256 threshold_) {
        threshold = threshold_;
        _owner = msg.sender;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }

    function setThreshold(uint256 t) external {
        require(msg.sender == _owner, "not owner");
        threshold = t;
    }

    function exec(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == _owner, "not owner");
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }
}

/// Stand-ins for the venue's contracts, which are in the other compilation unit. Each records
/// what the controller asked of it, under the same ownership model as the real contract.
contract MockVenueChecker is Ownable2Step {
    mapping(address token => address) public credentialGate;
    mapping(address token => mapping(address account => bool)) public liquidityApproved;

    constructor(address owner_) Ownable(owner_) {}

    function setCredentialGate(address token, address gate) external onlyOwner {
        credentialGate[token] = gate;
    }

    function setLiquidityApproved(address token, address account, bool approved) external onlyOwner {
        liquidityApproved[token][account] = approved;
    }
}

contract MockVenueAdapter is Ownable2Step {
    bool public swappingEnabled = true;
    mapping(address => bool) public allowedWrappers;
    mapping(address => bool) public allowedHooks;

    constructor(address owner_) Ownable(owner_) {}

    function updateSwappingEnabled(bool enabled) external onlyOwner {
        swappingEnabled = enabled;
    }

    function updateAllowedWrapper(address wrapper, bool allowed) external onlyOwner {
        allowedWrappers[wrapper] = allowed;
    }

    function updateAllowedHook(address hook, bool allowed) external onlyOwner {
        allowedHooks[hook] = allowed;
    }
}

/// The pool's gate as the controller sees it: supervisory withdrawal over an identity registry.
contract MockCredentialGate is AccessControl {
    bytes32 public constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");
    address public immutable registry;
    mapping(address account => string) public withdrawnFor;
    mapping(address account => string) public restoredFor;

    constructor(address admin, address registry_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
    }

    function withdraw(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        withdrawnFor[account] = reason;
    }

    function restore(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        restoredFor[account] = reason;
    }
}
