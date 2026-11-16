/** Letters that NFD does not decompose into base + combining mark. */
const NON_DECOMPOSING: Readonly<Record<string, string>> = {
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ø: 'o',
  ı: 'i',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

/** Lower-cases `text`, strips diacritics and spells out non-decomposing letters, so "Łódź" becomes "lodz". */
export function foldLetters(text: string): string {
  const base = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return Object.entries(NON_DECOMPOSING).reduce((t, [from, to]) => t.replaceAll(from, to), base);
}
