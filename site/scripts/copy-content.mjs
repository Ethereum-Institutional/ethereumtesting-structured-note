// Copies the gated documents into the app at build time, so the repository keeps one source
// for each. The copies are gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "content"), { recursive: true });
copyFileSync(join(root, "..", "docs", "solution-overview.html"), join(root, "content", "solution-overview.html"));
console.log("content: solution-overview.html");
