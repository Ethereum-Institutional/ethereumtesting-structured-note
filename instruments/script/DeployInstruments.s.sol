// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {Script, console2} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {Instruments} from "./Instruments.sol";

/**
 * Deploys the instruments, onboards the local cast, and opens their deposit accounts.
 *
 * Run from instruments/ after the venue stack, whose manifest it extends. Onboarding here is the
 * Access Issuer writing grants directly, standing in for the presentation and verification that
 * precede a grant in operation. Investor C is onboarded for the cash leg only, without the
 * Regulation S flag, so it can hold the deposit but not the note. Investor D is never onboarded.
 */
contract DeployInstruments is Script {
    string constant MANIFEST = "../ops/addresses.json";
    uint40 constant MAX_VALIDITY = 365 days;
    uint40 constant GRANT_VALIDITY = 180 days;

    function run() external {
        uint256 deployerPk = vm.envUint("ISSUER_PK");
        uint256 accessIssuerPk = vm.envUint("ACCESS_ISSUER_PK");
        uint256 depositAgentPk = vm.envUint("DEPOSIT_AGENT_PK");
        address issuer = vm.addr(deployerPk);
        address agent = vm.addr(vm.envUint("AGENT_PK"));
        address depositAgent = vm.addr(depositAgentPk);
        string memory j = vm.readFile(MANIFEST);

        vm.startBroadcast(deployerPk);
        Instruments.Deployed memory d = Instruments.deploy(
            Instruments.Config({
                deployer: issuer,
                agent: agent,
                accessIssuer: vm.addr(accessIssuerPk),
                depositAgent: depositAgent,
                maxValidity: MAX_VALIDITY,
                // Local defaults. On any other chain each value must be set explicitly
                // (ADR 0027), so nothing unreviewed is written to a public network.
                termSheetHash: _hashParam("TERM_SHEET_HASH", keccak256("term sheet, draft")),
                termSheetUri: _param("TERM_SHEET_URI", "pending"),
                noteName: _param("NOTE_NAME", "EUR Worst-of Autocallable Note"),
                noteSymbol: _param("NOTE_SYMBOL", "EURWAN"),
                depositName: _param("DEPOSIT_NAME", "Euro Tokenized Deposit"),
                depositSymbol: _param("DEPOSIT_SYMBOL", "EURTD")
            })
        );
        vm.stopBroadcast();

        IdentityRegistry r = d.registry;
        uint32 holder = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR();
        uint32 noteHolder = holder | r.REG_S();
        uint32 custody = r.CONTRACT_ACCOUNT();

        vm.startBroadcast(accessIssuerPk);
        _grant(r, issuer, noteHolder, "Issuer inventory");
        _grant(r, vm.parseJsonAddress(j, ".parties.investorA"), noteHolder | r.PROFESSIONAL(), "investor A");
        _grant(r, vm.parseJsonAddress(j, ".parties.investorB"), noteHolder, "investor B");
        _grant(r, vm.parseJsonAddress(j, ".parties.investorC"), holder, "investor C");
        if (vm.keyExistsJson(j, ".custody.accounts")) {
            _grant(r, vm.parseJsonAddress(j, '.custody.accounts["CLIENT-A"]'), noteHolder | custody, "CLIENT-A");
            _grant(r, vm.parseJsonAddress(j, '.custody.accounts["CLIENT-B"]'), noteHolder | custody, "CLIENT-B");
            _grant(r, vm.parseJsonAddress(j, '.custody.accounts["CLIENT-C"]'), holder | custody, "CLIENT-C");
        }
        vm.stopBroadcast();

        // Opening balances on the cash leg, each against its own booking.
        vm.startBroadcast(depositAgentPk);
        d.gateway.credit(vm.parseJsonAddress(j, ".parties.investorA"), 5_000_000_00, "opening/investorA");
        d.gateway.credit(vm.parseJsonAddress(j, ".parties.investorB"), 1_000_000_00, "opening/investorB");
        d.gateway.credit(vm.parseJsonAddress(j, ".parties.investorC"), 1_000_000_00, "opening/investorC");
        vm.stopBroadcast();

        console2.log("registry   :", address(d.registry));
        console2.log("note       :", address(d.note));
        console2.log("deposit    :", address(d.deposit));
        console2.log("gateway    :", address(d.gateway));
        _record(d, vm.addr(accessIssuerPk), depositAgent);
    }

    /// @dev The local node's chain id. Anywhere else, including a fork of a public network,
    ///      a missing value stops the deployment.
    uint256 constant LOCAL_CHAIN_ID = 31337;

    function _param(string memory key, string memory localDefault) private view returns (string memory) {
        if (block.chainid == LOCAL_CHAIN_ID) return vm.envOr(key, localDefault);
        return vm.envString(key);
    }

    function _hashParam(string memory key, bytes32 localDefault) private view returns (bytes32) {
        if (block.chainid == LOCAL_CHAIN_ID) return vm.envOr(key, localDefault);
        return vm.envBytes32(key);
    }

    function _grant(IdentityRegistry r, address account, uint32 flags, string memory ref) private {
        r.grant(account, flags, 276, uint40(block.timestamp) + GRANT_VALIDITY, keccak256(bytes(ref)), bytes32(0));
    }

    function _record(Instruments.Deployed memory d, address accessIssuer, address depositAgent) private {
        string memory o = "instruments";
        vm.serializeAddress(o, "registry", address(d.registry));
        vm.serializeAddress(o, "noteGate", address(d.noteGate));
        vm.serializeAddress(o, "depositGate", address(d.depositGate));
        vm.serializeAddress(o, "note", address(d.note));
        vm.serializeAddress(o, "deposit", address(d.deposit));
        vm.writeJson(vm.serializeAddress(o, "gateway", address(d.gateway)), MANIFEST, ".instruments");

        vm.writeJson(_token("note", address(d.note), d.note.symbol(), 0), MANIFEST, ".assets.note");
        vm.writeJson(_token("deposit", address(d.deposit), d.deposit.symbol(), 2), MANIFEST, ".assets.deposit");
        vm.writeJson(vm.toString(accessIssuer), MANIFEST, ".parties.accessIssuer");
        vm.writeJson(vm.toString(depositAgent), MANIFEST, ".parties.depositAgent");
    }

    function _token(string memory key, address token, string memory symbol, uint256 decimals)
        private
        returns (string memory)
    {
        vm.serializeAddress(key, "address", token);
        vm.serializeString(key, "symbol", symbol);
        return vm.serializeUint(key, "decimals", decimals);
    }
}
