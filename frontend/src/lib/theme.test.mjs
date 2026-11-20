import test from "node:test";
import assert from "node:assert/strict";
import {
  readPreAuthDarkMode,
  applyPreAuthDarkMode,
  syncAccountDarkMode,
  primeLoginDarkMode,
} from "./theme.js";

function makeStorage(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    get length() {
      return rows.size;
    },
    key: (index) => [...rows.keys()][index] ?? null,
    getItem: (key) => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key),
  };
}

function makeDoc() {
  const classes = new Set();
  return {
    classes,
    body: {
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    },
  };
}

test("readPreAuthDarkMode supports single-user darkMode and unanimous multi-account upgrade fallback", () => {
  assert.equal(readPreAuthDarkMode(makeStorage()), false);
  assert.equal(readPreAuthDarkMode(makeStorage({ darkMode: "true" })), true);
  assert.equal(
    readPreAuthDarkMode(makeStorage({ "ec.account.owner:darkMode": "true" })),
    true,
  );
  assert.equal(
    readPreAuthDarkMode(
      makeStorage({
        "ec.account.owner:darkMode": "true",
        "ec.account.friend1:darkMode": "false",
      }),
    ),
    false,
  );
});

test("primeLoginDarkMode prevents dark/light bleed when switching accounts on a shared browser", () => {
  const storage = makeStorage({
    "ec.account.owner:darkMode": "true",
  });
  const doc = makeDoc();

  // Owner is active in dark mode, then logs out -> pre-auth screen stays dark
  syncAccountDarkMode(true, storage, doc);
  assert.equal(doc.classes.has("dark"), true);
  assert.equal(readPreAuthDarkMode(storage), true);

  // Friend1 (default light, no darkMode key yet) logs in -> primes ec.ui.dark = false before reload
  assert.equal(primeLoginDarkMode("friend1", storage), false);
  assert.equal(applyPreAuthDarkMode(storage, doc), false);
  assert.equal(doc.classes.has("dark"), false);

  // Friend1 logs out (still light), then Owner (dark) logs back in -> primes ec.ui.dark = true before reload
  assert.equal(primeLoginDarkMode("owner", storage), true);
  assert.equal(applyPreAuthDarkMode(storage, doc), true);
  assert.equal(doc.classes.has("dark"), true);
});
