/**
 * The three-lane architecture from the solution overview, with each component linked to the
 * section of the overview that describes it. Geometry and classes match the overview's figure.
 */

type Box = { x: number; y: number; w: number; h: number; t: string; sub: string[]; cls: string; href: string };

const B = (x: number, y: number, w: number, h: number, t: string, sub: string[], cls: string, section: string): Box => ({
  x, y, w, h, t, sub, cls, href: `/overview#${section}`,
});

const BOXES: Box[] = [
  B(16, 54, 268, 52, "Agency and trust operations", ["instructs issuance, coupons, corrections"], "d-box", "lifecycle"),
  B(16, 122, 268, 52, "Issuer and Calculation Agent", ["term sheet, determinations, guarantee"], "d-box", "parties"),
  B(16, 190, 268, 66, "Core banking and books of record", ["KYC identity register, personal data", "the authoritative Register"], "d-box", "identity"),
  B(16, 272, 268, 52, "Digital asset platform", ["smart contract deployment, key custody"], "d-box", "responsibilities"),

  B(332, 54, 236, 48, "Instruction adapter", ["event to transaction to record"], "d-box-a", "architecture"),
  B(332, 118, 236, 48, "Credential bridge", ["KYC outcome to whitelist flags"], "d-box-a", "identity"),
  B(332, 182, 236, 48, "Commitment writer", ["salted hash, never the file"], "d-box-a", "identity"),
  B(332, 246, 236, 48, "Reconciliation", ["Register against on-chain balances"], "d-box-a", "success"),

  B(616, 54, 204, 58, "Structured Note token", ["restricted transfer, snapshots", "decimals = 0, 1 unit = €1,000"], "d-box", "instrument"),
  B(840, 54, 204, 58, "Digital monies", ["simulated tokenized deposit", "decimals = 2"], "d-box", "cash-leg"),
  B(616, 128, 204, 52, "Paying Agent contract", ["coupon, MER, redemption"], "d-box", "lifecycle"),
  B(840, 128, 204, 52, "DvP settlement", ["both legs, atomic"], "d-box", "lifecycle"),
  B(616, 196, 428, 52, "Identity Registry contract", ["whitelist, selling restrictions, multi-signature managed"], "d-box-k", "identity"),
  B(616, 264, 204, 52, "Governance controls", ["two tiers, quorum, timelock"], "d-box-s", "governance"),
  B(840, 264, 204, 52, "Determination Agent", ["signed levels and triggers"], "d-box", "instrument"),
  B(616, 332, 428, 52, "Permissioned conversion pool: euro payment token to deposit", ["whitelist checked at the wallet, before the pool, not at the asset"], "d-box", "cash-leg"),
];

const FLOWS: [string, boolean][] = [
  ["M284 80 H332", true],
  ["M284 148 H332", true],
  ["M284 218 H332", true],
  ["M284 298 H332", true],
  ["M568 78 H616", false],
  ["M568 142 H616", false],
  ["M568 206 H616", true],
  ["M568 270 H600 V290 H616", false],
];

export function Architecture() {
  return (
    <figure className="figure">
      <div className="scroller">
        <svg
          viewBox="0 0 1060 470"
          width="1060"
          height="470"
          role="img"
          aria-label="Three-lane architecture. Institution systems on the left, an integration layer in the middle, and the shared ledger on the right. The Identity Registry sits at the centre of the ledger lane. A dashed boundary marks the limit of personal data. Each component links to its section of the solution overview."
        >
          <defs>
            <marker id="h1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="d-head" />
            </marker>
            <marker id="h2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="d-head-a" />
            </marker>
          </defs>

          <rect x="0" y="34" width="300" height="416" className="d-lane" />
          <rect x="316" y="34" width="268" height="416" className="d-seam" />
          <rect x="600" y="34" width="460" height="416" className="d-lane" />

          <text x="16" y="22" className="d-lanelbl">INSTITUTION SYSTEMS</text>
          <text x="332" y="22" className="d-lanelbl">INTEGRATION LAYER</text>
          <text x="616" y="22" className="d-lanelbl">SHARED LEDGER</text>

          {BOXES.map((b) => (
            <a key={b.t} href={b.href} className="d-link">
              <title>{`${b.t}: open in the solution overview`}</title>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} className={b.cls} />
              <text x={b.x + 14} y={b.y + (b.h === 48 ? 22 : 24)} className="d-t">{b.t}</text>
              {b.sub.map((s, i) => (
                <text key={s} x={b.x + 14} y={b.y + (b.h === 48 ? 38 : 41) + i * (b.h >= 66 ? 16 : 13)} className="d-sub">{s}</text>
              ))}
            </a>
          ))}

          {FLOWS.map(([d, accent]) => (
            <path key={d} d={d} className={accent ? "d-flow-a" : "d-flow"} markerEnd={`url(#${accent ? "h2" : "h1"})`} />
          ))}

          <path d="M300 40 V444" className="d-bar" />
          <text x="308" y="424" className="d-barlbl">PII BOUNDARY</text>
        </svg>
      </div>
      <figcaption>
        Left to right is the flow of an instruction. The dashed line marks the limit of personal data. Legal names,
        registered addresses, entity identifiers and account numbers remain in core banking. On-chain data is limited to
        a wallet address, whitelist flags, and a salted commitment to the off-chain record. Select any component to open
        its section of the solution overview.
      </figcaption>
    </figure>
  );
}
