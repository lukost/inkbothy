import type { MarkdownIt, StateCore, Token } from 'markdown-it';

const MARKER = /^\[([ xX])\]/;

function addClass(token: Token, name: string): void {
  const classes = token.attrGet('class');
  if (typeof classes !== 'string' || !classes.split(' ').includes(name)) {
    token.attrJoin('class', name);
  }
}

function insertCheckbox(state: StateCore, children: StateCore['tokens'], checked: boolean): void {
  const input = new state.Token('html_inline', '', 0);
  input.content = `<input type="checkbox" disabled${checked ? ' checked' : ''}>`;
  children.unshift(input);
}

function markTaskLists(state: StateCore): void {
  const { tokens } = state;
  const openLists: Token[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type.endsWith('_list_open')) {
      openLists.push(token);
    } else if (token.type.endsWith('_list_close')) {
      openLists.pop();
    }
    const item = index >= 2 ? tokens[index - 2] : undefined;
    const first = token.children?.[0];
    if (
      token.type !== 'inline' ||
      item?.type !== 'list_item_open' ||
      tokens[index - 1]?.type !== 'paragraph_open' ||
      first?.type !== 'text'
    ) {
      continue;
    }
    // The raw source must start with the marker too, so an escaped `\[ ]` stays text.
    const marker = MARKER.exec(token.content);
    if (!marker || !first.content.startsWith(marker[0]) || !/^\s/.test(first.content.slice(3))) {
      continue;
    }
    first.content = first.content.slice(3);
    insertCheckbox(state, token.children ?? [], marker[1] !== ' ');
    addClass(item, 'task-list-item');
    const list = openLists.at(-1);
    if (list) {
      addClass(list, 'contains-task-list');
    }
  }
}

/** GFM task list items: `- [ ] todo`, `- [x] done`. */
export default function taskLists(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'task_lists', markTaskLists);
}
