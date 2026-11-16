// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initStream } from '../../src/client/stream.ts';
import { articleFragment } from '../../src/templates/article.ts';
import { renderStream } from '../../src/templates/stream.ts';
import type { ItemNoun } from '../../src/types.ts';
import { $, $$, item, NOUN, noTerms, texts } from '../helpers.ts';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({
  default: { initialize: mermaid.initialize, render: mermaid.render },
}));

/**
 * Records what the script does with its observer and lets a test report intersections.
 * Like the real API, `observe` reports the current state, which is `visible`.
 */
class FakeObserver {
  static instances: FakeObserver[] = [];
  static visible = false;
  readonly log: string[] = [];
  disconnected = false;
  #watching = false;
  #reports = 0;
  readonly #callback: (entries: { isIntersecting: boolean }[]) => void;
  readonly options: IntersectionObserverInit | undefined;

  constructor(
    callback: (entries: { isIntersecting: boolean }[]) => void,
    options?: IntersectionObserverInit,
  ) {
    this.#callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }

  observe(): void {
    this.log.push('observe');
    this.#watching = true;
    if (FakeObserver.visible) {
      queueMicrotask(() => {
        if (this.#watching) {
          this.#reports++;
          if (this.#reports > 50) {
            throw new Error('the observer keeps reporting');
          }
          this.report(true);
        }
      });
    }
  }

  unobserve(): void {
    this.log.push('unobserve');
    this.#watching = false;
  }

  disconnect(): void {
    this.disconnected = true;
    this.#watching = false;
  }

  report(isIntersecting: boolean): void {
    this.#callback([{ isIntersecting }]);
  }
}

const fetchMock = vi.fn<typeof fetch>();
const pages = new Map<string, () => Response | Promise<Response>>();
const routes: typeof fetch = async (input) => {
  const make = pages.get(String(input));
  if (!make) {
    throw new Error(`unexpected fetch ${String(input)}`);
  }
  return make();
};
const posts = (n: number, prefix = 'p') =>
  Array.from({ length: n }, (_, i) =>
    item({
      url: `/blog/${prefix}${i + 1}/`,
      title: `Post ${prefix}${i + 1}`,
      published: `2026-01-${10 + i}`,
    }),
  );
const fragmentOf = (url: string, markup: string, updates = false) =>
  String(
    articleFragment(
      item({
        url,
        updates: updates ? [{ date: '2026-02-01', note: `Note of ${url}` }] : [],
      }),
      markup,
    ),
  );

let teardown: () => void = () => undefined;

/** The listing the generator emits for `n` posts, all of them as headers; their fragments are served. */
function listing(n: number, batch: number, prefix: string, noun: ItemNoun = NOUN): string {
  const list = posts(n, prefix);
  fetchMock.mockImplementation(routes);
  for (const { url, meta } of list) {
    pages.set(
      `${url}fragment.html`,
      () => new Response(fragmentOf(url, `<p>Body of ${meta.title}</p>`, true)),
    );
  }
  return String(
    renderStream({
      heading: 'Blog',
      items: list,
      terms: noTerms,
      noun,
      content: () => '',
      initial: 0,
      batch,
    }),
  );
}

function mount(n: number, batch = 2, noun: ItemNoun = NOUN): void {
  document.body.innerHTML = `<main>${listing(n, batch, 'p', noun)}</main>`;
}

const items = () => $$(document, 'ol.stream-rest > li');
const loaded = () => items().filter((li) => li.querySelector(':scope > article.article'));
const button = () => $<HTMLButtonElement>(document, 'button.stream-load');
const status = () => $(document, '[role="status"]').textContent;
const observer = () => {
  const found = FakeObserver.instances.at(-1);
  if (!found) {
    throw new Error('no observer was created');
  }
  return found;
};
const fetched = () => fetchMock.mock.calls.map((c) => String(c[0]));

/** A response that stays pending, and settles when `release` is called. */
function held(markup: string): { make: () => Promise<Response>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    make: async () => {
      await gate;
      return new Response(markup);
    },
    release,
  };
}

