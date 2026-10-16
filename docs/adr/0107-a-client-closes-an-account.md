# 0107. A client asks to close an account; the bank closes it

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner asked whether a participant should be able to unregister an account, on any of the
routes: the bank's custody, a third-party custodian, or its own wallet. Removing a wallet from the
identity registries is an agent's act: the bank's for the deposit, the onboarding agent's for the
note. No client wallet can do it, on any route. The bank could already offboard a wallet, with a
reason: that revokes its claim and removes the wallet from every registry. A wallet so removed can
neither receive nor sell, so closing one that still holds something would strand it.

## Decision

**The client asks, and the bank closes the account.** On the Onboard page, "Close this account…"
takes a reason. The request appears on Bank → Onboarding with its reason, beside a "Close the
account as asked" button that runs the bank's offboarding. The client can withdraw a request until
the bank acts on it. This holds for every route, custody accounts included: a custodian has no
separate step, since the registry entry is the bank's to remove.

**Refused while anything is held or owed, and checked again when the bank closes.** That covers:
- the deposit;
- units of any note on the factory's record, units an offer locks included;
- an amount the Paying Agent holds for the account;
- a coupon or redemption not yet paid that the account is a holder of record for.

The refusal says which.

**The records stay.** Closing ends the registration and the bank's claim. The bank's KYB record and
the audit log remain, as the bank must keep them.

| Option | Outcome |
|---|---|
| The client asks, the bank closes, refused while anything is held or owed | **Chosen by the owner** |
| The client unregisters at once | Not possible. Only a registry's agents may remove a wallet |
| No request: the client asks the bank outside the site | Not chosen. Nothing records the request, and nothing checks what the account holds |

## Consequences

**A self-custody client** also owns its identity, and can withdraw its consent there itself. Only
the registry entry needs the bank.

**Tests:**
- **Integration:** holding the deposit, the request is refused; holding nothing, it is asked, withdrawn, asked again and closed by the bank, after which the wallet is in no registry. A custody account holding units is refused, the units named.
- **Browser spec 03:** the client asks, the bank sees the request, and the client withdraws it.
- **Browser spec 18:** an account holding the note is refused.
