import { researchEntityTypeNameContradiction } from '../utils/researchHomeNameIdentityAuthority';

/**
 * The research-home type a page declares about itself, read from its own title and
 * first heading, or `''` when the page declares nothing recognisable.
 *
 * Read order matters and is not alphabetical. A lab head noun wins outright, so a
 * page that calls itself a laboratory is never retyped however many programme words
 * it also carries, and `[a-z]Lab` catches the closed compound the word vocabulary
 * cannot see (#3291). Centre and institute precede the facility and programme
 * vocabularies because a centre's page routinely describes its programmes and its
 * core services, and the most specific organisational claim is the row's type.
 *
 * Deliberately blind to the row's own name. Inferring a type from a name that sounds
 * like a project is the inference #2884 forbids, and it is what made a hand reading
 * of this cohort report 18 rows where the pages support 9.
 */
export function declaredResearchHomeTypeFromPage(title: unknown, heading: unknown): string {
  const text = `${typeof title === 'string' ? title : ''} ${
    typeof heading === 'string' ? heading : ''
  }`.trim();
  if (!text) return '';
  if (
    /\blab(?:oratory|oratories|s)?\b/i.test(text) ||
    /[a-z](?:Labs?|Laborator(?:y|ies))\b/.test(text)
  ) {
    return 'LAB';
  }
  if (/\bcent(?:er|re)s?\b/i.test(text)) return 'CENTER';
  if (/\binstitutes?\b/i.test(text)) return 'INSTITUTE';
  if (/\b(?:cores?|facilit(?:y|ies)|resources?|services?)\b/i.test(text)) return 'CORE_FACILITY';
  if (
    /\b(?:programs?|programmes?|initiatives?|projects?|stud(?:y|ies)|collaborations?|consorti(?:um|a)|networks?|teams?)\b/i.test(
      text,
    )
  ) {
    return 'INITIATIVE';
  }
  return '';
}

export interface DeclaredTypeRow {
  slug: string;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  manuallyLockedFields?: unknown;
  /** Live `entityType` and `kind` observations on the row, field and value together. */
  typeObservations: ReadonlyArray<{ field: string; value: string }>;
  pageStatus: string;
  pageBytes: number;
  pageTitle?: unknown;
  pageHeading?: unknown;
}

export type DeclaredTypeRefusal =
  | 'page-not-read'
  | 'page-declares-nothing'
  | 'page-declares-a-lab'
  | 'manually-locked'
  | 'a-surviving-observation-asserts-another-type';

export interface DeclaredTypePlan {
  slug: string;
  declaredType: string;
  /** The field and value pairs the refusal records, so the resolver stops reading them. */
  refusals: Array<{ field: string; value: string }>;
}

export interface DeclaredTypeOutcome {
  plans: DeclaredTypePlan[];
  refused: Array<{ slug: string; reason: DeclaredTypeRefusal }>;
}

const LAB_TYPE_VALUES = new Set(['lab']);

/**
 * A page read that carries a status but almost no body is the host declining, not the
 * page answering. Measured on this cohort, three rows returned 403 with one byte on
 * hosts that served a full page for other rows in the same serial pass, so treating
 * that as evidence would have recorded a verdict about the instrument.
 */
const MIN_READABLE_PAGE_BYTES = 500;

export function planDeclaredPageTypeRetypes(rows: readonly DeclaredTypeRow[]): DeclaredTypeOutcome {
  const plans: DeclaredTypePlan[] = [];
  const refused: Array<{ slug: string; reason: DeclaredTypeRefusal }> = [];

  for (const row of rows) {
    if (row.pageStatus !== '200' || row.pageBytes < MIN_READABLE_PAGE_BYTES) {
      refused.push({ slug: row.slug, reason: 'page-not-read' });
      continue;
    }
    const declaredType = declaredResearchHomeTypeFromPage(row.pageTitle, row.pageHeading);
    if (!declaredType) {
      refused.push({ slug: row.slug, reason: 'page-declares-nothing' });
      continue;
    }
    if (declaredType === 'LAB') {
      refused.push({ slug: row.slug, reason: 'page-declares-a-lab' });
      continue;
    }
    const locked = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.map((value) => String(value))
      : [];
    if (locked.some((field) => field === 'entityType' || field === 'kind')) {
      refused.push({ slug: row.slug, reason: 'manually-locked' });
      continue;
    }

    const refusals = row.typeObservations.filter((observation) =>
      LAB_TYPE_VALUES.has(observation.value.toLowerCase()),
    );
    // What the row resolves to AFTER the refusal has to be the declared type, not
    // nothing and not another lane's verdict. A refusal removes values, so a surviving
    // observation asserting a third type would win over the stored value and the row
    // would land somewhere neither the page nor the repair chose. Those rows need the
    // type asserted rather than the old one refused, which is a different arm.
    const survivors = row.typeObservations.filter(
      (observation) => !LAB_TYPE_VALUES.has(observation.value.toLowerCase()),
    );
    const survivorAgrees = survivors.every(
      (observation) => observation.value.toUpperCase() === declaredType.toUpperCase(),
    );
    if (survivors.length > 0 && !survivorAgrees) {
      refused.push({ slug: row.slug, reason: 'a-surviving-observation-asserts-another-type' });
      continue;
    }

    const deduped = new Map(
      refusals.map((observation) => [`${observation.field}|${observation.value}`, observation]),
    );
    plans.push({ slug: row.slug, declaredType, refusals: Array.from(deduped.values()) });
  }

  return { plans, refused };
}

/** Rows whose served heading disagrees with their own type, which is the scan this reads. */
export function rowContradictsItsOwnType(row: {
  entityType?: unknown;
  name?: unknown;
  displayName?: unknown;
}): boolean {
  return Boolean(researchEntityTypeNameContradiction(row));
}
