import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { Fellowship } from '../models/fellowship';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchEntityRosterByEntityId } from './researchEntityMembershipAccessor';
import { researchEntityLeadStateForMembers } from './researchEntityQuality';
import { LEAD_ROLE_LEGACY_LABELS } from '../models/canonicalRoleMapping';
import mongoose from 'mongoose';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import {
  archivedStudentVisibilityVerdictFilter,
  clearedStudentVisibilityVerdict,
} from '../models/entityArchival';
import {
  VisibilityReleaseQueueItem,
  type VisibilityReleaseQueueCollection,
  type VisibilityRepairStage,
  type VisibilityRepairStatus,
} from '../models/visibilityReleaseQueueItem';
import { withPublicDescriptionGateFields } from './researchEntityPublicDescription';
import {
  BLANK_PUBLIC_DESCRIPTION_REASON,
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  hasProfileAreaShellDuplicateRisk,
  isStudentReadyHardBlockerReason,
  isStudentReadySoftSignalReason,
  PUBLIC_DESCRIPTION_INVARIANT_FAILED_REASON,
} from './studentVisibilityTier';
import {
  loadKnownPersonSurnameRoster,
  loadResearchEntityLeadPersonNames,
} from '../utils/researchHomeNameIdentityRoster';
import {
  buildResearchEntityPiDedupePlan,
  piLedRestrictedDuplicateEntityIds,
  samePiDuplicateEntityIdsRestrictedToPiLed,
  type ResearchEntityPiDedupeRow,
} from '../scripts/researchEntityPiDedupeCore';
import { nextRepairActionForReasons } from '../scripts/studentVisibilityBackfillReport';
import { countResearchEntityAlternateAccessPaths } from './researchEntityAlternateAccessPath';
import {
  evaluateRosterLeadResolution,
  type RosterLeadResolutionResult,
} from './rosterLeadResolutionGuard';
import { serializedDocumentId } from '../utils/idSerialization';
import { readIndexedFieldByDocumentId, syncEntities } from './meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isConcreteResearchHomeEntity } from '../utils/profileAreaDuplicateRisk';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';
import { isOrganizationalResearchEntity } from '../utils/researchEntityOrganizational';
import { officialProfileUrlFromRosterEntry } from './leadProfileIdentity';
import { officialNonGrantSourceUrl } from '../scrapers/accessMaterializer';
import { IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS } from './accessAcceptanceLevel';
import { unwrapMicrosoftSafeLinksUrl } from '../utils/safeLinksUrl';

export type StudentVisibilityGateMode = 'dry-run' | 'apply';
export type StudentVisibilityGateCollection = VisibilityReleaseQueueCollection | 'all';
const STUDENT_VISIBILITY_GATE_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const studentVisibilityGateDocumentId = (value: unknown): string =>
  serializedDocumentId(value) || '';
const studentVisibilityGateEntityIdKey = (entity: any): string =>
  studentVisibilityGateDocumentId(entity?._id) || studentVisibilityGateDocumentId(entity?.id);
const studentVisibilityGateEntitySortKey = (entity: any): string =>
  typeof entity?.slug === 'string' && entity.slug.trim()
    ? entity.slug.trim()
    : studentVisibilityGateEntityIdKey(entity);

export interface StudentVisibilityGateOptions {
  collection: StudentVisibilityGateCollection;
  mode: StudentVisibilityGateMode;
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
  /**
   * Plan as if no row carried a duplicate reason, to measure what the duplicate cohort
   * actually costs.
   *
   * The tier emits `duplicate_risk` alongside `exact_url_duplicate_risk` unconditionally,
   * so a row's own cause cannot be recovered from gate output and "clearing the duplicate
   * reasons releases N rows" was unfalsifiable in both directions: 261 of 382 duplicate
   * members carry no other blocking reason and all 261 carry affirmative evidence, yet 145
   * also carry `missing_action_evidence`, which is neither blocking nor evidence under this
   * module's own predicates (#3272).
   *
   * Refused in apply mode. This exists to read a counterfactual, and writing tiers computed
   * from a premise that is false of the corpus would be the opposite of measuring it.
   */
  suppressDuplicateRisk?: boolean;
}

export interface StudentVisibilityGatePlan {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  currentTier?: string;
  currentComputedTier?: string;
  currentReasons?: string[];
  computedTier: StudentVisibilityTier;
  tier: StudentVisibilityTier;
  reasons: string[];
  sourceNames: string[];
  nextRepairAction: string;
  hasResolvedLead?: boolean;
}

export interface VisibilityQueueUpsert {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  currentTier?: string;
  computedTier: StudentVisibilityTier;
  targetTier: StudentVisibilityTier;
  blockerReasons: string[];
  evidenceSignals: string[];
  sourceNames: string[];
  nextRepairAction: string;
  repairStage?: VisibilityRepairStage;
  repairStatus?: VisibilityRepairStatus;
  remainingBlockers?: string[];
  status: 'open';
}

export interface StudentVisibilityGateDeps {
  updateRecordVisibility: (
    collection: VisibilityReleaseQueueCollection,
    recordId: string,
    patch: Record<string, any>,
    options: { timestamps: boolean },
  ) => Promise<void>;
  upsertOpenQueueItem: (item: VisibilityQueueUpsert) => Promise<void>;
  resolveQueueItem: (
    collection: VisibilityReleaseQueueCollection,
    recordId: string,
    metadata: { resolvedByTier: StudentVisibilityTier },
  ) => Promise<void>;
  resolveArchivedResearchQueueItems?: () => Promise<number>;
  clearArchivedResearchStudentVisibility?: () => Promise<number>;
}

export interface StudentVisibilityGateReport {
  mode: StudentVisibilityGateMode;
  collection: StudentVisibilityGateCollection;
  scanned: number;
  counts: {
    scanned: number;
    promoted: number;
    held: number;
    resolved: number;
    changed: number;
    unexplainedHeld: number;
  };
  reasonCounts: Record<string, number>;
  blockerCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  samples: StudentVisibilityGatePlan[];
}

const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'graduate_relevant',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

// The single definition of the source-description repair lane. The repair queue
// classifies the same reasons (`classifyVisibilityRepairStage`) and clears them
// against the same patch, so a second hand-maintained copy drifts: it was missing
// `blank_public_description` and `public_description_invariant_failed`, which sent
// every row held by one of them to `review_exception` - queued, with no lane able
// to act on it (#2818).
//
// #2818 shared only this one lane and left the other four sets duplicated, so
// three of them drifted the same way. Both writers of the stored `repairStage`
// column now derive it from `repairStageForReasons` below: this service writes it
// when the gate queues a row, and the repair queue overwrites it from its own plan.
// Two writers with two definitions meant whichever ran last won.
export const SOURCE_DESCRIPTION_REPAIR_REASONS: ReadonlySet<string> = new Set([
  'missing_description',
  'missing_card_description',
  'thin_description',
  'profile_fallback_only',
  'missing_source_url',
  'missing_official_source',
  'application_source_only',
  BLANK_PUBLIC_DESCRIPTION_REASON,
  PUBLIC_DESCRIPTION_INVARIANT_FAILED_REASON,
]);
export const PI_IDENTITY_REPAIR_REASONS: ReadonlySet<string> = new Set([
  'missing_lead',
  'duplicate_name_risk',
  'duplicate_risk',
  'profile_identity_risk',
]);
export const ACTION_EVIDENCE_REPAIR_REASONS: ReadonlySet<string> = new Set([
  'missing_action_evidence',
  'missing_alternate_access_path',
  'missing_application_route',
  'missing_source_route',
]);
export const SUPPRESSION_REPAIR_REASONS: ReadonlySet<string> = new Set([
  'archive_review',
  'content_page_risk',
  'exact_url_duplicate_risk',
  'generic_directory_shell',
  'inactive_at_yale',
  'non_owner_grant_shell',
  'grant_only_no_current_yale_source',
  'permanently_closed',
  'non_research_entity',
  'non_research_program',
  'not_undergraduate_relevant',
  'profile_biography_shell',
  'research_infrastructure_only',
]);
export const REVIEW_EXCEPTION_REPAIR_REASONS: ReadonlySet<string> = new Set(['formalization_only']);
// Every field the tier computation reads must be listed here. A field the
// computation consults but the projection omits arrives as `undefined`, so the
// branch depending on it silently never fires and the gate reports a clean
// result - the same failure #2242 produced when this pattern dropped
// `researchAreas` from the description audit and invented 275 phantom rows.
//
// `studentVisibilitySuppressionReason` was missing, which made BOTH operator
// suppression markers inert: `research_infrastructure_only` (pre-existing) and
// `permanently_closed` (#2284). Neither could ever suppress through the gate.
//
// `fieldProvenance` was the third instance of the same omission, and the reason
// this now composes `withPublicDescriptionGateFields` rather than listing fields
// by hand. `hasLiveSourceCitation` counts every `fieldProvenance.*.sourceUrl` as a
// citation, so without it the gate saw only `sourceUrls`; a row whose citations are
// all provenance-borne read as having NO citation, which the predicate treats as
// silence rather than death, and `all_citations_dead` could not fire. Measured on
// Development: 10 live rows where the gate's citation verdict disagreed with the
// whole document, one of them `student_ready` and serving a card whose only
// citation is a known 404. Composing the shared list means a future gate input is
// inherited instead of waiting to be noticed a fourth time.
export const researchEntityGateProjection = withPublicDescriptionGateFields(
  '_id slug name displayName kind entityType website websiteUrl profileUrls sourceUrls sourceLinkHealth descriptionGrounding departments researchAreas shortDescription fullDescription profileSynthesisDescription descriptionSource activeAtYaleCache yaleStatusCache studentVisibilityTier studentVisibilityComputedTier studentVisibilityOverrideTier studentVisibilityReasons studentVisibilitySuppressionReason',
);

/**
 * The lead rows the gate reasons about, built from a research entity's roster.
 *
 * Module-level and exported because a lane deciding whether a row still needs a lead
 * must ask the gate's question on the gate's own inputs. The roster accessor already
 * drops archived assignments and archived people; restating either half is how the
 * PI-attachment lane's "already linked" test drifted from the gate's (#2931).
 */
export function studentVisibilityGateLeadRows(
  rosterEntries: readonly any[],
): Array<Record<string, any>> {
  return rosterEntries
    .filter((entry) => entry.state !== 'HISTORICAL' && LEAD_ROLE_LEGACY_LABELS.has(entry.role))
    .map((entry) => {
      const [fname = '', ...rest] = String(entry.name || '')
        .trim()
        .split(/\s+/);
      const lname = rest.join(' ');
      const officialProfileUrl = officialProfileUrlFromRosterEntry(entry);
      return {
        researchEntityId: entry.researchEntityId,
        role: entry.role,
        userId: entry.personId,
        name: entry.name,
        ...(entry.title ? { title: entry.title } : {}),
        user: {
          _id: entry.personId,
          netid: entry.netid,
          displayName: entry.name,
          fname,
          lname,
          ...(entry.title ? { title: entry.title } : {}),
          ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {}),
          ...(officialProfileUrl ? { profileUrls: { official: officialProfileUrl } } : {}),
        },
      };
    });
}

