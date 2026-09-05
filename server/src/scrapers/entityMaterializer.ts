/**
 * Reads pending Observations for a given entity, resolves field values via the
 * ConfidenceResolver, and writes the resolved values back to the entity collection.
 *
 * For person identities, materializes a canonical Researcher/Account (lookup by
 * entityKey, e.g. netid).
 */
import mongoose from 'mongoose';
import { Observation, ObservedEntityType } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import {
  researchGroupKinds,
  researchEntityTypes,
  mapEntityTypeToResearchGroupKind,
  mapResearchGroupKindToEntityType,
  type ResearchEntityType,
  type ResearchGroupKind,
} from '../models/researchAccessTypes';
import { ScrapeRun } from '../models/scrapeRun';
import { Fellowship } from '../models/fellowship';
import {
  buildResearchAreasCardSummary,
  entityDocShortDescriptionForRestatementGuard,
  fullDescriptionQuality,
  isFullDescriptionRestatementOfShortDescription,
  isPoorerThanCardDescription,
  programCardShortDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';
import {
  CARD_SYNTHESIS_MODEL,
  defaultCardSynthesisLLM,
  isUngroundedSynthesizedCard,
  resolveGroundedCardDescription,
  synthesizeGroundedCardDescription,
} from '../utils/groundedCardSynthesis';
import { isProgramTitleQualifierDrift, normalizedProgramTitleKey } from '../utils/programTitle';
import {
  collapseDuplicateResearchHomeSuffix,
  normalizeResearchEntityNameDashes,
  normalizeResearchEntityNameSmartQuotes,
  stripResearchHomeNamePersonCredentials,
  stripTrailingResearchHomeDescription,
} from '../utils/researchEntityNameNormalization';
import {
  isPlaceholderEntityName,
  personScopedResearchEntityNameNamesSomethingElseByUrlPath,
} from '../utils/researchHomeNameIdentityAuthority';
import {
  resolveAllFields,
  resolveFieldRanked,
  ResolverObservation,
  ResolvedField,
} from './confidenceResolver';
import { collapseLatestWins, c4LosslessIngestEnabled } from './observationStore';
import { syncEntity, isSyncableEntityType, deleteFromIndex } from '../services/meiliSyncService';
import { resolveResearchEntityMergeRedirectCanonical } from '../services/researchEntityMergeRedirectService';
import {
  deriveCanonicalKeys,
  resolveCanonical,
  type CandidateEntity,
  type CanonicalKey,
  type CanonicalResolution,
} from './resolveCanonical';
import { recordCanonicalAlias, resolveCanonicalAlias } from '../services/canonicalAliasService';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import { materializeAccessForResearchGroup } from './accessMaterializer';
import { sanitizeObservationField } from './observationFieldSanitizer';
import type { ReportPostMaterializationMetrics } from './runReport';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  sanitizeResearchEntityDescription,
  sanitizeStoredCatalogDescription,
} from '../utils/descriptionHygiene';
import { cleanPublicProfileBio } from '../services/profileService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizePersonTitle } from '../utils/titleHygiene';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isSelfReferentialUrl } from '../utils/urlSafety';
import { normalizePersonNameCasing } from './utils/personNameCasing';
import { givenNamesEquivalent, surnamesCompatible } from './utils/piNameMatch';
import { splitName } from './utils/scraperHelpers';
import {
  isBoilerplatePlatformHostUrl,
  isDirectoryLoaderUrl,
  isFacetedOrSectionIndexUrl,
  isRecordSpecificApplicationPortalUrl,
} from '../utils/researchHomeWebsiteUrl';
import {
  isLikelyOfficialPersonProfileUrl,
  normalizeOfficialProfileDestination,
} from '../services/leadProfileIdentity';
import {
  materializeUndergraduateLogisticsForResearchEntity,
  UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET,
} from './undergraduateLogisticsMaterializer';
import { isPlausibleUndergradEvidenceQuote } from './undergradEvidenceQuoteValidation';
import {
  isHistoricalUndergradEvidence,
  namesNonYaleInstitution,
} from './sources/labMicrositeUndergradLLMExtractor';
import { withResearchEntityWriteTransaction } from '../services/researchEntityWriteTransaction';
import {
  applyResearchEntityOrgUnitCanonicalization,
  getOrgUnitCanonicalizer,
} from './orgUnitCanonicalization';
import {
  applyResearchEntityResearchAreaCanonicalization,
  getResearchAreaCanonicalizer,
} from './researchAreaCanonicalization';
import {
  resolveBackfillWebsiteUrl,
  type WebsiteUrlBackfillResolution,
} from '../scripts/backfillResearchEntityWebsiteUrlsCore';
import {
  archiveCanonicalRoleAssignmentsForPersons,
  archiveSupersededCanonicalRoleAssignments,
  materializeCanonicalMembership,
  resolveCanonicalResearcherId,
  type CanonicalMemberIdentity,
} from './canonicalMembershipMaterializer';
import {
  getResearchEntityRoster,
  type ResearchEntityRosterEntry,
} from '../services/researchEntityMembershipAccessor';
import { resolveResearcherIdForPersonName } from '../services/researcherPersonNameResolver';
import {
  Researcher,
  isValidOrcid,
  researcherDisplayProfileSchema,
  type ResearcherDisplayProfile,
  type ResearcherProfileLink,
} from '../models/researcher';
import { Account } from '../models/account';
import {
  composeOfficialProfileLink,
  supersedesOfficialProfileUrl,
} from '../scripts/backfillResearcherOfficialProfileLinksCore';
import { canonicalScholarCitationUrl } from '../scripts/promoteScholarCandidateProfileLinksCore';
import { RoleAssignment, type RoleAssignmentRosterProvenance } from '../models/roleAssignment';
import {
  reconcileFacultyRosterDeparturesFromRun,
  type FacultyRosterDepartureOutcome,
} from './facultyRosterDepartureReconciler';
import {
  isPersonOrGrantShellSlug,
  personProfileNameTokensFromUrl,
  personProfileSourceMatchesEntity,
  type ResearchEntityIdentity,
} from './utils/personProfileEntityMatch';
import {
  CLEARED_RESEARCH_ENTITY_YALE_STATUS,
  deriveResearchEntityYaleStatus,
  hasEvidencelessInactiveYaleStatus,
  yaleStatusCacheIsWritable,
} from '../utils/researchEntityYaleStatus';

interface MaterializeOptions {
  dryRun?: boolean;
  syncMeilisearch?: boolean;
  synthesizeCardDescription?: (fullDescription: string) => Promise<string>;
  writeOnlyFields?: string[];
}

function defaultMaterializerCardSynthesizer(
  entityName: string,
): (fullDescription: string) => Promise<string> {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return () => Promise.resolve('');
  return (fullDescription) =>
    synthesizeGroundedCardDescription({
      fullDescription,
      entityName,
      callLLM: (llmInput) =>
        defaultCardSynthesisLLM({ ...llmInput, apiKey, model: CARD_SYNTHESIS_MODEL }),
    });
}

function restrictMaterializerSetToFields(
  set: Record<string, unknown>,
  unset: Record<string, ''>,
  confidenceByField: Record<string, number>,
  fields: string[],
): number {
  const valueFields = fields.filter((field) => field in set && field !== 'confidenceByField');
  const keep = new Set<string>();
  for (const field of valueFields) {
    keep.add(field);
    keep.add(`fieldProvenance.${field}`);
  }
  for (const key of Object.keys(set)) {
    if (!keep.has(key)) delete set[key];
  }
  for (const field of valueFields) {
    if (typeof confidenceByField[field] === 'number') {
      set[`confidenceByField.${field}`] = confidenceByField[field];
    }
  }
  for (const key of Object.keys(unset)) {
    if (!fields.includes(key)) delete unset[key];
  }
  if (valueFields.length > 0) set.lastObservedAt = new Date();
  return valueFields.length + Object.keys(unset).length;
}

export interface MaterializedShortDescriptionInput {
  fullDescription?: unknown;
  currentShortDescription?: unknown;
  researchAreas?: unknown;
  manuallyLocked?: boolean;
  isProgramLike?: boolean;
  synthesize: (fullDescription: string) => Promise<string>;
}

/**
 * Whether a freshly resolved `shortDescription` observation is fit to write
 * directly, rather than a truncated or boilerplate scrape artifact. The
 * generic per-field resolver loop below otherwise writes any winning
 * observation value verbatim with no quality check at all - quality gating
 * only ever ran inside the dedicated re-derivation step, and only to decide
 * whether to *replace* an already-written value, never to validate what got
 * written in the first place. A live example: a `lab-microsite-description-llm`
 * observation for the Impulsivity Program was itself truncated mid-sentence
 * ("...and how these relate to"), and without this check it would have won
 * the confidence tie and overwritten the served short outright (issue #1595).
 * Rejecting here just skips the field for this pass - it does not clear an
 * existing value - so the dedicated re-derivation step below still runs
 * against whatever shortDescription is already on the entity.
 *
 * A candidate can also read as a perfectly fine sentence in isolation while
 * naming a topic absent from the entity's own fullDescription - a live
 * example is a named org's org-page microsite blurb that leads with one
 * narrow featured study (Olin Research Center's "Examines the acute effects
 * of...smoked marijuana...driving..." next to a fullDescription about general
 * neuropsychiatric research). `isUngroundedSynthesizedCard` already guards
 * this exact shape at serve time (`researchEntityDto.ts`); reusing it here
 * stops the same ungrounded value from winning the write-time confidence tie
 * over an already-corrected shortDescription in the first place.
 */
function resolvedShortDescriptionCandidateIsUsable(
  candidate: unknown,
  fullDescription: unknown,
  isProgramLike: boolean,
): boolean {
  if (typeof candidate !== 'string' || !candidate.trim()) return false;
  if (isUngroundedSynthesizedCard(candidate, fullDescription)) return false;
  const shortQuality = isProgramLike ? programCardShortDescriptionQuality : shortDescriptionQuality;
  return shortQuality(candidate, fullDescription).isUseful;
}

export async function resolveMaterializedShortDescription(
  input: MaterializedShortDescriptionInput,
): Promise<string | null> {
  if (input.manuallyLocked) return null;
  const shortQuality = input.isProgramLike
    ? programCardShortDescriptionQuality
    : shortDescriptionQuality;
  const current =
    typeof input.currentShortDescription === 'string' ? input.currentShortDescription.trim() : '';
  const isBareResearchAreasFallback =
    !!current &&
    current.toLowerCase() === buildResearchAreasCardSummary(input.researchAreas).toLowerCase();
  if (
    !isBareResearchAreasFallback &&
    shortQuality(input.currentShortDescription, input.fullDescription).isUseful
  ) {
    return null;
  }
  const grounded = await resolveGroundedCardDescription({
    fullDescription: input.fullDescription,
    researchAreas: input.researchAreas,
    isProgramLike: input.isProgramLike,
    synthesize: input.synthesize,
  });
  if (
    grounded &&
    grounded.toLowerCase() !== current.toLowerCase() &&
    shortQuality(grounded, input.fullDescription).isUseful
  ) {
    return grounded;
  }
  return null;
}

interface MaterializeResult {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  fieldsWritten: number;
  conflicts: number;
  created: boolean;
  resolved: Record<string, ResolvedField>;
  postMaterializationMetrics?: ReportPostMaterializationMetrics;
  skipped?: string;
  plannedSet?: Record<string, unknown>;
  plannedUnset?: Record<string, ''>;
}

const OFFICIAL_PROFILE_PI_BACKFILL_SOURCE = 'official-profile-pi-backfill';
// Retained only to fail closed on historical observations after the producer was retired.
const OFFICIAL_PROFILE_PUBLICATIONS_FIELD = 'officialProfilePublications';
const PUBLIC_QUOTE_FIELDS = new Set([
  'undergradEvidenceQuote',
  'undergradRoleEvidenceQuote',
  'contactInstructionsQuote',
  'undergradConstraintQuote',
]);
const MATERIALIZED_DESCRIPTION_FIELDS = new Set([
  'fullDescription',
  'shortDescription',
  'description',
]);
const FELLOWSHIP_DESCRIPTION_FIELDS = new Set(['description', 'summary']);
const MATERIALIZER_MANAGED_FIELDS = new Set(['lastObservedAt', 'sourceContentHash']);
const CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS = ['methods', 'inferredPiUserId'];

function materializerValueAtPath(doc: Record<string, unknown> | null, path: string): unknown {
  if (!doc) return undefined;
  let current: unknown = doc;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function materializerValuesDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// A re-projection over an unchanged observation log recomputes the same field
// values every run; the only guaranteed-different field is the managed
// `lastObservedAt` timestamp. Treat the projection as a no-op when every scoped
// `set` field already equals the stored value (ignoring managed metadata) and
// every `unset` target is already absent, so the write and its redundant search
// re-sync can be skipped. Any path we cannot confidently resolve is treated as a
// change (we never skip a real write).
export function isMaterializerProjectionNoOp(
  entityDoc: Record<string, unknown>,
  set: Record<string, unknown>,
  unset: Record<string, unknown>,
): boolean {
  for (const [path, value] of Object.entries(set)) {
    if (MATERIALIZER_MANAGED_FIELDS.has(path)) continue;
    if (!materializerValuesDeepEqual(materializerValueAtPath(entityDoc, path), value)) return false;
  }
  for (const path of Object.keys(unset)) {
    const current = materializerValueAtPath(entityDoc, path);
    if (current !== undefined && current !== null) return false;
  }
  return true;
}

function isClearableStaleFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
const MATERIALIZER_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeMaterializerObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return MATERIALIZER_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

const materializerDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

function toMaterializerObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeMaterializerObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

export type MaterializerObservationLike = {
  _id?: unknown;
  field?: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date;
  confidence?: number;
};

type InferredPiObservation = {
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date;
  confidence?: number;
};

type RosterMemberMaterializationPatch = {
  filter: Record<string, unknown>;
  update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> };
  fieldsWritten: number;
  conflicts: number;
  resolved: Record<string, ResolvedField>;
  skipped?: string;
};

type ProvenanceResolvedField = ResolvedField & {
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date;
};

function isOfficialProfileBioChromeObservation(observation: MaterializerObservationLike): boolean {
  if (
    observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
    observation.field !== 'bio' ||
    typeof observation.value !== 'string'
  ) {
    return false;
  }

  const value = observation.value.replace(/\s+/g, ' ').trim();
  if (!value) return true;
  if (!cleanPublicProfileBio({ bio: value })) return true;
  if (/@yale\.edu\b/i.test(value)) return true;
  if (
    /\b(?:po box|new haven,?\s*ct|united states|mailing address|contact info|prospect street|west campus drive|kline tower)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /^(?:see my webpage|this professor is accepting)\b/i.test(value) ||
    /^medical research interests(?:\b|(?=[A-Z]))/i.test(value)
  ) {
    return true;
  }
  if (
    /\b(?:google scholar|pubmed)\s+profile\b/i.test(value) ||
    /\b(?:for\s+(?:a\s+)?(?:full\s+list|more)|refer\s+to|visit)\b.{0,140}\b(?:google scholar|pubmed|external link)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (/^department of\b/i.test(value)) return true;
  if (
    value.length < 120 &&
    /\b(?:selected publications?|wins?|elected|awards?|faculty research awards?)\b/i.test(value) &&
    !/\b(?:studies|research(?:es)?|investigates|develops|focuses on|works on)\b/i.test(value)
  ) {
    return true;
  }
  return /^copy link$/i.test(value);
}

function isResearchEntityObservationType(entityType: ObservedEntityType): boolean {
  return entityType === 'researchEntity';
}

export const RETIRED_PROGRAM_RESEARCH_ENTITY_TYPE = 'PROGRAM';

export function isRetiredProgramResearchEntityType(value: unknown): boolean {
  return (
    typeof value === 'string' && value.trim().toUpperCase() === RETIRED_PROGRAM_RESEARCH_ENTITY_TYPE
  );
}

/**
 * `entityType` keeps a value-bearing fingerprint, so an observation asserting the
 * retired `PROGRAM` type is never superseded by a later `INITIATIVE` assertion from
 * the same source and is never pruned. Matching any retained row would therefore
 * freeze every live entity whose type has since healed, so this mirrors the write
 * side and asks only what the projection would actually resolve as the winner.
 */
export function winningObservedEntityTypeIsRetiredProgram(
  observations: MaterializerObservationLike[],
): boolean {
  const entityTypeObservations: ResolverObservation[] = observations
    .filter((observation) => observation.field === 'entityType')
    .map((observation) => ({
      field: 'entityType',
      value: observation.value,
      sourceName: observation.sourceName || '',
      confidence: typeof observation.confidence === 'number' ? observation.confidence : 0,
      observedAt: observation.observedAt instanceof Date ? observation.observedAt : new Date(0),
    }));
  if (entityTypeObservations.length === 0) return false;
  const [winner] = resolveFieldRanked('entityType', entityTypeObservations);
  return isRetiredProgramResearchEntityType(winner?.value);
}

/**
 * Heal a retired-`PROGRAM` entityType assertion into a live entity type using the
 * co-observed `kind` from the same observation set, which already states the
 * classification (issue #2206).
 *
 * Fails closed on purpose. `mapResearchGroupKindToEntityType` defaults an
 * unrecognized kind to `LAB`, so a row carrying no usable `kind` would otherwise
 * be silently minted as a lab. Gate on `researchGroupKinds` first and return
 * undefined instead, leaving the caller to keep skipping.
 */
export function healedEntityTypeForRetiredProgramObservations(
  observations: MaterializerObservationLike[],
): ResearchEntityType | undefined {
  const kindObservations: ResolverObservation[] = observations
    .filter((observation) => observation.field === 'kind')
    .map((observation) => ({
      field: 'kind',
      value: observation.value,
      sourceName: observation.sourceName || '',
      confidence: typeof observation.confidence === 'number' ? observation.confidence : 0,
      observedAt: observation.observedAt instanceof Date ? observation.observedAt : new Date(0),
    }));
  if (kindObservations.length === 0) return undefined;
  const [winner] = resolveFieldRanked('kind', kindObservations);
  const kind = textValue(winner?.value).toLowerCase();
  if (!researchGroupKinds.includes(kind as ResearchGroupKind)) return undefined;
  return mapResearchGroupKindToEntityType(kind);
}

/**
 * Rewrite retired-`PROGRAM` entityType observations to the healed type for this
 * materialization only. The stored observations are left untouched: provenance
 * still points at the source that classified the row, via its own `kind`.
 */
export function withHealedRetiredProgramEntityType<T extends MaterializerObservationLike>(
  observations: T[],
  healedEntityType: ResearchEntityType,
): T[] {
  return observations.map((observation) =>
    observation.field === 'entityType' && isRetiredProgramResearchEntityType(observation.value)
      ? { ...observation, value: healedEntityType }
      : observation,
  );
}

function hasNonEmptyStringArray(...values: unknown[]): boolean {
  return values.some((value) => Array.isArray(value) && value.length > 0);
}

const DESCRIPTION_AREA_DERIVATION_ENTITY_TYPES = new Set(['LAB', 'FACULTY_RESEARCH_AREA']);

// LAB/FACULTY_RESEARCH_AREA entities seeded from PI-centric sources (NIH RePORTER,
// ORCID, official-profile PI backfill) carry a fullDescription but no researchAreas
// observation, so `set.researchAreas` is never populated and the canonicalizer below
// returns early - leaving the row with empty chips even when its own description names
// clear topics. Such a row is then held out of student_ready on the research-area facet
// gate (missing_facet_signal) despite being otherwise complete (issue #1717 covered only
// already-student_ready rows). When both are genuinely empty, derive chips from the
// entity's own name/short/full via the
// curated canonical phrase index and seed `set` as if an observation had written them, so
// the normal canonicalization pass still owns dedup and department-duplicate rejection.
async function applyDescriptionResearchAreaDerivation(
  set: Record<string, unknown>,
  entityDoc: Record<string, unknown> | null,
): Promise<void> {
  const entityType = set.entityType ?? entityDoc?.entityType;
  if (typeof entityType !== 'string' || !DESCRIPTION_AREA_DERIVATION_ENTITY_TYPES.has(entityType)) {
    return;
  }
  if (hasNonEmptyStringArray(set.researchAreas, entityDoc?.researchAreas)) return;

  const textBlob = [
    set.name ?? set.displayName ?? entityDoc?.name ?? entityDoc?.displayName,
    set.shortDescription ?? entityDoc?.shortDescription,
    set.fullDescription ?? entityDoc?.fullDescription,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
  if (!textBlob) return;

  try {
    const canonicalizer = await getResearchAreaCanonicalizer();
    const derived = canonicalizer.deriveResearchAreasFromText(textBlob);
    if (derived.length > 0) set.researchAreas = derived;
  } catch {
    // Canonicalizer load failure is non-fatal: leave researchAreas untouched.
  }
}

const RETIRED_ACCESS_OBSERVATION_FIELDS = new Set(['acceptingUndergrads', 'openness']);

export function shouldIgnoreObservationForEntityMaterialization(
  entityType: ObservedEntityType,
  observation: MaterializerObservationLike,
): boolean {
  if (observation.field && MATERIALIZER_MANAGED_FIELDS.has(observation.field)) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    observation.field &&
    UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET.has(observation.field)
  ) {
    return true;
  }
  if (entityType === 'user' && observation.field === OFFICIAL_PROFILE_PUBLICATIONS_FIELD) {
    return true;
  }
  if (entityType === 'user' && isOfficialProfileBioChromeObservation(observation)) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    observation.field === 'undergradEvidenceQuote' &&
    typeof observation.value === 'string' &&
    (!isPlausibleUndergradEvidenceQuote(observation.value) ||
      isHistoricalUndergradEvidence(observation.value) ||
      namesNonYaleInstitution(observation.value))
  ) {
    return true;
  }
  return (
    isResearchEntityObservationType(entityType) &&
    !!observation.field &&
    RETIRED_ACCESS_OBSERVATION_FIELDS.has(observation.field)
  );
}

