"use client";

import { useEffect, useState } from "react";

/**
 * The whole architecture as one animated picture.
 *
 * Every box is a real deployed contract (or the operator's console), labelled with whose
 * technology it is. The scenario buttons replay the demo's key moments as call flows: a pulse
 * travels the edges the real transaction takes, with a caption narrating each hop. Pure inline
 * SVG + SMIL — no libraries, works in a static render.
 *
 * Layout: the call graph is a tree plus one triangle (console–token–bridge), so it can be drawn
 * with no crossing edges at all. Nodes sit on a 4×3 grid and every edge but one is a straight
 * segment between adjacent boxes; the trade path reads as a serpentine through the grid. The
 * middle row is deliberately all OpenZeppelin — the layer that joins the client side to the
 * issuer's stack — and gets a faint band saying so.
 */

type NodeDef = {
  x: number; y: number; w: number; h: number;
  title: string;
  sub: string;
  vendor: "oz" | "uniswap" | "tokeny" | "app";
};

const VENDOR_LABEL = { oz: "OpenZeppelin", uniswap: "Uniswap v4", tokeny: "Tokeny · T-REX", app: "this dashboard" } as const;
const VENDOR_COLOR = { oz: "#4e5ee4", uniswap: "#d6067f", tokeny: "#0797c9", app: "#50506e" } as const;

// Grid: columns at x = 25/280/535/790 (w 210), rows at y = 22/148/274 (h 64).
const NODES: Record<string, NodeDef> = {
  investor: { x: 25,  y: 22,  w: 210, h: 64, title: "Investor",            sub: "browser session — no wallet", vendor: "app" },
  kyc:      { x: 535, y: 22,  w: 210, h: 64, title: "KYC claim issuer",    sub: "signs the passport's stamps", vendor: "tokeny" },
  passport: { x: 790, y: 22,  w: 210, h: 64, title: "On-chain passport",   sub: "ONCHAINID + signed claims", vendor: "tokeny" },
  custody:  { x: 25,  y: 148, w: 210, h: 64, title: "Custody account",     sub: "segregated, CREATE2 · OZ Contracts", vendor: "oz" },
  hook:     { x: 280, y: 148, w: 210, h: 64, title: "Compliance hook",     sub: "on BaseHook · uniswap-hooks lib", vendor: "oz" },
  bridge:   { x: 535, y: 148, w: 210, h: 64, title: "Compliance bridge",   sub: "AllowlistChecker — your rule, ~200 lines", vendor: "oz" },
  registry: { x: 790, y: 148, w: 210, h: 64, title: "Identity registry",   sub: "who is a verified holder", vendor: "tokeny" },
  router:   { x: 25,  y: 274, w: 210, h: 64, title: "Permissioned router", sub: "the only door to the pool", vendor: "uniswap" },
  pool:     { x: 280, y: 274, w: 210, h: 64, title: "Pool · PoolManager",  sub: "live market, public ledger", vendor: "uniswap" },
  token:    { x: 535, y: 274, w: 210, h: 64, title: "APMMF token",         sub: "ERC-3643 security token", vendor: "tokeny" },
  console:  { x: 790, y: 274, w: 210, h: 64, title: "Compliance console",  sub: "issuer & agent controls", vendor: "app" },
};

// Each edge joins two adjacent boxes, so all are short straight segments — except `block`,
// which curves through the free corridor between bridge/token and registry/console.
const EDGES: Record<string, string> = {
  order:    "M130,86 L130,148",
  route:    "M130,212 L130,274",
  toPool:   "M235,306 L280,306",
  toHook:   "M385,274 L385,212",
  toBridge: "M490,180 L535,180",
  askToken: "M640,212 L640,274",
  askReg:   "M745,180 L790,180",
  readPass: "M895,148 L895,86",
  signs:    "M745,54 L790,54",
  freeze:   "M790,306 L745,306",
  block:    "M800,274 C800,244 785,218 745,208",
};

type Step = { edges: string[]; nodes: string[]; caption: string; tone: "ok" | "bad" | "ctrl" };
type Scenario = { key: string; label: string; steps: Step[] };

