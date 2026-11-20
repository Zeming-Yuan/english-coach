export function relativeLuminance(rgbString) {
  const [r, g, b] = rgbString
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map((v) => Number(v) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgRgb, bgRgb) {
  const a = relativeLuminance(fgRgb);
  const b = relativeLuminance(bgRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
