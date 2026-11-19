import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cleanStaticAssets, defaultStaticDir } from "./clean-assets.mjs";

const scriptPath = fileURLToPath(new URL("./clean-assets.mjs", import.meta.url));

test("defaultStaticDir points to repository app/static", () => {
  const expected = fs.realpathSync(fileURLToPath(new URL("../../app/static", import.meta.url)));
  assert.equal(fs.realpathSync(defaultStaticDir), expected);
});

test("cleanStaticAssets removes stale js/css bundles (including chunks) and legacy app.js while keeping fonts and handling missing assets/", () => {
  const emptyStaticDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-clean-empty-"));
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-clean-test-"));
  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-clean-link-"));
  try {
    fs.writeFileSync(path.join(emptyStaticDir, "app.js"), "// legacy");
    cleanStaticAssets(emptyStaticDir);
    assert.equal(fs.existsSync(path.join(emptyStaticDir, "app.js")), false);

    const assetsDir = path.join(staticDir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, "app.js"), "// legacy 92KB app.js");
    fs.writeFileSync(path.join(staticDir, "style.css"), ":root { --mint: #a26243; }");
    fs.writeFileSync(path.join(staticDir, "favicon.svg"), "<svg/>");
    fs.writeFileSync(path.join(assetsDir, "index-old1.js"), "console.log(1);");
    fs.writeFileSync(path.join(assetsDir, "vendor-chunk1.js"), "console.log(2);");
    fs.writeFileSync(path.join(assetsDir, "index-old1.css"), "body{}");
    fs.writeFileSync(path.join(assetsDir, "extra-chunk1.css"), "html{}");
    fs.writeFileSync(path.join(assetsDir, "noto-sans-sc-latin-wght-normal-DDW8mKAR.woff2"), "font");

    const linkedScript = path.join(symlinkRoot, "clean-assets-link.mjs");
    fs.symlinkSync(scriptPath, linkedScript);
    const result = spawnSync(process.execPath, [linkedScript], {
      env: { ...process.env, EC_CLEAN_STATIC_DIR: staticDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);

    assert.equal(fs.existsSync(path.join(staticDir, "app.js")), false);
    assert.equal(fs.existsSync(path.join(staticDir, "style.css")), true);
    assert.equal(fs.existsSync(path.join(staticDir, "favicon.svg")), true);
    assert.deepEqual(fs.readdirSync(assetsDir), [
      "noto-sans-sc-latin-wght-normal-DDW8mKAR.woff2",
    ]);
  } finally {
    fs.rmSync(emptyStaticDir, { recursive: true, force: true });
    fs.rmSync(staticDir, { recursive: true, force: true });
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
  }
});
