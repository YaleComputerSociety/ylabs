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

type WalkableNode = {
  type?: string;
  data?: string;
  name?: string;
  children?: AnyNode[];
};

const CLOSING_BLOCK_SEPARATOR = Symbol('closing-block-separator');

function pushInDocumentOrder<Marker>(
  pending: Array<AnyNode | Marker>,
  nodes: readonly AnyNode[] | undefined,
): void {
  if (!nodes) return;
  for (let index = nodes.length - 1; index >= 0; index -= 1) pending.push(nodes[index]);
}

function nodeTextWithBlockSeparators(root: AnyNode): string {
  const parts: string[] = [];
  const pending: Array<AnyNode | typeof CLOSING_BLOCK_SEPARATOR> = [root];
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === CLOSING_BLOCK_SEPARATOR) {
      parts.push(' ');
      continue;
    }
    const node = next as WalkableNode;
    if (node.type === 'text') {
      parts.push(node.data || '');
      continue;
    }
    if (node.type === 'comment' || node.type === 'directive' || node.type === 'cdata') continue;

    const tagName = String(node.name || '').toLowerCase();
    if (NON_TEXT_TAGS.has(tagName)) continue;

    if (BLOCK_LEVEL_TAGS.has(tagName)) {
      parts.push(' ');
      pending.push(CLOSING_BLOCK_SEPARATOR);
    }
    pushInDocumentOrder(pending, node.children);
  }
  return parts.join('');
}

/**
 * Iterative equivalent of cheerio `.text()` (domutils `textContent`), returning
 * byte-identical output. The library version recurses once per DOM level, so a
 * page nested a few thousand elements deep overflows the call stack (#3558).
 */
export function plainTextContent(nodes: AnyNode | readonly AnyNode[] | undefined | null): string {
  if (!nodes) return '';
  const roots: readonly AnyNode[] = Array.isArray(nodes) ? nodes : [nodes as AnyNode];
  const parts: string[] = [];
  const pending: AnyNode[] = [];
  pushInDocumentOrder(pending, roots);
  while (pending.length > 0) {
    const node = pending.pop() as WalkableNode;
    if (node.type === 'text') {
      parts.push(node.data || '');
      continue;
    }
    if (node.type === 'comment') continue;
    pushInDocumentOrder(pending, node.children);
  }
  return parts.join('');
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
