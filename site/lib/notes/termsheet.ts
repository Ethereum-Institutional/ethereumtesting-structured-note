import { keccak256, toBytes, type Hex } from "viem";

/**
 * The term sheet as data (ADR 0095): a record with every field typed, any field that may be "not
 * applicable" saying so explicitly, and a canonical form whose hash the note's identity carries.
 * The record is the input to issuance: the terms the Determination Agent fixes on the chain are
 * derived from it here, and nowhere else.
 *
 * The fields are a catalogue, each with an identifier, a type, a priority and an example, so that
 * the bank's own field list can be fitted to it by editing the catalogue alone.
 *
 * Kept free of server-only imports: the deploy script builds the deployment's record with it too.
 */

export const SCHEMA = "structured-note-term-sheet/1";

export type FieldType =
  | "text"
  | "date" // YYYY-MM-DD
  | "timestamp" // Unix seconds
  | "integer"
  | "bps" // basis points, an integer
  | "cents" // euro cents, an integer
  | "boolean"
  | "enum"
  | "list";

export type FieldDef = {
  id: string;
  section: "Identification" | "Parties" | "Underlyings" | "Payoff" | "Calendar" | "Settlement";
  label: string;
  type: FieldType;
  priority: "must" | "should" | "could";
  /** Whether the field may be "not applicable". A field that may not must carry a value. */
  mayBeNA: boolean;
  example: string;
  options?: readonly string[];
  /** For a list: the fields of each item. */
  of?: readonly FieldDef[];
};

/** A field's entry: its value, or an explicit "not applicable", never an absence. */
export type Entry<T = unknown> = { value: T } | { notApplicable: true; reason?: string };
export type Item = Record<string, Entry>;
export type TermSheet = { schema: typeof SCHEMA; fields: Record<string, Entry> };

const item = (id: string, label: string, type: FieldType, priority: FieldDef["priority"], mayBeNA: boolean, example: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  id,
  section: "Calendar",
  label,
  type,
  priority,
  mayBeNA,
  example,
  ...extra,
});

export const UNDERLYING_FIELDS: readonly FieldDef[] = [
  { ...item("name", "Name", "text", "must", false, "Euro Stoxx 50"), section: "Underlyings" },
  { ...item("identifier", "Identifier (ISIN or ticker)", "text", "should", true, "EU0009658145"), section: "Underlyings" },
  { ...item("initialLevel", "Initial Level, at its published scale", "integer", "must", false, "451200"), section: "Underlyings" },
  { ...item("scale", "Decimal places of its published level", "integer", "must", false, "2"), section: "Underlyings" },
];

export const OBSERVATION_FIELDS: readonly FieldDef[] = [
  item("date", "Observation date", "timestamp", "must", false, "1798761600"),
  item("recordTime", "Record Time", "timestamp", "must", false, "1798934400"),
  item("paymentDate", "Payment Date", "timestamp", "must", false, "1799193600"),
  item("coupon", "Coupon test applies", "boolean", "must", false, "true"),
  item("mer", "Mandatory Early Redemption test applies", "boolean", "must", false, "true"),
  item("merTriggerBps", "MER trigger, bps of Initial Level", "bps", "must", true, "10000"),
  item("barrier", "Barrier observed", "boolean", "must", false, "false"),
  item("isFinal", "Final Valuation Date", "boolean", "must", false, "false"),
];