/**
 * The single write-side field transform for the projection: it composes the
 * ingest-time sanitizer (`sanitizeObservationField`) and the materialize-time
 * transform (`materializedFieldValue`), which already share the same
 * descriptionHygiene/titleHygiene/contactRedaction primitives, into one pass.
 * On an already-ingest-sanitized observation the ingest step is a no-op, so this
 * is byte-identical to the prior materialize path; it additionally cleans values
 * that reached the projection without passing through `appendObservations` (for
 * example manual values). Rejection stays an ingest concern (a rejected value is
 * cleaned, never dropped, here), so this never removes a field the materializer
 * would have written.
 */
export function sanitizeProjectedField(
  entityType: ObservedEntityType,
  field: string,
  value: unknown,
  existingValue?: unknown,
  entityIdentity?: ResearchEntityIdentity,
): unknown {
  const ingest = sanitizeObservationField(entityType, field, value);
  const ingestCleaned = ingest.rejected ? value : ingest.value;
  return materializedFieldValue(entityType, field, ingestCleaned, existingValue, entityIdentity);
}

export function materializedFieldValue(
  entityType: ObservedEntityType,
  field: string,
  value: unknown,
  existingValue?: unknown,
  entityIdentity?: ResearchEntityIdentity,
): unknown {
  if (isResearchEntityObservationType(entityType) && field === 'sourceUrls') {
    return sanitizeResearchEntitySourceUrlsForMaterialization(value, entityIdentity);
  }
  if (isResearchEntityObservationType(entityType) && field === 'kind') {
    return typeof value === 'string' && researchGroupKinds.includes(value as any)
      ? value
      : existingValue;
  }
  if (isResearchEntityObservationType(entityType) && field === 'entityType') {
    return typeof value === 'string' && researchEntityTypes.includes(value as any)
      ? value
      : existingValue;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    MATERIALIZED_DESCRIPTION_FIELDS.has(field) &&
    typeof value === 'string'
  ) {
    return sanitizeResearchEntityDescription(value);
  }
  if (
    entityType === 'fellowship' &&
    FELLOWSHIP_DESCRIPTION_FIELDS.has(field) &&
    typeof value === 'string'
  ) {
    return sanitizeStoredCatalogDescription(value);
  }
  if (
    isResearchEntityObservationType(entityType) &&
    PUBLIC_QUOTE_FIELDS.has(field) &&
    typeof value === 'string'
  ) {
    return redactDirectContactInfo(value);
  }
  if (
    isResearchEntityObservationType(entityType) &&
    (field === 'name' || field === 'displayName') &&
    typeof value === 'string'
  ) {
    return normalizeResearchEntityNameSmartQuotes(
      normalizeResearchEntityNameDashes(
        collapseDuplicateResearchHomeSuffix(
          stripResearchHomeNamePersonCredentials(stripTrailingResearchHomeDescription(value)),
        ),
      ),
    );
  }
  if (
    entityType === 'user' &&
    (field === 'fname' || field === 'lname') &&
    typeof value === 'string'
  ) {
    return normalizePersonNameCasing(value);
  }
  if (isResearchEntityObservationType(entityType) && field === 'rosterEnrichment') {
    return rosterEnrichmentWithRetainedSuccessfulSnapshot(value, existingValue);
  }
  return value;
}

const grantIdentity = (value: unknown): string => {
  const grant = objectRecord(value);
  const id = textValue(grant.id);
  return id ? `id:${id.toLowerCase()}` : `record:${JSON.stringify(grant)}`;
};

export function aggregateResearchEntityGrantEvidence(observations: MaterializerObservationLike[]): {
  recentGrants?: unknown[];
  recentGrantCount?: number;
  fundingAgencies?: string[];
} {
  const latest = new Map<string, MaterializerObservationLike>();
  for (const observation of observations) {
    if (
      observation.field !== 'recentGrants' &&
      observation.field !== 'recentGrantCount' &&
      observation.field !== 'fundingAgencies'
    )
      continue;
    const key = `${observation.sourceName || ''}:${observation.field}`;
    const current = latest.get(key);
    if (
      !current ||
      (observation.observedAt?.getTime() || 0) >= (current.observedAt?.getTime() || 0)
    ) {
      latest.set(key, observation);
    }
  }
  const grants = new Map<string, unknown>();
  const agencies = new Map<string, string>();
  let hasGrantSnapshot = false;
  let hasGrantCountSnapshot = false;
  let hasAgencySnapshot = false;
  let recentGrantCount = 0;
  for (const observation of latest.values()) {
    if (observation.field === 'recentGrants' && Array.isArray(observation.value)) {
      hasGrantSnapshot = true;
      for (const grant of observation.value) grants.set(grantIdentity(grant), grant);
    }
    if (observation.field === 'fundingAgencies' && Array.isArray(observation.value)) {
      hasAgencySnapshot = true;
      for (const agency of observation.value) {
        const normalized = textValue(agency);
        if (normalized && !agencies.has(normalized.toLowerCase())) {
          agencies.set(normalized.toLowerCase(), normalized);
        }
      }
    }
    if (
      observation.field === 'recentGrantCount' &&
      typeof observation.value === 'number' &&
      Number.isFinite(observation.value) &&
      observation.value >= 0
    ) {
      hasGrantCountSnapshot = true;
      recentGrantCount += Math.floor(observation.value);
    }
  }
  const recentGrants = [...grants.values()]
    .sort((left, right) => {
      const leftTime = new Date(objectRecord(left).startDate as any).getTime();
      const rightTime = new Date(objectRecord(right).startDate as any).getTime();
      return (
        (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
      );
    })
    .slice(0, 10);
  return {
    ...(hasGrantSnapshot ? { recentGrants } : {}),
    ...(hasGrantCountSnapshot ? { recentGrantCount } : {}),
    ...(hasAgencySnapshot ? { fundingAgencies: [...agencies.values()] } : {}),
  };
}

const successfulRosterSnapshot = (value: unknown): Record<string, unknown> | undefined => {
  const enrichment = objectRecord(value);
  if (!['current', 'partial'].includes(textValue(enrichment.state))) return undefined;
  const memberKeys = Array.isArray(enrichment.memberKeys)
    ? Array.from(new Set(enrichment.memberKeys.map(textValue).filter(Boolean))).slice(0, 40)
    : [];
  const sourceUrl = textValue(enrichment.sourceUrl);
  const observedAt = enrichment.observedAt;
  const freshnessExpiresAt = enrichment.freshnessExpiresAt;
  if (memberKeys.length === 0 || !sourceUrl || !observedAt || !freshnessExpiresAt) return undefined;
  return {
    state: enrichment.state,
    memberKeys,
    sourceUrl,
    ...(enrichment.sourcePublishedAt ? { sourcePublishedAt: enrichment.sourcePublishedAt } : {}),
    observedAt,
    freshnessExpiresAt,
  };
};

export function rosterEnrichmentWithRetainedSuccessfulSnapshot(
  value: unknown,
  existingValue?: unknown,
): unknown {
  const enrichment = objectRecord(value);
  const currentSnapshot = successfulRosterSnapshot(enrichment);
  if (currentSnapshot) return { ...enrichment, lastSuccessfulSnapshot: currentSnapshot };
  if (textValue(enrichment.state) !== 'failed') return enrichment;

  const existing = objectRecord(existingValue);
  const retained =
    successfulRosterSnapshot(existing) ||
    successfulRosterSnapshot(objectRecord(existing.lastSuccessfulSnapshot));
  return retained ? { ...enrichment, lastSuccessfulSnapshot: retained } : enrichment;
}

const RESEARCH_ENTITY_CONTENT_PAGE_SOURCE_PATH_RE =
  /(^|[-/])(blog|blogs|news|events|calendar|newsletter|article|stories|press|podcast|video|webinar)([-/]|$)/i;

export function isResearchEntityContentPageSourceUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (!raw) return false;
  try {
    return RESEARCH_ENTITY_CONTENT_PAGE_SOURCE_PATH_RE.test(new URL(raw).pathname);
  } catch {
    return RESEARCH_ENTITY_CONTENT_PAGE_SOURCE_PATH_RE.test(raw);
  }
}

export function sanitizeResearchEntitySourceUrlsForMaterialization(
  value: unknown,
  entityIdentity?: ResearchEntityIdentity,
): unknown {
  const asArray = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? [value]
      : [];
  const kept = asArray.filter(
    (url) =>
      typeof url === 'string' &&
      url.trim() &&
      !isResearchEntityContentPageSourceUrl(url) &&
      !isSelfReferentialUrl(url) &&
      !isDirectoryLoaderUrl(url) &&
      !isFacetedOrSectionIndexUrl(url) &&
      !isBoilerplatePlatformHostUrl(url),
  );
  if (!entityIdentity) return kept;
  const entityForMatch: ResearchEntityIdentity = {
    ...entityIdentity,
    sourceUrls: kept as string[],
  };
  return kept.filter((url) => personProfileSourceMatchesEntity(url, entityForMatch));
}

const LEAD_IDENTITY_OBSERVATION_FIELDS = new Set([
  'inferredPiUserId',
  'inferredPiUserKey',
  'inferredDirectorName',
]);

export function officialLeadProfileSourceUrl(
  observations: MaterializerObservationLike[],
): string | undefined {
  const winner = observations
    .filter(
      (observation) =>
        typeof observation.field === 'string' &&
        LEAD_IDENTITY_OBSERVATION_FIELDS.has(observation.field) &&
        isLikelyOfficialPersonProfileUrl(observation.sourceUrl),
    )
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  return winner?.sourceUrl ? String(winner.sourceUrl).trim() : undefined;
}

// The discovery provenance every materialized entity carries: the highest-
// confidence `sourceUrl` recorded on the observations that produced it, after
// the same materialization sanitizer that drops directory/content/self-
// referential/boilerplate pages. Used to project source-backing onto an
// entity's `sourceUrls` when it would otherwise expose none, closing the
// `missing_source_url` projection gap at write time (issue #1802).
export function bestMaterializationProvenanceSourceUrl(
  observations: MaterializerObservationLike[],
): string | undefined {
  const ranked = observations
    .filter((observation) => textValue(observation.sourceUrl))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .map((observation) => String(observation.sourceUrl).trim());
  const sanitized = sanitizeResearchEntitySourceUrlsForMaterialization(ranked);
  return Array.isArray(sanitized) ? (sanitized[0] as string | undefined) : undefined;
}

export function deriveResearchEntityWebsiteUrl(
  set: Record<string, unknown>,
  entityDoc?: Record<string, unknown> | null,
): WebsiteUrlBackfillResolution {
  const merged = (field: string): unknown => (field in set ? set[field] : entityDoc?.[field]);
  return resolveBackfillWebsiteUrl({
    websiteUrl: merged('websiteUrl'),
    website: merged('website'),
    sourceUrls: merged('sourceUrls'),
    name: merged('name'),
    displayName: merged('displayName'),
  });
}

function comparableObservationValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  return JSON.stringify(value);
}

function fieldProvenanceForResolvedObservation(
  field: string,
  resolved: ResolvedField,
  observations: MaterializerObservationLike[],
): Record<string, unknown> | null {
  const resolvedValue = comparableObservationValue(resolved.value);
  const contributingSources = new Set(resolved.contributingSources);
  const match = observations
    .filter(
      (obs) => obs.field === field && obs.sourceName && contributingSources.has(obs.sourceName),
    )
    .find((obs) => comparableObservationValue(obs.value) === resolvedValue);
  if (!match) return null;

  return {
    ...(match._id ? { sourceId: match._id } : {}),
    sourceName: match.sourceName,
    sourceUrl: match.sourceUrl || '',
    observedAt: match.observedAt || new Date(),
    confidence: match.confidence ?? resolved.confidence,
  };
}

// A named org kind that implies multiple PIs/researchers, as opposed to a
// single-person 'lab'/'individual'/'solo' entity. Gates the single-PI/grant
// shell description guard below (issue #1595).
const MULTI_PI_ORG_KINDS = new Set(['center', 'institute', 'program']);

// Fields whose winning value is rejected when it is sourced entirely from a
// Yale person-profile page and the entity is a named multi-PI org materialized
// from a single-PI/grant shell (issue #1595): the org's description or
// research areas must never resolve to one PI's own bio/study content just
// because no broader source exists yet. Rejecting falls through to the
// best-ranked candidate the guard does not object to, and drops the field only
// when every candidate is person-profile-sourced - so the entity keeps whatever
// value it already had (or stays unset if it never had one) rather than
// regressing to a misleadingly narrow scope.
const SINGLE_PI_SHELL_GATED_FIELDS = ['fullDescription', 'researchAreas'] as const;

/**
 * Whether every observation backing a resolved field's winning value is a
 * Yale person-profile page (`/people/<name>` or `/profile/<name>`). A named
 * multi-PI org whose only evidence for a field is one individual's own profile
 * page has no organizational source for that field at all - the content is
 * that person's, not the organization's - regardless of whether the person is
 * a genuine affiliate.
 */
function resolvedFieldSourcedOnlyFromPersonProfilePages(
  field: string,
  resolved: ResolvedField,
  observations: MaterializerObservationLike[],
): boolean {
  const resolvedValue = comparableObservationValue(resolved.value);
  const contributingSources = new Set(resolved.contributingSources);
  const matches = observations.filter(
    (obs) =>
      obs.field === field &&
      obs.sourceName &&
      contributingSources.has(obs.sourceName) &&
      comparableObservationValue(obs.value) === resolvedValue,
  );
  if (matches.length === 0) return false;
  return matches.every((obs) => personProfileNameTokensFromUrl(obs.sourceUrl) !== null);
}

export function buildInferredPiMemberUpsert(
  researchEntityId: string,
  observation: InferredPiObservation,
): {
  filter: Record<string, unknown>;
  update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> };
} | null {
  const userId = String(observation.value || '').trim();
  const safeResearchEntityId = normalizeMaterializerObjectId(researchEntityId);
  const safeUserId = normalizeMaterializerObjectId(userId);
  if (!safeResearchEntityId || !safeUserId) {
    return null;
  }
  const observedAt = observation.observedAt || new Date();
  const confidence = typeof observation.confidence === 'number' ? observation.confidence : 0.5;
  const sourceUrl = observation.sourceUrl || '';
  const sourceName = observation.sourceName || '';

  return {
    filter: {
      researchEntityId: safeResearchEntityId,
      userId: safeUserId,
      role: 'pi',
      isCurrentMember: true,
    },
    update: {
      $set: {
        researchEntityId: safeResearchEntityId,
        userId: safeUserId,
        role: 'pi',
        isCurrentMember: true,
        sourceUrl,
        confidence,
        lastObservedAt: observedAt,
        'confidenceByField.role': confidence,
        'fieldProvenance.role': {
          sourceName,
          sourceUrl,
          observedAt,
          confidence,
        },
      },
      $setOnInsert: {
        startedAt: observedAt,
      },
    },
  };
}

const MEMBER_ROLES = new Set([
  'pi',
  'co-pi',
  'director',
  'co-director',
  'core-faculty',
  'affiliated',
  'alumni',
  'postdoc',
  'grad-student',
  'undergrad',
  'staff',
  'affiliate',
]);

/** Roles the public research detail leadership UI renders as entity leads. */
const LEAD_MEMBER_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);
/** Non-lead roster roles a promoted director supersedes within an entity. */
const SUPERSEDED_BY_DIRECTOR_ROLES = ['core-faculty', 'affiliated', 'affiliate'];

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function memberNameFromInferredUserName(value: unknown): string {
  const record = objectRecord(value);
  const first = textValue(record.fname || record.first || record.firstName);
  const last = textValue(record.lname || record.last || record.lastName);
  return [first, last].filter(Boolean).join(' ').trim();
}

function normalizeMemberRole(value: unknown): string {
  const role = textValue(value).toLowerCase();
  return MEMBER_ROLES.has(role) ? role : '';
}

async function findUniqueResearcherForRosterMember(
  resolved: Record<string, ResolvedField>,
): Promise<any | null> {
  const profileUrl = textValue(resolved.profileUrl?.value);
  if (!profileUrl) return null;
  const researchers = await Researcher.find({
    archived: { $ne: true },
    $or: [{ 'profileLinks.url': profileUrl }, { 'profile.websiteUrl': profileUrl }],
  })
    .select('_id')
    .limit(2)
    .lean();
  return researchers.length === 1 ? researchers[0] : null;
}

