// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DemoUSDC
 * @notice Unrestricted settlement leg for the demo pool.
 * @dev Deliberately a plain ERC-20: pairing a permissioned asset against an open
 *      stablecoin shows that the hook gates only the permissioned side, which is the
 *      normal shape of a regulated-asset venue.
 */
contract DemoUSDC is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Demo USD Coin", "USDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
