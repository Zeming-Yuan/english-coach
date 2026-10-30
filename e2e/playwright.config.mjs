import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireFromFrontend = createRequire(path.join(root, "frontend", "package.json"));
const {defineConfig} = requireFromFrontend("@playwright/test");

export default defineConfig({
  testDir: path.join(root, "e2e"),
  testMatch: /.*\.spec\.mjs/,
  outputDir: path.join(root, "e2e", "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  expect: {timeout: 15000},
  reporter: [["list"]],
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {name: "mobile", use: {viewport: {width: 420, height: 880}, hasTouch: true}},
    {name: "desktop", use: {viewport: {width: 1280, height: 720}}},
  ],
});
