import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { interruptSignal, type Output, parseOrUsage, runIfMain } from '../lib/cli.ts';
import { compareStrings } from '../lib/compare.ts';
import { isErrnoException } from '../lib/node-guards.ts';
import { assertInside, ROOT, toPosix } from '../lib/paths.ts';
import { errorMessage } from '../shared/guards.ts';

const USAGE = `usage: mutate [--jobs <n>] [--timeout <s>] <path>...
Each path is a file or a directory under src/ (default: src/). Every mutant of a source file is
run against its tests; a mutant whose tests still pass survived and is reported.`;
const DEFAULT_TIMEOUT_S = 120;
/** Directories copied into each job's workspace, besides the files of the project root. */
const COPIED_DIRS: ReadonlySet<string> = new Set(['src', 'tests', 'data', 'docs', 'site.sample']);

/** One change to one line of a source file. */
export interface Mutant {
  /** Project-relative path with `/` separators. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  readonly operator: string;
  /** The whole line as it reads after the change. */
  readonly text: string;
}

interface Operator {
  readonly name: string;
  /** Global: each match is one mutant. */
  readonly pattern: RegExp;
  /** The text that takes the place of one match. */
  readonly replace: (match: string) => string;
}

const swap = (name: string, pattern: RegExp, to: string): Operator => ({
  name,
  pattern,
  replace: () => to,
});

