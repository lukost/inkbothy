import { ConfigError } from '../config/load.ts';
import type { SiteConfig } from '../config/schema.ts';
import { termUrl } from '../content/taxonomy.ts';
import { SITE_CONFIG_FILE } from '../lib/paths.ts';
import { ownValue } from '../shared/guards.ts';
import { html, type Interpolation, type Markup } from '../templates/html.ts';
import type { Item } from '../types.ts';
import { sortByTitle } from './order.ts';
import type { SectionPage } from './sections.ts';

export interface MenuSite {
  /** Menu entries in order: names of top-level pages and of sections. */
  readonly order: SiteConfig['menu'];
  /** Existing top-level pages by directory name. */
  readonly pages: ReadonlyMap<string, Item>;
  /** Existing section index pages. */
  readonly sections: readonly SectionPage[];
}

/** Top-level pages (not home) by directory name, with the section index pages. */
export function menuSite(
  order: SiteConfig['menu'],
  items: readonly Item[],
  sections: readonly SectionPage[],
): MenuSite {
  const pages = items.filter((i) => i.kind === 'page' || i.kind === 'resume');
  return { order, pages: new Map(pages.map((i) => [i.slug, i])), sections };
}

/**
 * @throws ConfigError for a menu entry that is neither a declared section nor a top-level page
 */
export function checkMenu(
  { menu, sections }: Pick<SiteConfig, 'menu' | 'sections'>,
  pages: ReadonlySet<string>,
): void {
  for (const [i, name] of menu.entries()) {
    if (ownValue(sections, name) === undefined && !pages.has(name)) {
      throw new ConfigError(
        `${SITE_CONFIG_FILE}: menu[${i}]: "${name}" is neither a section nor a top-level page`,
      );
    }
  }
}

function link(href: string, label: Interpolation, currentUrl: string): Markup {
  return html`<a href="${href}"${href === currentUrl && html` aria-current="page"`}>${label}</a>`;
}

function group(title: string, entries: Markup[]): Markup {
  return html`<li><details open><summary>${title}</summary><ul>${entries.map(
    (e) => html`<li>${e}</li>`,
  )}</ul></details></li>`;
}

/** A section's entry as its `menu` setting asks: the first taxonomy's terms, the items, or just the link. */
function sectionEntry(page: SectionPage, currentUrl: string): Markup {
  const { key, url, config, members, lists } = page;
  const all = link(url, `All ${config.noun.plural}`, currentUrl);
  switch (config.menu) {
    case 'none':
      return html`<li>${link(url, config.label, currentUrl)}</li>`;
    case 'items':
      return group(config.label, [
        all,
        ...sortByTitle(members).map((m) => link(m.url, m.meta.title, currentUrl)),
      ]);
    case 'taxonomy':
      return group(config.label, [
        all,
        ...lists
          .slice(0, 1)
          .flatMap(({ field, terms }) =>
            terms.map((t) =>
              link(
                termUrl(key, field, t.slug),
                html`${t.label} <span class="count">(${t.items.length})</span>`,
                currentUrl,
              ),
            ),
          ),
      ]);
  }
}

/** Pre-rendered site navigation: every group starts open and can be folded without JS (<details>). */
export function renderMenu({ order, pages, sections }: MenuSite, currentUrl: string): Markup {
  const entries = order.map((name) => {
    const section = sections.find((s) => s.key === name);
    const page = pages.get(name);
    if (section) {
      return sectionEntry(section, currentUrl);
    }
    return page ? html`<li>${link(page.url, page.meta.title, currentUrl)}</li>` : '';
  });
  return html`<nav class="site-menu" aria-label="Site"><ul>
<li>${link('/', 'Home', currentUrl)}</li>
${entries}
</ul></nav>`;
}
