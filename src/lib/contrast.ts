const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` or `#rrggbb` as sRGB channels in 0–255. */
export function parseHex(color: string): readonly [number, number, number] {
  if (!HEX.test(color)) {
    throw new RangeError(`not a #rgb or #rrggbb colour: ${color}`);
  }
  const digits =
    color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1);
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast ratio, 1 to 21; symmetric in its arguments. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
