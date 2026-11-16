import { describe, expect, it } from 'vitest';
import { cspIssues } from '../../src/generator/csp-check.ts';

describe('cspIssues', () => {
  it.each([
    ['<p>text <a href="/x">link</a> <img src="/i.png" alt=""></p>'],
    ['<script src="/app.js"></script>'],
    ['<pre><code>&lt;script&gt;alert(1)&lt;/script&gt; onclick=x</code></pre>'],
    ['<a href="https://example.com/?q=javascript:1">ok</a>'],
    ['<p data-onclick="x" title="onload=1">attributes that only look like handlers</p>'],
    [''],
  ])('finds nothing in %j', (markup) => {
    expect(cspIssues(markup)).toEqual([]);
  });

  it.each([
    ['<script>alert(1)</script>', 'inline <script>'],
    ['<SCRIPT type="module">x</SCRIPT>', 'inline <script>'],
    ['<p onclick="x()">hi</p>', 'event-handler attribute onclick'],
    ['<img src=x ONERROR=alert(1)>', 'event-handler attribute onerror'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript: URL'],
    ['<a href=" JavaScript:alert(1)">x</a>', 'javascript: URL'],
    ['<a href="java&#x09;script:alert(1)">x</a>', 'javascript: URL'],
    ['<a href="jav\nascript:alert(1)">x</a>', 'javascript: URL'],
    ['<form action="javascript:x()"></form>', 'javascript: URL'],
    ['<base href="https://evil.example/">', '<base>'],
  ])('flags %j', (markup, message) => {
    const issues = cspIssues(markup);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(message);
  });

  it('names each kind once, however often it occurs', () => {
    const issues = cspIssues('<script>1</script><script>2</script><b onclick=a onmouseover=b></b>');
    expect(issues).toHaveLength(3);
  });
});
