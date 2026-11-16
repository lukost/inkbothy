import fs from 'node:fs/promises';
import path from 'node:path';
import { compareLabels, compareStrings } from '../lib/compare.ts';
import { assertInside, ROOT } from '../lib/paths.ts';
import { safeHttpUrl } from '../lib/url.ts';
import { errorMessage, isRecord } from '../shared/guards.ts';
import type { Attribution } from '../types.ts';
import { readOptionalYaml } from './yaml.ts';

const LICENSE_FILE_RE = /^(licen[cs]e|copying)([.\-_].*)?$/i;
const HOSTS: ReadonlyMap<string, string> = new Map([
  ['github', 'github.com'],
  ['gitlab', 'gitlab.com'],
  ['bitbucket', 'bitbucket.org'],
]);
const SHORTHAND_RE = /^(?:(?<host>github|gitlab|bitbucket):)?(?<repo>[\w.-]+\/[\w.-]+)$/;
const SCP_RE = /^[\w.-]+@(?<host>[\w.-]+):(?<path>.+)$/;

interface Collected {
  readonly entries: readonly Attribution[];
  readonly warnings: readonly string[];
}

/** Package root for a file under node_modules (scoped and nested packages); null otherwise. */
export function packageDirFromPath(file: string): string | null {
  const parts = path.resolve(file).split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  const next = parts[i + 1];
  if (i === -1 || next === undefined) {
    return null;
  }
  const end = next.startsWith('@') ? i + 3 : i + 2;
  return end <= parts.length ? parts.slice(0, end).join(path.sep) : null;
}

/** Browsable URL from a package.json `repository` field. */
export function repositoryUrl(repository: unknown): string | null {
  const raw = isRecord(repository) ? repository.url : repository;
  const spec = typeof raw === 'string' ? raw.trim() : '';
  if (!spec) {
    return null;
  }
  const short = SHORTHAND_RE.exec(spec)?.groups;
  const host = HOSTS.get(short?.host ?? 'github');
  if (short?.repo && host) {
    return `https://${host}/${short.repo.replace(/\.git$/, '')}`;
  }
  const scp = SCP_RE.exec(spec)?.groups;
  const url = (scp ? `https://${scp.host}/${scp.path}` : spec)
    .replace(/^git\+/, '')
    .replace(/^(git|ssh):\/\/(?:[^@/]+@)?/, 'https://')
    .replace(/\.git$/, '');
  return safeHttpUrl(url);
}

function authorName(author: unknown): string {
  const name = typeof author === 'string' ? author.replace(/\s*[<(].*$/, '') : undefined;
  const fromObject = isRecord(author) && typeof author.name === 'string' ? author.name : undefined;
  return (name ?? fromObject ?? '').trim();
}

function licenseId(pkg: Readonly<Record<string, unknown>>): string {
  if (typeof pkg.license === 'string' && pkg.license.trim()) {
    return pkg.license.trim();
  }
  const legacy = [pkg.license, ...(Array.isArray(pkg.licenses) ? pkg.licenses : [])]
    .map((l) => (isRecord(l) ? l.type : undefined))
    .filter((t): t is string => typeof t === 'string' && t !== '');
  return legacy.length ? [...new Set(legacy)].join(' OR ') : 'UNKNOWN';
}

async function findLicenseFile(dir: string): Promise<string | null> {
  const names = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && LICENSE_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort(compareStrings);
  return names[0] ? path.join(dir, names[0]) : null;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Attribution data of one npm package; unreadable packages yield a warning.
 * `overrides` supplies the licence of a package that declares none but ships a
 * licence file; `overridden` names the package when one was applied. A package
 * without a licence file takes the one from `licenseFrom`, if given.
 */
export async function readPackage(
  dir: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  licenseFrom?: string,
): Promise<{ entry: Attribution | null; warnings: string[]; overridden?: string }> {
  let pkg: unknown;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch (err) {
    return {
      entry: null,
      warnings: [`attributions: cannot read package at ${dir}: ${errorMessage(err)}`],
    };
  }
  if (!isRecord(pkg)) {
    return { entry: null, warnings: [`attributions: ${dir}/package.json is not an object`] };
  }
  const name = typeof pkg.name === 'string' && pkg.name ? pkg.name : path.basename(dir);
  const licenseFile =
    (await findLicenseFile(dir)) ?? (licenseFrom ? await findLicenseFile(licenseFrom) : null);
  const declared = licenseId(pkg);
  const override = declared === 'UNKNOWN' && licenseFile ? overrides.get(name) : undefined;
  const entry: Attribution = {
    name,
    version: typeof pkg.version === 'string' ? pkg.version : '',
    author: authorName(pkg.author),
    url: safeHttpUrl(pkg.homepage) ?? repositoryUrl(pkg.repository),
    license: override ?? declared,
    licenseFile,
  };
  const warnings: string[] = [];
  if (entry.license === 'UNKNOWN') {
    warnings.push(`attributions: ${name} declares no licence`);
  }
  if (!entry.licenseFile) {
    warnings.push(`attributions: ${name} ships no licence file`);
  }
  return { entry, warnings, ...(override === undefined ? {} : { overridden: name }) };
}

/** An attributions data file; warnings carry the `attributions:` prefix. */
async function readAttributionYaml(
  file: string,
): Promise<{ data: unknown; warnings: readonly string[] }> {
  const { data, warnings } = await readOptionalYaml(file);
  return { data, warnings: warnings.map((msg) => `attributions: ${msg}`) };
}

/** Licence ids for packages that declare none: a YAML mapping `package: SPDX-id`. */
export async function readOverrides(file: string): Promise<{
  overrides: ReadonlyMap<string, string>;
  warnings: readonly string[];
}> {
  const { data, warnings } = await readAttributionYaml(file);
  const overrides = new Map<string, string>();
  if (data == null) {
    return { overrides, warnings };
  }
  if (!isRecord(data)) {
    return {
      overrides,
      warnings: [`attributions: ${file} must be a YAML mapping; ignored`],
    };
  }
  const problems: string[] = [];
  for (const [name, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.trim()) {
      overrides.set(name, value.trim());
    } else {
      problems.push(`attributions: licence override for "${name}" must be a licence id; ignored`);
    }
  }
  return { overrides, warnings: problems };
}

/** Hand-kept extras (fonts, other non-npm assets) from a YAML list; a missing file means none, malformed content yields warnings. */
export async function readExtras(file: string, licensesDir: string): Promise<Collected> {
  const { data: list, warnings: readWarnings } = await readAttributionYaml(file);
  if (list == null) {
    return { entries: [], warnings: readWarnings };
  }
  if (!Array.isArray(list)) {
    return { entries: [], warnings: [`attributions: ${file} must be a YAML list; ignored`] };
  }
  const entries: Attribution[] = [];
  const warnings: string[] = [];
  for (const [i, raw] of list.entries()) {
    const x = isRecord(raw) ? raw : {};
    const name = typeof x.name === 'string' ? x.name.trim() : '';
    if (!name) {
      warnings.push(`attributions: extra #${i} has no name; ignored`);
      continue;
    }
    let licenseFile: string | null = null;
    if (typeof x.licenseFile === 'string' && x.licenseFile) {
      try {
        licenseFile = assertInside(licensesDir, x.licenseFile);
      } catch {
        warnings.push(`attributions: ${name}: licenseFile escapes ${licensesDir}; ignored`);
      }
      if (licenseFile && !(await isFile(licenseFile))) {
        warnings.push(`attributions: ${name}: licence file not found: ${x.licenseFile}`);
        licenseFile = null;
      }
    }
    if (!licenseFile) {
      warnings.push(`attributions: ${name} has no licence file`);
    }
    entries.push({
      name,
      version: typeof x.version === 'string' ? x.version : '',
      author: typeof x.author === 'string' ? x.author.trim() : '',
      url: safeHttpUrl(x.url),
      license: typeof x.license === 'string' && x.license.trim() ? x.license.trim() : 'UNKNOWN',
      licenseFile,
    });
  }
  return { entries, warnings };
}

const sortEntries = (entries: Iterable<Attribution>): Attribution[] =>
  [...entries].sort(
    (a, b) => compareLabels(a.name, b.name) || compareStrings(a.version, b.version),
  );

/** Sorted, distinct npm package roots of the files that live in `node_modules` (paths relative to ROOT or absolute). */
export function packageDirsOf(files: Iterable<string>): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = packageDirFromPath(path.resolve(ROOT, file));
    if (dir) {
      dirs.add(dir);
    }
  }
  return [...dirs].sort(compareStrings);
}

