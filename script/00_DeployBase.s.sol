// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {EuroPaymentToken} from "../test/fixtures/EuroPaymentToken.sol";
import {Manifest} from "./Manifest.sol";

/**
 * Starts the address manifest with the parties, the network, the euro payment token and the
 * credential protocol's registries.
 *
 * On the local node: deploys the payment token stand-in, puts proxies in front of the protocol's
 * released registry code (installed by ops/setup-credential-protocol.sh, ADR 0040), and registers
 * the local credential issuer. Investor D is funded but never onboarded: the control case.
 *
 * Anywhere else: reads the network file named by NETWORK_FILE (ADR 0029) and deploys nothing.
 */
contract DeployBase is Script {
    address constant ISSUER_REGISTRY_IMPL = 0x4A1A49BBB0042F75541D44297A8746525d9B05Ac;
    address constant REVOCATION_REGISTRY_IMPL = 0xa8E508d587702b2fAdA23f9c55F277E1B29EDE33;

    string constant LOCAL_ISSUER_DID = "did:example:credential-issuer";
    uint256 constant ML_DSA_65_PUBKEY_LENGTH = 1952;
    uint256 constant ML_KEM_768_PUBKEY_LENGTH = 1184;

    struct Base {
        address poolManager;
        address weth;
        address paymentToken;
        string paymentSymbol;
        uint256 paymentDecimals;
        address issuers;
        address revocations;
        string issuerDid;
        string corporateIdentitySchema;
        string passportSchema;
        string screeningSchema;
    }

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        Base memory b = Manifest.isLocal() ? _local(issuerPk) : _network();
        _record(b);
    }

    function _local(uint256 issuerPk) internal returns (Base memory b) {
        address issuer = vm.addr(issuerPk);
        address credentialIssuer = vm.addr(vm.envUint("CREDENTIAL_ISSUER_PK"));

        vm.startBroadcast(issuerPk);
        EuroPaymentToken token = new EuroPaymentToken(issuer);
        token.mint(vm.addr(vm.envUint("INVESTOR_A_PK")), 2_000_000e6);
        token.mint(vm.addr(vm.envUint("INVESTOR_B_PK")), 500_000e6);
        token.mint(vm.addr(vm.envUint("INVESTOR_C_PK")), 500_000e6);
        token.mint(vm.addr(vm.envUint("INVESTOR_D_PK")), 500_000e6);
        token.mint(vm.addr(vm.envUint("DEPOSIT_AGENT_PK")), 1_000_000e6); // seeds the pool

        address issuers = address(
            new ERC1967Proxy(ISSUER_REGISTRY_IMPL, abi.encodeWithSignature("initialize(address)", issuer))
        );
        address revocations = address(
            new ERC1967Proxy(
                REVOCATION_REGISTRY_IMPL, abi.encodeWithSignature("initialize(address,address)", issuer, issuers)
            )
        );
        // No signature is ever checked on-chain, so the keys are placeholders of the right length.
        (bool ok,) = issuers.call(
            abi.encodeWithSignature(
                "registerIssuer(string,bytes,bytes,address)",
                LOCAL_ISSUER_DID,
                new bytes(ML_DSA_65_PUBKEY_LENGTH),
                new bytes(ML_KEM_768_PUBKEY_LENGTH),
                credentialIssuer
            )
        );
        require(ok, "issuer registration failed");
        vm.stopBroadcast();

        b.paymentToken = address(token);
        b.paymentSymbol = token.symbol();
        b.paymentDecimals = token.decimals();
        b.issuers = issuers;
        b.revocations = revocations;
        b.issuerDid = LOCAL_ISSUER_DID;
        b.corporateIdentitySchema = "schema:corporate-identity/v1";
        b.passportSchema = "schema:passport/v1";
        b.screeningSchema = "schema:screening/v1";
    }

    function _network() internal view returns (Base memory b) {
        string memory n = vm.readFile(vm.envString("NETWORK_FILE"));
        require(vm.parseJsonUint(n, ".chainId") == block.chainid, "network file is for another chain");
        b.poolManager = vm.parseJsonAddress(n, ".poolManager");
        b.weth = vm.parseJsonAddress(n, ".weth");
        b.paymentToken = vm.parseJsonAddress(n, ".paymentToken.address");
        b.paymentSymbol = vm.parseJsonString(n, ".paymentToken.symbol");
        b.paymentDecimals = vm.parseJsonUint(n, ".paymentToken.decimals");
        b.issuers = vm.parseJsonAddress(n, ".credentialProtocol.issuers");
        b.revocations = vm.parseJsonAddress(n, ".credentialProtocol.revocations");
        b.issuerDid = vm.parseJsonString(n, ".credentialProtocol.issuerDid");
        b.corporateIdentitySchema = vm.parseJsonString(n, ".schemas.corporateIdentity");
        b.passportSchema = vm.parseJsonString(n, ".schemas.passport");
        b.screeningSchema = vm.parseJsonString(n, ".schemas.screening");
    }

    function _record(Base memory b) internal {
        string memory p = "parties";
        vm.serializeAddress(p, "issuer", vm.addr(vm.envUint("ISSUER_PK")));
        vm.serializeAddress(p, "agent", vm.addr(vm.envUint("AGENT_PK")));
        vm.serializeAddress(p, "custodian", vm.addr(vm.envUint("CUSTODIAN_PK")));
        vm.serializeAddress(p, "investorA", vm.addr(vm.envUint("INVESTOR_A_PK")));
        vm.serializeAddress(p, "investorB", vm.addr(vm.envUint("INVESTOR_B_PK")));
        vm.serializeAddress(p, "investorC", vm.addr(vm.envUint("INVESTOR_C_PK")));
        vm.serializeAddress(p, "accessIssuer", vm.addr(vm.envUint("ACCESS_ISSUER_PK")));
        vm.serializeAddress(p, "depositAgent", vm.addr(vm.envUint("DEPOSIT_AGENT_PK")));
        string memory parties = vm.serializeAddress(p, "investorD", vm.addr(vm.envUint("INVESTOR_D_PK")));

        string memory t = "paymentToken";
        vm.serializeAddress(t, "address", b.paymentToken);
        vm.serializeString(t, "symbol", b.paymentSymbol);
        string memory token = vm.serializeUint(t, "decimals", b.paymentDecimals);
        string memory assets = vm.serializeString("assets", "paymentToken", token);

        string memory w = "network";
        vm.serializeBool(w, "local", Manifest.isLocal());
        vm.serializeAddress(w, "poolManager", b.poolManager);
        string memory network = vm.serializeAddress(w, "weth", b.weth);

        string memory c = "credentialProtocol";
        vm.serializeAddress(c, "issuers", b.issuers);
        vm.serializeAddress(c, "revocations", b.revocations);
        vm.serializeString(c, "issuerDid", b.issuerDid);
        vm.serializeString(c, "corporateIdentitySchema", b.corporateIdentitySchema);
        vm.serializeString(c, "passportSchema", b.passportSchema);
        string memory protocol = vm.serializeString(c, "screeningSchema", b.screeningSchema);

        string memory m = "manifest";
        vm.serializeUint(m, "chainId", block.chainid);
        vm.serializeString(m, "parties", parties);
        vm.serializeString(m, "network", network);
        vm.serializeString(m, "credentialProtocol", protocol);
        string memory out = vm.serializeString(m, "assets", assets);
        vm.writeJson(out, Manifest.path());

        console2.log("payment token      :", b.paymentToken);
        console2.log("issuer registry    :", b.issuers);
        console2.log("revocation registry:", b.revocations);
    }
}
