/**
 * Shared description hygiene for source-scraped catalog prose.
 *
 * Two responsibilities:
 *  - strip page chrome (navigation, breadcrumbs, leaked script/style) from
 *    text that was lifted out of a rendered page;
 *  - fail closed on personally-identifying page content (recipient rosters,
 *    navigation dumps) that must never become a student-facing description.
 *
 * The department undergrad-research scraper (#598/#605) and the fellowship
 * catalog scraper (#609/#610) both feed here, and the read-time program
 * payload uses it as a second line of defense over already-stored records.
 */
import { redactDirectContactInfo } from './contactRedaction';

export function normalizeHygieneWhitespace(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const SECTION_HEADING_CHROME = [
  'Undergraduate Research Opportunities',
  'Undergraduate Research Opportunity',
  'About the Undergraduate Program',
  'Undergraduate Research',
  'Research Opportunities',
  'Undergraduate Programs',
  'Undergraduate Program',
  'Undergraduate Studies',
  'Overview',
  'Introduction',
];

export const leadingSectionHeadingPattern = new RegExp(
  `^(?:(?:${SECTION_HEADING_CHROME.join('|')})\\s+)+(?=[A-Z])`,
);

export const sourceChromeTextPattern =
  /\b(?:show all breadcrumbs|expand all|homeabout|home academics|calendar|applyprizes|recipient|copyright|privacy|click here|learn more|read more|for more information|more information|apply now|back to top|sign up)\b/i;

export const deadAnchorCtaSentencePattern =
  /\bclick\s+(?:here|below|(?:on\s+)?(?:this|the|the following)\s+link)\b/i;

/**
 * Partition text into sentence-ish segments that tile the input losslessly:
 * every character lands in exactly one segment, so `segments.join('')` always
 * reconstructs the original. Each segment carries its trailing terminal
 * punctuation and any following whitespace. Unlike the earlier
 * `/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g` walk, a run ending in period-then-
 * non-space (an abbreviation like "U.S."/"Ph.D.", a glued token, or a stripped
 * ".edu/" URL remnant) is not dropped by String.match - the `[^.!?]*` allows an
 * empty pre-terminal run so consecutive/internal periods still tile (#1020).
 * A defensive fallback returns the whole string as one segment if tiling ever
 * fails to reconstruct the input, so it can never silently delete text.
 */
export function partitionSentencesLossless(value: string): string[] {
  if (!value) return [];
  const segments = value.match(/[^.!?]*[.!?]+\s*|[^.!?]+$/g);
  if (!segments || segments.join('') !== value) return [value];
  return segments;
}

/**
 * Drop whole sentences whose only purpose is an inert click/anchor CTA
 * ("click here", "click this link") where the scraper kept the visible link
 * label but dropped the href, leaving a dead instruction with no destination
 * (#915). Gated to a no-op when no such fragment is present, so clean prose is
 * returned untouched; a description that is nothing but dead CTAs collapses to
 * empty. Deliberately narrower than sourceChromeTextPattern so a legitimate
 * sentence ("Award recipients will perform research...") is never removed. The
 * sentence walk is lossless (#1020) so real prose that precedes an abbreviation
 * ("...continental U.S. that might help.") is never silently deleted.
 */
export function stripDeadAnchorCtaSentences(text: string): string {
  const value = String(text || '');
  if (!deadAnchorCtaSentencePattern.test(value)) return normalizeHygieneWhitespace(value);
  const sentences = partitionSentencesLossless(value);
  const kept = sentences.filter((sentence) => !deadAnchorCtaSentencePattern.test(sentence));
  return normalizeHygieneWhitespace(kept.join(''));
}

const PROTECTED_ABBREVIATION_TAIL =
  /(?:^|\s)(?:Prof|Drs?|Mr|Mrs|Ms|Mx|Sr|Jr|St|Ave|Rd|Blvd|Inc|Ltd|Co|Corp|Dept|Univ|Assoc|Vol|No|pp|Fig|vs|etc|al)\.\s*$/i;

/**
 * Re-join sentence segments that the terminal-punctuation tiling split inside a
 * common abbreviation (a title like "Prof."/"Dr.", or "Inc."/"etc."). Operating
 * on the lossless partition means the merge cannot drop or reorder any
 * character; it only removes an internal split point, so segment-level filtering
 * and deduplication downstream reason over whole sentences rather than
 * abbreviation fragments.
 */
function mergeAbbreviationSplitSentences(segments: string[]): string[] {
  const merged: string[] = [];
  for (const segment of segments) {
    const previousIndex = merged.length - 1;
    if (previousIndex >= 0 && PROTECTED_ABBREVIATION_TAIL.test(merged[previousIndex])) {
      merged[previousIndex] += segment;
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

export function partitionSentencesForFiltering(value: string): string[] {
  return mergeAbbreviationSplitSentences(partitionSentencesLossless(value));
}

const pageLayoutReferencePattern =
  /\b(?:listed|shown|displayed|appears?|appearing|located|found|noted|indicated|see|refer(?:red|ring)?)\b[^.!?]{0,60}?\b(?:above|below|(?:on|to)\s+the\s+(?:right|left)(?:-hand)?(?:\s+(?:side|column|panel|menu))?|in\s+the\s+(?:right|left)(?:-hand)?\s+(?:column|side|panel|menu)|in\s+the\s+sidebar|(?:right|left)-hand\s+(?:column|side|panel|menu))\b/i;

/**
 * Drop a sentence that references the *source page's* visual layout - a
 * reference verb ("listed"/"shown"/"see"/"refer") paired with a geographic
 * position on that page ("on the right", "in the sidebar", "above"/"below", a
 * "right-hand column"). Such a caveat was meaningful beside the original page's
 * dates/deadline column but is orphaned and confusing once the prose is rehosted
 * in our card/modal, where nothing is "on the right" for a student to distrust
 * (#994). Both a reference verb and a page-position phrase are required so
 * ordinary research prose is never removed; gated to a no-op when neither is
 * present. Uses the lossless, abbreviation-aware sentence tiling so only the
 * offending sentence is dropped.
 */
export function stripPageLayoutReferentialSentences(text: string): string {
  const value = String(text || '');
  if (!pageLayoutReferencePattern.test(value)) return normalizeHygieneWhitespace(value);
  const kept = partitionSentencesForFiltering(value).filter(
    (sentence) => !pageLayoutReferencePattern.test(sentence),
  );
  return normalizeHygieneWhitespace(kept.join(''));
}

const leadingPolitenessPattern = /^(?:please\s+|kindly\s+|note[,:]?\s+(?:that\s+)?)/i;

function normalizeSentenceForDedup(segment: string): string {
  return normalizeHygieneWhitespace(segment)
    .toLowerCase()
    .replace(leadingPolitenessPattern, '')
    .replace(/[.!?"'’)\]]+$/, '')
    .trim();
}

/**
 * Collapse a substantial sentence that verbatim-repeats an earlier one, modulo a
 * leading politeness word ("Please"/"Kindly"/"Note that") and case: a scrape
 * defect where a contact/instruction line is emitted twice in the same block
 * ("Please contact Prof. X for further information. ... Contact Prof. X for
 * further information.", #994). The first occurrence is kept and every later
 * duplicate dropped. Broader than collapseDuplicatedProseBlock, which only folds
 * an exact adjacent block; this reaches non-adjacent repeats. Only sentences of
 * at least four alphabetic words are deduplicated so an ordinary short repeated
 * phrase is left untouched, and abbreviation-aware tiling keeps whole sentences
 * intact so a real sentence is never partially deleted.
 */
export function collapseRepeatedSentences(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  if (!value) return value;
  const segments = partitionSentencesForFiltering(value);
  if (segments.length < 2) return value;
  const seen = new Set<string>();
  const kept: string[] = [];
  let dropped = false;
  for (const segment of segments) {
    const key = normalizeSentenceForDedup(segment);
    const isSubstantial = (segment.match(/[A-Za-z]{2,}/g) || []).length >= 4;
    if (isSubstantial && key) {
      if (seen.has(key)) {
        dropped = true;
        continue;
      }
      seen.add(key);
    }
    kept.push(segment);
  }
  return dropped ? normalizeHygieneWhitespace(kept.join('')) : value;
}

export function stripInlineUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\b[a-z0-9][a-z0-9-]*\.(?:gle|com|edu|org|gov|io|net|us)\b\S*/gi, ' ');
}

export function stripLeadingSectionHeadingChrome(sentence: string): string {
  return normalizeHygieneWhitespace(sentence.replace(leadingSectionHeadingPattern, ''));
}

const redactionPlaceholderPattern =
  /\s*(?:\b(?:at|to|via|contact(?:ed)?|email(?:ed)?|reach(?:ed)?(?:\s+out)?|sent)\b\s*)?[:-]?\s*\[(?:email|phone) redacted\]/gi;

const redactionTokenTest = /\[(?:email|phone) redacted\]/i;
const redactionTokenGlobal = /\[(?:email|phone) redacted\]/gi;
const splitIntoSentences = (value: string): string[] =>
  value.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [value];
const endsWithTerminalPunctuation = (value: string): boolean =>
  /[.!?]["')\]]?$/.test(value.trim());
const wordCount = (value: string): number => (value.match(/[A-Za-z]{2,}/g) || []).length;

/**
 * Remove a stored [email redacted] / [phone redacted] contact placeholder while
 * keeping the surrounding prose grammatical. A token that trails a sentence as a
 * removable connective phrase ("...committee at [email redacted].") is cleaned in
 * place, but a token whose removal would strand the rest of its sentence - either
 * orphaned words follow it mid-sentence ("please contact [email redacted] in the
 * office" -> "please in the office"), or the strip leaves a fragment with no
 * terminal punctuation ("...should be sent to [email redacted]" -> "...should be
 * sent") - drops that whole sentence instead of emitting mangled copy (#774).
 * Sentences without a token are always kept.
 */
export function stripRedactionPlaceholders(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  if (!value || !redactionTokenTest.test(value)) return value;
  const kept: string[] = [];
  for (const rawSentence of splitIntoSentences(value)) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if (!redactionTokenTest.test(sentence)) {
      kept.push(sentence);
      continue;
    }
    const matches = [...sentence.matchAll(redactionTokenGlobal)];
    const lastMatch = matches[matches.length - 1];
    const tail = sentence.slice((lastMatch.index ?? 0) + lastMatch[0].length);
    if (/[A-Za-z]{2,}/.test(tail)) continue;
    const stripped = normalizeHygieneWhitespace(
      sentence.replace(redactionPlaceholderPattern, ' ').replace(/\s+([.,;:!?])/g, '$1'),
    );
    if (stripped && endsWithTerminalPunctuation(stripped) && wordCount(stripped) >= 2) {
      kept.push(stripped);
    }
  }
  return normalizeHygieneWhitespace(kept.join(' '));
}

/**
 * Prepare a scraped source quote for use as a student-facing evidence excerpt:
 * redact direct contact details, then drop every sentence that still carries a
 * `[email redacted]`/`[phone redacted]` marker so the raw placeholder is never
 * rendered to students (#1076). Unlike stripRedactionPlaceholders (which salvages
 * a description sentence by trimming a trailing marker), an evidence excerpt is a
 * short verbatim quote where a marker-bearing sentence is almost always a bare
 * contact directive ("Email us at [email redacted]") with no independent value,
 * and partial salvage tends to strand a mangled label fragment - so the whole
 * marker-bearing sentence is dropped. Returns an empty string when nothing of
 * substance survives, so the caller can omit the excerpt entirely.
 */
export function sanitizeEvidenceExcerpt(value: string): string {
  const redacted = normalizeHygieneWhitespace(redactDirectContactInfo(String(value ?? '')));
  if (!redacted || !redactionTokenTest.test(redacted)) return redacted;
  const kept = splitIntoSentences(redacted)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !redactionTokenTest.test(sentence));
  return normalizeHygieneWhitespace(kept.join(' '));
}

const CATALOG_CHROME_PATTERNS: RegExp[] = [
  /\$\(document\)\.ready\([\s\S]*?\}\s*\)\s*;?/gi,
  /\$\([^)]*\)[^;{}]*\{[\s\S]*?\}\s*\)?\s*;?/g,
  /\.[-\w]+\s*\{[^}]*\}/g,
  /\bskip to (?:main )?(?:content|navigation|main navigation)\b/gi,
  /\bshow all breadcrumbs\b/gi,
  /\bshow breadcrumbs\b/gi,
  /\btoggle navigation\b/gi,
  /\bexpand all\b/gi,
  /\bcollapse all\b/gi,
  /\bmain menu\b/gi,
  /\bINFORMATION FOR\b/g,
  /\bCopy Link\b/g,
  /\bfollow us on\b[^.!?]*[.!?]/gi,
  /\b(?:Learn|Read) more about\s+[A-Za-z][^>»\n]{0,60}?(?:>>|»)/gi,
  /\bWatch a video with\s+[A-Za-z][^>»\n]{0,60}?(?:>>|»)/gi,
  /\b(?:Learn|Read) more about\b[^.!?>»\n]{0,80}?[.!?]?\s*Read More\b/g,
];

