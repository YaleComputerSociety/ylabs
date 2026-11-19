import { hasChildren, isTag, isText, type AnyNode, type Element } from 'domhandler';
import { plausiblePersonOrcid } from '../../utils/orcid';

const ORCID_DIGIT_RUN = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/gi;
const STATES_ORCID_HREF = /orcid\.org|^orcid:/i;
const ORCID_WORD = /\borcid\b/i;
const ORCID_ATTRIBUTE_NAMES = ['class', 'id', 'aria-label', 'title', 'itemprop', 'data-label'];
const MAX_LABEL_ANCESTOR_DEPTH = 2;
const MAX_LABEL_TEXT_LENGTH = 40;

const NON_RENDERED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'noembed',
  'noframes',
]);

const collapsedText = (value: string): string => value.replace(/\s+/g, ' ').trim();

function nodeText(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!hasChildren(node)) return '';
  return node.children.map(nodeText).join(' ');
}

function attributesNameOrcid(el: Element): boolean {
  if (STATES_ORCID_HREF.test(el.attribs.href ?? '')) return true;
  return ORCID_ATTRIBUTE_NAMES.some((name) => ORCID_WORD.test(el.attribs[name] ?? ''));
}

function previousRenderedSibling(node: AnyNode): AnyNode | null {
  let sibling = node.prev;
  while (sibling && !collapsedText(nodeText(sibling))) sibling = sibling.prev;
  return sibling;
}

function isShortOrcidLabel(node: AnyNode | null): boolean {
  if (!node) return false;
  const text = collapsedText(nodeText(node));
  return text.length <= MAX_LABEL_TEXT_LENGTH && ORCID_WORD.test(text);
}

/**
 * A written digit run is an ORCID only where the page labels it one: the same text says
 * "ORCID", an enclosing element within two levels is an ORCID link or carries an ORCID class,
 * id or label, or the label sits just before it ("ORCID:" in a `dt`, a `strong` or a text
 * node). A bare run elsewhere, such as a publications year list, is not (#5991).
 */
function isLabelledOrcidText(textNode: AnyNode): boolean {
  if (isText(textNode) && ORCID_WORD.test(textNode.data)) return true;
  let node: AnyNode = textNode;
  for (let depth = 0; depth <= MAX_LABEL_ANCESTOR_DEPTH; depth += 1) {
    if (isShortOrcidLabel(previousRenderedSibling(node))) return true;
    const parent = node.parent;
    if (!parent || !isTag(parent)) return false;
    if (attributesNameOrcid(parent)) return true;
    node = parent;
  }
  return false;
}

/**
 * The ORCID candidates a subtree states: every orcid.org or `orcid:` link, and every written
 * iD the page labels as an ORCID. `skipsSubtree` lets a caller drop blocks that belong to
 * someone else (navigation, co-authors, publications).
 */
export function statedOrcidCandidates(
  root: AnyNode,
  skipsSubtree: (el: Element) => boolean = () => false,
): string[] {
  const candidates: string[] = [];
  const visit = (node: AnyNode): void => {
    if (isText(node)) {
      const runs = node.data.match(ORCID_DIGIT_RUN) ?? [];
      if (runs.length > 0 && isLabelledOrcidText(node)) candidates.push(...runs);
      return;
    }
    if (!isTag(node) || NON_RENDERED_TAGS.has(node.tagName.toLowerCase())) return;
    if (skipsSubtree(node)) return;
    const href = node.tagName.toLowerCase() === 'a' ? (node.attribs.href ?? '') : '';
    if (STATES_ORCID_HREF.test(href)) candidates.push(href);
    node.children.forEach(visit);
  };
  if (hasChildren(root)) root.children.forEach(visit);
  return candidates;
}

/** Whether a subtree states any ORCID at all, plausible or not: a link, or a labelled iD. */
export function subtreeMentionsOrcid(
  root: AnyNode,
  skipsSubtree: (el: Element) => boolean = () => false,
): boolean {
  let mentions = false;
  const visit = (node: AnyNode): void => {
    if (mentions) return;
    if (isText(node)) {
      if (ORCID_WORD.test(node.data)) mentions = true;
      return;
    }
    if (!isTag(node) || NON_RENDERED_TAGS.has(node.tagName.toLowerCase())) return;
    if (skipsSubtree(node)) return;
    if (attributesNameOrcid(node)) {
      mentions = true;
      return;
    }
    node.children.forEach(visit);
  };
  if (hasChildren(root)) root.children.forEach(visit);
  return mentions;
}

/**
 * The ORCID a set of candidates names, only when they name exactly one distinct plausible iD.
 * A list of several does not say which is the subject's (#5932), and a value no person can
 * hold is no candidate at all (#5991).
 */
export function singlePlausibleOrcid(candidates: Iterable<unknown>): string | undefined {
  const distinct = new Set([...candidates].map(plausiblePersonOrcid).filter(Boolean));
  return distinct.size === 1 ? [...distinct][0] : undefined;
}