const TRADE_PATH: Step[] = [
  { edges: ["order"], nodes: ["investor", "custody"], tone: "ok",
    caption: "The investor places an order. The custodian signs from the segregated custody account — the client never holds a key." },
  { edges: ["route", "toPool"], nodes: ["custody", "router", "pool"], tone: "ok",
    caption: "The order enters the Uniswap v4 pool through the permissioned router — the only door the pool accepts." },
  { edges: ["toHook"], nodes: ["pool", "hook"], tone: "ok",
    caption: "Before moving a single token, the pool calls the OpenZeppelin compliance hook." },
  { edges: ["toBridge"], nodes: ["hook", "bridge"], tone: "ok",
    caption: "The hook asks the compliance bridge: what may this account do with this asset?" },
];

const SCENARIOS: Scenario[] = [
  {
    key: "trade",
    label: "Place a trade",
    steps: [
      ...TRADE_PATH,
      { edges: ["askToken"], nodes: ["bridge", "token"], tone: "ok",
        caption: "The bridge checks the issuer's token: asset not paused, wallet not frozen." },
      { edges: ["askReg", "readPass"], nodes: ["bridge", "registry", "passport"], tone: "ok",
        caption: "…and the identity registry, which verifies the investor's on-chain passport and its signed claims." },
      { edges: ["toHook", "toPool"], nodes: ["pool"], tone: "ok",
        caption: "Every gate passes — the pool settles the trade and it prints on the public ledger, tx hash and all." },
    ],
  },
  {
    key: "freeze",
    label: "Freeze a wallet",
    steps: [
      { edges: ["freeze"], nodes: ["console", "token"], tone: "ctrl",
        caption: "One click sends setAddressFrozen(wallet, true) straight to the ERC-3643 token — one public transaction." },
      ...TRADE_PATH.slice(0, 4).map((s) => ({ ...s, caption: s.caption })),
      { edges: ["askToken"], nodes: ["bridge", "token"], tone: "bad",
        caption: "The bridge reads the token: isFrozen → true." },
      { edges: ["toBridge", "toHook"], nodes: ["hook"], tone: "bad",
        caption: "The hook refuses. The pool itself rejects the trade — no back office, no batch job, no discretion." },
    ],
  },
  {
    key: "block",
    label: "Block a jurisdiction",
    steps: [
      { edges: ["block"], nodes: ["console", "bridge"], tone: "ctrl",
        caption: "The console flips one storage slot on the bridge: setCountryAllowed(APMMF, 392, false) — enforcement switches on with it." },
      ...TRADE_PATH.slice(0, 4),
      { edges: ["askReg", "readPass"], nodes: ["bridge", "registry", "passport"], tone: "bad",
        caption: "The bridge asks the registry for the passport's registered country → Japan (392)." },
      { edges: ["toBridge", "toHook"], nodes: ["hook"], tone: "bad",
        caption: "Blocked at the venue: every Japan-registered passport is refused until the flag flips back." },
    ],
  },
  {
    key: "pause",
    label: "Pause the asset",
    steps: [
      { edges: ["freeze"], nodes: ["console", "token"], tone: "ctrl",
        caption: "The issuer's blunt instrument: pause() on the token itself." },
      { edges: ["askToken", "toBridge", "toHook", "toPool", "route"], nodes: ["token", "bridge", "hook", "pool", "router"], tone: "bad",
        caption: "Every transfer and every trade halts, for every holder, everywhere — one transaction, enforced by the asset." },
    ],
  },
  {
    key: "onboard",
    label: "Approve an investor",
    steps: [
      { edges: ["signs"], nodes: ["kyc", "passport"], tone: "ok",
        caption: "On approval, the KYC provider cryptographically signs claims onto the investor's ONCHAINID — the passport gets its stamps." },
      { edges: ["readPass", "askReg"], nodes: ["passport", "registry"], tone: "ok",
        caption: "The issuer registers the passport as a verified holder of record, under a jurisdiction." },
      { edges: ["askReg", "toBridge", "toHook"], nodes: ["bridge", "hook", "pool"], tone: "ok",
        caption: "From that moment the market itself can verify them — no venue list, no database. They may trade." },
    ],
  },
];

const TONE_COLOR = { ok: "#0d8a5f", bad: "#cf3f33", ctrl: "#0a74f2" } as const;
const STEP_MS = 4200;

const LEGEND: Array<[keyof typeof VENDOR_LABEL, number, number]> = [
  ["oz", 288, 50],
  ["tokeny", 288, 68],
  ["uniswap", 392, 50],
  ["app", 392, 68],
];

const ARROW =
  "rounded border px-3 py-1 text-sm leading-none transition-opacity hover:opacity-80 disabled:opacity-30";

