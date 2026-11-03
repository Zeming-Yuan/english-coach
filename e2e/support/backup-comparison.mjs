/** Independent business comparison for migrated backup acceptance. */
export function normalizedBackup(payload) {
  const refs = Object.fromEntries(["cards", "lessons", "stories"].map(name => [name,
    Object.fromEntries(payload[name].map(row => [row.id,
      name === "cards" ? `${row.kind}:${row.word}` : name === "lessons" ? row.level : row.title]))]));
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, item]) => {
      if (key === "id" && typeof item === "number" || key === "feedback_epoch") return [];
      if (key === "raw") return [[key, item]]; // immutable migration audit, not live references
      const parent = {card_id: "cards", sentence_card_id: "cards", lesson_id: "lessons", story_id: "stories"}[key];
      if (parent && item != null) return [[key, refs[parent][item]]];
      if (key === "resource_id") return [[key, refs[{card: "cards", lesson: "lessons", story: "stories"}[value.resource_kind]][item]]];
      return [[key, normalize(item)]];
    }));
  };
  const copy = structuredClone(payload);
  delete copy.exported_at;
  for (const event of copy.learning_events) delete event.fingerprint; // recomputed with remapped card ID
  const collections = [...Object.entries(copy).filter(([, rows]) => Array.isArray(rows)), ...Object.entries(copy.extensions)];
  for (const [name, rows] of collections) {
    const mapped = rows.map(normalize);
    // Saving order determines same-day first answers and equal-time last contact.
    if (name !== "learning_events" && name !== "learning_contacts") {
      mapped.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    rows.splice(0, rows.length, ...mapped);
  }
  return copy;
}
