// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;

import {TREXFactory} from "t-rex/factory/TREXFactory.sol";
import {IIdentityRegistryStorage} from "t-rex/registry/interface/IIdentityRegistryStorage.sol";

/**
 * @title ProgrammeTREXFactory
 * @notice T-REX's factory, with the one act a programme needs that it lacks (ADR 0115): unbinding
 *         a matured note's identity registry from the shared identity storage. The storage binds at
 *         most 300 registries, and only its owner, this factory, may unbind one; T-REX's own factory
 *         offers no way to.
 *
 * Its owner is the note factory, which unbinds only a note that has redeemed, and only on the
 * governance controller's act.
 *
 * Licensed GPL-3.0 because it extends T-REX's factory (ADR 0087).
 */
contract ProgrammeTREXFactory is TREXFactory {
    constructor(address implementationAuthority_, address idFactory_) TREXFactory(implementationAuthority_, idFactory_) {}

    /// @notice Unbinds a note's identity registry from the shared identity storage.
    function unbindIdentityRegistry(address identityStorage, address identityRegistry) external onlyOwner {
        IIdentityRegistryStorage(identityStorage).unbindIdentityRegistry(identityRegistry);
    }
}