const OPERATORS: readonly Operator[] = [
  swap('=== -> !==', / === /g, ' !== '),
  swap('!== -> ===', / !== /g, ' === '),
  swap('&& -> ||', / && /g, ' || '),
  swap('|| -> &&', / \|\| /g, ' && '),
  swap('< -> <=', / < /g, ' <= '),
  swap('> -> >=', / > /g, ' >= '),
  swap('<= -> <', / <= /g, ' < '),
  swap('>= -> >', / >= /g, ' > '),
  swap('true -> false', /\btrue\b/g, 'false'),
  swap('false -> true', /\bfalse\b/g, 'true'),
  swap('if (!x) -> if (x)', /if \(!/g, 'if ('),
  swap('?? -> ||', /\?\? /g, '|| '),
  { name: 'n -> n + 1', pattern: /\b\d+\b/g, replace: (n) => String(Number(n) + 1) },
];

/** A statement that is one complete call, such as `await fs.rm(dir);`; the indentation is captured. */
const CALL_STATEMENT = /^(\s+)(?:await\s+|void\s+)?[\w$.]+\(.*\);$/;
const COMMENT_OR_IMPORT = /^(?:\/\/|\/\*|\*|import\s|export type\s)/;
/** How a declaration ends, by its keyword. */
const DECLARATION_END: ReadonlyMap<string, string> = new Map([
  ['interface', '}'],
  ['type', ';'],
]);
const TYPE_DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?(interface|type)\s+\w/;

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;
/** Opening minus closing brackets of `line`: how much deeper the next line is nested. */
const nesting = (line: string): number => count(line, /[{([]/g) - count(line, /[})\]]/g);

/**
 * Indices of the lines that belong to an `interface` or `type` declaration. A `type` alias ends at
 * the first line ending in `;` outside any brackets: the formatter (Biome) always terminates
 * statements, so the sources here always have it; an alias without it would swallow what follows.
 */
function typeOnlyLines(lines: readonly string[]): Set<number> {
  const found = new Set<number>();
  let ending: string | undefined;
  let depth = 0;
  for (const [i, line] of lines.entries()) {
    ending ??= DECLARATION_END.get(TYPE_DECLARATION.exec(line)?.[1] ?? '');
    if (ending !== undefined) {
      found.add(i);
      depth += nesting(line);
      if (depth <= 0 && line.trimEnd().endsWith(ending)) {
        ending = undefined;
        depth = 0;
      }
    }
  }
  return found;
}

/** The mutants of one line, as the lines they would become: one for each match of each operator. */
function lineMutants(line: string): { operator: string; text: string }[] {
  const out: { operator: string; text: string }[] = [];
  for (const { name, pattern, replace } of OPERATORS) {
    for (const match of line.matchAll(pattern)) {
      const end = match.index + match[0].length;
      out.push({
        operator: name,
        text: line.slice(0, match.index) + replace(match[0]) + line.slice(end),
      });
    }
  }
  const call = CALL_STATEMENT.exec(line);
  if (call && !line.trim().startsWith('super(') && count(line, /\(/g) === count(line, /\)/g)) {
    out.push({ operator: 'delete call', text: `${call[1]}// deleted` });
  }
  return out;
}

/**
 * Every mutant of `source`, line by line: comparison, logical and literal operators swapped, numbers
 * incremented, one-line call statements deleted. Comments, imports and type declarations are left alone.
 */
export function mutants(source: string, file: string): Mutant[] {
  const lines = source.split('\n');
  const types = typeOnlyLines(lines);
  return lines.flatMap((line, i) =>
    types.has(i) || COMMENT_OR_IMPORT.test(line.trim())
      ? []
      : lineMutants(line).map(({ operator, text }) => ({ file, line: i + 1, operator, text })),
  );
}

/** `source` with the line of `mutant` replaced. */
export function apply(source: string, { line, text }: Mutant): string {
  const lines = source.split('\n');
  lines[line - 1] = text;
  return lines.join('\n');
}

/**
 * What to run for a mutant of `file` (project-relative): the test file of the same name below
 * `tests/` if it exists, else the nearest enclosing directory below `tests/` that exists.
 */
export function testsFor(file: string, root = ROOT): string {
  const test = `tests/${file.replace(/^src\//, '').replace(/\.ts$/, '.test.ts')}`;
  if (existsSync(path.join(root, test))) {
    return test;
  }
  let dir = path.posix.dirname(test);
  while (dir !== '.' && !existsSync(path.join(root, dir))) {
    dir = path.posix.dirname(dir);
  }
  return dir === '.' ? 'tests/' : `${dir}/`;
}

/** Half the processors, at least one: each job runs a whole test suite. */
export const defaultJobs = (processors = availableParallelism()): number =>
  Math.max(1, Math.floor(processors / 2));

/** How a test run ended; a timeout counts as a failure of the tests, so the mutant was caught. */
export type Outcome = 'passed' | 'failed' | 'timeout';

/** Runs the tests matching `filter` in the project copy `cwd`; `signal` kills the run. */
export type RunTests = (
  cwd: string,
  filter: string,
  timeoutMs: number,
  signal: AbortSignal,
) => Promise<Outcome>;

/** Kills the process group led by `pid`; a group that is already gone is not an error. */
export function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'ESRCH') {
      throw err;
    }
  }
}

/** `passed` for exit code 0; a run that timed out is `timeout` whatever its exit code. */
function outcomeOf(code: number | null, timedOut: boolean): Outcome {
  if (timedOut) {
    return 'timeout';
  }
  if (code === 0) {
    return 'passed';
  }
  return 'failed';
}

/**
 * Runs vitest with one worker (the jobs are the parallelism) in its own process group, which is
 * killed whole on timeout or abort.
 */
export const runVitest: RunTests = (cwd, filter, timeoutMs, signal) =>
  new Promise((resolve, reject) => {
    const args = ['run', '--maxWorkers=1', filter];
    const child = spawn(path.join(cwd, 'node_modules', '.bin', 'vitest'), args, {
      cwd,
      stdio: 'ignore',
      detached: true,
    });
    let timedOut = false;
    const stop = (): void => {
      if (child.pid !== undefined) {
        killGroup(child.pid);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) {
      stop();
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    };
    child.on('error', (err) => {
      finish();
      reject(err);
    });
    child.on('close', (code) => {
      finish();
      resolve(outcomeOf(code, timedOut));
    });
  });

/** A fresh copy of the project in `dir`: its files, `COPIED_DIRS`, and `node_modules` linked. */
async function prepare(root: string, dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const from = path.join(root, entry.name);
    const to = path.join(dir, entry.name);
    if (entry.name === 'node_modules') {
      await fs.symlink(from, to, 'dir');
    } else if (entry.isFile() || (entry.isDirectory() && COPIED_DIRS.has(entry.name))) {
      await fs.cp(from, to, { recursive: true });
    }
  }
}

