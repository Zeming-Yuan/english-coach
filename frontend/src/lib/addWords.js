function wordKey(word) {
  // Match the server's case-insensitive identity, including expansions such as ﬂ → fl.
  // Fold per character to keep Greek sigma context independent and dotless ı distinct.
  return Array.from(word, letter => letter === "ı" ? letter : letter.toUpperCase().toLowerCase())
    .join("")
    .replaceAll("ß", "ss");
}

export function parseAddWords(raw, mode) {
  const text = raw.trim();
  const values = mode === "phrase" ? [text] : text.split(/[,，\s]+/);
  const seen = new Set();
  return values.filter(value => {
    const key = wordKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
