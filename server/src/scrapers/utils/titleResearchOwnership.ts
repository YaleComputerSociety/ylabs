/**
 * Does a stated title claim research of its own?
 *
 * The question already has three keyword predicates in `sources/yaleDirectoryScraper.ts`
 * (`isFacultyTitle`, `isSubordinateResearchRank`, `isResearchSupportStaffTitle`), and they
 * answer the mint-side question well: may this profile mint an entity. They are the wrong
 * shape for the retirement-side question, because `FACULTY_KEYWORDS` deliberately contains
 * `postdoctoral`, `research associate` and `research scientist` - those people ARE
 * researchers - so a faculty-keyword test and a subordinate-rank test disagree about the
 * trainee class by construction.
 *
 * #3410 tried four ways to reconcile them and each had a counterexample in the stored
 * corpus. This module is the fifth shape, and it differs by not being a keyword set:
 *
 * - every rank is a PHRASE with an explicit verdict, so `postdoctoral` is a rank that owns
 *   nothing rather than a faculty keyword;
 * - a match is a SPAN found anywhere in the title, so no clause splitting is needed and a
 *   conjoined appointment keeps its reading;
 * - the LONGEST span wins an overlap, so `associate research scientist` beats
 *   `research scientist` without either pattern knowing about the other;
 * - both spellings of a rank live in one pattern, so no verdict turns on whether a second
 *   vocabulary happens to spell it the same way.
 *
 * `__tests__/titleResearchOwnership.test.ts` pins one case per historical counterexample.
 *
 * NOT THE HOSTABILITY QUESTION, and this is the more important caveat. Whether a row
 * describes a way in for a student is owned by `utils/traineeLevelTitle.ts` and
 * `hasStrongLead`: a postdoc cannot admit an undergraduate, so a row led only by one is
 * demoted to `missing_lead` (#2876/#2877). This module answers the narrower question of
 * what a title claims about its own rank, and it is deliberately WIDER: it reads an
 * associate research scientist, a clinical fellow and a postgraduate associate as working
 * in another group, and it disagrees with `isTraineeLevelTitle` on 59 of 103 rows.
 * Measured on Development, 38 of the 39 served rows in that population carry a non-trainee
 * lead, so they describe a real access route and are not defects. Never archive on this
 * verdict alone (#3576).
 *
 * KNOWN LIMIT, measured rather than assumed. A title names ranks; it does not say whose
 * rank each one is. Of the 325 distinct stored titles this module reads as owning nothing,
 * five name a rank as the population somebody SERVES - "Senior Associate Director, Graduate
 * Student and Postdoctoral Career Services" is not a postdoc. `namesARankItServesRatherThanHolds`
 * reports those rather than silently reclassifying them, because a rule for them would be
 * the sixth string heuristic in this family and the first five each broke on first contact
 * with the corpus. So: this module is sound as an audit and as one of two witnesses, and it
 * is NOT sufficient alone for an irreversible archive (#3576).
 */
import { stripInvisibleFormatCharacters } from '../../utils/invisibleFormatCharacters';

export type TitleRankVerdict = 'owns_research' | 'works_in_another_group';

export type TitleResearchOwnership = 'owns_research' | 'works_in_another_group' | 'states_no_rank';

interface RankPattern {
  readonly pattern: RegExp;
  readonly verdict: TitleRankVerdict;
}

/**
 * Order is irrelevant: overlaps are resolved by span length, not by position in this list.
 * That is the point of the lattice, so a rank added here cannot silently shadow another.
 */
