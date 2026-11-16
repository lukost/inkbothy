/** Largest line number accepted in `{…}` and `showLineNumbers=`; guards against runaway ranges. */
const MAX_LINE = 100_000;

export interface FenceInfo {
  /** First bare word, as written ('' if none). */
  readonly lang: string;
  readonly title?: string;
  /** 1-based lines to highlight. */
  readonly highlight: ReadonlySet<number>;
  readonly lineNumbers?: { readonly start: number };
  /** Malformed parts, ignored but reported. */
  readonly problems: readonly string[];
}

const POSITIVE_INT = /^\d+$/;

/** Serialise line numbers for `data-highlight`: ascending, comma-separated. */
export function formatLines(lines: Iterable<number>): string {
  return [...lines].sort((a, b) => a - b).join(',');
}

function lineRange(spec: string): readonly [number, number] | undefined {
  const [from, to = from, extra] = spec.split('-').map((s) => s.trim());
  if (extra !== undefined || !from || !to || !POSITIVE_INT.test(from) || !POSITIVE_INT.test(to)) {
    return undefined;
  }
  const [a, b] = [Number(from), Number(to)];
  return a >= 1 && a <= b && b <= MAX_LINE ? [a, b] : undefined;
}

function startLine(value: string): number | undefined {
  const n = POSITIVE_INT.test(value) ? Number(value) : 0;
  return n >= 1 && n <= MAX_LINE ? n : undefined;
}

/** Parses a fence info string such as `c title="dma.c" {3,5-7} showLineNumbers=42`; malformed parts are dropped and listed in `problems`. */
export function parseFenceInfo(info: string): FenceInfo {
  const highlight = new Set<number>();
  const problems: string[] = [];
  let lang = '';
  let title: string | undefined;
  let lineNumbers: { start: number } | undefined;
  let rest = info.trim();

  while (rest) {
    if (rest.startsWith('{')) {
      const end = rest.indexOf('}');
      if (end === -1) {
        problems.push(`unterminated line list "${rest}"`);
        break;
      }
      for (const spec of rest.slice(1, end).split(',')) {
        const range = lineRange(spec);
        if (!range) {
          problems.push(`invalid line range "${spec.trim()}"`);
          continue;
        }
        for (let n = range[0]; n <= range[1]; n++) {
          highlight.add(n);
        }
      }
      rest = rest.slice(end + 1).trimStart();
      continue;
    }
    const key = /^[^\s={}"]+/.exec(rest)?.[0] ?? '';
    const afterKey = rest.slice(key.length);
    if (!key || !afterKey.startsWith('=')) {
      const word = key || (/^\S+/.exec(rest)?.[0] ?? '');
      if (word === 'showLineNumbers') {
        lineNumbers = { start: 1 };
      } else if (!lang && key) {
        lang = key;
      } else {
        problems.push(`unknown option ${JSON.stringify(word)}`);
      }
      rest = rest.slice(word.length).trimStart();
      continue;
    }
    let value: string;
    if (afterKey.startsWith('="')) {
      const close = afterKey.indexOf('"', 2);
      if (close === -1) {
        problems.push(`unterminated quote in "${key}"`);
        break;
      }
      value = afterKey.slice(2, close);
      rest = afterKey.slice(close + 1).trimStart();
    } else {
      value = /^\S*/.exec(afterKey.slice(1))?.[0] ?? '';
      rest = afterKey.slice(1 + value.length).trimStart();
      if (/[{}]/.test(value)) {
        problems.push(
          `value of "${key}" swallowed a line list; quote it: ${JSON.stringify(value)}`,
        );
      }
    }
    if (key === 'title') {
      title = value;
      if (!value) {
        problems.push('empty title');
      }
    } else if (key === 'showLineNumbers') {
      const start = startLine(value);
      if (start === undefined) {
        problems.push(`invalid showLineNumbers value "${value}"`);
      } else {
        lineNumbers = { start };
      }
    } else {
      problems.push(`unknown option ${JSON.stringify(key)}`);
    }
  }
  return {
    lang,
    ...(title ? { title } : {}),
    highlight,
    ...(lineNumbers ? { lineNumbers } : {}),
    problems,
  };
}
