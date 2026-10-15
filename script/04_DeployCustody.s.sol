// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {CustodyAccount} from "../contracts/CustodyAccount.sol";
import {CustodyAccountFactory} from "../contracts/CustodyAccountFactory.sol";
import {EuroPaymentToken} from "../test/fixtures/EuroPaymentToken.sol";
import {Manifest} from "./Manifest.sol";
import {PoolAccess} from "./PoolAccess.sol";

/// ONCHAINID and ERC-3643, as far as onboarding a custody account needs them. The instruments
/// are in the other compilation unit; this script reaches them over ABI.
interface IIdFactory {
    function createIdentityWithManagementKeys(address wallet, string memory salt, bytes32[] memory managementKeys)
        external
        returns (address);
}

interface IIdentity {
    function addKey(bytes32 key, uint256 purpose, uint256 keyType) external returns (bool);
    function addClaim(uint256 topic, uint256 scheme, address issuer, bytes memory signature, bytes memory data, string memory uri)
        external
        returns (bytes32);
}

interface IIdentityRegistry {
    function registerIdentity(address wallet, address identity, uint16 country) external;
}

interface IDepositGateway {
    function credit(address account, uint256 amount, bytes32 bookingRef) external;
}

/**
 * Stands up two custodians and their segregated client accounts, then onboards the accounts by
 * role (ADR 0089). That ordering is the real one: the custodian opens the account, then the
 * institutions vouch for it.
 *
 * - **The bank's custody platform** (the Custodian's key) opens SEG-0001 to SEG-0004.
 * - **A third-party custodian** opens TPC-0001.
 *
 * For each account, the bank creates its identity, managed by the account's custodian, since key
 * custody follows custody. The custodian records the client's consent to the bank and the
 * onboarding agent as claim keys. The bank then vouches for the deposit, and the onboarding agent
 * for the note:
 * - SEG-0001, SEG-0002 and TPC-0001: onboarded for the deposit and the note;
 * - SEG-0003: the deposit only;
 * - SEG-0004: opened and funded with the payment token, onboarded nowhere: the control case.
 *
 * Where the conversion pool is deployed (ADR 0090), the bank admits SEG-0001 and SEG-0002 to it, and each of the bank's accounts sets its trading approvals.
 */
