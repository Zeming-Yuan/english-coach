/** Independent business comparison for migrated backup acceptance. */
export function normalizedBackup(payload) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const invalid = path => { throw new Error(`Invalid backup: ${path}`); };
  if (!object(payload)) invalid("root must be an object");
  for (const name of ["cards", "reviews", "learning_events", "review_baselines", "memos", "errors", "hard_cards", "lessons", "stories", "story_words"]) {
    if (!Array.isArray(payload[name])) invalid(`${name} must be an array`);
  }
  if (!object(payload.extensions)) invalid("extensions must be an object");
  for (const [name, rows] of [...Object.entries(payload).filter(([, rows]) => Array.isArray(rows)), ...Object.entries(payload.extensions)]) {
    if (!Array.isArray(rows)) invalid(`${name} must be an array`);
    if (name === "features" && rows === payload.features) {
      if (rows.some(item => typeof item !== "string")) invalid("features must contain names");
      continue;
    }
    rows.forEach((row, index) => {if (!object(row)) invalid(`${name}[${index}] must be an object`);});
  }
  for (const name of ["cards", "lessons", "stories"]) {
    const ids = new Set();
    for (const row of payload[name]) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) invalid(`${name} has invalid/duplicate id`);
      ids.add(row.id);
    }
  }
  const refs = Object.fromEntries(["cards", "lessons", "stories"].map(name => [name,
    Object.fromEntries(payload[name].map(row => [row.id,
      name === "cards" ? `${row.kind}:${row.word}` : name === "lessons" ? row.level : row.title]))]));
  const reference = (parent, item, key) => {
    if (typeof parent !== "string" || !Object.hasOwn(refs, parent) || !Object.hasOwn(refs[parent], item)) invalid(`dangling reference ${key}=${item}`);
    return refs[parent][item];
  };
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, item]) => {
      if (key === "id" && typeof item === "number" || key === "feedback_epoch") return [];
      if (key === "raw") return [[key, item]]; // immutable migration audit, not live references
      const parent = {card_id: "cards", sentence_card_id: "cards", lesson_id: "lessons", story_id: "stories"}[key];
      if (parent && item != null) return [[key, reference(parent, item, key)]];
      if (key === "resource_id") return [[key, reference({card: "cards", lesson: "lessons", story: "stories"}[value.resource_kind], item, key)]];
      return [[key, normalize(item)]];
    }));
  };
  const copy = structuredClone(payload);
  delete copy.exported_at;
  for (const event of copy.learning_events) delete event.fingerprint; // recomputed with remapped card ID
  const collections = [
    ...Object.entries(copy).filter(([, rows]) => Array.isArray(rows)).map(([name, rows]) => [copy, name, rows]),
    ...Object.entries(copy.extensions).map(([name, rows]) => [copy.extensions, name, rows]),
  ];
  for (const [owner, name, rows] of collections) {
    const mapped = rows.map(normalize);
    // Saving order determines same-day first answers and equal-time last contact.
    if (name !== "learning_events" && name !== "learning_contacts") {
      mapped.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    owner[name] = mapped;
  }
  return copy;
}
