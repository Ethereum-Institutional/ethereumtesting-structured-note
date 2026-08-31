import Link from "next/link";
import { buildProof } from "@/lib/buildProof";
import { Badge, Mono } from "@/components/ui";
import { Code } from "@/components/Code";
import { Step, Prompt, Proof } from "@/components/Step";
import { Wordmark, ZMark } from "@/components/Logo";
import { GuideBar, type GuideStep } from "@/components/GuideBar";
import { ArchDiagram } from "@/components/ArchDiagram";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * "How it was built", as a pitch rather than an essay: five steps, each one glance long,
 * with the prompts as the star of the show and a presenter guide bar to walk an audience
 * through it live. The deep-dive material (bytecode sizes, standards footnotes, full test
 * listings) was cut deliberately — this page opens the meeting; the console closes it.
 */

const GUIDE: GuideStep[] = [
  {
    target: "problem",
    title: "Open with their problem",
    say: "Every bank we talk to asks some version of this question, and the usual answer is that you pick one — a real market, or a compliant one. We built both, and it's running behind this page.",
    act: "Point at the four requirement cards and promise the room each one gets demonstrated live before the meeting ends.",
  },
  {
    target: "architecture",
    title: "The whole machine, one picture",
    say: "Three parties, one market: the investor's route down the left, Uniswap's live pool along the bottom, the issuer's Tokeny identity stack on the right — and the OpenZeppelin row in the middle joining them: the custody accounts, the hook, the bridge.",
    act: "Click through the scenarios — watch the pulse trace the real call flow: a trade, a freeze, a jurisdiction block.",
    watch: "Every coloured label names whose technology each piece is. The highlighted middle row is OpenZeppelin — the pieces that make the other two talk.",
  },
  {
    target: "prompt-token",
    title: "One sentence became the asset",
    say: "We didn't write the security token. We described the instrument in one sentence to OpenZeppelin's contract generator — and what came back compiles untouched, on audited OpenZeppelin foundations: allowlisted transfers, freezing, pause, role-based administration.",
    act: "Read the prompt aloud — it is the entire input.",
  },
  {
    target: "prompt-hook",
    title: "One sentence became the gatekeeper",
    say: "Same again for the Uniswap v4 hook — the contract the pool consults before every trade. The generator does the wiring that is dangerous to hand-write: in v4 a hook's address must encode its permissions, and getting that wrong fails silently.",
  },
  {
    target: "rule",
    title: "The one part you must own",
    say: "No generator can write your compliance policy — the rule is the issuer's. About 200 lines connect the pool to the issuer's ERC-3643 identity registry, the T-REX standard behind roughly $28bn of tokenized assets.",
    watch: "The table below is that rule answering live from the chain right now: three accounts, three different permissions, driven entirely by what the issuer has attested.",
  },
  {
    target: "tests",
    title: "Proven, not promised",
    say: "A control nobody has tried to break is a claim, not a control. Thirteen adversarial tests attack every gate — unverified wallets, frozen clients, KYC-only investors trying to provide liquidity — against the live chain.",
    watch: "13/13 passing, captured from the test runner itself, not transcribed.",
  },
  {
    target: "cta",
    title: "Now watch it trade",
    act: "Open the live console and press PRESENT DEMO — the walkthrough continues on the market itself.",
  },
];

