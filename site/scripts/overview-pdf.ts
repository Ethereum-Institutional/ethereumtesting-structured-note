/**
 * The solution overview as a PDF (ADR 0097): docs/solution-overview.html printed by headless
 * Chromium, through the document's own print styles, so the PDF and the page the site serves
 * come from one source. Run from site/:
 *
 *   node scripts/overview-pdf.ts            # writes docs/solution-overview.pdf
 *
 * The PDF is shared by hand and not committed.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = join(ROOT, "docs", "solution-overview.html");
const OUT = join(ROOT, process.env.OUT ?? "docs/solution-overview.pdf");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(SOURCE).toString(), { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;font:8px sans-serif;color:#777;padding:0 14mm;display:flex;justify-content:space-between">' +
    "<span>Structured Note Smart Contract Issuance, solution overview, release 0.2.0. Non-production proof of concept.</span>" +
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(`wrote ${OUT}`);