export function buildRosterMemberUpsert(
  researchEntityId: string,
  resolved: Record<string, ProvenanceResolvedField>,
  user: Record<string, unknown> | null = null,
): RosterMemberMaterializationPatch | null {
  if (!normalizeMaterializerObjectId(researchEntityId)) return null;
  const role = normalizeMemberRole(resolved.role?.value);
  if (!role) return null;
  if (
    textValue(resolved.currentStatus?.value) &&
    textValue(resolved.currentStatus?.value) !== 'current'
  ) {
    return null;
  }
  if (
    textValue(resolved.evidenceStatus?.value) &&
    textValue(resolved.evidenceStatus?.value) !== 'verified'
  ) {
    return null;
  }
  if (
    resolved.name?.hasConflict ||
    resolved.profileUrl?.hasConflict ||
    resolved.identityKey?.hasConflict ||
    resolved.membershipKey?.hasConflict ||
    resolved.role?.hasConflict
  ) {
    return null;
  }
  const name =
    textValue(resolved.name?.value) ||
    memberNameFromInferredUserName(resolved.inferredUserName?.value);
  const userId = idValue(user?._id);
  const profileUrl = textValue(resolved.profileUrl?.value);
  const identityKey =
    textValue(resolved.identityKey?.value) ||
    (profileUrl ? `official-profile:${profileUrl.toLowerCase()}` : '');
  const membershipKey =
    textValue(resolved.membershipKey?.value) || (identityKey ? `${identityKey}|${role}` : '');
  if ((!name && !userId) || (!userId && !identityKey)) {
    return null;
  }

  const roleSource = resolved.role;
  const observedAt = roleSource?.observedAt || new Date();
  const confidence = typeof roleSource?.confidence === 'number' ? roleSource.confidence : 0.5;
  const sourceUrl = textValue(roleSource?.sourceUrl);
  const sourceName = textValue(roleSource?.sourceName);
  const title = sanitizePersonTitle(textValue(resolved.title?.value)) || '';

  const identityFilter: Record<string, unknown> = userId ? { userId } : { membershipKey };
  const filter = {
    researchEntityId,
    role,
    isCurrentMember: true,
    ...identityFilter,
  };
  const set: Record<string, unknown> = {
    researchEntityId,
    role,
    isCurrentMember: true,
    sourceUrl,
    sourceName,
    confidence,
    lastObservedAt: observedAt,
    'confidenceByField.role': confidence,
    'fieldProvenance.role': {
      sourceName,
      sourceUrl,
      observedAt,
      confidence,
    },
  };
  if (name) set.name = name;
  if (userId) set.userId = userId;
  if (identityKey) set.identityKey = identityKey;
  if (membershipKey) set.membershipKey = membershipKey;
  if (textValue(resolved.evidenceStatus?.value)) {
    set.evidenceStatus = textValue(resolved.evidenceStatus?.value);
  }
  if (textValue(resolved.sectionLabel?.value)) {
    set.sectionLabel = textValue(resolved.sectionLabel?.value);
  }
  if (resolved.sourcePublishedAt?.value) {
    set.sourcePublishedAt = resolved.sourcePublishedAt.value;
  }
  if (resolved.freshnessExpiresAt?.value) {
    set.freshnessExpiresAt = resolved.freshnessExpiresAt.value;
  }
  if (title) {
    set.title = title;
    set['confidenceByField.title'] = resolved.title?.confidence ?? confidence;
  }
  if (profileUrl) {
    set.profileUrl = profileUrl;
    set['fieldProvenance.profileUrl'] = {
      sourceName: textValue(resolved.profileUrl?.sourceName) || sourceName,
      sourceUrl: profileUrl,
      observedAt: resolved.profileUrl?.observedAt || observedAt,
      confidence: resolved.profileUrl?.confidence ?? confidence,
    };
  }

  return {
    filter,
    update: {
      $set: set,
      $setOnInsert: {
        startedAt: observedAt,
      },
    },
    fieldsWritten: Object.keys(resolved).length,
    conflicts: Object.values(resolved).filter((field) => field.hasConflict).length,
    resolved,
  };
}

interface CanonicalRosterMatch {
  roster: ResearchEntityRosterEntry[];
  matches: (entry: ResearchEntityRosterEntry) => boolean;
}

async function findCanonicalRosterMatch(
  researchEntityId: string,
  identity: { researcherId?: unknown; name?: unknown },
): Promise<CanonicalRosterMatch> {
  const roster = await getResearchEntityRoster(researchEntityId);
  const candidateId = normalizeMaterializerObjectId(identity.researcherId);
  const researcher: any = candidateId
    ? await Researcher.findById(candidateId).select('_id').lean()
    : null;
  const researcherId = researcher?._id ? researcher._id.toString() : undefined;
  const name = textValue(identity.name).toLowerCase();
  const matches = (entry: ResearchEntityRosterEntry): boolean => {
    if (researcherId && entry.personId) {
      return entry.personId.toString() === researcherId;
    }
    return Boolean(name) && textValue(entry.name).toLowerCase() === name;
  };
  return { roster, matches };
}

async function materializeRosterMember(
  identifier: { entityId?: string; entityKey?: string },
  observations: any[],
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const resolverObs: ResolverObservation[] = observations.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));
  const resolved = withResolvedFieldProvenance(resolveAllFields(resolverObs), observations);
  const researchGroupKey = textValue(resolved.researchGroupKey?.value);
  if (!researchGroupKey) {
    return {
      entityType: 'researchGroupMember',
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'missing-research-group-key',
    };
  }

  const entity: any = await ResearchEntity.findOne({
    slug: researchGroupKey,
    archived: { $ne: true },
  })
    .select('_id')
    .lean();
  if (!entity?._id) {
    return {
      entityType: 'researchGroupMember',
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'missing-research-entity',
    };
  }

  const researchEntityId = normalizeMaterializerObjectId(entity._id) || '';
  const researcher = await findUniqueResearcherForRosterMember(resolved);
  const memberIdentity = researcher?._id
    ? await canonicalResearcherIdentity(idValue(researcher._id))
    : undefined;
  const patch = buildRosterMemberUpsert(researchEntityId, resolved, researcher);
  if (!patch) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'missing-required-fields',
    };
  }

  if (options.dryRun) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: patch.fieldsWritten,
      conflicts: patch.conflicts,
      created: false,
      resolved,
    };
  }

  const resolvedRole = String(patch.filter.role || '');
  const { roster, matches } = await findCanonicalRosterMatch(researchEntityId, {
    researcherId: patch.filter.userId,
    name: patch.filter.name,
  });

  // Don't add a non-lead roster row for someone who is already a lead (PI /
  // director / co-director) of this entity. The director extractor promotes a
  // roster member to `director` and removes the stale roster row; without this
  // guard the next roster materialization would re-create the duplicate
  // (the detail-page dedup keys on person+role, so the person would render twice).
  if (!LEAD_MEMBER_ROLES.has(resolvedRole)) {
    const existingLead = roster.some(
      (entry) => entry.isCurrentMember && LEAD_MEMBER_ROLES.has(entry.role) && matches(entry),
    );
    if (existingLead) {
      return {
        entityType: 'researchGroupMember',
        entityId: materializerDocumentId(entity._id),
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved,
        skipped: 'already-lead-member',
      };
    }
  }

  const existing = roster.some((entry) => entry.role === resolvedRole && matches(entry));
  const patchSet = (patch.update as { $set?: Record<string, unknown> }).$set || {};
  await materializeCanonicalMembership(
    researchEntityId,
    {
      legacyRole: String(patch.filter.role || ''),
      displayName: textValue(patchSet.name),
      evidenceStatus: textValue(resolved.evidenceStatus?.value),
      isCurrentMember: true,
      confidence: patchSet.confidence,
      startedAt: (patch.update as { $setOnInsert?: { startedAt?: Date } }).$setOnInsert?.startedAt,
      rosterProvenance: canonicalRosterProvenanceFromSet(
        patchSet,
        textValue(resolved.evidenceStatus?.value),
      ),
    },
    {
      netid: memberIdentity?.netid,
      email: memberIdentity?.email,
      orcid: memberIdentity?.orcid,
      displayName: textValue(patchSet.name),
      hasCanonicalSourceReference: Boolean(patch.filter.userId),
    },
  );
  return {
    entityType: 'researchGroupMember',
    entityId: materializerDocumentId(entity._id),
    entityKey: identifier.entityKey,
    fieldsWritten: patch.fieldsWritten,
    conflicts: patch.conflicts,
    created: !existing,
    resolved,
  };
}

function withResolvedFieldProvenance(
  resolved: Record<string, ResolvedField>,
  observations: MaterializerObservationLike[],
): Record<string, ProvenanceResolvedField> {
  const output: Record<string, ProvenanceResolvedField> = {};
  for (const [field, value] of Object.entries(resolved)) {
    const source =
      observations.find(
        (observation) => observation.field === field && observation.value === value.value,
      ) || observations.find((observation) => observation.field === field);
    output[field] = {
      ...value,
      ...(source?.sourceName ? { sourceName: source.sourceName } : {}),
      ...(source?.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      ...(source?.observedAt ? { observedAt: source.observedAt } : {}),
    };
  }
  return output;
}

export async function materializeInferredPiMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<void> {
  const piObservations = observations.filter((obs) => obs.field === 'inferredPiUserId');
  for (const observation of piObservations) {
    const patch = buildInferredPiMemberUpsert(researchEntityId, observation);
    if (!patch) continue;
    await materializeCanonicalPiMembership(researchEntityId, patch, idValue(observation.value));
  }

  const piKeyObservations = observations.filter((obs) => obs.field === 'inferredPiUserKey');
  for (const observation of piKeyObservations) {
    const identity = inferredPiUserKeyIdentity(observation.value);
    if (!identity.netid && !identity.name) continue;
    const resolution = await resolveResearcherIdForPersonName(identity.name, {
      netid: identity.netid,
    });
    if (resolution.status !== 'matched' || !resolution.researcherId) continue;
    const researcherId = resolution.researcherId.toString();
    const patch = buildInferredPiMemberUpsert(researchEntityId, {
      ...observation,
      value: researcherId,
    });
    if (!patch) continue;
    await materializeCanonicalPiMembership(researchEntityId, patch, researcherId);
  }
}

function inferredPiUserKeyIdentity(value: unknown): { netid?: string; name: string } {
  const raw = typeof value === 'string' ? value.trim() : '';
  const deptMatch = raw.match(DEPT_USER_KEY_PATTERN);
  if (deptMatch) {
    const name = deptMatch[1]
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(Boolean)
      .join(' ');
    return { name };
  }
  const lookupValue = userLookupValueForInferredPiUserKey(value);
  const netid = lookupValue && !lookupValue.includes('@') ? lookupValue.toLowerCase() : undefined;
  return { netid, name: '' };
}

function coerceRosterProvenanceDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }
  return undefined;
}

export function canonicalRosterProvenanceFromSet(
  patchSet: Record<string, unknown>,
  fallbackEvidenceStatus?: string,
): RoleAssignmentRosterProvenance {
  return {
    sourceName: textValue(patchSet.sourceName) || undefined,
    sourceUrl: textValue(patchSet.sourceUrl) || undefined,
    profileUrl: textValue(patchSet.profileUrl) || undefined,
    sectionLabel: textValue(patchSet.sectionLabel) || undefined,
    evidenceStatus: textValue(patchSet.evidenceStatus) || fallbackEvidenceStatus || undefined,
    membershipKey: textValue(patchSet.membershipKey) || undefined,
    observedAt: coerceRosterProvenanceDate(patchSet.lastObservedAt),
    freshnessExpiresAt: coerceRosterProvenanceDate(patchSet.freshnessExpiresAt),
  };
}

async function canonicalResearcherIdentity(
  researcherId: string,
): Promise<{ netid?: string; email?: string; orcid?: string; displayName: string }> {
  if (!researcherId) return { displayName: '' };
  const researcher: any = await Researcher.findById(researcherId)
    .select('displayName accountId identifiers')
    .lean();
  if (!researcher) return { displayName: '' };
  let netid: string | undefined;
  let email: string | undefined;
  if (researcher.accountId) {
    const account: any = await Account.findById(researcher.accountId).select('netid email').lean();
    netid = textValue(account?.netid) || undefined;
    email = textValue(account?.email) || undefined;
  }
  return {
    netid,
    email,
    orcid: textValue(researcher.identifiers?.orcid) || undefined,
    displayName: textValue(researcher.displayName),
  };
}

async function materializeCanonicalPiMembership(
  researchEntityId: string,
  patch: { filter: Record<string, any>; update: any },
  researcherId: string,
): Promise<void> {
  const identity = await canonicalResearcherIdentity(researcherId);
  const patchSet = (patch.update as { $set?: Record<string, unknown> }).$set || {};
  const displayName = textValue(patchSet.name) || identity.displayName;
  await materializeCanonicalMembership(
    researchEntityId,
    {
      legacyRole: String(patch.filter.role || ''),
      displayName,
      isCurrentMember: true,
      confidence: patchSet.confidence,
      startedAt: (patch.update as { $setOnInsert?: { startedAt?: Date } }).$setOnInsert?.startedAt,
      rosterProvenance: canonicalRosterProvenanceFromSet(patchSet),
    },
    {
      netid: identity.netid,
      email: identity.email,
      orcid: identity.orcid,
      displayName,
      hasCanonicalSourceReference: Boolean(patch.filter.userId),
    },
  );
}

const SCHOOL_INHERITANCE_LEAD_ROLES = ['PI', 'DIRECTOR'];

export const LEAD_PI_SCHOOL_INHERITANCE_SOURCE = 'lead-pi-school-inheritance';

const LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE = 0.6;

async function resolveSingleLeadResearcherId(
  researchEntityId: string,
): Promise<string | undefined> {
  const objectId = toMaterializerObjectId(researchEntityId);
  if (!objectId) return undefined;
  const leads = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': objectId,
    role: { $in: SCHOOL_INHERITANCE_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('personId')
    .lean()) as Array<{ personId?: unknown }>;
  const distinctPersonIds = new Set(
    leads
      .map((assignment) => materializerDocumentId(assignment.personId))
      .filter((id) => id.length > 0),
  );
  return distinctPersonIds.size === 1 ? distinctPersonIds.values().next().value : undefined;
}

async function leadResearcherDepartment(researcherId: string): Promise<string | undefined> {
  const researcher = (await Researcher.findById(researcherId)
    .select('profile accountId')
    .lean()) as {
    profile?: { primaryDepartment?: unknown };
    accountId?: unknown;
  } | null;
  if (!researcher) return undefined;
  const direct = textValue(researcher.profile?.primaryDepartment);
  if (direct) return direct;
  if (researcher.accountId) {
    const account = (await Account.findById(materializerDocumentId(researcher.accountId))
      .select('department')
      .lean()) as { department?: unknown } | null;
    const accountDepartment = textValue(account?.department);
    if (accountDepartment) return accountDepartment;
  }
  return undefined;
}

export type LeadPiSchoolInheritanceSkip =
  | 'locked'
  | 'has-school'
  | 'multi-pi-kind'
  | 'no-single-lead'
  | 'no-department'
  | 'no-school-derivable';

export interface LeadPiSchoolInheritanceResult {
  inherited: boolean;
  school?: string;
  departments?: string[];
  skipped?: LeadPiSchoolInheritanceSkip;
}

export function leadPiSchoolInheritanceGate(input: {
  manuallyLockedFields?: string[];
  school?: unknown;
  schools?: unknown;
  kind?: unknown;
}): Extract<LeadPiSchoolInheritanceSkip, 'locked' | 'has-school' | 'multi-pi-kind'> | 'eligible' {
  const locked = input.manuallyLockedFields ?? [];
  if (locked.includes('school') || locked.includes('departments')) return 'locked';
  if (textValue(input.school)) return 'has-school';
  const existingSchools = Array.isArray(input.schools)
    ? (input.schools as unknown[]).map((value) => textValue(value)).filter(Boolean)
    : [];
  if (existingSchools.length > 0) return 'has-school';
  if (MULTI_PI_ORG_KINDS.has(textValue(input.kind).toLowerCase())) return 'multi-pi-kind';
  return 'eligible';
}

async function leadDepartmentWithParentSchool(
  rawDepartment: string,
): Promise<{ department: string; school: string } | undefined> {
  try {
    const canonicalizer = await getOrgUnitCanonicalizer();
    const canonical = canonicalizer.canonicalizeDepartments([rawDepartment]);
    if (canonical.values.length !== 1 || canonical.unmatched.length > 0) return undefined;
    const department = canonical.values[0];
    const school = canonicalizer.schoolForDepartment(department);
    return school ? { department, school } : undefined;
  } catch {
    return undefined;
  }
}

export async function inheritSchoolFromLeadPi(
  researchEntityId: string,
  options: { manuallyLockedFields?: string[]; dryRun?: boolean } = {},
): Promise<LeadPiSchoolInheritanceResult> {
  const entity = (await ResearchEntity.findById(researchEntityId)
    .select('school departments schools kind entityType')
    .lean()) as {
    school?: unknown;
    departments?: unknown;
    schools?: unknown;
    kind?: unknown;
  } | null;
  if (!entity) return { inherited: false };
  const gate = leadPiSchoolInheritanceGate({
    manuallyLockedFields: options.manuallyLockedFields,
    school: entity.school,
    schools: entity.schools,
    kind: entity.kind,
  });
  if (gate !== 'eligible') return { inherited: false, skipped: gate };

  const leadResearcherId = await resolveSingleLeadResearcherId(researchEntityId);
  if (!leadResearcherId) return { inherited: false, skipped: 'no-single-lead' };
  const rawDepartment = await leadResearcherDepartment(leadResearcherId);
  if (!rawDepartment) return { inherited: false, skipped: 'no-department' };
  const leadOrgUnit = await leadDepartmentWithParentSchool(rawDepartment);
  if (!leadOrgUnit) return { inherited: false, skipped: 'no-school-derivable' };

  const existingDepartments = Array.isArray(entity.departments)
    ? (entity.departments as unknown[]).map((value) => textValue(value)).filter(Boolean)
    : [];
  const set: Record<string, unknown> = {
    school: leadOrgUnit.school,
    ...(existingDepartments.length === 0 ? { departments: [leadOrgUnit.department] } : {}),
  };
  await applyResearchEntityOrgUnitCanonicalization(set, entity);
  const derivedSchool = textValue(set.school);
  if (!derivedSchool) return { inherited: false, skipped: 'no-school-derivable' };
  const departments = Array.isArray(set.departments)
    ? (set.departments as string[])
    : existingDepartments;

  if (options.dryRun) return { inherited: true, school: derivedSchool, departments };

  set['confidenceByField.school'] = LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE;
  set['fieldProvenance.school'] = {
    sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
    observedAt: new Date(),
    confidence: LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE,
  };
  await withResearchEntityWriteTransaction((session) =>
    ResearchEntity.updateOne({ _id: researchEntityId }, { $set: set }, { session }),
  );
  const fresh = await ResearchEntity.findById(researchEntityId).lean();
  if (fresh) await syncEntity('researchEntity', fresh);
  return { inherited: true, school: derivedSchool, departments };
}

export interface InferredDirectorMaterializationResult {
  written: boolean;
  promoted: boolean;
  removedDuplicates: number;
  userId?: string;
  role?: string;
  skipped?: 'no-observation' | 'unresolved-user';
}

/**
 * Promote a center's named director to a `director` member.
 *
 * Reads the entity-level `inferredDirector*` observations emitted by
 * `center-director-llm`, resolves the name (+ profile URL) to a UNIQUE canonical
 * Researcher, and upserts a lead member row. Resolution is required: an unresolved or
 * ambiguous name is skipped, never written, so a hallucinated leadership name
 * cannot mint a lead. Any pre-existing non-lead roster row for the same person
 * in this entity is removed so they surface once as the lead (the detail-page
 * dedup keys on user+role). Idempotent: re-running converges on a single
 * `director` row.
 */
