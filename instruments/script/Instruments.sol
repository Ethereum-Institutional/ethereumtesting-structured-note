// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICMTATConstructor} from "debt-standard/interfaces/technical/ICMTATConstructor.sol";
import {IERC1643CMTAT} from "debt-standard/interfaces/tokenization/draft-IERC1643CMTAT.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";

import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {InstrumentGate} from "../src/InstrumentGate.sol";
import {StructuredNote} from "../src/StructuredNote.sol";
import {TokenizedDeposit} from "../src/TokenizedDeposit.sol";
import {DepositGateway, IMintBurn} from "../src/DepositGateway.sol";

interface IInitialize {
    function initialize(
        address admin,
        ICMTATConstructor.ERC20Attributes memory attributes,
        ICMTATConstructor.ExtraInformationAttributes memory information,
        ICMTATConstructor.Engine memory engine
    ) external;
}

/**
 * The instruments' deployment, in one place, so that the deploy script and the integration
 * tests build exactly the same thing.
 *
 * Roles are assigned to capacities for Wave 2 and 3. Wave 4 moves every privileged role to the
 * governance controller and the Agent's multi-signature, and the deployer renounces its admin
 * rights as its last act. Until then the deployer holds the admin role of each contract.
 *
 * Three powers are held by no one until the controller exists: upgrade (Tier 2), forced
 * transfer (the most powerful function in the system, not to sit with a single key even
 * locally), and supervisory withdrawal from the registry. No step of issuance or servicing
 * needs any of them.
 *
 * Names, symbols and the term sheet are parameters: sign-off changes configuration, not code.
 */
library Instruments {
    struct Config {
        address deployer;
        address agent;
        address accessIssuer;
        address depositAgent;
        uint40 maxValidity;
        bytes32 termSheetHash;
        string termSheetUri;
        string noteName;
        string noteSymbol;
        string depositName;
        string depositSymbol;
    }

    struct Deployed {
        IdentityRegistry registry;
        InstrumentGate noteGate;
        InstrumentGate depositGate;
        StructuredNote note;
        TokenizedDeposit deposit;
        DepositGateway gateway;
    }

    /// @dev The Agent's registrar id. Further registrars take ids from 2.
    uint16 internal constant AGENT_REGISTRAR = 1;

    /// Must be called by `c.deployer`, which receives each contract's admin role.
    function deploy(Config memory c) internal returns (Deployed memory d) {
        d.registry = new IdentityRegistry(c.deployer, c.maxValidity);
        d.registry.setRegistrar(c.accessIssuer, AGENT_REGISTRAR);

        uint32 base = d.registry.HOLD() | d.registry.SANCTIONS_CLEAR();
        uint32 regS = d.registry.REG_S();
        // The note is sold under Regulation S: both ends need the Regulation S flag.
        d.noteGate = new InstrumentGate(
            d.registry, base | d.registry.TRANSFER() | regS, base | d.registry.RECEIVE() | regS, new uint16[](0)
        );
        // The cash leg: any onboarded, screened holder.
        d.depositGate =
            new InstrumentGate(d.registry, base | d.registry.TRANSFER(), base | d.registry.RECEIVE(), new uint16[](0));

        d.note = StructuredNote(
            _proxy(
                address(new StructuredNote()),
                c.deployer,
                ICMTATConstructor.ERC20Attributes(c.noteName, c.noteSymbol, 0),
                IERC1643CMTAT.DocumentInfo("Term sheet", c.termSheetUri, c.termSheetHash),
                d.noteGate
            )
        );
        d.deposit = TokenizedDeposit(
            _proxy(
                address(new TokenizedDeposit()),
                c.deployer,
                ICMTATConstructor.ERC20Attributes(c.depositName, c.depositSymbol, 2),
                IERC1643CMTAT.DocumentInfo("", "", bytes32(0)),
                d.depositGate
            )
        );
        d.gateway = new DepositGateway(IMintBurn(address(d.deposit)), c.deployer, c.depositAgent);

        // The note: the Agent issues, services and enforces.
        bytes32[7] memory agentRoles = [
            d.note.MINTER_ROLE(),
            d.note.BURNER_ROLE(),
            d.note.PAUSER_ROLE(),
            d.note.ENFORCER_ROLE(),
            d.note.ERC20ENFORCER_ROLE(),
            d.note.SNAPSHOOTER_ROLE(),
            d.note.DOCUMENT_ROLE()
        ];
        for (uint256 i = 0; i < agentRoles.length; ++i) {
            d.note.grantRole(agentRoles[i], c.agent);
        }
        d.note.grantRole(d.note.EXTRA_INFORMATION_ROLE(), c.agent);

        // The deposit: only the gateway mints and burns; the Deposit Agent enforces.
        d.deposit.grantRole(d.deposit.MINTER_ROLE(), address(d.gateway));
        d.deposit.grantRole(d.deposit.BURNER_ROLE(), address(d.gateway));
        d.deposit.grantRole(d.deposit.PAUSER_ROLE(), c.depositAgent);
        d.deposit.grantRole(d.deposit.ENFORCER_ROLE(), c.depositAgent);
        d.deposit.grantRole(d.deposit.ERC20ENFORCER_ROLE(), c.depositAgent);
    }

    function _proxy(
        address impl,
        address admin,
        ICMTATConstructor.ERC20Attributes memory attributes,
        IERC1643CMTAT.DocumentInfo memory terms,
        InstrumentGate gate
    ) private returns (address) {
        bytes memory init = abi.encodeCall(
            IInitialize.initialize,
            (
                admin,
                attributes,
                ICMTATConstructor.ExtraInformationAttributes(attributes.symbol, terms, ""),
                ICMTATConstructor.Engine(IRuleEngine(address(gate)))
            )
        );
        return address(new ERC1967Proxy(impl, init));
    }
}
