import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReloadChannel,
  HEARTBEAT_MS,
  RELOAD_EVENTS_PATH,
  RELOAD_SCRIPT,
  reloadTag,
} from '../../src/server/reload.ts';
import { type Listening, listening } from './http.ts';

const HELLO = 'retry: 1000\n\nevent: build\ndata: 0\n\n';
const build = (n: number) => `event: build\ndata: ${n}\n\n`;
const PING = ': ping\n\n';

interface Stream {
  /** Text received so far. */
  text(): string;
  /** Resolves once the server ended the stream. */
  readonly ended: Promise<void>;
  /** Resolves once the response headers and first chunk arrived. */
  readonly opened: Promise<void>;
  destroy(): void;
}

/** An open event-stream connection to `port`. */
function openStream(port: number): Stream {
  let text = '';
  let markOpened = () => {};
  let markEnded = () => {};
  const opened = new Promise<void>((resolve) => {
    markOpened = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    markEnded = resolve;
  });
  const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      text += chunk;
      markOpened();
    });
    res.on('end', markEnded);
  });
  req.on('error', () => undefined);
  return { text: () => text, ended, opened, destroy: () => req.destroy() };
}

describe('reload channel', () => {
  let channel = createReloadChannel();
  let server: Listening | undefined;
  beforeEach(() => {
    channel = createReloadChannel();
  });
  afterEach(async () => {
    channel.close();
    await server?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends the retry hint and the current build on connect, and the next build per notify, to every client', async () => {
    server = await listening((_req, res) => channel.connect(res));
    const a = openStream(server.port);
    const b = openStream(server.port);
    await Promise.all([a.opened, b.opened]);
    channel.notify();
    channel.notify();
    for (const s of [a, b]) {
      await vi.waitFor(() => expect(s.text()).toBe(`${HELLO}${build(1)}${build(2)}`));
      s.destroy();
    }
  });

  it('forgets clients that disconnect, and reports the build to late joiners', async () => {
    server = await listening((_req, res) => channel.connect(res));
    const gone = openStream(server.port);
    const stays = openStream(server.port);
    await Promise.all([gone.opened, stays.opened]);
    gone.destroy();
    await vi.waitFor(() => {
      channel.notify();
      expect(stays.text().match(/event: build/g)?.length).toBeGreaterThanOrEqual(3);
    });
    expect(gone.text()).toBe(HELLO);
    const late = openStream(server.port);
    await late.opened;
    expect(late.text()).toBe(`retry: 1000\n\n${build(channel.build)}`);
    expect(channel.build).toBeGreaterThanOrEqual(1);
    stays.destroy();
    late.destroy();
  });

  it('ends every stream on close and sends nothing afterwards', async () => {
    server = await listening((_req, res) => channel.connect(res));
    const s = openStream(server.port);
    await s.opened;
    channel.close();
    await s.ended;
    channel.notify();
    expect(s.text()).toBe(HELLO);
  });

  describe('heartbeat', () => {
    it('pings every client every 20 s from a single interval', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      server = await listening((_req, res) => channel.connect(res));
      const a = openStream(server.port);
      const b = openStream(server.port);
      await Promise.all([a.opened, b.opened]);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(HEARTBEAT_MS - 1);
      expect(a.text()).toBe(HELLO);
      vi.advanceTimersByTime(1);
      for (const s of [a, b]) {
        await vi.waitFor(() => expect(s.text()).toBe(`${HELLO}${PING}`));
      }
      vi.advanceTimersByTime(HEARTBEAT_MS);
      await vi.waitFor(() => expect(a.text()).toBe(`${HELLO}${PING}${PING}`));
      a.destroy();
      b.destroy();
    });

    it('starts with the first client and stops when the last one leaves', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      server = await listening((_req, res) => channel.connect(res));
      expect(vi.getTimerCount()).toBe(0);
      const s = openStream(server.port);
      await s.opened;
      expect(vi.getTimerCount()).toBe(1);
      s.destroy();
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
    });

    it('is cleared by close()', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      server = await listening((_req, res) => channel.connect(res));
      const s = openStream(server.port);
      await s.opened;
      channel.close();
      expect(vi.getTimerCount()).toBe(0);
      await s.ended;
    });

    it('does not keep the process alive', async () => {
      const setInterval = vi.spyOn(globalThis, 'setInterval');
      server = await listening((_req, res) => channel.connect(res));
      const s = openStream(server.port);
      await s.opened;
      const heartbeat = setInterval.mock.results
        .map((r) => r.value)
        .filter((t) => t.hasRef() === false);
      expect(heartbeat).toHaveLength(1);
      s.destroy();
    });
  });
});

describe('reload tag', () => {
  it('names the build in the script URL', () => {
    expect(reloadTag(7)).toBe('<script src="/__preview/reload.js?build=7" defer></script>');
  });
});

