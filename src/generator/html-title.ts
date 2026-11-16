import { Parser } from 'htmlparser2';

/** Text of the first `<h1>` in an HTML fragment, whitespace collapsed ('' if it has none); undefined if there is no `<h1>`. */
export function firstHeadingText(source: string): string | undefined {
  let inside = false;
  let done = false;
  let text = '';
  const parser = new Parser({
    onopentag(name) {
      inside ||= name === 'h1' && !done;
    },
    ontext(chunk) {
      if (inside) {
        text += chunk;
      }
    },
    onclosetag(name) {
      if (inside && name === 'h1') {
        inside = false;
        done = true;
      }
    },
  });
  parser.end(source);
  return done ? text.replace(/\s+/g, ' ').trim() : undefined;
}