export default async function BuildPage() {
  const p = await buildProof();
  const t = p.mcp.calls?.token;
  const h = p.mcp.calls?.hook;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-20 sm:p-8">
      <nav className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Wordmark size={19} />
        <Link
          href="/"
          className="rounded border px-3 py-1.5 text-xs transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}
        >
          Open the live console &rarr;
        </Link>
      </nav>

      <header className="border-t pt-8" style={{ borderColor: "var(--line-strong)" }} data-tour="problem">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--oz-violet)" }}
        >
          The problem
        </div>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          So you want to tokenize a fund
          <br className="hidden sm:block" /> and trade it on Uniswap.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Say you&rsquo;re a bank. Clients want a tokenized money-market fund they can actually
          trade. Compliance needs today&rsquo;s rules to keep working on-chain. Usually you&rsquo;re
          told to pick one.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            { k: "Every holder is KYC'd", v: "Checked at every trade, not just at onboarding." },
            { k: "Jurisdictions can be switched off", v: "Block Japan, and Japan stops trading. Immediately." },
            { k: "Transfer-agent powers stay", v: "Freeze, pause, force-transfer, recover." },
            { k: "And it's a real market", v: "Genuine Uniswap liquidity, in the open." },
          ].map((c) => (
            <div
              key={c.k}
              className="rounded-lg border p-3"
              style={{ borderColor: "var(--line)", background: "var(--panel)" }}
            >
              <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                {c.k}
              </div>
              <div className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {c.v}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed">
          <span className="font-semibold">We built it.</span>{" "}
          <span style={{ color: "var(--muted)" }}>
            Two prompts for the contracts. ~200 lines of policy. 13 tests that try to break it.
            Every number below is a live read from the chain, not a screenshot.
          </span>
        </p>
        {!p.ok && (
          <p
            className="mt-6 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: "rgba(255,107,107,.35)", color: "var(--bad)" }}
          >
            Live chain data unavailable: {p.reason}. The prompts below are unaffected.
          </p>
        )}
      </header>

      <section data-tour="architecture" className="mt-10">
        <div
          className="rounded-xl border p-4 sm:p-5"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider">The architecture, live</h2>
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              pick a scenario — the pulse traces the real call flow
            </span>
          </div>
          <ArchDiagram />
        </div>
      </section>

      <div className="mt-12">
        <div data-tour="prompt-token">
          <Step
            n={1}
            title="One prompt → the security token"
            who="OpenZeppelin"
            lede="One sentence in. A complete permissioned token out."
          >
            {t?.prompt && <Prompt>{t.prompt}</Prompt>}
            <Proof label="compiles untouched">
              Verbatim generator output, on audited OpenZeppelin Contracts.
            </Proof>
            <Code
              collapsedLines={6}
              source={p.mcp.tokenSource || "// unavailable"}
              caption="Expand if someone asks."
            />
          </Step>
        </div>

        <div data-tour="prompt-hook">
          <Step
            n={2}
            title="One prompt → the market's gatekeeper"
            who="OpenZeppelin"
            lede="The hook is the contract the pool asks before every trade — and which can refuse. Generated on OpenZeppelin's audited BaseHook."
          >
            {h?.prompt && <Prompt>{h.prompt}</Prompt>}
            <Proof label="why generate it">
              In v4, a hook&rsquo;s <em>address</em> must encode its permissions. Get it wrong and
              compliance silently never runs. A generator&rsquo;s job, not a human&rsquo;s.
            </Proof>
          </Step>
        </div>

        <div data-tour="rule">
          <Step
            n={3}
            title="The one part you must own: the rule"
            who="OpenZeppelin"
            lede="No generator writes your policy. ~200 lines, reading the issuer's ERC-3643 registry — the standard behind ~$28bn of tokenized assets."
          >
            <Code
              collapsedLines={10}
              source={`// The whole decision, cheapest gate first — asked before every trade.

if (_isPaused(tokenAddress))                       return NONE;  // issuer paused the asset
if (_isFrozen(tokenAddress, account))              return NONE;  // agent froze this wallet
if (!_isVerified(policy.identityRegistry, account)) return NONE; // passport not verified
if (policy.enforceCountry && !_countryAllowed[token][country])
                                                   return NONE;  // venue blocked the jurisdiction

granted = SWAP_ALLOWED;
if (_holdsClaim(account, policy.liquidityClaimTopic))
    granted |= LIQUIDITY_ALLOWED;                  // accredited → may also provide liquidity
return granted;`}
              caption="contracts/ERC3643AllowlistChecker.sol — the venue asks; the issuer's registry answers."
            />
            {p.ok && p.permissions.length > 0 && (
              <Proof label="that rule answering live, right now">
                <table className="mt-1 w-full text-left text-[11px]">
                  <tbody>
                    {p.permissions.map((r) => (
                      <tr key={r.address}>
                        <td className="py-1 pr-3">{r.label}</td>
                        <td className="py-1 pr-3">
                          <span className="flex gap-1">
                            <Badge tone={r.swap ? "ok" : "bad"}>swap</Badge>
                            <Badge tone={r.liquidity ? "ok" : "bad"}>LP</Badge>
                          </span>
                        </td>
                        <td className="py-1" style={{ color: "var(--muted)" }}>
                          {r.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2" style={{ color: "var(--muted)" }}>
                  One function, three answers — all from the issuer&rsquo;s attestations.
                </p>
              </Proof>
            )}
          </Step>
        </div>

        <div data-tour="tests">
          <Step
            n={4}
            title="Prove it refuses"
            who="OpenZeppelin"
            lede="A control nobody tried to break is a claim. These tests attack every gate."
          >
            {p.tests?.total > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={p.tests.passed === p.tests.total ? "ok" : "bad"}>
                  {p.tests.passed}/{p.tests.total} passing
                </Badge>
                <span style={{ color: "var(--muted)" }}>
                  captured from <Mono>forge test --json</Mono>, not transcribed
                </span>
              </div>
            )}
            <ul className="mt-3 space-y-1.5 text-sm leading-relaxed">
              {[
                "An unverified wallet can't reach the asset by any route.",
                "KYC-only investors can trade — but can't provide liquidity.",
                "Freeze one client; the others keep trading.",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-[3px] shrink-0" style={{ color: "var(--ok)" }}>
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Step>
        </div>
      </div>

      <div data-tour="cta" className="mt-10">
        <div
          className="rounded-xl border p-6 text-center"
          style={{ borderColor: "rgba(79,86,250,.45)", background: "rgba(79,86,250,.07)" }}
        >
          <div className="mx-auto flex items-center justify-center gap-2.5">
            <ZMark size={18} />
            <h2 className="text-base font-semibold tracking-tight">Now watch it trade</h2>
          </div>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Same deployment, live. Press <strong>Present demo</strong> there — a trade settles, a
            wallet freezes, the pool refuses on its own.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded px-6 py-2.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90"
            style={{ background: "var(--oz-violet)", color: "#ffffff" }}
          >
            Open the live console &rarr;
          </Link>
        </div>
      </div>

      <footer
        className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[11px]"
        style={{ borderColor: "var(--line)", color: "var(--faint)" }}
      >
        <span className="inline-flex items-center gap-2">
          <ZMark size={13} /> OpenZeppelin
        </span>
        <span>
          Generators: <Mono>mcp.openzeppelin.com</Mono> · public and hosted
        </span>
      </footer>

      <GuideBar steps={GUIDE} label="Present walkthrough" hint="finish on the console — Present demo continues there" />
    </main>
  );
}
