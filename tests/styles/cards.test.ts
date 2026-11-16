// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { card as renderCard } from '../../src/templates/cards.ts';
import { $$, dom, item, noTerms } from '../helpers.ts';
import { parseRules, type Rule, readStyle, splitSelectors } from './css.ts';

let cards: Rule[] = [];
let article: Rule[] = [];

beforeAll(async () => {
  cards = parseRules(await readStyle('cards.css'));
  article = parseRules(await readStyle('article.css'));
});

/** The declarations of the one rule whose selector list contains `selector`. */
function declarationsOf(rules: readonly Rule[], selector: string): ReadonlyMap<string, string> {
  const found = rules.filter((r) => splitSelectors(r.selector).includes(selector));
  expect(found, selector).toHaveLength(1);
  return found[0]?.declarations ?? new Map();
}

describe('project cards', () => {
  it('are clickable as a whole: a stretched title link over a positioned card', () => {
    expect(declarationsOf(cards, '.card').get('position')).toBe('relative');
    for (const level of ['h2', 'h3']) {
      const stretch = declarationsOf(cards, `.card ${level} a::after`);
      expect(stretch.get('content')).toBe('""');
      expect(stretch.get('position')).toBe('absolute');
      expect(stretch.get('inset')).toBe('0');
    }
  });

  it('keep the repository and tag links clickable above the stretched title link', () => {
    for (const selector of ['.card .card-repo a', '.card .article-tags a']) {
      const links = declarationsOf(cards, selector);
      expect(links.get('position'), selector).toBe('relative');
      expect(links.get('z-index'), selector).toBe('1');
    }
  });

  it('show keyboard focus anywhere in the card', () => {
    const focus = declarationsOf(cards, '.card:focus-within');
    expect(focus.get('outline')).toMatch(/^2px solid var\(--focus\)$/);
    expect(focus.get('outline-offset')).toBeDefined();
  });

  it('match the links the card template emits', () => {
    const card = dom(
      `<ul>${renderCard(
        item({
          url: '/projects/x/',
          section: 'projects',
          title: 'X',
          repo: 'https://example.com/x',
        }),
        noTerms,
        2,
      )}</ul>`,
    );
    expect($$(card, '.card h2 a')).toHaveLength(1);
    expect($$(card, '.card .card-repo a')).toHaveLength(1);
    expect($$(card, '.card')).toHaveLength(1);
  });
});

describe('the busy stream button', () => {
  it('keeps full contrast: no fade while it is busy', () => {
    const busy = declarationsOf(article, '.stream-load[aria-disabled="true"]');
    expect(busy.has('opacity')).toBe(false);
    expect(busy.get('cursor')).toBe('progress');
  });
});
