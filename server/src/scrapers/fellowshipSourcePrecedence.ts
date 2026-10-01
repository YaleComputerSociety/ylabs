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
 * window, where the fund page is Yale's own application system and so the authority.
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

const APPLICATION_WINDOW_FIELDS: ReadonlySet<string> = new Set([
  'deadline',
  'applicationOpenDate',
  'isAcceptingApplications',
  'reviewRequired',
]);

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
export function fellowshipFieldsWithheldBySourcePrecedence(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  resolved: Readonly<Record<string, { contributingSources?: readonly string[] } | undefined>>;
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
    else if (!APPLICATION_WINDOW_FIELDS.has(field) && hasValue(input.stored?.[field])) {
      withheld.add(field);
    }
  }
  return Array.from(withheld);
}
