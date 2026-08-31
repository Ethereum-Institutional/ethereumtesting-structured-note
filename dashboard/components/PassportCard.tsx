import { Badge, Mono, short } from "./ui";
import { ClaimTrigger } from "./ClaimInspector";
import type { Passport } from "@/lib/passport";

/** Demo claim topics — 7 = KYC, 42 = professional/accredited (see trex/scripts/lib.ts). */
const TOPIC = { KYC: 7, ACCREDITED: 42 } as const;

/**
 * The investor's on-chain passport, rendered like the credential it is.
 *
 * The ONCHAINID address and the claim stamps are read live from the chain — the card is showing
 * the same thing the pool's compliance hook checks before every trade, which is the whole
 * "why blockchain" of the demo: a portable, publicly verifiable credential, not a row in our
 * database.
 */
export function PassportCard({
  name,
  countryName,
  wallet,
  passport,
}: {
  name: string;
  countryName: string;
  wallet: string | null;
  passport: Passport | null;
}) {
  const issued = Boolean(passport?.identity);
  const topics = [
    ...(passport?.kyc ? [TOPIC.KYC] : []),
    ...(passport?.accredited ? [TOPIC.ACCREDITED] : []),
  ];

  // A granted stamp opens the passport inspector — the audience can see exactly what the stamp
  // is on chain, watch every check the market runs, and watch a forgery fail.
  const stamp = (label: string, granted: boolean) => {
    const pill = (
      <span
        className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide"
        style={
          granted
            ? { borderColor: "rgba(13,138,95,.45)", background: "rgba(13,138,95,.06)", color: "var(--ok)" }
            : { borderColor: "var(--line)", color: "var(--muted)", borderStyle: "dashed" }
        }
      >
        {granted ? "✓" : "·"} {label}
      </span>
    );
    if (!granted || !passport?.identity || !wallet) return pill;
    return (
      <ClaimTrigger wallet={wallet} identity={passport.identity} topics={topics}>
        {pill}
      </ClaimTrigger>
    );
  };

  return (
    <section
      className="rounded-lg border"
      style={{
        background: "var(--panel)",
        borderColor: issued ? "rgba(13,138,95,.4)" : "var(--line)",
      }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider">On-chain passport</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
            ONCHAINID — the credential the market checks before every trade
          </p>
        </div>
        <div className="flex gap-1.5">
          {passport?.frozen && <Badge tone="bad">wallet frozen</Badge>}
          {issued ? (
            <Badge tone={passport?.verified ? "ok" : "warn"}>
              {passport?.verified ? "verified holder" : "not yet verified"}
            </Badge>
          ) : (
            <Badge tone="warn">not yet issued</Badge>
          )}
        </div>
      </header>

      <div className="p-4">
        {issued && passport ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Holder
                </div>
                <div className="mt-0.5 text-sm font-semibold">{name}</div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                  {countryName}
                </div>
              </div>
              <dl className="space-y-1 text-[11px]">
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Identity contract</dt>
                  <dd>
                    {passport.identity && wallet && topics.length > 0 ? (
                      <ClaimTrigger
                        wallet={wallet}
                        identity={passport.identity}
                        topics={topics}
                        style={{ textDecoration: "underline dotted", textUnderlineOffset: 3 }}
                      >
                        <Mono title={passport.identity}>{short(passport.identity)}</Mono>
                      </ClaimTrigger>
                    ) : (
                      <Mono title={passport.identity ?? undefined}>{short(passport.identity ?? undefined)}</Mono>
                    )}
                  </dd>
                </div>
                {wallet && (
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Custody account</dt>
                    <dd>
                      <Mono title={wallet}>{short(wallet)}</Mono>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {stamp("KYC verified", passport.kyc)}
              {stamp("Accredited investor", passport.accredited)}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
              This credential lives on the public blockchain at the identity contract above. Each
              stamp is a claim cryptographically signed by the fund&apos;s KYC provider. The market
              checks it — not our database — before every trade, and any venue that trusts the same
              claim issuer can verify you without ever seeing your documents.
              {topics.length > 0 && <> Click a stamp to open your passport and watch every check run, live.</>}
            </p>
          </>
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Your on-chain passport has not been issued yet. When compliance approves your
            application, an identity contract (ONCHAINID) is minted for your custody account and
            the fund&apos;s KYC provider signs claims onto it. From that moment the market itself can
            verify you.
          </p>
        )}
      </div>
    </section>
  );
}