export async function materializeInferredDirectorMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<InferredDirectorMaterializationResult> {
  const empty: InferredDirectorMaterializationResult = {
    written: false,
    promoted: false,
    removedDuplicates: 0,
  };
  if (!normalizeMaterializerObjectId(researchEntityId)) return empty;

  const fieldObs = (field: string) => observations.find((obs) => obs.field === field);
  const nameObs = fieldObs('inferredDirectorUserName');
  if (!nameObs || !nameObs.value) return { ...empty, skipped: 'no-observation' };

  const profileUrl = textValue(fieldObs('inferredDirectorProfileUrl')?.value);
  const roleRaw = textValue(fieldObs('inferredDirectorRole')?.value).toLowerCase();
  const role = roleRaw === 'co-director' ? 'co-director' : 'director';
  const name =
    textValue(fieldObs('inferredDirectorName')?.value) ||
    memberNameFromInferredUserName(nameObs.value);

  const lookupFields: Record<string, ResolvedField> = {
    inferredUserName: {
      value: nameObs.value,
      confidence: 1,
      contributingSources: [],
      hasConflict: false,
    },
  };
  if (profileUrl) {
    lookupFields.profileUrl = {
      value: profileUrl,
      confidence: 1,
      contributingSources: [],
      hasConflict: false,
    };
  }
  const researcher = await findUniqueResearcherForRosterMember(lookupFields);
  if (!researcher?._id) return { ...empty, skipped: 'unresolved-user' };

  const researcherId = idValue(researcher._id);
  const roleSource = fieldObs('inferredDirectorRole') || nameObs;
  const observedAt = roleSource.observedAt || new Date();
  const confidence = typeof roleSource.confidence === 'number' ? roleSource.confidence : 0.85;
  const sourceUrl = textValue(roleSource.sourceUrl);
  const sourceName = textValue(roleSource.sourceName);

  const directorResearcherId = researcherId;
  const directorEnrichment = await canonicalResearcherIdentity(researcherId);
  const roster = await getResearchEntityRoster(researchEntityId);
  const normalizedDirectorName = textValue(name).toLowerCase();
  const matchesDirector = (entry: ResearchEntityRosterEntry): boolean =>
    directorResearcherId && entry.personId
      ? entry.personId.toString() === directorResearcherId.toString()
      : Boolean(normalizedDirectorName) &&
        textValue(entry.name).toLowerCase() === normalizedDirectorName;
  const existing = roster.some(
    (entry) => entry.isCurrentMember && entry.role === role && matchesDirector(entry),
  );
  const supersededCount = roster.filter(
    (entry) => SUPERSEDED_BY_DIRECTOR_ROLES.includes(entry.role) && matchesDirector(entry),
  ).length;

  const directorIdentity: CanonicalMemberIdentity = {
    netid: directorEnrichment.netid,
    email: directorEnrichment.email,
    orcid: directorEnrichment.orcid,
    displayName: name,
    hasCanonicalSourceReference: true,
  };
  await materializeCanonicalMembership(
    researchEntityId,
    {
      legacyRole: role,
      displayName: name,
      isCurrentMember: true,
      confidence,
      startedAt: observedAt,
      rosterProvenance: {
        sourceName: sourceName || undefined,
        sourceUrl: profileUrl || sourceUrl || undefined,
        profileUrl: profileUrl || undefined,
        observedAt,
      },
    },
    directorIdentity,
  );

  const supersededPersonId = await resolveCanonicalResearcherId(directorIdentity);
  if (supersededPersonId) {
    await archiveSupersededCanonicalRoleAssignments(researchEntityId, supersededPersonId);
  }

  return {
    written: true,
    promoted: existing || supersededCount > 0,
    removedDuplicates: supersededCount,
    userId: researcherId,
    role,
  };
}

export function userLookupValueForInferredPiUserKey(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return uniqueKeyValueForIdentifier('user', raw, []) || '';
}

function isLikelyYaleEmailLocalPart(value: string): boolean {
  return value.includes('.') && /^[a-z0-9._-]+$/i.test(value);
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const idValue = (value: unknown): string => {
  return serializedDocumentId(value) || '';
};

/**
 * The legacy `kind` field is a pure function of the canonical `entityType`
 * (#2144), so it is derived here rather than resolved from `kind` observations.
 * Mirrors `materializedFieldValue`'s entityType fallback: an unrecognized
 * observed entityType keeps the stored one, and an entity with no recognizable
 * entityType at all has no derivable kind yet (kind observations still mint it).
 */
function derivedResearchGroupKind(
  observedEntityType: unknown,
  storedEntityType: unknown,
): ResearchGroupKind | undefined {
  const observed = textValue(observedEntityType);
  const effective = researchEntityTypes.includes(observed as never)
    ? observed
    : textValue(storedEntityType);
  return researchEntityTypes.includes(effective as never)
    ? mapEntityTypeToResearchGroupKind(effective)
    : undefined;
}

// ---------------------------------------------------------------------------
// ResearchEntity relationship materialization (umbrella center → faculty).
//
// Restored from the new-foundation producer (commit 8e5cc0a) that was dropped
// during the hallmark merge. The centers/institutes scraper emits
// `researchEntityRelationship` observations (sourceEntityKey/targetEntityKey/
// relationshipType). This resolves the `faculty-research-area-*` target key to
// an existing PI-led ResearchEntity (or mints a profile-backed faculty-research-
// area member); otherwise the relationship is skipped. It never fabricates a
// standalone lab shell or an undergraduate-access claim.
// ---------------------------------------------------------------------------

interface ResolvedRelationshipMaterializationDeps {
  researchEntityModel?: Pick<typeof ResearchEntity, 'findOne' | 'find' | 'findById'>;
  relationshipModel?: Pick<typeof ResearchEntityRelationship, 'updateOne' | 'updateMany'>;
}

interface ProfileBackedFacultyResearchAreaMemberDeps {
  researcherModel?: Pick<typeof Researcher, 'findById'>;
}

function normalizeResearchEntityName(value: unknown): string {
  return textValue(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function personNameFromFacultyResearchArea(value: unknown): string {
  const text = textValue(value)
    .replace(/^faculty-research-area-/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.replace(/\s+research$/i, '').trim();
}

function isFacultyResearchAreaKey(value: unknown): boolean {
  return textValue(value).toLowerCase().startsWith('faculty-research-area-');
}

function piCompatibleResearchEntityNames(firstName: string, lastName: string): Set<string> {
  const first = firstName.trim();
  const last = lastName.trim();
  return new Set(
    [
      `${first} ${last} Lab`,
      `${first} ${last} Laboratory`,
      `${last} Lab`,
      `${last} Laboratory`,
    ].map((value) => normalizeResearchEntityName(value)),
  );
}

async function findUniqueResearcherIdByPersonName(personName: string): Promise<string | null> {
  const resolution = await resolveResearcherIdForPersonName(personName);
  return resolution.status === 'matched' && resolution.researcherId
    ? resolution.researcherId.toString()
    : null;
}

function isGeneratedResearchEntitySlug(value: unknown): boolean {
  const slug = textValue(value);
  return slug.startsWith('faculty-research-area-') || slug.startsWith('dept-');
}

async function resolveUniquePiLinkedResearchEntityByPersonName(
  Model: mongoose.Model<any>,
  personName: string,
): Promise<any | null> {
  if (!personName) return null;

  const researcherIdString = await findUniqueResearcherIdByPersonName(personName);
  const researcherId = toMaterializerObjectId(researcherIdString);
  if (!researcherId) return null;
  const assignments = await RoleAssignment.find({
    personId: researcherId,
    'target.kind': 'RESEARCH_ENTITY',
    role: 'PI',
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('target.id')
    .lean();
  const candidateIds = Array.from(
    new Set(
      assignments
        .map((assignment: any) => normalizeMaterializerObjectId(assignment?.target?.id))
        .filter(Boolean),
    ),
  );
  if (candidateIds.length === 0) return null;

  const parts = personName.split(/\s+/).filter(Boolean);
  const compatibleNames = piCompatibleResearchEntityNames(
    parts.slice(0, -1).join(' '),
    parts[parts.length - 1],
  );
  const candidates = await Model.find({
    _id: { $in: candidateIds },
    archived: { $ne: true },
  })
    .select('_id name slug')
    .lean();
  const nonGeneratedCandidates = candidates.filter(
    (candidate: any) => !isGeneratedResearchEntitySlug(candidate.slug),
  );
  const compatibleCandidates = nonGeneratedCandidates.filter((candidate: any) =>
    compatibleNames.has(normalizeResearchEntityName(candidate.name)),
  );
  const resolvedCandidates =
    compatibleCandidates.length > 0 ? compatibleCandidates : nonGeneratedCandidates;
  if (resolvedCandidates.length !== 1) return null;

  return Model.findById(resolvedCandidates[0]._id).lean();
}

export async function findExistingResearchEntityByFacultyResearchAreaIdentity(
  Model: mongoose.Model<any>,
  identity: { entityKey?: string; name?: unknown; entityType?: unknown },
): Promise<any | null> {
  const observedEntityType = textValue(identity.entityType);
  const observedKey = textValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) return null;

  const personName =
    personNameFromFacultyResearchArea(identity.name) ||
    personNameFromFacultyResearchArea(observedKey);
  if (!personName) return null;

  return resolveUniquePiLinkedResearchEntityByPersonName(Model, personName);
}

function isDeptRosterKey(value: unknown): boolean {
  return textValue(value).toLowerCase().startsWith('dept-');
}

function personNameFromDeptRosterEntityName(value: unknown): string {
  return textValue(value)
    .replace(/\s+(lab|laboratory|faculty research)$/i, '')
    .trim();
}

function uniqueStringArray(...groups: Array<unknown>): string[] {
  const values = new Set<string>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const value of group) {
      const text = textValue(value).trim();
      if (text) values.add(text);
    }
  }
  return Array.from(values);
}

/**
 * A department-roster observation mints a `dept-<dept>-<person>` shell per
 * appointment. Left alone, these never enter the identity-keyed dedupe lane
 * (#561) because they carry no PI RoleAssignment yet, and never get a
 * canonicalGroupId tombstone or Meili cleanup (#584) because they never go
 * through a dedupe merge - the exact gap in #1364. When the shell's inferred
 * PI already has a real, non-generated research home, fold the shell into it
 * immediately: merge the additive fields, archive the shell with a
 * canonicalGroupId tombstone, and remove it from the search index, so no
 * per-appointment orphan is ever left standing.
 */
export async function foldDeptRosterShellIntoCanonicalResearchEntity(
  shellEntityId: string,
): Promise<{ folded: boolean; canonicalEntityId?: string }> {
  const shell = await ResearchEntity.findById(shellEntityId)
    .select('_id slug name departments schools sourceUrls archived')
    .lean<{
      _id: unknown;
      slug?: string;
      name?: unknown;
      departments?: unknown[];
      schools?: unknown[];
      sourceUrls?: unknown[];
      archived?: boolean;
    }>();
  if (!shell || shell.archived || !isDeptRosterKey(shell.slug)) return { folded: false };

  const personName = personNameFromDeptRosterEntityName(shell.name);
  if (!personName) return { folded: false };

  const canonical = await resolveUniquePiLinkedResearchEntityByPersonName(
    ResearchEntity,
    personName,
  );
  const canonicalId = normalizeMaterializerObjectId(canonical?._id);
  if (!canonicalId || canonicalId === String(shell._id)) return { folded: false };

  const now = new Date();
  await ResearchEntity.updateOne(
    { _id: canonicalId, archived: { $ne: true } },
    {
      $addToSet: {
        departments: { $each: uniqueStringArray(shell.departments) },
        schools: { $each: uniqueStringArray(shell.schools) },
        sourceUrls: { $each: uniqueStringArray(shell.sourceUrls) },
      },
      $set: { lastObservedAt: now },
    },
  );
  await ResearchEntity.updateOne(
    { _id: shell._id, archived: { $ne: true } },
    {
      $set: {
        archived: true,
        canonicalGroupId: canonicalId,
        lastObservedAt: now,
      },
    },
  );
  await deleteFromIndex('researchEntity', String(shell._id));

  return { folded: true, canonicalEntityId: canonicalId };
}

export async function syncProfileBackedFacultyResearchAreaMemberFromIdentity(
  researchEntityId: string,
  identity: {
    entityKey?: string;
    name?: unknown;
    entityType?: unknown;
    userId?: string;
    sourceUrl?: string;
    confidence?: number;
  },
  deps: ProfileBackedFacultyResearchAreaMemberDeps = {},
): Promise<{
  synced: boolean;
  created: boolean;
  researchEntityId?: string;
  userId?: string;
  skipped?: 'not-faculty-research-area' | 'user-not-resolved';
}> {
  const observedEntityType = textValue(identity.entityType);
  const observedKey = textValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) {
    return { synced: false, created: false, skipped: 'not-faculty-research-area' };
  }

  const researcherModel = deps.researcherModel || Researcher;
  const personName =
    personNameFromFacultyResearchArea(identity.name) ||
    personNameFromFacultyResearchArea(observedKey);
  const providedId = normalizeMaterializerObjectId(identity.userId);
  let researcherId: string | undefined;
  if (providedId) {
    const provided: any = await researcherModel.findById(providedId).select('_id').lean();
    researcherId = provided?._id ? provided._id.toString() : undefined;
  }
  if (!researcherId && personName) {
    researcherId = (await findUniqueResearcherIdByPersonName(personName)) || undefined;
  }
  if (!researcherId) return { synced: false, created: false, skipped: 'user-not-resolved' };

  const identityUser = await canonicalResearcherIdentity(researcherId);
  const displayName = identityUser.displayName || personName || '';
  const observedAt = new Date();
  const confidence = Number(identity.confidence) || 0.8;

  const normalizedName = displayName.toLowerCase();
  const roster = await getResearchEntityRoster(researchEntityId);
  const existing = roster.some(
    (entry) =>
      entry.role === 'pi' &&
      (researcherId && entry.personId
        ? entry.personId.toString() === researcherId
        : Boolean(normalizedName) && textValue(entry.name).toLowerCase() === normalizedName),
  );

  await materializeCanonicalMembership(
    researchEntityId,
    {
      legacyRole: 'pi',
      displayName,
      isCurrentMember: true,
      confidence,
      startedAt: observedAt,
      rosterProvenance: {
        sourceUrl: textValue(identity.sourceUrl) || undefined,
        observedAt,
      },
    },
    {
      netid: identityUser?.netid,
      email: identityUser?.email,
      orcid: identityUser?.orcid,
      displayName,
      hasCanonicalSourceReference: true,
    },
  );

  return { synced: true, created: !existing, researchEntityId, userId: researcherId };
}

function latestObservationDate(observations: Array<{ observedAt?: Date }>): Date {
  const timestamps = observations
    .map((observation) => new Date(observation.observedAt || 0).getTime())
    .filter((time) => Number.isFinite(time));
  if (timestamps.length === 0) return new Date();
  return new Date(Math.max(...timestamps));
}

async function materializeResearchEntityRelationship(
  identifier: { entityId?: string; entityKey?: string },
  observations: any[],
  options: MaterializeOptions,
  deps: ResolvedRelationshipMaterializationDeps = {},
): Promise<MaterializeResult> {
  const resolverObs: ResolverObservation[] = observations.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));
  const resolved = withResolvedFieldProvenance(resolveAllFields(resolverObs), observations);

  const skip = (skipped: string): MaterializeResult => ({
    entityType: 'researchEntityRelationship',
    ...identifier,
    fieldsWritten: 0,
    conflicts: 0,
    created: false,
    resolved,
    skipped,
  });

  const sourceEntityKey = textValue(resolved.sourceEntityKey?.value);
  const targetEntityKey = textValue(resolved.targetEntityKey?.value);
  const relationshipType = textValue(resolved.relationshipType?.value);
  if (!sourceEntityKey || !targetEntityKey || !relationshipType) {
    return skip('missing-keys');
  }

  const researchEntityModel = deps.researchEntityModel || ResearchEntity;
  const relationshipModel = deps.relationshipModel || ResearchEntityRelationship;

  const source = (await researchEntityModel
    .findOne({ slug: sourceEntityKey, archived: { $ne: true } }, { _id: 1 })
    .lean()) as { _id?: unknown } | null;
  if (!source?._id) return skip('source-not-resolved');

  const canonicalFacultyResearchAreaTarget =
    (await findExistingResearchEntityByFacultyResearchAreaIdentity(researchEntityModel as any, {
      entityKey: targetEntityKey,
      entityType: 'FACULTY_RESEARCH_AREA',
    })) as { _id?: unknown } | null;
  const target = (await researchEntityModel
    .findOne({ slug: targetEntityKey, archived: { $ne: true } }, { _id: 1, name: 1, slug: 1 })
    .lean()) as { _id?: unknown; name?: unknown; slug?: string } | null;
  const resolvedTarget = canonicalFacultyResearchAreaTarget || target;
  if (!resolvedTarget?._id) return skip('target-not-resolved');

  if (options.dryRun) {
    return {
      entityType: 'researchEntityRelationship',
      entityId: materializerDocumentId(source._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
    };
  }

  if (!canonicalFacultyResearchAreaTarget && target?._id) {
    await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      normalizeMaterializerObjectId(target._id) || '',
      {
        entityKey: targetEntityKey,
        name: target.name,
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrl: textValue(resolved.sourceUrl?.value),
        confidence: Math.max(0, ...observations.map((o) => Number(o.confidence) || 0)),
      },
    );
  }

  const sourceResearchEntityId = normalizeMaterializerObjectId(source._id) || '';
  const targetResearchEntityId = normalizeMaterializerObjectId(resolvedTarget._id) || '';
  if (!sourceResearchEntityId || !targetResearchEntityId) return skip('target-not-resolved');
  // Prefer linking the center to the member's existing PI-led lab (a rich page)
  // over a thin faculty-research-area stub: a resolved target whose slug is not a
  // generated `faculty-research-area-*` is a real research home → AFFILIATED_LAB.
  const resolvedRelationshipType = centerRelationshipTypeForResolvedTarget(
    textValue((resolvedTarget as { slug?: unknown }).slug),
    relationshipType,
  );
  const label = relationshipLabelForType(resolvedRelationshipType);
  const evidenceStrength = textValue(resolved.evidenceStrength?.value) || 'MODERATE';
  const evidenceQuote = textValue(resolved.evidenceQuote?.value);
  const sourceUrl = textValue(resolved.sourceUrl?.value);
  const confidence = Math.max(0, ...observations.map((o) => Number(o.confidence) || 0));
  const observedAt = latestObservationDate(observations);

  const update: Record<string, unknown> = {
    sourceResearchEntityId,
    targetResearchEntityId,
    relationshipType: resolvedRelationshipType,
    label,
    evidenceStrength,
    sourceUrl,
    confidence: confidence || 0.7,
    archived: false,
    lastObservedAt: observedAt,
  };
  if (evidenceQuote) update.evidenceQuote = evidenceQuote;

  const result: any = await relationshipModel.updateOne(
    { sourceResearchEntityId, targetResearchEntityId, relationshipType: resolvedRelationshipType },
    { $set: update },
    { upsert: true },
  );

  // The upsert key includes relationshipType, so a center→target edge that was
  // previously a different type (e.g. MEMBER_RESEARCH_AREA before a lab resolved)
  // would survive as a stale duplicate. Archive any sibling with the same
  // (source, target) but a different type so the page shows exactly one edge.
  if (relationshipModel.updateMany) {
    await relationshipModel.updateMany(
      {
        sourceResearchEntityId,
        targetResearchEntityId,
        relationshipType: { $ne: resolvedRelationshipType },
        archived: { $ne: true },
      },
      { $set: { archived: true } },
    );
  }

  return {
    entityType: 'researchEntityRelationship',
    entityId: sourceResearchEntityId,
    entityKey: identifier.entityKey,
    fieldsWritten: observations.length,
    conflicts: 0,
    created: Boolean(result?.upsertedCount),
    resolved,
  };
}

const RESEARCH_ENTITY_RELATIONSHIP_LABELS: Record<string, string> = {
  AFFILIATED_LAB: 'Affiliated lab',
  MEMBER_RESEARCH_AREA: 'Member',
};

export function relationshipLabelForType(relationshipType: string): string {
  return RESEARCH_ENTITY_RELATIONSHIP_LABELS[relationshipType] || 'Related research home';
}

/**
 * Pick the relationship type for a center→target edge. A resolved target whose
 * slug is a generated `faculty-research-area-*` stub stays MEMBER_RESEARCH_AREA;
 * anything else is a real research home (the member's PI-led lab) → AFFILIATED_LAB.
 */
export function centerRelationshipTypeForResolvedTarget(
  resolvedTargetSlug: string,
  fallbackType: string,
): string {
  const slug = (resolvedTargetSlug || '').trim();
  return slug && !slug.startsWith('faculty-research-area-') ? 'AFFILIATED_LAB' : fallbackType;
}

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(new Set(values.map(textValue).filter(Boolean)));

const DEPT_USER_KEY_PATTERN = /^dept:[^:]+:(.+)$/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameRegexFromSlugParts(parts: string[]): RegExp | null {
  const normalized = parts.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) return null;
  return new RegExp(`^${normalized.map(escapeRegex).join('[\\s-]+')}$`, 'i');
}

