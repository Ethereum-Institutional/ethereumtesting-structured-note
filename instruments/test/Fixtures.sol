// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICMTATConstructor} from "debt-standard/interfaces/technical/ICMTATConstructor.sol";
import {IERC1643CMTAT} from "debt-standard/interfaces/tokenization/draft-IERC1643CMTAT.sol";
import {IRuleEngine} from "debt-standard/interfaces/engine/IRuleEngine.sol";

/// ERC-7943 as published (Final), fungible interface.
interface IERC7943Fungible is IERC165 {
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);
    event Frozen(address indexed account, uint256 amount);
    function forcedTransfer(address from, address to, uint256 amount) external returns (bool result);
    function setFrozenTokens(address account, uint256 amount) external returns (bool result);
    function canSend(address account) external view returns (bool allowed);
    function canReceive(address account) external view returns (bool allowed);
    function getFrozenTokens(address account) external view returns (uint256 amount);
    function canTransfer(address from, address to, uint256 amount) external view returns (bool allowed);
}

/// The token surface the tests drive.
interface IToken is IERC7943Fungible {
    function initialize(
        address,
        ICMTATConstructor.ERC20Attributes memory,
        ICMTATConstructor.ExtraInformationAttributes memory,
        ICMTATConstructor.Engine memory
    ) external;
    function setRuleEngine(IRuleEngine) external;
    function ruleEngine() external view returns (IRuleEngine);
    function mint(address, uint256) external;
    function burn(address, uint256) external;
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
    function pause() external;
    function paused() external view returns (bool);
    function setAddressFrozen(address, bool) external;
    function forcedTransfer(address, address, uint256, bytes calldata) external returns (bool);
    function grantRole(bytes32, address) external;
    function hasRole(bytes32, address) external view returns (bool);
    function upgradeToAndCall(address, bytes calldata) external payable;
}

library Deploy {
    /// A token behind an ERC-1967 proxy, initialised with `admin` and `gate`.
    function token(address impl, address admin, string memory symbol, uint8 decimals_, bytes32 termsHash, address gate)
        internal
        returns (IToken)
    {
        ICMTATConstructor.ERC20Attributes memory a = ICMTATConstructor.ERC20Attributes(symbol, symbol, decimals_);
        ICMTATConstructor.ExtraInformationAttributes memory x = ICMTATConstructor.ExtraInformationAttributes(
            symbol, IERC1643CMTAT.DocumentInfo("Term sheet", "ipfs://term-sheet", termsHash), ""
        );
        bytes memory init =
            abi.encodeCall(IToken.initialize, (admin, a, x, ICMTATConstructor.Engine(IRuleEngine(gate))));
        return IToken(address(new ERC1967Proxy(impl, init)));
    }
}

/// A gate with misbehaviour modes, to show that the token's views cannot revert.
contract MockGate {
    enum Mode { Normal, Revert, OutOfGas, LongReturn, NotBool, Empty }

    Mode public mode;
    mapping(address => bool) public eligible;

    function setMode(Mode m) external { mode = m; }
    function setEligible(address a, bool e) external { eligible[a] = e; }

    function _answer(bool v) internal view returns (bool) {
        Mode m = mode;
        if (m == Mode.Revert) revert("gate down");
        if (m == Mode.OutOfGas) { uint256 i; while (true) { i++; } }
        if (m == Mode.LongReturn) { assembly { mstore(0, 1) mstore(0x20, 1) return(0, 0x40) } }
        if (m == Mode.NotBool) { assembly { mstore(0, 2) return(0, 0x20) } }
        if (m == Mode.Empty) { assembly { return(0, 0) } }
        return v;
    }

    function canSend(address a) external view returns (bool) { return _answer(eligible[a]); }
    function canReceive(address a) external view returns (bool) { return _answer(eligible[a]); }
    function canTransfer(address f, address t, uint256) public view returns (bool) {
        return _answer((f == address(0) || eligible[f]) && (t == address(0) || eligible[t]));
    }
    function canTransferFrom(address, address f, address t, uint256 v) external view returns (bool) { return canTransfer(f, t, v); }
    function transferred(address f, address t, uint256 v) public view { require(canTransfer(f, t, v), "gate: not eligible"); }
    function transferred(address, address f, address t, uint256 v) external view { transferred(f, t, v); }
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
}

/// Stand-in for an institution's multi-signature wallet (ADR 0024): reports a threshold and
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

contract MockCredentialGate is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant SUPERVISOR_ROLE = keccak256("SUPERVISOR_ROLE");
    mapping(address account => string) public withdrawnFor;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function withdraw(address account, string calldata reason) external onlyRole(SUPERVISOR_ROLE) {
        withdrawnFor[account] = reason;
    }
}