export function stripCatalogChrome(text: string): string {
  let out = String(text || '');
  for (const pattern of CATALOG_CHROME_PATTERNS) out = out.replace(pattern, ' ');
  return normalizeHygieneWhitespace(out);
}

/**
 * Collapse an exact, adjacent duplicate of a prose block: a scrape defect
 * where a paragraph is concatenated with itself (directly, or separated by
 * the single normalized whitespace of a paragraph break), sometimes followed
 * by unrelated trailing chrome (#904). Requires an exact match of a
 * substantial run (>=40 normalized characters) immediately following itself,
 * checked from the smallest candidate block up so a long run of a repeated
 * short sentence collapses one repeat at a time rather than being mistaken
 * for one giant duplicated block, and ordinary prose that merely repeats a
 * short phrase is left untouched.
 */
export function collapseDuplicatedProseBlock(text: string): string {
  const normalized = normalizeHygieneWhitespace(text);
  const minBlockLength = 40;
  const maxBlockLength = Math.floor(normalized.length / 2);
  for (let blockLength = minBlockLength; blockLength <= maxBlockLength; blockLength += 1) {
    const first = normalized.slice(0, blockLength);
    if (first === normalized.slice(blockLength, blockLength * 2)) {
      return normalizeHygieneWhitespace(first + normalized.slice(blockLength * 2));
    }
    if (
      normalized[blockLength] === ' ' &&
      first === normalized.slice(blockLength + 1, blockLength * 2 + 1)
    ) {
      return normalizeHygieneWhitespace(first + normalized.slice(blockLength * 2 + 1));
    }
  }
  return normalized;
}

