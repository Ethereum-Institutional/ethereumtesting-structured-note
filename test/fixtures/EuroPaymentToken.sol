// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EuroPaymentToken
 * @notice Local stand-in for the third-party euro payment token the pool converts against. On the
 *         test network the issuer's own token is used, from the network file.
 * @dev A plain ERC-20 with six decimals, as the issuer's token has, which shows that the hook
 *      gates only the permissioned side of the pair. Never deployed off the local node.
 */
contract EuroPaymentToken is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Euro payment token (stand-in)", "EURPT") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