function deptUserNameFilters(
  value: unknown,
  departments: string[],
): Array<Record<string, unknown>> {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(DEPT_USER_KEY_PATTERN);
  if (!match || departments.length === 0) return [];

  const parts = match[1]
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  if (parts.length < 2) return [];

  const firstName = nameRegexFromSlugParts([parts[0]]);
  const lastName = nameRegexFromSlugParts(parts.slice(1));
  if (!firstName || !lastName) return [];

  return departments.flatMap((department) => [
    { fname: firstName, lname: lastName, departments: department },
    { fname: firstName, lname: lastName, primaryDepartment: department },
  ]);
}

export function userLookupFiltersForInferredPiUserKey(
  value: unknown,
  departments: string[] = [],
): Array<Record<string, unknown>> {
  const lookupValue = userLookupValueForInferredPiUserKey(value);
  if (!lookupValue) return [];

  const filters: Array<Record<string, unknown>> = [{ netid: lookupValue }];
  if (/^[a-z0-9._-]+@yale\.edu$/i.test(lookupValue)) {
    filters.push({ email: lookupValue.toLowerCase() });
  } else if (isLikelyYaleEmailLocalPart(lookupValue)) {
    filters.push({ email: `${lookupValue.toLowerCase()}@yale.edu` });
  }
  return [...filters, ...deptUserNameFilters(value, departments)];
}

