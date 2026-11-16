const ATTRIBUTE = 'data-enhanced';

function done(el: Element): string[] {
  return (el.getAttribute(ATTRIBUTE) ?? '').split(' ').filter(Boolean);
}

/** Whether enhancer `name` already processed `el`. */
export function isEnhanced(el: Element, name: string): boolean {
  return done(el).includes(name);
}

/** Record that enhancer `name` processed `el`, so a second run skips it. */
export function markEnhanced(el: Element, name: string): void {
  el.setAttribute(ATTRIBUTE, [...done(el), name].join(' '));
}
