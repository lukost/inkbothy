// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { licensePath, renderAttributions } from '../../src/templates/attributions.ts';
import type { Attribution } from '../../src/types.ts';
import { $, $$, dom } from '../helpers.ts';

describe('licensePath', () => {
  it.each([
    [{ name: 'alpha', version: '1.0.0' }, 'attributions/licenses/alpha@1.0.0.txt'],
    [{ name: '@sc/beta', version: '2.0.0' }, 'attributions/licenses/~40sc~2Fbeta@2.0.0.txt'],
    [{ name: '0xProto Nerd Font', version: '' }, 'attributions/licenses/0xProto~20Nerd~20Font.txt'],
    [{ name: '../../evil', version: '1' }, 'attributions/licenses/..~2F..~2Fevil@1.txt'],
    [{ name: 'tilde~x', version: '' }, 'attributions/licenses/tilde~7Ex.txt'],
    [{ name: 'Łódź', version: '' }, 'attributions/licenses/~C5~81~C3~B3d~C5~BA.txt'],
  ])('%j -> %s', (entry, expected) => {
    expect(licensePath(entry)).toBe(expected);
  });

  it.each([
    [
      { name: 'a/b', version: '' },
      { name: 'a__b', version: '' },
    ],
    [
      { name: 'a b', version: '' },
      { name: 'a_b', version: '' },
    ],
    [
      { name: 'a~2Fb', version: '' },
      { name: 'a/b', version: '' },
    ],
    [
      { name: 'a@1', version: '2' },
      { name: 'a', version: '1@2' },
    ],
    [
      { name: 'x@1', version: '' },
      { name: 'x', version: '1' },
    ],
  ])('keeps %j and %j apart', (a, b) => {
    expect(licensePath(a)).not.toBe(licensePath(b));
  });

  it('yields a single path segment with URL-safe characters only', () => {
    const file = licensePath({ name: '../<script>/?#%', version: '1 2' }).split('/').at(-1);
    expect(file).toMatch(/^[A-Za-z0-9._~@-]+$/);
  });
});

describe('renderAttributions', () => {
  const entry = (over: Partial<Attribution> = {}): Attribution => ({
    name: 'alpha',
    version: '1.0.0',
    author: '',
    url: null,
    license: 'MIT',
    licenseFile: null,
    ...over,
  });

  it('links name, version, author and bundled licence or SPDX fallback', () => {
    const el = dom(
      renderAttributions(
        [
          entry({ author: 'Ann', url: 'https://a.dev/', licenseFile: '/x' }),
          entry({ name: 'nolic', version: '', license: 'Apache-2.0' }),
          entry({ name: 'expr', version: '1', license: '(MIT OR GPL-2.0)' }),
          entry({ name: 'unk', version: '1', license: 'UNKNOWN' }),
        ],
        [],
      ),
    );
    const [alpha, nolic, expr, unk] = $$(el, 'li');
    if (!alpha || !nolic || !expr || !unk) {
      throw new Error('expected four entries');
    }
    expect($(alpha, 'strong a').getAttribute('href')).toBe('https://a.dev/');
    expect(alpha.textContent).toContain('1.0.0');
    expect($(alpha, '.attribution-author').textContent).toBe('by Ann');
    expect($(alpha, '.attribution-license a').getAttribute('href')).toBe(
      '/attributions/licenses/alpha@1.0.0.txt',
    );
    expect(nolic.querySelector('strong a')).toBeNull();
    expect($(nolic, '.attribution-license a').getAttribute('href')).toBe(
      'https://spdx.org/licenses/Apache-2.0.html',
    );
    expect(expr.querySelector('.attribution-license a')).toBeNull();
    expect(unk.querySelector('.attribution-license a')).toBeNull();
  });

  it('lists the distributed and the build-time entries under their own headings', () => {
    const el = dom(
      renderAttributions(
        [entry({ name: 'shipped' })],
        [entry({ name: 'tool' }), entry({ name: 'tool2' })],
      ),
    );
    expect($$(el, 'h2').map((h) => h.textContent)).toEqual(['Distributed', 'Built with']);
    const [shipped, built] = $$(el, 'ul.attribution-list');
    expect(shipped?.textContent).toContain('shipped');
    expect($$(built ?? el, 'li strong').map((n) => n.textContent)).toEqual(['tool', 'tool2']);
  });

  it('escapes hostile metadata', () => {
    const hostile = '"><img src=x onerror=alert(1)><b>x</b>';
    const linked = entry({
      name: hostile,
      version: hostile,
      author: hostile,
      url: hostile,
      license: hostile,
      licenseFile: '/x',
    });
    const plain = entry({ name: hostile, version: hostile, author: hostile, license: hostile });
    const el = dom(renderAttributions([linked, plain], [linked, plain]));
    expect($$(el, 'img, b, [onerror]')).toEqual([]);
    expect($$(el, 'li')).toHaveLength(4);
    expect($$(el, 'strong a').map((a) => a.getAttribute('href'))).toEqual([hostile, hostile]);
    expect($$(el, '.attribution-license a').map((a) => a.textContent)).toEqual([hostile, hostile]);
    for (const li of $$(el, 'li')) {
      expect($(li, '.attribution-author').textContent).toBe(`by ${hostile}`);
      expect($(li, '.attribution-license').textContent).toBe(`Licence: ${hostile}`);
      expect($(li, 'strong').textContent).toContain(hostile);
    }
  });

  it('says so when a section is empty', () => {
    const out = String(renderAttributions([], []));
    expect(dom(out).querySelector('ul')).toBeNull();
    expect(out).toContain('No third-party components');
    expect(out).toContain('No build-time components');
    expect(dom(renderAttributions([entry()], [])).querySelectorAll('ul')).toHaveLength(1);
  });
});
