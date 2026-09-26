import { OrgUnit } from '../models/orgUnit';
import { Signal, signalTargetIsExactlyOne } from '../models/signal';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { COURSE_CREDIT_ROUTE_MAX_EVIDENCE_LENGTH } from './utils/courseCreditRouteEvidence';

/**
 * Materializes a department-scoped observation into a `Signal` on the department's
 * `OrgUnit` (#2214).
 *
 * A department course page establishes a fact about the department, so the fact
 * is stored on the department. Attaching it to every research entity in the
 * department would assert something the cited page does not say about that
 * entity, which is the cross-graft error the decision record forbids; the serve
 * path inherits it at read time and names the department as the source instead.
 */

export const ORG_UNIT_COURSE_CREDIT_ROUTE_FIELD = 'courseCreditRoute';

export const ORG_UNIT_OBSERVATION_FIELDS = new Set<string>([ORG_UNIT_COURSE_CREDIT_ROUTE_FIELD]);

export interface OrgUnitCourseCreditRouteValue {
  schemaVersion: 1;
  evidenceQuote: string;
  supportingQuoteCount: number;
}

export interface OrgUnitSignalMaterializationResult {
  signalsWritten: number;
  rejected: number;
  rejectedReason?: string;
}

interface ObservationLike {
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  sourceName?: unknown;
  observedAt?: unknown;
  _id?: unknown;
  scrapeRunId?: unknown;
}

const SOURCE_NAMES_ALLOWED_TO_ASSERT_A_ROUTE = new Set<string>([
  'department-undergrad-research',
  'manual-admin-edit',
]);

export function readOrgUnitCourseCreditRouteValue(
  value: unknown,
): OrgUnitCourseCreditRouteValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  const quote =
    typeof record.evidenceQuote === 'string'
      ? sanitizeEvidenceExcerpt(record.evidenceQuote).trim()
      : '';
  if (!quote || quote.length > COURSE_CREDIT_ROUTE_MAX_EVIDENCE_LENGTH) return null;
  const supporting =
    typeof record.supportingQuoteCount === 'number' && record.supportingQuoteCount >= 1
      ? Math.floor(record.supportingQuoteCount)
      : 0;
  if (supporting < 1) return null;
  return { schemaVersion: 1, evidenceQuote: quote, supportingQuoteCount: supporting };
}

/**
 * The key carries the org-unit slug, not just the source name, and that is
 * load-bearing rather than cosmetic. The pre-existing unique index
 * `{researchEntityId, type, derivationKey}` has `partialFilterExpression:
 * { derivationKey: { $type: 'string' } }`, which does not exclude a row that sets
 * no `researchEntityId`, so every org-unit signal shares the key `(null, type,
 * derivationKey)` on that index. With a source-only key, 19 stored observations
 * materialized 1 signal and the other 18 were silently rejected as duplicates.
 * Making the key per-department avoids rebuilding an index that Beta and
 * Production also carry.
 */
const courseCreditRouteDerivationKey = (orgUnitSlug: string, sourceName: string): string =>
  `course-credit-route:${orgUnitSlug}:${sourceName}`;

const validDate = (value: unknown): Date =>
  value instanceof Date
    ? value
    : typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
      ? new Date(value)
      : new Date();

/**
 * Fails closed on every arm: an unknown source, a private or non-HTTP citation, a
 * value that does not parse, or an org unit that does not exist all produce no
 * signal rather than a signal with weaker evidence.
 */
export async function materializeOrgUnitSignalsForObservations(input: {
  orgUnitSlug: string;
  observations: ObservationLike[];
  dryRun?: boolean;
}): Promise<OrgUnitSignalMaterializationResult> {
  const routeObservations = input.observations.filter(
    (observation) => observation.field === ORG_UNIT_COURSE_CREDIT_ROUTE_FIELD,
  );
  if (routeObservations.length === 0) return { signalsWritten: 0, rejected: 0 };

  const orgUnit = await OrgUnit.findOne({ slug: input.orgUnitSlug, archived: { $ne: true } })
    .select('_id name slug')
    .lean();
  if (!orgUnit) {
    return {
      signalsWritten: 0,
      rejected: routeObservations.length,
      rejectedReason: 'org_unit_not_found',
    };
  }

  let signalsWritten = 0;
  let rejected = 0;
  let rejectedReason: string | undefined;

  for (const observation of routeObservations) {
    const sourceName = typeof observation.sourceName === 'string' ? observation.sourceName : '';
    if (!SOURCE_NAMES_ALLOWED_TO_ASSERT_A_ROUTE.has(sourceName)) {
      rejected += 1;
      rejectedReason = rejectedReason || 'source_not_allowed';
      continue;
    }
    const sourceUrl = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
    if (!sourceUrl || !isPublicHttpUrl(sourceUrl)) {
      rejected += 1;
      rejectedReason = rejectedReason || 'source_url_not_public';
      continue;
    }
    const value = readOrgUnitCourseCreditRouteValue(observation.value);
    if (!value) {
      rejected += 1;
      rejectedReason = rejectedReason || 'value_does_not_parse';
      continue;
    }
    if (input.dryRun) {
      signalsWritten += 1;
      continue;
    }
    // An upsert skips document validation, so the exactly-one-target rule is
    // enforced here or nowhere.
    const target = { orgUnitId: (orgUnit as any)._id };
    if (!signalTargetIsExactlyOne(target)) {
      rejected += 1;
      rejectedReason = rejectedReason || 'target_is_not_exactly_one';
      continue;
    }
    await Signal.updateOne(
      {
        orgUnitId: (orgUnit as any)._id,
        type: 'COURSE_CREDIT_PATHWAY',
        derivationKey: courseCreditRouteDerivationKey(input.orgUnitSlug, sourceName),
      },
      {
        $set: {
          value,
          confidence: 'MEDIUM',
          status: 'KNOWN',
          source: {
            name: sourceName,
            url: sourceUrl,
            excerpt: value.evidenceQuote,
            evidenceIds: observation._id ? [observation._id] : [],
            scrapeRunIds: observation.scrapeRunId ? [observation.scrapeRunId] : [],
          },
          observedAt: validDate(observation.observedAt),
          lastMaterializedAt: new Date(),
          archived: false,
        },
        $setOnInsert: {
          orgUnitId: (orgUnit as any)._id,
          type: 'COURSE_CREDIT_PATHWAY',
          derivationKey: courseCreditRouteDerivationKey(input.orgUnitSlug, sourceName),
        },
      },
      { upsert: true },
    );
    signalsWritten += 1;
  }

  return {
    signalsWritten,
    rejected,
    ...(rejectedReason ? { rejectedReason } : {}),
  };
}

/**
 * `research_entities.departments[]` and this lane's configs both store a
 * department name string, and there is no id link to `OrgUnit`, so the slug has
 * to be resolved by name or alias. Returns null rather than guessing, so a
 * department the org chart does not know produces no observation.
 */
export async function resolveOrgUnitSlugForDepartmentName(
  departmentName: string,
): Promise<string | null> {
  const name = (departmentName || '').trim();
  if (!name) return null;
  const unit = await OrgUnit.findOne({
    archived: { $ne: true },
    $or: [{ name }, { aliases: name }],
  })
    .select('slug')
    .lean();
  return unit ? String((unit as any).slug) : null;
}
