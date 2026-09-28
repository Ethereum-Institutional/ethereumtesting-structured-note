import { defineConfig } from "@playwright/test";
import { SITE } from "./test/browser/people.ts";

/**
 * Browser tests: a production build of the site, clicked through in Chromium, against the local
 * chain only. Run from site/ with the chain up:
 *
 *   ../ops/reset.sh && npm run test:browser
 */
export default defineConfig({
  testDir: "test/browser",
  fullyParallel: false,
  workers: 1, // one store and one chain: the tests run in order
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: SITE, trace: "retain-on-failure" },
  webServer: {
    command: "node test/browser/serve.ts",
    url: SITE,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
