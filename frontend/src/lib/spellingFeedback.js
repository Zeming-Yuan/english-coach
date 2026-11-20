/** Describe the changed span between the shared beginning and end. */
export function spellingDifference(typed, expected) {
  const actual = Array.from(typed.trim());
  const target = Array.from(expected.trim());
  let start = 0;
  while (start < actual.length && start < target.length
    && actual[start].toLowerCase() === target[start].toLowerCase()) start += 1;
  if (start === actual.length && start === target.length) return "";

  let actualEnd = actual.length;
  let targetEnd = target.length;
  while (actualEnd > start && targetEnd > start
    && actual[actualEnd - 1].toLowerCase() === target[targetEnd - 1].toLowerCase()) {
    actualEnd -= 1;
    targetEnd -= 1;
  }
  const written = actual.slice(start, actualEnd).join("");
  const required = target.slice(start, targetEnd).join("");
  if (!written) return `第 ${start + 1} 处缺少：${required}`;
  if (!required) return `第 ${start + 1} 处多写：${written}`;
  const unit = actualEnd - start === 1 && targetEnd - start === 1 ? "个字母" : "处";
  return `第 ${start + 1} ${unit}：${written} → ${required}`;
}