function normalizeIdentityText(value: unknown): string {
  return textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function identityTokens(value: unknown): string[] {
  return normalizeIdentityText(value)
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function observationValueForField(
  observations: MaterializerObservationLike[],
  field: string,
): unknown {
  return observations.find((obs) => obs.field === field)?.value;
}

function observedUserDepartmentLabels(observations: MaterializerObservationLike[]): string[] {
  return uniqueStrings(
    observations.flatMap((observation) => {
      if (observation.field !== 'departments' && observation.field !== 'primaryDepartment') {
        return [];
      }
      return Array.isArray(observation.value) ? observation.value : [observation.value];
    }),
  );
}

const DEPARTMENT_IDENTITY_STOPWORDS = new Set([
  'and',
  'the',
  'department',
  'departments',
  'program',
  'programs',
  'school',
  'faculty',
  'arts',
  'sciences',
  'science',
  'studies',
  'yale',
]);

function departmentIdentityTokens(labels: string[]): string[] {
  return Array.from(
    new Set(
      labels
        .flatMap(identityTokens)
        .filter((token) => token.length >= 4 && !DEPARTMENT_IDENTITY_STOPWORDS.has(token)),
    ),
  );
}

function officialUserProfileUrlsFromObservations(
  observations: MaterializerObservationLike[],
): string[] {
  return uniqueStrings(
    observations.flatMap((observation) => {
      const urls: unknown[] = [];
      if (observation.field === 'profileUrls') {
        if (typeof observation.value === 'string') urls.push(observation.value);
        else if (observation.value && typeof observation.value === 'object') {
          urls.push(...Object.values(observation.value));
        }
      }
      if (observation.field === 'profileUrl') urls.push(observation.value);
      return urls;
    }),
  ).filter((url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.toLowerCase().endsWith('yale.edu') &&
        /\/(?:people|profile)\//i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  });
}

function observedUserNameParts(observations: MaterializerObservationLike[]): {
  firstInitial: string;
  lastToken: string;
} | null {
  const firstTokens = identityTokens(observationValueForField(observations, 'fname'));
  const lastTokens = identityTokens(observationValueForField(observations, 'lname'));
  const fullNameTokens = identityTokens(
    uniqueStrings([
      observationValueForField(observations, 'displayName'),
      observationValueForField(observations, 'name'),
    ]).join(' '),
  );
  const firstInitial = firstTokens[0]?.charAt(0) || fullNameTokens[0]?.charAt(0) || '';
  const lastToken = lastTokens.at(-1) || fullNameTokens.at(-1) || '';
  if (!firstInitial || lastToken.length < 3) return null;
  return { firstInitial, lastToken };
}

export function userLookupFiltersForOfficialProfileObservations(
  observations: MaterializerObservationLike[],
): Array<Record<string, unknown>> {
  if (officialUserProfileUrlsFromObservations(observations).length === 0) return [];
  const nameParts = observedUserNameParts(observations);
  if (!nameParts) return [];
  const departmentTokens = departmentIdentityTokens(observedUserDepartmentLabels(observations));
  if (departmentTokens.length === 0) return [];

  const lastName = new RegExp(escapeRegex(nameParts.lastToken), 'i');
  const departmentRegexes = departmentTokens.map((token) => new RegExp(escapeRegex(token), 'i'));
  return departmentRegexes.flatMap((department) => [
    { lname: lastName, departments: department },
    { lname: lastName, primaryDepartment: department },
    { name: lastName, departments: department },
    { name: lastName, primaryDepartment: department },
    { displayName: lastName, departments: department },
    { displayName: lastName, primaryDepartment: department },
  ]);
}

export function officialProfileObservationMatchesUser(
  observations: MaterializerObservationLike[],
  user: Record<string, unknown>,
): boolean {
  if (officialUserProfileUrlsFromObservations(observations).length === 0) return false;
  const nameParts = observedUserNameParts(observations);
  if (!nameParts) return false;
  const departmentTokens = departmentIdentityTokens(observedUserDepartmentLabels(observations));
  if (departmentTokens.length === 0) return false;

  const userNameTokens = identityTokens(
    uniqueStrings([
      user.fname,
      user.firstName,
      user.lname,
      user.lastName,
      user.name,
      user.displayName,
    ]).join(' '),
  );
  if (!userNameTokens.includes(nameParts.lastToken)) return false;
  if (!userNameTokens.some((token) => token.charAt(0) === nameParts.firstInitial)) return false;

  const userDepartmentText = normalizeIdentityText(
    uniqueStrings([
      user.primaryDepartment,
      ...(Array.isArray(user.departments) ? user.departments : [user.departments]),
    ]).join(' '),
  );
  return departmentTokens.some((token) => userDepartmentText.includes(token));
}

export function selectOfficialProfileObservationUserMatch(
  observations: MaterializerObservationLike[],
  candidates: Array<Record<string, unknown>>,
  observedKeyValue = '',
): Record<string, unknown> | null {
  const verified = candidates.filter((candidate) =>
    officialProfileObservationMatchesUser(observations, candidate),
  );
  if (verified.length <= 1) return verified[0] || null;

  const observedLocalPart = isLikelyYaleEmailLocalPart(observedKeyValue)
    ? observedKeyValue.toLowerCase()
    : '';
  if (observedLocalPart) {
    const canonicalMatches = verified.filter(
      (candidate) => textValue(candidate.netid).toLowerCase() !== observedLocalPart,
    );
    if (canonicalMatches.length === 1) return canonicalMatches[0];
  }

  return null;
}

export function emptyPostMaterializationMetrics(): Required<ReportPostMaterializationMetrics> {
  return {
    entryPathways: 0,
    accessSignals: 0,
    contactRoutes: 0,
    postedOpportunities: 0,
    undergraduateLogisticsClaims: 0,
    guardedContactRoutes: 0,
    staleEvidenceSkipped: 0,
    conflicts: 0,
    errors: 0,
  };
}

export function addPostMaterializationMetrics(
  aggregate: Required<ReportPostMaterializationMetrics>,
  next?: ReportPostMaterializationMetrics,
): void {
  if (!next) return;
  aggregate.entryPathways += next.entryPathways || 0;
  aggregate.accessSignals += next.accessSignals || 0;
  aggregate.contactRoutes += next.contactRoutes || 0;
  aggregate.postedOpportunities += next.postedOpportunities || 0;
  aggregate.undergraduateLogisticsClaims += next.undergraduateLogisticsClaims || 0;
  aggregate.guardedContactRoutes += next.guardedContactRoutes || 0;
  aggregate.staleEvidenceSkipped += next.staleEvidenceSkipped || 0;
  aggregate.conflicts += next.conflicts || 0;
  aggregate.errors += next.errors || 0;
}

function entityModelFor(entityType: ObservedEntityType): mongoose.Model<any> | null {
  switch (entityType) {
    case 'researchEntity':
      return ResearchEntity;
    case 'fellowship':
      return Fellowship;
    default:
      return null;
  }
}

function uniqueKeyFieldFor(entityType: ObservedEntityType): string | null {
  switch (entityType) {
    case 'user':
      return 'netid';
    case 'researchEntity':
      return 'slug';
    case 'fellowship':
      return 'sourceKey';
    default:
      return null;
  }
}

function uniqueKeyFieldForIdentifier(
  entityType: ObservedEntityType,
  _entityKey?: string,
): string | null {
  return uniqueKeyFieldFor(entityType);
}

export function uniqueKeyValueForIdentifier(
  entityType: ObservedEntityType,
  entityKey: string | undefined,
  obs: Array<{ field?: string; value?: unknown }>,
): string | undefined {
  if (entityType === 'user') {
    const observedNetid = obs.find((o) => o.field === 'netid' && typeof o.value === 'string')
      ?.value as string | undefined;
    if (observedNetid?.trim()) return observedNetid.trim();
    return entityKey?.replace(/^netid:/i, '').trim() || undefined;
  }

  return entityKey;
}

/**
 * Re-scrape dedupe: a fellowship whose title drifted slightly mints a new
 * sourceKey (title slug) and would otherwise create a duplicate record (#609).
 * When the exact sourceKey misses, resolve to an existing record whose
 * normalized title matches, category-agnostic. Candidates are limited to
 * records owned by the same source scraper or to legacy records with no
 * sourceName (the pre-scrape imports the catalog scraper should adopt rather
 * than clone), so two distinct non-empty producers never merge. Prefers a live
 * record, then the most recently updated one.
 */
async function findFellowshipByNormalizedTitle(
  Model: mongoose.Model<any>,
  obs: any[],
): Promise<any | null> {
  const titleObs = obs.find((o) => o.field === 'title' && typeof o.value === 'string');
  const sourceNameObs = obs.find((o) => o.field === 'sourceName' && typeof o.value === 'string');
  const titleKey = normalizedProgramTitleKey(String(titleObs?.value || ''));
  const sourceName = String(sourceNameObs?.value || '');
  if (!titleKey || !sourceName) return null;

  const candidates = await Model.find({
    $or: [{ sourceName }, { sourceName: { $in: ['', null] } }, { sourceName: { $exists: false } }],
  }).lean();
  const matches = candidates.filter(
    (candidate: any) => normalizedProgramTitleKey(String(candidate.title || '')) === titleKey,
  );
  if (matches.length === 0) return null;

  matches.sort((a: any, b: any) => {
    const archivedDelta = Number(Boolean(a.archived)) - Number(Boolean(b.archived));
    if (archivedDelta !== 0) return archivedDelta;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
  return matches[0];
}

/**
 * Re-scrape dedupe fallback: a fellowship whose title drifted by more than
 * punctuation (an inserted/dropped qualifier, e.g. "Wu Tsai Undergraduate
 * Fellowships" vs "Undergraduate Fellowships") still shares its sourceUrl
 * with the existing record and slips past findFellowshipByNormalizedTitle
 * (#609). Only fires when the sourceUrl resolves to exactly one active
 * record whose title is a qualifier-drift match (isProgramTitleQualifierDrift):
 * institutional catalog pages (e.g. funding.yale.edu/find-funding/...) are
 * shared by dozens of genuinely distinct named fellowships, including pairs
 * that share a page but have unrelated names (a college's "Richter Summer
 * Fellowship" and "Mellon Senior Research Grant"), so sourceUrl equality
 * alone is never treated as a dedupe signal.
 */
async function findFellowshipBySourceUrl(
  Model: mongoose.Model<any>,
  obs: any[],
): Promise<any | null> {
  const sourceUrlObs = obs.find((o) => o.field === 'sourceUrl' && typeof o.value === 'string');
  const sourceNameObs = obs.find((o) => o.field === 'sourceName' && typeof o.value === 'string');
  const titleObs = obs.find((o) => o.field === 'title' && typeof o.value === 'string');
  const sourceUrl = String(sourceUrlObs?.value || '').trim();
  const sourceName = String(sourceNameObs?.value || '');
  const title = String(titleObs?.value || '');
  if (!sourceUrl || !sourceName || !title) return null;

  const candidates = await Model.find({
    sourceUrl,
    archived: { $ne: true },
    $or: [{ sourceName }, { sourceName: { $in: ['', null] } }, { sourceName: { $exists: false } }],
  }).lean();
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  return isProgramTitleQualifierDrift(title, String(candidate.title || '')) ? candidate : null;
}

/**
 * Cross-source dedupe: a fund enumerated by the Student Grants Database source
 * cites its record-specific CommunityForce FundDetails URL as both its sourceUrl
 * and applicationLink. The same fund linked from a public fellowship page carries
 * that exact URL as its applicationLink. The FundDetails URL is globally unique
 * per fund, so when the same-source title/sourceUrl fallbacks miss, resolve to
 * any existing active fellowship whose applicationLink matches - so the two
 * sources merge into one record rather than duplicating (#1630). Only fires for a
 * record-specific application-portal URL (a FundDetails page with a query), never
 * a bare portal root shared by many funds, and only when exactly one active
 * record matches.
 */
async function findFellowshipByRecordSpecificApplicationLink(
  Model: mongoose.Model<any>,
  obs: any[],
): Promise<any | null> {
  const applicationLinkObs = obs.find(
    (o) => o.field === 'applicationLink' && typeof o.value === 'string',
  );
  const applicationLink = String(applicationLinkObs?.value || '').trim();
  if (!applicationLink || !isRecordSpecificApplicationPortalUrl(applicationLink)) return null;

  const candidates = await Model.find({
    applicationLink,
    archived: { $ne: true },
  })
    .limit(2)
    .lean();
  return candidates.length === 1 ? candidates[0] : null;
}

async function findEntityDocByIdentifier(
  Model: mongoose.Model<any>,
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  obs: any[],
): Promise<any | null> {
  const entityId = normalizeMaterializerObjectId(identifier.entityId);
  if (entityId) {
    return Model.findById(entityId).lean();
  }

  if (!identifier.entityKey) return null;

  const keyField = uniqueKeyFieldForIdentifier(entityType, identifier.entityKey);
  if (!keyField) throw new Error(`No keyField for entityType=${entityType}`);

  const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
  if (!keyValue) return null;

  const exact = await Model.findOne({ [keyField]: keyValue }).lean();
  if (exact) return exact;

  if (entityType === 'fellowship') {
    const byTitle = await findFellowshipByNormalizedTitle(Model, obs);
    if (byTitle) return byTitle;
    const bySourceUrl = await findFellowshipBySourceUrl(Model, obs);
    if (bySourceUrl) return bySourceUrl;
    const byApplicationLink = await findFellowshipByRecordSpecificApplicationLink(Model, obs);
    if (byApplicationLink) return byApplicationLink;
  }

  return null;
}

/**
 * Some entity schemas have required fields the scraper observation set may not
 * carry. Skip create when those aren't present rather than throwing a Mongoose
 * ValidationError that would abort the whole materialization run.
 */
function hasRequiredFieldsForCreate(
  entityType: ObservedEntityType,
  insert: Record<string, unknown>,
): boolean {
  if (isResearchEntityObservationType(entityType)) {
    return !!insert.name;
  }
  return true;
}

/**
 * Observations may carry entityId, entityKey, or both (observationStore keeps
 * whichever the scraper resolved). An entityKey-scoped materialize therefore
 * misses any entityId-only observation for the same entity - including a
 * later, higher-confidence correction - and can re-graft stale/wrong content
 * even though the resolver would have picked correctly given the full set
 * (see #1131, where this silently served the wrong person's content).
 */
// Flag-off: read only the single active row per fingerprint. Flag-on: read the
// full retained log so the projection can decide late, but still exclude
// rollback-retired rows. `superseded` is overloaded (latest-wins supersession
// vs. retireObservations permanent removal), so dropping it wholesale would
// resurface purged data; rollback rows are distinguished by rollback.rolledBackAt.
export function materializationReadScopeFilter(): Record<string, unknown> {
  return c4LosslessIngestEnabled()
    ? { 'rollback.rolledBackAt': { $exists: false } }
    : { superseded: false };
}

export async function entityIdAnchoredObservationsExcludedByEntityKeyScope(
  entityType: ObservedEntityType,
  entityId: string,
  entityKeyScopedObservations: MaterializerObservationLike[],
): Promise<any[]> {
  const entityIdObjectId = toMaterializerObjectId(entityId);
  if (!entityIdObjectId) return [];
  const alreadyIncluded = new Set(
    entityKeyScopedObservations.map((observation) => String(observation._id)),
  );
  const entityIdMatches = await Observation.find({
    entityType,
    ...materializationReadScopeFilter(),
    entityId: entityIdObjectId,
  }).lean();
  return entityIdMatches.filter(
    (observation: any) => !alreadyIncluded.has(String(observation._id)),
  );
}

/**
 * The symmetric case of #1131: an entityId-scoped materialize misses any
 * entityKey-only observation for the same entity - e.g. a source-backed
 * fullDescription emitted with entityKey=slug and no entityId - so a later
 * entityId-scoped run silently blanks a genuine description that the resolver
 * would have kept given the full set (see #1485). The graft direction #1131
 * warned about is guarded here by dropping any observation anchored to a
 * different entity's id under a shared or reassigned key.
 */
export async function entityKeyAnchoredObservationsExcludedByEntityIdScope(
  entityType: ObservedEntityType,
  entityId: string,
  entityKey: string | undefined,
  entityIdScopedObservations: MaterializerObservationLike[],
): Promise<any[]> {
  if (!entityKey) return [];
  const entityIdObjectId = toMaterializerObjectId(entityId);
  const alreadyIncluded = new Set(
    entityIdScopedObservations.map((observation) => String(observation._id)),
  );
  const entityKeyMatches = await Observation.find({
    entityType,
    ...materializationReadScopeFilter(),
    entityKey,
  }).lean();
  return entityKeyMatches.filter((observation: any) => {
    if (alreadyIncluded.has(String(observation._id))) return false;
    if (
      observation.entityId &&
      entityIdObjectId &&
      String(observation.entityId) !== String(entityIdObjectId)
    ) {
      return false;
    }
    return true;
  });
}

const ACCOUNT_NETID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function normalizedAccountNetid(value: unknown): string | undefined {
  const netid = textValue(value).trim().toLowerCase();
  return netid && ACCOUNT_NETID_PATTERN.test(netid) ? netid : undefined;
}

const ACCOUNT_EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

function normalizedAccountEmail(value: unknown): string | undefined {
  const email = textValue(value).trim().toLowerCase();
  return email && ACCOUNT_EMAIL_PATTERN.test(email) ? email : undefined;
}

const ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT = 10;

function accountIsLive(account: { archived?: boolean; status?: string } | undefined): boolean {
  return !!account && account.archived !== true && account.status !== 'DISABLED';
}

/**
 * `accountSchema.index({ email: 1 })` is not unique and accounts are minted with a
 * synthetic `${netid}@yale.edu`, so one address can be claimed by several rows (a
 * student and a staff netid, a recycled `first.last` alias, a departed account next
 * to its replacement). An arbitrary index-order pick would join person evidence to
 * whichever row came first, so this fails closed unless exactly one live account
 * claims the address.
 */
async function soleLiveAccountClaimingEmail(email: string): Promise<any | undefined> {
  const candidates: any[] = await Account.find({ email })
    .limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT)
    .lean();
  const live = candidates.filter(accountIsLive);
  return live.length === 1 ? live[0] : undefined;
}

/**
 * The email join has no name resolver behind it, so it carries its own name check:
 * the observed name must agree on surname and given name with the researcher the
 * account already backs. Reuses the same comparators as
 * `resolveResearcherIdForPersonName` so both lanes agree on what "same person" means.
 */
function observedPersonNameAgreesWith(
  storedDisplayName: unknown,
  observedDisplayName: string,
): boolean {
  const stored = splitName(textValue(storedDisplayName));
  const observed = splitName(observedDisplayName);
  if (!stored.last || !observed.last) return false;
  if (!surnamesCompatible(observed.last, stored.last)) return false;
  if (!stored.first || !observed.first) return false;
  return (
    stored.first.toLowerCase() === observed.first.toLowerCase() ||
    givenNamesEquivalent(observed.first, stored.first)
  );
}

/**
 * `identifiers.netid` is a join key later runs trust without a name check
 * (`researcherPersonNameResolver` returns on an `identifiers.netid` hit), so only an
 * account's own netid may be stamped there. An observed value can be the roster's
 * email alias (`corey.ohern`) rather than the netid (`co54`), and stamping that would
 * turn a source's naming habit into a name-bypassing identity claim.
 */
async function accountNetidForResearcherLink(
  linkedAccountId: unknown,
  knownAccount: any,
): Promise<string | undefined> {
  if (!linkedAccountId) return undefined;
  if (knownAccount?._id && String(knownAccount._id) === String(linkedAccountId)) {
    return normalizedAccountNetid(knownAccount.netid);
  }
  const linked: any = await Account.findById(linkedAccountId).select('netid').lean();
  return normalizedAccountNetid(linked?.netid);
}

function scholarProfileLink(url: string, verifiedAt: Date): ResearcherProfileLink {
  return { kind: 'GOOGLE_SCHOLAR', purpose: 'SCHOLARLY', url, verifiedAt, healthStatus: 'UNKNOWN' };
}

function orcidProfileLink(orcid: string, verifiedAt: Date): ResearcherProfileLink {
  return {
    kind: 'ORCID',
    purpose: 'SCHOLARLY',
    url: `https://orcid.org/${orcid}`,
    verifiedAt,
    healthStatus: 'UNKNOWN',
  };
}

function boundedResearcherProfileText(
  key: keyof ResearcherDisplayProfile,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const bound = researcherDisplayProfileSchema.path(key).options.maxlength;
  if (typeof bound !== 'number' || value.length <= bound) return value;
  return value.slice(0, bound).trim() || undefined;
}

async function materializeUserIdentityToResearcher(
  identifier: { entityId?: string; entityKey?: string },
  obs: any[],
): Promise<MaterializeResult> {
  const skipped = (reason: string): MaterializeResult => ({
    entityType: 'user',
    ...identifier,
    fieldsWritten: 0,
    conflicts: 0,
    created: false,
    resolved: {},
    skipped: reason,
  });

  const materializationObs = obs.filter(
    (o: any) => !shouldIgnoreObservationForEntityMaterialization('user', o),
  );
  const resolverObs: ResolverObservation[] = materializationObs.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));
  const resolved = resolveAllFields(resolverObs);
  const resolvedValue = (field: string): unknown => resolved[field]?.value;

  const netid =
    normalizedAccountNetid(uniqueKeyValueForIdentifier('user', identifier.entityKey, obs)) ??
    normalizedAccountNetid(resolvedValue('netid'));
  const displayName =
    textValue(resolvedValue('displayName')) ||
    [textValue(resolvedValue('fname')), textValue(resolvedValue('lname'))]
      .filter(Boolean)
      .join(' ')
      .trim();
  const title = textValue(resolvedValue('title')) || undefined;
  const primaryDepartment = textValue(resolvedValue('primaryDepartment')) || undefined;
  const imageUrl = textValue(resolvedValue('imageUrl')) || undefined;
  const websiteUrl =
    textValue(resolvedValue('websiteUrl')) || textValue(resolvedValue('website')) || undefined;
  const orcidCandidate = textValue(resolvedValue('orcid')).trim().toUpperCase();
  const orcid = orcidCandidate && isValidOrcid(orcidCandidate) ? orcidCandidate : undefined;
  const profileUrls =
    resolvedValue('profileUrls') && typeof resolvedValue('profileUrls') === 'object'
      ? (resolvedValue('profileUrls') as Record<string, unknown>)
      : undefined;

  const observedEmail = normalizedAccountEmail(resolvedValue('email'));

  let account: any = netid ? await Account.findOne({ netid }).lean() : null;
  const accountNetid = normalizedAccountNetid(account?.netid);

  let researcher: any = account?._id ? await Researcher.findOne({ accountId: account._id }) : null;
  if (!researcher && displayName) {
    const resolution = await resolveResearcherIdForPersonName(displayName, {
      netid: accountNetid ?? netid,
    });
    if (resolution.status === 'matched' && resolution.researcherId) {
      researcher = await Researcher.findById(resolution.researcherId);
    }
  }
  /**
   * A department roster publishes the friendly email alias rather than the netid,
   * and `corey.ohern` passes the netid shape test, so the netid lookup silently
   * misses for the 95% of accounts whose email local part differs from their netid
   * (#2325). Joining on the observed email closes that gap.
   *
   * It runs last, only when neither the netid nor the name reached anything, and
   * only when the email account's own researcher carries a compatible name, because
   * the email is not trustworthy enough to name a person on its own: on Development
   * this join disagrees with the name resolver for 12 keys, and
   * `patricia.ryan-krause@yale.edu` resolves to an account whose researcher is a
   * different person entirely (Peter James Krause). Filling a gap gains the 177 keys
   * nothing else reaches; overriding, or joining an address to a name it disagrees
   * with, would re-point one person's evidence onto another's record.
   */
  let identityJoinedOnEmailAlone = false;
  if (!researcher && !account && observedEmail) {
    const emailAccount = await soleLiveAccountClaimingEmail(observedEmail);
    const emailResearcher = emailAccount?._id
      ? await Researcher.findOne({ accountId: emailAccount._id })
      : null;
    const emailAccountNamesThisPerson =
      !displayName || observedPersonNameAgreesWith(emailResearcher?.displayName, displayName);
    if (emailResearcher && emailAccountNamesThisPerson) {
      researcher = emailResearcher;
      account = emailAccount;
      identityJoinedOnEmailAlone = true;
    }
  }
  const accountId: mongoose.Types.ObjectId | undefined = account?._id;

  if (!researcher) {
    return skipped('directory-identity-without-research-signal');
  }
  const created = false;

  let fieldsWritten = 0;
  // An email-only join enriches the profile but never renames the researcher: the
  // address vouched for the account, not for what the person is called.
  if (!identityJoinedOnEmailAlone && displayName && researcher.displayName !== displayName) {
    researcher.displayName = displayName;
    fieldsWritten += 1;
  }
  if (accountId && !researcher.accountId) {
    researcher.accountId = accountId;
    fieldsWritten += 1;
  }
  researcher.profile = researcher.profile || {};
  for (const [key, value] of [
    ['title', title],
    ['primaryDepartment', primaryDepartment],
    ['imageUrl', imageUrl],
    ['websiteUrl', websiteUrl],
  ] as const) {
    const bounded = boundedResearcherProfileText(key, value);
    if (bounded && researcher.profile[key] !== bounded) {
      researcher.profile[key] = bounded;
      fieldsWritten += 1;
    }
  }
  const priorOrcid: string | undefined = researcher.identifiers?.orcid;
  const priorOrcidLinks: ResearcherProfileLink[] = (researcher.profileLinks || []).filter(
    (link: ResearcherProfileLink) => link.kind === 'ORCID',
  );
  let orcidFieldsWritten = 0;
  if (orcid && priorOrcid !== orcid) {
    researcher.identifiers = { ...(researcher.identifiers || {}), orcid };
    orcidFieldsWritten += 1;
  }
  const priorNetid: string | undefined = researcher.identifiers?.netid;
  const netidToStamp = await accountNetidForResearcherLink(researcher.accountId, account);
  let netidFieldsWritten = 0;
  if (netidToStamp && priorNetid !== netidToStamp) {
    researcher.identifiers = { ...(researcher.identifiers || {}), netid: netidToStamp };
    netidFieldsWritten += 1;
  }

  const now = new Date();
  const existingLinkKinds = new Set(
    (researcher.profileLinks || []).map((link: ResearcherProfileLink) => link.kind),
  );
  const officialLink = profileUrls ? composeOfficialProfileLink({ profileUrls }, now) : undefined;
  if (officialLink && !existingLinkKinds.has('YALE_OFFICIAL')) {
    researcher.profileLinks.push(officialLink);
    fieldsWritten += 1;
  } else if (officialLink) {
    const supersedesStoredOfficialLink = (link: ResearcherProfileLink): boolean =>
      link.kind === 'YALE_OFFICIAL' && supersedesOfficialProfileUrl(link.url, officialLink.url);
    if ((researcher.profileLinks || []).some(supersedesStoredOfficialLink)) {
      researcher.profileLinks = (researcher.profileLinks || []).map(
        (link: ResearcherProfileLink) => (supersedesStoredOfficialLink(link) ? officialLink : link),
      );
      fieldsWritten += 1;
    }
  }
  const scholarUrl = profileUrls
    ? canonicalScholarCitationUrl(profileUrls.googleScholar)
    : undefined;
  if (scholarUrl && !existingLinkKinds.has('GOOGLE_SCHOLAR')) {
    researcher.profileLinks.push(scholarProfileLink(scholarUrl, now));
    fieldsWritten += 1;
  }
  if (orcid) {
    const currentOrcidLink = orcidProfileLink(orcid, now);
    if (priorOrcidLinks.every((link) => link.url !== currentOrcidLink.url)) {
      researcher.profileLinks = [
        ...(researcher.profileLinks || []).filter(
          (link: ResearcherProfileLink) => link.kind !== 'ORCID',
        ),
        currentOrcidLink,
      ];
      orcidFieldsWritten += 1;
    }
  }

  fieldsWritten += orcidFieldsWritten + netidFieldsWritten;
  let conflicts = 0;

  const forgiveOrcidCollision = (): void => {
    researcher.set('identifiers.orcid', priorOrcid);
    researcher.profileLinks = [
      ...(researcher.profileLinks || []).filter(
        (link: ResearcherProfileLink) => link.kind !== 'ORCID',
      ),
      ...priorOrcidLinks,
    ];
    fieldsWritten -= orcidFieldsWritten;
    orcidFieldsWritten = 0;
    conflicts += 1;
    console.warn(
      'Directory identity ORCID already claimed by another researcher; keeping prior identity:',
      sanitizeLogValue({
        researcherId: materializerDocumentId(researcher._id),
        entityKey: identifier.entityKey,
        collidingOrcid: orcid,
      }),
    );
  };

  const forgiveNetidCollision = (): void => {
    researcher.set('identifiers.netid', priorNetid);
    fieldsWritten -= netidFieldsWritten;
    netidFieldsWritten = 0;
    conflicts += 1;
    console.warn(
      'Directory identity netid already claimed by another researcher; keeping prior identity:',
      sanitizeLogValue({
        researcherId: materializerDocumentId(researcher._id),
        entityKey: identifier.entityKey,
        collidingNetid: netidToStamp,
      }),
    );
  };

  // The unique sparse indexes on `identifiers.orcid` and `identifiers.netid` mean a
  // value another researcher already claims aborts the whole save, so each colliding
  // identifier is rolled back and counted as a conflict, letting the rest of the
  // profile land and making the collision visible instead of failing the key.
  for (;;) {
    try {
      await researcher.save();
      break;
    } catch (error) {
      if (orcidFieldsWritten > 0 && isOrcidDuplicateKeyError(error)) {
        forgiveOrcidCollision();
        continue;
      }
      if (netidFieldsWritten > 0 && isNetidDuplicateKeyError(error)) {
        forgiveNetidCollision();
        continue;
      }
      throw error;
    }
  }

  return {
    entityType: 'user',
    entityId: materializerDocumentId(researcher._id),
    entityKey: identifier.entityKey,
    fieldsWritten,
    conflicts,
    created,
    resolved,
  };
}

export interface ProjectFromLogInput {
  resolved: Record<string, ResolvedField>;
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  entityDoc: any;
  materializationObs: any[];
  resolverObs: ResolverObservation[];
  fullDescriptionShellGated: boolean;
  now: Date;
  synthesizeCardDescription?: (fullDescription: string) => Promise<string>;
  writeOnlyFields?: string[];
  applyDescriptionResearchAreaDerivation?: typeof applyDescriptionResearchAreaDerivation;
  applyResearchEntityOrgUnitCanonicalization?: typeof applyResearchEntityOrgUnitCanonicalization;
  applyResearchEntityResearchAreaCanonicalization?: typeof applyResearchEntityResearchAreaCanonicalization;
}

export interface ProjectFromLogResult {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  conflicts: number;
  fieldsWritten: number;
}

const RESEARCH_ENTITY_IDENTITY_NAME_FIELDS = ['name', 'displayName'] as const;

/**
 * Refuses a name that identifies nothing (placeholder filler like "n/a"), or that
 * names something other than this person-scoped record: an umbrella organization
 * it merely belongs to, or a different person's lab.
 *
 * Filler is refused here as well as at ingest because ingest only ever guards a
 * value on its way in. An already-stored "n/a" is re-projected from its own
 * already-active observation on every pass, and refusing the emitting source's
 * fresh copy at ingest stops that stale row from ever being superseded, so
 * without this arm the record could only be repaired by hand (#2367).
 *
 * It lives here rather than in a scraper because a per-source guard only ever
 * covers the source it was written for. #2234 put this check inside the lab
 * microsite extractor; `official-profile-pi-backfill` went on grafting "Liver
 * Center" onto a person, because the all-source ingest sanitizer has no entity
 * identity to judge against and this stage does.
 *
 * It judges the EFFECTIVE served value (`set ?? entityDoc`) rather than only a
 * freshly resolved one. Retiring a graft observation does not rewrite the
 * document, and `displayName` is emitted by no faculty-directory source, so
 * nothing else would ever overwrite it, which left person-scoped records serving
 * names whose observations had already been rolled back (#2351).
 *
 * `displayName` clears on failure because every serve path falls back to `name`.
 * `name` only ever moves to a ranked candidate that passes, so refusing a graft
 * can never leave a record nameless.
 */
function enforceResearchEntityNameAuthority(input: {
  entityType: ObservedEntityType;
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  derivedKind: string | undefined;
  resolverObs: ResolverObservation[];
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  materializationObs: MaterializerObservationLike[];
  sourceEntityIdentity: ResearchEntityIdentity | undefined;
}): number {
  const { set, unset, confidenceByField, entityDoc } = input;
  const recordIdentity = {
    entityType: set.entityType ?? entityDoc?.entityType,
    kind: set.kind ?? input.derivedKind ?? entityDoc?.kind,
    slug: entityDoc?.slug ?? input.sourceEntityIdentity?.slug,
  };
  // The URL a value was harvested from is what corroborates a foreign eponym, so
  // every value is judged against its OWN provenance: the served value against
  // whatever is on the document, and each replacement candidate against the
  // provenance that candidate would bring with it. Judging a candidate against
  // the outgoing value's URL would clear another person's eponymous lab whenever
  // the refused value happened to come from somewhere else.
  const servedProvenanceSourceUrl = (field: string): unknown =>
    objectRecord(set[`fieldProvenance.${field}`] ?? entityDoc?.fieldProvenance?.[field]).sourceUrl;
  // A candidate with no matching observation provenance (a manual value) has no
  // URL of its own, so the record's own linked site is the last corroboration
  // available rather than letting the foreign-lab check fail open.
  const recordWebsiteUrl =
    textValue(set.websiteUrl ?? entityDoc?.websiteUrl) ||
    textValue(set.website ?? entityDoc?.website);
  const namesNothingUsable = (candidateName: unknown, websiteUrl: unknown): boolean =>
    isPlaceholderEntityName(candidateName) ||
    personScopedResearchEntityNameNamesSomethingElseByUrlPath({
      ...recordIdentity,
      candidateName,
      websiteUrl,
    });

  let fieldsWritten = 0;
  for (const field of RESEARCH_ENTITY_IDENTITY_NAME_FIELDS) {
    if (input.manuallyLockedFields.includes(field)) continue;
    const servedValue = set[field] ?? entityDoc?.[field];
    if (
      !textValue(servedValue) ||
      !namesNothingUsable(servedValue, servedProvenanceSourceUrl(field))
    ) {
      continue;
    }

    const replacement = resolveFieldRanked(field, input.resolverObs, {
      manuallyLockedFields: input.manuallyLockedFields,
      manualValues: input.manualValues,
    })
      .map((candidate) => {
        const provenance = fieldProvenanceForResolvedObservation(
          field,
          candidate,
          input.materializationObs,
        );
        return {
          candidate,
          provenance,
          candidateSourceUrl: objectRecord(provenance).sourceUrl || recordWebsiteUrl,
          materialized: sanitizeProjectedField(
            input.entityType,
            field,
            candidate.value,
            entityDoc?.[field],
            input.sourceEntityIdentity,
          ),
        };
      })
      .find(
        ({ materialized, candidateSourceUrl }) =>
          textValue(materialized) &&
          textValue(materialized) !== textValue(servedValue) &&
          !namesNothingUsable(materialized, candidateSourceUrl),
      );

    if (replacement) {
      set[field] = replacement.materialized;
      confidenceByField[field] = replacement.candidate.confidence;
      if (replacement.provenance) {
        set[`fieldProvenance.${field}`] = replacement.provenance;
      }
      fieldsWritten++;
      continue;
    }
    if (field === 'name') continue;
    delete set[field];
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (textValue(entityDoc?.[field])) {
      unset[field] = '';
      unset[`fieldProvenance.${field}`] = '';
      fieldsWritten++;
    }
  }
  return fieldsWritten;
}

export async function projectFromLog(
  entityType: ObservedEntityType,
  input: ProjectFromLogInput,
): Promise<ProjectFromLogResult> {
  const {
    resolved,
    manuallyLockedFields,
    manualValues,
    entityDoc,
    materializationObs,
    resolverObs,
    fullDescriptionShellGated,
  } = input;
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  const confidenceByField: Record<string, number> = {
    ...(entityDoc?.confidenceByField || {}),
  };
  const sourceEntityIdentity: ResearchEntityIdentity | undefined = isResearchEntityObservationType(
    entityType,
  )
    ? {
        slug: entityDoc?.slug,
        name: entityDoc?.name,
        displayName: entityDoc?.displayName,
        school: entityDoc?.school,
        schools: entityDoc?.schools,
        departments: entityDoc?.departments,
        fullDescription: entityDoc?.fullDescription,
        recentGrants: entityDoc?.recentGrants,
      }
    : undefined;
  let conflicts = 0;
  let fieldsWritten = 0;
  const derivedKind = isResearchEntityObservationType(entityType)
    ? derivedResearchGroupKind(
        manuallyLockedFields.includes('entityType') ? undefined : resolved.entityType?.value,
        entityDoc?.entityType,
      )
    : undefined;
  for (const [field, r] of Object.entries(resolved)) {
    if (manuallyLockedFields.includes(field)) continue;
    const nextValue = r.value;
    if (
      isResearchEntityObservationType(entityType) &&
      field === 'shortDescription' &&
      !resolvedShortDescriptionCandidateIsUsable(
        nextValue,
        resolved.fullDescription?.value ?? entityDoc?.fullDescription,
        isProgramLikeResearchEntity({
          kind: derivedKind ?? resolved.kind?.value ?? entityDoc?.kind,
          entityType: resolved.entityType?.value ?? entityDoc?.entityType,
        }),
      )
    ) {
      continue;
    }
    set[field] = sanitizeProjectedField(
      entityType,
      field,
      nextValue,
      entityDoc?.[field],
      sourceEntityIdentity,
    );
    confidenceByField[field] = r.confidence;
    if (isResearchEntityObservationType(entityType)) {
      const provenance = fieldProvenanceForResolvedObservation(field, r, materializationObs);
      if (provenance) set[`fieldProvenance.${field}`] = provenance;
    }
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }
  if (
    derivedKind &&
    !manuallyLockedFields.includes('kind') &&
    (set.kind ?? entityDoc?.kind) !== derivedKind
  ) {
    set.kind = derivedKind;
    fieldsWritten++;
  }
  if (isResearchEntityObservationType(entityType)) {
    fieldsWritten += enforceResearchEntityNameAuthority({
      entityType,
      set,
      unset,
      confidenceByField,
      entityDoc,
      derivedKind,
      resolverObs,
      manuallyLockedFields,
      manualValues,
      materializationObs,
      sourceEntityIdentity,
    });
  }
  if (isResearchEntityObservationType(entityType)) {
    if (!manuallyLockedFields.includes('fullDescription') && resolved.fullDescription) {
      const currentShortForFullDistinctness = textValue(
        set.shortDescription ?? entityDocShortDescriptionForRestatementGuard(entityDoc),
      );
      const cardShortForFullInversion = textValue(
        set.shortDescription ?? entityDoc?.shortDescription,
      );
      const winnerFull = textValue(set.fullDescription);
      const fullDescriptionIsAcceptable = (candidateText: string): boolean =>
        !!candidateText &&
        fullDescriptionQuality(candidateText).isUseful &&
        !isFullDescriptionRestatementOfShortDescription(
          candidateText,
          currentShortForFullDistinctness,
        );
      const winnerFullAcceptable = fullDescriptionIsAcceptable(winnerFull);
      const winnerFullUseful =
        winnerFullAcceptable && !isPoorerThanCardDescription(winnerFull, cardShortForFullInversion);
      if (!winnerFullUseful) {
        const rankedFull = resolveFieldRanked('fullDescription', resolverObs, {
          manuallyLockedFields,
          manualValues,
        });
        let fallback: { materialized: unknown; candidate: ResolvedField } | undefined;
        let preferred: { materialized: unknown; candidate: ResolvedField } | undefined;
        for (const candidate of rankedFull) {
          const materialized = sanitizeProjectedField(
            entityType,
            'fullDescription',
            candidate.value,
            entityDoc?.fullDescription,
            sourceEntityIdentity,
          );
          const materializedText = textValue(materialized);
          if (!fullDescriptionIsAcceptable(materializedText)) continue;
          if (!fallback) fallback = { materialized, candidate };
          if (!isPoorerThanCardDescription(materializedText, cardShortForFullInversion)) {
            preferred = { materialized, candidate };
            break;
          }
        }
        // An already-acceptable winner is only ever replaced by a candidate that
        // also fixes the inversion: falling back to the ranked runner-up when no
        // such candidate exists would demote a full the current rules accept.
        const chosen = preferred ?? (winnerFullAcceptable ? undefined : fallback);
        if (chosen && chosen.materialized !== set.fullDescription) {
          set.fullDescription = chosen.materialized;
          confidenceByField.fullDescription = chosen.candidate.confidence;
          const provenance = fieldProvenanceForResolvedObservation(
            'fullDescription',
            chosen.candidate,
            materializationObs,
          );
          if (provenance) set['fieldProvenance.fullDescription'] = provenance;
          fieldsWritten++;
        }
      }
      const finalFullText = textValue(set.fullDescription);
      if (
        finalFullText &&
        isFullDescriptionRestatementOfShortDescription(
          finalFullText,
          currentShortForFullDistinctness,
        )
      ) {
        set.fullDescription = '';
        fieldsWritten++;
      }
    }
    const fullDescription =
      textValue(set.fullDescription) ||
      sanitizeResearchEntityDescription(textValue(entityDoc?.fullDescription));
    const entityName = textValue(
      set.name ?? set.displayName ?? entityDoc?.name ?? entityDoc?.displayName,
    );
    const isProgramLikeEntity = isProgramLikeResearchEntity({
      kind: set.kind ?? entityDoc?.kind,
      entityType: set.entityType ?? entityDoc?.entityType,
    });
    const groundedShortDescription = await resolveMaterializedShortDescription({
      fullDescription,
      // When the single-PI-shell guard just rejected fullDescription in favor
      // of the entity's existing org-level value, shortDescription must be
      // re-derived from that corrected body rather than kept as-is: it may
      // still be the seed PI's own grant sentence and now contradicts the
      // fixed full (issue #1595).
      currentShortDescription: fullDescriptionShellGated
        ? undefined
        : (set.shortDescription ?? entityDoc?.shortDescription),
      researchAreas: set.researchAreas ?? entityDoc?.researchAreas,
      isProgramLike: isProgramLikeEntity,
      manuallyLocked: manuallyLockedFields.includes('shortDescription'),
      synthesize: input.synthesizeCardDescription ?? defaultMaterializerCardSynthesizer(entityName),
    });
    if (groundedShortDescription) {
      set.shortDescription = groundedShortDescription;
      const fullDescriptionConfidence = resolved.fullDescription?.confidence;
      if (typeof fullDescriptionConfidence === 'number') {
        confidenceByField.shortDescription = fullDescriptionConfidence;
      }
      const provenance = resolved.fullDescription
        ? fieldProvenanceForResolvedObservation(
            'fullDescription',
            resolved.fullDescription,
            materializationObs,
          )
        : undefined;
      if (provenance) set['fieldProvenance.shortDescription'] = provenance;
      fieldsWritten++;
    }
    if (isProgramLikeEntity && !manuallyLockedFields.includes('fullDescription')) {
      const finalShortText = textValue(
        set.shortDescription ?? entityDocShortDescriptionForRestatementGuard(entityDoc),
      );
      const finalFullText = textValue(set.fullDescription ?? entityDoc?.fullDescription);
      if (
        finalFullText &&
        finalShortText &&
        isFullDescriptionRestatementOfShortDescription(finalFullText, finalShortText)
      ) {
        set.fullDescription = '';
        fieldsWritten++;
      }
    }
  }
  if (isResearchEntityObservationType(entityType)) {
    const orgUnitProfileUrls = [
      ...(typeof set.websiteUrl === 'string' && set.websiteUrl
        ? [set.websiteUrl]
        : typeof entityDoc?.websiteUrl === 'string' && entityDoc.websiteUrl
          ? [entityDoc.websiteUrl]
          : []),
      ...(Array.isArray(set.sourceUrls)
        ? set.sourceUrls
        : Array.isArray(entityDoc?.sourceUrls)
          ? entityDoc.sourceUrls
          : []),
    ].filter((url): url is string => typeof url === 'string');
    await (input.applyDescriptionResearchAreaDerivation ?? applyDescriptionResearchAreaDerivation)(
      set,
      entityDoc,
    );
    await (
      input.applyResearchEntityOrgUnitCanonicalization ?? applyResearchEntityOrgUnitCanonicalization
    )(set, entityDoc, orgUnitProfileUrls);
    await (
      input.applyResearchEntityResearchAreaCanonicalization ??
      applyResearchEntityResearchAreaCanonicalization
    )(set, set.departments ?? entityDoc?.departments);
    // The detail-page official-profile CTA reads only entity.sourceUrls, so a
    // lead's official profile page must land there or the way-in disappears
    // even though it is a known source (issue #613).
    if (!manuallyLockedFields.includes('sourceUrls')) {
      const leadProfileUrl = officialLeadProfileSourceUrl(materializationObs);
      if (leadProfileUrl) {
        const currentSourceUrls = Array.isArray(set.sourceUrls)
          ? (set.sourceUrls as unknown[])
          : Array.isArray(entityDoc?.sourceUrls)
            ? (entityDoc?.sourceUrls as unknown[])
            : [];
        const leadDestination = normalizeOfficialProfileDestination(leadProfileUrl);
        const alreadyPresent = currentSourceUrls.some(
          (url) =>
            normalizeOfficialProfileDestination(typeof url === 'string' ? url : '') ===
            leadDestination,
        );
        if (!alreadyPresent) {
          set.sourceUrls = sanitizeResearchEntitySourceUrlsForMaterialization([
            ...currentSourceUrls,
            leadProfileUrl,
          ]);
          fieldsWritten++;
        }
      }
    }
    // websiteUrl resolves after the #613 sourceUrls projection: it clears a profile-page
    // websiteUrl the entity already cites, so it has to see the projection this same pass
    // or the duplicate way-in stays live until the next materialization (issue #2352).
    if (!manuallyLockedFields.includes('websiteUrl')) {
      const websiteResolution = deriveResearchEntityWebsiteUrl(set, entityDoc);
      if (websiteResolution.action === 'set') {
        set.websiteUrl = websiteResolution.websiteUrl;
        fieldsWritten++;
      } else if (websiteResolution.action === 'clear') {
        set.websiteUrl = '';
        fieldsWritten++;
      }
    }
    if (yaleStatusCacheIsWritable({ manuallyLockedFields })) {
      const populatedYaleStatusField = (setValue: unknown, docValue: unknown): unknown => {
        if (typeof setValue === 'string') return setValue.trim().length > 0 ? setValue : docValue;
        if (Array.isArray(setValue)) return setValue.length > 0 ? setValue : docValue;
        return setValue ?? docValue;
      };
      const yaleStatusSignal = deriveResearchEntityYaleStatus({
        sourceUrls: populatedYaleStatusField(set.sourceUrls, entityDoc?.sourceUrls),
        websiteUrl: populatedYaleStatusField(set.websiteUrl, entityDoc?.websiteUrl),
        name: populatedYaleStatusField(set.name, entityDoc?.name),
        displayName: populatedYaleStatusField(set.displayName, entityDoc?.displayName),
        fullDescription: populatedYaleStatusField(set.fullDescription, entityDoc?.fullDescription),
        shortDescription: populatedYaleStatusField(
          set.shortDescription,
          entityDoc?.shortDescription,
        ),
        profileSynthesisDescription: populatedYaleStatusField(
          set.profileSynthesisDescription,
          entityDoc?.profileSynthesisDescription,
        ),
        // Read straight off the stored doc: no observation ever resolves a
        // suppression reason, so there is no `set` value to prefer. This field is
        // what makes the recorded-closure arm of the derivation reachable at all
        // (#1923); omit it and that arm silently never fires from materialize.
        studentVisibilitySuppressionReason: entityDoc?.studentVisibilitySuppressionReason,
      });
      if (yaleStatusSignal) {
        if (entityDoc?.activeAtYaleCache !== false) fieldsWritten++;
        set.yaleStatusCache = yaleStatusSignal.yaleStatusCache;
        set.activeAtYaleCache = yaleStatusSignal.activeAtYaleCache;
        set.yaleStatusReasonCache = yaleStatusSignal.reason;
      } else if (hasEvidencelessInactiveYaleStatus(entityDoc)) {
        set.yaleStatusCache = CLEARED_RESEARCH_ENTITY_YALE_STATUS.yaleStatusCache;
        set.activeAtYaleCache = CLEARED_RESEARCH_ENTITY_YALE_STATUS.activeAtYaleCache;
        set.yaleStatusReasonCache = CLEARED_RESEARCH_ENTITY_YALE_STATUS.yaleStatusReasonCache;
        fieldsWritten++;
      }
    }
    // Root-cause fix (issue #1802): a discovered entity always carries its
    // source in observation provenance, yet its own `sourceUrls` can be empty,
    // so `missing_source_url` fired for source-backed records purely as a
    // projection gap. When the entity would otherwise expose no reachable http
    // source, project its best-confidence provenance source url so source-backing
    // is recognized. Runs AFTER yale-status derivation so an incidental provenance
    // url never perturbs the explicit-signal status derivation (#1308); scoped to
    // the empty case so already-sourced entities do not accrue extra shared urls
    // that could trip exact-url duplicate detection.
    if (!manuallyLockedFields.includes('sourceUrls')) {
      const currentSourceUrls = Array.isArray(set.sourceUrls)
        ? (set.sourceUrls as unknown[])
        : Array.isArray(entityDoc?.sourceUrls)
          ? (entityDoc?.sourceUrls as unknown[])
          : [];
      const hasReachableHttpSource = [
        set.websiteUrl ?? entityDoc?.websiteUrl,
        (entityDoc as Record<string, unknown> | null | undefined)?.website,
        ...currentSourceUrls,
      ].some((value) => /^https?:\/\//i.test(textValue(value)));
      if (!hasReachableHttpSource) {
        const provenanceSourceUrl = bestMaterializationProvenanceSourceUrl(materializationObs);
        if (provenanceSourceUrl) {
          set.sourceUrls = sanitizeResearchEntitySourceUrlsForMaterialization([
            ...currentSourceUrls,
            provenanceSourceUrl,
          ]);
          fieldsWritten++;
        }
      }
    }
  }
  set.confidenceByField = confidenceByField;
  set.lastObservedAt = input.now;

  if (isResearchEntityObservationType(entityType) && entityDoc) {
    const fieldsWithLiveObservation = new Set(resolverObs.map((o) => o.field));
    for (const field of CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS) {
      if (manuallyLockedFields.includes(field)) continue;
      if (field in set) continue;
      if (fieldsWithLiveObservation.has(field)) continue;
      if (!isClearableStaleFieldValue((entityDoc as Record<string, unknown>)[field])) continue;
      unset[field] = '';
      delete confidenceByField[field];
    }
  }

  if (input.writeOnlyFields && input.writeOnlyFields.length > 0) {
    // `kind` is derived from `entityType`, so a field-scoped rematerialization
    // that writes one without the other would reintroduce the drift (#2144).
    const scopedFields =
      input.writeOnlyFields.includes('entityType') && !input.writeOnlyFields.includes('kind')
        ? [...input.writeOnlyFields, 'kind']
        : input.writeOnlyFields;
    fieldsWritten = restrictMaterializerSetToFields(set, unset, confidenceByField, scopedFields);
  }
  return { set, unset, confidenceByField, conflicts, fieldsWritten };
}

function isDuplicateKeyMongoError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: number }).code === 11000);
}

