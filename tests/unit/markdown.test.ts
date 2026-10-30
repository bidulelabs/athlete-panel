import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from '../../packages/ui/src/markdown-content';
import { markdownToPlainText, markdownUrl } from '../../packages/ui/src/markdown';

const render = (source: string) => renderToStaticMarkup(createElement(MarkdownContent, { source }));

describe('read-only training Markdown', () => {
  it('renders GFM, code, quotes and ordinary line breaks without an editor', () => {
    const html = render(
      [
        '# Focus',
        '## Pacing',
        '### Details',
        '',
        '**Easy** and *steady*, ~~fast~~.',
        'Next line.',
        '',
        '> Keep it controlled.',
        '',
        '- First',
        '- Second',
        '',
        '1. Warm up',
        '2. Cool down',
        '',
        '- [x] Complete',
        '- [ ] Pending',
        '',
        '| Day | Focus |',
        '| --- | --- |',
        '| Monday | Easy |',
        '',
        '`inline`',
        '',
        '```text',
        '<script>literal code</script>',
        '```',
        '',
        'https://example.com',
      ].join('\n'),
    );
    for (const tag of [
      '<h4',
      '<h5',
      '<h6',
      '<strong>',
      '<em>',
      '<del>',
      '<br',
      '<blockquote>',
      '<ul>',
      '<ol>',
      '<table>',
      '<code>',
    ])
      expect(html).toContain(tag);
    expect(html).toContain('type="checkbox" disabled="" checked=""');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('&lt;script&gt;literal code&lt;/script&gt;');
    expect(html).not.toMatch(/<(?:script|textarea|button)\b/);
  });

  it('keeps HTML inert, drops unsafe links and shows image alt text without fetching', () => {
    const html = render(
      '<img src="https://example.com/tracker" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n![Route](https://example.com/route.png)\n\n[unsafe](javascript:alert%281%29) [encoded](jav&#x61;script:alert%281%29) [data](data:text/html,alert)',
    );
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Route');
    expect(html).toContain('unsafe');
    expect(html).not.toMatch(/<(?:img|script|iframe|link)\b|href="(?:javascript|data):/);
    expect(html).not.toContain('route.png');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,hi',
    'vbscript:foo',
    'file:///tmp/file',
  ])('rejects unsafe URL %s', (url) => {
    expect(markdownUrl(url)).toBeUndefined();
  });

  it.each([
    'https://example.com',
    'http://example.com',
    'mailto:a@example.com',
    '/plans',
    '../plans',
    '#reference',
    '//example.com',
  ])('permits URL %s', (url) => {
    expect(markdownUrl(url)).toBe(url);
  });

  it('uses unique footnote and accessible label IDs across fields', () => {
    const source = 'Details[^1]\n\n[^1]: Extra context.';
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(MarkdownContent, { source }),
        createElement(MarkdownContent, { source }),
      ),
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(/(?:href="#|aria-describedby=")([^"]+)"/g))
      expect(ids).toContain(match[1]);
  });

  it('extracts readable excerpts through the parser, retaining block boundaries and link labels', () => {
    expect(
      markdownToPlainText(
        '# Focus\n\n**Easy** [route](https://example.com)\n\n- First\n- Second\n\n| Day | Focus |\n| --- | --- |\n| Mon | Steady |\n\n![Map][image]\n\n[image]: https://example.com/map.png',
      ),
    ).toBe('Focus Easy route First Second Day Focus Mon Steady Map');
    expect(markdownToPlainText('Escaped \\*stars\\* and `a_b`')).toBe('Escaped *stars* and a_b');
  });

  it('handles empty, malformed, Unicode and maximum-length narratives', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(render('')).toBe('<div class="ui-markdown "></div>');
    expect(render('**unfinished [link\nCafé 🏃')).toContain('Café 🏃');
    const text = 'é'.repeat(20000);
    expect(markdownToPlainText(text)).toBe(text);
    expect(render(text)).toContain(text);
    expect(render('one\ntwo\n\nthree')).toContain('one<br/>\ntwo');
  });

  it.each([
    ['nested quotes', '>'.repeat(2000)],
    ['quotes within the shorter field limit', '>'.repeat(3999)],
    ['nested lists', '- '.repeat(1900) + 'nested text'],
    ['GFM parser recursion', '- '.repeat(4000) + 'nested text'],
    ['multiline nesting', Array.from({ length: 100 }, (_, i) => '>'.repeat(i + 1)).join('\n')],
  ])('falls back to readable source for %s on the server and in excerpts', (_name, source) => {
    expect(source.length).toBeLessThanOrEqual(20000);
    const html = render(source);
    expect(html).toContain('class="ui-markdown-fallback"');
    expect(html).toContain(source.replaceAll('>', '&gt;'));
    expect(html).not.toMatch(/<(?:blockquote|ul|ol)\b/);
    expect(markdownToPlainText(source)).toBe(source.replace(/\s+/gu, ' ').trim());
  });

  it('keeps fallback HTML, images and links inert while preserving line breaks', () => {
    const source =
      '>'.repeat(2000) +
      '\n<img src="https://example.com/tracker" onerror="alert(1)">\n' +
      '![image](https://example.com/image.png)\n[unsafe](javascript:alert%281%29)';
    const html = render(source);
    expect(html).toContain('\n&lt;img');
    expect(html).toContain('![image]');
    expect(html).not.toMatch(/<(?:img|a|script|input)\b/);
    expect(markdownToPlainText(source)).toBe(source.replace(/\s+/gu, ' ').trim());
  });

  it('still formats ordinary nested lists, quotes and inline content', () => {
    const source = '> Quote\n> - First\n>   - **Nested** item';
    const html = render(source);
    expect(html).not.toContain('ui-markdown-fallback');
    expect(html).toContain('<strong>Nested</strong>');
    expect(markdownToPlainText(source)).toBe('Quote First Nested item');
  });
});
