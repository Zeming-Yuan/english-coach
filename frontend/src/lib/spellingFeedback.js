/** Split typed and expected text into shared prefix, changed span, and shared suffix. */
export function spellingDiffParts(typed, expected) {
  const actual = Array.from((typed || "").trim());
  const target = Array.from((expected || "").trim());
  let start = 0;
  while (
    start < actual.length &&
    start < target.length &&
    actual[start].toLowerCase() === target[start].toLowerCase()
  ) {
    start += 1;
  }
  if (start === actual.length && start === target.length) {
    const same = actual.join("");
    return {
      equal: true,
      start,
      typed: { prefix: same, changed: "", suffix: "" },
      expected: { prefix: same, changed: "", suffix: "" },
    };
  }

  let actualEnd = actual.length;
  let targetEnd = target.length;
  while (
    actualEnd > start &&
    targetEnd > start &&
    actual[actualEnd - 1].toLowerCase() === target[targetEnd - 1].toLowerCase()
  ) {
    actualEnd -= 1;
    targetEnd -= 1;
  }
  return {
    equal: false,
    start,
    typed: {
      prefix: actual.slice(0, start).join(""),
      changed: actual.slice(start, actualEnd).join(""),
      suffix: actual.slice(actualEnd).join(""),
    },
    expected: {
      prefix: target.slice(0, start).join(""),
      changed: target.slice(start, targetEnd).join(""),
      suffix: target.slice(targetEnd).join(""),
    },
  };
}

/** Describe the changed span between the shared beginning and end. */
export function spellingDifference(typed, expected) {
  const parts = spellingDiffParts(typed, expected);
  if (parts.equal) return "";
  const written = parts.typed.changed;
  const required = parts.expected.changed;
  if (!written) return `第 ${parts.start + 1} 处缺少：${required}`;
  if (!required) return `第 ${parts.start + 1} 处多写：${written}`;
  const unit =
    Array.from(written).length === 1 && Array.from(required).length === 1
      ? "个字母"
      : "处";
  return `第 ${parts.start + 1} ${unit}：${written} → ${required}`;
}
