# 0068. A browser wallet binds in one click: address read, chain switched or added, message proposed

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026
- **Amends:** ADRs 0052 and 0056 (how routes 2 and 3 prove the wallet)

## Context

Route 2 asked the client to type a wallet address, then sign on a second screen. Route 3 needed
a second scan, for a wallet-control credential the officer had to obtain elsewhere first. A browser
wallet such as MetaMask can supply the address itself. It signs EIP-712 data only on the chain the
data names, so it must first be on the pool's chain.

## Decision

On routes 2 and 3 the wallet step is one button, **Connect MetaMask and bind…**, which:
1. asks the wallet for its address;
2. switches it to the pool's chain, adding the chain (EIP-3085) if the wallet does not know it;
3. has the bank prepare its wallet-attestation message for that address;
4. proposes the message for signature, and submits the signature.

- **Route 2:** the bank issues the wallet-control credential as before.
- **Route 3:** after the officer's credential is verified by scan, the officer's wallet signs.
  The bank issues the wallet-control credential to the officer's DID, and the assessment is the
  same as for a presented credential.

The other ways stay, folded under the button: a typed address with a pasted signature, or a
contract wallet, for route 2; a second scan presenting a wallet-control credential, for route 3.

## Why

It is how clients already use wallets, and it removes the step most likely to go wrong: a typed
address, or a signature on the wrong chain.

## Consequences

- The site needs, per chain, what a wallet needs to add it (`lib/chains.ts`).
- The browser tests' wallet behaves like MetaMask: it starts on mainnet, refuses an unknown chain
  (4902), and refuses to sign for any chain but the active one.
- A contract wallet still binds through the pasted-signature way; a browser wallet is an ordinary key.