function isOrcidDuplicateKeyError(error: unknown): boolean {
  if (!isDuplicateKeyMongoError(error)) return false;
  const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
  if (keyPattern && Object.keys(keyPattern).some((key) => key.includes('identifiers.orcid'))) {
    return true;
  }
  return ((error as { message?: string }).message || '').includes('identifiers.orcid');
}

function isNetidDuplicateKeyError(error: unknown): boolean {
  if (!isDuplicateKeyMongoError(error)) return false;
  const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
  if (keyPattern && Object.keys(keyPattern).some((key) => key.includes('identifiers.netid'))) {
    return true;
  }
  return ((error as { message?: string }).message || '').includes('identifiers.netid');
}

function c4ResolveAtMintEntitiesEnabled(): boolean {
  return process.env.C4_RESOLVE_AT_MINT_ENTITIES === 'true';
}

function resolverTypeForEntity(entityType: ObservedEntityType): 'researchEntity' | 'fellowship' {
  return entityType === 'fellowship' ? 'fellowship' : 'researchEntity';
}

function buildEntityResolverSelf(obs: Array<{ field: string; value?: unknown }>): CandidateEntity {
  const map = new Map<string, string>();
  for (const o of obs) {
    const v =
      typeof o.value === 'string' ? o.value.trim() : o.value == null ? '' : String(o.value).trim();
    if (v && !map.has(o.field)) map.set(o.field, v);
  }
  return { id: '', name: map.get('name') || undefined };
}

async function findEntityCandidatesByKey(
  resolverType: 'researchEntity' | 'fellowship',
  key: CanonicalKey,
): Promise<CandidateEntity[]> {
  if (resolverType === 'fellowship') {
    if (key.ns !== 'source-key') return [];
    const doc = (await Fellowship.findOne({ sourceKey: key.value }).select('_id title').lean()) as {
      _id: unknown;
      title?: string;
    } | null;
    return doc ? [{ id: String(doc._id), name: doc.title }] : [];
  }
  // Non-normalized keys (website-url, profile-lab-url, org-name) are resolved via
  // the canonical-alias ledger (resolveAlias), not a live corpus scan: the DB does
  // not store their normalized form, and the ledger accumulates them on merge/mint.
  if (key.ns === 'slug') {
    const doc = (await ResearchEntity.findOne({ slug: key.value, archived: { $ne: true } })
      .select('_id name studentVisibilityTier')
      .lean()) as { _id: unknown; name?: string; studentVisibilityTier?: string } | null;
    return doc ? [{ id: String(doc._id), name: doc.name, tier: doc.studentVisibilityTier }] : [];
  }
  return [];
}

async function resolveCanonicalForEntityMint(
  entityType: ObservedEntityType,
  obs: Array<{ field: string; value?: unknown }>,
): Promise<CanonicalResolution> {
  const resolverType = resolverTypeForEntity(entityType);
  const keys = deriveCanonicalKeys(
    resolverType,
    obs.map((o) => ({ field: o.field, value: o.value })),
  );
  if (keys.length === 0) return { status: 'mint', reservedKeys: [] };
  // The resolver's wouldDemote guard compares self.tier against a candidate's
  // stored tier. At mint the would-be entity has no computed tier (it is not yet
  // projected or gated), so self.tier is intentionally unset: folding new
  // observations into an existing canonical enriches it and re-gates it rather
  // than archiving any existing public row, so no live entity is demoted. The
  // guard stays wired for any caller that does supply a would-be tier.
  return resolveCanonical(
    { type: resolverType, keys, self: buildEntityResolverSelf(obs) },
    {
      resolveAlias: async (type, ns, value) => {
        const id = await resolveCanonicalAlias(type, ns, value);
        return id ? String(id) : null;
      },
      findCandidatesByKey: (_type, key) => findEntityCandidatesByKey(resolverType, key),
    },
  );
}

async function reserveEntityCanonicalAliases(
  entityType: ObservedEntityType,
  obs: Array<{ field: string; value?: unknown }>,
  canonicalId: string,
): Promise<void> {
  const resolverType = resolverTypeForEntity(entityType);
  const keys = deriveCanonicalKeys(
    resolverType,
    obs.map((o) => ({ field: o.field, value: o.value })),
  );
  for (const key of keys) {
    if (key.strength === 'weak') continue;
    await recordCanonicalAlias({
      type: resolverType,
      aliasNs: key.ns,
      aliasValue: key.value,
      canonicalType: resolverType,
      canonicalId,
      reason: 'resolve_at_mint',
    });
  }
}