/**
 * Of the given research entities, those the gate would judge to already hold a lead a
 * student could approach.
 *
 * This is the question a lane must subtract by. Asking only whether a lead role
 * assignment row exists counted archived assignments, assignments whose person record
 * is archived, and leads the gate judges too weak to own a research home, so the row
 * read as linked to the lane and leadless to the gate and no later pass could reach it.
 * Measured on Development, 52 of the 119 rows held by `missing_lead` alone were
 * unreachable that way, 48 of them because every lead edge they hold is archived
 * (#2931).
 */
export async function researchEntityIdsWithGateAttachedLead(
  entityIds: readonly unknown[],
): Promise<Set<string>> {
  const attached = new Set<string>();
  if (entityIds.length === 0) return attached;
  const roster = await getResearchEntityRosterByEntityId([...entityIds]);
  for (const [entityId, entries] of roster) {
    const leadMembers = studentVisibilityGateLeadRows(entries);
    if (researchEntityLeadStateForMembers(leadMembers) === 'lead_attached') {
      attached.add(entityId);
    }
  }
  return attached;
}

export const repairStageForReasons = (reasons: string[]) => {
  if (reasons.some((reason) => REVIEW_EXCEPTION_REPAIR_REASONS.has(reason)))
    return 'review_exception';
  if (reasons.includes('exact_url_duplicate_risk')) return 'suppression';
  if (reasons.includes('generic_directory_shell')) return 'suppression';
  if (reasons.includes('profile_biography_shell')) return 'suppression';
  if (reasons.some((reason) => SOURCE_DESCRIPTION_REPAIR_REASONS.has(reason))) {
    return 'source_description';
  }
  if (reasons.some((reason) => PI_IDENTITY_REPAIR_REASONS.has(reason))) return 'pi_identity';
  if (reasons.some((reason) => ACTION_EVIDENCE_REPAIR_REASONS.has(reason)))
    return 'action_evidence';
  if (reasons.some((reason) => SUPPRESSION_REPAIR_REASONS.has(reason))) return 'suppression';
  return 'review_exception';
};

// A repair blocker is exactly a HARD-blocker reason from the canonical
// student_ready taxonomy (issue #1802). SOFT enrichment signals never gate and
// are never blockers - including the `missing_*` ones that a blanket
// `startsWith('missing_')` rule would otherwise sweep in. The single source of
// truth is STUDENT_READY_HARD_BLOCKER_REASONS / STUDENT_READY_SOFT_SIGNAL_REASONS
// in studentVisibilityTier.ts. The residual `_only` clause keeps
// review-exception reasons (formalization_only, application_source_only,
// profile_fallback_only) blocking without enumerating each here.
export function isBlockingVisibilityReason(reason: string): boolean {
  if (evidenceReasons.has(reason)) return false;
  if (isStudentReadySoftSignalReason(reason)) return false;
  if (isStudentReadyHardBlockerReason(reason)) return true;
  return reason.endsWith('_only');
}

export const OPERATOR_OVERRIDE_REASON = 'operator_override';

/**
 * A research row held at `operator_review` must say WHY: either a hard blocker, or
 * an explicit operator override to that tier. A plan with neither is a hole in the
 * taxonomy rather than a decision - the tier read an input no reason records - so
 * the row is invisible to the blocker histogram everyone ranks repair work from,
 * and it lands in the release queue with an empty `blockerReasons` that no repair
 * lane can reach (#2818).
 *
 * Scoped to the research collection because the program tier does not yet hold to
 * it: `computeProgramStudentVisibility` gates on an audience that no reason records
 * at all, and on `missing_official_source` / `missing_application_route`, which the
 * #1802 taxonomy classifies as SOFT for research entities. Counting those rows here
 * would refuse every gate apply, research rows included, on a program hole this
 * function cannot describe. Recording program holds is separate work; until then
 * this must not read as an answer for them.
 */
export function isUnexplainedHeldVisibilityPlan(plan: {
  collection: VisibilityReleaseQueueCollection;
  tier: StudentVisibilityTier;
  reasons: string[];
}): boolean {
  if (plan.collection !== 'research') return false;
  if (plan.tier !== 'operator_review') return false;
  if (plan.reasons.some(isBlockingVisibilityReason)) return false;
  return !plan.reasons.includes(OPERATOR_OVERRIDE_REASON);
}

/**
 * An invariant nobody enforces is a convention. `counts.unexplainedHeld` counts
 * research plans only (see `isUnexplainedHeldVisibilityPlan`) and is zero by
 * construction, so a non-zero count means a tier input lost its recorded reason -
 * and writing those rows would publish that hole into the release queue, where no
 * repair lane can reach them. Refused on the same terms as the roster
 * lead-resolution guard: warn on every run, refuse to apply (#2818).
 */
export function studentVisibilityGateUnexplainedHeldBlocker(
  unexplainedHeld: number,
): string | undefined {
  if (unexplainedHeld <= 0) return undefined;
  return `${unexplainedHeld} row(s) held at operator_review record neither a hard blocker nor an operator override`;
}

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const sortedStrings = (values: string[]): string[] =>
  [...values].sort((a, b) => a.localeCompare(b));

const stringSetsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = sortedStrings(left);
  const sortedRight = sortedStrings(right);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

export function isStudentVisibilityGatePlanMateriallyChanged(
  plan: StudentVisibilityGatePlan,
): boolean {
  if (plan.currentTier !== plan.tier) return true;
  if (plan.currentComputedTier !== undefined && plan.currentComputedTier !== plan.computedTier) {
    return true;
  }
  if (Array.isArray(plan.currentReasons) && !stringSetsEqual(plan.currentReasons, plan.reasons)) {
    return true;
  }
  return false;
}

/**
 * The one owner of what an apply writes to a decided record, so the two apply paths
 * cannot drift: a materially changed row records the verdict and both stamps, and a row
 * the gate re-decided and left alone records only that it was evaluated, leaving
 * `studentVisibilityComputedAt` where the change that earned it put it (#2604).
 * A caller that routes a plan to a stamp-only write must also suppress `updatedAt`.
 */
function studentVisibilityGateRecordPatch(
  plan: StudentVisibilityGatePlan,
  now: Date,
): Record<string, unknown> {
  if (!isStudentVisibilityGatePlanMateriallyChanged(plan)) {
    return { studentVisibilityEvaluatedAt: now };
  }
  return {
    studentVisibilityTier: plan.tier,
    studentVisibilityComputedTier: plan.computedTier,
    studentVisibilityReasons: plan.reasons,
    studentVisibilityComputedAt: now,
    studentVisibilityEvaluatedAt: now,
  };
}

const exactDuplicateUrlRejectedPathPatterns = [
  /\/(?:people|faculty|professors|directory|members|humans\/faculty|labs|staff|team)\/?$/i,
  /\/(?:[^/]+\/)*membership\/directory\/?$/i,
  // Generic index / listing / opportunity / API pages: distinct research homes
  // legitimately share these, so they are NOT a same-entity duplicate signal.
  /(?:employment|research|undergraduate|volunteer)[-/]opportunities/i,
  /\/diversity\//i,
  /(?:awards?\.json|\/services\/)/i,
  // Institutional "about"/landing pages (and their index subtrees such as the
  // YSM A-to-Z lab index) are navigation furniture that many unrelated research
  // homes carry in sourceUrls, so they are never a same-entity duplicate signal.
  /^\/about(?:\/|$)/i,
];

// Hosts that serve generic API/listing endpoints rather than a specific
// research home, so a shared URL on them is not a duplicate signal.
const genericDuplicateSignalHosts = new Set(['api.nsf.gov', 'api.reporter.nih.gov']);

function normalizedExactDuplicateUrl(value: unknown): string {
  const raw = unwrapMicrosoftSafeLinksUrl(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();
    // A trailing default document addresses the same page as the directory, so
    // `/lab/x/index.aspx` and `/lab/x/` are one destination. Without this, two rows
    // citing one lab under the two spellings read as distinct and both serve (#2708).
    url.pathname = url.pathname.replace(/\/(?:index|default)\.(?:aspx|html?|php)$/i, '/');
    url.pathname = url.pathname.replace(/\/+$/g, '') || '/';
    if (url.hostname === 'medicine.yale.edu') {
      url.pathname = url.pathname.replace(/^\/[^/]+\/profile\//i, '/profile/');
    }
    return url.toString();
  } catch {
    return '';
  }
}

function isSpecificDuplicateSignalUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '') || '/';
    if (path === '/' && /(^|\.)yale\.edu$/i.test(url.hostname)) return false;
    if (genericDuplicateSignalHosts.has(url.hostname.toLowerCase())) return false;
    if (exactDuplicateUrlRejectedPathPatterns.some((pattern) => pattern.test(path))) return false;
    return true;
  } catch {
    return false;
  }
}

// Uniqueness has to be taken AFTER normalization as well as before it: one row
// citing a lab under two spellings that normalize to one destination otherwise
// enters that URL's group twice and forms a two-member "duplicate group" with
// itself, which both inflates the group census and lets a row with no URL partner
// at all be treated as a group (#1890).
const entityDuplicateUrls = (entity: any): string[] =>
  uniqueStrings(
    uniqueStrings([
      entity.websiteUrl,
      entity.website,
      ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ]).map(normalizedExactDuplicateUrl),
  ).filter(isSpecificDuplicateSignalUrl);

/**
 * Sources that publish a research home's own address, so they assert which row
 * OWNS a URL rather than merely that the URL appeared somewhere.
 *
 * Yale School of Medicine's A-to-Z lab websites index is a table of lab name to
 * lab website, whether read as markup or as the JSON payload the same page embeds,
 * so both readings materialize under the one source name below. A faculty
 * directory or department roster reads a PERSON's page instead, where the YSM CMS
 * uses one link slot for "my lab" and "a lab I work in" alike (#2234), so those
 * sources cannot distinguish an owner from a member and must not be added here.
 *
 * Every name here must be a source the coverage registry knows, or the authority
 * silently covers no row at all; a test pins that.
 */
export const RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES: ReadonlySet<string> = new Set([
  'ysm-atoz-index',
]);