const researchAreaHeadingLeakPattern =
  /(?:^\s*|[,;]\s*(?:and\s+)?|\b(?:Studies|include|including)\s+)research\s+(?:areas?|interests?|fields?|topics?)\s*:(?:\s|\.|$)/i;

/**
 * A synthesized topic blurb ("Studies X, Y, and research areas:.") that leaked a
 * bare section-heading token ("research areas:", "research interests:") into its
 * joined area list. The trailing colon on a heading word used as a list item is
 * the tell - clean topical tags never carry it - so this stays clear of genuine
 * summaries. Fails closed on the leak so the corrupted card blurb is dropped
 * rather than shown (#816).
 */
export function isResearchAreaTemplateLeakText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(String(text || ''));
  if (!normalized) return false;
  return researchAreaHeadingLeakPattern.test(normalized);
}

const htmlTagMarkupPattern =
  /<\/[a-z][a-z0-9]*\s*>|<[a-z][a-z0-9]*(?:\s+[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))+\s*\/?>/i;

/**
 * A description that still carries literal HTML-element markup - a closing tag
 * (`</span>`) or an opening tag with at least one valued attribute (`<span
 * data-id="...">`, `<a href="...">`, `<span data-type="title">`). Scraped
 * "Selected Publications" citation widgets render their entries as escaped-HTML
 * text, so a `.text()` extraction decodes the entities back into these literal
 * tag substrings; a field rendered as plain text (labDetail) then shows the raw
 * tag garbage (#909). Requiring a closing tag or a name=value attribute keeps
 * prose that uses bare angle brackets as inequalities ("expression < 0.05",
 * "0<x and n>100") from matching.
 */
export function containsHtmlTagMarkup(text: unknown): boolean {
  return htmlTagMarkupPattern.test(String(text || ''));
}

const gluedProfileRoleLabelPattern =
  /(?<=[A-Za-z])(?:YSM|FAS|YSE|SOM|STEM|SEAS|WGSS)\s+Researchers?\b/g;

/**
 * Strip a boilerplate profile role label ("YSM Researcher") that a
 * MeSH/profile-page extractor glued directly onto the end of a topic term with
 * no delimiter ("Postoperative ComplicationsYSM Researcher"). #742 removed the
 * token from the researchArea chip/facet surface, but stale shortDescription
 * values materialized before that fix still carry it baked into their joined
 * topic list; this reaches those too (#975). Anchored on a glued (no-space)
 * letter so a legitimately spaced acronym in prose is untouched, and it repairs
 * the leftover comma/space seam so the topic list reads cleanly.
 */
export function stripGluedProfileRoleLabel(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(gluedProfileRoleLabelPattern, '');
  if (stripped === value) return value;
  return normalizeHygieneWhitespace(stripped.replace(/\s+([,;])/g, '$1'));
}

const doubledSynthesisVerbPattern =
  /^(Studies|Investigates|Examines|Explores|Develops|Supports|Advances|Fosters|Uses|Employs|Researches|Analyzes|Models|Measures|Conducts|Creates|Enhances|Improves|Innovates|Builds)\s+\1\b/i;

/**
 * Collapse a doubled leading synthesis verb ("Studies Studies on ...") that a
 * stale materialization step emitted by prepending its "Studies " template onto
 * a value that already began with the verb (#975). Only the immediately repeated
 * leading verb is removed, so ordinary prose is untouched.
 */
export function collapseDoubledSynthesisVerb(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  return value.replace(doubledSynthesisVerbPattern, '$1');
}

const synthesisVerbLeadPattern =
  /^(?:Studies|Investigates|Examines|Explores|Develops|Supports|Advances|Fosters|Uses|Employs|Researches|Analyzes|Models|Measures|Conducts|Creates|Enhances|Improves|Innovates|Builds|Seeks to|Works on|Focuses on|Focused on|Creative work spans|Unites)\b/i;