contract DeployCustody is Script {
    uint256 constant CLAIM = 3;
    uint256 constant ECDSA = 1;
    uint48 constant CLAIM_VALIDITY = 180 days;
    uint16 constant COUNTRY = 276;

    struct Keys {
        uint256 bankCustody;
        uint256 thirdParty;
        uint256 bank;
        uint256 onboarding;
    }

    function run() external {
        Keys memory k = Keys(
            vm.envUint("CUSTODIAN_PK"),
            vm.envUint("THIRD_PARTY_CUSTODIAN_PK"),
            vm.envUint("DEPOSIT_AGENT_PK"),
            vm.envUint("ACCESS_ISSUER_PK")
        );
        string memory j = Manifest.read();

        string[4] memory segRefs = ["SEG-0001", "SEG-0002", "SEG-0003", "SEG-0004"];
        (CustodyAccountFactory bankFactory, address[] memory seg) = _open(k.bankCustody, segRefs);
        string[] memory tpc = new string[](1);
        tpc[0] = "TPC-0001";
        (CustodyAccountFactory thirdFactory, address[] memory third) = _openList(k.thirdParty, tpc);

        _onboard(j, k, k.bankCustody, seg[0], true);
        _onboard(j, k, k.bankCustody, seg[1], true);
        _onboard(j, k, k.bankCustody, seg[2], false);
        _onboard(j, k, k.thirdParty, third[0], true);

        _fund(j, seg, third[0]);
        if (vm.keyExistsJson(j, ".venue.permit2")) {
            vm.startBroadcast(k.bank);
            PoolAccess.admit(j, k.bank, seg[0]);
            PoolAccess.admit(j, k.bank, seg[1]);
            vm.stopBroadcast();
            _approve(j, k.bankCustody, seg);
        }

        _record(vm.addr(k.bankCustody), address(bankFactory), segRefs, seg, vm.addr(k.thirdParty), address(thirdFactory), third[0]);
    }

    function _open(uint256 custodianPk, string[4] memory refs) internal returns (CustodyAccountFactory f, address[] memory accts) {
        string[] memory list = new string[](refs.length);
        for (uint256 i = 0; i < refs.length; ++i) list[i] = refs[i];
        return _openList(custodianPk, list);
    }

    function _openList(uint256 custodianPk, string[] memory refs)
        internal
        returns (CustodyAccountFactory f, address[] memory accts)
    {
        vm.startBroadcast(custodianPk);
        f = new CustodyAccountFactory(vm.addr(custodianPk));
        accts = new address[](refs.length);
        for (uint256 i = 0; i < refs.length; ++i) accts[i] = f.createAccount(refs[i]);
        vm.stopBroadcast();
    }

    /// The bank creates the account's identity, managed by its custodian, and registers it; the
    /// custodian consents for its client; the institutions vouch.
    function _onboard(string memory j, Keys memory k, uint256 custodianPk, address account, bool forNote) internal {
        address bank = vm.addr(k.bank);
        address onboarding = vm.addr(k.onboarding);
        bytes32[] memory managers = new bytes32[](1);
        managers[0] = keccak256(abi.encode(vm.addr(custodianPk)));

        vm.startBroadcast(k.bank);
        IIdentity id = IIdentity(
            IIdFactory(vm.parseJsonAddress(j, ".identity.idFactory")).createIdentityWithManagementKeys(
                account, vm.toString(account), managers
            )
        );
        IIdentityRegistry(vm.parseJsonAddress(j, ".identity.depositRegistry")).registerIdentity(account, address(id), COUNTRY);
        vm.stopBroadcast();

        vm.startBroadcast(custodianPk);
        id.addKey(keccak256(abi.encode(bank)), CLAIM, ECDSA);
        if (forNote) id.addKey(keccak256(abi.encode(onboarding)), CLAIM, ECDSA);
        vm.stopBroadcast();

        _vouch(k.bank, id, vm.parseJsonAddress(j, ".identity.bankIssuer"), vm.parseJsonUint(j, ".identity.depositEligibleTopic"), account);
        if (forNote) {
            _vouch(k.onboarding, id, vm.parseJsonAddress(j, ".identity.onboardingIssuer"), vm.parseJsonUint(j, ".identity.noteEligibleTopic"), account);
        }
    }

    /// The institution signs its claim over the identity, the topic and the data, and adds it.
    function _vouch(uint256 pk, IIdentity id, address issuer, uint256 topic, address account) internal {
        bytes memory data = abi.encode(
            uint48(block.timestamp), uint48(block.timestamp) + CLAIM_VALIDITY, keccak256(abi.encode(account, topic, "verified record"))
        );
        bytes32 hash = keccak256(abi.encode(address(id), topic, data));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)));
        vm.startBroadcast(pk);
        id.addClaim(topic, 1, issuer, abi.encodePacked(r, s, v), data, "");
        vm.stopBroadcast();
    }

    function _fund(string memory j, address[] memory seg, address third) internal {
        IDepositGateway gateway = IDepositGateway(vm.parseJsonAddress(j, ".instruments.gateway"));
        vm.startBroadcast(vm.envUint("DEPOSIT_AGENT_PK"));
        gateway.credit(seg[0], 500_000_00, "CUS-0001");
        gateway.credit(seg[1], 500_000_00, "CUS-0002");
        gateway.credit(seg[2], 500_000_00, "CUS-0003");
        gateway.credit(third, 500_000_00, "CUS-0011");
        vm.stopBroadcast();

        if (!Manifest.isLocal()) return;
        EuroPaymentToken token = EuroPaymentToken(vm.parseJsonAddress(j, ".assets.paymentToken.address"));
        vm.startBroadcast(vm.envUint("ISSUER_PK"));
        for (uint256 i = 0; i < seg.length; ++i) {
            token.mint(seg[i], 500_000e6);
        }
        vm.stopBroadcast();
    }

    /// With the pool deployed, the bank's custody platform sets each account's approvals, batched
    /// as one action per client. The account onboarded nowhere cannot approve a spender on the
    /// deposit, so it approves the payment token only.
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

    function _record(
        address custodian,
        address factory,
        string[4] memory refs,
        address[] memory accts,
        address thirdParty,
        address thirdFactory,
        address thirdAccount
    ) internal {
        string memory a = "accounts";
        for (uint256 i = 0; i < accts.length - 1; ++i) {
            console2.log(refs[i], accts[i]);
            vm.serializeAddress(a, refs[i], accts[i]);
        }
        string memory accounts = vm.serializeAddress(a, refs[accts.length - 1], accts[accts.length - 1]);

        string memory t = "thirdParty";
        vm.serializeAddress(t, "custodian", thirdParty);
        vm.serializeAddress(t, "factory", thirdFactory);
        string memory third = vm.serializeAddress(t, "TPC-0001", thirdAccount);
        console2.log("TPC-0001", thirdAccount);

        string memory obj = "custody";
        vm.serializeAddress(obj, "custodian", custodian);
        vm.serializeAddress(obj, "factory", factory);
        vm.serializeString(obj, "thirdParty", third);
        string memory out = vm.serializeString(obj, "accounts", accounts);
        vm.writeJson(out, Manifest.path(), ".custody");
    }
}