/** Every field of the term sheet, in the order it reads. */
export const FIELDS: readonly FieldDef[] = [
  { id: "name", section: "Identification", label: "Name", type: "text", priority: "must", mayBeNA: false, example: "EUR Worst-of Autocallable Note" },
  { id: "symbol", section: "Identification", label: "Token symbol", type: "text", priority: "must", mayBeNA: false, example: "EURWAN" },
  { id: "isin", section: "Identification", label: "ISIN", type: "text", priority: "should", mayBeNA: true, example: "XS0000000000" },
  { id: "currency", section: "Identification", label: "Currency", type: "enum", priority: "must", mayBeNA: false, example: "EUR", options: ["EUR"] },
  { id: "calculationAmountCents", section: "Identification", label: "Calculation Amount (one unit)", type: "cents", priority: "must", mayBeNA: false, example: "100000" },
  { id: "issueSizeUnits", section: "Identification", label: "Issue size, in units", type: "integer", priority: "must", mayBeNA: false, example: "100" },
  { id: "issuePriceBps", section: "Identification", label: "Issue price, bps of the Calculation Amount", type: "bps", priority: "must", mayBeNA: false, example: "10000" },
  { id: "strikeDate", section: "Identification", label: "Strike date, when the Initial Levels are fixed", type: "date", priority: "must", mayBeNA: false, example: "2026-10-15" },
  { id: "issueDate", section: "Identification", label: "Issue date", type: "date", priority: "must", mayBeNA: false, example: "2026-10-15" },
  { id: "maturityDate", section: "Identification", label: "Maturity date, the final Payment Date", type: "date", priority: "must", mayBeNA: false, example: "2027-10-20" },
  { id: "form", section: "Identification", label: "Form", type: "text", priority: "must", mayBeNA: false, example: "ERC-3643 token, decimals 0: a balance is a count of units" },
  { id: "chainId", section: "Identification", label: "Network (chain id)", type: "integer", priority: "must", mayBeNA: false, example: "11155111" },
  { id: "sellingRestrictions", section: "Identification", label: "Selling restrictions", type: "text", priority: "must", mayBeNA: false, example: "Regulation S: not to U.S. persons" },
  { id: "governingLaw", section: "Identification", label: "Governing law", type: "text", priority: "should", mayBeNA: true, example: "English law" },
  { id: "listing", section: "Identification", label: "Listing", type: "text", priority: "could", mayBeNA: true, example: "None" },

  { id: "issuer", section: "Parties", label: "Issuer", type: "text", priority: "must", mayBeNA: false, example: "The Issuer" },
  { id: "calculationAgent", section: "Parties", label: "Calculation Agent", type: "text", priority: "must", mayBeNA: false, example: "The Calculation Agent" },
  { id: "payingAgent", section: "Parties", label: "Paying Agent", type: "text", priority: "must", mayBeNA: false, example: "The Agent, through its Paying Agent contract" },
  { id: "registrar", section: "Parties", label: "Registrar: who vouches for holders", type: "text", priority: "must", mayBeNA: false, example: "The onboarding agent" },
  { id: "guarantor", section: "Parties", label: "Guarantor", type: "text", priority: "could", mayBeNA: true, example: "None" },

  { id: "underlyings", section: "Underlyings", label: "Underlyings, in index order", type: "list", priority: "must", mayBeNA: false, example: "three indices", of: UNDERLYING_FIELDS },

  { id: "couponBarrierBps", section: "Payoff", label: "Coupon barrier, bps of Initial Level", type: "bps", priority: "must", mayBeNA: false, example: "7000" },
  { id: "couponRateBps", section: "Payoff", label: "Coupon rate per coupon date, bps of the Calculation Amount", type: "bps", priority: "must", mayBeNA: false, example: "250" },
  { id: "memory", section: "Payoff", label: "Memory coupon", type: "boolean", priority: "must", mayBeNA: false, example: "false" },
  { id: "barrierBps", section: "Payoff", label: "Barrier, bps of Initial Level", type: "bps", priority: "must", mayBeNA: false, example: "6000" },
  { id: "twinWinUpsideBps", section: "Payoff", label: "Twin Win: upside participation, bps", type: "bps", priority: "must", mayBeNA: true, example: "10000" },
  { id: "twinWinDownsideBps", section: "Payoff", label: "Twin Win: downside participation, bps", type: "bps", priority: "must", mayBeNA: true, example: "10000" },
  { id: "twinWinCapBps", section: "Payoff", label: "Twin Win: cap on redemption, bps of the Calculation Amount", type: "bps", priority: "should", mayBeNA: true, example: "15000" },

  { id: "calendar", section: "Calendar", label: "Observation calendar", type: "list", priority: "must", mayBeNA: false, example: "four quarterly dates", of: OBSERVATION_FIELDS },

  { id: "settlementAsset", section: "Settlement", label: "Settlement asset", type: "text", priority: "must", mayBeNA: false, example: "The bank's tokenized deposit (EURTD)" },
  { id: "settlementMethod", section: "Settlement", label: "Settlement method", type: "text", priority: "must", mayBeNA: false, example: "Delivery versus payment by locked offer" },
];

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