const citationMarkerPattern =
  /\bedited by\b|\bUniversity Press\b|\bpp\.\s*\d|\bISBN\b|\((?:19|20)\d{2}\)[.,;:\s]*$/i;

const studiesSubjectVerbMismatchPattern =
  /^(?:Studies|Investigates|Examines|Explores)\s+(?!(?:how|what|why|when|where|which|who|whom|whose|that|the\s+way)\b)[a-z][a-z\s-]{2,50}?\s+(?:have|has|had|were|was)\s+been\b/i;

const careerFactLeakPattern =
  /\bin\s+(?:19|20)\d{2}\b[^.!?]*\b(?:was\s+awarded|awarded|tenure|joined|appointed|promoted)\b|\bwas\s+awarded\b|\bawarded\s+tenure\b/i;

/**
 * A "Studies <text>." synthesis template glued onto a fragment that is not a
 * coherent research-topic clause: a book citation or bibliography entry
 * ("Studies America, edited by ... (Harvard University Press, 2009)."), a
 * subject/verb-agreement mismatch lifted from a service/CV sentence ("Studies
 * veterinary education have been through ..."), or a biographical career-milestone
 * fragment ("Studies Art at Yale University in 1990 and was awarded tenure ...").
 * Gated on a synthesis-verb lead so it only fires on generated blurbs, never on
 * genuine prose; broader than #944's own-name-subject check because the tail,
 * not the subject, is the tell (#978).
 */
export function isStudiesTemplateGlueMalformed(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (!synthesisVerbLeadPattern.test(normalized)) return false;
  return (
    citationMarkerPattern.test(normalized) ||
    studiesSubjectVerbMismatchPattern.test(normalized) ||
    careerFactLeakPattern.test(normalized)
  );
}

const leadingPageChromePattern =
  /^(?:(?:Bio Website|Bio|Website|Home|Overview|Profile)\s+)+(?=[A-Z])/;

/**
 * Strip a leading page-navigation label (`Bio`, `Bio Website`, `Website`,
 * `Home`, `Overview`, `Profile`) glued to the front of a scraped
 * shortDescription (#1077). Gated on a following capitalized word so the label
 * is only removed when it precedes real content, leaving a genuine sentence
 * that merely opens with one of these words (lower-cased mid-prose) untouched.
 */
export function stripLeadingPageChrome(text: string): string {
  return normalizeHygieneWhitespace(String(text || '').replace(leadingPageChromePattern, ''));
}

const firstPersonPronounVoicePattern =
  /\bI['’](?:m|ve|d|ll)\b|\bI\s+(?:am|have|had|study|studies|studied|investigate|examine|explore|use|focus|focused|work|research|develop|lead|direct|analyze|apply|combine|seek|aim|began|started|joined|received|earned|hold|teach|remain|became)\b/;

const firstPersonPossessiveVoicePattern =
  /\b(?:my|My|our|Our)\s+(?:lab|laboratory|research|group|team|work|studies)\b/;

const firstPersonPluralVoicePattern =
  /\b(?:we|We)\s+(?:study|investigate|examine|explore|use|focus|develop|seek|aim|are|have|had|ask|address|analyze|apply|combine|build|model|show|report|hypothesize)\b/;

/**
 * Raw first-person source-bio voice in a student-facing shortDescription: a
 * personal pronoun clause (`I am`, `I study`, `I've`), a lab/research
 * possessive (`my research`, `our lab`), or a first-person-plural research
 * clause (`we study`, `in the laboratory we study`). The card/detail summary
 * must read as neutral third person, so any of these fails the shortDescription
 * closed and the read-time fallback (fullDescription, then researchAreas/
 * department framing) supplies cleaner copy (#1077). Scoped to shortDescription
 * only; the fullDescription first-person bio case remains tracked by #964.
 */
export function isFirstPersonResearchVoiceText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return (
    firstPersonPronounVoicePattern.test(normalized) ||
    firstPersonPossessiveVoicePattern.test(normalized) ||
    firstPersonPluralVoicePattern.test(normalized)
  );
}

const cardSummaryVerbLeadPattern =
  /^(?:Studies|Investigates|Examines|Explores|Develops|Supports|Advances|Fosters|Uses|Employs|Researches|Analyzes|Models|Measures|Conducts|Creates|Enhances|Improves|Innovates|Builds)\b/i;

/**
 * A raw URL leaked in as a "topic" inside a synthesized "Studies A, B, and C."
 * card summary (#1079: a stale bibliography URL glued into the topic list before
 * the researchAreas cleanup regenerated the source list). The generator now
 * rejects URL topics, but records written before that cleanup still carry the
 * URL in their persisted shortDescription, so this repairs it at read/index time
 * rather than requiring a corpus-wide backfill. Strips the URL and repairs the
 * orphaned list punctuation so the remaining clean topics survive; blanks the
 * blurb only when the URL was its sole topic. A no-op when no URL is present, so
 * ordinary summaries are untouched; for non-synthesis prose it just drops the
 * inline URL without list-repair.
 */
