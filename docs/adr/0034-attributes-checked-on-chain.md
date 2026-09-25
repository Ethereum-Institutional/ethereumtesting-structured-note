# 0034. The attester's attribute values are checked against the policy on-chain

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The attester has read the attributes off-chain. It can submit the values and let the contract
check them, or assert only that a policy was met.

## Options considered

| Option | Summary |
|---|---|
| Values checked on-chain | The attester submits jurisdiction, investor class, the pass or fail of each check, and the screening time; the contract checks them and stores none of them. |
| Assertion only | The attester submits "meets the policy"; nothing personal reaches the chain, but the match cannot be checked there. |

## Decision

The contract checks the submitted values against the policy and refuses a mismatch, naming it.
It stores only the path, the two credential identifiers, the expiry and an evidence hash.

## Why

The configured parameters are then enforced where a reviewer can test them, rather than only in
off-chain configuration.

## Consequences

- The values remain in the grant transaction's input. For a natural person that is pseudonymous personal data: residence jurisdiction and investor class linked to an address. **Scenario S-36 ("no personal data in any contract or event") must be narrowed for the person path**, or the path left unused on a public network. For an entity it is not personal data.
- No names, document numbers, dates of birth or other identity data are ever submitted.
