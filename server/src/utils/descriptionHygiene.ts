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

export const selfReferentialResearchCtaSentencePattern =
  /\b(?:read|learn)\s+more\b(?:\s+in\s+depth)?\s+about\s+(?:the\s+|our\s*)?(?:research|work|collection)\b/i;

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

/**
 * Drop a self-referential "read/learn more about our/the research" call-to-action
 * sentence that points back at the lab's own site or Research page ("To read more
 * about our research, please see the Yan Lab Research page.", "See the Politi Lab
 * Research page to read more in depth about the work we are doing in our Lab.").
 * Unlike the "Learn more about <Name> >>" anchor shape stripped by
 * CATALOG_CHROME_PATTERNS (#931/#953), the anchor href and label are gone here and
 * only the generic invitation prose survives, riding into the served copy beside
 * legitimate research prose (#1283). Sentence-scoped like stripDeadAnchorCtaSentences
 * so prose before or after the CTA is preserved, and gated to a no-op when the
 * phrase is absent so clean prose is untouched. The object is scoped to
 * research/work/collection so a legitimate "learn more about our program" (#953)
 * is left alone, and the `our\s*` seam also catches the space-dropped
 * "ourResearch" scrape artifact.
 */
export function stripSelfReferentialResearchCtaSentences(text: string): string {
  const value = String(text || '');
  if (!selfReferentialResearchCtaSentencePattern.test(value)) {
    return normalizeHygieneWhitespace(value);
  }
  const kept = partitionSentencesForFiltering(value).filter(
    (sentence) => !selfReferentialResearchCtaSentencePattern.test(sentence),
  );
  return normalizeHygieneWhitespace(kept.join(''));
}

const danglingSourceSiteReferencePattern =
  /\b(?:please\s+)?(?:visit|check|see|refer\s+to|look\s+at)\s+the\s+[A-Za-z][A-Za-z\s]{0,50}?\s+(?:section|page)\b|\bcan\s+be\s+found\s+here\b/i;

/**
 * Drop a sentence that points the reader at a named section/page on the
 * *source* site ("please visit the Positions section for more information",
 * "look at the Research section of the FAQ page") or ends in a bare,
 * anchor-less "can be found here" (#1632). No such section exists in our
 * product, so the reference is dead. Distinct from
 * stripPageLayoutReferentialSentences (#994), which targets a visual page
 * position ("on the right", "in the sidebar") rather than a named
 * section/page. Requiring the "section"/"page" or "here" anchor keeps
 * ordinary prose like "a great way to learn more about a subfield" untouched.
 */
