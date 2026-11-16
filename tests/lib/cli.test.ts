import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, dirFlag, parseOrUsage, resolveSettings } from '../../src/lib/cli.ts';
import { BUILD, PUBLISH, SITE_DEFAULT } from '../../src/lib/paths.ts';

describe('parseOrUsage', () => {
  it('returns the parsed value without writing', () => {
    const written: string[] = [];
    expect(parseOrUsage(() => 5, 'usage: x', { write: (t) => written.push(t) })).toBe(5);
    expect(written).toEqual([]);
  });

  it('reports the failure with the usage line and returns undefined', () => {
    const written: string[] = [];
    const parse = () => {
      throw new Error('bad flag');
    };
    expect(parseOrUsage(parse, 'usage: x', { write: (t) => written.push(t) })).toBeUndefined();
    expect(written.join('')).toBe('error: bad flag\nusage: x\n');
  });
});

describe('dirFlag', () => {
  it('resolves a value, passes an absent flag through and rejects an empty one', () => {
    expect(dirFlag('--d', 'a/b')).toBe(path.resolve('a/b'));
    expect(dirFlag('--d', undefined)).toBeUndefined();
    expect(() => dirFlag('--d', '')).toThrow('--d needs a directory');
  });
});

describe('resolveSettings', () => {
  it('defaults every setting', () => {
    expect(resolveSettings({}, {})).toEqual({
      site: SITE_DEFAULT,
      out: BUILD,
      publish: PUBLISH,
      port: DEFAULT_PORT,
      drafts: false,
    });
  });

  it('reads the environment, resolving relative directories against the working directory', () => {
    expect(
      resolveSettings(
        {},
        {
          SITE_DIR: 'rel/site',
          OUT_DIR: '/abs/out',
          PUBLISH_DIR: 'pub',
          PORT: '0',
          DRAFTS: 'true',
        },
      ),
    ).toEqual({
      site: path.resolve('rel/site'),
      out: '/abs/out',
      publish: path.resolve('pub'),
      port: 0,
      drafts: true,
    });
  });

  it('lets flags win over the environment, setting by setting', () => {
    const env = { SITE_DIR: '/e/s', OUT_DIR: '/e/o', PUBLISH_DIR: '/e/p', PORT: '1', DRAFTS: '0' };
    expect(
      resolveSettings({ site: '/f/s', out: '/f/o', publish: '/f/p', port: '2', drafts: true }, env),
    ).toEqual({ site: '/f/s', out: '/f/o', publish: '/f/p', port: 2, drafts: true });
    expect(resolveSettings({ site: '/f/s' }, env)).toMatchObject({
      site: '/f/s',
      out: '/e/o',
      port: 1,
      drafts: false,
    });
  });

  it('treats an empty variable as unset', () => {
    expect(
      resolveSettings({}, { SITE_DIR: '', OUT_DIR: '', PUBLISH_DIR: '', PORT: '', DRAFTS: '' }),
    ).toEqual(resolveSettings({}, {}));
  });

  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ])('reads DRAFTS=%s', (value, expected) => {
    expect(resolveSettings({}, { DRAFTS: value }).drafts).toBe(expected);
  });

  it.each(['yes', 'TRUE', '2', ' 1'])('rejects DRAFTS=%j', (value) => {
    expect(() => resolveSettings({}, { DRAFTS: value })).toThrow(
      `DRAFTS must be 1, true, 0 or false: ${value}`,
    );
  });

  it('does not look at DRAFTS when --drafts is given', () => {
    expect(resolveSettings({ drafts: true }, { DRAFTS: 'bogus' }).drafts).toBe(true);
  });

  it.each(['abc', '-1', '1.5', '65536', '0x10', ' 80'])('rejects PORT=%j and names it', (value) => {
    expect(() => resolveSettings({}, { PORT: value })).toThrow(
      /^PORT must be an integer from 0 to 65535/,
    );
    expect(() => resolveSettings({ port: value }, {})).toThrow(/^--port must be an integer/);
  });

  it('accepts the largest port', () => {
    expect(resolveSettings({ port: '65535' }, {}).port).toBe(65535);
  });
});
