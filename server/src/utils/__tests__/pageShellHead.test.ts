import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalPageUrl,
  escapeHtml,
  formatPageShellTitle,
  renderPageShell,
  truncatePageShellDescription,
} from '../pageShellHead';

const clientIndexHtml = readFileSync(
  fileURLToPath(new URL('../../../../client/index.html', import.meta.url)),
  'utf8',
);

const metaContent = (html: string, attribute: string, key: string): string[] =>
  Array.from(
    html.matchAll(new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="([^"]*)"`, 'gi')),
    (match) => match[1],
  );

const titles = (html: string): string[] =>
  Array.from(html.matchAll(/<title>([^<]*)<\/title>/gi), (match) => match[1]);

const linkHrefs = (html: string, rel: string): string[] =>
  Array.from(
    html.matchAll(new RegExp(`<link\\s+rel="${rel}"\\s+href="([^"]*)"`, 'gi')),
    (match) => match[1],
  );

describe('renderPageShell', () => {
  it('finds every tag it rewrites exactly once in the client shell', () => {
    expect(titles(clientIndexHtml)).toHaveLength(1);
    for (const [attribute, key] of [
      ['name', 'description'],
      ['property', 'og:title'],
      ['property', 'og:description'],
      ['name', 'twitter:title'],
      ['name', 'twitter:description'],
    ]) {
      expect(metaContent(clientIndexHtml, attribute, key)).toHaveLength(1);
    }
    expect(clientIndexHtml.match(/<\/head>/gi)).toHaveLength(1);
  });

  it('writes the page title, description and canonical url into the shell', () => {
    const html = renderPageShell(clientIndexHtml, {
      title: 'Synthetic Tide Pool Lab',
      description: 'Studies intertidal invertebrate communities.',
      canonicalPath: '/research/synthetic-tide-pool-lab',
    });

    expect(titles(html)).toEqual(['Synthetic Tide Pool Lab | y/labs']);
    expect(metaContent(html, 'property', 'og:title')).toEqual(['Synthetic Tide Pool Lab']);
    expect(metaContent(html, 'name', 'twitter:title')).toEqual(['Synthetic Tide Pool Lab']);
    for (const [attribute, key] of [
      ['name', 'description'],
      ['property', 'og:description'],
      ['name', 'twitter:description'],
    ]) {
      expect(metaContent(html, attribute, key)).toEqual([
        'Studies intertidal invertebrate communities.',
      ]);
    }
    expect(metaContent(html, 'property', 'og:url')).toEqual([
      'https://yalelabs.io/research/synthetic-tide-pool-lab',
    ]);
    expect(linkHrefs(html, 'canonical')).toEqual([
      'https://yalelabs.io/research/synthetic-tide-pool-lab',
    ]);
  });

  it('keeps the site-wide share image, robots directive and scripts untouched', () => {
    const html = renderPageShell(clientIndexHtml, {
      title: 'Synthetic Tide Pool Lab',
      description: 'Studies intertidal invertebrate communities.',
      canonicalPath: '/research/synthetic-tide-pool-lab',
    });

    for (const [attribute, key] of [
      ['property', 'og:image'],
      ['name', 'twitter:image'],
      ['name', 'robots'],
      ['property', 'og:site_name'],
    ]) {
      expect(metaContent(html, attribute, key)).toEqual(
        metaContent(clientIndexHtml, attribute, key),
      );
    }
    expect(html.match(/<script\b/gi)?.length).toBe(clientIndexHtml.match(/<script\b/gi)?.length);
  });

  it('returns the shell unchanged when no page metadata applies', () => {
    expect(renderPageShell(clientIndexHtml, {})).toBe(clientIndexHtml);
  });

  it('escapes text so a quote or angle bracket cannot leave its attribute or element', () => {
    const hostile = 'Lab "x" onload=alert(1) <script>alert(2)</script> & \'y\'';
    const html = renderPageShell(clientIndexHtml, {
      title: hostile,
      description: hostile,
      canonicalPath: '/research/a"b<c>',
    });

    expect(html).not.toContain('<script>alert(2)');
    expect(html).not.toContain('"x"');
    expect(titles(html)).toHaveLength(1);
    expect(metaContent(html, 'property', 'og:title')).toEqual([escapeHtml(hostile)]);
    expect(metaContent(html, 'name', 'description')).toEqual([escapeHtml(hostile)]);
    expect(linkHrefs(html, 'canonical')).toEqual(['https://yalelabs.io/research/a%22b%3Cc%3E']);
    expect(html.match(/<script\b/gi)?.length).toBe(clientIndexHtml.match(/<script\b/gi)?.length);
  });

  it('treats replacement patterns in served text literally', () => {
    const html = renderPageShell(clientIndexHtml, { title: "$& $1 $' $`" });

    expect(titles(html)).toEqual(['$&amp; $1 $&#39; $` | y/labs']);
  });
});

describe('page shell text helpers', () => {
  it('fixes the canonical host whatever the request host', () => {
    expect(canonicalPageUrl('/research')).toBe('https://yalelabs.io/research');
  });

  it('formats a page title the way the client document title does', () => {
    expect(formatPageShellTitle('Research')).toBe('Research | y/labs');
    expect(formatPageShellTitle('  ')).toBe('y/labs');
  });

  it('shortens a long description at a word boundary', () => {
    const description = `${'word '.repeat(60)}end`;
    const shortened = truncatePageShellDescription(description);

    expect(shortened.length).toBeLessThanOrEqual(200);
    expect(shortened.endsWith('word…')).toBe(true);
  });
});
