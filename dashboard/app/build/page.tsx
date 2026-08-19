import Link from "next/link";
import { buildProof } from "@/lib/buildProof";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { Code } from "@/components/Code";
import { Step, Proof, Caveat } from "@/components/Step";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BuildPage() {
  const p = await buildProof();
  const t = p.mcp.calls?.token;
  const h = p.mcp.calls?.hook;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-16">
      <nav className="mb-6 flex items-center gap-3 text-xs">
        <Link href="/" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          &larr; Live console
        </Link>
        <span style={{ color: "var(--muted)" }}>You are on: how it was built</span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Building a compliant market for a security token</h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Six steps from nothing to an ERC-3643 security token trading in a permissioned Uniswap
          v4 pool, with segregated custody on top. Every figure below is read live from the chain
          the console runs on &mdash; not written down here.
        </p>
        {!p.ok && (
          <p className="mt-3 rounded border px-3 py-2 text-xs"
            style={{ borderColor: "rgba(255,107,107,.35)", color: "var(--bad)" }}>
            Live proof unavailable: {p.reason} &mdash; the generated code below is still accurate.
          </p>
        )}
      </header>

      <div className="mt-10">
        <Step n={1} title="Generate the token" who="OpenZeppelin">
          <p className="text-sm leading-relaxed">
            One call to the hosted Contracts MCP produces a complete permissioned RWA token:
            per-account allow/disallow, balance freezing, forced pause, role-separated admin.
            No hand-editing.
          </p>
          {t && (
            <Code
              collapsedLines={22}
              source={`// ${t.server}\n// tool: ${t.tool}\n${JSON.stringify(t.params, null, 2)}`}
              caption="The exact call. Recorded in content/mcp/calls.json."
            />
          )}
          <Code
            source={p.mcp.tokenSource || "// unavailable"}
            caption="Verbatim output &mdash; this is the file that compiles, byte for byte."
          />
          <Proof label="compiles unmodified">
            Built with solc 0.8.28 against OpenZeppelin Contracts 5.7.0 and community-contracts
            (commit <Mono>b0ddd27</Mono>), producing a 6,437-byte runtime &mdash; comfortably inside
            the 24,576-byte limit. A check (<Mono>ops/check-mcp-artifacts.sh</Mono>) fails if the
            code shown here ever drifts from the code that compiles.
          </Proof>
          <Caveat>
            This is <strong>ERC-7943 (uRWA)</strong>, not ERC-3643. ERC-3643 is not in
            OpenZeppelin Contracts yet &mdash; the T-REX Network partnership (July 2026) is
            co-development in progress. Say &ldquo;a permissioned RWA token&rdquo;, not
            &ldquo;an ERC-3643 token&rdquo;, when describing MCP output.
          </Caveat>
        </Step>

        <Step n={2} title="Generate the Uniswap hook" who="OpenZeppelin">
          <p className="text-sm leading-relaxed">
            A second MCP call scaffolds the v4 hook: correct inheritance from our audited{" "}
            <Mono>BaseHook</Mono>, the four lifecycle callbacks this job needs, and{" "}
            <Mono>getHookPermissions()</Mono> filled in to match.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            That last part is worth pointing at. A v4 hook&apos;s <em>address</em> encodes its
            permissions &mdash; you mine a CREATE2 salt until the low bits match. If the flags and
            the address disagree, the pool rejects the hook outright. The MCP keeps them in step.
          </p>
          {h && (
            <Code
              collapsedLines={16}
              source={`// ${h.server}\n// tool: ${h.tool}\n${JSON.stringify(h.params, null, 2)}`}
            />
          )}
          <Code
            source={p.mcp.hookScaffold || "// unavailable"}
            caption="Verbatim output. Note the TODO bodies."
          />
          <Caveat>
            The MCP generates the <strong>scaffold</strong>, not the compliance rule &mdash; the
            callback bodies come back as <Mono>// TODO: Implement</Mono>. Do not say the MCP
            integrates a permissioned token with Uniswap for you. What it does is remove the
            boilerplate that is easy to get catastrophically wrong, and hand you a correct
            skeleton. The rule itself is step 3.
          </Caveat>
        </Step>

        <Step n={3} title="Write the compliance rule" who="OpenZeppelin">
          <p className="text-sm leading-relaxed">
            This is the gap in the market. Uniswap ships the adapter, router and position manager
            for permissioned pools &mdash; but no production hook; the only one in their repository
            is a test mock. So the rule deciding who may trade is the integrator&apos;s to write,
            and it is what we built.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            Two contracts, about 200 lines. A checker that answers{" "}
            <em>&ldquo;what may this account do with this asset?&rdquo;</em> by reading the{" "}
            <strong>issuer&apos;s</strong> registry, and a hook that enforces the answer on every
            swap and every liquidity add.
          </p>
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
            caption="contracts/ERC3643AllowlistChecker.sol -- the issuer stays the source of truth."
          />
          {p.ok && p.permissions.length > 0 && (
            <Proof label="live output of that function, right now">
              <table className="mt-1 w-full text-left text-[11px]">
                <tbody>
                  {p.permissions.map((r) => (
                    <tr key={r.address}>
                      <td className="py-1 pr-3">{r.label}</td>
                      <td className="py-1 pr-3"><Mono>{r.flags}</Mono></td>
                      <td className="py-1 pr-3">
                        <span className="flex gap-1">
                          <Badge tone={r.swap ? "ok" : "bad"}>swap</Badge>
                          <Badge tone={r.liquidity ? "ok" : "bad"}>LP</Badge>
                        </span>
                      </td>
                      <td className="py-1" style={{ color: "var(--muted)" }}>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                Three different answers from one function, driven entirely by what the issuer has
                attested about each account.
              </p>
            </Proof>
          )}
          <div className="mt-3 rounded border p-3" style={{ borderColor: "var(--line)", background: "var(--panel-2)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
              Why this shape matters
            </div>
            <p className="mt-1.5 text-xs leading-relaxed">
              The checker is the only piece that knows which token standard it reads. Swap it for{" "}
              <Mono>ERC7943AllowlistChecker</Mono> and the same hook, same adapter and same pool
              serve the MCP-generated token from step 1. The compliance seam is the replaceable
              part &mdash; which is what makes this a product rather than a one-off integration.
            </p>
          </div>
        </Step>

        <Step n={4} title="Deploy the issuer stack" who="Tokeny">
          <p className="text-sm leading-relaxed">
            For the live demo the asset is a genuine ERC-3643 token &mdash; Tokeny&apos;s T-REX, the
            standard behind roughly $28bn of tokenized assets. Identity registry, a trusted KYC
            provider issuing signed claims, and modular compliance: permitted jurisdictions and a
            supply cap.
          </p>
          {p.ok && (
            <Proof label="deployed and verified on this chain">
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>{p.issuer.symbol} token</dt>
                  <dd><Mono title={p.issuer.token}>{short(p.issuer.token)}</Mono></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Identity registry</dt>
                  <dd><Mono title={p.issuer.identityRegistry}>{short(p.issuer.identityRegistry)}</Mono></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Trusted claim issuer</dt>
                  <dd><Mono title={p.issuer.claimIssuer}>{short(p.issuer.claimIssuer)}</Mono></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Total supply</dt>
                  <dd><Mono>{num(p.issuer.supply, 0)}</Mono></dd>
                </div>
              </dl>
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                {p.issuer.holders.filter((x) => x.verified).length} of {p.issuer.holders.length}{" "}
                direct holders return <Mono>isVerified() = true</Mono>:{" "}
                {p.issuer.holders.map((x) => `${x.name} (${x.country}, claims ${x.claims.join("+") || "none"})`).join("; ")}.
              </p>
            </Proof>
          )}
        </Step>

        <Step n={5} title="Onboard the venue as a holder" who="Uniswap">
          <p className="text-sm leading-relaxed">
            The detail that surprises people. Uniswap&apos;s permissions adapter physically
            custodies the security token and mints a synthetic version for the pool to trade, so
            the restricted asset never sits in the PoolManager.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            But that means the adapter <em>holds</em> a token whose transfers are restricted. So
            under the asset&apos;s own rules it has to be KYC&apos;d like anybody else: the issuer
            gave it an on-chain identity, attested it through the same trusted claim issuer used
            for investors, and registered it under a permitted jurisdiction.
          </p>
          {p.ok && (
            <Proof label="the venue is a registered holder of record">
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Permissions adapter</dt>
                  <dd><Mono title={p.venueOnboarding.adapter}>{short(p.venueOnboarding.adapter)}</Mono></dd>
                </div>
                {p.venueOnboarding.adapterIdentity && (
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Its ONCHAINID</dt>
                    <dd><Mono title={p.venueOnboarding.adapterIdentity}>{short(p.venueOnboarding.adapterIdentity)}</Mono></dd>
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
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                The venue was onboarded through exactly the same process as an investor. That is
                what makes the arrangement auditable &mdash; and it is the line to use when someone
                asks how a DEX can be allowed to hold a regulated asset.
              </p>
            </Proof>
          )}
        </Step>

        <Step n={6} title="Prove the controls actually bind" who="OpenZeppelin">
          <p className="text-sm leading-relaxed">
            A compliance control you have not tried to break is a claim, not a control. Each
            scenario below is an executed transaction asserting a specific institutional
            guarantee.
          </p>
          {p.tests?.suites?.length > 0 && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
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
                        <span className="mt-[3px] shrink-0" style={{ color: tc.status === "Success" ? "var(--ok)" : "var(--bad)" }}>
                          {tc.status === "Success" ? "✓" : "✕"}
                        </span>
                        <span>
                          {tc.means || tc.name}{" "}
                          <span style={{ color: "var(--muted)" }}><Mono>{tc.name}</Mono></span>
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

      {p.ok && p.sizes.length > 0 && (
        <Panel title="What is whose" subtitle="Deployed bytecode sizes, read from the chain">
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
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
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{c.bytes.toLocaleString()}</td>
                    <td className="py-2" style={{ color: "var(--muted)" }}>{c.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)", color: "#07101f" }}>
          Now see it trade &rarr;
        </Link>
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          The console runs against this same deployment.
        </span>
      </div>
    </main>
  );
}