/**
 * The address an index with authority over research homes published for this
 * entity, or '' when no such index published one.
 *
 * Ownership is not a matter of degree, so this ranks ahead of
 * `exactDuplicateCanonicalScore` rather than adding points to it: the score's
 * dominant term is an 80-point already-public bonus, which resolves a collision by
 * publication order and hands the canonical slot to whichever row happened to be
 * released first (#2786).
 *
 * The index asserts ownership of a research home's address, so a row that is not a
 * concrete research home carries no such assertion however its `websiteUrl` was
 * provenanced.
 */
export function researchHomeUrlUnderIndexAuthority(entity: any): string {
  if (!isConcreteResearchHomeEntity(entity || {})) return '';
  const websiteUrl = normalizedExactDuplicateUrl(entity?.websiteUrl);
  if (!isSpecificDuplicateSignalUrl(websiteUrl)) return '';
  const sourceName = entity?.fieldProvenance?.websiteUrl?.sourceName;
  return RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES.has(
    typeof sourceName === 'string' ? sourceName.trim() : '',
  )
    ? websiteUrl
    : '';
}

function exactDuplicateCanonicalScore(
  entity: any,
  leadCountsByEntityId: Map<string, number>,
): number {
  const id = studentVisibilityGateEntityIdKey(entity);
  const textScore =
    (typeof entity.fullDescription === 'string' && entity.fullDescription.trim().length >= 80
      ? 35
      : 0) +
    (typeof entity.shortDescription === 'string' && entity.shortDescription.trim().length >= 40
      ? 20
      : 0);
  return (
    (PUBLIC_TIERS.has(String(entity.studentVisibilityTier || '')) ? 80 : 0) +
    (isConcreteResearchHomeEntity(entity) ? 35 : 0) +
    (leadCountsByEntityId.get(id) || 0) * 15 +
    textScore +
    (entity.entityType === 'FACULTY_RESEARCH_AREA' ? 0 : 8)
  );
}

/**
 * Person-scoped research entities whose every citation is one that many other
 * person-scoped rows cite byte-identically.
 *
 * A page about one person is cited by about one person row; a directory index or
 * a fundraising page is cited by hundreds, so a row citing only such pages has no
 * evidence about its own subject. The signal is deliberately structural and never
 * compares a URL slug against a display name: Yale slugs and display names
 * disagree in a dozen legitimate ways - a concatenated compound surname
 * (`aidin-eslampour` for "Aidin Eslam Pour"), a netid suffix (`andrew-yu-ay433`),
 * credentials in the name ("Ann V. Arthur, MD '90"), a second surname the slug
 * omits, a short form, or a slug that is a bare netid (`em453`) - and every
 * name-matching variant of this criterion refused hundreds of correctly cited
 * rows on that basis alone (#2464).
 *
 * This is not covered by `selectExactUrlDuplicateRiskEntityIds`, which skips any
 * URL group larger than five precisely because a widely shared page is not a
 * duplicate signal. The many-rows case had no owner.
 */
export const SHARED_CITATION_PERSON_ROW_THRESHOLD = 25;

const PERSON_SCOPED_GATE_ENTITY_TYPES = new Set([
  'FACULTY_RESEARCH_AREA',
  'FACULTY_RESEARCH',
  'INDIVIDUAL_RESEARCH',
]);

export function selectSharedCitationOnlyEntityIds(
  entities: any[],
  threshold: number = SHARED_CITATION_PERSON_ROW_THRESHOLD,
): Set<string> {
  const personRows = entities.filter((entity) =>
    PERSON_SCOPED_GATE_ENTITY_TYPES.has(String(entity?.entityType || '')),
  );
  const personRowsPerUrl = new Map<string, number>();
  for (const entity of personRows) {
    for (const url of entityDuplicateUrls(entity)) {
      personRowsPerUrl.set(url, (personRowsPerUrl.get(url) || 0) + 1);
    }
  }

  const sharedOnly = new Set<string>();
  for (const entity of personRows) {
    const urls = entityDuplicateUrls(entity);
    if (urls.length === 0) continue;
    if (urls.every((url) => (personRowsPerUrl.get(url) || 0) >= threshold)) {
      const id = studentVisibilityGateEntityIdKey(entity);
      if (id) sharedOnly.add(id);
    }
  }
  return sharedOnly;
}

const leadCountsByEntityIdFrom = (leadRows: any[]): Map<string, number> => {
  const leadCountsByEntityId = new Map<string, number>();
  for (const row of leadRows) {
    const id = studentVisibilityGateDocumentId(row.researchEntityId);
    if (!id) continue;
    leadCountsByEntityId.set(id, (leadCountsByEntityId.get(id) || 0) + 1);
  }
  return leadCountsByEntityId;
};

const EXACT_DUPLICATE_URL_GROUP_LIMIT = 5;

type ExactDuplicateUrlGroup = { url: string; members: any[] };

/** Whether this URL is the row's own published research home. */
const entityPublishesUrlAsItsOwnHome = (entity: any, url: string): boolean =>
  normalizedExactDuplicateUrl(entity?.websiteUrl) === url ||
  normalizedExactDuplicateUrl(entity?.website) === url;

/** Whether the row serves any field harvested from this page. */
const entityProvenancesFieldToUrl = (entity: any, url: string): boolean =>
  Object.values(entity?.fieldProvenance || {}).some(
    (provenance: any) => normalizedExactDuplicateUrl(provenance?.sourceUrl) === url,
  );

const specificResearchHomeUrl = (value: unknown): string => {
  const url = normalizedExactDuplicateUrl(value);
  return isSpecificDuplicateSignalUrl(url) ? url : '';
};

/**
 * The row's own published research home, whatever it is.
 *
 * A non-specific address is no research home of its own: an index or roster page is
 * navigation furniture many unrelated rows carry, so a row whose `websiteUrl` is one
 * has published nothing that could be a DIFFERENT home from the URL under contest.
 * Reading it as one dropped such a row from its group, and a two-row group shrunk to
 * one is filtered out entirely, so a genuine duplicate pair both served.
 */
const entityOwnHomeUrl = (entity: any): string =>
  specificResearchHomeUrl(entity?.websiteUrl) || specificResearchHomeUrl(entity?.website);

/**
 * Whether this member is merely a READER of the URL rather than a candidate to BE it.
 *
 * A `sourceUrls` entry is usually good same-entity evidence and stays so: a row with no
 * research home of its own that cites a site is a strong candidate to be that site, and
 * several pinned cases depend on exactly that reading. The narrow exception is a row
 * that already publishes a DIFFERENT research home and neither publishes this URL nor
 * serves any field harvested from it. Such a row read the page, which is what
 * harvesting from it requires, and calling it a duplicate of the row that publishes the
 * address suppresses the owner over a citation nothing else supports (#1896). The
 * citation also outlives every observation behind it, because the materializer carries
 * `entityDoc.sourceUrls` forward unconditionally.
 */
const entityOnlyReadsUrl = (entity: any, url: string): boolean => {
  if (entityPublishesUrlAsItsOwnHome(entity, url)) return false;
  if (entityProvenancesFieldToUrl(entity, url)) return false;
  // A row whose address an index of research homes published is a claimant in any
  // collision that touches its own site, however the other row spells it. Yale's lab
  // index carries a lab under one spelling while the row cites the other
  // (`/lab/jun-liu/` against `/lab/jun_liu/`), which `normalizedExactDuplicateUrl` does
  // not fold, so reading the index-published owner as a mere reader of the variant
  // dropped it and promoted the row that had borrowed its address.
  if (researchHomeUrlUnderIndexAuthority(entity)) return false;
  const ownHome = entityOwnHomeUrl(entity);
  return Boolean(ownHome) && ownHome !== url;
};

/**
 * The members that actually contest ownership of a URL. Applied AFTER the group-size
 * filter, so a group that shrinks past the limit is not thereby exposed to the signal
 * for the first time; widening what the signal adjudicates is a separate question
 * (#2779). `docs/student-ready-definition.md` records the measured release count.
 *
 * The guard also keeps the result non-empty: the member that publishes the URL reads
 * `false` from `entityOnlyReadsUrl` and so always survives the filter.
 */
const membersContestingUrl = (url: string, members: any[]): any[] => {
  const publishers = members.filter((entity) => entityPublishesUrlAsItsOwnHome(entity, url));
  if (publishers.length === 0) return members;
  return members.filter((entity) => {
    if (!entityOnlyReadsUrl(entity, url)) return true;
    // Mutual citation is a contest rather than a reading: when the row publishing this
    // URL also cites the reader's own home, each is claiming the other's address and
    // exactly one can be right. Dropping the reader would dissolve both halves of the
    // pair and serve a student two cards for one lab.
    const ownHome = entityOwnHomeUrl(entity);
    return publishers.some((publisher) => entityDuplicateUrls(publisher).includes(ownHome));
  });
};

/**
 * The duplicate-URL groups the gate itself builds, keyed the way it keys them.
 *
 * Exported because every treatment proposed for this cohort is group-level, and while the
 * builder was module-local a group-level claim could not be checked against the exported
 * surface: two independent proxy attempts produced a fake zero over 4,780 rows (#3272).
 */
export const exactDuplicateUrlGroups = (entities: any[]): ExactDuplicateUrlGroup[] => {
  const entitiesByUrl = new Map<string, any[]>();
  for (const entity of entities) {
    for (const url of entityDuplicateUrls(entity)) {
      entitiesByUrl.set(url, [...(entitiesByUrl.get(url) || []), entity]);
    }
  }
  return [...entitiesByUrl.entries()]
    .filter(
      ([, members]) => members.length > 1 && members.length <= EXACT_DUPLICATE_URL_GROUP_LIMIT,
    )
    .map(([url, members]) => ({ url, members: membersContestingUrl(url, members) }))
    .filter(({ members }) => members.length > 1);
};

type IndexUrlAuthority = {
  assertsOwnershipOf: (entity: any, url: string) => boolean;
};

const indexUrlAuthorityOver = (entities: any[]): IndexUrlAuthority => {
  const indexAuthorityUrlByEntityId = new Map<string, string>();
  for (const entity of entities) {
    const id = studentVisibilityGateEntityIdKey(entity);
    const authorityUrl = researchHomeUrlUnderIndexAuthority(entity);
    if (id && authorityUrl) indexAuthorityUrlByEntityId.set(id, authorityUrl);
  }
  return {
    assertsOwnershipOf: (entity: any, url: string): boolean =>
      indexAuthorityUrlByEntityId.get(studentVisibilityGateEntityIdKey(entity)) === url,
  };
};

