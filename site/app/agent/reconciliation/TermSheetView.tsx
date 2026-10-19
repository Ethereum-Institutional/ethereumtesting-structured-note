import { FIELDS, isNA, value, type Entry, type FieldDef, type Item, type TermSheet } from "@/lib/notes/termsheet";

const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function show(def: FieldDef, e: Entry | undefined): React.ReactNode {
  if (!e) return <span className="muted">missing</span>;
  if (isNA(e)) return <span className="muted">not applicable{e.reason ? `: ${e.reason}` : ""}</span>;
  const x = value<unknown>(e);
  switch (def.type) {
    case "cents": return `€${(Number(x) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    case "bps": return `${(Number(x) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
    case "timestamp": return when(Number(x));
    case "boolean": return x ? "yes" : "no";
    default: return String(x);
  }
}

function List({ def, items }: { def: FieldDef; items: Item[] }) {
  const cols = def.of ?? [];
  return (
    <div className="table-wrap">
      <table aria-label={def.label}>
        <thead><tr>{cols.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
        <tbody>{items.map((it, k) => <tr key={k}>{cols.map((c) => <td key={c.id}>{show(c, it[c.id])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A term sheet, field by field in its sections, every "not applicable" with its reason. */
export function TermSheetView({ t, hash, href }: { t: TermSheet; hash: string; href: string }) {
  const sections = [...new Set(FIELDS.map((f) => f.section))];
  return (
    <section className="panel" aria-label="Term sheet">
      {sections.map((section) => (
        <div key={section}>
          <h4>{section}</h4>
          {FIELDS.filter((f) => f.section === section).map((f) =>
            f.type === "list" ? (
              isNA(t.fields[f.id]) ? <p key={f.id}>{f.label}: {show(f, t.fields[f.id])}</p> : <List key={f.id} def={f} items={value<Item[]>(t.fields[f.id]) ?? []} />
            ) : null,
          )}
          {FIELDS.some((f) => f.section === section && f.type !== "list") && (
            <dl className="facts">
              {FIELDS.filter((f) => f.section === section && f.type !== "list").map((f) => (
                <div key={f.id} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd>{show(f, t.fields[f.id])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
      <p className="muted" style={{ marginBottom: 0 }}>
        Its hash, which the note's identity carries: <code>{hash}</code>. <a href={href}>The record as published (JSON)</a>, in the canonical form that hash is of.
      </p>
    </section>
  );
}