const RANK_PATTERNS: readonly RankPattern[] = [
  { pattern: /\bassociate research scientist\b/i, verdict: 'works_in_another_group' },
  { pattern: /\bsenior research scientist\b/i, verdict: 'owns_research' },
  { pattern: /\bresearch scientist\b/i, verdict: 'owns_research' },
  { pattern: /\bprofessor\b/i, verdict: 'owns_research' },
  { pattern: /\b(?:senior )?lect(?:urer|or)\b/i, verdict: 'owns_research' },
  { pattern: /\binstructor\b/i, verdict: 'owns_research' },
  { pattern: /\b(?:dean|provost)\b/i, verdict: 'owns_research' },
  { pattern: /\bchair\b/i, verdict: 'owns_research' },
  { pattern: /\bemerit(?:us|a|i)\b/i, verdict: 'owns_research' },
  { pattern: /\bpost-?doc(?:toral)?\b/i, verdict: 'works_in_another_group' },
  {
    pattern: /\bpostgraduate (?:associate|fellow|researcher)\b/i,
    verdict: 'works_in_another_group',
  },
  {
    pattern: /\bresearch (?:associate|fellow|assistant|affiliate|aide)\b/i,
    verdict: 'works_in_another_group',
  },
  { pattern: /\bstaff affiliate\b/i, verdict: 'works_in_another_group' },
  {
    pattern: /\bvisiting (?:scholar|fellow|researcher|student|assistant)\b/i,
    verdict: 'works_in_another_group',
  },
  {
    pattern: /\b(?:graduate|doctoral|phd|medical|undergraduate) student\b/i,
    verdict: 'works_in_another_group',
  },
  { pattern: /\bstudent researcher\b/i, verdict: 'works_in_another_group' },
  { pattern: /\btrainee\b/i, verdict: 'works_in_another_group' },
  { pattern: /\bclinical fellow\b/i, verdict: 'works_in_another_group' },
  { pattern: /\b(?:resident|intern)\b/i, verdict: 'works_in_another_group' },
];

export interface TitleRankSpan {
  readonly start: number;
  readonly length: number;
  readonly text: string;
  readonly verdict: TitleRankVerdict;
}

const globalCopyOf = (pattern: RegExp): RegExp =>
  new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

const encloses = (outer: TitleRankSpan, inner: TitleRankSpan): boolean =>
  outer.start <= inner.start && outer.start + outer.length >= inner.start + inner.length;

/**
 * Every rank the title names, with the spans a longer match swallows removed. A caller that
 * wants to explain a verdict reads this rather than re-deriving it.
 */
export function titleRankSpans(title: string | undefined | null): TitleRankSpan[] {
  const clean = title ? stripInvisibleFormatCharacters(String(title)) : '';
  if (!clean.trim()) return [];

  const found: TitleRankSpan[] = [];
  for (const { pattern, verdict } of RANK_PATTERNS) {
    const scanner = globalCopyOf(pattern);
    let match = scanner.exec(clean);
    while (match !== null) {
      found.push({ start: match.index, length: match[0].length, text: match[0], verdict });
      if (match.index === scanner.lastIndex) scanner.lastIndex += 1;
      match = scanner.exec(clean);
    }
  }

  return found
    .filter(
      (span) =>
        !found.some(
          (other) => other !== span && encloses(other, span) && other.length > span.length,
        ),
    )
    .sort((a, b) => a.start - b.start);
}

/**
 * `states_no_rank` is a third answer on purpose, and it is the most common one: 1,103 of the
 * 5,574 distinct stored titles name no rank at all. Silence is not a claim that the person
 * owns nothing, so a caller must not fold it into `works_in_another_group`.
 */
export function titleResearchOwnership(title: string | undefined | null): TitleResearchOwnership {
  const spans = titleRankSpans(title);
  if (spans.length === 0) return 'states_no_rank';
  return spans.some((span) => span.verdict === 'owns_research')
    ? 'owns_research'
    : 'works_in_another_group';
}

export const titleOwnsResearch = (title: string | undefined | null): boolean =>
  titleResearchOwnership(title) === 'owns_research';

/**
 * An administrative role whose title names a rank as the population it serves rather than as
 * the holder's own rank. Reported, never acted on: see this module's KNOWN LIMIT.
 */
const ADMINISTRATIVE_RANK_OBJECT =
  /\b(?:director|dean|chair|chief|head|manager|coordinator)\b[^;]{0,60}\b(?:services|affairs|relations|programs?|employer|career|initiative)\b/i;

export function namesARankItServesRatherThanHolds(title: string | undefined | null): boolean {
  const clean = title ? stripInvisibleFormatCharacters(String(title)) : '';
  if (!clean.trim()) return false;
  if (titleResearchOwnership(clean) !== 'works_in_another_group') return false;
  return ADMINISTRATIVE_RANK_OBJECT.test(clean);
}