export const isNA = (e: Entry | undefined): e is { notApplicable: true; reason?: string } => Boolean(e && "notApplicable" in e && e.notApplicable);
export const value = <T>(e: Entry | undefined): T | undefined => (e && "value" in e ? (e.value as T) : undefined);
export const v = <T>(value: T): Entry<T> => ({ value });
export const na = (reason?: string): Entry => (reason ? { notApplicable: true, reason } : { notApplicable: true });

const INT = /^-?\d+$/;

function checkValue(def: FieldDef, raw: unknown, at: string): string[] {
  switch (def.type) {
    case "text":
      return typeof raw === "string" && raw.trim() ? [] : [`${at}: text expected`];
    case "date":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? [] : [`${at}: a date (YYYY-MM-DD) expected`];
    case "timestamp":
    case "integer":
    case "bps":
    case "cents":
      if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return [`${at}: an integer expected`];
      if (def.type !== "integer" && raw < 0) return [`${at}: not negative`];
      return [];
    case "boolean":
      return typeof raw === "boolean" ? [] : [`${at}: true or false expected`];
    case "enum":
      return typeof raw === "string" && def.options?.includes(raw) ? [] : [`${at}: one of ${def.options?.join(", ")} expected`];
    case "list": {
      if (!Array.isArray(raw) || raw.length === 0) return [`${at}: a list of at least one expected`];
      return raw.flatMap((it, k) => checkEntries(def.of ?? [], it as Item, `${at}[${k}]`));
    }
  }
}

function checkEntries(defs: readonly FieldDef[], entries: Record<string, Entry>, at: string): string[] {
  const problems: string[] = [];
  for (const def of defs) {
    const e = entries?.[def.id];
    const where = at ? `${at}.${def.id}` : def.id;
    if (!e) problems.push(`${where}: missing; give a value or "not applicable"`);
    else if (isNA(e)) {
      if (!def.mayBeNA) problems.push(`${where}: may not be "not applicable"`);
    } else problems.push(...checkValue(def, (e as { value: unknown }).value, where));
  }
  const known = new Set(defs.map((d) => d.id));
  for (const k of Object.keys(entries ?? {})) if (!known.has(k)) problems.push(`${at ? `${at}.` : ""}${k}: not a field of the term sheet`);
  return problems;
}

