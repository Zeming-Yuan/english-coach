/** Account identity is fixed for a document lifetime; switching uses a full reload. */
let account;

export function createAccountStorage(username, getStorage = () => globalThis.localStorage) {
  const prefix = username ? `ec.account.${encodeURIComponent(username)}:` : "";
  const keys = () => {
    const storage = getStorage();
    const found = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && (!prefix || key.startsWith(prefix))) found.push(prefix ? key.slice(prefix.length) : key);
    }
    return found;
  };
  return {
    matchesEvent(event, key) { return event.key === null || event.key === prefix + key; },
    get length() { return keys().length; },
    key(index) { return keys()[index] ?? null; },
    getItem(key) { return getStorage().getItem(prefix + key); },
    setItem(key, value) { getStorage().setItem(prefix + key, value); },
    removeItem(key) { getStorage().removeItem(prefix + key); },
  };
}

let scoped = createAccountStorage(null);
export function configureAccount(username) {
  if (account !== undefined && account !== username) throw new Error("切换账号需要重新载入页面");
  account = username;
  scoped = createAccountStorage(username);
}

export const accountStorage = {
  matchesEvent: (event, key) => scoped.matchesEvent(event, key),
  get length() { return scoped.length; },
  key: index => scoped.key(index),
  getItem: key => scoped.getItem(key),
  setItem: (key, value) => scoped.setItem(key, value),
  removeItem: key => scoped.removeItem(key),
};

/** A stale document cannot submit a previous user's pending work with a new cookie. */
export async function accountFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  if (account) headers.set("X-EC-Account", account);
  const response = await fetch(path, {...options, headers});
  if (account && response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("ec-auth-expired"));
  }
  return response;
}
