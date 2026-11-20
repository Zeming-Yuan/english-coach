import { createAccountStorage } from "./accountSession.js";

const UI_DARK_KEY = "ec.ui.dark";
const ACCOUNT_DARK_PATTERN = /^ec\.account\.[^:]+:darkMode$/;

function parseBoolean(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

export function readPreAuthDarkMode(storage = globalThis.localStorage) {
  for (const key of [UI_DARK_KEY, "darkMode"]) {
    try {
      const value = parseBoolean(storage?.getItem(key));
      if (value !== null) return value;
    } catch {}
  }
  try {
    const values = [];
    for (let i = 0; i < (storage?.length ?? 0); i += 1) {
      const key = storage.key(i);
      if (key && ACCOUNT_DARK_PATTERN.test(key)) {
        const value = parseBoolean(storage.getItem(key));
        if (value !== null) values.push(value);
      }
    }
    if (values.length > 0 && values.every(Boolean)) return true;
  } catch {}
  return false;
}

export function applyDarkClass(enabled, doc = globalThis.document) {
  doc?.body?.classList?.toggle("dark", Boolean(enabled));
}

export function applyPreAuthDarkMode(
  storage = globalThis.localStorage,
  doc = globalThis.document,
) {
  const enabled = readPreAuthDarkMode(storage);
  applyDarkClass(enabled, doc);
  return enabled;
}

export function syncAccountDarkMode(
  darkMode,
  storage = globalThis.localStorage,
  doc = globalThis.document,
) {
  const enabled = Boolean(darkMode);
  applyDarkClass(enabled, doc);
  try {
    storage?.setItem(UI_DARK_KEY, JSON.stringify(enabled));
  } catch {}
  return enabled;
}

export function primeLoginDarkMode(
  username,
  storage = globalThis.localStorage,
) {
  const trimmed = typeof username === "string" ? username.trim() : "";
  if (!trimmed) return false;
  let enabled = false;
  try {
    const accountStore = createAccountStorage(trimmed, () => storage);
    enabled = parseBoolean(accountStore.getItem("darkMode")) === true;
  } catch {}
  try {
    storage?.setItem(UI_DARK_KEY, JSON.stringify(enabled));
  } catch {}
  return enabled;
}
