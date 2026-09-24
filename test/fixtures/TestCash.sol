// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestCash
 * @notice Stand-in for an unrestricted cash leg, so the venue can be exercised before the
 *         instruments exist. Valueless, and not a representation of any real currency token.
 * @dev A plain ERC-20, which shows that the hook gates only the permissioned side of a pair.
 */
contract TestCash is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Test cash", "CASH") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
