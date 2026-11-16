import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { isRecord } from '../../shared/guards.ts';
import { type FenceInfo, parseFenceInfo } from './fence-info.ts';
import { type LanguageName, resolveLanguage } from './languages.ts';

/** What the `fence_info` rule stores in the `meta` of a fence token. */
export type FenceMeta = {
  readonly info: FenceInfo;
  /** `info.lang`, lower-cased ('' if none). */
  readonly lang: string;
  /** The curated language, if the block is highlighted. */
  readonly language: LanguageName | undefined;
};

function isFenceMeta(value: unknown): value is FenceMeta {
  return isRecord(value) && isRecord(value.info) && typeof value.lang === 'string';
}

/**
 * The parsed info string of a fence token.
 * @throws if the `fences` plugin did not process the token
 */
export function fenceMeta(token: Token): FenceMeta {
  const { meta } = token;
  if (!isFenceMeta(meta)) {
    throw new Error('fence token without parsed info; the fences plugin is missing');
  }
  return meta;
}

function parseFences(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type === 'fence') {
      const info = parseFenceInfo(token.info);
      const meta: FenceMeta = {
        info,
        lang: info.lang.toLowerCase(),
        language: resolveLanguage(info.lang),
      };
      token.meta = meta;
    }
  }
}

/** Parses each code fence's info string once, so the renderer, the analysis and the grammar loader agree. */
export default function fences(md: MarkdownIt): void {
  md.core.ruler.after('block', 'fence_info', parseFences);
}