export function stripUrlTopicsFromCardSummary(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  if (!value) return '';
  if (!/https?:\/\/|\bwww\./i.test(value)) return value;
  const base = normalizeHygieneWhitespace(stripInlineUrls(value)).replace(/\s+([,;.])/g, '$1');
  if (!cardSummaryVerbLeadPattern.test(base)) return base;
  const repaired = base
    .replace(/([,;])(?=\s*[,;])/g, '')
    .replace(/([,;])(?=\s*\.)/g, '')
    .replace(/(^\S+)\s*[,;]\s*/i, '$1 ')
    .replace(/[,;]?\s*\band\b\s*(?=\.|$)/i, '')
    .replace(/[\s,;]+\.$/, '.')
    .replace(/\s+/g, ' ')
    .trim();
  const topicBody = repaired
    .replace(cardSummaryVerbLeadPattern, '')
    .replace(/^[\s,;.]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  if (!topicBody) return '';
  return repaired.replace(/[.\s]*$/, '.');
}

/**
 * Chrome-only cleaner for a research-entity shortDescription (card blurb and
 * detail field): strip page chrome and redact contact info, but skip the
 * fail-closed dump detection of sanitizeResearchEntityDescription so a genuine
 * research summary phrased as a question is not wrongly blanked, while a
 * chrome-only blurb collapses to empty (#808). Intentional fail-closed
 * exceptions apply: a leaked research-areas heading fragment in a synthesized
 * topic blurb (#816), the narrow institutional-center-blurb check (#893) that
 * blanks a promotional center/council landing blurb grafted onto an unrelated
 * entity, and raw first-person source-bio voice that a student-facing card must
 * never carry (#1077). A leading page-navigation label is stripped before the
 * voice check so a bare keyword list behind a `Bio` label survives (#1077).
 */
export function sanitizeResearchEntityShortDescription(text: string): string {
  const cleaned = stripUrlTopicsFromCardSummary(
    collapseDoubledSynthesisVerb(
      stripGluedProfileRoleLabel(
        stripLeadingPageChrome(
          stripTrailingContactAddress(
            stripCatalogChrome(redactDirectContactInfo(String(text || ''))),
          ),
        ),
      ),
    ),
  );
  if (isResearchAreaTemplateLeakText(cleaned)) return '';
  if (isInstitutionalCenterBlurbText(cleaned)) return '';
  if (isCtaNewsTickerDumpText(cleaned)) return '';
  if (isStudiesTemplateGlueMalformed(cleaned)) return '';
  if (isFirstPersonResearchVoiceText(cleaned)) return '';
  if (containsHtmlTagMarkup(cleaned)) return '';
  return cleaned;
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

/**
 * A recipient roster or person list: a run of "Name '28 Mentor: ..." rows, a
 * dense list of names with almost no sentences, or a "meet the mentors" bio
 * roster that names many people and repeatedly invites students to reach out to
 * or contact them individually. Mentor markers are the strongest standalone
 * signal; the class-year and name-density arms are both gated on the absence of
 * real sentences so multi-sentence donor/eligibility prose that merely mentions
 * class years or names people is kept, while the contact-invitation arm catches
 * a many-people bio dump written in full sentences (#904) that the
 * sentence-gated arms miss.
 */
const contactInvitationPattern =
  /\b(?:feel free to (?:reach out|contact|email)|reach out to (?:them|him|her|us)|contact (?:him|her|them)(?:\s+(?:at|directly|via))?)\b/gi;

export function isRosterShapedText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  const isSentenceSparse = sentenceEnders <= 3;
  const classYearMarkers = countMatches(normalized, /[‘’'`]\s?\d{2}\b/g);
  if (isSentenceSparse && classYearMarkers >= 3) return true;
  const mentorMarkers = countMatches(normalized, /\bmentors?\s*:/gi);
  if (mentorMarkers >= 3) return true;
  const uniqueNames = new Set(normalized.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []).size;
  if (uniqueNames >= 8 && isSentenceSparse) return true;
  const contactInvitations = countMatches(normalized, contactInvitationPattern);
  return contactInvitations >= 2 && uniqueNames >= 8;
}

/**
 * A navigation/menu dump: a long run of capitalized menu labels with no real
 * sentences. Gated so short blurbs and ordinary multi-sentence prose pass.
 */
export function isNavigationDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 40) return false;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  if (sentenceEnders > 2) return false;
  const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalized / words.length > 0.4;
}

const interrogativeQuestionPattern =
  /(?:^|[.!?]\s|\bFAQs?\b\s*|\bFrequently Asked Questions\b\s*)(?:can|could|do|does|did|how|what|when|where|which|who|whose|why|is|are|will|would|should|may|must|have|has)\b[^.?!]{0,200}\?/gi;

const faqMarkerPattern = /\bfrequently asked questions\b|\bfaqs?\b/i;

/**
 * An FAQ / Q&A page dump: a scraped page body whose "prose" is actually a run
 * of question-and-answer pairs. FAQ questions terminate in "?", so they defeat
 * isNavigationDumpText (which bails on real sentence enders); this arm catches
 * them instead. Kept conservative so prose with a single rhetorical question is
 * unaffected.
 */
export function isFaqDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  const questionMarks = countMatches(normalized, /\?/g);
  if (questionMarks >= 3) return true;
  if (countMatches(normalized, interrogativeQuestionPattern) >= 2) return true;
  return faqMarkerPattern.test(normalized) && questionMarks >= 1;
}

const formFieldLabelPattern = /\b[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3}:\s/g;

/**
 * An eligibility/requirements form dump: a dense run of "Label: value" fields
 * (Level: ..., Class: ..., Deadline: ...) with almost no real sentences, lifted
 * verbatim from a form or requirements table. Gated on the absence of sentences
 * so ordinary prose that merely uses a colon is kept.
 */
export function isFormFieldDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  if (sentenceEnders > 2) return false;
  return countMatches(normalized, formFieldLabelPattern) >= 4;
}

const CURATION_RATIONALE_PATTERNS: RegExp[] = [
  /\bsource-backed\b/i,
  /\bsafe to show\b/i,
  /\bshow (?:it )?prominently\b/i,
  /\bpublic copy\b/i,
  /\boperators?\s+should\b/i,
  /\bshould not be described as\b/i,
  /\btreat it as (?:a |an )?(?:restrained|broad)\b/i,
  /\buntil a (?:more specific )?(?:current )?(?:award|fellowship|program|funding) page is attached\b/i,
  /\bkeep public copy restrained\b/i,
  /\bclear student audience\b/i,
  /\b(?:should|must)\s+be\s+(?:shown|displayed|surfaced|rendered)\s+as\b/i,
];

/**
 * Internal curation / reviewer-rationale prose: an LLM or operator suitability
 * assessment written *about the record* ("is source-backed", "safe to show
 * prominently", "operators should refresh", "keep public copy restrained until
 * ... is attached", or a display-routing directive "it should be shown as
 * funding/project support rather than a research home") instead of a
 * student-facing description of the program. These phrases are internal review
 * vocabulary that never appears in genuine source prose, so a single marker is
 * enough to fail closed (#671, #1053).
 */
export function isCurationRationaleText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return CURATION_RATIONALE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const ctaImperativePattern =
  /\b(?:sign\s?up|join\s+(?:us|the\s+(?:conversation|community|movement|discussion|mailing\s+list))|register(?:\s+(?:now|today|here))?|rsvp|subscribe|donate|get\s+involved|follow\s+us|take\s+(?:the|a)\s+quiz|find\s+out\s+which\s+group|stay\s+(?:tuned|informed))\b/i;