const exactDuplicateGroupByCanonicalPreference = (
  { url, members }: ExactDuplicateUrlGroup,
  leadCountsByEntityId: Map<string, number>,
  authority: IndexUrlAuthority,
): any[] =>
  [...members].sort((a, b) => {
    const byAuthority =
      Number(authority.assertsOwnershipOf(b, url)) - Number(authority.assertsOwnershipOf(a, url));
    if (byAuthority !== 0) return byAuthority;
    const byScore =
      exactDuplicateCanonicalScore(b, leadCountsByEntityId) -
      exactDuplicateCanonicalScore(a, leadCountsByEntityId);
    if (byScore !== 0) return byScore;
    return studentVisibilityGateEntitySortKey(a).localeCompare(
      studentVisibilityGateEntitySortKey(b),
    );
  });

type ExactDuplicateUrlIdGroup = { url: string; memberIds: string[] };

const exactUrlDuplicateGroupEntityIds = (entities: any[]): ExactDuplicateUrlIdGroup[] =>
  exactDuplicateUrlGroups(entities)
    .map(({ url, members }) => ({
      url,
      memberIds: uniqueStrings(members.map((entity) => studentVisibilityGateEntityIdKey(entity))),
    }))
    .filter(({ memberIds }) => memberIds.length > 1);

export function selectExactUrlDuplicateRiskEntityIds(
  entities: any[],
  leadRows: any[] = [],
): Set<string> {
  const leadCountsByEntityId = leadCountsByEntityIdFrom(leadRows);
  // Index authority decides WHICH member of a group is the canonical; it never
  // exempts a member from being called a duplicate in some other group. A row holds
  // authority over one address but collides with different rows on other URLs, so an
  // exemption keyed on the row rather than the group made it immune everywhere: two
  // LAB pairs on one normalized URL each had no duplicate reason on either member
  // and a student read one research home as two cards (#2970). The case the
  // exemption was written for - a pair colliding on two URLs at once, each row the
  // loser of one group - is what `selectDuplicateGroupSurvivorEntityIds` resolves,
  // and `duplicateClusterByReleasePreference` already spends that cluster's single
  // release on the index-published member.
  const authority = indexUrlAuthorityOver(entities);
  const duplicateIds = new Set<string>();
  for (const group of exactDuplicateUrlGroups(entities)) {
    const canonicalId = studentVisibilityGateEntityIdKey(
      exactDuplicateGroupByCanonicalPreference(group, leadCountsByEntityId, authority)[0],
    );
    for (const entity of group.members) {
      const id = studentVisibilityGateEntityIdKey(entity);
      if (id && id !== canonicalId) duplicateIds.add(id);
    }
  }
  return duplicateIds;
}

/**
 * The duplicate relations that hold a row, as entity-id groups whose first member
 * is the relation's own canonical. A duplicate hold is a claim about a PAIR of
 * rows, so reconciling holds needs the relation rather than the reason alone.
 */
export type DuplicateRelationGroups = readonly (readonly string[])[];

const duplicateClusterRootByEntityId = (
  relationGroups: DuplicateRelationGroups,
): Map<string, string> => {
  const parentById = new Map<string, string>();
  const rootOf = (id: string): string => {
    const parent = parentById.get(id);
    if (parent === undefined || parent === id) {
      parentById.set(id, id);
      return id;
    }
    const root = rootOf(parent);
    parentById.set(id, root);
    return root;
  };
  for (const group of relationGroups) {
    for (const id of group) {
      const root = rootOf(group[0]);
      const merged = rootOf(id);
      if (root !== merged) parentById.set(merged, root);
    }
  }
  return new Map([...parentById.keys()].map((id) => [id, rootOf(id)]));
};

const canClearLeadRequirement = (entity: any, leadCount: number): boolean =>
  leadCount > 0 || isProgramLikeResearchEntity(entity) || isOrganizationalResearchEntity(entity);

const duplicateClusterByReleasePreference = (
  memberIds: string[],
  entityById: Map<string, any>,
  leadCountsByEntityId: Map<string, number>,
  assertsIndexUrlOwnership: (entityId: string) => boolean,
): string[] =>
  [...memberIds].sort((a, b) => {
    // A row with no lead and no lead exemption is held by `missing_lead` whatever
    // this does, so spending the cluster's single release on it leaves the cluster
    // dark exactly as before.
    const byLeadReachability =
      Number(canClearLeadRequirement(entityById.get(b), leadCountsByEntityId.get(b) || 0)) -
      Number(canClearLeadRequirement(entityById.get(a), leadCountsByEntityId.get(a) || 0));
    if (byLeadReachability !== 0) return byLeadReachability;
    const byIndexUrlAuthority =
      Number(assertsIndexUrlOwnership(b)) - Number(assertsIndexUrlOwnership(a));
    if (byIndexUrlAuthority !== 0) return byIndexUrlAuthority;
    const byScore =
      exactDuplicateCanonicalScore(entityById.get(b), leadCountsByEntityId) -
      exactDuplicateCanonicalScore(entityById.get(a), leadCountsByEntityId);
    if (byScore !== 0) return byScore;
    return studentVisibilityGateEntitySortKey(entityById.get(a)).localeCompare(
      studentVisibilityGateEntitySortKey(entityById.get(b)),
    );
  });

/**
 * The one member of each duplicate cluster that must NOT be called a duplicate,
 * because every member of the cluster already is.
 *
 * Three duplicate relations read the same corpus and each picks its own canonical:
 * `selectExactUrlDuplicateRiskEntityIds` over a shared specific URL, the same-lead
 * dedupe plan over a shared PI, and the profile-area shell check over a person's
 * concrete research home. Nothing reconciles them, so when they disagree on the
 * winner every member of a duplicate-URL group is the loser of one of them and the
 * whole group goes dark - a real researcher or lab with zero student-visible card
 * (#1890). A duplicate hold only means anything if it names a survivor.
 *
 * The survivor question is asked over the CLUSTER, the rows joined transitively by
 * any of those relations, and never over one relation alone. Scoping it to the URL
 * group would withdraw a row's same-PI hold on the strength of its URL group having
 * no survivor, while the PI canonical that hold defers to is serving, and a student
 * would then read one research home as two cards. The cluster also makes the pass
 * order-independent: one release per cluster rather than a greedy walk over
 * overlapping groups whose outcome depended on which group Mongo returned first.
 *
 * It removes only the duplicate reason: a released row still has to clear every
 * other blocker on its own.
 */
