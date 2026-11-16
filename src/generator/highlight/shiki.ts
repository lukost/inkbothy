import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { errorMessage } from '../../shared/guards.ts';
import type { LanguageName } from '../markdown/languages.ts';
import type { CodeHighlighter } from '../markdown/markdown.ts';
import { GRUVBOX_TUNED, loadGruvboxTuned } from './gruvbox-tuned.ts';
import { PAPER_THEME, paperTheme } from './paper-theme.ts';

export type LanguageLoaders = Readonly<Record<LanguageName, () => LanguageInput>>;

/** One grammar module per language. */
export const LANGUAGE_LOADERS = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  rust: () => import('@shikijs/langs/rust'),
  python: () => import('@shikijs/langs/python'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  shellsession: () => import('@shikijs/langs/shellsession'),
  typescript: () => import('@shikijs/langs/typescript'),
  javascript: () => import('@shikijs/langs/javascript'),
  yaml: () => import('@shikijs/langs/yaml'),
  ini: () => import('@shikijs/langs/ini'),
  makefile: () => import('@shikijs/langs/makefile'),
  cmake: () => import('@shikijs/langs/cmake'),
  diff: () => import('@shikijs/langs/diff'),
  asm: () => import('@shikijs/langs/asm'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  lua: () => import('@shikijs/langs/lua'),
  r: () => import('@shikijs/langs/r'),
  matlab: () => import('@shikijs/langs/matlab'),
  wolfram: () => import('@shikijs/langs/wolfram'),
} as const satisfies LanguageLoaders;

const THEMES = { light: PAPER_THEME, dark: GRUVBOX_TUNED } as const;

export interface ShikiHighlighter {
  /**
   * Load the grammars of `langs`, in parallel; each grammar is attempted once.
   * @returns one problem per grammar whose attempt this call started and that failed; its blocks stay plain
   * @throws if the highlighter itself cannot be set up
   */
  load(langs: Iterable<LanguageName>): Promise<readonly string[]>;
  /** Highlights code in a loaded language; undefined for any other. */
  readonly highlight: CodeHighlighter;
}

/**
 * Shiki with the JavaScript regex engine and the site's two themes, whose
 * colours are emitted as CSS variables (`--shiki-light`, `--shiki-dark`).
 * Grammars load once; `highlight` is synchronous.
 */
export function createShikiHighlighter(
  loaders: LanguageLoaders = LANGUAGE_LOADERS,
): ShikiHighlighter {
  let setup: Promise<HighlighterCore> | undefined;
  let ready: HighlighterCore | undefined;

  const core = (): Promise<HighlighterCore> => {
    setup ??= createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [paperTheme, loadGruvboxTuned()],
    }).then(
      (shiki) => {
        ready = shiki;
        return shiki;
      },
      (err: unknown) => {
        setup = undefined;
        throw err;
      },
    );
    return setup;
  };

  /** Each grammar is attempted once; its promise resolves to the problem, or to nothing when it loaded. */
  const attempts = new Map<LanguageName, Promise<string | undefined>>();

  const attempt = async (
    shiki: HighlighterCore,
    lang: LanguageName,
  ): Promise<string | undefined> => {
    try {
      await shiki.loadLanguage(loaders[lang]());
      return undefined;
    } catch (err) {
      return `cannot load the "${lang}" grammar: ${errorMessage(err)}`;
    }
  };

  return {
    async load(langs) {
      const shiki = await core();
      const requested = [...new Set(langs)].map((lang) => {
        const known = attempts.get(lang);
        const result = known ?? attempt(shiki, lang);
        attempts.set(lang, result);
        return { result, fresh: known === undefined };
      });
      const problems = await Promise.all(
        requested.map(async ({ result, fresh }) => {
          const problem = await result;
          return fresh ? problem : undefined;
        }),
      );
      return problems.filter((problem): problem is string => typeof problem === 'string');
    },
    highlight(code, lang, lines) {
      if (!ready?.getLoadedLanguages().includes(lang)) {
        return undefined;
      }
      return ready.codeToHtml(code, {
        lang,
        themes: THEMES,
        defaultColor: false,
        transformers: [
          {
            line(node, line) {
              if (lines.has(line)) {
                this.addClassToHast(node, 'highlighted');
              }
            },
          },
        ],
      });
    },
  };
}
