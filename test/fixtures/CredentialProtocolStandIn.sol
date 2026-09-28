// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ICredentialIssuers, ICredentialRevocations} from "../../contracts/interfaces/ICredentialProtocol.sol";

/**
 * @notice Both of the credential protocol's registries in one small contract, for the gate's unit
 *         tests. The local stack runs the protocol's released code instead (ADR 0040).
 * @dev Can be told to revert, to show that the gate's writes fail rather than pass.
 */
contract CredentialProtocolStandIn is ICredentialIssuers, ICredentialRevocations {
    mapping(bytes32 did => bool) public active;
    mapping(bytes32 did => mapping(bytes32 credential => bool)) public revoked;
    mapping(bytes32 did => bytes32) public root;
    mapping(bytes32 did => uint256) public rootTime;
    bool public broken;

    function setActive(string calldata did, bool a) external {
        active[keccak256(bytes(did))] = a;
    }

    function setRevoked(string calldata did, bytes32 credential, bool r) external {
        revoked[keccak256(bytes(did))][credential] = r;
    }

    function publishRoot(string calldata did, bytes32 r) external {
        root[keccak256(bytes(did))] = r;
        rootTime[keccak256(bytes(did))] = block.timestamp;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function isActive(string calldata did) external view returns (bool) {
        require(!broken, "broken");
        return active[keccak256(bytes(did))];
    }

    function isRevoked(string calldata did, bytes32 credential) external view returns (bool) {
        require(!broken, "broken");
        return revoked[keccak256(bytes(did))][credential];
    }

    function currentRoot(string calldata did) external view returns (bytes32) {
        return root[keccak256(bytes(did))];
    }

    function isRootRecent(string calldata did, bytes32 r, uint256 windowSec) external view returns (bool) {
        bytes32 id = keccak256(bytes(did));
        return r != bytes32(0) && root[id] == r && block.timestamp - rootTime[id] <= windowSec;
    }
}
