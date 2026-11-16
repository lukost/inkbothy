import type { ServerResponse } from 'node:http';

export const RELOAD_EVENTS_PATH = '/__reload';
export const RELOAD_SCRIPT_PATH = '/__preview/reload.js';
/**
 * Page script: holds the event stream only while the page is visible (browsers cap the
 * connections per host) and reloads when the server's build differs from the one the page was
 * served with, which also catches rebuilds that happened while it was hidden. A prerendered page
 * connects once it is shown.
 */
export const RELOAD_SCRIPT = `const loaded = new URL(document.currentScript.src).searchParams.get('build');
let source;
const sync = () => {
  if (document.visibilityState !== 'visible') {
    source?.close();
    source = undefined;
  } else if (!source) {
    source = new EventSource('${RELOAD_EVENTS_PATH}');
    source.addEventListener('build', (event) => {
      if (event.data !== loaded) location.reload();
    });
  }
};
document.addEventListener('visibilitychange', sync);
if (document.prerendering) {
  document.addEventListener('prerenderingchange', sync, { once: true });
} else {
  sync();
}
`;
/** Script tag injected before `</head>` of served pages; names the build the page belongs to. */
export const reloadTag = (build: number): string =>
  `<script src="${RELOAD_SCRIPT_PATH}?build=${build}" defer></script>`;

/** Interval of the comment line that keeps idle connections open through proxies. */
export const HEARTBEAT_MS = 20_000;

/** Server-sent-events connections of open pages. */
export interface ReloadChannel {
  /** Answer `res` as an event stream until it closes. */
  connect(res: ServerResponse): void;
  /** Number of the current build; starts at 0. */
  readonly build: number;
  /** Start the next build and tell every connected page, which reloads unless it belongs to it. */
  notify(): void;
  /** End all streams. */
  close(): void;
}

export function createReloadChannel(): ReloadChannel {
  const clients = new Set<ServerResponse>();
  let build = 0;
  let heartbeat: NodeJS.Timeout | undefined;
  const stopHeartbeat = () => {
    clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const announce = (res: ServerResponse) => res.write(`event: build\ndata: ${build}\n\n`);
  return {
    get build() {
      return build;
    },
    connect(res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      announce(res);
      clients.add(res);
      heartbeat ??= setInterval(() => {
        for (const client of clients) {
          client.write(': ping\n\n');
        }
      }, HEARTBEAT_MS).unref();
      res.on('close', () => {
        clients.delete(res);
        if (clients.size === 0) {
          stopHeartbeat();
        }
      });
    },
    notify() {
      build++;
      clients.forEach(announce);
    },
    close() {
      stopHeartbeat();
      for (const res of [...clients]) {
        res.end();
      }
      clients.clear();
    },
  };
}
