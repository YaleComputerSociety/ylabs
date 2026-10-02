/**
 * Which source may write what on a fellowship another lane already owns (#3984).
 *
 * The Student Grants Database is a catalog of every Yale fund, so its lane attaches to
 * rows the public-page lanes already own, through the record-specific application-link
 * match. Until this rule it wrote its whole snapshot onto them: on Development one sweep
 * gave 93 rows the yale-college-fellowships-office lane owned a new `sourceKey`, which
 * that lane then could no longer find, and replaced 223 official `sourceUrl` values with
 * the CommunityForce fund page, which the visibility gate reads as an application portal,
 * demoting 111 served rows.
 *
 * So an enrich-only source owns only a row no other lane owns. On another lane's row it
 * writes no identity field and fills only fields the row lacks, except the application
 * window and the fund's structured facets, where the fund page is Yale's own application
 * system and so the authority.
 * The database is an official Yale source (owner decision, #4284), so on a row it owns
 * the fund page is the row's `sourceUrl`. Independently of ownership, a fund page never
 * replaces a program's own web page as `sourceUrl`: the page that describes the program
 * is the richer citation, and swapping it is what demoted 111 served rows in #3984.
 */
import { isProgramApplicationPortalUrl } from '../utils/researchHomeWebsiteUrl';

export const YALE_FELLOWSHIP_DATABASE_SOURCE = 'student-grants-database';

export const ENRICH_ONLY_FELLOWSHIP_SOURCES: ReadonlySet<string> = new Set([
  YALE_FELLOWSHIP_DATABASE_SOURCE,
]);

const FELLOWSHIP_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  'sourceKey',
  'sourceName',
  'sourceUrl',
  'sourceFingerprint',
]);

export const APPLICATION_WINDOW_FIELDS: ReadonlySet<string> = new Set([
  'deadline',
  'applicationOpenDate',
  'isAcceptingApplications',
  'reviewRequired',
]);

// The fund page states these as structured fields, so on another lane's row the fund is
// their authority too, not an inference read from that lane's page wording (#4173).
export const FUND_FACET_FIELDS: ReadonlySet<string> = new Set([
  'purpose',
  'termOfAward',
  'yearOfStudy',
  'citizenshipStatus',
  'globalRegions',
]);

// Where the fund states one of these, every pass over a row citing that fund resolves the
// fund's value, so the owning lane's pass and the fund's pass cannot write different
// windows in turn (#4412).
export const FUND_AUTHORITY_FIELDS: ReadonlySet<string> = new Set([
  ...FUND_FACET_FIELDS,
  ...APPLICATION_WINDOW_FIELDS,
]);

// A row can cite a fund page that is not its own program's: a common application that
// admits to many funds, or a sibling award at another level ("Undergraduate Travel" linking
// the "Postgraduate" fund). That fund's facets describe a different program, so they are
// not this row's evidence (#4173).
const COMMON_APPLICATION_TITLE = /\bcommon application\b/i;

const programLevel = (title: string): 'undergraduate' | 'graduate' | null => {
  if (/\bundergraduate\b/i.test(title)) return 'undergraduate';
  if (/\b(?:post-?graduate|graduate)\b/i.test(title)) return 'graduate';
  return null;
};

export function fundFacetsDescribeProgram(programTitle: unknown, fundTitle: unknown): boolean {
  const fund = typeof fundTitle === 'string' ? fundTitle : '';
  if (!fund) return true;
  if (COMMON_APPLICATION_TITLE.test(fund)) return false;
  const programLevelStated = programLevel(typeof programTitle === 'string' ? programTitle : '');
  const fundLevelStated = programLevel(fund);
  return !(programLevelStated && fundLevelStated && programLevelStated !== fundLevelStated);
}

export function newestFundTitle(observations: readonly any[]): unknown {
  return observations
    .filter(
      (observation) =>
        observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE && observation.field === 'title',
    )
    .sort(
      (a, b) => new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime(),
    )[0]?.value;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isEnrichOnlyWriteOnAnotherLanesRow(
  stored: Record<string, unknown> | null | undefined,
  contributingSources: readonly string[] | undefined,
): boolean {
  const owner = text(stored?.sourceName);
  if (!owner || ENRICH_ONLY_FELLOWSHIP_SOURCES.has(owner)) return false;
  const sources = contributingSources ?? [];
  return (
    sources.length > 0 && sources.every((source) => ENRICH_ONLY_FELLOWSHIP_SOURCES.has(source))
  );
}

/**
 * The staged fields a pass may not write, given the row it reads and the sources each
 * resolved field's winning value came from. Decided per field, because every field
 * resolves separately and the owning lane can win one while the enrich-only source wins
 * another. Returned rather than applied so the projection keeps one place that edits
 * its `$set`.
 */
/**
 * Whether an enrich-only source's claim that a field has no value may clear it on this
 * row (#4230). It may not on a row another lane owns, for a sharper reason than the
 * write rule above: the database lane's pass is entered through its own fund key, so it
 * never read the owning lane's observations, which sit under that lane's key. Its
 * "nothing states this" is therefore a fact about its own evidence rather than about
 * the row, and clearing on it would delete a value the owning lane still asserts.
 */
export function fellowshipAbsenceClearWithheldBySourcePrecedence(input: {
  stored: Record<string, unknown> | null | undefined;
  assertedBy: readonly string[];
}): boolean {
  return isEnrichOnlyWriteOnAnotherLanesRow(input.stored, input.assertedBy);
}

export function fellowshipFieldsWithheldBySourcePrecedence(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  resolved: Readonly<Record<string, { contributingSources?: readonly string[] } | undefined>>;
  fundTitle: unknown;
}): string[] {
  const withheld = new Set<string>();
  const stagedSourceUrl = text(input.staged.sourceUrl);
  const storedSourceUrl = text(input.stored?.sourceUrl);
  if (
    stagedSourceUrl &&
    isProgramApplicationPortalUrl(stagedSourceUrl) &&
    storedSourceUrl &&
    !isProgramApplicationPortalUrl(storedSourceUrl)
  ) {
    withheld.add('sourceUrl');
  }
  for (const [field, resolvedField] of Object.entries(input.resolved)) {
    if (!(field in input.staged)) continue;
    if (!isEnrichOnlyWriteOnAnotherLanesRow(input.stored, resolvedField?.contributingSources)) {
      continue;
    }
    if (FELLOWSHIP_IDENTITY_FIELDS.has(field)) withheld.add(field);
    else if (
      !APPLICATION_WINDOW_FIELDS.has(field) &&
      !(
        FUND_FACET_FIELDS.has(field) &&
        fundFacetsDescribeProgram(input.stored?.title, input.fundTitle)
      ) &&
      hasValue(input.stored?.[field])
    ) {
      withheld.add(field);
    }
  }
  return Array.from(withheld);
}