/**
 * Waits for all `tasks`; as soon as one fails `onFailure` is called, and once all have settled the
 * first failure is thrown.
 */
async function settleAll(tasks: readonly Promise<void>[], onFailure: () => void): Promise<void> {
  const failures: unknown[] = [];
  await Promise.all(
    tasks.map((task) =>
      task.catch((err: unknown) => {
        failures.push(err);
        onFailure();
      }),
    ),
  );
  if (failures.length > 0) {
    throw failures[0];
  }
}

export interface MutateOptions {
  readonly root: string;
  /** Project-relative paths of the source files to mutate. */
  readonly files: readonly string[];
  readonly jobs: number;
  readonly timeoutMs: number;
  readonly run: RunTests;
  /** Stops the run: running tests are killed and no further mutant is started. */
  readonly signal: AbortSignal;
  /** Called as each mutant is decided. */
  readonly report: (mutant: Mutant, outcome: Outcome) => void;
  /** Called for a test filter that fails on the unmutated copy, with the number of mutants dropped. */
  readonly skip: (filter: string, mutants: number) => void;
}

/**
 * Runs the tests of each source file against every mutant of it, `jobs` at a time, each job in its
 * own copy of the project below `<root>/.tmp/mutate-<pid>/`. Each distinct test filter is first run
 * on the unmutated copy; a filter that fails there is skipped, as every one of its mutants would
 * count as caught. When a job fails, the others are aborted and the first error is thrown once all
 * have settled.
 * @returns how many mutants ran, which survived, and how many were skipped
 */