export function selectDuplicateGroupSurvivorEntityIds({
  entities,
  leadRows = [],
  duplicateRelationGroups = [],
  duplicateRiskEntityIds,
}: {
  entities: any[];
  leadRows?: any[];
  duplicateRelationGroups?: DuplicateRelationGroups;
  duplicateRiskEntityIds: ReadonlySet<string>;
}): Set<string> {
  const leadCountsByEntityId = leadCountsByEntityIdFrom(leadRows);
  const entityById = new Map<string, any>();
  for (const entity of entities) {
    const id = studentVisibilityGateEntityIdKey(entity);
    if (id) entityById.set(id, entity);
  }

  const urlGroups = exactUrlDuplicateGroupEntityIds(entities);
  const rootById = duplicateClusterRootByEntityId([
    ...urlGroups.map(({ memberIds }) => memberIds),
    ...duplicateRelationGroups
      .map((group) => uniqueStrings([...group]).filter((id) => entityById.has(id)))
      .filter((group) => group.length > 1),
  ]);
  // #1890 is a duplicate-URL group with no survivor, so a cluster joined by no URL
  // group at all is left to the relation that owns it.
  const urlJoinedClusterRoots = new Set(
    urlGroups.map(({ memberIds }) => rootById.get(memberIds[0])),
  );
  const sharedUrlsByClusterRoot = new Map<string, Set<string>>();
  for (const { url, memberIds } of urlGroups) {
    const root = rootById.get(memberIds[0]);
    if (!root) continue;
    sharedUrlsByClusterRoot.set(root, new Set([...(sharedUrlsByClusterRoot.get(root) || []), url]));
  }
  const membersByRoot = new Map<string, string[]>();
  for (const [id, root] of rootById) {
    membersByRoot.set(root, [...(membersByRoot.get(root) || []), id]);
  }

  const survivorIds = new Set<string>();
  for (const [root, memberIds] of membersByRoot) {
    if (memberIds.length < 2 || !urlJoinedClusterRoots.has(root)) continue;
    if (memberIds.some((id) => !duplicateRiskEntityIds.has(id))) continue;
    const clusterSharedUrls = sharedUrlsByClusterRoot.get(root) || new Set<string>();
    const released = duplicateClusterByReleasePreference(
      memberIds,
      entityById,
      leadCountsByEntityId,
      (entityId) => {
        const authorityUrl = researchHomeUrlUnderIndexAuthority(entityById.get(entityId));
        return !!authorityUrl && clusterSharedUrls.has(authorityUrl);
      },
    )[0];
    if (released) survivorIds.add(released);
  }
  return survivorIds;
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const countByEntityId = (rows: Array<{ _id: unknown; count: number }>) =>
  new Map(rows.map((row) => [studentVisibilityGateDocumentId(row._id), row.count]));

const REACH_OUT_PLAUSIBLE_SIGNAL_TYPE = 'REACH_OUT_PLAUSIBLE';

const hasHttpSourceUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

export interface ReachOutPlausibleGateSignal {
  type?: unknown;
  archived?: unknown;
  derivationKey?: unknown;
  source?: { url?: unknown; evidenceIds?: unknown; name?: unknown } | null;
}

// A REACH_OUT_PLAUSIBLE signal is a derived exploratory ways-in, so it inherently
// carries no external http `source.url`; requiring one hides an already-earned
// signal from the action-evidence gate. It still counts only when it is backed by
// a supporting source observation and the entity itself carries an official
// non-grant page, so no weaker or unbacked signal can pass. Signals that already
// carry an http `source.url` are counted by the primary aggregation and excluded
// here to avoid double counting.
export function reachOutPlausibleSignalCreditsActionEvidence(input: {
  signal: ReachOutPlausibleGateSignal;
  entity: {
    websiteUrl?: unknown;
    website?: unknown;
    sourceUrls?: unknown;
    // Declared because `officialNonGrantSourceUrl` reads it to exclude a known-dead
    // URL. Omitting it here made a health-aware helper read as blind, and a caller
    // that built a fresh literal would have silently disabled that exclusion.
    sourceLinkHealth?: unknown;
  };
}): boolean {
  const { signal, entity } = input;
  if (signal.archived === true) return false;
  if (signal.type !== REACH_OUT_PLAUSIBLE_SIGNAL_TYPE) return false;
  if (
    typeof signal.derivationKey === 'string' &&
    IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS.has(signal.derivationKey)
  ) {
    return false;
  }
  if (hasHttpSourceUrl(signal.source?.url)) return false;
  const evidenceIds = Array.isArray(signal.source?.evidenceIds) ? signal.source?.evidenceIds : [];
  if (evidenceIds.length === 0) return false;
  return Boolean(officialNonGrantSourceUrl(entity));
}

const profileAreaDuplicateCounterpartEntityTypes = new Set(['LAB', 'FACULTY_PROJECT']);

const profileAreaDuplicateCounterpartKinds = new Set(['lab', 'group', 'project']);

export function isProfileAreaDuplicateCounterpart(
  entity: Record<string, any>,
  leadRow: Record<string, any>,
): boolean {
  if (String(leadRow.role || '').toLowerCase() !== 'pi') return false;
  const entityType = String(entity.entityType || '').toUpperCase();
  const kind = String(entity.kind || '').toLowerCase();
  return (
    profileAreaDuplicateCounterpartEntityTypes.has(entityType) ||
    profileAreaDuplicateCounterpartKinds.has(kind)
  );
}

function buildSamePiVisibilityDedupeRows(args: {
  entities: any[];
  leadRows: any[];
  extraEntitiesByUserId?: Map<string, any[]>;
}): ResearchEntityPiDedupeRow[] {
  const entityById = new Map(
    args.entities.map((entity) => [studentVisibilityGateDocumentId(entity._id), entity]),
  );
  const leadRowsByUserId = new Map<string, any[]>();
  for (const row of args.leadRows) {
    const userId = studentVisibilityGateDocumentId(row.userId);
    // Any lead role, not `pi` alone. The question this grouping asks is whether one
    // person heads two of these records, and a person who is PI of a synthesized
    // placeholder row and DIRECTOR of their real lab heads both. Restricting to `pi`
    // dropped the lab out of that person's group, left the group below two entities,
    // and discarded it, so the placeholder stayed student-visible beside the lab it
    // duplicates (#2732). `LEAD_ROLE_LEGACY_LABELS` already treats these
    // four as leads everywhere else in this gate.
    if (!userId || !LEAD_ROLE_LEGACY_LABELS.has(row.role)) continue;
    leadRowsByUserId.set(userId, [...(leadRowsByUserId.get(userId) || []), row]);
  }

  return Array.from(leadRowsByUserId.entries())
    .map(([userId, rows]) => {
      const entityIds = new Set<string>();
      const entities = [
        ...rows
          .map((row) => entityById.get(studentVisibilityGateDocumentId(row.researchEntityId)))
          .filter(Boolean),
        ...(args.extraEntitiesByUserId?.get(userId) || []),
      ]
        .filter((entity: any) => {
          const id = studentVisibilityGateDocumentId(entity._id);
          if (entityIds.has(id)) return false;
          entityIds.add(id);
          return true;
        })
        .map(serializeEntityForDedupe);
      const lead = rows.find((row) => row.user) || rows[0] || {};
      return {
        userId,
        normalizedName: `same-pi:${userId}`,
        piFirstName: lead.user?.fname,
        piLastName: lead.user?.lname,
        entities,
      };
    })
    .filter((row) => row.entities.length > 1);
}

const normalizedDedupeName = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

function isFullPersonLabDedupeName(normalizedName: string): boolean {
  const tokens = normalizedName
    .replace(/\s+lab$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return /\s+lab$/i.test(normalizedName) && tokens.length >= 2;
}

export function serializeEntityForDedupe(
  entity: any,
): ResearchEntityPiDedupeRow['entities'][number] {
  return {
    id: studentVisibilityGateDocumentId(entity._id),
    slug: entity.slug,
    name: entity.name,
    kind: entity.kind,
    entityType: entity.entityType,
    websiteUrl: entity.websiteUrl,
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
    sourceUrls: entity.sourceUrls,
    // Carried so a dedupe decision can tell a live URL from one the corpus knows
    // is gone. Without it the survivor could be chosen on the strength of a 404.
    sourceLinkHealth: entity.sourceLinkHealth,
    departments: entity.departments,
    researchAreas: entity.researchAreas,
  };
}

function profileAreaNamesForVisibilityPi(firstName: unknown, lastName: unknown): string[] {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first || !last) return [];
  return [`${first} ${last} Lab`, `${first} ${last} Laboratory`, `${first} ${last} Research`];
}

function buildNameOnlyVisibilityDedupeRows(args: {
  entities: any[];
  leadsByEntityId: Map<string, any[]>;
}): ResearchEntityPiDedupeRow[] {
  const entitiesByName = new Map<string, any[]>();
  for (const entity of args.entities) {
    const normalizedName = normalizedDedupeName(entity.name);
    if (!normalizedName) continue;
    entitiesByName.set(normalizedName, [...(entitiesByName.get(normalizedName) || []), entity]);
  }

  return Array.from(entitiesByName.entries())
    .filter(([, entities]) => entities.length > 1)
    .map((entry): ResearchEntityPiDedupeRow | null => {
      const [normalizedName, entities] = entry;
      const piUserIds = new Set<string>();
      for (const entity of entities) {
        for (const lead of args.leadsByEntityId.get(studentVisibilityGateDocumentId(entity._id)) ||
          []) {
          const userId = studentVisibilityGateDocumentId(lead.userId);
          if (lead.role === 'pi' && userId) piUserIds.add(userId);
        }
      }
      if (piUserIds.size > 1) return null;
      if (piUserIds.size === 0 && !isFullPersonLabDedupeName(normalizedName)) return null;
      const userId = Array.from(piUserIds)[0] || `name:${normalizedName}`;
      return {
        userId,
        normalizedName,
        entities: entities.map(serializeEntityForDedupe),
      };
    })
    .filter((row): row is ResearchEntityPiDedupeRow => !!row);
}

const defaultGateDeps: StudentVisibilityGateDeps = {
  async updateRecordVisibility(collection, recordId, patch, options) {
    const model: any = collection === 'research' ? ResearchEntity : Fellowship;
    await model.updateOne({ _id: recordId }, { $set: patch }, { timestamps: options.timestamps });
  },
  async upsertOpenQueueItem(item) {
    const now = new Date();
    await VisibilityReleaseQueueItem.updateOne(
      { collection: item.collection, recordId: item.recordId, status: 'open' },
      {
        $set: {
          ...item,
          lastSeenAt: now,
          resolvedAt: undefined,
          resolvedByTier: '',
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true },
    );
  },
  async resolveQueueItem(collection, recordId, metadata) {
    const now = new Date();
    await VisibilityReleaseQueueItem.updateMany(
      { collection, recordId, status: 'open' },
      {
        $set: {
          status: 'resolved',
          resolvedAt: now,
          resolvedByTier: metadata.resolvedByTier,
          lastSeenAt: now,
        },
      },
    );
  },
  async resolveArchivedResearchQueueItems() {
    return resolveArchivedResearchQueueItems();
  },
  async clearArchivedResearchStudentVisibility() {
    return clearArchivedResearchStudentVisibility();
  },
};

const archivedQueueResolutionMessage =
  'Archived duplicate or suppressed research entity; no student-visible repair needed.';

const absentQueueResolutionMessage = 'Research entity no longer exists; nothing left to repair.';

/**
 * Splits the queued record ids into the two resolvable populations, so the reason an
 * item closed is recorded rather than inferred. A row that is present and not
 * archived is in neither: it is still genuinely queued.
 */
export function partitionResolvableQueueRecordIds(
  queuedRecordIds: readonly string[],
  presentRecordIds: ReadonlySet<string>,
  archivedRecordIds: ReadonlySet<string>,
): { archived: string[]; absent: string[] } {
  const archived: string[] = [];
  const absent: string[] = [];
  for (const id of queuedRecordIds) {
    if (!presentRecordIds.has(id)) absent.push(id);
    else if (archivedRecordIds.has(id)) archived.push(id);
  }
  return { archived, absent };
}

export function normalizeStudentVisibilityGateObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return STUDENT_VISIBILITY_GATE_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

function toStudentVisibilityGateObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeStudentVisibilityGateObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

function validObjectIdStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeStudentVisibilityGateObjectId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export async function resolveArchivedResearchQueueItems(now = new Date()): Promise<number> {
  const openRows = await VisibilityReleaseQueueItem.find({
    collection: 'research',
    status: 'open',
  })
    .select('recordId')
    .lean();
  const recordIds = validObjectIdStrings(openRows.map((row) => row.recordId));
  if (recordIds.length === 0) return 0;

  const archivedEntities = await ResearchEntity.find({
    _id: { $in: recordIds.map((id) => toStudentVisibilityGateObjectId(id)).filter(Boolean) },
    archived: true,
  })
    .select('_id')
    .lean();
  const archivedRecordIds = archivedEntities.map((entity) =>
    studentVisibilityGateDocumentId(entity._id),
  );

  // A row that no longer exists returns nothing from the query above, so matching
  // only on `archived: true` left its item open forever: no gate run could ever
  // close an item whose subject had been deleted rather than archived. Absence is
  // resolution here, unlike on the citation side where silence is deliberately not
  // death, because the item exists to describe a row that was supposed to be there
  // (#2870).
  const presentRecordIds = new Set(
    (
      await ResearchEntity.find({
        _id: { $in: recordIds.map((id) => toStudentVisibilityGateObjectId(id)).filter(Boolean) },
      })
        .select('_id')
        .lean()
    ).map((entity) => studentVisibilityGateDocumentId(entity._id)),
  );
  const { absent: missingRecordIds } = partitionResolvableQueueRecordIds(
    recordIds,
    presentRecordIds,
    new Set(archivedRecordIds),
  );

  let missingResolved = 0;
  if (missingRecordIds.length > 0) {
    const missing = await VisibilityReleaseQueueItem.updateMany(
      {
        collection: 'research',
        recordId: { $in: missingRecordIds },
        status: 'open',
      },
      {
        $set: {
          status: 'suppressed',
          resolvedAt: now,
          resolvedByTier: 'suppressed',
          lastSeenAt: now,
          repairStatus: 'resolved',
          blockerReasons: ['absent_research_entity'],
          remainingBlockers: ['absent_research_entity'],
          nextRepairAction: absentQueueResolutionMessage,
        },
      },
    );
    missingResolved = missing.modifiedCount || 0;
  }

  if (archivedRecordIds.length === 0) return missingResolved;

  const result = await VisibilityReleaseQueueItem.updateMany(
    {
      collection: 'research',
      recordId: { $in: archivedRecordIds },
      status: 'open',
    },
    {
      $set: {
        status: 'suppressed',
        resolvedAt: now,
        resolvedByTier: 'suppressed',
        lastSeenAt: now,
        repairStatus: 'resolved',
        blockerReasons: ['archived_research_entity'],
        remainingBlockers: ['archived_research_entity'],
        nextRepairAction: archivedQueueResolutionMessage,
      },
    },
  );
  return (result.modifiedCount || 0) + missingResolved;
}

/**
 * Withdraws the stored student-visibility verdict from every archived research
 * row. The planner scopes itself to live rows, so an archived row is never
 * re-gated and keeps whichever tier and reasons it held when it was last seen;
 * 632 archived Development rows stored `student_ready` and every tier-less row
 * in the corpus was archived, which made any count grouped by tier without an
 * `archived` filter over-report (#2896).
 *
 * This runs as part of the gate apply rather than at each of the ~20 sites that
 * set `archived: true`, so a lane that archives a row and never re-gates it is
 * still reconciled. It is idempotent: once the corpus is clean the filter
 * matches nothing.
 */
export async function clearArchivedResearchStudentVisibility(): Promise<number> {
  const result = await ResearchEntity.updateMany(archivedStudentVisibilityVerdictFilter(), {
    $unset: clearedStudentVisibilityVerdict(),
  });
  return result.modifiedCount || 0;
}

export async function runStudentVisibilityGateForPlans(
  plans: StudentVisibilityGatePlan[],
  options: {
    mode: StudentVisibilityGateMode;
    collection?: StudentVisibilityGateCollection;
    deps?: StudentVisibilityGateDeps;
  },
): Promise<StudentVisibilityGateReport> {
  const deps = options.deps || defaultGateDeps;
  const reasonCounts: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const counts = {
    scanned: plans.length,
    promoted: 0,
    held: 0,
    resolved: 0,
    changed: 0,
    unexplainedHeld: 0,
  };

  for (const plan of plans) {
    const publicSafe = PUBLIC_TIERS.has(plan.tier);
    if (publicSafe) {
      counts.promoted += 1;
      counts.resolved += 1;
    } else {
      counts.held += 1;
    }
    if (isUnexplainedHeldVisibilityPlan(plan)) counts.unexplainedHeld += 1;
    const materiallyChanged = isStudentVisibilityGatePlanMateriallyChanged(plan);
    if (materiallyChanged) counts.changed += 1;
    for (const reason of plan.reasons) {
      increment(reasonCounts, reason);
      if (isBlockingVisibilityReason(reason)) increment(blockerCounts, reason);
    }
    for (const sourceName of plan.sourceNames) increment(sourceCounts, sourceName);

    if (options.mode !== 'apply') continue;

    await deps.updateRecordVisibility(
      plan.collection,
      plan.recordId,
      studentVisibilityGateRecordPatch(plan, new Date()),
      { timestamps: materiallyChanged },
    );

    if (publicSafe) {
      await deps.resolveQueueItem(plan.collection, plan.recordId, { resolvedByTier: plan.tier });
    } else if (plan.tier === 'suppressed') {
      await VisibilityReleaseQueueItem.updateMany(
        { collection: plan.collection, recordId: plan.recordId, status: 'open' },
        {
          $set: {
            status: 'suppressed',
            resolvedAt: new Date(),
            resolvedByTier: plan.tier,
            lastSeenAt: new Date(),
          },
        },
      );
    } else {
      const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
      await deps.upsertOpenQueueItem({
        collection: plan.collection,
        recordId: plan.recordId,
        label: plan.label,
        currentTier: plan.currentTier,
        computedTier: plan.computedTier,
        targetTier: plan.tier,
        blockerReasons,
        evidenceSignals: plan.reasons.filter((reason) => !isBlockingVisibilityReason(reason)),
        sourceNames: plan.sourceNames,
        nextRepairAction: plan.nextRepairAction,
        repairStage: repairStageForReasons(blockerReasons),
        repairStatus: 'queued',
        remainingBlockers: blockerReasons,
        status: 'open',
      });
    }
  }

  if (options.mode === 'apply') {
    await deps.resolveArchivedResearchQueueItems?.();
    await deps.clearArchivedResearchStudentVisibility?.();
  }

  return {
    mode: options.mode,
    collection: options.collection || 'all',
    scanned: plans.length,
    counts,
    reasonCounts,
    blockerCounts,
    sourceCounts,
    samples: plans.slice(0, 20),
  };
}

export interface StudentVisibilityGateApplyOps {
  researchOps: any[];
  programOps: any[];
  queueOps: any[];
  /**
   * The `studentVisibilityEvaluatedAt` stamp for rows the gate re-decided and left
   * unchanged, carried apart from `researchOps`/`programOps` because those are the
   * writes that change what a student sees and the Meili resync keys on them (#2604).
   * Folding the stamp into them would resync the whole evaluated scope on every gate
   * run. These ops pass `timestamps: false` because the row did not change, and
   * bumping `updatedAt` on the whole evaluated scope would desynchronize the indexed
   * copy of that field and collapse the materializer's duplicate-title tiebreak.
   */
  researchEvaluationOps: any[];
  programEvaluationOps: any[];
}

const openQueueKey = (collection: string, recordId: unknown): string =>
  `${collection}:${String(recordId)}`;

export function buildStudentVisibilityGateApplyOps(
  plans: StudentVisibilityGatePlan[],
  openQueueKeys: Set<string>,
  now: Date,
): StudentVisibilityGateApplyOps {
  const researchOps: any[] = [];
  const programOps: any[] = [];
  const queueOps: any[] = [];
  const researchEvaluationOps: any[] = [];
  const programEvaluationOps: any[] = [];

  for (const plan of plans) {
    const materiallyChanged = isStudentVisibilityGatePlanMateriallyChanged(plan);
    const update = { $set: studentVisibilityGateRecordPatch(plan, now) };
    if (materiallyChanged) {
      const recordOp = { updateOne: { filter: { _id: plan.recordId }, update } };
      if (plan.collection === 'research') researchOps.push(recordOp);
      else programOps.push(recordOp);
    } else {
      const evaluationOp = {
        updateOne: { filter: { _id: plan.recordId }, update, timestamps: false },
      };
      if (plan.collection === 'research') researchEvaluationOps.push(evaluationOp);
      else programEvaluationOps.push(evaluationOp);
    }

    const hasOpenQueueItem = openQueueKeys.has(openQueueKey(plan.collection, plan.recordId));

    if (PUBLIC_TIERS.has(plan.tier)) {
      if (hasOpenQueueItem) {
        queueOps.push({
          updateMany: {
            filter: { collection: plan.collection, recordId: plan.recordId, status: 'open' },
            update: {
              $set: {
                status: 'resolved',
                resolvedAt: now,
                resolvedByTier: plan.tier,
                lastSeenAt: now,
              },
            },
          },
        });
      }
      continue;
    }

    if (plan.tier === 'suppressed') {
      if (hasOpenQueueItem) {
        const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
        queueOps.push({
          updateMany: {
            filter: { collection: plan.collection, recordId: plan.recordId, status: 'open' },
            update: {
              $set: {
                status: 'suppressed',
                resolvedAt: now,
                resolvedByTier: plan.tier,
                blockerReasons,
                remainingBlockers: blockerReasons,
                lastSeenAt: now,
              },
            },
          },
        });
      }
      continue;
    }

    if (!materiallyChanged && hasOpenQueueItem) continue;

    const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
    queueOps.push({
      updateOne: {
        filter: { collection: plan.collection, recordId: plan.recordId, status: 'open' },
        update: {
          $set: {
            collection: plan.collection,
            recordId: plan.recordId,
            label: plan.label,
            currentTier: plan.currentTier || '',
            computedTier: plan.computedTier,
            targetTier: plan.tier,
            blockerReasons,
            evidenceSignals: plan.reasons.filter((reason) => !isBlockingVisibilityReason(reason)),
            sourceNames: plan.sourceNames,
            nextRepairAction: plan.nextRepairAction,
            repairStage: repairStageForReasons(blockerReasons),
            repairStatus: 'queued',
            remainingBlockers: blockerReasons,
            status: 'open',
            lastSeenAt: now,
            resolvedAt: undefined,
            resolvedByTier: '',
          },
          $setOnInsert: { firstSeenAt: now },
        },
        upsert: true,
      },
    });
  }

  return { researchOps, programOps, queueOps, researchEvaluationOps, programEvaluationOps };
}

async function loadOpenReleaseQueueKeys(plans: StudentVisibilityGatePlan[]): Promise<Set<string>> {
  const recordIds = Array.from(new Set(plans.map((plan) => plan.recordId)));
  if (recordIds.length === 0) return new Set();
  const openItems = await VisibilityReleaseQueueItem.find({
    status: 'open',
    recordId: { $in: recordIds },
  })
    .select('collection recordId')
    .lean();
  return new Set(
    (openItems as unknown as Array<{ collection: string; recordId: unknown }>).map((item) =>
      openQueueKey(item.collection, item.recordId),
    ),
  );
}

export async function applyStudentVisibilityGatePlans(
  plans: StudentVisibilityGatePlan[],
): Promise<StudentVisibilityGateIndexSyncResult> {
  const now = new Date();
  const openQueueKeys = await loadOpenReleaseQueueKeys(plans);
  const { researchOps, programOps, queueOps, researchEvaluationOps, programEvaluationOps } =
    buildStudentVisibilityGateApplyOps(plans, openQueueKeys, now);
  const researchWrites = [...researchOps, ...researchEvaluationOps];
  const programWrites = [...programOps, ...programEvaluationOps];

  await Promise.all([
    researchWrites.length > 0
      ? (ResearchEntity as any).bulkWrite(researchWrites, { ordered: false })
      : undefined,
    programWrites.length > 0
      ? (Fellowship as any).bulkWrite(programWrites, { ordered: false })
      : undefined,
    queueOps.length > 0
      ? (VisibilityReleaseQueueItem as any).bulkWrite(queueOps, { ordered: false })
      : undefined,
  ]);
  await resolveArchivedResearchQueueItems(now);
  await clearArchivedResearchStudentVisibility();
  return syncGatedResearchEntitiesToIndex(researchOps, plans);
}

const GATE_MEILI_SYNC_CHUNK_SIZE = 500;

export interface StudentVisibilityGateIndexDrift {
  plannedResearchRows: number;
  indexedRowsRead: number;
  divergentTierRecordIds: string[];
  missingFromIndex: number;
  indexReadFailed: boolean;
}

export interface StudentVisibilityGateIndexSyncResult extends StudentVisibilityGateIndexDrift {
  syncedRecordIds: string[];
  unsyncedRecordIds: string[];
}

export function studentVisibilityGateIndexSyncBlocker(
  result: StudentVisibilityGateIndexSyncResult,
): string | undefined {
  if (result.indexReadFailed) {
    return 'Could not read the search index, so the applied tiers are unverified and any divergence is unrepaired.';
  }
  if (result.unsyncedRecordIds.length > 0) {
    return `The search index rejected ${result.unsyncedRecordIds.length} of ${result.syncedRecordIds.length + result.unsyncedRecordIds.length} research rows, so browse and search still serve a stale visibility tier for them.`;
  }
  return undefined;
}

/**
 * Compares the tier the index serves against the tier the corpus holds for every
 * row this run planned.
 *
 * Read after the corpus write, so a row this run moved and failed to sync reads as
 * divergent on the next run too. That is the property the plan-keyed sync lacked:
 * once the corpus write has landed the plan is no longer materially changed, so a
 * re-run had nothing to re-sync and reported a clean `changed: 0` over a
 * permanently stale index (#3049, the re-run blindness of #2858).
 */
export async function readStudentVisibilityGateIndexDrift(
  plans: StudentVisibilityGatePlan[],
): Promise<StudentVisibilityGateIndexDrift> {
  const plannedIds = validObjectIdStrings(
    plans.filter((plan) => plan.collection === 'research').map((plan) => plan.recordId),
  );
  const empty: StudentVisibilityGateIndexDrift = {
    plannedResearchRows: plannedIds.length,
    indexedRowsRead: 0,
    divergentTierRecordIds: [],
    missingFromIndex: 0,
    indexReadFailed: false,
  };
  if (plannedIds.length === 0) return empty;

  let indexedTiers: Map<string, unknown>;
  try {
    indexedTiers = await readIndexedFieldByDocumentId('researchEntity', 'studentVisibilityTier');
  } catch (error) {
    console.error(
      '[student-visibility:gate] could not read indexed visibility tiers:',
      sanitizeLogValue(error),
    );
    return { ...empty, indexReadFailed: true };
  }

  const storedRows = (await ResearchEntity.find({
    _id: { $in: plannedIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id studentVisibilityTier')
    .lean()) as unknown as Array<{ _id: unknown; studentVisibilityTier?: string }>;

  const divergentTierRecordIds: string[] = [];
  let missingFromIndex = 0;
  for (const row of storedRows) {
    const recordId = studentVisibilityGateDocumentId(row._id);
    if (!recordId) continue;
    if (!indexedTiers.has(recordId)) {
      missingFromIndex += 1;
      continue;
    }
    const indexedTier = indexedTiers.get(recordId);
    if (String(indexedTier ?? '') !== String(row.studentVisibilityTier ?? '')) {
      divergentTierRecordIds.push(recordId);
    }
  }

  return {
    plannedResearchRows: plannedIds.length,
    indexedRowsRead: indexedTiers.size,
    divergentTierRecordIds,
    missingFromIndex,
    indexReadFailed: false,
  };
}

async function syncGatedResearchEntitiesToIndex(
  researchOps: any[],
  plans: StudentVisibilityGatePlan[],
): Promise<StudentVisibilityGateIndexSyncResult> {
  const changedRecordIds = validObjectIdStrings(
    researchOps.map((op) => op?.updateOne?.filter?._id),
  );
  const drift = await readStudentVisibilityGateIndexDrift(plans);
  const recordIds = Array.from(new Set([...changedRecordIds, ...drift.divergentTierRecordIds]));
  const syncedRecordIds: string[] = [];
  const unsyncedRecordIds: string[] = [];

  for (let start = 0; start < recordIds.length; start += GATE_MEILI_SYNC_CHUNK_SIZE) {
    const batch = recordIds.slice(start, start + GATE_MEILI_SYNC_CHUNK_SIZE);
    const docs = await ResearchEntity.find({
      _id: { $in: batch.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    if (docs.length === 0) continue;
    const submitted = await syncEntities('researchEntity', docs as any);
    if (submitted > 0) syncedRecordIds.push(...batch);
    else unsyncedRecordIds.push(...batch);
  }

  const result: StudentVisibilityGateIndexSyncResult = {
    ...drift,
    syncedRecordIds,
    unsyncedRecordIds,
  };
  const blocker = studentVisibilityGateIndexSyncBlocker(result);
  if (blocker) console.warn(`[student-visibility:gate] ${blocker}`);
  return result;
}

async function planResearchEntityGateUpdates(
  options: Pick<
    StudentVisibilityGateOptions,
    'sourceName' | 'recordIds' | 'limit' | 'suppressDuplicateRisk'
  >,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: { $ne: true } };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.sourceName) {
    const [accessEntityIds, observationEntityIds, observationEntityKeys] = await Promise.all([
      Signal.distinct('researchEntityId', {
        type: { $in: accessSignalTypes },
        'source.name': options.sourceName,
        archived: false,
      }),
      Observation.distinct('entityId', {
        sourceName: options.sourceName,
        entityType: { $in: ['researchEntity', 'researchGroup'] },
        superseded: false,
        entityId: { $exists: true, $ne: null },
      }),
      Observation.distinct('entityKey', {
        sourceName: options.sourceName,
        entityType: { $in: ['researchEntity', 'researchGroup'] },
        superseded: false,
        entityKey: { $exists: true, $ne: '' },
      }),
    ]);
    const sourceEntityIds = [...accessEntityIds, ...observationEntityIds];
    const sourceClauses: Record<string, any>[] = [];
    if (sourceEntityIds.length > 0) sourceClauses.push({ _id: { $in: sourceEntityIds } });
    if (observationEntityKeys.length > 0)
      sourceClauses.push({ slug: { $in: observationEntityKeys } });
    if (match._id) {
      match._id = {
        $in: sourceEntityIds.filter((id: any) => {
          const normalizedId = studentVisibilityGateDocumentId(id);
          return normalizedId && options.recordIds?.includes(normalizedId);
        }),
      };
    } else if (sourceClauses.length === 1) {
      Object.assign(match, sourceClauses[0]);
    } else if (sourceClauses.length > 1) {
      match.$or = sourceClauses;
    } else {
      match._id = { $in: [] };
    }
  }

  const query = ResearchEntity.find(match).select(researchEntityGateProjection).sort({ name: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const entities = await query.lean();
  const needsDuplicateReferenceCorpus =
    Boolean(options.recordIds?.length) ||
    Boolean(options.sourceName) ||
    Boolean(options.limit && Number.isFinite(options.limit));
  const duplicateReferenceEntities = needsDuplicateReferenceCorpus
    ? await ResearchEntity.find({ archived: { $ne: true } })
        .select(researchEntityGateProjection)
        .lean()
    : entities;
  const entityIds = entities.map((entity: any) => entity._id);

  const [
    rosterByEntityId,
    accessRows,
    reachOutPlausibleWithoutHttpSource,
    alternateAccessPathCounts,
  ] = await Promise.all([
    getResearchEntityRosterByEntityId(entityIds),
    Signal.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          type: { $in: [...accessSignalTypes] },
          archived: false,
          'source.url': { $regex: '^https?://', $options: 'i' },
          derivationKey: { $nin: Array.from(IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS) },
        },
      },
      {
        $group: {
          _id: '$researchEntityId',
          count: { $sum: 1 },
          sourceNames: { $addToSet: '$source.name' },
        },
      },
    ]),
    Signal.find({
      researchEntityId: { $in: entityIds },
      type: REACH_OUT_PLAUSIBLE_SIGNAL_TYPE,
      archived: false,
      'source.url': { $not: /^https?:\/\//i },
    })
      .select(
        'researchEntityId type archived derivationKey source.url source.evidenceIds source.name',
      )
      .lean(),
    countResearchEntityAlternateAccessPaths(entityIds),
  ]);

  const buildGateLeadRows = (roster: Map<string, any[]>) =>
    Array.from(roster.values()).flatMap((entries) => studentVisibilityGateLeadRows(entries));

  const leadRows = buildGateLeadRows(rosterByEntityId);
  const duplicateReferenceRosterByEntityId = needsDuplicateReferenceCorpus
    ? await getResearchEntityRosterByEntityId(
        duplicateReferenceEntities.map((entity: any) => entity._id),
      )
    : rosterByEntityId;
  const duplicateReferenceLeadRows = needsDuplicateReferenceCorpus
    ? buildGateLeadRows(duplicateReferenceRosterByEntityId)
    : leadRows;

  const profileAreaNamesByUserId = new Map<string, string[]>();
  for (const row of duplicateReferenceLeadRows) {
    const userId = studentVisibilityGateDocumentId(row.userId);
    if (!userId || profileAreaNamesByUserId.has(userId)) continue;
    profileAreaNamesByUserId.set(
      userId,
      profileAreaNamesForVisibilityPi(row.user.fname, row.user.lname),
    );
  }
  const profileAreaNames = uniqueStrings(Array.from(profileAreaNamesByUserId.values()).flat());
  const profileAreaEntities = profileAreaNames.length
    ? await ResearchEntity.find({ archived: { $ne: true }, name: { $in: profileAreaNames } })
        .select(
          '_id slug name kind entityType websiteUrl sourceUrls sourceLinkHealth departments researchAreas',
        )
        .lean()
    : [];
  const profileAreaEntitiesByUserId = new Map<string, any[]>();
  for (const [userId, names] of profileAreaNamesByUserId.entries()) {
    const nameSet = new Set(names);
    const matches = (profileAreaEntities as any[]).filter((entity) => nameSet.has(entity.name));
    if (matches.length > 0) profileAreaEntitiesByUserId.set(userId, matches);
  }

  const buildLeadsByEntityId = (rows: any[]) => {
    const map = new Map<string, any[]>();
    for (const row of rows) {
      const key = studentVisibilityGateDocumentId(row.researchEntityId);
      map.set(key, [...(map.get(key) || []), row]);
    }
    return map;
  };
  const leadsByEntityId = buildLeadsByEntityId(leadRows);
  // Two corpus loads for the whole pass rather than one per record, which is what
  // `loadResearchEntityLeadPersonNames` exists for: the name-identity authority needs
  // the surname vocabulary and this record's own lead to tell a foreign eponym from a
  // self-naming one, and judging 4,600 records one lookup at a time would be a second
  // query per row (#3499).
  const knownPersonSurnames = await loadKnownPersonSurnameRoster();
  const leadPersonNameByEntityId = await loadResearchEntityLeadPersonNames();
  const duplicateReferenceLeadsByEntityId = needsDuplicateReferenceCorpus
    ? buildLeadsByEntityId(duplicateReferenceLeadRows)
    : leadsByEntityId;
  const accessCounts = countByEntityId(accessRows as any[]);
  const sourceNamesByEntityId = new Map(
    (accessRows as any[]).map((row) => [
      studentVisibilityGateDocumentId(row._id),
      uniqueStrings(row.sourceNames || []),
    ]),
  );
  const entityById = new Map(
    (entities as any[]).map((entity) => [studentVisibilityGateDocumentId(entity._id), entity]),
  );

  for (const signal of reachOutPlausibleWithoutHttpSource as any[]) {
    const entityId = studentVisibilityGateDocumentId(signal.researchEntityId);
    const entity = entityById.get(entityId);
    if (!entity) continue;
    if (!reachOutPlausibleSignalCreditsActionEvidence({ signal, entity })) continue;
    accessCounts.set(entityId, (accessCounts.get(entityId) || 0) + 1);
    const sourceName = typeof signal.source?.name === 'string' ? signal.source.name.trim() : '';
    sourceNamesByEntityId.set(
      entityId,
      uniqueStrings([...(sourceNamesByEntityId.get(entityId) || []), sourceName]),
    );
  }

  /**
   * Entities the person is PI of. Only these may be CALLED a duplicate.
   *
   * Widening the dedupe grouping past `pi` is what lets a person's real lab join the
   * group holding their synthesized placeholder row, which is the whole point (#2732).
   * Left unconstrained it also does the reverse: measured on Development, it newly
   * flagged Yale Cancer Center and two labs carrying their own sites, because someone
   * who DIRECTS a center and leads labs has all of them in one group and the dedupe
   * picks a single canonical. Directing a research home is not duplicating it, so a
   * non-PI-led home may only ever be the canonical.
   */
  const piLedEntityByUser = new Set<string>();
  for (const row of duplicateReferenceLeadRows) {
    if (row.role !== 'pi') continue;
    const userId = studentVisibilityGateDocumentId(row.userId);
    const entityId = studentVisibilityGateDocumentId(row.researchEntityId);
    if (userId && entityId) piLedEntityByUser.add(`${userId}:${entityId}`);
  }
  const samePiDedupePlan = buildResearchEntityPiDedupePlan([
    ...buildSamePiVisibilityDedupeRows({
      entities: duplicateReferenceEntities as any[],
      leadRows: duplicateReferenceLeadRows as any[],
      extraEntitiesByUserId: profileAreaEntitiesByUserId,
    }),
    ...buildNameOnlyVisibilityDedupeRows({
      entities: duplicateReferenceEntities as any[],
      leadsByEntityId: duplicateReferenceLeadsByEntityId,
    }),
  ]);
  const isPiLedEntity = (userId: string, entityId: string): boolean =>
    piLedEntityByUser.has(`${userId}:${entityId}`);
  const samePiDuplicateRiskEntityIds = new Set(
    samePiDuplicateEntityIdsRestrictedToPiLed(samePiDedupePlan, isPiLedEntity),
  );
  const exactUrlDuplicateRiskEntityIds = selectExactUrlDuplicateRiskEntityIds(
    duplicateReferenceEntities as any[],
    duplicateReferenceLeadRows as any[],
  );
  const sharedCitationOnlyEntityIds = selectSharedCitationOnlyEntityIds(
    duplicateReferenceEntities as any[],
  );
  // Read over the duplicate-reference corpus rather than the selected page: the
  // concrete home that makes a shell a duplicate is frequently outside a targeted
  // run's page, and a page-scoped census answered "not a duplicate" for rows the
  // full sweep holds, so the same row flipped between held and released depending on
  // how the gate was invoked.
  const duplicateReferenceEntityById = new Map(
    (duplicateReferenceEntities as any[]).map((entity) => [
      studentVisibilityGateDocumentId(entity._id),
      entity,
    ]),
  );
  const concreteLeadEntityIdsByUserId = new Map<string, string[]>();
  for (const row of duplicateReferenceLeadRows as any[]) {
    const entityId = studentVisibilityGateDocumentId(row.researchEntityId);
    const entity = duplicateReferenceEntityById.get(entityId);
    const userId = studentVisibilityGateDocumentId(row.userId);
    if (
      userId &&
      entity &&
      isConcreteResearchHomeEntity(entity) &&
      isProfileAreaDuplicateCounterpart(entity, row)
    ) {
      concreteLeadEntityIdsByUserId.set(userId, [
        ...(concreteLeadEntityIdsByUserId.get(userId) || []),
        entityId,
      ]);
    }
  }
  const concreteLeadEntityUserIds = new Set(concreteLeadEntityIdsByUserId.keys());

  const isProfileAreaShellDuplicate = (entity: any, id: string): boolean =>
    hasProfileAreaShellDuplicateRisk({
      entity,
      leadMembers: duplicateReferenceLeadsByEntityId.get(id) || [],
      concreteLeadEntityUserIds,
    });
  const duplicateRiskEntityIds = new Set<string>();
  const profileAreaShellRelationGroups: string[][] = [];
  for (const entity of duplicateReferenceEntities as any[]) {
    const id = studentVisibilityGateDocumentId(entity._id);
    if (!id) continue;
    const shellDuplicate = isProfileAreaShellDuplicate(entity, id);
    if (
      shellDuplicate ||
      samePiDuplicateRiskEntityIds.has(id) ||
      exactUrlDuplicateRiskEntityIds.has(id)
    ) {
      duplicateRiskEntityIds.add(id);
    }
    if (!shellDuplicate) continue;
    const concreteCounterpartIds = uniqueStrings(
      (duplicateReferenceLeadsByEntityId.get(id) || []).flatMap(
        (member: any) =>
          concreteLeadEntityIdsByUserId.get(studentVisibilityGateDocumentId(member.userId)) || [],
      ),
    ).filter((counterpartId) => counterpartId !== id);
    if (concreteCounterpartIds.length > 0) {
      profileAreaShellRelationGroups.push([...concreteCounterpartIds, id]);
    }
  }
  const duplicateGroupSurvivorEntityIds = selectDuplicateGroupSurvivorEntityIds({
    entities: duplicateReferenceEntities as any[],
    leadRows: duplicateReferenceLeadRows as any[],
    duplicateRelationGroups: [
      ...samePiDedupePlan.map((group) => [
        group.canonicalEntityId,
        ...piLedRestrictedDuplicateEntityIds(group, isPiLedEntity),
      ]),
      ...profileAreaShellRelationGroups,
    ],
    duplicateRiskEntityIds,
  });

  return entities.map((entity: any) => {
    const recordId = studentVisibilityGateDocumentId(entity._id);
    const leadMembers = leadsByEntityId.get(recordId) || [];
    const isDuplicateGroupSurvivor = duplicateGroupSurvivorEntityIds.has(recordId);
    const result = computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: accessCounts.get(recordId) || 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
      duplicateRisk:
        !options.suppressDuplicateRisk &&
        !isDuplicateGroupSurvivor &&
        (hasProfileAreaShellDuplicateRisk({
          entity,
          leadMembers,
          concreteLeadEntityUserIds,
        }) ||
          samePiDuplicateRiskEntityIds.has(recordId)),
      exactUrlDuplicateRisk:
        !options.suppressDuplicateRisk &&
        !isDuplicateGroupSurvivor &&
        exactUrlDuplicateRiskEntityIds.has(recordId),
      citationsSharedAcrossPersonRows: sharedCitationOnlyEntityIds.has(recordId),
      relatedEntityAccessPathCount: alternateAccessPathCounts.get(recordId) || 0,
      knownPersonSurnames,
      leadPersonName: leadPersonNameByEntityId.get(recordId) || '',
    });
    return {
      collection: 'research' as const,
      recordId,
      label: entity.displayName || entity.name || entity.slug || recordId,
      currentTier: entity.studentVisibilityTier,
      currentComputedTier: entity.studentVisibilityComputedTier,
      currentReasons: Array.isArray(entity.studentVisibilityReasons)
        ? entity.studentVisibilityReasons
        : [],
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: sourceNamesByEntityId.get(recordId) || [],
      nextRepairAction: nextRepairActionForReasons(result.reasons),
      hasResolvedLead: leadMembers.length > 0,
    };
  });
}

async function planProgramGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: false };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.sourceName) match.sourceName = options.sourceName;
  const query = Fellowship.find(match).sort({ title: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const programs = await query.lean();

  return programs.map((program: any) => {
    const recordId = studentVisibilityGateDocumentId(program._id);
    const result = computeProgramStudentVisibility(program);
    return {
      collection: 'programs' as const,
      recordId,
      label: program.title || recordId,
      currentTier: program.studentVisibilityTier,
      currentComputedTier: program.studentVisibilityComputedTier,
      currentReasons: Array.isArray(program.studentVisibilityReasons)
        ? program.studentVisibilityReasons
        : [],
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: uniqueStrings([program.sourceName]),
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

export async function planStudentVisibilityGate(
  options: StudentVisibilityGateOptions,
): Promise<StudentVisibilityGatePlan[]> {
  if (options.suppressDuplicateRisk && options.mode === 'apply') {
    throw new Error(
      'suppressDuplicateRisk is a measurement option and cannot be combined with mode: apply.',
    );
  }
  const [research, programs] = await Promise.all([
    options.collection === 'all' || options.collection === 'research'
      ? planResearchEntityGateUpdates(options)
      : Promise.resolve([]),
    options.collection === 'all' || options.collection === 'programs'
      ? planProgramGateUpdates(options)
      : Promise.resolve([]),
  ]);
  return [...research, ...programs];
}

export function evaluateStudentVisibilityGateLeadResolution(
  plans: StudentVisibilityGatePlan[],
  options: { maxZeroLeadRatio?: number; minLeadRequiringEntities?: number } = {},
): RosterLeadResolutionResult {
  const researchPlans = plans.filter((plan) => plan.collection === 'research');
  const resolvedLeadEntityCount = researchPlans.filter((plan) => plan.hasResolvedLead).length;
  const zeroLeadEntityCount = researchPlans.filter((plan) =>
    plan.reasons.includes('missing_lead'),
  ).length;
  return evaluateRosterLeadResolution({
    resolvedLeadEntityCount,
    zeroLeadEntityCount,
    maxZeroLeadRatio: options.maxZeroLeadRatio,
    minLeadRequiringEntities: options.minLeadRequiringEntities,
  });
}

export async function runStudentVisibilityGate(
  options: StudentVisibilityGateOptions,
): Promise<StudentVisibilityGateReport> {
  const plans = await planStudentVisibilityGate(options);
  const report = await runStudentVisibilityGateForPlans(plans, {
    mode: 'dry-run',
    collection: options.collection,
  });
  report.mode = options.mode;
  if (options.mode === 'apply') {
    const leadResolution = evaluateStudentVisibilityGateLeadResolution(plans);
    if (!leadResolution.safe) {
      throw new Error(`Refusing to apply student visibility gate: ${leadResolution.blocker}`);
    }
    const unexplainedHeldBlocker = studentVisibilityGateUnexplainedHeldBlocker(
      report.counts.unexplainedHeld,
    );
    if (unexplainedHeldBlocker) {
      throw new Error(`Refusing to apply student visibility gate: ${unexplainedHeldBlocker}`);
    }
    await applyStudentVisibilityGatePlans(plans);
  }
  return report;
}
