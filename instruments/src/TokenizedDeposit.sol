// SPDX-License-Identifier: MPL-2.0
pragma solidity 0.8.34;

import {AdaptedToken} from "./base/AdaptedToken.sol";

/**
 * @title TokenizedDeposit
 * @notice The cash leg: a simulated tokenized deposit, modelled as a liability of the
 *         institution holding it. Created on credit to an account, extinguished on debit.
 *
 * On the same adapted composition as the note, so both legs of a settlement are tested the
 * same way against the same registry, through each instrument's own gate. Initialised with
 * decimals two. Carries no snapshot or holder list.
 *
 * Mint and burn are held only by the deposit gateway ({DepositGateway}), which stands in for a
 * deposit service. No party mints or burns the deposit directly.
 *
 * Valueless and simulated. It is not a deposit, and represents no institution's liability.
 */
contract TokenizedDeposit is AdaptedToken {}