export async function mutate({
  root,
  files,
  jobs,
  timeoutMs,
  run,
  signal,
  report,
  skip,
}: MutateOptions): Promise<{ total: number; survivors: Mutant[]; skipped: number }> {
  let queue: { mutant: Mutant; original: string }[] = [];
  for (const file of files) {
    const original = await fs.readFile(path.join(root, file), 'utf8');
    queue.push(...mutants(original, file).map((mutant) => ({ mutant, original })));
  }
  const survivors: Mutant[] = [];
  const work = path.join(root, '.tmp', `mutate-${process.pid}`);
  const dirs = Array.from({ length: Math.min(jobs, queue.length) }, (_, n) =>
    path.join(work, String(n)),
  );
  const failed = new AbortController();
  const stop = AbortSignal.any([signal, failed.signal]);
  const settle = (tasks: Promise<void>[]): Promise<void> => settleAll(tasks, () => failed.abort());
  let next = 0;

  async function job(dir: string): Promise<void> {
    for (let entry = queue[next++]; entry && !stop.aborted; entry = queue[next++]) {
      const { mutant, original } = entry;
      const target = path.join(dir, mutant.file);
      await fs.writeFile(target, apply(original, mutant));
      let outcome: Outcome;
      try {
        outcome = await run(dir, testsFor(mutant.file, root), timeoutMs, stop);
      } finally {
        await fs.writeFile(target, original);
      }
      if (!stop.aborted) {
        if (outcome === 'passed') {
          survivors.push(mutant);
        }
        report(mutant, outcome);
      }
    }
  }

  /**
   * Drops the mutants of each test filter that does not pass on the unmutated copy.
   * An aborted run is not a failure.
   */
  async function baseline(): Promise<number> {
    const [dir] = dirs;
    if (dir === undefined) {
      return 0;
    }
    const before = queue.length;
    const filters = new Set(queue.map(({ mutant }) => testsFor(mutant.file, root)));
    for (const filter of filters) {
      const outcome = await run(dir, filter, timeoutMs, stop);
      if (outcome !== 'passed' && !stop.aborted) {
        const dropped = queue.filter(({ mutant }) => testsFor(mutant.file, root) === filter);
        skip(filter, dropped.length);
        queue = queue.filter((entry) => !dropped.includes(entry));
      }
    }
    return before - queue.length;
  }

  let skipped: number;
  try {
    await settle(dirs.map((dir) => prepare(root, dir)));
    skipped = await baseline();
    await settle(dirs.map(job));
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
  return { total: queue.length, survivors, skipped };
}

/** The `.ts` sources (not declarations) at `target`, a file or a directory, as project-relative paths. */
async function sourcesAt(root: string, target: string): Promise<string[]> {
  const found = (await fs.stat(target)).isDirectory()
    ? (await fs.readdir(target, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => path.join(e.parentPath, e.name))
    : [target];
  return found
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => toPosix(path.relative(root, f)));
}

/** A positive whole number from a flag value. @throws Error naming `flag` otherwise */
function positive(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer: ${value}`);
  }
  return Number(value);
}

interface Io {
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly root?: string;
  readonly run?: RunTests;
  readonly signal?: AbortSignal;
}

/**
 * `node src/tools/mutate.ts [--jobs <n>] [--timeout <s>] <path>...`
 *
 * Prints a `SURVIVED` line for each mutant the tests did not catch and a summary.
 * @returns exit code: 0 run completed, 1 failed, interrupted or a test selection skipped, 2 usage error or nothing to mutate
 */
export async function main(
  argv: readonly string[],
  {
    stdout = process.stdout,
    stderr = process.stderr,
    root = ROOT,
    run = runVitest,
    signal = new AbortController().signal,
  }: Io = {},
): Promise<number> {
  const srcDir = path.join(root, 'src');
  const options = parseOrUsage(
    () => {
      const { values, positionals } = parseArgs({
        args: [...argv],
        options: { jobs: { type: 'string' }, timeout: { type: 'string' } },
        allowPositionals: true,
      });
      const targets = positionals.length > 0 ? positionals : [srcDir];
      return {
        jobs: positive('--jobs', values.jobs, defaultJobs()),
        timeoutMs: positive('--timeout', values.timeout, DEFAULT_TIMEOUT_S) * 1000,
        targets: targets.map((t) => {
          try {
            return assertInside(srcDir, path.resolve(t));
          } catch (err) {
            throw new Error(`${t} is not below src/`, { cause: err });
          }
        }),
      };
    },
    USAGE,
    stderr,
  );
  if (options === undefined) {
    return 2;
  }
  try {
    const files = [
      ...new Set((await Promise.all(options.targets.map((t) => sourcesAt(root, t)))).flat()),
    ].sort(compareStrings);
    if (files.length === 0) {
      const where = options.targets.map((t) => toPosix(path.relative(root, t))).join(', ');
      stderr.write(`error: no TypeScript sources under ${where}\n`);
      return 2;
    }
    const { total, survivors, skipped } = await mutate({
      root,
      files,
      jobs: options.jobs,
      timeoutMs: options.timeoutMs,
      run,
      signal,
      skip: (filter, mutants) =>
        stderr.write(`skipped: tests fail without mutation: ${filter} (${mutants} mutants)\n`),
      report: ({ file, line, operator, text }, outcome) => {
        if (outcome === 'passed') {
          stdout.write(`SURVIVED ${file}:${line} [${operator}] -> ${text.trim()}\n`);
        } else if (outcome === 'timeout') {
          stderr.write(`timeout: ${file}:${line} [${operator}]\n`);
        }
      },
    });
    if (signal.aborted) {
      stderr.write('error: interrupted\n');
      return 1;
    }
    stdout.write(
      `${survivors.length} of ${total} survived${skipped > 0 ? `; ${skipped} skipped` : ''}\n`,
    );
    return skipped > 0 ? 1 : 0;
  } catch (err) {
    stderr.write(`error: ${errorMessage(err)}\n`);
    return 1;
  }
}

await runIfMain(import.meta.url, () => main(process.argv.slice(2), { signal: interruptSignal() }));