const socialPlatformPattern =
  /\b(?:LinkedIn|Bluesky|Twitter|Instagram|Facebook|YouTube|TikTok|Mastodon|Threads)\b/gi;

const socialCtaSignoffPattern =
  /\b(?:join|follow|connect\s+with|find\s+us|share|watch|subscribe\s+to)\b[^.!?]{0,60}\b(?:LinkedIn|Bluesky|Twitter|Instagram|Facebook|YouTube|TikTok|Mastodon|Threads)\b/i;

const datedEventTeaserPattern =
  /\bon\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b[^.!?]{0,40}?\b\d{1,2}(?:st|nd|rd|th)?\b/i;

const secondPersonPattern = /\b(?:you|your|you['’]re|yourself)\b/gi;

const welcomeGreetingPattern = /(?:^|[.!?]\s)Welcome!/;

const pollStatCalloutPattern =
  /^(?:nearly|about|roughly|approximately|over|almost|around|just|only|an estimated|as many as|more than|up to)?\s*(?:\d{1,3}\s*%\s+of\s+[A-Za-z][a-z]+s|\d+\s+(?:in|out of)\s+\d+\s+[A-Za-z][a-z]+s)\b[^.!?]*\b(?:say|says|said|report|reports|believe|believes|think|thinks|feel|feels|want|wants|support|supports|agree|agrees|are|were|expect|expects|prefer|prefers)\b/i;

/**
 * A homepage news-ticker / call-to-action dump: disjointed promotional teaser
 * fragments (dated event announcements, a "Sign up"/"Join us" imperative, a
 * "take a quiz" prompt, a "Welcome!" greeting, a "join us on LinkedIn/Bluesky/
 * YouTube" social sign-off) scraped verbatim from a communications-heavy landing
 * page instead of a coherent description of the entity. These well-formed
 * sentences defeat the sentence-ender-gated dumps
 * (isNavigationDumpText/isFormFieldDumpText bail when sentence enders exceed two)
 * and carry no "?" for isFaqDumpText, so this arm keys on CTA / second-person /
 * social-sign-off markers rather than sentence count (#898). A social-platform
 * call to action, or a leading opinion-poll statistic callout ("76% of Americans
 * say ...", "Nearly 70% of adults believe ...", "3 in 5 Americans report ...")
 * lifted from a communications page (#932, broadened for leading-qualifier and
 * fractional forms in #1028), is unmistakable promotional chrome on its own;
 * otherwise two independent promotional signals are required so a genuine
 * description that merely invites contact is kept.
 */
export function isCtaNewsTickerDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (socialCtaSignoffPattern.test(normalized)) return true;
  if (pollStatCalloutPattern.test(normalized)) return true;
  const distinctPlatforms = new Set(
    (normalized.match(socialPlatformPattern) || []).map((platform) => platform.toLowerCase()),
  ).size;
  const promotionalSignals = [
    ctaImperativePattern.test(normalized),
    distinctPlatforms >= 2,
    datedEventTeaserPattern.test(normalized),
    countMatches(normalized, secondPersonPattern) >= 2,
    welcomeGreetingPattern.test(normalized),
  ].filter(Boolean).length;
  return promotionalSignals >= 2;
}

function lastSentenceBoundary(text: string): number {
  const matches = [...text.matchAll(/[.!?]["')\]]?(?=\s|$)/g)];
  if (matches.length === 0) return -1;
  const last = matches[matches.length - 1];
  return (last.index ?? 0) + last[0].length;
}

/**
 * Clamp an over-long description to a complete sentence when one is available
 * in the tail, otherwise to a word boundary with an ellipsis, so stored prose
 * is never cut mid-word (#671). Shorter text is returned unchanged.
 */
export function clampDescriptionLength(text: string, maxLength = 2000): string {
  const value = normalizeHygieneWhitespace(text);
  if (value.length <= maxLength) return value;
  const window = value.slice(0, maxLength);
  const sentenceEnd = lastSentenceBoundary(window);
  if (sentenceEnd >= maxLength * 0.6) return window.slice(0, sentenceEnd).trim();
  const lastSpace = window.slice(0, maxLength).lastIndexOf(' ');
  const cut = lastSpace > 0 ? window.slice(0, lastSpace) : window.slice(0, maxLength);
  return `${cut.trim()}…`;
}

const contactRedactionTokenPattern = /\[(?:email|phone) redacted\]/i;
const contactBlockLabelPattern = /\b(?:email|phone|office|fax)\s*:/i;
const bareLocalPhonePattern = /\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]\d{4}\b/;

const STREET_SUFFIX_WORD = 'Street|Avenue|Road|Boulevard|Drive|Way|Lane|Place|Court|Circle';
const STREET_SUFFIX_ABBREVIATION = 'St|Ave|Rd|Blvd|Dr|Ln|Pl|Ct|Cir';
const OFFICE_UNIT_LABEL = 'Floor|Fl|Room|Rm|Suite|Ste';

/**
 * A bare street-address fragment (`266 Whitney Avenue`), optionally followed by
 * a floor/room/suite unit (`, Fl 2, Rm 234`), with no `office:`/`address:` label
 * of its own. Faculty-bio scrapes sometimes merge a page's office-location line
 * straight into the bio prose with no separating punctuation, so this must be
 * detected on shape alone (#798).
 */
const bareStreetAddressPattern = new RegExp(
  `\\b\\d{1,5}\\s+[A-Z][A-Za-z']*(?:\\s+[A-Z][A-Za-z']*){0,3}\\s+` +
    `(?:(?:${STREET_SUFFIX_WORD})\\b|(?:${STREET_SUFFIX_ABBREVIATION})\\.)` +
    `(?:[.,]?\\s*(?:${OFFICE_UNIT_LABEL})\\.?\\s*\\d+[A-Za-z]?)*`,
);

/**
 * A faculty-bio contact block: a leftover `[email redacted]`/`[phone redacted]`
 * placeholder token (the read-time-safe rendering elsewhere in this module,
 * but never acceptable in a research-entity description), an
 * `Email:`/`Phone:`/`Office:`/`Fax:` label paired with a bare phone number
 * lifted straight out of a profile-page header (#676), or a bare office/street
 * address fragment glued onto the bio with no label at all (#798).
 */
export function hasContactBlockResidue(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (contactRedactionTokenPattern.test(normalized)) return true;
  if (contactBlockLabelPattern.test(normalized) && bareLocalPhonePattern.test(normalized)) {
    return true;
  }
  return bareStreetAddressPattern.test(normalized);
}

const trailingOfficeAddressPattern =
  /\s+\d{1,5}\s+(?:[A-Z][\w.'-]*\s+){1,5}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Way|Lane|Ln|Place|Pl|Court|Ct|Terrace|Ter|Circle|Cir|Plaza|Highway|Hwy)\.?(?:[,\s]+(?:Fl|Floor|Rm|Room|Ste|Suite|Unit|Apt|Bldg|Building)\.?\s*\d+[A-Za-z]?)*(?:[,\s]+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})?(?:,?\s+[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?[.\s]*$/;

/**
 * Strip a bare campus office/street-address fragment glued onto the end of a
 * faculty-bio description (a lost-line-break scrape artifact, #798), preserving
 * the bio prose ahead of it. Requires a street number and a street-type suffix
 * so ordinary research prose that merely names a street is not affected; the
 * optional unit (Fl/Rm/Suite) and city/state/ZIP tail extend coverage. Only a
 * trailing, sentence-final fragment is removed so a mid-text mention is left
 * intact.
 */
export function stripTrailingContactAddress(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(trailingOfficeAddressPattern, '');
  return stripped === value ? value : normalizeHygieneWhitespace(stripped);
}

const publicationsListMarkerPattern = /\bselected\s+publications?\s*:/i;

/**
 * A "Selected Publications:" citation-list dump lifted from a faculty profile
 * page into a research-entity description (#676).
 */
export function isPublicationsListDumpText(text: string): boolean {
  return publicationsListMarkerPattern.test(normalizeHygieneWhitespace(text));
}

const INSTITUTIONAL_CENTER_BLURB_PATTERNS: RegExp[] = [
  /\bleading center of excellence\b/i,
  /\bcenter of excellence for\b[\s\S]{0,80}\bresearch and teaching\b/i,
  /\ba center dedicated to research and teaching\b/i,
  /\bresearch and teaching on the local,?\s*national,?\s*and international levels\b/i,
];

/**
 * A center/council promotional landing blurb ("... is a leading center of
 * excellence for X research and teaching on the local, national, and
 * international levels") scraped from an institution's own page and grafted
 * onto a lab or individual research entity that the page merely lists (#893).
 * The text is well-formed prose, so chrome/dump detectors miss it; it is wrong
 * only because it describes an *organization*, not this entity's research.
 *
 * The "Welcome to ..." opener is deliberately NOT a marker: 44 legitimate lab
 * descriptions open with it, so matching would blank real prose. The
 * center-of-excellence markers below hit only the grafts.
 */
export function isInstitutionalCenterBlurbText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return INSTITUTIONAL_CENTER_BLURB_PATTERNS.some((pattern) => pattern.test(normalized));
}

const researchAreaEchoPattern = /^Research\s+(?:fields?|areas?)\s+include\b[^.!?]+[.!?]?$/i;

/**
 * A vacuous "Research fields include <A>, <B>, and <C>." description whose only
 * content is a comma-join of the entity's own researchAreas: a bare labeled
 * chip list carrying no prose, fully redundant with the chips already shown
 * beside it (#623). Gated to a single sentence (the pattern admits no internal
 * sentence terminator) so genuine prose that merely opens with the phrase and
 * continues into a real description is kept.
 */
export function isResearchAreaEchoDescription(text: string): boolean {
  return researchAreaEchoPattern.test(normalizeHygieneWhitespace(text));
}

const provenanceHedgePattern = /[,;]?\s*\bwhen\s+source-confirmed\b/gi;

/**
 * Strip the internal provenance hedge "when source-confirmed" glued onto a
 * curated program field. It is a gating caveat about whether a figure was
 * corroborated by the source, not display copy, so as rendered it is dangling
 * junk on the field students read most closely - funding ("$17/hour when
 * source-confirmed") (#1053). Removing only the hedge keeps the figure ("$17/
 * hour") rather than failing the whole field closed, and the leftover
 * punctuation/space seam is repaired so the copy reads cleanly. Gated to a
 * no-op when the phrase is absent so ordinary prose is untouched.
 */
export function stripProvenanceHedge(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(provenanceHedgePattern, '');
  if (stripped === value) return value;
  return normalizeHygieneWhitespace(stripped.replace(/\s+([.,;:!?])/g, '$1'));
}

/**
 * Clean a scraped catalog description: strip chrome and the internal
 * provenance hedge, then fail closed to an empty string when the remainder is
 * roster/PII-shaped, a navigation dump, an FAQ/Q&A dump, an eligibility-form
 * label dump, internal curation/reviewer-rationale prose, or a homepage
 * news-ticker / CTA dump.
 *
 * Redaction placeholder tokens ([email redacted]/[phone redacted]) are the
 * intended safe rendering of contact info at read time and are left in place
 * here; stored prose that reads awkwardly around a token is cleaned at rest by
 * stripRedactionPlaceholders in the #671 backfill.
 */
export function sanitizeCatalogDescription(text: string): string {
  const stripped = stripProvenanceHedge(
    collapseRepeatedSentences(
      collapseDuplicatedProseBlock(
        stripPageLayoutReferentialSentences(
          stripDeadAnchorCtaSentences(stripCatalogChrome(text)),
        ),
      ),
    ),
  );
  if (!stripped) return '';
  if (
    isRosterShapedText(stripped) ||
    isNavigationDumpText(stripped) ||
    isFaqDumpText(stripped) ||
    isFormFieldDumpText(stripped) ||
    isCurationRationaleText(stripped) ||
    isCtaNewsTickerDumpText(stripped)
  ) {
    return '';
  }
  return stripped;
}

/**
 * Stored-layer sanitizer for catalog description prose, applied at every write
 * step (program/fellowship materialize and the #671 backfill) so a
 * re-materialize over a stale dirty observation can never re-introduce a
 * chrome/roster/FAQ/form/curation dump, a leaked contact detail, a baked-in
 * [email redacted] token, or a mid-word truncation.
 *
 * Contact details are redacted and their placeholder tokens then removed here
 * because the [email redacted] token is the intended read-time contact
 * rendering, not stored prose (#671): a stored description must read as clean
 * prose, so the token cleanup lives at the write step, not at read time. Fails
 * closed to an empty string on dump shapes.
 */
export function sanitizeStoredCatalogDescription(text: string, maxLength = 2000): string {
  const redacted = redactDirectContactInfo(String(text || ''));
  return clampDescriptionLength(
    stripRedactionPlaceholders(sanitizeCatalogDescription(redacted)),
    maxLength,
  );
}

const administrativeLeadershipClausePattern =
  /\b(?:(?:is|are|was|were)\s+)?(?:led|directed|headed|run|overseen|managed|chaired)\s+by\b/i;

const physicalLocationClausePattern =
  /\b(?:[Ll]ocated|[Hh]oused|[Bb]ased|[Ss]ituated|[Hh]eadquartered)\s+(?:in|at|on|within)\s+(?:the\s+)?(?:[A-Z][A-Za-z.'&-]+(?:\s+[A-Za-z.'&-]+){0,5}\s+(?:Hall|Building|Bldg|Center|Centre|Wing|Tower|Complex|Laboratory|Library|House|Plaza|Institute|Annex|Pavilion)|(?:Room|Rm|Suite|Ste|Floor|Fl|Unit)\.?\s*\d+[A-Za-z]?|[A-Z]{2,5}\s?\d{1,4})/;

const researchActivitySignalPattern =
  /\b(?:focus(?:es|ed|ing)?\s+on|studies|study|studying|investigat(?:es|ed|ing|ion|ions)?|examin(?:es|ed|ing)|explor(?:es|ed|ing|ation)?|develop(?:s|ed|ing|ment|ments)?|design(?:s|ed|ing)?|analyz(?:es|ed|ing)|model(?:s|ed|ing)?|measur(?:es|ed|ing|ement)?|specializ(?:es|ed|ing)|dedicated\s+to|interested\s+in|work(?:s|ing)?\s+on|aims?\s+to|seeks?\s+to|advanc(?:es|ed|ing)|our\s+(?:research|work|lab)|we\s+(?:study|develop|investigate|build|design|explore|examine|focus|research|use|create|model))\b/i;

const NAME_INITIAL_TAIL = /(?:^|\s)[A-Z]\.\s*$/;

function partitionSentencesForLeadStrip(value: string): string[] {
  const merged: string[] = [];
  for (const segment of partitionSentencesLossless(value)) {
    const previousIndex = merged.length - 1;
    if (
      previousIndex >= 0 &&
      (PROTECTED_ABBREVIATION_TAIL.test(merged[previousIndex]) ||
        NAME_INITIAL_TAIL.test(merged[previousIndex]))
    ) {
      merged[previousIndex] += segment;
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function isAdministrativeOrLocationLeadSentence(sentence: string): boolean {
  const normalized = normalizeHygieneWhitespace(sentence);
  if (!normalized) return false;
  if (researchActivitySignalPattern.test(normalized)) return false;
  return (
    administrativeLeadershipClausePattern.test(normalized) ||
    physicalLocationClausePattern.test(normalized)
  );
}

/**
 * Drop leading sentences that are purely administrative / physical-location
 * framing ("The X Lab is led by Prof. Y and is located in Watson Hall.", "The
 * research laboratory is located in AKW 408.") when genuine research prose
 * follows, so "what this lab studies" opens on the research rather than on who
 * runs it or which room it occupies (#1178). This also subsumes the duplicated
 * building/room restatement in that report, since both consecutive location
 * sentences fall in the leading run. A sentence that carries any research-activity
 * signal is never treated as a lead sentence, so a location clause fused to real
 * content ("... located in Watson Hall and studies quantum materials.") is kept
 * whole; the location arm requires a named building/room so a vague "located in
 * New Haven" is left alone. Sentence tiling merges name initials ("Arthur K.")
 * and title abbreviations so a proper name is never split mid-sentence. Fails
 * closed - returns the original text - unless at least one research-prose
 * sentence survives the strip.
 */
export function stripLeadingAdministrativeLocationSentences(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  if (!value) return value;
  if (
    !administrativeLeadershipClausePattern.test(value) &&
    !physicalLocationClausePattern.test(value)
  ) {
    return value;
  }
  const segments = partitionSentencesForLeadStrip(value);
  if (segments.length < 2) return value;
  let index = 0;
  while (index < segments.length && isAdministrativeOrLocationLeadSentence(segments[index])) {
    index += 1;
  }
  if (index === 0 || index >= segments.length) return value;
  const kept = segments.slice(index);
  if (!kept.some((sentence) => researchActivitySignalPattern.test(sentence))) return value;
  return normalizeHygieneWhitespace(kept.join(''));
}

/**
 * Research-entity description sanitizer (write- and read-time), stricter than
 * sanitizeCatalogDescription/sanitizeStoredCatalogDescription: a faculty/lab
 * fullDescription or shortDescription is the primary "what this lab studies"
 * surface, so a leftover contact-block token, a "Selected Publications:"
 * citation dump, or a bare "Research fields include <chips>." area echo (#623)
 * fails the whole description closed rather than surviving as read-time-safe
 * token text, a truncated tail (#676), or a vacuous restatement of the chips.
 *
 * The clean remainder is finally clamped through clampDescriptionLength so an
 * over-long or mid-word-truncated faculty/roster slice is trimmed to a sentence
 * or word boundary rather than served cut mid-word (#897), mirroring the same
 * final step in sanitizeStoredCatalogDescription (#671).
 */
export function sanitizeResearchEntityDescription(text: string, maxLength = 2000): string {
  const redacted = redactDirectContactInfo(String(text || ''));
  const stripped = stripLeadingAdministrativeLocationSentences(
    stripGluedProfileRoleLabel(
      stripTrailingContactAddress(sanitizeCatalogDescription(redacted)),
    ),
  );
  if (!stripped) return '';
  if (
    hasContactBlockResidue(stripped) ||
    isPublicationsListDumpText(stripped) ||
    isResearchAreaEchoDescription(stripped) ||
    isInstitutionalCenterBlurbText(stripped) ||
    containsHtmlTagMarkup(stripped)
  ) {
    return '';
  }
  return clampDescriptionLength(stripped, maxLength);
}
