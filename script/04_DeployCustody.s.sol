// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {CustodyAccount} from "../contracts/CustodyAccount.sol";
import {CustodyAccountFactory} from "../contracts/CustodyAccountFactory.sol";
import {PoolCredentialRegistry} from "../contracts/PoolCredentialRegistry.sol";
import {EuroPaymentToken} from "../test/fixtures/EuroPaymentToken.sol";
import {Manifest} from "./Manifest.sol";
import {Admission} from "./Admission.sol";

interface IIdentityRegistryWriter {
    function HOLD() external view returns (uint32);
    function RECEIVE() external view returns (uint32);
    function TRANSFER() external view returns (uint32);
    function SANCTIONS_CLEAR() external view returns (uint32);
    function CONTRACT_ACCOUNT() external view returns (uint32);
    function REG_S() external view returns (uint32);
    function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 ref, bytes32 commitment)
        external;
}

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * Stands up the Custodian and its segregated client accounts, then onboards them. That ordering
 * is the real one: the Custodian opens the account, then the Access Issuer accepts it.
 *
 * - SEG-0001 and SEG-0002: onboarded to the instruments and admitted to the pool, on the
 *   Custodian's entity credential and each account's own contract signature (ADR 0036).
 * - SEG-0003: onboarded to the deposit, not admitted to the pool: the pool's own perimeter.
 * - SEG-0004: opened and funded with the payment token, onboarded nowhere: the control case.
 *
 * On the local node the Issuer mints the payment token stand-in to every account. Elsewhere the
 * accounts are funded before this script runs.
 */
contract DeployCustody is Script {
    uint40 constant GRANT_VALIDITY = 180 days;

    function run() external {
        uint256 custodianPk = vm.envUint("CUSTODIAN_PK");
        address custodian = vm.addr(custodianPk);
        string memory j = Manifest.read();

        string[4] memory refs = ["SEG-0001", "SEG-0002", "SEG-0003", "SEG-0004"];

        vm.startBroadcast(custodianPk);
        CustodyAccountFactory factory = new CustodyAccountFactory(custodian);
        address[] memory accts = new address[](refs.length);
        for (uint256 i = 0; i < refs.length; ++i) {
            accts[i] = factory.createAccount(refs[i]);
        }
        vm.stopBroadcast();
        console2.log("custodian      :", custodian);
        console2.log("custody factory:", address(factory));

        _onboard(j, accts);
        _fund(j, accts);
        _approve(j, custodianPk, accts);
        _record(custodian, address(factory), refs, accts);
    }

    function _onboard(string memory j, address[] memory accts) internal {
        IIdentityRegistryWriter r = IIdentityRegistryWriter(vm.parseJsonAddress(j, ".instruments.registry"));
        PoolCredentialRegistry gate = PoolCredentialRegistry(vm.parseJsonAddress(j, ".venue.credentialGate"));
        bytes32 entity = keccak256(bytes(vm.parseJsonString(j, ".credentialProtocol.corporateIdentitySchema")));
        bytes32 screening = keccak256(bytes(vm.parseJsonString(j, ".credentialProtocol.screeningSchema")));

        vm.startBroadcast(vm.envUint("ACCESS_ISSUER_PK"));
        uint32 holder = r.HOLD() | r.RECEIVE() | r.TRANSFER() | r.SANCTIONS_CLEAR() | r.CONTRACT_ACCOUNT();
        uint40 until = uint40(block.timestamp) + GRANT_VALIDITY;
        r.grant(accts[0], holder | r.REG_S(), 276, until, "ONB-0011", bytes32(0));
        r.grant(accts[1], holder | r.REG_S(), 276, until, "ONB-0012", bytes32(0));
        r.grant(accts[2], holder, 276, until, "ONB-0013", bytes32(0));
        gate.grant(Admission.attest(accts[0], true, entity, screening, "DE", 2, "CRD-0011"));
        gate.grant(Admission.attest(accts[1], true, entity, screening, "DE", 2, "CRD-0012"));
        vm.stopBroadcast();
    }

    function _fund(string memory j, address[] memory accts) internal {
        IDepositGateway gateway = IDepositGateway(vm.parseJsonAddress(j, ".instruments.gateway"));
        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        gateway.credit(accts[0], 500_000_00, "CUS-0001");
        gateway.credit(accts[1], 500_000_00, "CUS-0002");
        gateway.credit(accts[2], 500_000_00, "CUS-0003");
        vm.stopBroadcast();

        if (!Manifest.isLocal()) return;
        EuroPaymentToken token = EuroPaymentToken(vm.parseJsonAddress(j, ".assets.paymentToken.address"));
        vm.startBroadcast(vm.envUint("ISSUER_PK"));
        for (uint256 i = 0; i < accts.length; ++i) {
            token.mint(accts[i], 500_000e6);
        }
        vm.stopBroadcast();
    }

    /// The Custodian sets each account's approvals, batched as one action per client. The
    /// account onboarded nowhere cannot approve a spender on the deposit, so it approves the
    /// payment token only.
    function _approve(string memory j, uint256 custodianPk, address[] memory accts) internal {
        address deposit = vm.parseJsonAddress(j, ".assets.deposit.address");
        address payment = vm.parseJsonAddress(j, ".assets.paymentToken.address");
        address permit2 = vm.parseJsonAddress(j, ".venue.permit2");
        address router = vm.parseJsonAddress(j, ".venue.router");
        address posm = vm.parseJsonAddress(j, ".venue.positionManager");

        vm.startBroadcast(custodianPk);
        for (uint256 i = 0; i < accts.length; ++i) {
            bool withDeposit = i < 3;
            CustodyAccount.Call[] memory calls = new CustodyAccount.Call[](withDeposit ? 6 : 3);
            calls[0] = CustodyAccount.Call(payment, 0, abi.encodeCall(IERC20.approve, (permit2, type(uint256).max)));
            calls[1] = _permit(permit2, payment, router);
            calls[2] = _permit(permit2, payment, posm);
            if (withDeposit) {
                calls[3] = CustodyAccount.Call(deposit, 0, abi.encodeCall(IERC20.approve, (permit2, type(uint256).max)));
                calls[4] = _permit(permit2, deposit, router);
                calls[5] = _permit(permit2, deposit, posm);
            }
            CustodyAccount(payable(accts[i])).execute(calls);
        }
        vm.stopBroadcast();
    }

    function _permit(address permit2, address token, address spender) internal pure returns (CustodyAccount.Call memory) {
        return CustodyAccount.Call(
            permit2, 0, abi.encodeCall(IAllowanceTransfer.approve, (token, spender, type(uint160).max, type(uint48).max))
        );
    }

    function _record(address custodian, address factory, string[4] memory refs, address[] memory accts) internal {
        string memory a = "accounts";
        for (uint256 i = 0; i < accts.length - 1; ++i) {
            console2.log(refs[i], accts[i]);
            vm.serializeAddress(a, refs[i], accts[i]);
        }
        string memory accounts = vm.serializeAddress(a, refs[accts.length - 1], accts[accts.length - 1]);

        string memory obj = "custody";
        vm.serializeAddress(obj, "custodian", custodian);
        vm.serializeAddress(obj, "factory", factory);
        string memory out = vm.serializeString(obj, "accounts", accounts);
        vm.writeJson(out, Manifest.path(), ".custody");
    }
}
