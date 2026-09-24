// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {RestrictedAsset} from "../test/fixtures/RestrictedAsset.sol";
import {TestCash} from "../test/fixtures/TestCash.sol";

/**
 * Deploys the stand-in asset and cash leg the venue is exercised against, and starts the
 * address manifest.
 *
 * Both are test fixtures. The instruments replace them; until then they let the venue's
 * controls be shown binding. Investor D is funded but never made eligible: the control case,
 * whose refusal can only come from the gate.
 */
contract DeployStandIns is Script {
    function run() external {
        uint256 issuerPk = vm.envUint("ISSUER_PK");
        address issuer = vm.addr(issuerPk);
        address agent = vm.addr(vm.envUint("AGENT_PK"));
        address investorA = vm.addr(vm.envUint("INVESTOR_A_PK"));
        address investorB = vm.addr(vm.envUint("INVESTOR_B_PK"));
        address investorC = vm.addr(vm.envUint("INVESTOR_C_PK"));
        address investorD = vm.addr(vm.envUint("INVESTOR_D_PK"));
        address custodian = vm.addr(vm.envUint("CUSTODIAN_PK"));

        vm.startBroadcast(issuerPk);
        RestrictedAsset asset = new RestrictedAsset("Stand-in restricted asset", "ASSET", issuer, agent);
        TestCash cash = new TestCash(issuer);

        asset.setEligible(investorA, true);
        asset.setEligible(investorB, true);
        asset.setEligible(investorC, true);
        asset.mint(investorA, 200_000e18); // half of it seeds the pool
        asset.mint(investorB, 10_000e18);
        asset.mint(investorC, 10_000e18);

        cash.mint(investorA, 40_000_000e6);
        cash.mint(investorB, 500_000e6);
        cash.mint(investorC, 500_000e6);
        cash.mint(investorD, 500_000e6);
        vm.stopBroadcast();

        console2.log("asset:", address(asset));
        console2.log("cash :", address(cash));

        string memory p = "parties";
        vm.serializeAddress(p, "issuer", issuer);
        vm.serializeAddress(p, "agent", agent);
        vm.serializeAddress(p, "custodian", custodian);
        vm.serializeAddress(p, "investorA", investorA);
        vm.serializeAddress(p, "investorB", investorB);
        vm.serializeAddress(p, "investorC", investorC);
        string memory parties = vm.serializeAddress(p, "investorD", investorD);

        string memory assets = vm.serializeString(
            "assets", "venueAsset", _asset("venueAsset", address(asset), "ASSET", 18)
        );
        assets = vm.serializeString("assets", "cash", _asset("cash", address(cash), "CASH", 6));

        string memory m = "manifest";
        vm.serializeUint(m, "chainId", block.chainid);
        vm.serializeString(m, "parties", parties);
        string memory out = vm.serializeString(m, "assets", assets);
        vm.writeJson(out, "ops/addresses.json");
    }

    function _asset(string memory key, address token, string memory symbol, uint256 decimals)
        private
        returns (string memory)
    {
        vm.serializeAddress(key, "address", token);
        vm.serializeString(key, "symbol", symbol);
        return vm.serializeUint(key, "decimals", decimals);
    }
}