/** Lets the frame that publishes an announcement run. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const settled = () => vi.waitFor(() => expect(document.querySelector('[aria-busy]')).toBeNull());

beforeEach(() => {
  pages.clear();
  FakeObserver.instances = [];
  FakeObserver.visible = false;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
});

afterEach(() => {
  teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('initStream', () => {
  it('leaves a page without a stream alone', () => {
    document.body.innerHTML = '<main><p>x</p></main>';
    teardown = initStream();
    expect(document.body.innerHTML).toBe('<main><p>x</p></main>');
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it.each(['0', '-1', '1.5', 'x', ''])('ignores a list with the batch size %j', (batch) => {
    mount(2);
    $(document, 'ol').setAttribute('data-batch', batch);
    teardown = initStream();
    expect(document.querySelector('.stream-more')).toBeNull();
  });

  it('adds a button and a live region after the list, hidden in print', () => {
    mount(3);
    teardown = initStream();
    const list = $(document, 'ol.stream-rest');
    expect(list.nextElementSibling?.getAttribute('role')).toBe('status');
    expect(list.nextElementSibling?.className).toBe('visually-hidden');
    const controls = $(document, '.stream-more');
    expect(list.nextElementSibling?.nextElementSibling).toBe(controls);
    expect(controls.classList.contains('no-print')).toBe(true);
    expect(button().textContent).toBe('Load more posts');
    expect(button().type).toBe('button');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wires every list on the page', () => {
    mount(3);
    document.body.append(document.querySelector('ol')?.cloneNode(true) ?? '');
    teardown = initStream();
    expect($$(document, 'button.stream-load')).toHaveLength(2);
  });
});

describe('loading by button', () => {
  it('turns the next batch of headers into full articles, in order', async () => {
    mount(5);
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    expect(fetched()).toEqual(['/blog/p1/fragment.html', '/blog/p2/fragment.html']);
    const [first] = loaded();
    expect(first?.hasAttribute('data-fragment')).toBe(false);
    const article = $(first ?? document.body, ':scope > article.article');
    expect(article.children[0]?.tagName).toBe('HEADER');
    expect(texts(article, 'header h2 a')).toEqual(['Post p1']);
    expect(texts(article, '.md-content')).toEqual(['Body of Post p1']);
    expect(texts(article, '.article-footer li')).toEqual(['2026-02-01 — Note of /blog/p1/']);
    expect(texts(article, '.article-footer h3')).toEqual(['Update history']);
    expect(items().map((li) => li.hasAttribute('data-fragment'))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect($$(document, 'ol > li > header')).toHaveLength(3);
  });

  it('loads the next batch on every press and the last, shorter one', async () => {
    mount(5);
    teardown = initStream();
    for (const count of [2, 4, 5]) {
      button().click();
      await vi.waitFor(() => expect(loaded()).toHaveLength(count));
      await settled();
    }
    expect(fetched()).toEqual(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((p) => `/blog/${p}/fragment.html`),
    );
    expect(texts(document, 'ol > li article > header h2')).toEqual([
      'Post p1',
      'Post p2',
      'Post p3',
      'Post p4',
      'Post p5',
    ]);
  });

  it('fetches the whole batch at once and still inserts in order', async () => {
    mount(2);
    const slow = held(fragmentOf('/blog/p1/', '<p>Body of Post p1</p>'));
    const fast = held(fragmentOf('/blog/p2/', '<p>Body of Post p2</p>'));
    pages.set('/blog/p1/fragment.html', slow.make);
    pages.set('/blog/p2/fragment.html', fast.make);
    teardown = initStream();
    button().click();
    expect(fetched()).toEqual(['/blog/p1/fragment.html', '/blog/p2/fragment.html']);
    fast.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loaded()).toHaveLength(0);
    slow.release();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    expect(texts(document, 'ol > li .md-content')).toEqual(['Body of Post p1', 'Body of Post p2']);
  });

  it('lets the focus on the new heading speak for a pressed button: no announcement', async () => {
    mount(3);
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    await settled();
    await nextFrame();
    expect(status()).toBe('');
    expect(document.activeElement).toBe($(loaded()[0] ?? document.body, 'h2'));
  });

  it('moves focus to the heading of the first new article', async () => {
    mount(3);
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    const heading = $(loaded()[0] ?? document.body, 'h2');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('ignores presses while a batch is on its way and marks the list busy', async () => {
    mount(4);
    const one = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', one.make);
    teardown = initStream();
    button().click();
    expect($(document, 'ol').getAttribute('aria-busy')).toBe('true');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    button().click();
    button().click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    one.release();
    await settled();
    expect(button().hasAttribute('aria-disabled')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loaded()).toHaveLength(2);
  });
});

describe('loading by scrolling', () => {
  it('watches the controls one viewport ahead', () => {
    mount(3);
    teardown = initStream();
    expect(observer().options?.rootMargin).toBe('0px 0px 100% 0px');
    expect(observer().log).toEqual(['observe']);
  });

  it('loads a batch when the end comes near, without moving focus', async () => {
    mount(5);
    teardown = initStream();
    observer().report(false);
    expect(fetchMock).not.toHaveBeenCalled();
    observer().report(true);
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    expect(document.activeElement).toBe(document.body);
    await vi.waitFor(() => expect(status()).toBe('2 more posts loaded'));
  });

  it('observes again after a batch, so a list that is still short keeps loading', async () => {
    mount(5);
    teardown = initStream();
    observer().report(true);
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    expect(observer().log).toEqual(['observe', 'unobserve', 'observe']);
  });

  it('loads nothing twice when reports arrive during a batch or a press races a report', async () => {
    mount(5);
    const one = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', one.make);
    teardown = initStream();
    observer().report(true);
    observer().report(true);
    button().click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    one.release();
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loaded()).toHaveLength(2);
  });

  it('works with the button alone when there is no IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    mount(3);
    teardown = initStream();
    expect(FakeObserver.instances).toHaveLength(0);
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(3));
    expect(document.querySelector('.stream-more')).toBeNull();
  });
});

describe('when everything is loaded', () => {
  it('removes the button and stops observing, and keeps the live region', async () => {
    mount(3);
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    await settled();
    expect(document.querySelector('.stream-more')).not.toBeNull();
    expect(observer().disconnected).toBe(false);
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(3));
    expect(document.querySelector('.stream-more')).toBeNull();
    expect(observer().disconnected).toBe(true);
    expect(document.activeElement).toBe($(loaded()[2] ?? document.body, 'h2'));
  });
});

describe('failures', () => {
  const fail = (url: string, response: () => Response | Promise<Response>) =>
    pages.set(`${url}fragment.html`, response);

  it('keeps the header and offers the post, while the rest still loads', async () => {
    mount(3);
    fail('/blog/p1/', () => new Response('nope', { status: 500 }));
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(status()).not.toBe(''));
    const [first, second] = items();
    expect(first?.querySelector(':scope > article')).toBeNull();
    expect(first?.hasAttribute('data-fragment')).toBe(true);
    expect(first?.hasAttribute('data-failed')).toBe(true);
    expect($(first ?? document.body, ':scope > header h2').textContent).toBe('Post p1');
    const note = $(first ?? document.body, ':scope > p.stream-note');
    expect(note.textContent).toBe('Couldn’t load — open the post');
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/blog/p1/');
    expect(second?.querySelector(':scope > article')).not.toBeNull();
    await vi.waitFor(() => expect(status()).toBe('1 post could not be loaded'));
    expect(button().isConnected).toBe(true);
  });

  it('treats a network error like a failed status, and says so when nothing loaded', async () => {
    mount(2);
    fail('/blog/p1/', () => Promise.reject(new TypeError('offline')));
    fail('/blog/p2/', () => new Response('', { status: 404 }));
    teardown = initStream();
    button().focus();
    button().click();
    await vi.waitFor(() => expect(status()).toBe('2 posts could not be loaded'));
    expect($$(document, 'p.stream-note')).toHaveLength(2);
    expect(document.activeElement).toBe(button());
  });

  it('retries only what failed, on the next press, and clears the note', async () => {
    mount(3);
    let broken = true;
    fail('/blog/p2/', () =>
      broken
        ? new Response('', { status: 503 })
        : new Response(fragmentOf('/blog/p2/', '<p>Body of Post p2</p>')),
    );
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(status()).toContain('could not'));
    await settled();
    fetchMock.mockClear();
    broken = false;
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(3));
    expect(fetched()).toEqual(['/blog/p2/fragment.html', '/blog/p3/fragment.html']);
    expect($$(document, 'p.stream-note')).toHaveLength(0);
    expect($$(document, '[data-failed]')).toHaveLength(0);
  });

  it('retries a failed post alone once nothing else is left', async () => {
    mount(2);
    let broken = true;
    fail('/blog/p1/', () =>
      broken
        ? new Response('', { status: 500 })
        : new Response(fragmentOf('/blog/p1/', '<p>Body of Post p1</p>')),
    );
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(status()).toBe('1 post could not be loaded'));
    await settled();
    fetchMock.mockClear();
    broken = false;
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    expect(fetched()).toEqual(['/blog/p1/fragment.html']);
    expect(document.querySelector('.stream-more')).toBeNull();
  });

  it('does not retry failed posts on its own, however often the end comes near', async () => {
    mount(3, 3);
    fail('/blog/p1/', () => new Response('', { status: 500 }));
    teardown = initStream();
    observer().report(true);
    await vi.waitFor(() => expect($$(document, 'p.stream-note')).toHaveLength(1));
    await settled();
    fetchMock.mockClear();
    observer().report(true);
    observer().report(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads on after failures while the end is still near', async () => {
    mount(4, 2);
    fail('/blog/p1/', () => new Response('', { status: 500 }));
    teardown = initStream();
    observer().report(true);
    await vi.waitFor(() => expect(loaded()).toHaveLength(1));
    await settled();
    fetchMock.mockClear();
    observer().report(true);
    await vi.waitFor(() => expect(loaded()).toHaveLength(3));
    expect(fetched()).toEqual(['/blog/p3/fragment.html', '/blog/p4/fragment.html']);
  });

  it('reports an unexpected error and can be used again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(2);
    teardown = initStream();
    const append = vi.spyOn(Element.prototype, 'append').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    button().click();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('cannot load more posts', expect.any(Error)),
    );
    append.mockRestore();
    await settled();
    expect(button().hasAttribute('aria-disabled')).toBe(false);
  });

  it('isolates a list that cannot be wired', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(3);
    document.body.append(document.querySelector('ol')?.cloneNode(true) ?? '');
    vi.spyOn(Element.prototype, 'after').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    teardown = initStream();
    expect(error).toHaveBeenCalledWith('post stream failed to start', expect.any(Error));
    expect($$(document, 'button.stream-load')).toHaveLength(1);
  });
});

describe('enhancers', () => {
  it('run on the new articles only', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(3);
    const code = (name: string) =>
      `<figure class="code-block" data-lang="c"><figcaption>${name}</figcaption><pre><code>int x;</code></pre></figure>`;
    document.body.insertAdjacentHTML('afterbegin', code('old'));
    pages.set('/blog/p1/fragment.html', () => new Response(fragmentOf('/blog/p1/', code('new'))));
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect($$(document, 'article button.copy-code')).toHaveLength(1));
    expect($$(document, 'main > figure.code-block button.copy-code')).toHaveLength(0);
    expect(document.querySelector('figure.code-block')?.querySelector('button')).toBeNull();
  });

  it('draw Mermaid diagrams in the new articles', async () => {
    mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"></svg>` }));
    mount(3);
    pages.set(
      '/blog/p1/fragment.html',
      () =>
        new Response(fragmentOf('/blog/p1/', '<pre class="mermaid-source">graph TD; A-->B</pre>')),
    );
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect($$(document, 'article figure.mermaid')).toHaveLength(1));
    expect($$(document, 'pre.mermaid-source')).toHaveLength(0);
  });

  it('do not stop the stream when one fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mermaid.render.mockRejectedValue(new Error('bad diagram'));
    mount(2);
    pages.set(
      '/blog/p1/fragment.html',
      () => new Response(fragmentOf('/blog/p1/', '<pre class="mermaid-source">nonsense</pre>')),
    );
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
  });
});

describe('hostile fragments', () => {
  it('stay inert: no script runs and no handler fires', async () => {
    Reflect.set(globalThis, 'streamPwned', undefined);
    mount(2);
    pages.set(
      '/blog/p1/fragment.html',
      () =>
        new Response(
          fragmentOf(
            '/blog/p1/',
            '<script>globalThis.streamPwned = "script"</script><img src="x" onerror="globalThis.streamPwned = \'img\'"><p>text</p>',
          ),
        ),
    );
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(Reflect.get(globalThis, 'streamPwned')).toBeUndefined();
    expect(texts(loaded()[0] ?? document.body, '.md-content p')).toEqual(['text']);
  });

  it('reach the page only inside the finished article', async () => {
    mount(1, 1);
    pages.set(
      '/blog/p1/fragment.html',
      () => new Response(fragmentOf('/blog/p1/', '<img src="/tracking.png"><p>x</p>')),
    );
    teardown = initStream();
    const added: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        added.push(...[...record.addedNodes].map((n) => n.nodeName));
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(1));
    watch.disconnect();
    expect(added.filter((name) => name !== 'ARTICLE' && name !== '#text')).toEqual([]);
    expect(added).toContain('ARTICLE');
    expect($$(document, 'article img')).toHaveLength(1);
  });
});

describe('double init and teardown', () => {
  it('replaces the previous wiring instead of adding a second button', () => {
    mount(3);
    const first = initStream();
    teardown = initStream();
    expect($$(document, 'button.stream-load')).toHaveLength(1);
    expect($$(document, '[role="status"]')).toHaveLength(1);
    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
    first();
  });

  it('removes the button, the live region and the observer, and keeps what was loaded', async () => {
    mount(4);
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    await settled();
    teardown();
    expect(document.querySelector('.stream-more')).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(observer().disconnected).toBe(true);
    expect(loaded()).toHaveLength(2);
  });

  it('drops a batch that arrives after the teardown', async () => {
    mount(2);
    const one = held(fragmentOf('/blog/p1/', '<p>late</p>'));
    pages.set('/blog/p1/fragment.html', one.make);
    teardown = initStream();
    button().click();
    teardown();
    one.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loaded()).toHaveLength(0);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect($$(document, '[aria-busy]')).toHaveLength(0);
  });
});

describe('a list whose posts all fail', () => {
  it('settles: no loop, no more fetches, no churn, while the end stays in view', async () => {
    FakeObserver.visible = true;
    mount(3, 2);
    for (const n of [1, 2, 3]) {
      pages.set(`/blog/p${n}/fragment.html`, () => new Response('', { status: 500 }));
    }
    let busyChanges = 0;
    const watch = new MutationObserver((records) => {
      busyChanges += records.length;
    });
    watch.observe($(document, 'ol'), { attributes: true, attributeFilter: ['aria-busy'] });
    teardown = initStream();
    await vi.waitFor(() => expect($$(document, 'p.stream-note')).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 30));
    watch.disconnect();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(observer().log.filter((entry) => entry === 'observe').length).toBeLessThanOrEqual(2);
    expect(busyChanges).toBeLessThanOrEqual(4);
    expect(button().isConnected).toBe(true);
  });
});

describe('a press during a scroll load', () => {
  it('is not dropped: the batch it joins gets focus, and nothing is fetched twice', async () => {
    mount(4);
    const one = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', one.make);
    teardown = initStream();
    observer().report(true);
    button().click();
    expect(fetched()).toEqual(['/blog/p1/fragment.html', '/blog/p2/fragment.html']);
    one.release();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    await settled();
    expect(document.activeElement).toBe($(loaded()[0] ?? document.body, 'h2'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await nextFrame();
    expect(status()).toBe('');
  });

  it('is forgotten once that batch is in: the next scroll load leaves focus alone', async () => {
    mount(6);
    const one = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', one.make);
    teardown = initStream();
    observer().report(true);
    button().click();
    one.release();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    await settled();
    $(loaded()[0] ?? document.body, 'h2').blur();
    observer().report(true);
    await vi.waitFor(() => expect(loaded()).toHaveLength(4));
    expect(document.activeElement).toBe(document.body);
  });
});

describe('focus and announcements', () => {
  it('announces a scroll load, which moves no focus', async () => {
    mount(3);
    teardown = initStream();
    observer().report(true);
    await vi.waitFor(() => expect(status()).toBe('2 more posts loaded'));
    expect(document.activeElement).toBe(document.body);
  });

  it('still reports failures of a pressed button, which focus does not tell', async () => {
    mount(3);
    pages.set('/blog/p1/fragment.html', () => new Response('', { status: 500 }));
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(status()).toBe('1 post could not be loaded'));
    expect(document.activeElement).toBe($(loaded()[0] ?? document.body, 'h2'));
  });

  it('takes the heading out of the tab order when it loses focus', async () => {
    mount(3);
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(loaded()).toHaveLength(2));
    const heading = $(loaded()[0] ?? document.body, 'h2');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    heading.blur();
    expect(heading.hasAttribute('tabindex')).toBe(false);
    heading.focus();
    expect(heading.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps focus on the button when every post of a pressed batch failed', async () => {
    mount(3);
    for (const n of [1, 2]) {
      pages.set(`/blog/p${n}/fragment.html`, () => new Response('', { status: 500 }));
    }
    teardown = initStream();
    button().focus();
    button().click();
    await vi.waitFor(() => expect(status()).toBe('2 posts could not be loaded'));
    await settled();
    expect(document.activeElement).toBe(button());
    expect(button().isConnected).toBe(true);
    expect(button().textContent).toBe('Load more posts');
    expect($$(document, '[tabindex]')).toEqual([]);
  });

  it('says the same thing twice by clearing the live region in between', async () => {
    mount(3, 1);
    teardown = initStream();
    const seen: string[] = [];
    const watch = new MutationObserver(() => seen.push(status() ?? ''));
    watch.observe($(document, '[role="status"]'), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    for (const count of [1, 2]) {
      observer().report(true);
      await vi.waitFor(() => expect(loaded()).toHaveLength(count));
      await settled();
      await vi.waitFor(() =>
        expect(seen.filter((t) => t === '1 more post loaded')).toHaveLength(count),
      );
    }
    watch.disconnect();
    const changes = seen.filter((text, i) => text !== seen[i - 1]);
    const first = changes.indexOf('1 more post loaded');
    expect(changes.slice(first)).toEqual(['1 more post loaded', '', '1 more post loaded']);
  });
});

describe('the busy button', () => {
  it('reads "Loading…" while a batch is on its way, and is restored after', async () => {
    mount(3);
    const one = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', one.make);
    teardown = initStream();
    button().click();
    expect(button().textContent).toBe('Loading…');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    one.release();
    await settled();
    expect(button().textContent).toBe('Load more posts');
  });
});

describe('fetch timeout', () => {
  it('limits each fragment fetch to 15 seconds, and fails the post that exceeds it', async () => {
    // Node's own timer behind AbortSignal.timeout is out of reach of fake timers: the limit is a signal the test ends.
    const limits: AbortController[] = [];
    const delays: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      delays.push(ms);
      const limit = new AbortController();
      limits.push(limit);
      return limit.signal;
    });
    mount(3);
    fetchMock.mockImplementation((input, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('fetch without a signal');
      }
      if (String(input).includes('/p1/')) {
        return new Promise<Response>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return routes(input, init);
    });
    teardown = initStream();
    button().click();
    expect(delays).toEqual([15_000, 15_000]);
    await vi.waitFor(() => expect(loaded()).toHaveLength(0));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect($$(document, 'p.stream-note')).toHaveLength(0);
    limits[0]?.abort();
    await vi.waitFor(() => expect($$(document, 'p.stream-note')).toHaveLength(1));
    expect(items()[0]?.hasAttribute('data-failed')).toBe(true);
    expect(loaded()).toHaveLength(1);
    expect(button().textContent).toBe('Load more posts');
  });
});

describe('concurrency', () => {
  it('fetches each slot once for two quick presses', async () => {
    mount(4);
    const gate = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', gate.make);
    pages.set('/blog/p2/fragment.html', gate.make);
    teardown = initStream();
    button().click();
    button().click();
    expect(fetched()).toEqual(['/blog/p1/fragment.html', '/blog/p2/fragment.html']);
    gate.release();
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loaded()).toHaveLength(2);
  });

  it('leaves the observer alone after a teardown during a fetch', async () => {
    mount(3);
    const gate = held(fragmentOf('/blog/p1/', '<p>one</p>'));
    pages.set('/blog/p1/fragment.html', gate.make);
    teardown = initStream();
    observer().report(true);
    teardown();
    const log = [...observer().log];
    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observer().log).toEqual(log);
    expect(loaded()).toHaveLength(0);
  });

  it('streams two lists on one page independently, whatever the order of arrival', async () => {
    document.body.innerHTML = `<main>${listing(3, 2, 'a')}${listing(3, 2, 'b')}</main>`;
    const slowA = held(fragmentOf('/blog/a1/', '<p>A one</p>'));
    const slowB = held(fragmentOf('/blog/b1/', '<p>B one</p>'));
    pages.set('/blog/a1/fragment.html', slowA.make);
    pages.set('/blog/b1/fragment.html', slowB.make);
    teardown = initStream();
    const [buttonA, buttonB] = $$(document, 'button.stream-load');
    const [listA, listB] = $$(document, 'ol.stream-rest');
    expect(FakeObserver.instances).toHaveLength(2);
    buttonA?.click();
    buttonB?.click();
    expect(fetched()).toEqual([
      '/blog/a1/fragment.html',
      '/blog/a2/fragment.html',
      '/blog/b1/fragment.html',
      '/blog/b2/fragment.html',
    ]);
    expect(listA?.getAttribute('aria-busy')).toBe('true');
    expect(listB?.getAttribute('aria-busy')).toBe('true');
    slowB.release();
    await vi.waitFor(() => expect(listB?.hasAttribute('aria-busy')).toBe(false));
    expect(listA?.hasAttribute('aria-busy')).toBe(true);
    expect(texts(listB ?? document.body, ':scope > li article h2 a')).toEqual([
      'Post b1',
      'Post b2',
    ]);
    expect(texts(listA ?? document.body, ':scope > li article')).toEqual([]);
    slowA.release();
    await vi.waitFor(() => expect(listA?.hasAttribute('aria-busy')).toBe(false));
    expect(texts(listA ?? document.body, ':scope > li article h2 a')).toEqual([
      'Post a1',
      'Post a2',
    ]);
    expect(listA?.querySelectorAll('[data-fragment]')).toHaveLength(1);
    expect(listB?.querySelectorAll('[data-fragment]')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('a list with its own noun', () => {
  const PIECE: ItemNoun = { singular: 'piece', plural: 'pieces' };
  const failPiece = (url: string) =>
    pages.set(`${url}fragment.html`, () => new Response('nope', { status: 500 }));

  it('uses it for the button, the failure note and the failure count, in the right number', async () => {
    mount(4, 3, PIECE);
    failPiece('/blog/p2/');
    failPiece('/blog/p3/');
    teardown = initStream();
    expect(button().textContent).toBe('Load more pieces');
    button().click();
    await vi.waitFor(() => expect(status()).toBe('2 pieces could not be loaded'));
    expect($(items()[1] ?? document.body, '.stream-note').textContent).toBe(
      'Couldn’t load — open the piece',
    );
    const added = texts(document, '.stream-more, [role="status"], .stream-note').join(' ');
    expect(added).not.toMatch(/\bposts?\b/i);
  });

  it('counts a single failure in the singular', async () => {
    mount(3, 2, PIECE);
    failPiece('/blog/p1/');
    teardown = initStream();
    button().click();
    await vi.waitFor(() => expect(status()).toBe('1 piece could not be loaded'));
  });

  it.each([
    [1, '1 more piece loaded'],
    [2, '2 more pieces loaded'],
  ])('announces a scroll load of %i in the right number', async (batch, message) => {
    mount(3, batch, PIECE);
    teardown = initStream();
    observer().report(true);
    await vi.waitFor(() => expect(status()).toBe(message));
  });

  it('leaves a list without a noun alone, so no message names a post', () => {
    mount(3);
    for (const name of ['data-noun', 'data-noun-plural']) {
      $(document, 'ol.stream-rest').removeAttribute(name);
      teardown = initStream();
      expect(document.querySelector('button.stream-load'), name).toBeNull();
      teardown();
      $(document, 'ol.stream-rest').setAttribute(name, 'x');
    }
  });
});