export function ArchDiagram() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [step, setStep] = useState(0);
  // Manual by default: a presenter narrates at their own pace; auto-play is opt-in and slow.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s + 1) % scenario.steps.length), STEP_MS);
    return () => clearInterval(t);
  }, [scenario, playing]);

  const active = scenario.steps[step];
  const color = TONE_COLOR[active.tone];
  const last = scenario.steps.length - 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setScenario(s);
                setStep(0);
              }}
              className="rounded border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80"
              style={
                s.key === scenario.key
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                  : { borderColor: "var(--line)", color: "var(--muted)" }
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.max(s - 1, 0));
            }}
            disabled={step === 0}
            className={ARROW}
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
            aria-label="Previous step"
          >
            ‹
          </button>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--muted)" }}>
            {step + 1}/{scenario.steps.length}
          </span>
          <button
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.min(s + 1, last));
            }}
            disabled={step === last}
            className={ARROW}
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
            aria-label="Next step"
          >
            ›
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80"
            style={
              playing
                ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                : { borderColor: "var(--line)", color: "var(--muted)" }
            }
          >
            {playing ? "⏸ pause" : "▶ auto"}
          </button>
        </div>
      </div>

      <svg viewBox="0 0 1030 356" className="mt-3 w-full" role="img" aria-label="Architecture and call flow">
        {/* the OpenZeppelin lane: the middle row is the layer that joins the other two parties */}
        <rect x={15} y={138} width={740} height={84} rx={10} fill="rgba(78,94,228,0.04)" stroke="rgba(78,94,228,0.28)" strokeDasharray="3 4" />
        <text x={745} y={132} fontSize={9} fontWeight={600} fill={VENDOR_COLOR.oz} letterSpacing="0.08em" textAnchor="end">
          THE OPENZEPPELIN LAYER
        </text>
        {/* legend, in the grid's one free cell */}
        <text x={288} y={32} fontSize={9} fill="var(--faint)" letterSpacing="0.08em">
          COLOUR = WHOSE TECHNOLOGY
        </text>
        {LEGEND.map(([vendor, x, y]) => (
          <g key={vendor}>
            <circle cx={x} cy={y - 3} r={3} fill={VENDOR_COLOR[vendor]} />
            <text x={x + 9} y={y} fontSize={9.5} fill="var(--muted)">
              {VENDOR_LABEL[vendor]}
            </text>
          </g>
        ))}
        {/* base edges */}
        {Object.entries(EDGES).map(([id, d]) => (
          <path key={id} d={d} fill="none" stroke="var(--line)" strokeWidth={1.5} />
        ))}
        {/* active edges + travelling pulse */}
        {active.edges.map((id) => (
          <g key={`${scenario.key}-${step}-${id}`}>
            <path d={EDGES[id]} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="6 5" opacity={0.9}>
              <animate attributeName="stroke-dashoffset" from="22" to="0" dur="0.9s" repeatCount="indefinite" />
            </path>
            <circle r={5} fill={color}>
              <animateMotion dur="1.3s" repeatCount="indefinite" path={EDGES[id]} />
            </circle>
          </g>
        ))}
        {/* nodes */}
        {Object.entries(NODES).map(([id, n]) => {
          const hot = active.nodes.includes(id);
          return (
            <g key={id}>
              <rect
                x={n.x} y={n.y} width={n.w} height={n.h} rx={8}
                fill="var(--panel-2)"
                stroke={hot ? color : "var(--line)"}
                strokeWidth={hot ? 2.5 : 1}
              />
              <text x={n.x + 10} y={n.y + 20} fontSize={13} fontWeight={600} fill="var(--text)">
                {n.title}
              </text>
              <text x={n.x + 10} y={n.y + 35} fontSize={9.5} fill="var(--muted)">
                {n.sub}
              </text>
              <text x={n.x + 10} y={n.y + n.h - 9} fontSize={9} fontWeight={600} fill={VENDOR_COLOR[n.vendor]} letterSpacing="0.06em">
                {VENDOR_LABEL[n.vendor].toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex items-start gap-2.5">
        <span
          className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
          style={{ background: color, color: "#fff" }}
        >
          {step + 1}/{scenario.steps.length}
        </span>
        <p className="min-h-[2.5em] text-xs leading-relaxed" style={{ color: "var(--text)" }}>
          {active.caption}
        </p>
      </div>
    </div>
  );
}