export function stripDanglingSourceSiteReferenceSentences(text: string): string {
  const value = String(text || '');
  if (!danglingSourceSiteReferencePattern.test(value)) return normalizeHygieneWhitespace(value);
  const kept = partitionSentencesForFiltering(value).filter(
    (sentence) => !danglingSourceSiteReferencePattern.test(sentence),
  );
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

const bibliographicArtifactStripPattern =
  /https?:\/\/\S+|\bwww\.\S+|(?<!@)\b(?:[a-z0-9][a-z0-9-]*\.)+(?:gov|edu|org|com|io|net|us)\b\S*|\bPMCID\s*:?\s*(?:PMC)?\d+|\bPMC\d+\b|\bPMID\s*:?\s*\d+|\bdoi\s*:\s*\S+/gi;

const bibliographicArtifactDetectPattern =
  /https?:\/\/\S+|\bwww\.\S+|(?<!@)\b(?:[a-z0-9][a-z0-9-]*\.)+(?:gov|edu|org|com|io|net|us)\b\S*|\bPMCID\s*:?\s*(?:PMC)?\d+|\bPMC\d+\b|\bPMID\s*:?\s*\d+|\bdoi\s*:\s*\S+/i;

const REFERENCE_SCAFFOLD_WORDS = new Set([
  'see',
  'also',
  'for',
  'more',
  'further',
  'detail',
  'details',
  'information',
  'info',
  'reference',
  'references',
  'visit',
  'full',
  'text',
  'available',
  'online',
  'here',
  'read',
  'learn',
  'about',
  'paper',
  'papers',
  'publication',
  'publications',
  'article',
  'articles',
  'website',
  'link',
  'links',
  'via',
  'from',
  'and',
  'the',
  'please',
  'find',
  'below',
  'above',
]);

const ARTIFACT_TOKEN_MASK = '';

const referenceLeadInPattern = new RegExp(
  '\\b(?:full\\s+text\\s+)?(?:is\\s+)?available\\s+(?:online\\s+)?(?:at|from)\\s+' +
    ARTIFACT_TOKEN_MASK +
    '|\\b(?:see|read|learn)(?:\\s+more)?(?:\\s+(?:at|on|about))?\\s+' +
    ARTIFACT_TOKEN_MASK +
    '|\\bmore\\s+(?:at|on|information\\s+at)\\s+' +
    ARTIFACT_TOKEN_MASK +
    '|\\b(?:visit|at|from|via)\\s+' +
    ARTIFACT_TOKEN_MASK,
  'gi',
);

const trailingReferenceScaffoldPattern =
  /\bfor\s+(?:more\s+)?(?:details?|information|reference)\b\s*(?=[.,;:!?]|$)/gi;

const maskGlobalPattern = new RegExp(ARTIFACT_TOKEN_MASK, 'g');

function finalizeMaskedReferenceSentence(sentence: string): string {
  if (!sentence.includes(ARTIFACT_TOKEN_MASK)) return sentence;
  const residual = sentence
    .replace(referenceLeadInPattern, ' ')
    .replace(maskGlobalPattern, ' ')
    .replace(trailingReferenceScaffoldPattern, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const meaningfulWords = (residual.match(/[A-Za-z]{2,}/g) || []).filter(
    (word) => !REFERENCE_SCAFFOLD_WORDS.has(word.toLowerCase()),
  ).length;
  return meaningfulWords >= 3 ? residual : '';
}

/**
 * Strip embedded bibliographic-reference artifacts - a bare http/www/domain URL,
 * or a raw PubMed/PMC/PMCID/PMID/DOI identifier - that a profile or publications
 * scrape left inside a description ("... available at
 * https://www.ncbi.nlm.nih.gov/.../PMC1234567/", "See PMC7654321 and PMID:
 * 33456789 for details"). These pointer tokens are indexed into
 * shortDescription/fullDescription and shown to students but describe no research
 * (#415). Tokens are masked before sentence tiling (a URL's internal dots would
 * otherwise shred the tiling into fragments), so a sentence whose research
 * substance survives token removal is kept with its "available at"/"see"/"more
 * at" lead-in and trailing "for details" scaffold repaired, while a sentence that
 * is nothing but a reference pointer collapses to empty and is dropped - mirroring
 * stripRedactionPlaceholders rather than emitting mangled copy. The domain arm is
 * guarded against `@` so a redacted-later email address is not clipped, and the
 * whole pass is a no-op when no artifact token is present so genuine prose is
 * untouched.
 */
export function stripBibliographicReferenceArtifacts(text: string): string {
  const value = String(text || '');
  if (!bibliographicArtifactDetectPattern.test(value)) return normalizeHygieneWhitespace(value);
  const masked = value.replace(bibliographicArtifactStripPattern, ARTIFACT_TOKEN_MASK);
  const kept = partitionSentencesForFiltering(masked)
    .map((sentence) => finalizeMaskedReferenceSentence(sentence.trim()))
    .filter((sentence) => sentence.length > 0);
  return normalizeHygieneWhitespace(kept.join(' '));
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
  /\b[Pp]hoto(?:graph)?(?:\s+[Cc]redits?)?\s*(?::|[Bb]y)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
];

export function stripCatalogChrome(text: string): string {
  let out = String(text || '');
  for (const pattern of CATALOG_CHROME_PATTERNS) out = out.replace(pattern, ' ');
  return normalizeHygieneWhitespace(out);
}

const staleMonthYearDeadlinePattern =
  /\bby\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(?:19|20)\d{2}\b\.?/gi;

const staleSeasonCycleAwardPattern =
  /\bthe\s+(?:Spring|Summer|Fall|Autumn|Winter)\s+(?:19|20)\d{2}\s+(?=[A-Z])/g;

/**
 * Deliberately narrower than a generic award-noun list: "Award"/"Prize"/
 * "Scholarship" are dominated by retrospective biography prose ("recipient of
 * the 2001 Leroy P. Steele Prize") where the year is a permanent historical
 * fact, not a call-to-apply cycle marker, so including them would wrongly
 * strip a real award year from a PI bio. "Fellowship"/"Program"/"Grant" are the
 * shape this class of defect actually takes (#1557).
 */
const staleNamedCycleAwardPattern =
  /\bthe\s+(?:19|20)\d{2}\s+(?=[A-Z][A-Za-z.'-]*(?:\s+(?:of|and|the)?\s*[A-Za-z.'-]+){0,10}\s+(?:Fellowship|Fellowships|Program|Programs|Grant|Grants)\b)/g;

const fellowshipPortalTimelineDumpPattern =
  /\bApply Eligibility Submission\b[\s\S]{0,400}?Program end date\b\s*/gi;

/**
 * Neutralize a fellowship/grant/program cycle's application prose that was
 * scraped with a specific past calendar date baked into otherwise-recurring
 * text, so the description does not keep asserting an expired cycle as live
 * every year it goes un-rescraped (#1557). Each pattern is deliberately keyed
 * to the syntactic shape of a *recurring opportunity* mention - a "by <Month>,
 * <year>" deadline clause, or "the <year>"/"the <Season> <year>" immediately
 * naming a Fellowship/Program/Grant/Award/Prize/Scholarship - so an unrelated
 * historical year in genuine research prose ("the 2020 pandemic", "founded in
 * 2019") is never touched. The Yale fellowship-portal timeline widget (Apply /
 * Eligibility / Submission tabs glued to an Application Status / open /
 * deadline / notification / program-date block with no separators) is stripped
 * as a unit rather than date-by-date, since the whole block restates one
 * already-elapsed cycle rather than a single stale phrase.
 */
export function evergreenizeStaleCycleDatePhrase(text: string): string {
  const value = String(text || '');
  if (!value) return value;
  const withoutTimelineDump = value.replace(fellowshipPortalTimelineDumpPattern, ' ');
  const withoutSeasonYear = withoutTimelineDump.replace(staleSeasonCycleAwardPattern, 'the ');
  const withoutNamedYear = withoutSeasonYear.replace(staleNamedCycleAwardPattern, 'the ');
  const withoutDeadlineYear = withoutNamedYear.replace(
    staleMonthYearDeadlinePattern,
    (_match, month: string) => `by ${month}.`,
  );
  return normalizeHygieneWhitespace(withoutDeadlineYear);
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

const directoryResearcherNavChromePattern =
  /\d{0,3}\s*(?:YSM|FAS|YSE|SOM|STEM|SEAS|WGSS)\s+Researchers?\s*View\s*\d*\s*Related\s+Publications?/gi;

/**
 * Strip a "<count> YSM Researchers View <count> Related Publications" widget
 * block that a profile-directory extractor glued between two topic terms with
 * no delimiter ("genomics50 YSM researchersView 18 related publicationsComputational
 * biology..."), the same source chrome `stripResearchAreaSourceChrome`
 * (#487) already splits out of the `researchAreas` array, reaching stale
 * description text that was materialized before that array-side fix (#1394).
 * Replacing the whole block with a single space keeps the surviving topic
 * terms readable, and the leftover space/punctuation seam is repaired.
 */
export function stripDirectoryResearcherNavChrome(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(directoryResearcherNavChromePattern, ' ');
  if (stripped === value) return value;
  return normalizeHygieneWhitespace(stripped.replace(/\s+([.,;:!?])/g, '$1'));
}

const gluedResearchRoleTrackTokenPattern =
  /(?<=[a-z])(?:Theorist|Experimentalist|Observational|Observer)(?=[A-Z])/g;

/**
 * Strip a physics/astronomy profile's "Research Type" role track
 * (Theorist/Experimentalist/Observational/Observer) that a legacy extractor
 * glued directly onto a topic term with no delimiter ("Condensed Matter
 * PhysicsTheoristQuantum criticality"), the same camelCase glue joint
 * `splitGluedRoleTrackLabels` (#943) already splits out of the researchAreas
 * array, reaching stale description text baked before that fix (#1394).
 * Anchored on the glued (no-space) letter boundary on both sides so a
 * legitimately spaced role track word in prose is untouched.
 */
export function stripGluedResearchRoleTrackToken(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(gluedResearchRoleTrackTokenPattern, ' ');
  if (stripped === value) return value;
  return normalizeHygieneWhitespace(stripped.replace(/\s+([.,;:!?])/g, '$1'));
}

const PROFILE_SECTION_LABEL_TOKENS = [
  'Titles?',
  'Biography',
  'Overview',
  'About',
  'Education\\s*&\\s*Training',
  'Specializations?',
];

const gluedProfileSectionLabelPattern = new RegExp(
  `(?:^|(?<=[a-zA-Z0-9)]))(?:${PROFILE_SECTION_LABEL_TOKENS.join('|')})(?=[A-Z])`,
  'g',
);

/**
 * Repair a profile-page section-header label ("Titles", "Biography",
 * "Overview", "About", "Education & Training", "Specializations") that a
 * whole-block DOM extraction glued directly onto the surrounding text with no
 * separator ("TitlesAssociate Professor...", "...Medicine)BiographyDavid
 * Fink, PhD..."), a residual of #808/#931/#1077 distinct from the labels
 * those covered (#1481). A label glued to the very start of the text is
 * simply dropped; one glued mid-string is replaced with a sentence break,
 * since it was standing in for the page's own paragraph break between two
 * unrelated blocks of prose. Anchored on the no-space boundary on both sides
 * so a legitimately spaced occurrence of these common words in prose is
 * untouched.
 */
export function stripGluedProfileSectionLabel(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(gluedProfileSectionLabelPattern, (match, offset: number) =>
    offset === 0 ? '' : '. ',
  );
  if (stripped === value) return value;
  return normalizeHygieneWhitespace(stripped.replace(/\.\s*\./g, '.'));
}

const citationAuthorInitialsListPattern = /(?:[A-Z][a-zA-Z'-]+\s+[A-Z]{1,3},\s*){3,}/;

/**
 * A raw citation author-initials list ("Choma MA, Suter MJ, Vakoc BJ, Bouma
 * BE, Tearney GJ") glued onto the end of a profile bio with no "Selected
 * Publications:" label to key off of (#1481, a citation-list sibling to
 * isPublicationsListDumpText's labeled case). The "Lastname INITIALS," shape
 * repeated three or more times in a row is a bibliographic-citation signature
 * that essentially never occurs in ordinary research prose.
 */
export function isCitationAuthorListDumpText(text: unknown): boolean {
  return citationAuthorInitialsListPattern.test(normalizeHygieneWhitespace(String(text || '')));
}

const doubledSynthesisVerbPattern =
  /^(Studies|Investigates|Examines|Explores|Develops|Supports|Advances|Fosters|Uses|Employs|Researches|Analyzes|Models|Measures|Conducts|Creates|Enhances|Improves|Innovates|Builds)\s+\1\b/i;

const SYNTHESIS_VERB_GERUNDS: Record<string, string> = {
  studies: 'studying',
  investigates: 'investigating',
  examines: 'examining',
  explores: 'exploring',
  develops: 'developing',
  supports: 'supporting',
  advances: 'advancing',
  fosters: 'fostering',
  uses: 'using',
  employs: 'employing',
  researches: 'researching',
  analyzes: 'analyzing',
  models: 'modeling',
  measures: 'measuring',
  conducts: 'conducting',
  creates: 'creating',
  enhances: 'enhancing',
  improves: 'improving',
  innovates: 'innovating',
  builds: 'building',
};

/**
 * Collapse a doubled leading synthesis verb that a stale materialization step
 * emitted by prepending its "Studies " template onto a value that already began
 * with the same verb. Two shapes are folded: an identical repeat ("Studies
 * Studies on ...", #975) and a verb followed by its own same-root gerund
 * ("Studies studying the mechanisms ...", #1248), where the template verb and
 * the source lead share a root so the `\1` backreference misses. Only the
 * immediately repeated/gerund-doubled leading verb is removed, and the gerund
 * arm is gated to the same-root pair so ordinary prose ("Studies exploring the
 * role of X") is untouched.
 */
export function collapseDoubledSynthesisVerb(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  const collapsed = value.replace(doubledSynthesisVerbPattern, '$1');
  if (collapsed !== value) return collapsed;
  const gerundMatch = collapsed.match(/^([A-Za-z]+)\s+([a-z]+)\b/);
  if (gerundMatch && SYNTHESIS_VERB_GERUNDS[gerundMatch[1].toLowerCase()] === gerundMatch[2]) {
    return normalizeHygieneWhitespace(gerundMatch[1] + collapsed.slice(gerundMatch[0].length));
  }
  return collapsed;
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
 * A "Studies <text>." synthesis template glued onto an honor/award citation
 * lifted from a CV bio ("Studies the Field Award" from the ASA Section on Asia
 * and Asian America.") - the extractor mid-sentence-spliced an accolade
 * mention into what reads as a research-topic clause (#1537). The quote mark
 * around the award title is treated as optional because the splice itself
 * frequently drops the opening quote, leaving only a stray closing one.
 */
const awardCitationLeakPattern =
  /\b(?:Award|Prize|Medal|Fellowship|Honor|Honour)[”"']?\s+from\s+the\s+[A-Z][\p{L}\s]{2,60}\b(?:Section|Association|Society|Committee|Foundation|Institute|Academy|Council|University|Union)\b/u;

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
    careerFactLeakPattern.test(normalized) ||
    awardCitationLeakPattern.test(normalized)
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

const leadingArtCommentaryPrefixPattern =
  /^[\p{L}][\p{L}'-]*(?:[- ][\p{L}][\p{L}'-]*){0,3}\s+(?:interpretation|depiction|portrayal|rendering|representation)\s+of\s+(?=[a-z])/u;

/**
 * Strip a leading artwork/exhibit-commentary clause ("Pop-surrealist
 * interpretation of appetite and body weight regulation...", #1506) glued onto
 * an otherwise valid research clause. Gated on the trailing "of" being
 * followed by a lowercase word so the remainder reads as the real topic
 * continuing mid-sentence, and re-capitalized so the surviving clause still
 * opens like a sentence.
 */
export function stripLeadingArtCommentaryPrefix(text: string): string {
  const value = normalizeHygieneWhitespace(String(text || ''));
  const stripped = value.replace(leadingArtCommentaryPrefixPattern, '');
  if (!stripped || stripped === value) return value;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
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

const leadingDanglingDemonstrativePattern =
  /^(?:These|Those|Such)\s+[A-Za-z]|^This\s+(?:is|was|were|are|has|had|will|would|includes?|represents?|remains?|also|too|means?)\b/;

/**
 * A card blurb whose subject is a bare third-person pronoun ("He earned an MS
 * in...", "She holds a joint appointment...") or a transitional adverbial
 * ("In addition, he...") introducing one, with no name ever established on the
 * standalone card (#1400/#1506). The reader has no antecedent for "he"/"she"/
 * "they" on a card shown out of context, so this fails closed the same way a
 * dangling demonstrative does, whatever the sentence's own content quality.
 */
const leadingDanglingPronounSubjectPattern =
  /^(?:He|She|They)\s+(?:is|are|was|were|has|had|earned|received|holds?|held|completed|joined|serves?|served|graduated|obtained|remains?|studies|studied|investigates?|examines?|explores?|develops?|works?|focuses?|focused|specializes?|specialized)\b/;
const leadingTransitionalPronounSubjectPattern =
  /^(?:In addition|Additionally|Also|Moreover|Furthermore),?\s+(?:he|she|they)\b/i;

const midDemonstrativePhrasePattern =
  /\b(?:these|those)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)/gi;

const synthesisBlurbLeadPattern =
  /^(?:Studies|Investigates|Examines|Explores|Develops|Supports|Advances|Fosters|Uses|Employs|Researches|Analyzes|Models|Measures|Conducts|Creates|Enhances|Improves|Innovates|Builds)\s+(?!(?:in|of|on|for|to|with|from|at|by|about|have|has|had|are|were|is|was|and|or)\b)[a-z]/i;

const relativeOrPrepAfterDemonstrativePattern =
  /^(?:who|whom|whose|which|that|with|of|from|in|to|at|by|as)\b/i;

const leadingBareSubjectPronounPattern = /^(?:He|She|Him|Her|His|Their)\b/;

const leadingCareerHistoryOpenerPattern =
  /^(?:Prior to|Following|After|In addition)\b[^.]*?,\s*(?:he|she|him|her|his|their|dr\.\s+[A-Z])/i;

const leadingDoctorDegreeOpenerPattern =
  /^Dr\.\s+[A-Z][a-z]+\s+(?:received|earned|completed|obtained|graduated)\b/;

function startsMidSentenceLowercase(text: string): boolean {
  const firstToken = text.split(/\s+/)[0] || '';
  if (!/^[a-z]/.test(firstToken)) return false;
  return !/[A-Z]/.test(firstToken);
}

/**
 * A synthesized "Studies ..." blurb (no explicit subject) that carries a
 * `these`/`those <noun>` demonstrative whose referent noun is absent from the
 * blurb itself: the synthesis lifted a source sentence that pointed back at a
 * paragraph that never made it into the summary ("Investigates processes that
 * represent each of these major categories.", "Studies these questions using
 * ..."). Gated on a synthesis-verb lead whose verb takes a direct object (not a
 * preposition/auxiliary, so a plural-noun lead such as "Advances in imaging
 * have ..." or a full sentence with its own subject "Nisheeth Vishnoi's research
 * focuses on ... how these systems ..." is never flagged), and a `these/those`
 * followed by a relative/preposition ("those with", "those who") is skipped. A
 * demonstrative whose noun-phrase shares a 4-char stem with earlier text is
 * treated as resolved and kept.
 */
function synthesisBlurbHasDanglingDemonstrative(text: string): boolean {
  if (!synthesisBlurbLeadPattern.test(text)) return false;
  for (const match of text.matchAll(midDemonstrativePhrasePattern)) {
    const phrase = match[1];
    if (relativeOrPrepAfterDemonstrativePattern.test(phrase)) continue;
    const contentWords = (phrase.match(/[a-z]{4,}/gi) || []).map((word) => word.toLowerCase());
    if (contentWords.length === 0) continue;
    const before = text.slice(0, match.index).toLowerCase();
    const hasAntecedent = contentWords.some((word) => before.includes(word.slice(0, 4)));
    if (!hasAntecedent) return true;
  }
  return false;
}

/**
 * A card blurb / shortDescription that does not stand on its own as a sentence:
 * it begins mid-clause with a lowercase word (a truncated lead such as the
 * dropped "C." of "C. elegans", leaving "elegans for these studies ..."), opens
 * with an unresolved leading demonstrative ("These process are ...", "This is
 * particularly important ..."), is a synthesis blurb whose `these/those`
 * demonstrative has no antecedent in the blurb (#1248), opens with a bare
 * third-person subject pronoun whose antecedent is never named ("His research
 * is ...", "She is interested in ..." - the card title is often a lab name, so
 * the pronoun has nothing to resolve to), or opens with a CV/biography-history
 * clause lifted from a faculty bio rather than a research summary ("Prior to
 * arriving at Yale, Dr. Ma was ...", "Dr. Seo received a Ph.D. ...") (#1400).
 * Rendered verbatim on the student browse card, such a summary references
 * something never introduced, so it is failed closed rather than shown. A
 * leading lowercase token that carries an internal capital (a scientific token
 * like "mRNA"/"iPSC") is exempt.
 */
export function isNonSelfContainedShortDescription(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (startsMidSentenceLowercase(normalized)) return true;
  if (leadingDanglingDemonstrativePattern.test(normalized)) return true;
  if (leadingBareSubjectPronounPattern.test(normalized)) return true;
  if (leadingCareerHistoryOpenerPattern.test(normalized)) return true;
  if (leadingDoctorDegreeOpenerPattern.test(normalized)) return true;
  if (leadingDanglingPronounSubjectPattern.test(normalized)) return true;
  if (leadingTransitionalPronounSubjectPattern.test(normalized)) return true;
  return synthesisBlurbHasDanglingDemonstrative(normalized);
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
      stripTrailingSourceLayoutLabelSection(
        stripGluedProfileSectionLabel(
          stripGluedResearchRoleTrackToken(
            stripDirectoryResearcherNavChrome(
              stripGluedProfileRoleLabel(
                stripLeadingArtCommentaryPrefix(
                  stripLeadingPageChrome(
                    stripTrailingContactAddress(
                      stripBibliographicReferenceArtifacts(
                        stripInternalConfidenceHedge(
                          stripCatalogChrome(
                            evergreenizeStaleCycleDatePhrase(redactDirectContactInfo(String(text || ''))),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  if (isResearchAreaTemplateLeakText(cleaned)) return '';
  if (isResearchAreaEchoDescription(cleaned)) return '';
  if (isInstitutionalCenterBlurbText(cleaned)) return '';
  if (isCtaNewsTickerDumpText(cleaned)) return '';
  if (isStudiesTemplateGlueMalformed(cleaned)) return '';
  if (isFirstPersonResearchVoiceText(cleaned)) return '';
  if (isNonSelfContainedShortDescription(cleaned)) return '';
  if (containsHtmlTagMarkup(cleaned)) return '';
  if (isCitationAuthorListDumpText(cleaned)) return '';
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
 * sentence-gated arms miss. The name-density arm additionally requires the text
 * to be dominated by capitalized tokens (#1200) so a single-person award/bio
 * whose prizes, institutions, and book titles produce capitalized word-pairs
 * embedded in mostly-lowercase prose is not mistaken for a bare list of names.
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
  const words = normalized.split(/\s+/).filter(Boolean);
  const capitalizedWordRatio = words.length
    ? words.filter((word) => /^[A-Z]/.test(word)).length / words.length
    : 0;
  if (uniqueNames >= 8 && isSentenceSparse && capitalizedWordRatio >= 0.7) return true;
  const contactInvitations = countMatches(normalized, contactInvitationPattern);
  return contactInvitations >= 2 && uniqueNames >= 8;
}

/**
 * A navigation/menu dump: a long run of capitalized menu labels with no real
 * sentences. Gated so short blurbs and ordinary multi-sentence prose pass.
 *
 * Also requires near-zero internal punctuation: scraped menu chrome is a run
 * of bare labels joined by whitespace only, since it was never a sentence. A
 * sentence-sparse single-person bio that lists several book/prize titles with
 * semicolons and parentheses can otherwise clear the capitalized-word
 * threshold on its title-case titles alone while remaining ordinary prose.
 */
export function isNavigationDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 40) return false;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  if (sentenceEnders > 2) return false;
  const internalPunctuation = countMatches(normalized, /[,;:()]/g);
  if (internalPunctuation > 1) return false;
  const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalized / words.length > 0.4;
}

const interrogativeQuestionPattern =
  /(?:^|[.!?]\s|\bFAQs?\b\s*|\bFrequently Asked Questions\b\s*)(?:can|could|do|does|did|how|what|when|where|which|who|whose|why|is|are|will|would|should|may|must|have|has)\b[^.?!]{0,200}\?/gi;

const faqMarkerPattern = /\bfrequently asked questions\b|\bfaqs?\b/i;

const FAQ_DUMP_QUESTION_SENTENCE_RATIO = 0.4;

/**
 * An FAQ / Q&A page dump: a scraped page body whose "prose" is actually a run
 * of question-and-answer pairs. FAQ questions terminate in "?", so they defeat
 * isNavigationDumpText (which bails on real sentence enders); this arm catches
 * them instead. The marker-less question arms are additionally gated on the
 * question-to-sentence ratio: a Q&A dump is *mostly* questions regardless of
 * its length, while genuine research prose can pose several rhetorical
 * questions among many declarative sentences without becoming a dump (#1527).
 * The explicit `faqMarkerPattern` arm is left ungated since an actual "FAQ" /
 * "Frequently Asked Questions" marker is unambiguous on its own.
 */
export function isFaqDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  const questionMarks = countMatches(normalized, /\?/g);
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  const questionRatio = sentenceEnders > 0 ? questionMarks / sentenceEnders : 0;
  const isQuestionDominated = questionRatio >= FAQ_DUMP_QUESTION_SENTENCE_RATIO;
  if (questionMarks >= 3 && isQuestionDominated) return true;
  if (countMatches(normalized, interrogativeQuestionPattern) >= 2 && isQuestionDominated) {
    return true;
  }
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
  /\buntil a (?:[\w-]+\s+){0,3}(?:award|fellowship|program|funding|source) page is attached\b/i,
  /\b(?:keep|kept|keeps|keeping|stay|stays|staying|remain|remains|remaining)\s+restrained\b/i,
  /\bthis (?:record|row|entry|listing) should\b/i,
  /\bclear student audience\b/i,
  /\b(?:should|must)\s+be\s+(?:shown|displayed|surfaced|rendered)\s+as\b/i,
  /\b(?:should|must)\s+be\s+(?:presented|treated|framed|positioned|described)\s+as\b[^.!?]{0,120}?\b(?:rather than|not as|instead of)\b/i,
];

/**
 * Internal curation / reviewer-rationale prose: an LLM or operator suitability
 * assessment written *about the record* ("is source-backed", "safe to show
 * prominently", "operators should refresh", a "keep/stay/remain restrained
 * until ... page is attached" restraint directive, a record-referential "this
 * record/row should ..." instruction, or a display-routing directive "it should
 * be shown as funding/project support rather than a research home" / "it should
 * be presented as residential-college funding ... not as a general research
 * placement") instead of a student-facing description of the program. These
 * phrases are internal review vocabulary that never appears in genuine source
 * prose, so a single marker is enough to fail closed (#671, #1053).
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

const terminalPunctuationTailPattern = /[.!?]["'’)\]]?$/;

export const MID_SENTENCE_TRUNCATION_MIN_LENGTH = 1500;

/**
 * Repair a stored description that a legacy producer hard-cut mid-sentence,
 * leaving a dangling fragment with no terminal punctuation ("...Projects may",
 * "...STARS II H", #671/#1240). A well-formed description ends on terminal
 * punctuation, so a value that does not is treated as truncated: when a
 * complete sentence already covers most of the text (>= 60%) it is trimmed back
 * to that last sentence boundary. Applied at read time so already-stored cut
 * records are repaired on every serve without a backfill.
 *
 * This sentence-boundary trim runs regardless of length so that the many
 * confirmed sub-cap cuts (a faculty/roster slice hard-cut well under 2000
 * chars, #1240) are repaired, not only the full 2000-char-cap cuts. When no
 * complete sentence covers the leading text there is nothing safe to trim to,
 * so the trailing partial word is dropped with an ellipsis only for a value
 * long enough to be a confirmed length-cap cut; a shorter value with no
 * sentence structure (a curated one-liner, or a CV/role-list remnant that
 * genuinely needs a rescrape rather than a trim) is left untouched rather than
 * have a misleading ellipsis fabricated onto it. A no-op for any value that
 * already ends on terminal punctuation.
 */
export function repairMidSentenceTruncation(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  if (!value || terminalPunctuationTailPattern.test(value)) return value;
  const sentenceEnd = lastSentenceBoundary(value);
  if (sentenceEnd >= value.length * 0.6) return value.slice(0, sentenceEnd).trim();
  if (value.length < MID_SENTENCE_TRUNCATION_MIN_LENGTH) return value;
  const lastSpace = value.lastIndexOf(' ');
  const cut = lastSpace > 0 ? value.slice(0, lastSpace) : value;
  return `${cut.trim()}…`;
}

const contactRedactionTokenPattern = /\[(?:email|phone) redacted\]/i;
const contactBlockLabelPattern = /\b(?:email|phone|office|fax)\s*:/i;
const bareLocalPhonePattern = /\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]\d{4}\b/;

const clinicalTrialHicOrProtocolIdPattern =
  /\bHIC\b\s*:?\s*(?:\d{5,}|\[phone redacted\])|\bprotocol\s*(?:#|no\.?|number)?\s*:?\s*(?:\d{4,}|\[phone redacted\])/i;
const clinicalTrialEligibilityCriteriaPattern =
  /\beligib(?:le|ility)\b|\binclusion criteria\b|\bexclusion criteria\b|\bages?\s+\d{1,2}\s+to\s+\d{1,2}\b|\b\d{1,2}\s+to\s+\d{1,2}\s+years?\s+(?:of\s+)?(?:age|old)\b/i;

/**
 * A clinical-trial recruitment flyer (eligibility bullets plus an HIC/
 * protocol ID) scraped into a lab's fullDescription instead of a description
 * of the lab's own research (#1526). A flyer's phone number is redacted to
 * `[phone redacted]` upstream of this check (and the bare HIC/protocol digits
 * frequently get swept into the same redaction), so the HIC/protocol signal
 * matches either the raw digits or that redacted token, not a bare phone
 * pattern. Requires both signals together so ordinary research prose that
 * merely mentions a study's age range is not blanked.
 */
export function isClinicalTrialRecruitmentFlyerText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return (
    clinicalTrialHicOrProtocolIdPattern.test(normalized) &&
    clinicalTrialEligibilityCriteriaPattern.test(normalized)
  );
}

const patientCareMarketingPhrasePattern =
  /\bwellness journey\b|\bcompassionate,?\s+(?:science-driven,?\s+)?dedicated\s+lifelong\s+care\b|\bcompassionate care\b/i;
const patientCareSecondPersonAddressPattern =
  /\b(?:support and guide you|guide you (?:on|through)|for you and your family)\b/i;

/**
 * Patient-care marketing copy (a clinic's "your wellness journey" pitch to
 * patients) scraped into a lab's fullDescription instead of a research
 * description (#1526). Requires both the marketing phrase and a direct
 * second-person address to a patient, a combination that does not occur in
 * genuine research prose.
 */
export function isPatientCareMarketingCopyText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return (
    patientCareMarketingPhrasePattern.test(normalized) &&
    patientCareSecondPersonAddressPattern.test(normalized)
  );
}

const STREET_SUFFIX_WORD = 'Street|Avenue|Road|Boulevard|Drive|Way|Lane|Place|Court|Circle';
const STREET_SUFFIX_ABBREVIATION = 'St|Ave|Rd|Blvd|Dr|Ln|Pl|Ct|Cir';
const OFFICE_UNIT_LABEL = 'Floor|Fl|Room|Rm|Suite|Ste';

/**
 * A bare street-address fragment (`266 Whitney Avenue`), optionally followed by
 * a floor/room/suite unit (`, Fl 2, Rm 234`), with no `office:`/`address:` label
 * of its own. Faculty-bio scrapes sometimes merge a page's office-location line
 * straight into the bio prose with no separating punctuation, so this must be
 * detected on shape alone (#798). The trailing `(?!\s+[a-z])` guard stops the
 * match from firing when the street-suffix word runs on into lowercase prose
 * ("100 Milky Way analogs", "40 Prospect Street galaxies"): a real glued
 * address ends at a boundary, a comma/unit, or a capitalized city, never a
 * lowercase common noun, so genuine research prose that merely reads like an
 * address is no longer blanked.
 */
const bareStreetAddressPattern = new RegExp(
  `\\b\\d{1,5}\\s+[A-Z][A-Za-z']*(?:\\s+[A-Z][A-Za-z']*){0,3}\\s+` +
    `(?:(?:${STREET_SUFFIX_WORD})\\b|(?:${STREET_SUFFIX_ABBREVIATION})\\.)` +
    `(?:[.,]?\\s*(?:${OFFICE_UNIT_LABEL})\\.?\\s*\\d+[A-Za-z]?)*` +
    `(?!\\s+[a-z])`,
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

const trailingSourceLayoutLabelSectionPattern =
  /([.!?]["'’)\]]?)\s+(?:Key\s+areas?\s+of\s+interest|Areas?\s+of\s+interest|Areas?\s+of\s+focus|Disease\s+models|Research\s+focus)\s*:\s*\S[\s\S]*$/i;

/**
 * Strip a trailing source-page layout-label section ("Key areas of interest:
 * ...", "Disease models: ...", "Areas of focus: ...") that a faculty-profile
 * scrape appended after the bio prose, keeping the prose ahead of it. The label
 * must begin a fresh clause right after a sentence boundary and carry a colon,
 * which is the tell of a bare layout label lifted verbatim from the page rather
 * than a research clause ("...cardiovascular diseases. Key areas of interest:
 * Vascular smooth muscle; ... Epigenetics Disease models: Atherosclerosis...",
 * #1249). The colon list is redundant with the researchArea chips shown beside
 * it, and cutting it also drops the missing-boundary run that follows it. Only a
 * trailing, sentence-initial label section is removed so a mid-prose mention or
 * an inline "our key areas of interest include ..." clause is left intact; a
 * no-op when no such section is present.
 */
export function stripTrailingSourceLayoutLabelSection(text: string): string {
  const value = normalizeHygieneWhitespace(text);
  if (!value) return value;
  const stripped = value.replace(trailingSourceLayoutLabelSectionPattern, '$1');
  return stripped === value ? value : normalizeHygieneWhitespace(stripped);
}

const poBoxAddressPattern = /\bP\.?\s*O\.?\s+Box\s+\d+\b/i;

const cityStateZipPattern = /,\s*[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,2}\s+\d{5}(?:-\d{4})?\b/;

const staffContactCredentialPattern =
  /\b(?:Ph|Ed|D)\.?\s?D\.?|\bM\.?\s?D\.?|\bJ\.?\s?D\.?|\bM\.?\s?B\.?\s?A\.?|\bM\.?\s?S\.?\s?W\.?/;

const namedStaffTitlePattern =
  /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3},?\s+(?:(?:Assistant|Associate|Deputy|Senior|Executive|Program)\s+)?(?:Director|Coordinator|Administrator|Manager|Registrar|Dean|Officer)\b/;

/**
 * A staff contact block scraped in place of a program description: a named
 * person with an academic credential ("Ph.D.") or a staff title ("Assistant
 * Director", "Program Coordinator") glued onto a mailing address (a `P.O. Box`
 * or a city/state/ZIP), carrying nothing about what the program funds or who is
 * eligible (#926). `hasContactBlockResidue` misses this because its address arm
 * requires a street-suffix line, not a `P.O. Box`, and the roster/dump arms key
 * on lists, not a single-person contact line.
 *
 * Both a full mailing address and a person-contact signal are required so an
 * ordinary description that merely names a director, or an application step that
 * cites a mailing address for submissions, is not blanked - only the contact
 * block that carries both at once fails closed.
 */
export function isStaffContactBlockText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  const hasMailingAddress =
    poBoxAddressPattern.test(normalized) || cityStateZipPattern.test(normalized);
  if (!hasMailingAddress) return false;
  return (
    staffContactCredentialPattern.test(normalized) || namedStaffTitlePattern.test(normalized)
  );
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
const connectedToAreaEchoPattern = /^[^.!?]*\bis\s+connected\s+to\b[^.!?]*[.!?]?$/i;

const researchActivitySignalPattern =
  /\b(?:focus(?:es|ed|ing)?\s+on|studies|study|studying|investigat(?:es|ed|ing|ion|ions)?|examin(?:es|ed|ing)|explor(?:es|ed|ing|ation)?|develop(?:s|ed|ing|ment|ments)?|design(?:s|ed|ing)?|analyz(?:es|ed|ing)|model(?:s|ed|ing)?|measur(?:es|ed|ing|ement)?|specializ(?:es|ed|ing)|dedicated\s+to|interested\s+in|work(?:s|ing)?\s+on|aims?\s+to|seeks?\s+to|advanc(?:es|ed|ing)|our\s+(?:research|work|lab)|we\s+(?:study|develop|investigate|build|design|explore|examine|focus|research|use|create|model))\b/i;

/**
 * A research-activity verb ("studies", "develops", "investigates", ...)
 * acting on a following object, as opposed to the same word appearing bare as
 * the tail of a keyword-list item ("...and diet and metabolism studies.",
 * "...during development."). `researchActivitySignalPattern` matches either
 * shape, which made the "is connected to <chips>" echo check below miss the
 * #1393 keyword-list-fallback template whenever a chip label happened to end
 * in one of these words as a noun (#1511) - the negative lookahead here
 * requires a real following object (not a list delimiter or sentence end) so
 * only a genuine verb clause disqualifies the echo match.
 */
const researchActivityVerbWithObjectPattern = new RegExp(
  `${researchActivitySignalPattern.source}(?!\\s*(?:,|and\\b|including\\b|[.!?]|$))`,
  'i',
);

/**
 * A vacuous "Research fields include <A>, <B>, and <C>." description whose only
 * content is a comma-join of the entity's own researchAreas: a bare labeled
 * chip list carrying no prose, fully redundant with the chips already shown
 * beside it (#623). Gated to a single sentence (the pattern admits no internal
 * sentence terminator) so genuine prose that merely opens with the phrase and
 * continues into a real description is kept. The sibling "<Name/lab> is
 * connected to <A>, <B>, and <C>." fallback template is the same vacuous shape
 * under a different lead verb, so it is caught here too, but only when the
 * sentence carries no independent research-activity verb acting on an object -
 * a genuine one-line summary that happens to use "connected to" as connective
 * tissue around real content is kept (#1393/#1394).
 */
export function isResearchAreaEchoDescription(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (researchAreaEchoPattern.test(normalized)) return true;
  return isConnectedToKeywordListStub(normalized);
}

/**
 * The "<EntityName/Lab/Center/...> is connected to <A>, <B>, and <C>."
 * keyword-list-fallback stub (#1393 family), shared between the serve-time
 * echo detector above and `isTemplatedKeywordStub`
 * (`backfillDescriptionQualityCore.ts`) so the quality classifier and the
 * serve gate agree (#1511).
 */
export function isConnectedToKeywordListStub(text: unknown): boolean {
  const normalized = normalizeHygieneWhitespace(String(text ?? ''));
  if (!normalized) return false;
  return (
    connectedToAreaEchoPattern.test(normalized) &&
    !researchActivityVerbWithObjectPattern.test(normalized)
  );
}

const studiesLeadSingleSentencePattern = new RegExp(
  `${synthesisVerbLeadPattern.source}\\s+[^.!?]+[.!?]?$`,
  'i',
);

const areaListDelimiterPattern = /^(?:,\s*(?:and\s+)?|\s+and\s+|,?\s*including\s+)/i;

/**
 * The sibling of `isResearchAreaEchoDescription` for the "Studies <A>, <B>,
 * and <C>." template (`buildResearchAreasCardSummary`): a bare synthesis-verb
 * lead is not itself a reliable tell, since genuine one-line research-focus
 * prose uses the same verbs (#867), so this only fires when the text after
 * the lead verb can be fully consumed as a plain oxford-joined list of the
 * entity's own `researchAreas`/`profileResearchAreas` chips - i.e. the
 * sentence carries no content beyond the chips already shown beside it
 * (#1466). Matching is greedy-longest-chip-first (not a naive comma/"and"
 * split) so a chip whose own label contains "and" ("Paleontology and
 * Evolutionary Biology") is consumed whole rather than fragmented. Requires
 * the caller to supply the entity's area list; with none supplied this
 * returns false so existing callers of the text-only
 * `isResearchAreaEchoDescription` are unaffected.
 */
export function isStudiesResearchAreaEchoDescription(
  text: string,
  researchAreas: readonly unknown[] | null | undefined,
): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (!Array.isArray(researchAreas) || researchAreas.length === 0) return false;
  if (!studiesLeadSingleSentencePattern.test(normalized)) return false;
  const body = normalized
    .replace(synthesisVerbLeadPattern, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!body) return false;
  const areaKeys = researchAreas
    .map((area) => (typeof area === 'string' ? area.trim().toLowerCase() : ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (areaKeys.length === 0) return false;

  let remaining = body.toLowerCase();
  let matchedAny = false;
  while (remaining.length > 0) {
    const delimiterMatch = remaining.match(areaListDelimiterPattern);
    if (delimiterMatch) {
      remaining = remaining.slice(delimiterMatch[0].length);
      continue;
    }
    const areaMatch = areaKeys.find((key) => remaining.startsWith(key));
    if (!areaMatch) return false;
    remaining = remaining.slice(areaMatch.length);
    matchedAny = true;
  }
  return matchedAny;
}

const provenanceHedgePattern = /[,;]?\s*\bwhen\s+source-confirmed\b/gi;
const internalConfidenceHedgePattern =
  /\s*This profile-derived summary should be checked against the linked official sources before outreach\.?/gi;

/**
 * Strip the internal QA caveat "This profile-derived summary should be
 * checked against the linked official sources before outreach." An operator-
 * facing confidence note about the record itself, not display copy, so as
 * rendered it undermines the very card it sits on and tells a student the
 * text may be wrong (#1393/#1394). Removing only the hedge keeps any genuine
 * prose it was appended to rather than failing the whole field closed.
 */
export function stripInternalConfidenceHedge(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(internalConfidenceHedgePattern, '');
  if (stripped === value) return value;
  return normalizeHygieneWhitespace(stripped.replace(/\s+([.,;:!?])/g, '$1'));
}

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
 * label dump, internal curation/reviewer-rationale prose, a staff-contact /
 * mailing-address block, or a homepage news-ticker / CTA dump. Surviving prose
 * is finally passed through repairMidSentenceTruncation so a stored record that
 * a legacy producer hard-cut mid-sentence at its length cap is trimmed to a
 * clean sentence boundary at read time rather than served cut mid-word (#671).
 *
 * Redaction placeholder tokens ([email redacted]/[phone redacted]) are the
 * intended safe rendering of contact info at read time and are left in place
 * here; stored prose that reads awkwardly around a token is cleaned at rest by
 * stripRedactionPlaceholders in the #671 backfill.
 */
export function sanitizeCatalogDescription(text: string): string {
  const stripped = stripInternalConfidenceHedge(
    stripProvenanceHedge(
      collapseRepeatedSentences(
        collapseDuplicatedProseBlock(
          stripPageLayoutReferentialSentences(
            stripDanglingSourceSiteReferenceSentences(
              stripSelfReferentialResearchCtaSentences(
                stripDeadAnchorCtaSentences(
                  stripBibliographicReferenceArtifacts(
                    stripCatalogChrome(evergreenizeStaleCycleDatePhrase(text)),
                  ),
                ),
              ),
            ),
          ),
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
    isStaffContactBlockText(stripped) ||
    isCtaNewsTickerDumpText(stripped)
  ) {
    return '';
  }
  return repairMidSentenceTruncation(stripped);
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
    stripTrailingSourceLayoutLabelSection(
      stripGluedProfileSectionLabel(
        stripGluedResearchRoleTrackToken(
          stripDirectoryResearcherNavChrome(
            stripGluedProfileRoleLabel(
              stripTrailingContactAddress(sanitizeCatalogDescription(redacted)),
            ),
          ),
        ),
      ),
    ),
  );
  if (!stripped) return '';
  if (
    hasContactBlockResidue(stripped) ||
    isPublicationsListDumpText(stripped) ||
    isCitationAuthorListDumpText(stripped) ||
    isResearchAreaEchoDescription(stripped) ||
    isInstitutionalCenterBlurbText(stripped) ||
    containsHtmlTagMarkup(stripped) ||
    isClinicalTrialRecruitmentFlyerText(stripped) ||
    isPatientCareMarketingCopyText(stripped)
  ) {
    return '';
  }
  return clampDescriptionLength(stripped, maxLength);
}
