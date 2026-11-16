import { SIDEBAR_COLLAPSED, STORAGE_KEYS, WIDE_QUERY } from '../shared/ui-state.ts';
import { remember } from './storage.ts';

const root = (): HTMLElement => document.documentElement;

const isDrawerOpen = (): boolean => root().classList.contains('drawer-open');
const isCollapsed = (): boolean => root().dataset.sidebar === SIDEBAR_COLLAPSED;

/**
 * One menu button for every width: below the wide query it opens the drawer, and the page behind
 * the open drawer is `inert`, confining Tab to the top bar and drawer; from the wide query up it
 * hides or shows the sidebar column, and the choice is remembered.
 */
function initMenuButton(button: HTMLElement, body: HTMLElement, backdrop: Element | null): void {
  const wide = matchMedia(WIDE_QUERY);
  const behind = document.querySelectorAll('.content, .skip-link');

  const syncExpanded = (): void => {
    const visible = wide.matches ? !isCollapsed() : isDrawerOpen();
    button.setAttribute('aria-expanded', String(visible));
  };

  const setDrawer = (open: boolean, { restoreFocus = true } = {}): void => {
    root().classList.toggle('drawer-open', open);
    for (const el of behind) {
      el.toggleAttribute('inert', open);
    }
    syncExpanded();
    if (open) {
      body.querySelector<HTMLElement>('a[href]')?.focus();
    } else if (restoreFocus) {
      button.focus();
    }
  };

  const setCollapsed = (collapsed: boolean): void => {
    if (collapsed) {
      root().dataset.sidebar = SIDEBAR_COLLAPSED;
    } else {
      delete root().dataset.sidebar;
    }
    remember(STORAGE_KEYS.sidebar, collapsed ? SIDEBAR_COLLAPSED : null);
    syncExpanded();
  };

  syncExpanded();
  button.addEventListener('click', () => {
    if (wide.matches) {
      setCollapsed(!isCollapsed());
    } else {
      setDrawer(!isDrawerOpen());
    }
  });
  backdrop?.addEventListener('click', () => setDrawer(false));
  body.addEventListener('click', (event) => {
    if (isDrawerOpen() && event.target instanceof Element && event.target.closest('a')) {
      setDrawer(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (isDrawerOpen() && event.key === 'Escape') {
      setDrawer(false);
    }
  });
  wide.addEventListener('change', () => {
    if (wide.matches && isDrawerOpen()) {
      setDrawer(false, { restoreFocus: false });
    } else {
      syncExpanded();
    }
  });
}

/** Sidebar column on wide viewports, drawer on narrow ones; inert unless the head script marked the page `js`. */
export function initSidebar(): void {
  if (!root().classList.contains('js')) {
    return;
  }
  const menuButton = document.querySelector<HTMLElement>('.menu-button');
  const body = document.getElementById('sidebar-body');
  if (menuButton && body) {
    initMenuButton(menuButton, body, document.querySelector('.backdrop'));
  }
}
