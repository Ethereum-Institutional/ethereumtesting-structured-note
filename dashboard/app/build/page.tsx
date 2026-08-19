import Link from "next/link";
import { buildProof } from "@/lib/buildProof";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { Code } from "@/components/Code";
import { Step, Proof, Note, Prompt, ToolCall, Takeaway } from "@/components/Step";
import { Wordmark, ZMark } from "@/components/Logo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BuildPage() {
  const p = await buildProof();
  const t = p.mcp.calls?.token;
  const h = p.mcp.calls?.hook;
  const rule = p.mcp.calls?.rule;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-20 sm:p-8">
      {/* ---------------------------------------------------------------- nav */}
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

      {/* ------------------------------------------------------------- header */}
      <header className="border-t pt-8" style={{ borderColor: "var(--line-strong)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--oz-violet)" }}
        >
          How it was built
        </div>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          A compliant market for a security token,
          <br className="hidden sm:block" /> built by prompting.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Six steps from nothing to a permissioned security token trading in a Uniswap v4 pool,
          with segregated custody on top. The contracts underneath the asset and the hook were
          generated from plain-English prompts against OpenZeppelin&rsquo;s hosted MCP servers.
          Every figure on this page is read live from the chain the console runs on.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            {
              k: "Generated, not written",
              v: "The token and the hook scaffold are verbatim MCP output. No hand-editing.",
            },
            {
              k: "Audited foundations",
              v: "OpenZeppelin Contracts 5.7 and our Uniswap Hooks library sit under every line.",
            },
            {
              k: "The policy stays yours",
              v: "What no generator can produce is your compliance rule. That is step 3.",
            },
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

        {!p.ok && (
          <p
            className="mt-6 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: "rgba(255,107,107,.35)", color: "var(--bad)" }}
          >
            Live chain data unavailable: {p.reason}. The prompts and generated code below are
            unaffected.
          </p>
        )}
      </header>

      <div className="mt-14">
        {/* ------------------------------------------------------------ step 1 */}
        <Step
          n={1}
          title="Generate the asset"
          who="OpenZeppelin"
          lede="One sentence describing the instrument produces a complete permissioned token: allowlisted transfers, per-holder balance freezing, an asset-wide pause, and role-separated administration."
        >
          {t?.prompt && <Prompt>{t.prompt}</Prompt>}
          {t && <ToolCall server={t.server} tool={t.tool} params={t.params} />}
          <Code
            source={p.mcp.tokenSource || "// unavailable"}
            caption="Verbatim output &mdash; this is the file that compiles, byte for byte."
          />
          <Proof label="compiles unmodified">
            Built with solc 0.8.28 against OpenZeppelin Contracts 5.7.0 and Community Contracts
            (commit <Mono>b0ddd27</Mono>), producing a 6,437-byte runtime &mdash; comfortably inside
            the 24,576-byte deployment limit. An automated check fails the build if the code shown
            here ever drifts from the code that compiles.
          </Proof>
          <Note title="Which standard this is">
            The generator emits <strong>ERC-7943 (uRWA)</strong>, the permissioned-token standard
            OpenZeppelin ships today in Community Contracts. The live demo further down runs on a
            genuine <strong>ERC-3643</strong> asset instead, because that is the standard most APAC
            issuers already hold. Both work here: the compliance layer in step 3 is written so
            either standard plugs into the same pool. ERC-3643 support is in active co-development
            with the T-REX Network following our July 2026 partnership.
          </Note>
        </Step>

        {/* ------------------------------------------------------------ step 2 */}
        <Step
          n={2}
          title="Scaffold the Uniswap v4 hook"
          who="OpenZeppelin"
          lede="A hook is the contract a Uniswap v4 pool calls at defined moments in a trade — and which can refuse. Getting its wiring wrong fails in ways that are hard to see and expensive to find."
        >
          {h?.prompt && <Prompt>{h.prompt}</Prompt>}
          {h && <ToolCall server={h.server} tool={h.tool} params={h.params} />}
          <p className="mt-4 text-sm leading-relaxed">
            The scaffold comes back with correct inheritance from our audited{" "}
            <Mono>BaseHook</Mono>, exactly the four lifecycle callbacks that were asked for, and{" "}
            <Mono>getHookPermissions()</Mono> filled in to match them.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            That last part carries more weight than it looks. In Uniswap v4 a hook&rsquo;s{" "}
            <em>address</em> encodes its permissions &mdash; you mine a CREATE2 salt until the low
            bits of the address match the flags. If the declared flags and the deployed address
            disagree, the pool rejects the hook outright, or worse, silently never calls the
            callback you were relying on to enforce compliance. Keeping those two in step by hand
            is exactly the kind of bookkeeping that belongs in a generator.
          </p>
          <Code
            source={p.mcp.hookScaffold || "// unavailable"}
            caption="Verbatim output. The callback bodies come back as TODO by design."
          />
          <Takeaway>
            The generator produces the <strong>structure</strong>, deliberately not the rule. It
            removes the boilerplate that is easy to get catastrophically wrong and hands back a
            correct skeleton on an audited base. What goes inside the callbacks is a policy
            decision, and policy is the one thing that has to be authored.
          </Takeaway>
        </Step>

        {/* ------------------------------------------------------------ step 3 */}
        <Step
          n={3}
          title="Author the compliance rule"
          who="OpenZeppelin"
          lede="This is the gap in the market. Uniswap ships the permissions adapter, router and position manager for permissioned pools — but no production hook; the only one in their repository is a test mock. The rule deciding who may trade is the integrator's to write."
        >
          <Note title="These are not MCP calls">
            Steps 1 and 2 were generator output. This step is not. No generator can produce a
            compliance rule, because the rule <em>is</em> a specific issuer&rsquo;s policy &mdash;
            who may hold, who may trade, under whose attestation, in which jurisdictions. The
            prompts below were given to a coding agent, not to an MCP server, and the resulting
            contracts were written and reviewed as ordinary engineering work.
            <span className="mt-2 block">
              Worth being precise about in the room: OpenZeppelin&rsquo;s generators remove the
              boilerplate around the rule, not the rule itself.
            </span>
          </Note>
          <p className="mt-4 text-sm leading-relaxed">
            Three prompts turned the scaffold into working contracts. Each is written against the
            ERC-3643 call surface the venue side declares in{" "}
            <Mono>contracts/interfaces/IERC3643.sol</Mono>, so this code never has to compile the
            issuer&rsquo;s stack. About 200 lines across two contracts.
          </p>

          {rule?.prompts?.map((pr: any) => (
            <div key={pr.label} className="mt-5">
              <Prompt label={pr.label}>{pr.text}</Prompt>
              <div className="mt-1.5 text-[11px]" style={{ color: "var(--faint)" }}>
                &rarr; <Mono>{pr.output}</Mono>
              </div>
            </div>
          ))}

          <Code
            collapsedLines={20}
            source={`// ERC3643AllowlistChecker.checkAllowlist -- the whole decision, cheapest gate first

AssetPolicy memory policy = _policies[tokenAddress];
if (!policy.enabled) return PermissionFlags.NONE;

// 1. Asset-level: an issuer-paused token trades nowhere.
if (_isPaused(tokenAddress)) return PermissionFlags.NONE;

// 2. Identity-level: verified claims, wallet not frozen.
if (_isFrozen(tokenAddress, account)) return PermissionFlags.NONE;
if (!_isVerified(policy.identityRegistry, account)) return PermissionFlags.NONE;

// 3. Venue overlay: optional jurisdiction gate on top of issuer compliance.
if (policy.enforceCountry) {
    (bool ok, uint16 country) = _investorCountry(policy.identityRegistry, account);
    if (!ok || !_countryAllowed[tokenAddress][country]) return PermissionFlags.NONE;
}

PermissionFlag granted = PermissionFlags.SWAP_ALLOWED;

// Liquidity provision may demand a further attestation.
if (policy.liquidityClaimTopic == 0
    || _holdsClaim(policy.identityRegistry, account, policy.liquidityClaimTopic)) {
    granted = granted | PermissionFlags.LIQUIDITY_ALLOWED;
}
return granted;`}
            caption="contracts/ERC3643AllowlistChecker.sol &mdash; the issuer stays the source of truth."
          />

          <p className="mt-4 text-sm leading-relaxed">
            And the enforcement side, which is what actually stops a trade. Three separate refusals,
            each with a typed error naming what was missing:
          </p>
          <Code
            collapsedLines={18}
            source={`// PermissionedComplianceHook._enforceSide -- runs inside beforeSwap and beforeAddLiquidity

// Not a verified adapter => not a permissioned asset => nothing to enforce.
if (PERMISSIONS_ADAPTER_FACTORY.verifiedPermissionsAdapterOf(adapter) == address(0)) return;

IPermissionsAdapter permissionsAdapter = IPermissionsAdapter(adapter);

if (requireSwappingEnabled && !permissionsAdapter.swappingEnabled()) {
    revert SwappingDisabled(adapter);
}
if (!permissionsAdapter.allowedWrappers(router)) {
    revert UnauthorizedRouter(router, adapter);
}
if (!permissionsAdapter.isAllowed(account, required)) {
    revert NotAllowlisted(account, adapter, required);
}`}
            caption="contracts/PermissionedComplianceHook.sol &mdash; the asset is unreachable except through an authorised route, by a permitted account."
          />

          {p.ok && p.permissions.length > 0 && (
            <Proof label="live output of that function, right now">
              <table className="mt-1 w-full text-left text-[11px]">
                <tbody>
                  {p.permissions.map((r) => (
                    <tr key={r.address}>
                      <td className="py-1 pr-3">{r.label}</td>
                      <td className="py-1 pr-3">
                        <Mono>{r.flags}</Mono>
                      </td>
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
                Three different answers from one function, driven entirely by what the issuer has
                attested about each account. Nothing is configured at the venue.
              </p>
            </Proof>
          )}

          <Takeaway>
            The checker is the only piece that knows which token standard it reads. Swap it for an{" "}
            <Mono>ERC7943AllowlistChecker</Mono> and the same hook, the same adapter and the same
            pool serve the generated token from step 1. The compliance seam is the replaceable part
            &mdash; which is what makes this a product rather than a one-off integration.
          </Takeaway>
        </Step>

        {/* ------------------------------------------------------------ step 4 */}
        <Step
          n={4}
          title="Deploy the issuer stack"
          who="Tokeny"
          lede="For the live demo the asset is a genuine ERC-3643 token — Tokeny's T-REX, the standard behind roughly $28bn of tokenized assets."
        >
          <p className="text-sm leading-relaxed">
            Identity registry, a trusted KYC provider issuing signed claims, and modular compliance:
            permitted jurisdictions and a supply cap. This is the issuer&rsquo;s own infrastructure,
            deployed unmodified &mdash; the venue never compiles a line of it.
          </p>
          {p.ok && (
            <Proof label="deployed and verified on this chain">
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>{p.issuer.symbol} token</dt>
                  <dd>
                    <Mono title={p.issuer.token}>{short(p.issuer.token)}</Mono>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Identity registry</dt>
                  <dd>
                    <Mono title={p.issuer.identityRegistry}>{short(p.issuer.identityRegistry)}</Mono>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Trusted claim issuer</dt>
                  <dd>
                    <Mono title={p.issuer.claimIssuer}>{short(p.issuer.claimIssuer)}</Mono>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Total supply</dt>
                  <dd>
                    <Mono>{num(p.issuer.supply, 0)}</Mono>
                  </dd>
                </div>
              </dl>
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                {p.issuer.holders.filter((x) => x.verified).length} of {p.issuer.holders.length}{" "}
                direct holders return <Mono>isVerified() = true</Mono>:{" "}
                {p.issuer.holders
                  .map((x) => `${x.name} (${x.country}, claims ${x.claims.join("+") || "none"})`)
                  .join("; ")}
                .
              </p>
            </Proof>
          )}
        </Step>

        {/* ------------------------------------------------------------ step 5 */}
        <Step
          n={5}
          title="Onboard the venue as a holder"
          who="Uniswap"
          lede="The detail that surprises people, and the answer to how a DEX can be permitted to hold a regulated asset at all."
        >
          <p className="text-sm leading-relaxed">
            Uniswap&rsquo;s permissions adapter physically custodies the security token and mints a
            synthetic version for the pool to trade, so the restricted asset itself never sits in
            the PoolManager.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            But that means the adapter <em>holds</em> a token whose transfers are restricted. Under
            the asset&rsquo;s own rules it therefore has to be KYC&rsquo;d like anybody else: the
            issuer gave it an on-chain identity, attested it through the same trusted claim issuer
            used for investors, and registered it under a permitted jurisdiction. The venue was
            onboarded through exactly the same process as an investor, which is what makes the
            arrangement auditable end to end.
          </p>
          {p.ok && (
            <Proof label="the venue is a registered holder of record">
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Permissions adapter</dt>
                  <dd>
                    <Mono title={p.venueOnboarding.adapter}>{short(p.venueOnboarding.adapter)}</Mono>
                  </dd>
                </div>
                {p.venueOnboarding.adapterIdentity && (
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Its ONCHAINID</dt>
                    <dd>
                      <Mono title={p.venueOnboarding.adapterIdentity}>
                        {short(p.venueOnboarding.adapterIdentity)}
                      </Mono>
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>isVerified(adapter)</dt>
                  <dd>
                    <Badge tone={p.venueOnboarding.adapterVerified ? "ok" : "bad"}>
                      {String(p.venueOnboarding.adapterVerified)}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </Proof>
          )}
        </Step>

        {/* ------------------------------------------------------------ step 6 */}
        <Step
          n={6}
          title="Prove the controls actually bind"
          who="OpenZeppelin"
          lede="A compliance control nobody has tried to break is a claim, not a control. Each scenario below is an executed transaction asserting a specific institutional guarantee."
        >
          {p.tests?.suites?.length > 0 && (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={p.tests.passed === p.tests.total ? "ok" : "bad"}>
                  {p.tests.passed}/{p.tests.total} passing
                </Badge>
                <span style={{ color: "var(--muted)" }}>
                  captured from <Mono>forge test --json</Mono>, not transcribed
                </span>
              </div>
              {p.tests.suites.map((s: any) => (
                <div key={s.path} className="mt-4">
                  <div className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
                    <Mono>{s.path}</Mono>
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {s.tests.map((tc: any) => (
                      <li key={tc.name} className="flex gap-2 text-xs leading-relaxed">
                        <span
                          className="mt-[3px] shrink-0"
                          style={{ color: tc.status === "Success" ? "var(--ok)" : "var(--bad)" }}
                        >
                          {tc.status === "Success" ? "✓" : "✕"}
                        </span>
                        <span>
                          {tc.means || tc.name}{" "}
                          <span style={{ color: "var(--faint)" }}>
                            <Mono>{tc.name}</Mono>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </Step>
      </div>

      {/* ------------------------------------------------ what the MCPs changed */}
      <section
        className="mt-4 rounded-xl border p-5 sm:p-6"
        style={{ borderColor: "rgba(79,86,250,.45)", background: "rgba(79,86,250,.07)" }}
      >
        <div className="flex items-center gap-2.5">
          <ZMark size={18} />
          <h2 className="text-base font-semibold tracking-tight">What the MCP servers changed</h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed">
          Two prompts produced the asset and the hook scaffold &mdash; both on audited OpenZeppelin
          foundations, both compiling without a character being edited. The work that remained was
          the work that should remain: encoding one issuer&rsquo;s compliance policy, and proving it
          binds.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--oz-violet)" }}
            >
              Generated
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              <li>&mdash; Permissioned token: allowlist, freezing, pause, roles, permit</li>
              <li>&mdash; Hook inheritance from an audited <Mono>BaseHook</Mono></li>
              <li>&mdash; Lifecycle callbacks matched to declared permissions</li>
              <li>&mdash; Address-flag consistency, the v4 failure mode nobody sees coming</li>
            </ul>
          </div>
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--oz-cyan)" }}
            >
              Authored
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              <li>&mdash; Which registry is authoritative, and what it is asked</li>
              <li>&mdash; Which claim gates liquidity provision as against swapping</li>
              <li>&mdash; Whether the venue may overlay its own jurisdiction policy</li>
              <li>&mdash; Adversarial tests proving each control actually refuses</li>
            </ul>
          </div>
        </div>
        <p className="mt-5 text-sm leading-relaxed">
          The servers are public and hosted &mdash;{" "}
          <Mono>mcp.openzeppelin.com/contracts/solidity/mcp</Mono> and{" "}
          <Mono>mcp.openzeppelin.com/contracts/uniswap-hooks/mcp</Mono>. Point any MCP-capable
          assistant at them and the same generation is available to your engineering team.
        </p>
      </section>

      {/* --------------------------------------------------------- size table */}
      {p.ok && p.sizes.length > 0 && (
        <div className="mt-6">
          <Panel title="What is whose" subtitle="Deployed bytecode sizes, read from the chain">
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--muted)" }}
                  >
                    <th className="pb-2 pr-3 font-medium">Contract</th>
                    <th className="pb-2 pr-3 text-right font-medium">Bytes</th>
                    <th className="pb-2 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {p.sizes.map((c) => (
                    <tr key={c.address} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{c.name}</div>
                        <Mono title={c.address}>{short(c.address)}</Mono>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {c.bytes.toLocaleString()}
                      </td>
                      <td className="py-2" style={{ color: "var(--muted)" }}>
                        {c.role}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------------------ cta */}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link
          href="/"
          className="rounded px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90"
          style={{ background: "var(--oz-violet)", color: "#ffffff" }}
        >
          Now see it trade &rarr;
        </Link>
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          The console runs against this same deployment.
        </span>
      </div>

      <footer
        className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[11px]"
        style={{ borderColor: "var(--line)", color: "var(--faint)" }}
      >
        <span className="inline-flex items-center gap-2">
          <ZMark size={13} /> OpenZeppelin
        </span>
        <span>Permissioned RWA reference implementation</span>
      </footer>
    </main>
  );
}
