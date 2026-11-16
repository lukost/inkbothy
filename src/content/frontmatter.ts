import { parse } from 'yaml';
import { errorMessage, isRecord } from '../shared/guards.ts';

const FENCE = /^---[ \t]*$/;

export interface FrontMatter {
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/**
 * Split a content file into YAML front-matter and Markdown body.
 *
 * Only a `---` fence on the very first line opens front-matter; the next `---`
 * line closes it. YAML uses the 1.2 core schema, so dates stay strings.
 *
 * @param text raw file content (BOM and CRLF tolerated)
 * @param file name used in error messages
 * @throws Error on unterminated fence, invalid YAML, or non-mapping YAML
 */
export function splitFrontMatter(text: string, file = '<input>'): FrontMatter {
  const src = (text.startsWith('﻿') ? text.slice(1) : text).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (!FENCE.test(lines[0] ?? '')) {
    return { data: {}, body: src };
  }
  const end = lines.findIndex((line, i) => i > 0 && FENCE.test(line));
  if (end === -1) {
    throw new Error(`${file}: unterminated front-matter (missing closing ---)`);
  }

  let data: unknown;
  try {
    data = parse(lines.slice(1, end).join('\n'), { schema: 'core' }) ?? {};
  } catch (err) {
    throw new Error(`${file}: invalid YAML front-matter: ${errorMessage(err)}`, { cause: err });
  }
  if (!isRecord(data)) {
    throw new Error(`${file}: front-matter must be a key/value mapping`);
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}