export async function materializeEntity(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const filter: any = { entityType, ...materializationReadScopeFilter() };
  if (identifier.entityId) filter.entityId = identifier.entityId;
  else if (identifier.entityKey) filter.entityKey = identifier.entityKey;
  else throw new Error('materializeEntity requires entityId or entityKey');

  let obs = await Observation.find(filter).lean();
  if (obs.length === 0) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
    };
  }

  if (entityType === 'researchGroupMember') {
    return materializeRosterMember(identifier, obs, options);
  }

  if (entityType === 'researchEntityRelationship') {
    return materializeResearchEntityRelationship(identifier, obs, options);
  }

  if (entityType === 'user') {
    return materializeUserIdentityToResearcher(identifier, obs);
  }

  const Model = entityModelFor(entityType);
  if (!Model) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'no-materializer-registered',
    };
  }

  let entityDoc: any = null;
  let entityIdString: string | undefined = identifier.entityId;
  entityDoc = await findEntityDocByIdentifier(Model, entityType, identifier, obs);
  if (entityDoc) entityIdString = String(entityDoc._id);

  // A durable merge redirect (issue #1957, PR 3) supersedes the shell-bound
  // canonicalGroupId tombstone below: it resolves the merged source's stable
  // identifiers (slug and original id) straight to the live canonical entity and
  // materializes the observations INTO it, whether or not the shell row still
  // exists. This keeps a re-scrape from re-minting the shell even after the shell
  // has been deleted (PR 4), while the tombstone guard still covers pre-redirect
  // merges whose shells are only archived.
  if (isResearchEntityObservationType(entityType)) {
    const redirectCanonical = await resolveResearchEntityMergeRedirectCanonical({
      slug: identifier.entityKey || textValue(entityDoc?.slug) || undefined,
      entityId: identifier.entityId || (entityDoc?._id ? String(entityDoc._id) : undefined),
    });
    if (redirectCanonical) {
      entityDoc = redirectCanonical;
      entityIdString = String(redirectCanonical._id);
    }
  }

  // A research entity archived into a canonical survivor by the eponymous FRA->lab
  // merge (issue #1957) carries a canonicalGroupId tombstone and was removed from
  // Meilisearch. findEntityDocByIdentifier resolves by slug without an archived
  // filter, so a later sweep re-scraping its source would otherwise write to and
  // re-sync the merged shell - resurrecting it and undoing the merge. Treat it as a
  // no-op so a second sweep pass neither re-activates nor re-indexes the shell.
  if (
    isResearchEntityObservationType(entityType) &&
    entityDoc &&
    entityDoc.archived === true &&
    entityDoc.canonicalGroupId
  ) {
    return {
      entityType,
      entityId: materializerDocumentId(entityDoc._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'merged-into-canonical',
    };
  }

  // An existing row stored as the retired PROGRAM type stays frozen: it is legacy
  // data awaiting its own archive lane, not something to re-type in place.
  if (
    isResearchEntityObservationType(entityType) &&
    isRetiredProgramResearchEntityType(entityDoc?.entityType)
  ) {
    return {
      entityType,
      entityId: entityDoc ? materializerDocumentId(entityDoc._id) : undefined,
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'program-entity-type-retired',
    };
  }

  // A row that does not exist yet, whose winning observed entityType is the
  // retired PROGRAM, used to be dropped entirely (issue #2206): 27 entityKeys
  // carrying complete observation sets produced no entity at all, 22 of them
  // department undergraduate research pathways. Those observations are never
  // superseded, so a sweep reproduced the gap on every run. Heal the type from the
  // same source's co-observed `kind` and mint, and only skip when no usable kind
  // resolves, so an unclassifiable row still fails closed instead of defaulting to
  // LAB.
  if (
    isResearchEntityObservationType(entityType) &&
    !entityDoc &&
    winningObservedEntityTypeIsRetiredProgram(obs)
  ) {
    const healedEntityType = healedEntityTypeForRetiredProgramObservations(obs);
    if (!healedEntityType) {
      return {
        entityType,
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'program-entity-type-retired',
      };
    }
    obs = withHealedRetiredProgramEntityType(obs, healedEntityType);
  }

  // C4 resolve-at-mint for research entities and fellowships (env-flagged, separate
  // from the users flag). Same contract as the user path: an existing canonical is
  // adopted before minting a duplicate; blocked skips; ambiguous/mint fall through.
  let entityMintResolution: CanonicalResolution | undefined;
  if (
    c4ResolveAtMintEntitiesEnabled() &&
    (isResearchEntityObservationType(entityType) || entityType === 'fellowship') &&
    !entityDoc
  ) {
    const resolution = await resolveCanonicalForEntityMint(entityType, obs);
    entityMintResolution = resolution;
    if (resolution.status === 'blocked') {
      return {
        entityType,
        ...identifier,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'resolver-blocked',
      };
    }
    if (resolution.status === 'existing') {
      const canonicalDoc = await Model.findById(resolution.canonicalId);
      if (canonicalDoc) {
        entityDoc = canonicalDoc;
        entityIdString = String(canonicalDoc._id);
      }
    }
    // 'ambiguous' | 'mint' fall through to the existing create branch unchanged.
  }

  if (!identifier.entityId && entityIdString) {
    const excludedObs = await entityIdAnchoredObservationsExcludedByEntityKeyScope(
      entityType,
      entityIdString,
      obs,
    );
    if (excludedObs.length > 0) obs = [...obs, ...excludedObs];
  }

  if (identifier.entityId && entityIdString) {
    const entityKeyForScope =
      identifier.entityKey ||
      (isResearchEntityObservationType(entityType) ? textValue(entityDoc?.slug) : '') ||
      undefined;
    const excludedByKeyScope = await entityKeyAnchoredObservationsExcludedByEntityIdScope(
      entityType,
      entityIdString,
      entityKeyForScope,
      obs,
    );
    if (excludedByKeyScope.length > 0) obs = [...obs, ...excludedByKeyScope];
  }

  const manuallyLockedFields: string[] = (entityDoc && entityDoc.manuallyLockedFields) || [];
  const manualValues: Record<string, unknown> = {};
  for (const f of manuallyLockedFields) {
    if (entityDoc && entityDoc[f] !== undefined) manualValues[f] = entityDoc[f];
  }

  const materializationObs = collapseLatestWins(
    obs.filter((o: any) => !shouldIgnoreObservationForEntityMaterialization(entityType, o)),
    entityType,
  );

  const resolverObs: ResolverObservation[] = materializationObs.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));

  const resolved = resolveAllFields(resolverObs, {
    manuallyLockedFields,
    manualValues,
  });
  if (isResearchEntityObservationType(entityType)) {
    const grantEvidence = aggregateResearchEntityGrantEvidence(materializationObs);
    if (grantEvidence.recentGrants && resolved.recentGrants) {
      resolved.recentGrants.value = grantEvidence.recentGrants;
    }
    if (grantEvidence.recentGrantCount !== undefined && resolved.recentGrantCount) {
      resolved.recentGrantCount.value = grantEvidence.recentGrantCount;
    }
    if (grantEvidence.fundingAgencies && resolved.fundingAgencies) {
      resolved.fundingAgencies.value = grantEvidence.fundingAgencies;
    }
  }
  let fullDescriptionShellGated = false;
  if (isResearchEntityObservationType(entityType)) {
    const orgKind = textValue(resolved.kind?.value ?? entityDoc?.kind).toLowerCase();
    const slugForShellCheck = entityDoc?.slug ?? identifier.entityKey;
    if (MULTI_PI_ORG_KINDS.has(orgKind) && isPersonOrGrantShellSlug(slugForShellCheck)) {
      for (const shellGatedField of SINGLE_PI_SHELL_GATED_FIELDS) {
        const candidate = resolved[shellGatedField];
        if (
          !candidate ||
          !resolvedFieldSourcedOnlyFromPersonProfilePages(
            shellGatedField,
            candidate,
            materializationObs,
          )
        ) {
          continue;
        }
        // Fall through to the best candidate this guard does not object to,
        // rather than removing the field. Dropping it made whether the entity
        // keeps any description at all depend on which candidate happened to
        // rank first, so a reweighting or a re-scrape that reordered the groups
        // silently blanked a served description - the same "demoted, never
        // dropped" failure the ranked walk below already exists to prevent.
        const replacement = resolveFieldRanked(shellGatedField, resolverObs, {
          manuallyLockedFields,
          manualValues,
        }).find(
          (ranked) =>
            !resolvedFieldSourcedOnlyFromPersonProfilePages(
              shellGatedField,
              ranked,
              materializationObs,
            ),
        );
        if (replacement) resolved[shellGatedField] = replacement;
        else delete resolved[shellGatedField];
        // Set either way: the body no longer comes from the seed PI's profile,
        // so a shortDescription that may still be that PI's own sentence has to
        // be re-derived against the corrected full (#1595).
        if (shellGatedField === 'fullDescription') fullDescriptionShellGated = true;
      }
    }
  }

  const { set, unset, conflicts, fieldsWritten } = await projectFromLog(entityType, {
    resolved,
    manuallyLockedFields,
    manualValues,
    entityDoc,
    materializationObs,
    resolverObs,
    fullDescriptionShellGated,
    now: new Date(),
    synthesizeCardDescription: options.synthesizeCardDescription,
    writeOnlyFields: options.writeOnlyFields,
  });

  if (options.dryRun) {
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten,
      conflicts,
      created: !entityDoc,
      resolved,
      plannedSet: set,
      plannedUnset: unset,
    };
  }

  const entityScalarUnchanged =
    Boolean(entityDoc) &&
    isMaterializerProjectionNoOp(entityDoc as Record<string, unknown>, set, unset);

  let created = false;
  if (entityDoc) {
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
      return {
        entityType,
        entityId: materializerDocumentId(entityDoc._id),
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts,
        created: false,
        resolved,
        skipped: 'no-scoped-fields',
      };
    }
    // Skip the write (and, below, the redundant search re-sync) when the
    // projection recomputed the same values it already stored - only the managed
    // lastObservedAt would differ. Unconditional sub-projections (membership,
    // access, logistics, browse-rank) still run; they have their own change
    // detection and can change independently of the scalar projection.
    if (!entityScalarUnchanged) {
      const update: Record<string, unknown> = { $set: set };
      if (Object.keys(unset).length > 0) update.$unset = unset;
      if (isResearchEntityObservationType(entityType)) {
        await withResearchEntityWriteTransaction((session) =>
          Model.updateOne({ _id: entityDoc._id }, update, { session }),
        );
      } else {
        await Model.updateOne({ _id: entityDoc._id }, update);
      }
    }
  } else {
    const keyField = uniqueKeyFieldForIdentifier(entityType, identifier.entityKey);
    if (!keyField || !identifier.entityKey) {
      throw new Error(`Cannot create new ${entityType}: missing entityKey or no keyField defined`);
    }
    const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
    if (!keyValue) {
      throw new Error(`Cannot create new ${entityType}: missing normalized unique key value`);
    }
    const insert: Record<string, unknown> = { ...set, [keyField]: keyValue };
    if (!hasRequiredFieldsForCreate(entityType, insert)) {
      return {
        entityType,
        entityId: undefined,
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved,
        skipped: 'missing-required-fields',
      };
    }
    let created_;
    let didCreate = true;
    if (isResearchEntityObservationType(entityType)) {
      const researchEntityId = new mongoose.Types.ObjectId();
      try {
        created_ = await withResearchEntityWriteTransaction(async (session) => {
          const createdDocuments = await Model.create([{ _id: researchEntityId, ...insert }], {
            session,
          });
          return createdDocuments[0];
        });
      } catch (error) {
        // A concurrent writer may have minted the same unique slug between our
        // resolve/lookup and this create; adopt the winning row instead of
        // erroring the run (mirrors the non-research create path below).
        if (isDuplicateKeyMongoError(error)) {
          const adopted = await findEntityDocByIdentifier(Model, entityType, identifier, obs);
          if (!adopted) throw error;
          created_ = adopted;
          didCreate = false;
        } else {
          throw error;
        }
      }
    } else {
      try {
        created_ = await Model.create(insert);
      } catch (error) {
        // A concurrent writer may have minted the same unique key between our
        // resolve/lookup and this create (soft identity keys are not DB-unique), so
        // adopt the winning row instead of throwing - a resolve-at-mint race
        // collapses to one record rather than erroring the run.
        if (isDuplicateKeyMongoError(error)) {
          const adopted = await findEntityDocByIdentifier(Model, entityType, identifier, obs);
          if (!adopted) throw error;
          created_ = adopted;
          didCreate = false;
        } else {
          throw error;
        }
      }
    }
    entityIdString = materializerDocumentId(created_._id);
    created = didCreate;
    if (
      c4ResolveAtMintEntitiesEnabled() &&
      (isResearchEntityObservationType(entityType) || entityType === 'fellowship') &&
      didCreate &&
      entityIdString &&
      entityMintResolution?.status === 'mint'
    ) {
      await reserveEntityCanonicalAliases(entityType, obs, entityIdString);
    }
  }

  if (isSyncableEntityType(entityType) && entityIdString && !entityScalarUnchanged) {
    const fresh = await Model.findById(entityIdString).lean();
    if (fresh) await syncEntity(entityType, fresh);
  }

  let postMaterializationMetrics: ReportPostMaterializationMetrics | undefined;
  if (isResearchEntityObservationType(entityType) && entityIdString) {
    if (!options.dryRun) {
      await materializeInferredPiMembership(entityIdString, materializationObs);
      await materializeInferredDirectorMembership(entityIdString, materializationObs);
      await inheritSchoolFromLeadPi(entityIdString, { manuallyLockedFields });
    }
    const accessResult = await materializeAccessForResearchGroup({
      researchEntityId: entityIdString,
      entityKey: identifier.entityKey,
    });
    const logisticsResult = await materializeUndergraduateLogisticsForResearchEntity({
      researchEntityId: entityIdString,
      entityKey: identifier.entityKey,
      dryRun: options.dryRun,
    });
    postMaterializationMetrics = {
      entryPathways: 0,
      accessSignals: accessResult.accessSignals,
      contactRoutes: 0,
      postedOpportunities: 0,
      undergraduateLogisticsClaims:
        logisticsResult.known + logisticsResult.stale + logisticsResult.conflicts,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: accessResult.staleEvidenceSkipped,
      conflicts: logisticsResult.conflicts,
      errors: accessResult.errors + logisticsResult.rejected,
    };

    // Recompute the browse-ranking score now that access signals exist, and
    // re-sync the entity so the default /research ordering stays fresh.
    if (!options.dryRun) {
      try {
        await recomputeBrowseRankForEntities([entityIdString]);
      } catch (error) {
        console.error(
          'Failed to recompute browseRankScore:',
          sanitizeLogValue({ entityId: entityIdString, error }),
        );
      }
    }
  }

  if (
    !options.dryRun &&
    isResearchEntityObservationType(entityType) &&
    entityIdString &&
    isDeptRosterKey(identifier.entityKey)
  ) {
    await foldDeptRosterShellIntoCanonicalResearchEntity(entityIdString);
  }

  return {
    entityType,
    entityId: entityIdString,
    entityKey: identifier.entityKey,
    fieldsWritten: entityScalarUnchanged ? 0 : fieldsWritten,
    conflicts,
    created,
    resolved,
    postMaterializationMetrics,
    ...(entityScalarUnchanged ? { skipped: 'unchanged' as const } : {}),
  };
}

const OFFICIAL_ROSTER_SOURCE_NAME = 'official-research-home-roster';

export interface OfficialRosterSnapshotForReconciliation {
  complete?: boolean;
  memberKeys?: unknown;
  observedAt?: unknown;
}

export function buildOfficialRosterArchiveFilter(
  researchEntityId: string,
  snapshot: OfficialRosterSnapshotForReconciliation,
): Record<string, unknown> | null {
  const safeResearchEntityId = normalizeMaterializerObjectId(researchEntityId);
  const memberKeys = Array.isArray(snapshot.memberKeys)
    ? Array.from(
        new Set(
          snapshot.memberKeys
            .map((value) => textValue(value))
            .filter(Boolean)
            .slice(0, 40),
        ),
      )
    : [];
  if (!safeResearchEntityId || snapshot.complete !== true || memberKeys.length === 0) return null;
  return {
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': safeResearchEntityId,
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
    'rosterProvenance.sourceName': OFFICIAL_ROSTER_SOURCE_NAME,
    'rosterProvenance.membershipKey': { $nin: memberKeys },
  };
}

async function reconcileOfficialRosterSnapshotsFromRun(
  scrapeRunId: string,
  options: MaterializeOptions,
): Promise<number> {
  const runObjectId = toMaterializerObjectId(scrapeRunId);
  if (!runObjectId || options.dryRun) return 0;
  const snapshots = await Observation.find({
    scrapeRunId: runObjectId,
    sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
    entityType: 'researchEntity',
    field: 'rosterEnrichment',
  })
    .select('entityKey value observedAt sourceUrl confidence')
    .lean();
  let archived = 0;
  for (const snapshotObservation of snapshots as any[]) {
    const snapshot = objectRecord(
      snapshotObservation.value,
    ) as OfficialRosterSnapshotForReconciliation;
    if (!snapshotObservation.entityKey) continue;
    const entity: any = await ResearchEntity.findOne({
      slug: snapshotObservation.entityKey,
      archived: { $ne: true },
    })
      .select('_id')
      .lean();
    if (!entity?._id) continue;
    const filter = buildOfficialRosterArchiveFilter(materializerDocumentId(entity._id), snapshot);
    if (!filter) continue;
    const endedAt = snapshotObservation.observedAt || new Date();
    const departing = await RoleAssignment.find(filter).select('personId').lean();
    const departingPersonIds = Array.from(
      new Map(
        (departing as any[])
          .map((assignment) => assignment.personId)
          .filter((id): id is mongoose.Types.ObjectId => id instanceof mongoose.Types.ObjectId)
          .map((id) => [id.toString(), id] as const),
      ).values(),
    );
    if (departingPersonIds.length > 0) {
      await archiveCanonicalRoleAssignmentsForPersons(
        materializerDocumentId(entity._id),
        departingPersonIds,
        endedAt,
      );
    }
    archived += departingPersonIds.length;
  }
  return archived;
}

export async function materializeFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<{
  materialized: number;
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  errors: number;
  postMaterializationMetrics: Required<ReportPostMaterializationMetrics>;
}> {
  const runObjectId = toMaterializerObjectId(scrapeRunId);
  if (!runObjectId) {
    return {
      materialized: 0,
      created: 0,
      updated: 0,
      conflicts: 0,
      skipped: 0,
      errors: 0,
      postMaterializationMetrics: emptyPostMaterializationMetrics(),
    };
  }
  const distinct = await Observation.aggregate([
    {
      $match: {
        scrapeRunId: runObjectId,
        entityType: { $nin: ['paper', 'departmentRosterHealth'] },
      },
    },
    {
      $group: {
        _id: { entityType: '$entityType', entityId: '$entityId', entityKey: '$entityKey' },
      },
    },
  ]);
  const materializationOrder: Record<string, number> = {
    user: 0,
    researchEntity: 1,
    researchGroup: 1,
  };
  distinct.sort((a, b) => {
    const left = materializationOrder[a._id?.entityType] ?? 10;
    const right = materializationOrder[b._id?.entityType] ?? 10;
    if (left !== right) return left - right;
    return String(a._id?.entityKey || a._id?.entityId || '').localeCompare(
      String(b._id?.entityKey || b._id?.entityId || ''),
    );
  });

  let materialized = 0;
  let created = 0;
  let updated = 0;
  let conflicts = 0;
  let skipped = 0;
  let errors = 0;
  const postMaterializationMetrics = emptyPostMaterializationMetrics();
  for (const row of distinct) {
    const { entityType, entityId, entityKey } = row._id;
    let res: MaterializeResult;
    try {
      res = await materializeEntity(
        entityType,
        {
          entityId: entityId ? String(entityId) : undefined,
          entityKey: entityKey || undefined,
        },
        options,
      );
    } catch (err: any) {
      errors++;
      console.error(
        `materializeFromRun: ${entityType} ${entityKey || entityId} failed:`,
        sanitizeLogValue(err),
      );
      continue;
    }
    materialized++;
    if (res.created) created++;
    else if (!res.skipped) updated++;
    if (res.skipped) skipped++;
    conflicts += res.conflicts;
    addPostMaterializationMetrics(postMaterializationMetrics, res.postMaterializationMetrics);
  }
  const rosterMembersArchived = await reconcileOfficialRosterSnapshotsFromRun(scrapeRunId, options);
  const departureResult = await reconcileFacultyRosterDeparturesFromRun(scrapeRunId, options);
  // An operator who switched the lane on needs to see why it did nothing;
  // silence made three separate dormancy causes invisible at once (#2410).
  const expectedQuietOutcomes: FacultyRosterDepartureOutcome[] = [
    'reconciled',
    'disabled',
    'dry-run',
  ];
  if (!expectedQuietOutcomes.includes(departureResult.outcome)) {
    console.warn(`[faculty-departure] no reconciliation this run: ${departureResult.outcome}`);
  }
  if (!options.dryRun) {
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: {
          entitiesCreated: created,
          entitiesUpdated: updated,
          materializationSkipped: skipped,
          materializationConflicts: conflicts,
          materializationErrors: errors,
          entitiesArchived: rosterMembersArchived,
          postMaterializationMetrics,
        },
      },
    );
  }
  return {
    materialized,
    created,
    updated,
    conflicts,
    skipped,
    errors,
    postMaterializationMetrics,
  };
}
