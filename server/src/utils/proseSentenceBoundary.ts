/**
 * Restore the space a harvest lost at a boundary the source page had.
 *
 * Cheerio's `.text()` concatenates adjacent block elements with no separator, so
 * the end of one paragraph, list item or heading arrives welded to the start of
 * the next: "...account for 10% of all cancers in adults.To prevent...". #851 built
 * `flattenHtmlToText` to insert the separator from the document structure, and #3096
 * measured that 26 served bodies still carry the defect, reaching the corpus through
 * four separate lanes - including one whose input is stored text rather than HTML,
 * so no extractor fix can reach it. Handled once here, in the ingest choke point
 * every lane writes through, for the same reason #2934 handled invisible format
 * characters there rather than in each reader that missed them.
 *
 * This is the complementary defect to #2934: a missing separator rather than an
 * unwanted character. It is not recoverable by collapsing whitespace, because there
 * is no whitespace to collapse.
 *
 * Scoped by leaf field name rather than applied to every string, because the same
 * shape is legitimate outside prose and a blanket pass would corrupt it: measured on
 * Development, `profile.imageUrl` on two researcher rows and one fellowship
 * `contactEmail` match this pattern, and a host segment is not a sentence.
 *
 * Within prose the same caution applies to a URL written inline, so a token that
 * reads as a URL, an email or a bare domain is left whole.
 *
 * No abbreviation allowlist. `servedCardResidualAuditCore`'s detector carries one so
 * that "et al.Smith" is not counted as a sentence boundary, but the repair wants the
 * space there either way: "vol.Two" and "Dr.Smith" are the same lost separator, and
 * one of #3096's hand-read examples is exactly a lost space after a title
 * abbreviation. So this fixes a superset of what that detector counts.
 */
const GLUED_PROSE_BOUNDARY = /([A-Za-z]{2,})\.(?=[A-Z][a-z])/g;

const URL_LIKE_TOKEN =
  /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|@|\.(?:com|org|edu|net|gov|int|mil|io|co|uk|de|fr|ch|ca|au|jp|cn|info|biz)\b)/i;

/**
 * Leaf field names whose value is student-facing prose. `abstract` covers the grant
 * abstracts nested inside `recentGrants`, which the survey found to be the third
 * largest carrier of the defect.
 *
 * Deliberately excludes the evidence quote fields. A quote is stored so a reader can
 * check it against the page it came from, and inserting a character makes the record
 * disagree with its own source, which is a different trade from removing a character
 * that renders as nothing.
 */
export const PROSE_SENTENCE_BOUNDARY_FIELDS: ReadonlySet<string> = new Set([
  'abstract',
  'description',
  'fullDescription',
  'profileSynthesisDescription',
  'shortDescription',
  'summary',
]);

export function restoreLostProseSentenceBoundarySpaces(value: string): string {
  if (!value.includes('.')) return value;
  return value
    .split(/(\s+)/)
    .map((token) =>
      URL_LIKE_TOKEN.test(token) ? token : token.replace(GLUED_PROSE_BOUNDARY, '$1. '),
    )
    .join('');
}

export function hasLostProseSentenceBoundarySpace(value: string): boolean {
  return restoreLostProseSentenceBoundarySpaces(value) !== value;
}

/**
 * Walk a field value, restoring the separator on every prose leaf inside it. Arrays
 * keep their parent field name so a list of prose strings is covered; an object uses
 * its own keys, which is how a grant abstract is reached without also reaching the
 * grant's title or URL.
 *
 * Key order is preserved, because the materializer's diff-skip compares projected
 * values by `JSON.stringify` and a reordered object reads as a change.
 */
export function withProseSentenceBoundariesRestored(field: string, value: unknown): unknown {
  if (typeof value === 'string') {
    return PROSE_SENTENCE_BOUNDARY_FIELDS.has(field)
      ? restoreLostProseSentenceBoundarySpaces(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => withProseSentenceBoundariesRestored(field, entry));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        withProseSentenceBoundariesRestored(key, entry),
      ]),
    );
  }
  return value;
}