/** Attributions of the packages in `dirs`, deduplicated by name@version. */
async function readPackages(
  dirs: Iterable<string>,
  overrides: ReadonlyMap<string, string>,
  applied: Set<string>,
  warnings: string[],
  licenseSources: ReadonlyMap<string, string> = new Map(),
): Promise<Map<string, Attribution>> {
  const byKey = new Map<string, Attribution>();
  for (const dir of new Set(dirs)) {
    const {
      entry,
      warnings: w,
      overridden,
    } = await readPackage(dir, overrides, licenseSources.get(dir));
    warnings.push(...w);
    if (overridden !== undefined) {
      applied.add(overridden);
    }
    if (entry && !byKey.has(`${entry.name}@${entry.version}`)) {
      byKey.set(`${entry.name}@${entry.version}`, entry);
    }
  }
  return byKey;
}

export interface AttributionSections {
  /** Shipped to the browser: npm packages and hand-kept extras. */
  readonly distributed: readonly Attribution[];
  /** Used by the generator only, minus anything already distributed. */
  readonly builtWith: readonly Attribution[];
  readonly warnings: readonly string[];
}

/** Both attribution sections, each sorted by name. */
export async function collectAttributions({
  distributedDirs,
  builtWithDirs,
  licenseSources,
  extrasFile,
  licensesDir,
  overridesFile,
}: {
  readonly distributedDirs: readonly string[];
  readonly builtWithDirs: readonly string[];
  /** Package dir to the package dir whose licence file it uses, for packages that ship none. */
  readonly licenseSources?: ReadonlyMap<string, string>;
  readonly extrasFile: string;
  readonly licensesDir: string;
  readonly overridesFile: string;
}): Promise<AttributionSections> {
  const warnings: string[] = [];
  const { overrides, warnings: overrideWarnings } = await readOverrides(overridesFile);
  warnings.push(...overrideWarnings);
  const applied = new Set<string>();
  const shipped = await readPackages(distributedDirs, overrides, applied, warnings);
  const built = await readPackages(
    builtWithDirs.filter((dir) => !distributedDirs.includes(dir)),
    overrides,
    applied,
    warnings,
    licenseSources,
  );
  for (const name of overrides.keys()) {
    if (!applied.has(name)) {
      warnings.push(`attributions: licence override for "${name}" unused`);
    }
  }
  const extras = await readExtras(extrasFile, licensesDir);
  warnings.push(...extras.warnings);
  return {
    distributed: sortEntries([...shipped.values(), ...extras.entries]),
    builtWith: sortEntries([...built].filter(([key]) => !shipped.has(key)).map(([, e]) => e)),
    warnings,
  };
}
