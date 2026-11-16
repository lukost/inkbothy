/** Languages with a bundled Shiki grammar (Shiki names). */
export const LANGUAGES = [
  'c',
  'cpp',
  'rust',
  'python',
  'shellscript',
  'shellsession',
  'typescript',
  'javascript',
  'yaml',
  'ini',
  'makefile',
  'cmake',
  'diff',
  'asm',
  'dockerfile',
  'lua',
  'r',
  'matlab',
  'wolfram',
] as const;

export type LanguageName = (typeof LANGUAGES)[number];

const ALIAS_TABLE = {
  'c++': 'cpp',
  h: 'c',
  hpp: 'cpp',
  rs: 'rust',
  py: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  console: 'shellsession',
  ts: 'typescript',
  js: 'javascript',
  yml: 'yaml',
  conf: 'ini',
  make: 'makefile',
  patch: 'diff',
  assembly: 'asm',
  docker: 'dockerfile',
  mathematica: 'wolfram',
} as const satisfies Record<string, LanguageName>;

const BY_TAG: ReadonlyMap<string, LanguageName> = new Map<string, LanguageName>([
  ...LANGUAGES.map((l): [string, LanguageName] => [l, l]),
  ...Object.entries(ALIAS_TABLE),
]);

/** Fence languages that are deliberately not highlighted. */
const PLAIN: ReadonlySet<string> = new Set(['text', 'plaintext', 'txt', 'mermaid']);

/** Curated language for a fence tag (name or alias, any case), if there is one. */
export function resolveLanguage(tag: string): LanguageName | undefined {
  return BY_TAG.get(tag.toLowerCase());
}

/** Whether a fence tag is highlighted or intentionally plain (no build warning). */
export function isKnownFenceLanguage(tag: string): boolean {
  return resolveLanguage(tag) !== undefined || PLAIN.has(tag.toLowerCase());
}
