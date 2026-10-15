// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {EuroPaymentToken} from "../test/fixtures/EuroPaymentToken.sol";
import {Manifest} from "./Manifest.sol";

/**
 * Starts the address manifest with the parties, the network and the euro payment token.
 *
 * On the local node: deploys the payment token stand-in, which only the optional conversion pool
 * uses (plan 0.2.0, decision 3). Investor D is funded but never onboarded: the control case.
 *
 * Anywhere else: reads the network file named by NETWORK_FILE (ADR 0029) and deploys nothing.
 *
 * Onboarding rests on ERC-3643 identities and claims (ADR 0088), which the instruments deploy; no
 * external credential service is involved.
 */
contract DeployBase is Script {
    struct Base {
        address poolManager;
        address weth;
        address paymentToken;
        string paymentSymbol;
        uint256 paymentDecimals;
    }

    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        Base memory b = Manifest.isLocal() ? _local(issuerPk) : _network();
        _record(b);
    }

    function _local(uint256 issuerPk) internal returns (Base memory b) {
        address issuer = vm.addr(issuerPk);

        vm.startBroadcast(issuerPk);
        EuroPaymentToken token = new EuroPaymentToken(issuer);
        token.mint(vm.addr(vm.envUint("INVESTOR_A_PK")), 2_000_000e6);
        token.mint(vm.addr(vm.envUint("INVESTOR_B_PK")), 500_000e6);
        token.mint(vm.addr(vm.envUint("INVESTOR_C_PK")), 500_000e6);
        token.mint(vm.addr(vm.envUint("INVESTOR_D_PK")), 500_000e6);
        token.mint(vm.addr(vm.envUint("DEPOSIT_AGENT_PK")), 1_000_000e6); // seeds the pool

        vm.stopBroadcast();

        b.paymentToken = address(token);
        b.paymentSymbol = token.symbol();
        b.paymentDecimals = token.decimals();
    }

    function _network() internal view returns (Base memory b) {
        string memory n = vm.readFile(vm.envString("NETWORK_FILE"));
        require(vm.parseJsonUint(n, ".chainId") == block.chainid, "network file is for another chain");
        b.poolManager = vm.parseJsonAddress(n, ".poolManager");
        b.weth = vm.parseJsonAddress(n, ".weth");
        b.paymentToken = vm.parseJsonAddress(n, ".paymentToken.address");
        b.paymentSymbol = vm.parseJsonString(n, ".paymentToken.symbol");
        b.paymentDecimals = vm.parseJsonUint(n, ".paymentToken.decimals");
    }

    function _record(Base memory b) internal {
        string memory p = "parties";
        vm.serializeAddress(p, "issuer", vm.addr(vm.envUint("ISSUER_PK")));
        vm.serializeAddress(p, "agent", vm.addr(vm.envUint("AGENT_PK")));
        vm.serializeAddress(p, "custodian", vm.addr(vm.envUint("CUSTODIAN_PK")));
        vm.serializeAddress(p, "thirdPartyCustodian", vm.addr(vm.envUint("THIRD_PARTY_CUSTODIAN_PK")));
        vm.serializeAddress(p, "investorA", vm.addr(vm.envUint("INVESTOR_A_PK")));
        vm.serializeAddress(p, "investorB", vm.addr(vm.envUint("INVESTOR_B_PK")));
        vm.serializeAddress(p, "investorC", vm.addr(vm.envUint("INVESTOR_C_PK")));
        vm.serializeAddress(p, "onboardingAgent", vm.addr(vm.envUint("ACCESS_ISSUER_PK")));
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

        string memory m = "manifest";
        vm.serializeUint(m, "chainId", block.chainid);
        vm.serializeString(m, "parties", parties);
        vm.serializeString(m, "network", network);
        string memory out = vm.serializeString(m, "assets", assets);
        vm.writeJson(out, Manifest.path());

        console2.log("payment token:", b.paymentToken);
    }
}
