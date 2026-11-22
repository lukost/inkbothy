import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apply,
  defaultJobs,
  killGroup,
  type Mutant,
  main,
  mutants,
  mutate,
  type Outcome,
  type RunTests,
  runVitest,
  testsFor,
} from '../../src/tools/mutate.ts';
import { sink, trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

/** The mutants of a source made of `lines`, as `[line, operator, text]`. */
const mutate1 = (...lines: string[]) =>
  mutants(lines.join('\n'), 'src/x.ts').map((m) => [m.line, m.operator, m.text]);

describe('mutants', () => {
  it.each([
    ['a === b', '=== -> !==', 'a !== b'],
    ['a !== b', '!== -> ===', 'a === b'],
    ['a && b', '&& -> ||', 'a || b'],
    ['a || b', '|| -> &&', 'a && b'],
    ['a < b', '< -> <=', 'a <= b'],
    ['a > b', '> -> >=', 'a >= b'],
    ['a <= b', '<= -> <', 'a < b'],
    ['a >= b', '>= -> >', 'a > b'],
    ['x = true', 'true -> false', 'x = false'],
    ['x = false', 'false -> true', 'x = true'],
    ['if (!ready) {', 'if (!x) -> if (x)', 'if (ready) {'],
    ['x = a ?? b', '?? -> ||', 'x = a || b'],
    ['x = 41', 'n -> n + 1', 'x = 42'],
  ])('mutates %j with %s', (line, operator, text) => {
    expect(mutate1(line)).toEqual([[1, operator, text]]);
  });

  it('changes one occurrence at a time: a mutant for each match of each operator', () => {
    expect(mutate1('a === b === c && d')).toEqual([
      [1, '=== -> !==', 'a !== b === c && d'],
      [1, '=== -> !==', 'a === b !== c && d'],
      [1, '&& -> ||', 'a === b === c || d'],
    ]);
  });

  it('does not match an operator inside an identifier or an arrow', () => {
    expect(mutate1('const trueish = (a) => a;', 'const sha256 = x;')).toEqual([]);
  });

  it('numbers the lines from 1 and records the file', () => {
    const [mutant] = mutants('const a = 1;\nconst b = 2;\n', 'src/a/b.ts');
    expect(mutants('const a = 1;\nconst b = 2;\n', 'src/a/b.ts')).toHaveLength(2);
    expect(mutant).toEqual({
      file: 'src/a/b.ts',
      line: 1,
      operator: 'n -> n + 1',
      text: 'const a = 2;',
    });
  });

  it('deletes a call statement, keeping its indentation, with or without await or void', () => {
    expect(
      mutate1('  stop();', '    await fs.rm(dir, { force: true });', '  void load(x);'),
    ).toEqual([
      [1, 'delete call', '  // deleted'],
      [2, 'true -> false', '    await fs.rm(dir, { force: false });'],
      [2, 'delete call', '    // deleted'],
      [3, 'delete call', '  // deleted'],
    ]);
  });

  it('keeps statements that are not one whole call', () => {
    expect(
      mutate1(
        '  return load(x);',
        '  const y = load(x);',
        '  super(x);',
        '  a(b, function () {  return c(d);',
        '  load(a,',
        '  ).then(b);',
        'load(x);',
      ),
    ).toEqual([]);
  });

  it('skips comments, imports and type exports', () => {
    expect(
      mutate1(
        '// a === b',
        '/* a === b */',
        ' * a === b',
        "import { a } from './a1.ts';",
        'export type T = 1;',
        '  /** true */',
      ),
    ).toEqual([]);
  });

  it('skips interface and type declarations, however many lines, and resumes after them', () => {
    const lines = [
      'interface A {',
      '  readonly n: 1;',
      '  readonly f: (x: number) => 2;',
      '}',
      'export interface B { n: 1 }',
      'type C =',
      "  | { kind: 'a'; n: 1 }",
      "  | { kind: 'b'; n: 2 };",
      'type D = {',
      '  n: 3;',
      '  m: 4;',
      '};',
      'const live = 4;',
    ];
    expect(mutate1(...lines)).toEqual([[13, 'n -> n + 1', 'const live = 5;']]);
  });

  it('does not treat a variable named type as a declaration', () => {
    expect(mutate1('type = 1;')).toEqual([[1, 'n -> n + 1', 'type = 2;']]);
  });
});

describe('apply', () => {
  it('replaces the line of the mutant and nothing else', () => {
    const mutant: Mutant = { file: 'src/x.ts', line: 2, operator: 'o', text: 'B!' };
    expect(apply('a\nb\nc\n', mutant)).toBe('a\nB!\nc\n');
  });
});

describe('testsFor', () => {
  it('names the test file of the same path when it exists', async () => {
    const root = await tree({ 'tests/a/b.test.ts': '', 'tests/a/other.test.ts': '' });
    expect(testsFor('src/a/b.ts', root)).toBe('tests/a/b.test.ts');
  });

  it('names the test directory when there is no test file of that name', async () => {
    const root = await tree({ 'tests/a/other.test.ts': '' });
    expect(testsFor('src/a/b.ts', root)).toBe('tests/a/');
  });

  it('names the nearest enclosing test directory that exists', async () => {
    const root = await tree({ 'tests/client/copy.test.ts': '' });
    expect(testsFor('src/client/enhancers/copy.ts', root)).toBe('tests/client/');
  });

  it('names all tests for a file at the top of src', async () => {
    const root = await tree({ 'tests/a.test.ts': '' });
    expect(testsFor('src/types.ts', root)).toBe('tests/');
  });

  it('names all tests when there is no tests directory at all', async () => {
    expect(testsFor('src/a/b.ts', await tree())).toBe('tests/');
  });

  it('finds the real tests of the real sources', () => {
    expect(testsFor('src/client/viewport.ts')).toBe('tests/client/viewport.test.ts');
    expect(testsFor('src/client/enhancers/copy.ts')).toBe('tests/client/');
  });
});

describe('defaultJobs', () => {
  it.each([
    [1, 1],
    [2, 1],
    [5, 2],
    [8, 4],
  ])('is %i processors -> %i jobs', (processors, jobs) => {
    expect(defaultJobs(processors)).toBe(jobs);
  });

  it('follows this machine by default', () => {
    expect(defaultJobs()).toBe(defaultJobs(availableParallelism()));
  });
});

const A_SOURCE = 'export const f = (a: number, b: number) => a === b;\n';
const B_SOURCE = 'export const g = true;\n';

/** A small project: two sources, each with its own test, and a node_modules. */
const project = (extra: Record<string, string> = {}) =>
  tree({
    'package.json': '{}',
    'src/a.ts': A_SOURCE,
    'src/dir/b.ts': B_SOURCE,
    'tests/a.test.ts': '',
    'tests/dir/b.test.ts': '',
    'node_modules/.keep': '',
    ...extra,
  });

/** True when the copy `cwd` has the same sources as the project `root`. */
async function isUnmutated(root: string, cwd: string): Promise<boolean> {
  const entries = await fs.readdir(path.join(root, 'src'), {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries.filter((e) => e.isFile())) {
    const rel = path.relative(root, path.join(entry.parentPath, entry.name));
    if (
      (await fs.readFile(path.join(cwd, rel), 'utf8')) !==
      (await fs.readFile(path.join(root, rel), 'utf8'))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * `run`, but for the runs on mutated sources only: the baseline runs on the unmutated copy pass,
 * and their filters are added to `baselines`.
 */
const mutantRuns =
  (root: string, run: RunTests, baselines: string[] = []): RunTests =>
  async (cwd, filter, timeoutMs, signal) => {
    if (await isUnmutated(root, cwd)) {
      baselines.push(filter);
      return 'passed';
    }
    return run(cwd, filter, timeoutMs, signal);
  };

/** A fake test runner: records each mutant run and what the project copy looked like during it. */
function fakeRun(root: string, outcomes: Record<string, Outcome> = {}) {
  const calls: {
    cwd: string;
    filter: string;
    timeoutMs: number;
    changed: string[];
    sources: Record<string, string>;
  }[] = [];
  const baselines: string[] = [];
  const run = mutantRuns(
    root,
    async (cwd, filter, timeoutMs) => {
      const changed: string[] = [];
      const sources: Record<string, string> = {};
      for (const file of ['src/a.ts', 'src/dir/b.ts']) {
        sources[file] = await fs.readFile(path.join(cwd, file), 'utf8');
        if (sources[file] !== (await fs.readFile(path.join(root, file), 'utf8'))) {
          changed.push(file);
        }
      }
      calls.push({ cwd, filter, timeoutMs, changed, sources });
      return outcomes[filter] ?? 'failed';
    },
    baselines,
  );
  return { calls, baselines, run };
}

/** The per-run work directory of `mutate` below `root`. */
const workspace = (root: string) => path.join(root, '.tmp', `mutate-${process.pid}`);

const options = (root: string, run: RunTests, files = ['src/a.ts', 'src/dir/b.ts']) => ({
  root,
  files,
  jobs: 1,
  timeoutMs: 1000,
  run,
  signal: new AbortController().signal,
  report: () => undefined,
  skip: () => undefined,
});

describe('mutate', () => {
  it('runs the tests of the file for each mutant, in a copy, and says which survived', async () => {
    const root = await project();
    const { calls, run } = fakeRun(root, { 'tests/a.test.ts': 'passed' });
    const reported: [string, Outcome][] = [];
    const result = await mutate({
      ...options(root, run),
      report: (m, outcome) => reported.push([`${m.file}:${m.line}`, outcome]),
    });
    expect(result.total).toBe(2);
    expect(result.survivors.map((m) => [m.file, m.line, m.operator])).toEqual([
      ['src/a.ts', 1, '=== -> !=='],
    ]);
    expect(reported).toEqual([
      ['src/a.ts:1', 'passed'],
      ['src/dir/b.ts:1', 'failed'],
    ]);
    expect(calls.map((c) => [c.filter, c.timeoutMs])).toEqual([
      ['tests/a.test.ts', 1000],
      ['tests/dir/b.test.ts', 1000],
    ]);
    // The tests ran on the mutated source, in a copy of the project below .tmp/mutate-<pid>/.
    expect(calls[0]?.sources['src/a.ts']).toBe(A_SOURCE.replace('===', '!=='));
    expect(calls[1]?.sources['src/dir/b.ts']).toBe('export const g = false;\n');
    expect(calls.every((c) => c.cwd.startsWith(workspace(root) + path.sep))).toBe(true);
  });

  it('restores each file after its mutant, so a mutant is tested on its own', async () => {
    const twoMutants = 'export const f = (a: number) => a === 1 && a;\n';
    const root = await project({ 'src/a.ts': twoMutants });
    const { calls, run } = fakeRun(root);
    await mutate(options(root, run));
    expect(calls.map((c) => c.changed)).toEqual([
      ['src/a.ts'],
      ['src/a.ts'],
      ['src/a.ts'],
      ['src/dir/b.ts'],
    ]);
    expect(calls.slice(0, 3).map((c) => c.sources['src/a.ts'])).toEqual(
      mutants(twoMutants, 'src/a.ts').map((m) => apply(twoMutants, m)),
    );
  });

  it('counts a timeout as caught, and leaves the project and its work directory clean', async () => {
    const root = await project();
    const { run } = fakeRun(root, { 'tests/a.test.ts': 'timeout' });
    const result = await mutate(options(root, run));
    expect(result.survivors).toEqual([]);
    expect(await fs.readFile(path.join(root, 'src/a.ts'), 'utf8')).toBe(A_SOURCE);
    await expect(fs.access(workspace(root))).rejects.toThrow(/ENOENT/);
  });

  it('links node_modules into the copy and copies the project files', async () => {
    const root = await project({
      'data/d.json': '{}',
      'docs/d.md': '',
      'site.sample/s.md': '',
      'other/o.txt': '',
    });
    let seen: string[] = [];
    let linked = false;
    await mutate(
      options(
        root,
        mutantRuns(root, async (cwd) => {
          seen = await fs.readdir(cwd);
          linked = (await fs.lstat(path.join(cwd, 'node_modules'))).isSymbolicLink();
          return 'failed';
        }),
        ['src/a.ts'],
      ),
    );
    expect(linked).toBe(true);
    expect(seen.sort()).toEqual([
      'data',
      'docs',
      'node_modules',
      'package.json',
      'site.sample',
      'src',
      'tests',
    ]);
  });

  it('runs the jobs side by side, each in its own copy, and every mutant once', async () => {
    const root = await project({ 'src/c.ts': 'export const h = 1 < 2;\n' });
    const cwds: string[] = [];
    const arrivals: (() => void)[] = [];
    const run = mutantRuns(root, async (cwd) => {
      cwds.push(cwd);
      // The first two runs wait for each other, so they must overlap.
      if (cwds.length <= 2) {
        await new Promise<void>((resolve) => {
          arrivals.push(resolve);
          if (arrivals.length === 2) {
            for (const arrive of arrivals) {
              arrive();
            }
          }
        });
      }
      return 'failed';
    });
    const result = await mutate({
      ...options(root, run, ['src/a.ts', 'src/dir/b.ts', 'src/c.ts']),
      jobs: 2,
    });
    expect(result.total).toBe(cwds.length);
    expect(new Set(cwds.slice(0, 2)).size).toBe(2);
    expect(new Set(cwds).size).toBe(2);
  });

  it('starts no more jobs than there are mutants', async () => {
    const root = await project();
    const { calls, run } = fakeRun(root);
    await mutate({ ...options(root, run, ['src/dir/b.ts']), jobs: 8 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe(path.join(workspace(root), '0'));
  });

  it('stops at an abort: the interrupted run is not counted and no mutant follows', async () => {
    const root = await project();
    const stop = new AbortController();
    const calls: string[] = [];
    const reported: Mutant[] = [];
    const result = await mutate({
      ...options(
        root,
        mutantRuns(root, async (_cwd, filter) => {
          calls.push(filter);
          stop.abort();
          return 'passed';
        }),
      ),
      signal: stop.signal,
      report: (m) => reported.push(m),
    });
    expect(calls).toEqual(['tests/a.test.ts']);
    expect(reported).toEqual([]);
    expect(result.survivors).toEqual([]);
  });

  it('fails when a run cannot be made, and cleans up', async () => {
    const root = await project();
    await expect(
      mutate(
        options(
          root,
          mutantRuns(root, async () => {
            throw new Error('spawn ENOMEM');
          }),
        ),
      ),
    ).rejects.toThrow('spawn ENOMEM');
    await expect(fs.access(workspace(root))).rejects.toThrow(/ENOENT/);
  });

  it('runs each test selection once on the unmutated copy, before any mutant', async () => {
    const root = await project({ 'src/a.ts': 'export const f = (a: number) => a === 1 && a;\n' });
    const baselines: string[] = [];
    const seenAtFirstMutant: string[][] = [];
    await mutate(
      options(
        root,
        mutantRuns(
          root,
          async () => {
            seenAtFirstMutant.push([...baselines]);
            return 'failed';
          },
          baselines,
        ),
      ),
    );
    expect(baselines).toEqual(['tests/a.test.ts', 'tests/dir/b.test.ts']);
    expect(seenAtFirstMutant[0]).toEqual(['tests/a.test.ts', 'tests/dir/b.test.ts']);
  });

  it.each(['failed', 'timeout'] as const)(
    'skips the mutants of a test selection that is %s without mutation, and runs the others',
    async (outcome) => {
      const root = await project();
      const mutatedFilters: string[] = [];
      const skips: [string, number][] = [];
      const run: RunTests = async (cwd, filter) => {
        if (!(await isUnmutated(root, cwd))) {
          mutatedFilters.push(filter);
          return 'passed';
        }
        return filter === 'tests/dir/b.test.ts' ? outcome : 'passed';
      };
      const result = await mutate({
        ...options(root, run),
        skip: (filter, mutants) => skips.push([filter, mutants]),
      });
      expect(skips).toEqual([['tests/dir/b.test.ts', 1]]);
      expect(mutatedFilters).toEqual(['tests/a.test.ts']);
      expect(result).toMatchObject({ total: 1, skipped: 1 });
      expect(result.survivors.map((m) => m.file)).toEqual(['src/a.ts']);
      await expect(fs.access(workspace(root))).rejects.toThrow(/ENOENT/);
    },
  );

  it('skips nothing when every test selection passes without mutation', async () => {
    const root = await project();
    const skip = vi.fn();
    const { run } = fakeRun(root);
    expect(await mutate({ ...options(root, run), skip })).toMatchObject({ total: 2, skipped: 0 });
    expect(skip).not.toHaveBeenCalled();
  });

  it('aborts the other jobs when one fails, and removes the copies after all have settled', async () => {
    const root = await project();
    let sawAbort = false;
    let copyKept = false;
    const run = mutantRuns(root, async (cwd, filter, _timeoutMs, signal) => {
      if (filter === 'tests/dir/b.test.ts') {
        throw new Error('spawn ENOMEM');
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      sawAbort = signal.aborted;
      await new Promise((resolve) => setTimeout(resolve, 50));
      copyKept = await fs.access(cwd).then(
        () => true,
        () => false,
      );
      return 'failed';
    });
    await expect(mutate({ ...options(root, run), jobs: 2 })).rejects.toThrow('spawn ENOMEM');
    expect(sawAbort).toBe(true);
    expect(copyKept).toBe(true);
    await expect(fs.access(workspace(root))).rejects.toThrow(/ENOENT/);
  });

  it('reports no mutants for a source without anything to mutate', async () => {
    const root = await project({ 'src/plain.ts': 'export const word = "x";\n' });
    const { calls, run } = fakeRun(root);
    expect(await mutate(options(root, run, ['src/plain.ts']))).toEqual({
      total: 0,
      survivors: [],
      skipped: 0,
    });
    expect(calls).toEqual([]);
  });
});

describe('main', () => {
  async function runMain(argv: string[], run: RunTests, root: string, signal?: AbortSignal) {
    const stdout = sink();
    const stderr = sink();
    const code = await main(argv, {
      stdout,
      stderr,
      root,
      run,
      ...(signal ? { signal } : {}),
    });
    return { code, stdout: stdout.text, stderr: stderr.text };
  }

  it('prints a line for each survivor and the summary, and exits 0', async () => {
    const root = await project();
    const { run } = fakeRun(root, { 'tests/a.test.ts': 'passed' });
    expect(await runMain(['--jobs', '1', path.join(root, 'src')], run, root)).toEqual({
      code: 0,
      stdout:
        'SURVIVED src/a.ts:1 [=== -> !==] -> export const f = (a: number, b: number) => a !== b;\n' +
        '1 of 2 survived\n',
      stderr: '',
    });
  });

  it('mutates all of src by default, and exits 0 when everything is caught', async () => {
    const root = await project();
    const { calls, run } = fakeRun(root);
    const result = await runMain(['--jobs', '1'], run, root);
    expect(result).toEqual({ code: 0, stdout: '0 of 2 survived\n', stderr: '' });
    expect(calls.map((c) => c.filter)).toEqual(['tests/a.test.ts', 'tests/dir/b.test.ts']);
  });

  it('takes files and directories, each source once, declarations and other files never', async () => {
    const root = await project({
      'src/types.d.ts': 'export declare const a: 1 === 1;\n',
      'src/note.md': 'a === b\n',
    });
    const { calls, run } = fakeRun(root);
    const result = await runMain(
      [path.join(root, 'src/dir'), path.join(root, 'src/dir/b.ts'), path.join(root, 'src')],
      run,
      root,
    );
    expect(result.stdout).toBe('0 of 2 survived\n');
    expect(calls).toHaveLength(2);
  });

  it('passes --timeout to the runner in milliseconds', async () => {
    const root = await project();
    const { calls, run } = fakeRun(root);
    await runMain(['--timeout', '7', path.join(root, 'src/dir/b.ts')], run, root);
    expect(calls.map((c) => c.timeoutMs)).toEqual([7000]);
  });

  it('names a skipped test selection on stderr, summarises, and exits 1', async () => {
    const root = await project();
    const { run } = fakeRun(root);
    const failing: RunTests = async (cwd, filter, timeoutMs, signal) =>
      filter === 'tests/dir/b.test.ts' && (await isUnmutated(root, cwd))
        ? 'failed'
        : run(cwd, filter, timeoutMs, signal);
    expect(await runMain(['--jobs', '1'], failing, root)).toEqual({
      code: 1,
      stdout: '0 of 1 survived; 1 skipped\n',
      stderr: 'skipped: tests fail without mutation: tests/dir/b.test.ts (1 mutants)\n',
    });
  });

  it('writes a timeout to stderr, and does not count it as a survivor', async () => {
    const root = await project();
    const { run } = fakeRun(root, { 'tests/dir/b.test.ts': 'timeout' });
    expect(await runMain([path.join(root, 'src/dir/b.ts')], run, root)).toEqual({
      code: 0,
      stdout: '0 of 1 survived\n',
      stderr: 'timeout: src/dir/b.ts:1 [true -> false]\n',
    });
  });

  it.each([
    [['--jobs', '0'], /--jobs must be a positive integer: 0/],
    [['--jobs', '1.5'], /--jobs must be a positive integer: 1\.5/],
    [['--jobs', ''], /--jobs must be a positive integer: /],
    [['--timeout', 'abc'], /--timeout must be a positive integer: abc/],
    [['--timeout=-1'], /--timeout must be a positive integer: -1/],
    [['--bogus'], /bogus/],
    [['--jobs'], /argument missing/],
  ])('returns 2 with the usage for %j', async (argv, message) => {
    const root = await project();
    const { run, calls } = fakeRun(root);
    const result = await runMain(argv, run, root);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toContain('usage: mutate [--jobs <n>] [--timeout <s>] <path>...');
    expect(calls).toEqual([]);
  });

  it.each(['tests/a.test.ts', 'src/../tests/a.test.ts', 'package.json'])(
    'returns 2 for the path %s, which is not below src/',
    async (rel) => {
      const root = await project();
      const { run, calls } = fakeRun(root);
      const result = await runMain([path.join(root, rel)], run, root);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('is not below src/');
      expect(calls).toEqual([]);
    },
  );

  it('returns 2 when there is no TypeScript source to mutate', async () => {
    const root = await tree({ 'src/types.d.ts': 'export declare const a: 1;\n', 'src/n.md': '' });
    const { run, calls } = fakeRun(root);
    expect(await runMain([path.join(root, 'src')], run, root)).toEqual({
      code: 2,
      stdout: '',
      stderr: 'error: no TypeScript sources under src\n',
    });
    expect(calls).toEqual([]);
  });

  it('returns 1 for a path that does not exist', async () => {
    const root = await project();
    const { run } = fakeRun(root);
    const result = await runMain([path.join(root, 'src/missing.ts')], run, root);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^error: ENOENT/);
  });

  it('returns 1 when the tests cannot be run', async () => {
    const root = await project();
    const result = await runMain(
      [],
      mutantRuns(root, async () => {
        throw new Error('spawn ENOMEM');
      }),
      root,
    );
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'error: spawn ENOMEM\n' });
  });

  it('returns 1, without a summary, when interrupted', async () => {
    const root = await project();
    const stop = new AbortController();
    const result = await runMain(
      [],
      mutantRuns(root, async () => {
        stop.abort();
        return 'passed';
      }),
      root,
      stop.signal,
    );
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'error: interrupted\n' });
  });
});

describe('runVitest', () => {
  /** A project directory whose vitest is the shell script `body`. */
  async function withVitest(body: string): Promise<string> {
    const dir = await tree({ 'node_modules/.bin/vitest': `#!/bin/sh\n${body}\n` });
    await fs.chmod(path.join(dir, 'node_modules/.bin/vitest'), 0o755);
    return dir;
  }
  const never = new AbortController().signal;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('runs vitest with one worker in the copy with the filter, and reports success for exit code 0', async () => {
    const dir = await withVitest('echo "$@" > args.txt');
    expect(await runVitest(dir, 'tests/a.test.ts', 10_000, never)).toBe('passed');
    expect((await fs.readFile(path.join(dir, 'args.txt'), 'utf8')).trim()).toBe(
      'run --maxWorkers=1 tests/a.test.ts',
    );
  });

  it('reports a failure for any other exit code', async () => {
    expect(await runVitest(await withVitest('exit 1'), 't', 10_000, never)).toBe('failed');
    expect(await runVitest(await withVitest('exit 3'), 't', 10_000, never)).toBe('failed');
  });

  it('kills the whole process group on timeout', async () => {
    const dir = await withVitest('sleep 60 &\necho $! > sleeper.pid\nwait');
    expect(await runVitest(dir, 't', 500, never)).toBe('timeout');
    const pid = Number(await fs.readFile(path.join(dir, 'sleeper.pid'), 'utf8'));
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  });

  it('kills the whole process group on abort, and does not report a timeout', async () => {
    const dir = await withVitest('sleep 60 &\necho $! > sleeper.pid\nwait');
    const stop = new AbortController();
    const done = runVitest(dir, 't', 60_000, stop.signal);
    await vi.waitFor(async () => {
      expect(Number(await fs.readFile(path.join(dir, 'sleeper.pid'), 'utf8'))).toBeGreaterThan(0);
    });
    stop.abort();
    expect(await done).toBe('failed');
    const pid = Number(await fs.readFile(path.join(dir, 'sleeper.pid'), 'utf8'));
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  });

  it('kills the run at once when the signal is already aborted', async () => {
    const dir = await withVitest('sleep 60');
    const stop = new AbortController();
    stop.abort();
    expect(await runVitest(dir, 't', 60_000, stop.signal)).toBe('failed');
  });

  it('signals nothing when the abort comes while a failed start is pending', async () => {
    const kill = vi.spyOn(process, 'kill');
    try {
      const dir = await tree();
      const stop = new AbortController();
      const done = runVitest(dir, 't', 60_000, stop.signal);
      stop.abort();
      await expect(done).rejects.toThrow(/ENOENT/);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it('rejects when vitest cannot be started, and leaves no timer behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await expect(runVitest(await tree(), 't', 60_000, never)).rejects.toThrow(/ENOENT/);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind after a run that finished', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      expect(await runVitest(await withVitest('exit 0'), 't', 60_000, never)).toBe('passed');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('killGroup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is not an error for a group that is already gone', async () => {
    const child = spawn('true', { detached: true, stdio: 'ignore' });
    await once(child, 'close');
    const { pid } = child;
    if (pid === undefined) {
      throw new Error('the child was not started');
    }
    expect(() => killGroup(pid)).not.toThrow();
  });

  it('kills the group by the negative pid, with SIGKILL', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    killGroup(1234);
    expect(kill).toHaveBeenCalledExactlyOnceWith(-1234, 'SIGKILL');
  });

  it('passes on any other failure', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });
    expect(() => killGroup(1234)).toThrow('EPERM');
  });
});
