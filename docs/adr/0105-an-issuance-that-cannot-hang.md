# 0105. An issuance that cannot hang, and can be stopped

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

On Ethereum Sepolia a note stayed "issuing" for over an hour. Nothing was sent: the Issuer's
transaction count did not move. There was no way to stop it. The site's logs are kept for 30
minutes, so the request that failed could not be traced. The code shows two faults, both
invisible locally, where a step takes under a second.

**A claim that is never released.** Before a step is sent, the site claims it by making the note's
step number negative, so two requests cannot both send it. If the request running the step is
stopped (a page may run for 300 seconds), the claim stays forever, and every later request leaves
the note alone.

**A claim read as "finished".** The Notes page asks for the next step every three seconds. A
request that found the step claimed looked up a step at the negative index, found none, and marked
the note issued while its step was still in flight. On Ethereum Sepolia, where one step can take
minutes, that happened on every poll.

## Decision

**A claim records when it was taken.** While it is younger than six minutes (longer than any page
may run), polls leave the note alone and never mark it issued. An older claim belongs to a request
that was stopped: it is released, the error says so, and the step runs again. With the issuance
safe to run again (ADR 0103), the rerun picks up a note that did land.

**Staff can stop an issuance.** "Stop issuing…" on the Notes page marks the note failed, with who
stopped it and at which step. Its step number moves beyond every step, so a request still in
flight cannot record itself afterwards. Whatever reached the chain stays there.

**The step shown while one is in flight** is the one being run, not the one after it.

## Consequences

**Tests:**
- **Integration:** a poll leaves a step in flight alone; a claim older than six minutes is released and the step runs; a stopped issuance stays stopped, a late write from the step in flight is refused, and only the Agent's staff may stop one.
- **Browser spec 16:** a note stuck mid-step stays issuing through the page's polls; staff stop it, and it shows as failed with the reason.

**Starting fresh.** The site's database was emptied once these changes were live (the owner's
request), so the stuck notes went with it. Notes already on the chain stay there.
