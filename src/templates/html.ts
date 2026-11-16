import { escapeHtml } from '../lib/escape.ts';

/** Trusted markup produced by `html`; interpolated without escaping. */
export class Markup {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  toString(): string {
    return this.#value;
  }
}

/** Anything `html` accepts in an interpolation. */
export type Interpolation =
  | Markup
  | string
  | number
  | null
  | undefined
  | false
  | readonly Interpolation[];

const isList = (value: Interpolation): value is readonly Interpolation[] => Array.isArray(value);

function render(value: Interpolation): string {
  if (value == null || value === false) {
    return '';
  }
  if (value instanceof Markup) {
    return value.toString();
  }
  if (isList(value)) {
    return value.map(render).join('');
  }
  return escapeHtml(value);
}

/** Tagged template: escapes interpolations unless `Markup`, concatenates arrays, renders null, undefined and false as nothing. */
export function html(strings: TemplateStringsArray, ...values: Interpolation[]): Markup {
  let out = strings[0] ?? '';
  for (const [i, value] of values.entries()) {
    out += render(value) + (strings[i + 1] ?? '');
  }
  return new Markup(out);
}

/** `<hN>` element; `content` is escaped like any interpolation. The `h1` is the page title and carries `page-title`. */
export function heading(level: 1 | 2 | 3, content: Interpolation): Markup {
  return level === 1
    ? html`<h1 class="page-title">${content}</h1>`
    : html`<h${level}>${content}</h${level}>`;
}