describe('reload script', () => {
  /** Runs the script as the page of build `loadedBuild` would; the returned page is driven by the tests. */
  function run({ prerendering = false, visible = true, loadedBuild = 0 } = {}) {
    interface Source {
      url: string;
      closed: boolean;
      emit(data: string): void;
    }
    const sources: Source[] = [];
    class FakeEventSource {
      constructor(url: string) {
        const source: Source = {
          url,
          closed: false,
          emit: (data) => this.listener?.({ data }),
        };
        sources.push(source);
        this.source = source;
      }
      private readonly source: Source;
      private listener: ((event: { data: string }) => void) | undefined;
      addEventListener(type: string, listener: (event: { data: string }) => void): void {
        expect(type).toBe('build');
        this.listener = listener;
      }
      close(): void {
        this.source.closed = true;
      }
    }
    const listeners = new Map<string, { listener: () => void; once: boolean }[]>();
    const fakeDocument = {
      prerendering,
      visibilityState: visible ? 'visible' : 'hidden',
      currentScript: {
        src: `http://localhost:8000${reloadTag(loadedBuild).match(/src="([^"]+)"/)?.[1]}`,
      },
      addEventListener(type: string, listener: () => void, options?: { once: boolean }) {
        listeners.set(type, [
          ...(listeners.get(type) ?? []),
          { listener, once: options?.once === true },
        ]);
      },
    };
    const reload = vi.fn();
    new Function('document', 'EventSource', 'location', RELOAD_SCRIPT)(
      fakeDocument,
      FakeEventSource,
      { reload },
    );
    const fire = (type: string) => {
      for (const l of listeners.get(type) ?? []) {
        l.listener();
      }
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => !l.once),
      );
    };
    return {
      sources,
      reload,
      listeners,
      open: () => sources.filter((s) => !s.closed),
      show() {
        fakeDocument.visibilityState = 'visible';
        fire('visibilitychange');
      },
      hide() {
        fakeDocument.visibilityState = 'hidden';
        fire('visibilitychange');
      },
      activate: () => fire('prerenderingchange'),
    };
  }

  it('connects at once on a visible page and stays quiet while the build is the one it was served with', () => {
    const page = run({ loadedBuild: 3 });
    expect(page.sources.map((s) => s.url)).toEqual([RELOAD_EVENTS_PATH]);
    page.sources[0]?.emit('3');
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('reloads when the server is on another build: a rebuild between serving and connecting', () => {
    const page = run({ loadedBuild: 3 });
    page.sources[0]?.emit('4');
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('reloads on a live rebuild after a matching announcement', () => {
    const page = run({ loadedBuild: 0 });
    page.sources[0]?.emit('0');
    page.sources[0]?.emit('1');
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it('opens no connection on a page that starts hidden, and connects when it is shown', () => {
    const page = run({ visible: false });
    expect(page.sources).toEqual([]);
    page.show();
    expect(page.open()).toHaveLength(1);
  });

  it('closes the connection when hidden and reconnects when visible again', () => {
    const page = run();
    page.hide();
    expect(page.open()).toHaveLength(0);
    page.show();
    expect(page.sources).toHaveLength(2);
    expect(page.open()).toHaveLength(1);
    expect(page.open()[0]?.url).toBe(RELOAD_EVENTS_PATH);
  });

  it('reloads on reconnect after a rebuild while hidden, and not after none', () => {
    const missed = run({ loadedBuild: 2 });
    missed.sources[0]?.emit('2');
    missed.hide();
    missed.show();
    missed.sources[1]?.emit('3');
    expect(missed.reload).toHaveBeenCalledOnce();

    const quiet = run({ loadedBuild: 2 });
    quiet.hide();
    quiet.show();
    quiet.sources[1]?.emit('2');
    expect(quiet.reload).not.toHaveBeenCalled();
  });

  it('never holds more than one connection through repeated toggles and redundant events', () => {
    const page = run();
    page.show();
    page.show();
    expect(page.open()).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      page.hide();
      page.hide();
      expect(page.open()).toHaveLength(0);
      page.show();
      expect(page.open()).toHaveLength(1);
    }
    expect(page.sources).toHaveLength(6);
  });

  it('opens no connection while the page is only prerendered, even when visibility changes', () => {
    const page = run({ prerendering: true, visible: false });
    expect(page.sources).toEqual([]);
    page.hide();
    expect(page.sources).toEqual([]);
  });

  it('connects once, when the prerendered page is activated, then follows visibility', () => {
    const page = run({ prerendering: true, visible: false });
    expect(page.listeners.get('prerenderingchange')?.map((l) => l.once)).toEqual([true]);
    page.show();
    expect(page.open()).toHaveLength(1);
    page.activate();
    page.activate();
    expect(page.open()).toHaveLength(1);
    page.hide();
    expect(page.open()).toHaveLength(0);
  });
});
