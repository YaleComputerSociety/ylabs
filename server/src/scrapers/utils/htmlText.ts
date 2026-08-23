/**
 * Block-boundary-aware HTML-to-plain-text flattening for scrapers.
 *
 * Cheerio's `.text()` concatenates descendant text nodes with zero inserted
 * whitespace at element boundaries, so a multi-paragraph / multi-section bio
 * flattened via a bare `.text()` call glues the end of one block directly onto
 * the start of the next ("...recovery.In addition...", "EducationPh.D.",
 * "...Holy CrossDownload CV"). `.replace(/\s+/g, ' ')` cannot fix this after the
 * fact - it only collapses whitespace that already exists, it cannot invent a
 * separator where none was in the source HTML (issue #851).
 *
 * These helpers walk the node tree and insert a single space at every
 * block-level element boundary (and at `<br>`) before collapsing whitespace, so
 * the separator is derived from the document structure rather than guessed from
 * text casing - casing-based splitting would wrongly break legitimate proper
 * nouns like "AstraZeneca" or "MakeHaven".
 */
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

const BLOCK_LEVEL_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const NON_TEXT_TAGS = new Set(['script', 'style', 'noscript']);

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

function nodeTextWithBlockSeparators(node: AnyNode): string {
  const anyNode = node as {
    type?: string;
    data?: string;
    name?: string;
    children?: AnyNode[];
  };

  if (anyNode.type === 'text') return anyNode.data || '';
  if (anyNode.type === 'comment' || anyNode.type === 'directive' || anyNode.type === 'cdata') {
    return '';
  }

  const tagName = String(anyNode.name || '').toLowerCase();
  if (NON_TEXT_TAGS.has(tagName)) return '';

  const inner = (anyNode.children || []).map(nodeTextWithBlockSeparators).join('');
  return BLOCK_LEVEL_TAGS.has(tagName) ? ` ${inner} ` : inner;
}

/**
 * Flatten a single Cheerio element (by its underlying node) to plain text,
 * inserting a space at every block-level boundary within its subtree.
 *
 * Returns '' for a missing element so call sites can treat "no match" and
 * "empty match" identically.
 */
export function extractElementTextWithBlockSeparators(el: AnyNode | undefined | null): string {
  if (!el) return '';
  return collapseWhitespace(nodeTextWithBlockSeparators(el));
}

/**
 * Parse an HTML string / fragment and flatten it to plain text with a space at
 * every block-level boundary. Drop-in replacement for
 * `cheerio.load(html).text().replace(/\s+/g, ' ').trim()`.
 */
export function flattenHtmlToText(html: string | undefined | null): string {
  if (typeof html !== 'string' || html.trim() === '') return '';
  const $ = cheerio.load(html);
  const root = $.root()[0];
  return extractElementTextWithBlockSeparators(root);
}
