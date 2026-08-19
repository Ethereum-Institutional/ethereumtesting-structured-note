"use client";
import { useState } from "react";

export function Code({
  source,
  language = "solidity",
  collapsedLines = 18,
  caption,
}: {
  source: string;
  language?: string;
  collapsedLines?: number;
  caption?: string;
}) {
  const [open, setOpen] = useState(false);
  const lines = source.replace(/\s+$/, "").split("\n");
  const truncated = lines.length > collapsedLines;
  const shown = open || !truncated ? lines : lines.slice(0, collapsedLines);

  return (
    <figure className="mt-3">
      <div
        className="overflow-x-auto rounded border"
        style={{ background: "var(--code-bg)", borderColor: "var(--line)" }}
      >
        <pre className="p-3 text-[11px] leading-[1.6]">
          <code style={{ color: "rgba(255,255,255,.84)" }}>{shown.join("\n")}</code>
        </pre>
        {truncated && (
          <button
            onClick={() => setOpen(!open)}
            className="w-full border-t px-3 py-1.5 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--line)", color: "var(--oz-blue)" }}
          >
            {open ? "collapse" : `show all ${lines.length} lines`}
          </button>
        )}
      </div>
      {caption && (
        <figcaption className="mt-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