/** Every problem with a record, in words; none for a record that may be issued. */
export function validate(t: TermSheet): string[] {
  if (t?.schema !== SCHEMA) return [`schema: ${SCHEMA} expected`];
  const problems = checkEntries(FIELDS, t.fields, "");
  if (problems.length) return problems;
  // Twin Win is applicable as a whole or not at all.
  const tw = ["twinWinUpsideBps", "twinWinDownsideBps"].map((k) => isNA(t.fields[k]));
  if (tw[0] !== tw[1]) problems.push("Twin Win: upside and downside participation are applicable together, or neither");
  if (tw[0] && !isNA(t.fields.twinWinCapBps)) problems.push("Twin Win: a cap without participation");
  // An MER trigger exactly on the dates the MER test applies.
  (value<Item[]>(t.fields.calendar) ?? []).forEach((o, k) => {
    const mer = value<boolean>(o.mer);
    if (mer && isNA(o.merTriggerBps)) problems.push(`calendar[${k}].merTriggerBps: the MER test applies, so give its trigger`);
    if (!mer && !isNA(o.merTriggerBps)) problems.push(`calendar[${k}].merTriggerBps: "not applicable" where the MER test does not apply`);
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Canonical form and hash
// ---------------------------------------------------------------------------------------------

/**
 * The record's canonical JSON: keys sorted, no whitespace, integers as JSON numbers. For the
 * values a term sheet holds (strings, safe integers, booleans, arrays, objects) this is the JSON
 * Canonicalization Scheme of RFC 8785, so any implementation of it gives the same bytes.
 */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  if (typeof x === "number" && !Number.isSafeInteger(x)) throw new Error("a term sheet holds integers only");
  return JSON.stringify(x);
}

/** The hash the note's identity carries: keccak256 of the canonical JSON's UTF-8 bytes. */
export function hashOf(t: TermSheet): Hex {
  return keccak256(toBytes(canonical(t)));
}

// ---------------------------------------------------------------------------------------------
// The terms on the chain
// ---------------------------------------------------------------------------------------------

/** IDeterminationAgent.Terms, as the note factory takes them. */
export type ChainTerms = {
  initialLevels: bigint[];
  calculationAmountCents: bigint;
  couponBarrierBps: number;
  couponRateBps: number;
  memory_: boolean;
  barrierBps: number;
  twinWin: { applies: boolean; upBps: number; downBps: number; capBps: number };
  schedule: Array<{ date: number; recordTime: number; paymentDate: number; coupon: boolean; mer: boolean; barrier: boolean; isFinal: boolean; merTriggerBps: number }>;
};

/** The terms the Determination Agent fixes, derived from the record alone. */
export function toTerms(t: TermSheet): ChainTerms {
  const problems = validate(t);
  if (problems.length) throw new Error(`The term sheet cannot be issued: ${problems.join("; ")}`);
  const f = t.fields;
  const num = (e: Entry) => value<number>(e)!;
  const twin = !isNA(f.twinWinUpsideBps);
  return {
    initialLevels: value<Item[]>(f.underlyings)!.map((u) => BigInt(num(u.initialLevel))),
    calculationAmountCents: BigInt(num(f.calculationAmountCents)),
    couponBarrierBps: num(f.couponBarrierBps),
    couponRateBps: num(f.couponRateBps),
    memory_: value<boolean>(f.memory)!,
    barrierBps: num(f.barrierBps),
    twinWin: { applies: twin, upBps: twin ? num(f.twinWinUpsideBps) : 0, downBps: twin ? num(f.twinWinDownsideBps) : 0, capBps: twin && !isNA(f.twinWinCapBps) ? num(f.twinWinCapBps) : 0 },
    schedule: value<Item[]>(f.calendar)!.map((o) => ({
      date: num(o.date),
      recordTime: num(o.recordTime),
      paymentDate: num(o.paymentDate),
      coupon: value<boolean>(o.coupon)!,
      mer: value<boolean>(o.mer)!,
      barrier: value<boolean>(o.barrier)!,
      isFinal: value<boolean>(o.isFinal)!,
      merTriggerBps: isNA(o.merTriggerBps) ? 0 : num(o.merTriggerBps),
    })),
  };
}

/** Where the terms on the chain differ from the record's, in words; none when they agree. */
export function differences(t: TermSheet, onChain: ChainTerms): string[] {
  const want = toTerms(t);
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const norm = (x: ChainTerms) => ({
    ...x,
    initialLevels: x.initialLevels.map(String),
    calculationAmountCents: String(x.calculationAmountCents),
    schedule: x.schedule.map((o) => ({ ...o, date: Number(o.date), recordTime: Number(o.recordTime), paymentDate: Number(o.paymentDate), merTriggerBps: Number(o.merTriggerBps) })),
    twinWin: { applies: x.twinWin.applies, upBps: Number(x.twinWin.upBps), downBps: Number(x.twinWin.downBps), capBps: Number(x.twinWin.capBps) },
    couponBarrierBps: Number(x.couponBarrierBps),
    couponRateBps: Number(x.couponRateBps),
    barrierBps: Number(x.barrierBps),
  });
  const a = norm(want);
  const b = norm(onChain);
  for (const k of Object.keys(a) as Array<keyof typeof a>) if (!same(a[k], b[k])) out.push(`${k}: the term sheet gives ${canonical(a[k])}, the chain ${canonical(b[k])}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Building a record from our instrument terms
// ---------------------------------------------------------------------------------------------

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export type Basis = {
  name: string;
  symbol: string;
  chainId: number;
  issueSizeUnits: number;
  /** When the Initial Levels are fixed: the issuance's own block time. */
  strikeTime: number;
  initialLevels: number[];
  calculationAmountCents: number;
  couponBarrierBps: number;
  couponRateBps: number;
  memory: boolean;
  barrierBps: number;
  twinWin: { applies: boolean; upBps: number; downBps: number; capBps: number };
  schedule: ChainTerms["schedule"];
  depositSymbol: string;
};

/** The illustrative underlyings of the payoff specification (spike 3), at two decimals. */
const UNDERLYING_NAMES = ["Underlying 1", "Underlying 2", "Underlying 3", "Underlying 4", "Underlying 5"];

/** A record from our instrument terms: the payoff specification's illustrative figures, until the bank's field list fixes the rest. */
export function termSheetFrom(b: Basis): TermSheet {
  const last = b.schedule[b.schedule.length - 1];
  return {
    schema: SCHEMA,
    fields: {
      name: v(b.name),
      symbol: v(b.symbol),
      isin: na("The token is the record of ownership; no ISIN is assigned in the proof of concept"),
      currency: v("EUR"),
      calculationAmountCents: v(b.calculationAmountCents),
      issueSizeUnits: v(b.issueSizeUnits),
      issuePriceBps: v(10_000),
      strikeDate: v(day(b.strikeTime)),
      issueDate: v(day(b.strikeTime)),
      maturityDate: v(day(last.paymentDate)),
      form: v("ERC-3643 token, decimals 0: a balance is a count of units"),
      chainId: v(b.chainId),
      sellingRestrictions: v("Regulation S: not offered or sold to U.S. persons"),
      governingLaw: na("To be fixed by the bank's term sheet"),
      listing: na("Not listed"),
      issuer: v("The Issuer"),
      calculationAgent: v("The Calculation Agent"),
      payingAgent: v("The Agent, through the note's Paying Agent contract"),
      registrar: v("The onboarding agent, whose note claim the note's identity registry requires"),
      guarantor: na("No guarantor"),
      underlyings: v(
        b.initialLevels.map((level, k): Item => ({
          name: v(UNDERLYING_NAMES[k] ?? `Underlying ${k + 1}`),
          identifier: na("Illustrative underlying"),
          initialLevel: v(level),
          scale: v(2),
        })),
      ),
      couponBarrierBps: v(b.couponBarrierBps),
      couponRateBps: v(b.couponRateBps),
      memory: v(b.memory),
      barrierBps: v(b.barrierBps),
      twinWinUpsideBps: b.twinWin.applies ? v(b.twinWin.upBps) : na("Twin Win does not apply"),
      twinWinDownsideBps: b.twinWin.applies ? v(b.twinWin.downBps) : na("Twin Win does not apply"),
      twinWinCapBps: b.twinWin.applies && b.twinWin.capBps ? v(b.twinWin.capBps) : na(b.twinWin.applies ? "No cap" : "Twin Win does not apply"),
      calendar: v(
        b.schedule.map((o): Item => ({
          date: v(Number(o.date)),
          recordTime: v(Number(o.recordTime)),
          paymentDate: v(Number(o.paymentDate)),
          coupon: v(o.coupon),
          mer: v(o.mer),
          merTriggerBps: o.mer ? v(Number(o.merTriggerBps)) : na(),
          barrier: v(o.barrier),
          isFinal: v(o.isFinal),
        })),
      ),
      settlementAsset: v(`The bank's tokenized deposit (${b.depositSymbol})`),
      settlementMethod: v("Delivery versus payment by locked offer"),
    },
  };
}
