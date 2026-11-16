import fs from 'node:fs/promises';
import path from 'node:path';
import { isMap, parseDocument } from 'yaml';
import type { z } from 'zod';
import { isErrnoException } from '../lib/node-guards.ts';
import { errorMessage } from '../shared/guards.ts';
import { type SiteConfig, siteSchema } from './schema.ts';

/** Unreadable, malformed or invalid site configuration. One line per problem, naming the file and path. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Path = readonly PropertyKey[];

/** `sections.blog.stream[0]`-style rendering of an issue path. */
const dotted = (keys: Path): string =>
  keys.reduce<string>(
    (out, key) =>
      typeof key === 'number' ? `${out}[${key}]` : `${out}${out && '.'}${String(key)}`,
    '',
  );

/** Issues to report: unknown keys one by one, and a failed union as the problems of its closest branch. */
function flatten(issue: z.core.$ZodIssue): { path: Path; message: string }[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({ path: [...issue.path, key], message: 'unknown key' }));
  }
  if (issue.code === 'invalid_union' && issue.errors.length > 0) {
    const closest = issue.errors.reduce((a, b) => (b.length < a.length ? b : a));
    return closest.flatMap(flatten).map((i) => ({ ...i, path: [...issue.path, ...i.path] }));
  }
  return [{ path: issue.path, message: issue.message }];
}

/**
 * The validated configuration in the YAML file `file`.
 * @throws ConfigError if the file is missing, not valid YAML (line and column given; warnings count), cannot be converted, or breaks the schema
 */
export async function loadConfig(file: string): Promise<SiteConfig> {
  const name = path.basename(file);
  const fail = (...lines: string[]): never => {
    throw new ConfigError(lines.map((line) => `${name}: ${line}`).join('\n'));
  };
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (err) {
    return isErrnoException(err) && err.code === 'ENOENT'
      ? fail('file not found')
      : fail(errorMessage(err));
  }
  const doc = parseDocument(source, { schema: 'core' });
  const [syntax] = [...doc.errors, ...doc.warnings];
  if (syntax) {
    return fail(syntax.message.replace(/:?\n[\s\S]*/, ''));
  }
  // A `__proto__` key would vanish when the mapping becomes an object.
  const sections = doc.get('sections', true);
  if (isMap(sections) && sections.has('__proto__')) {
    return fail('sections.__proto__: section key must be a clean slug (suggest "proto")');
  }
  let data: unknown;
  try {
    data = doc.toJS();
  } catch (err) {
    return fail(errorMessage(err));
  }
  const parsed = siteSchema.safeParse(data);
  if (!parsed.success) {
    return fail(
      ...parsed.error.issues
        .flatMap(flatten)
        .map(({ path: at, message }) => (at.length ? `${dotted(at)}: ${message}` : message)),
    );
  }
  return parsed.data;
}
