/** Use the same spoken text representation for prose and contact targets. */
export function normalizeStoryAudio(text) {
  return (text || "").normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’]/g, "'").replace(/[—–]/g, "-").replace(/…/g, "...")
    .replace(/[“”"]/g, " ").replace(/[^A-Za-z0-9' ,.!?\-:\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Adapt book punctuation and long prose to the existing ASCII/200-char TTS API. */
export function storyAudioSegments(text) {
  const normalized = normalizeStoryAudio(text);
  const segments = [];
  for (let sentence of normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []) {
    sentence = sentence.trim();
    while (sentence.length > 200) {
      const space = sentence.lastIndexOf(" ", 200);
      const end = space > 0 ? space : 200;
      segments.push(sentence.slice(0, end));
      sentence = sentence.slice(end).trim();
    }
    if (sentence) segments.push(sentence);
  }
  return segments;
}
