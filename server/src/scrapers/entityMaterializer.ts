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
import { DERIVED_RESEARCH_AREA_SOURCE_NAME } from '../models/fieldProvenanceBacking';
import {
  archivedEntityUpdate,
  attributedArchiveSet,
  DEPT_ROSTER_SHELL_FOLD_ARCHIVE_REASON,
  PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON,
  SUPERSEDED_RELATIONSHIP_TYPE_ARCHIVE_REASON,
} from '../models/entityArchival';
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
import {
  invalidatedScrapeRunIds,
  isScrapeRunInvalidated,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';
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
import { relationshipEndpointsAreSameEntity } from '../utils/researchEntityRelationshipEndpoints';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';
import {
  descriptionEntityKindForResearchEntity,
  isDemotablePersonBio,
  isHighConfidencePersonBio,
} from '../utils/researchHomeDescriptionSelection';
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
  NO_SURNAME_ROSTER,
  isPersonScopedResearchEntity,
  isPlaceholderEntityName,
  isUnrecoverablePersonScopedEntityName,
  namesAScholarlyEventSeries,
  labResearchEntityNameFromStaleFacultyResearchSuffix,
  personScopedResearchEntityNameFromLeadPersonName,
  personScopedResearchEntityNameFromPersonName,
  personScopedResearchEntityNameNamesSomethingElse,
  isExternalScholarlyPlatformLinkLabelName,
} from '../utils/researchHomeNameIdentityAuthority';
import {
  loadKnownPersonSurnameRoster,
  loadResearchEntityLeadPersonName,
} from '../utils/researchHomeNameIdentityRoster';
import {
  resolveAllFields,
  resolveField,
  resolveFieldRanked,
  ResolverObservation,
  ResolvedField,
} from './confidenceResolver';
import {
  MaterializationChunkPrefetch,
  type MaterializationReadSource,
} from './materializationChunkPrefetch';
import {
  appendObservations,
  c4LosslessIngestEnabled,
  collapseLatestWins,
  getSourceByName,
} from './observationStore';
import {
  syncEntity,
  isSyncableEntityType,
  deleteFromIndex,
  withDeferredIndexConfirmation,
} from '../services/meiliSyncService';
import {
  listResearchEntityMergedInRows,
  resolveResearchEntityCanonicalByTombstone,
  type MergedInResearchEntityRow,
} from '../services/researchEntityCanonicalTombstone';
import { isLowTrustAreaShellSlug } from '../utils/researchEntityShellSlug';
import {
  deriveCanonicalKeys,
  resolveCanonical,
  type CandidateEntity,
  type CanonicalKey,
  type CanonicalResolution,
} from './resolveCanonical';
import { websiteUrlIdentityKeyVariants } from '../scripts/researchEntityPiDedupeCore';
import { isSweepStageEnabledByDefault } from '../scripts/sweepStageFlags';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import { materializeAccessForResearchGroup, type AccessObservation } from './accessMaterializer';
import {
  sanitizeObservationField,
  withHarvestTextDefectsCorrected,
} from './observationFieldSanitizer';
import {
  planStoredTextNormalization,
  type StoredTextNormalizationPlan,
} from './storedTextNormalization';
import { planFellowshipClassification } from './fellowshipClassificationDerivation';
import {
  ENRICH_ONLY_FELLOWSHIP_SOURCES,
  fellowshipFieldsWithheldBySourcePrecedence,
  isEnrichOnlyFellowshipSourceUrl,
} from './fellowshipSourcePrecedence';
import {
  isDirectoryGraftCitation,
  planDirectoryGraftCitationRetraction,
} from './directoryGraftCitations';
import { planRefusedStoredWebsiteUrlClear } from './refusedStoredWebsiteUrl';
import {
  isDroppedLoserWebsite,
  planSurvivorOwnedWebsiteClear,
  websiteIdentitiesStatedBy,
  websiteIdentity,
  type SurvivorOwnedWebsiteField,
} from './survivorOwnedWebsiteClear';
import {
  RESEARCH_ENTITY_CONTACT_FIELDS,
  withoutForeignContactObservations,
} from './rowKeyedContactEvidence';
import { planUnsourcedProvenanceWebsiteUrlClear } from './unsourcedProvenanceWebsiteClear';
import {
  planNeverBackedFieldProvenanceRetirement,
  planUnrecordedProvenanceObservationRelink,
} from './neverBackedFieldProvenance';
import { planRefusedStoredDescriptionClears } from './refusedStoredDescription';
import { stripInvisibleFormatCharacters } from '../utils/invisibleFormatCharacters';
import type { ReportPostMaterializationMetrics } from './runReport';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  sanitizeResearchEntityDescription,
  sanitizeStoredCatalogDescription,
} from '../utils/descriptionHygiene';
import { cleanPublicProfileBio } from '../services/profileService';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { servedResearchEntityCopy } from '../services/servedResearchEntityCard';
import { isKnownDeadSourceUrl } from '../services/sourceLinkHealth';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isEphemeralDeployHostUrl, isSelfReferentialUrl } from '../utils/urlSafety';
import { normalizePersonNameCasing } from './utils/personNameCasing';
import { sanitizePersonName } from '../utils/personNameHygiene';
import { observedPersonNameAgreesWith } from './utils/personNameAgreement';
import {
  parseRosterMemberIdentityEvidence,
  ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
  type RosterMemberIdentityEvidence,
} from './utils/rosterMemberIdentityEvidence';
import { splitName } from './utils/scraperHelpers';
import { isTraineeLevelTitle } from '../utils/traineeLevelTitle';
import {
  isBoilerplatePlatformHostUrl,
  isDirectoryLoaderUrl,
  isFacetedOrSectionIndexUrl,
  isInstitutionalAdvancementUrl,
  isMapOrDirectionsUrl,
  recordSpecificApplicationPortalIdentity,
  researchHomeWebsiteUrlWriteRefusal,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';
import {
  isLikelyOfficialPersonProfileUrl,
  normalizeOfficialProfileDestination,
} from '../services/leadProfileIdentity';
import { materializeOrgUnitSignalsForObservations } from './orgUnitSignalMaterializer';
import {
  planStoredUndergradEvidenceQuoteClear,
  sourcesWithdrawingUndergradEvidenceQuote,
  undergradEvidenceQuoteIsInadmissible,
  withoutWithdrawnUndergradEvidenceQuotes,
} from './storedUndergradEvidenceQuote';
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
  hasLiveResearchAreaEvidence,
  researchAreaAdmissionForRow,
  researchAreaEvidenceIdentity,
  researchAreasAreManuallyLocked,
  type ResearchAreaEvidenceObservation,
} from './researchAreaEvidence';
import {
  resolveBackfillWebsiteUrl,
  type WebsiteUrlBackfillResolution,
} from '../scripts/backfillResearchEntityWebsiteUrlsCore';
import {
  archiveCanonicalRoleAssignmentsForPersons,
  adoptUnprovenancedRoleAssignments,
  archiveSupersededCanonicalRoleAssignments,
  identifiedResearcherHoldsDisplayName,
  materializeCanonicalMembership,
  writeCanonicalMembership,
  type CanonicalMembershipOutcome,
  type CanonicalMemberFacts,
  resolveCanonicalResearcherId,
  type CanonicalMemberIdentity,
} from './canonicalMembershipMaterializer';
import {
  getResearchEntityRoster,
  type ResearchEntityRosterEntry,
} from '../services/researchEntityMembershipAccessor';
import { officialProfileIdentityKey, rosterMembershipKey } from './utils/rosterMembershipKey';
import { reconcileBbsTrackRetirementsFromRun } from './bbsTrackRosterRetirement';
import {
  CENTERS_INSTITUTES_SOURCE_NAME,
  reconcileCenterRosterRetirementsFromRun,
  type CenterRosterRetirementDeps,
  type CenterRosterRetirementResult,
} from './centerRosterRetirement';
import {
  resolveResearcherIdForPersonName,
  type ResearcherPersonNameResolution,
  type ResearcherPersonNameResolutionStatus,
} from '../services/researcherPersonNameResolver';
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
import {
  RoleAssignment,
  type RoleAssignmentRosterProvenance,
  type RosterIdentityBasis,
} from '../models/roleAssignment';
import {
  reconcileFacultyRosterDeparturesFromRun,
  type FacultyRosterDepartureOutcome,
} from './facultyRosterDepartureReconciler';
import {
  reconcileYsmLabDelistingFromRun,
  type YsmLabDelistingOutcome,
} from './ysmLabDelistingReconciler';
import { reconcileFieldRetractionsFromRun, type FieldRetractionOutcome } from './fieldRetraction';
import {
  refusedResolverObservations,
  valueIsRefused,
} from '../utils/researchEntityFieldValueRefusals';
import {
  loadDescriptionSourceCiters,
  screenDescriptionsOnSharedPages,
} from './descriptionOwnershipResolverScreen';
import { ownershipGuardedCitedUrls } from './descriptionSourceOwnership';
import {
  isPersonOrGrantShellSlug,
  personPageNameTokensFromUrl,
  personProfileNameTokensFromUrl,
  personProfileSourceIsADifferentPersonThanCitedOwner,
  personProfileSourceMatchesEntity,
  type ResearchEntityIdentity,
} from './utils/personProfileEntityMatch';
import {
  CLEARED_RESEARCH_ENTITY_YALE_STATUS,
  deriveResearchEntityYaleStatus,
  hasEvidencelessInactiveYaleStatus,
  yaleStatusCacheIsWritable,
} from '../utils/researchEntityYaleStatus';
import { isRevisitableFieldLockOnEntity } from '../utils/researchEntityFieldLocks';
import {
  canonicalRoleForLegacy,
  LEAD_ROLE_LEGACY_LABELS,
  LEGACY_ROLE_BY_CANONICAL,
} from '../models/canonicalRoleMapping';

interface MaterializeOptions {
  dryRun?: boolean;
  chunkPrefetch?: MaterializationReadSource;
  syncMeilisearch?: boolean;
  synthesizeCardDescription?: (fullDescription: string) => Promise<string>;
  writeOnlyFields?: string[];
  /**
   * Keep the field-less post-projection steps (inferred lead edges, access-signal
   * upserts, the department-roster fold) on a `writeOnlyFields` pass. The merge
   * fill-only pass needs them to carry the merged-in evidence; the rematerialize
   * report compares fields and would not see them, so it leaves this off (#3874).
   */
  keepPostProjectionEvidence?: boolean;
  onlyReconcileFieldProvenance?: boolean;
  /**
   * Ignore the named locks, each only if it is revisitable on this row, so the
   * projection reports what the engine would derive for them today. Off everywhere
   * but the release operation, which reads `plannedSet` and leaves every lock the
   * engine disagrees with alone.
   *
   * It names fields rather than saying "all revisitable" because a kept lock still
   * pins a value other fields' derivation reads, so a plan is only an answer about
   * the exact set of locks that is about to be released.
   *
   * `dryRun` is required: the option asks a question, and a projection derived with
   * locks ignored must never reach a write.
   */
  reviseRevisitableFieldLocks?: readonly string[];
  /**
   * Ignore the named locks whatever `fieldLockProvenance` records, so a census can
   * learn what the engine derives for a lock the release rule will never re-open.
   *
   * `reviseRevisitableFieldLocks` deliberately refuses a lock that pins a value and
   * records nothing, because a lock re-opens on positive evidence it was a
   * workaround and never on the absence of a record. That rule is right for a
   * release and wrong for a measurement: every lock in the corpus predates
   * `fieldLockProvenance`, so under it the engine is never asked about 87 of 98 lock
   * instances and their inertness is unmeasurable.
   *
   * This asks anyway and answers nothing else. `dryRun` is required, and it is
   * mutually exclusive with `reviseRevisitableFieldLocks` so a release can never be
   * judged on an answer produced under the wider rule.
   */
  auditFieldLocksIgnoringRecord?: readonly string[];
  /**
   * The instant the projection is evaluated at, for a replay that has to be reproducible.
   *
   * `confidenceResolver` weights every observation by `recencyDecay(observedAt, now, halfLife)`
   * and `confidenceByField` is a stored field, so with a wall clock two runs over identical
   * evidence compute different confidences and no frozen-input benchmark can hold still (#3589).
   * Only the engine benchmark passes it, from the instant its input was captured, so decay stays
   * meaningful rather than being switched off.
   */
  now?: Date;
  /**
   * The lead-person name and surname roster to project against, for a replay that must not read
   * the corpus.
   *
   * `loadResearchEntityNameIdentityAuthority` resolves a lead name from the roster whenever the
   * prefetch cannot answer with a sole lead, and the prefetch deliberately cannot for a row with
   * two or more distinct leads. That live read is what kept 6 of 90 benchmark rows reporting an
   * unfrozen input after their sole-lead answers were frozen (#3589), so the benchmark supplies
   * the authority it captured instead.
   */
  nameIdentityAuthority?: ResearchEntityNameIdentityAuthority;
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

/**
 * Fields the materializer co-derives in one pass, so a field-scoped materialization
 * that writes one member without the rest of its closure would reintroduce the very
 * drift it was run to remove (#2144). `kind` is a pure function of `entityType`;
 * `applyResearchEntityOrgUnitCanonicalization` recomputes `schools` from `school`
 * plus `departments` and `orgAffiliationLabels` from `departments`, so a scope that
 * wrote `departments` alone would leave the stored `schools` facet describing the
 * old departments. Each closure is symmetric because every member is a legal
 * `--only-fields` value (#2536).
 */
export const MATERIALIZER_DERIVED_FIELD_GROUPS: ReadonlyArray<readonly string[]> = [
  ['entityType', 'kind'],
  ['school', 'schools', 'departments', 'orgAffiliationLabels'],
];

export function withDerivedMaterializerFields(fields: readonly string[]): string[] {
  const scoped = new Set(fields);
  for (const group of MATERIALIZER_DERIVED_FIELD_GROUPS) {
    if (group.some((field) => scoped.has(field))) for (const field of group) scoped.add(field);
  }
  return Array.from(scoped);
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
  const provenancePaths = new Set(fields.map((field) => `fieldProvenance.${field}`));
  for (const key of Object.keys(unset)) {
    if (!fields.includes(key) && !provenancePaths.has(key)) delete unset[key];
  }
  if (valueFields.length > 0) set.lastObservedAt = new Date();
  return valueFields.length + Object.keys(unset).length;
}

export interface MaterializedShortDescriptionInput {
  fullDescription?: unknown;
  currentShortDescription?: unknown;
  /**
   * Reopens an already-useful `currentShortDescription` for re-derivation, for
   * callers that know something about the pair the card bar cannot see - today,
   * that the retained fullDescription merely restates the card (#2721). The card
   * stays in the comparison rather than being withheld, so a reconsidered card is
   * only ever replaced by something better than the bare research-areas echo
   * `resolveGroundedCardDescription` falls back to.
   */
  reconsiderCurrentShortDescription?: boolean;
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
  if (isUngroundedSynthesizedCard({ card: candidate, body: fullDescription })) return false;
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
  const researchAreasCardSummary = buildResearchAreasCardSummary(input.researchAreas);
  const isBareResearchAreasFallback =
    !!current && current.toLowerCase() === researchAreasCardSummary.toLowerCase();
  const currentClearsCardBar =
    !isBareResearchAreasFallback &&
    shortQuality(input.currentShortDescription, input.fullDescription).isUseful;
  if (currentClearsCardBar && !input.reconsiderCurrentShortDescription) return null;
  const grounded = await resolveGroundedCardDescription({
    fullDescription: input.fullDescription,
    researchAreas: input.researchAreas,
    isProgramLike: input.isProgramLike,
    synthesize: input.synthesize,
  });
  if (
    !grounded ||
    grounded.toLowerCase() === current.toLowerCase() ||
    !shortQuality(grounded, input.fullDescription).isUseful
  ) {
    return null;
  }
  // `resolveGroundedCardDescription` reaches the research-areas summary only after every
  // candidate grounded in the prose failed, and the same value is treated as replaceable
  // when it arrives as the current card, so it is not an upgrade over a card that already
  // clears the bar - reconsidering must not trade prose down for the echo (#2721).
  const groundedIsBareResearchAreasEcho =
    !!researchAreasCardSummary && grounded.toLowerCase() === researchAreasCardSummary.toLowerCase();
  if (currentClearsCardBar && groundedIsBareResearchAreasEcho) return null;
  // Reconsidering is triggered by a body that restates the current card, so a replacement
  // that restates the body too is no upgrade: a single-sentence body derives itself as its
  // card, and served beside its own body that card reads as empty and refuses the row (#3866).
  if (
    currentClearsCardBar &&
    isFullDescriptionRestatementOfShortDescription(textValue(input.fullDescription), grounded)
  ) {
    return null;
  }
  return grounded;
}

interface MaterializeResult {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  fieldsWritten: number;
  /**
   * What the lane INTENDED to write, reported separately because it is not an
   * outcome. `fieldsWritten` must stay a count of what changed: the roster lane
   * used to report its resolved-input count under that name, so an idempotent pass
   * that changed nothing still reported a field per input (#210).
   */
  fieldsPlanned?: number;
  membershipOutcome?: CanonicalMembershipOutcome;
  conflicts: number;
  created: boolean;
  resolved: Record<string, ResolvedField>;
  postMaterializationMetrics?: ReportPostMaterializationMetrics;
  indexSyncFailed?: true;
  skipped?: string;
  plannedSet?: Record<string, unknown>;
  plannedUnset?: Record<string, ''>;
  identityJoin?: UserIdentityJoin;
  unbackedResearchAreas?: UnbackedResearchAreaOutcome;
}

/**
 * Which key reached the person, reported so a caller can select the rows one join is
 * responsible for instead of restating the materializer's own precedence. Re-deriving
 * that order outside this module is how a lane comes to disagree with the engine about
 * who is reachable (#2325).
 */
export type UserIdentityJoin =
  | 'account-netid'
  | 'person-name'
  | 'account-email'
  | 'official-profile-page'
  | 'minted-from-pi-attribution';

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
export const MATERIALIZER_MANAGED_FIELDS = new Set(['lastObservedAt', 'sourceContentHash']);
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

/**
 * Whether a write to this planned path can land at all. The schemas are `strict`,
 * so mongoose drops an undeclared path from an update, and several observation
 * fields are projected by name while being consumed by a sibling derivation
 * rather than stored on the row: `inferredPiUserId` and `inferredPiUserKey` feed
 * `materializeInferredPiMembership`, the undergrad quote fields feed the
 * access-signal upserts. `docs/research-data-pipeline.md` records the class, which
 * `research-entity:projection-drift-census` reports as `unstorable`.
 *
 * Storability is read from the live schema rather than a hand-kept list, so a
 * field the schema starts declaring becomes storable here without an edit, and a
 * dotted path is storable when an ancestor is declared: `fieldProvenance` is a
 * `Map`, so `fieldProvenance.researchAreas` stores even though no schema path
 * spells it.
 */
export function materializerProjectionPathIsStorable(
  schemaPaths: Iterable<string>,
  plannedPath: string,
): boolean {
  const declared = [...schemaPaths];
  if (declared.length === 0) return true;
  const segments = plannedPath.split('.');
  for (let depth = segments.length; depth > 0; depth -= 1) {
    const ancestor = segments.slice(0, depth).join('.');
    const nested = `${ancestor}.`;
    if (declared.some((path) => path === ancestor || path.startsWith(nested))) return true;
  }
  return false;
}

// A re-projection over an unchanged observation log recomputes the same field
// values every run; the only guaranteed-different field is the managed
// `lastObservedAt` timestamp. Treat the projection as a no-op when every scoped
// `set` field already equals the stored value (ignoring managed metadata) and
// every `unset` target is already absent, so the write and its redundant search
// re-sync can be skipped. Any path we cannot confidently resolve is treated as a
// change (we never skip a real write).
//
// A path the schema cannot store is skipped for the same reason managed metadata
// is: the comparison exists to decide whether a write would change the row, and
// mongoose drops that path from the update, so it can never close and would hold
// the row open forever. #3869 measured 112 of 300 sampled live rows whose only
// difference was such a path, each taking a row write, an `updatedAt` bump and a
// search-index re-sync on every pass that could change nothing. `schemaPaths`
// empty means storability is unknown rather than false, so the comparison then
// covers every path: reading it the other way would skip real writes.
//
// `unset` is deliberately compared whichever way storability reads. Mongoose does
// strip an undeclared `$unset` as well, measured by raw-seeding a value under one
// and watching a pass that plans its removal leave it in place while clearing a
// declared field in the same update, so in principle an unstorable `unset` path
// could hold a row open the same way. It reaches nothing: `inferredPiUserId` is the
// only undeclared entry in `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` and no row of
// the corpus stores it. So the comparison stays on the side that writes, which is
// the side that cannot skip a removal a row does need.
export function isMaterializerProjectionNoOp(
  entityDoc: Record<string, unknown>,
  set: Record<string, unknown>,
  unset: Record<string, unknown>,
  schemaPaths: Iterable<string>,
): boolean {
  const declared = [...schemaPaths];
  for (const [path, value] of Object.entries(set)) {
    if (MATERIALIZER_MANAGED_FIELDS.has(path)) continue;
    if (!materializerProjectionPathIsStorable(declared, path)) continue;
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
  sourceId?: unknown;
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

/**
 * What the roster lane decided, in the shape the canonical writer takes.
 *
 * This used to be a `research_entity_members`-shaped Mongo update document that the
 * caller unpacked field by field and never applied, so the retired collection's
 * shape outlived the collection inside the materializer (#210).
 */
type RosterMemberCanonicalPlan = {
  role: string;
  matchName: string;
  personReferenceId: string;
  identityKey: string;
  facts: CanonicalMemberFacts;
  fieldsResolved: number;
  conflicts: number;
  resolved: Record<string, ResolvedField>;
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

const PROFILE_HOME_PAIRED_IDENTITY_FIELDS = new Set(['entityType', 'kind']);

/**
 * `official-profile-pi-backfill` asserts a linked research home's name, kind and type as one
 * claim (`entityResearchHomeToObservations`), so its kind and type say something only beside its
 * name. The #2913 retirement rolled back the name half of those grafts and left the type half
 * live, so person rows kept serving as the linked CENTER or INITIATIVE (#3886). The lane cannot
 * withdraw the type itself: a refusal is not an absence, and an enum field is not declarable for
 * retraction (`fieldRetraction.ts`). So the pairing is read here, on every resolve, instead.
 */
export function withoutUnpairedProfileHomeIdentity<
  T extends { sourceName?: unknown; field?: unknown; value?: unknown },
>(observations: T[], fieldValueRefusals: unknown): T[] {
  const laneNamesTheRow = observations.some(
    (observation) =>
      observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
      observation.field === 'name' &&
      textValue(observation.value).length > 0 &&
      !valueIsRefused(fieldValueRefusals, 'name', observation.value),
  );
  if (laneNamesTheRow) return observations;
  return observations.filter(
    (observation) =>
      observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
      !PROFILE_HOME_PAIRED_IDENTITY_FIELDS.has(String(observation.field)),
  );
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
  now: Date = new Date(),
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
  const [winner] = resolveFieldRanked('entityType', entityTypeObservations, { now });
  return isRetiredProgramResearchEntityType(winner?.value);
}

const PROGRAM_RESEARCH_GROUP_KIND = 'program';

/**
 * Heal a retired-`PROGRAM` entityType assertion into a live entity type using the
 * co-observed `kind` from the same observation set, which already states the
 * classification (issue #2206).
 *
 * Fails closed on purpose. `mapResearchGroupKindToEntityType` defaults an
 * unrecognized kind to `LAB`, so a row carrying no usable `kind` would otherwise
 * be silently minted as a lab. Gate on `researchGroupKinds` first and return
 * undefined instead, leaving the caller to keep skipping.
 *
 * A `program` kind confirms the retired type rather than healing it: programs live only
 * on `/programs` (docs/decisions.md 2026-08-26), and healing that kind is what re-minted
 * the department undergraduate research pages into `/research` (#3746).
 */
export function healedEntityTypeForRetiredProgramObservations(
  observations: MaterializerObservationLike[],
  now: Date = new Date(),
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
  const [winner] = resolveFieldRanked('kind', kindObservations, { now });
  const kind = textValue(winner?.value).toLowerCase();
  if (!researchGroupKinds.includes(kind as ResearchGroupKind)) return undefined;
  if (kind === PROGRAM_RESEARCH_GROUP_KIND) return undefined;
  return mapResearchGroupKindToEntityType(kind);
}

export async function programLivesAsFellowship(entityKey: string | undefined): Promise<boolean> {
  if (!entityKey) return false;
  const fellowship = await Fellowship.exists({ sourceKey: entityKey, archived: { $ne: true } });
  return Boolean(fellowship);
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

  const canonicalizer = await getResearchAreaCanonicalizer();
  const derived = canonicalizer.deriveResearchAreasFromText(textBlob);
  if (derived.length > 0) {
    set.researchAreas = derived;
    recordDerivedResearchAreaProvenance(set);
  }
}

/**
 * The source name a derived chip is attributed to. Distinct from every lane that
 * READ a topic off a page, because this chip was inferred from the row's own prose
 * through the canonical vocabulary and its aliases: the page named the subject, not
 * the facet. A reader, and any later ranking, can tell the two apart.
 */
export { DERIVED_RESEARCH_AREA_SOURCE_NAME };
// Below every lane that read an area off a page, because an inference from prose is
// weaker evidence than a source that named the area.
const DERIVED_RESEARCH_AREA_CONFIDENCE = 0.4;
const DERIVED_RESEARCH_AREA_PROVENANCE_PATH = 'fieldProvenance.researchAreas';

/**
 * Records that the chips just derived came from this row's own description.
 *
 * Without it the chips reach the served surface carrying no
 * `fieldProvenance.researchAreas`, and `dropDomainIncoherentUnsourcedResearchAreas`
 * judges only unsourced chips: it drops any that shares no fuzzy token with the
 * row's own text. A derived chip is lexically unlike its prose by construction,
 * because derivation goes through the canonical vocabulary and its aliases, so a
 * capital-markets phrase yields a corporate-finance chip and a pro-thrombotic phrase
 * yields a thrombosis chip. Every such chip was therefore dropped at serve time
 * while the stored array looked correct, on 878 served Development rows (#3401).
 *
 * `sourceName` alone is the whole record, and the empty `sourceUrl` is deliberate:
 * no page named this facet, and `buildSourceFieldContributions` groups purely by
 * `sourceUrl`, so borrowing the description's address would tell a student that page
 * supplied Topics. `observedAt` is omitted for the same reason a fresh timestamp
 * would be wrong: this entry must be byte-identical on every pass or
 * `isMaterializerProjectionNoOp` never converges and each run rewrites and re-syncs
 * the row. Key order matches `fieldProvenanceSchema`'s declaration order for that
 * same comparison.
 */
function recordDerivedResearchAreaProvenance(set: Record<string, unknown>): void {
  set[DERIVED_RESEARCH_AREA_PROVENANCE_PATH] = {
    sourceName: DERIVED_RESEARCH_AREA_SOURCE_NAME,
    sourceUrl: '',
    confidence: DERIVED_RESEARCH_AREA_CONFIDENCE,
  };
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

type ResearchAreaCanonicalizationStep = (
  set: Record<string, unknown>,
  departments?: unknown,
) => Promise<unknown>;

async function admittedResearchAreas(
  canonicalizeResearchAreas: ResearchAreaCanonicalizationStep,
  value: unknown,
  departments: unknown,
): Promise<unknown> {
  const trial: Record<string, unknown> = { researchAreas: value };
  await canonicalizeResearchAreas(trial, departments);
  return trial.researchAreas;
}

/**
 * An observation whose every area this row rejects (its own department, a
 * division-level label, label leakage) states nothing about the row's topics, so it
 * is left out of the resolution altogether and the field resolves over the
 * observations that do state one. Leaving it out, rather than walking past it, keeps
 * it out of the confidence denominator too: it is no evidence, not weak evidence.
 */
async function resolveResearchAreasOverAdmissibleObservations(input: {
  now: Date;
  set: Record<string, unknown>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  resolverObs: ResolverObservation[];
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  materializationObs: MaterializerObservationLike[];
  canonicalizeResearchAreas: ResearchAreaCanonicalizationStep;
}): Promise<boolean> {
  const { set, entityDoc } = input;
  const departments = set.departments ?? entityDoc?.departments;
  const admissible: ResolverObservation[] = [];
  for (const observation of refusedResolverObservations(
    input.resolverObs,
    entityDoc?.fieldValueRefusals,
  ).kept) {
    if (observation.field !== 'researchAreas') continue;
    const admitted = await admittedResearchAreas(
      input.canonicalizeResearchAreas,
      observation.value,
      departments,
    );
    if (hasNonEmptyStringArray(admitted)) admissible.push(observation);
  }
  const resolved = resolveField('researchAreas', admissible, {
    now: input.now,
    manuallyLockedFields: input.manuallyLockedFields,
    manualValues: input.manualValues,
  });
  if (!resolved) return false;
  set.researchAreas = await admittedResearchAreas(
    input.canonicalizeResearchAreas,
    resolved.value,
    departments,
  );
  input.confidenceByField.researchAreas = resolved.confidence;
  const provenance = fieldProvenanceForResolvedObservation(
    'researchAreas',
    resolved,
    input.materializationObs,
  );
  if (provenance) set['fieldProvenance.researchAreas'] = provenance;
  else delete set['fieldProvenance.researchAreas'];
  return true;
}

/**
 * When no observation and no derivation leaves an admissible area, the rejected
 * observation is no evidence, so it must not displace what the row stores: writing
 * `[]` here emptied served rows whose only new observation named their own
 * department (#3836). The stored list still passes the same rejection, so a stored
 * department echo is removed rather than protected. Returns how many fields this
 * took back out of the projection.
 */
async function keepStoredResearchAreasOverWhollyRejectedObservation(input: {
  set: Record<string, unknown>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  canonicalizeResearchAreas: ResearchAreaCanonicalizationStep;
}): Promise<number> {
  const { set, entityDoc, confidenceByField } = input;
  delete set['fieldProvenance.researchAreas'];
  const storedConfidence = objectRecord(entityDoc?.confidenceByField).researchAreas;
  if (typeof storedConfidence === 'number') confidenceByField.researchAreas = storedConfidence;
  else delete confidenceByField.researchAreas;
  const stored = Array.isArray(entityDoc?.researchAreas) ? entityDoc.researchAreas : [];
  const admitted = await admittedResearchAreas(
    input.canonicalizeResearchAreas,
    stored,
    set.departments ?? entityDoc?.departments,
  );
  if (Array.isArray(admitted) && JSON.stringify(admitted) !== JSON.stringify(stored)) {
    set.researchAreas = admitted;
    return 0;
  }
  delete set.researchAreas;
  return 1;
}

/**
 * Keeps the derived provenance entry and the chips it vouches for inseparable.
 *
 * Derivation records the entry, but canonicalization runs AFTER it and can reject
 * every chip it derived, so both derivation call paths below can leave a row with no
 * chips and a provenance entry claiming its description supplied some. That record
 * is a claim about chips nobody serves, and on the next pass the empty stored array
 * re-enters derivation, so the pair never self-corrects. Runs once after the last
 * thing that can empty the array, and clears the stored entry too when derivation
 * wrote it and this pass has nothing left for it to vouch for.
 */
function reconcileDerivedResearchAreaProvenance(
  set: Record<string, unknown>,
  unset: Record<string, ''>,
  entityDoc: Record<string, unknown> | null,
): void {
  const finalAreas = 'researchAreas' in set ? set.researchAreas : entityDoc?.researchAreas;
  if (hasNonEmptyStringArray(finalAreas)) return;
  delete set[DERIVED_RESEARCH_AREA_PROVENANCE_PATH];
  const stored = objectRecord(entityDoc?.fieldProvenance).researchAreas;
  if (objectRecord(stored).sourceName === DERIVED_RESEARCH_AREA_SOURCE_NAME) {
    unset[DERIVED_RESEARCH_AREA_PROVENANCE_PATH] = '';
  }
}

export async function storedResearchAreasHaveNoLiveEvidence(input: {
  entityDoc: any;
  mergedInRows: ReadonlyArray<Pick<MergedInResearchEntityRow, '_id' | 'slug'>>;
  observations: ReadonlyArray<ResearchAreaEvidenceObservation>;
  manuallyLockedFields: string[];
}): Promise<boolean> {
  const { entityDoc } = input;
  // An archived row's resolve never reads its merged-in keys, so its evidence is unknown here.
  if (!entityDoc || entityDoc.archived === true) return false;
  if (researchAreasAreManuallyLocked({ manuallyLockedFields: input.manuallyLockedFields })) {
    return false;
  }
  return !hasLiveResearchAreaEvidence(
    researchAreaEvidenceIdentity(entityDoc, input.mergedInRows),
    input.observations,
    researchAreaAdmissionForRow(await getResearchAreaCanonicalizer(), entityDoc),
  );
}

export type UnbackedResearchAreaOutcome =
  | 'rederived'
  | 'already-derived'
  | 'added-derived'
  | 'kept-stored-covers-derived'
  | 'kept-stored-derived-empty'
  | 'kept-stored-type-not-derived'
  | 'nothing-derived';

function researchAreaMemberKey(area: unknown): unknown {
  return typeof area === 'string' ? area.trim().toLowerCase() : area;
}

function sameResearchAreaList(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((area, index) => area === right[index]);
}

/**
 * The derivation may add to what the pass would otherwise keep, never take from it:
 * applied as a replacement it dropped 138 stored chips for 77 derived ones on
 * Development, and the hand-read found unbacked stored chips correct 29 of 39 times
 * (#3836). The derived entry is recorded only when every resolved chip is one the
 * derivation produces, because the entry vouches for the whole list and is on the
 * #3790 allowlist only as a claim recomputed from the row's own description.
 */
async function rederiveUnbackedResearchAreas(input: {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  entityDoc: any;
  derive: typeof applyDescriptionResearchAreaDerivation;
  canonicalizeResearchAreas: ResearchAreaCanonicalizationStep;
}): Promise<UnbackedResearchAreaOutcome> {
  const { set, unset, entityDoc } = input;
  const stored: unknown[] = Array.isArray(entityDoc?.researchAreas) ? entityDoc.researchAreas : [];
  const kept: unknown[] =
    'researchAreas' in set ? (Array.isArray(set.researchAreas) ? set.researchAreas : []) : stored;
  const trial: Record<string, unknown> = { ...set };
  delete trial.researchAreas;
  await input.derive(trial, { ...(entityDoc ?? {}), researchAreas: [] });
  const derived = hasNonEmptyStringArray(trial.researchAreas)
    ? await admittedResearchAreas(
        input.canonicalizeResearchAreas,
        trial.researchAreas,
        set.departments ?? entityDoc?.departments,
      )
    : [];
  if (!Array.isArray(derived) || derived.length === 0) {
    if (stored.length === 0) return 'nothing-derived';
    const entityType = set.entityType ?? entityDoc?.entityType;
    return typeof entityType === 'string' &&
      DESCRIPTION_AREA_DERIVATION_ENTITY_TYPES.has(entityType)
      ? 'kept-stored-derived-empty'
      : 'kept-stored-type-not-derived';
  }
  const keptKeys = new Set(kept.map(researchAreaMemberKey));
  const derivedKeys = new Set(derived.map(researchAreaMemberKey));
  const resolved = [
    ...kept,
    ...derived.filter((area) => !keptKeys.has(researchAreaMemberKey(area))),
  ];
  const whollyDerived = kept.every((area) => derivedKeys.has(researchAreaMemberKey(area)));
  const storedProvenanceIsDerived =
    objectRecord(objectRecord(entityDoc?.fieldProvenance).researchAreas).sourceName ===
    DERIVED_RESEARCH_AREA_SOURCE_NAME;
  const listUnchanged = sameResearchAreaList(resolved, stored);

  if (whollyDerived) {
    if (listUnchanged && storedProvenanceIsDerived) {
      delete set.researchAreas;
      delete set[DERIVED_RESEARCH_AREA_PROVENANCE_PATH];
      return 'already-derived';
    }
    set.researchAreas = resolved;
    recordDerivedResearchAreaProvenance(set);
    return 'rederived';
  }

  delete set[DERIVED_RESEARCH_AREA_PROVENANCE_PATH];
  if (storedProvenanceIsDerived) unset[DERIVED_RESEARCH_AREA_PROVENANCE_PATH] = '';
  if (!listUnchanged) set.researchAreas = resolved;
  return resolved.length > kept.length ? 'added-derived' : 'kept-stored-covers-derived';
}

// The five `undergraduateLogistics*` fields join this set rather than leaving it:
// the vertical was retired (#3088) but 209 Development observations still carry
// those names, and without an ignore arm they would start reading as a gap to
// fill and be written onto the entity. `strandedKeyRedirectDecisionReport` also
// relies on this filter dropping them.
/**
 * The observation field that carries the slug of the research entity a roster-member
 * observation belongs to. Declared once because three scrapers write it and this
 * materializer is its only reader, so the pairing is otherwise four string literals
 * that nothing holds together (#3253).
 *
 * Do NOT rename the stored field to drop its `researchGroup` prefix. It is an opaque
 * join key, read only for a `findOne({ slug })`, so a rename changes no behaviour and
 * costs a dual-read window over 4,085 live rows whose failure mode is silently
 * dropping every roster materialization.
 */
export const RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD = 'researchGroupKey';

/**
 * Field names that carry the same slug but that no reader accepts.
 *
 * `researchGroupSlug` is written by the two grant lanes and read by nothing, so their
 * roster output is discarded in full: 465 live observations across 93 member keys
 * produced 0 role assignments, and that read exactly like a lane finding no members.
 *
 * Listed here to make the discard LOUD, never to read it. Accepting the alias would
 * activate 93 dormant grant-derived membership edges, which #3145 already ruled
 * against: a grant establishes funding, not roster membership. The resolution is for
 * those lanes to stop emitting members (#3274), not for this reader to widen.
 *
 * `researchEntityKey` is the same shape from a source that has already been fixed: 71
 * live `dept-faculty-roster` member rows state the slug under it, all written between
 * 15 and 17 May, and that lane has run as recently as September without writing it
 * again. They were discarded with a bare `missing-research-group-key` and no warning,
 * which is the same failure as a guard that cannot fire and is why nobody had seen
 * them. Listing it makes any reappearance loud; the 71 stale rows are retired
 * separately, because a warning that fires forever on dead data is noise rather than
 * a signal (#3253).
 *
 * Accepting this one would also not have helped: the same rows name the member under
 * `userEntityKey`, which no reader accepts, so they skip on `missing-required-fields`
 * even once the slug resolves. A skip reason moving is not a repair.
 */
const UNREAD_RESEARCH_ENTITY_SLUG_ALIASES = ['researchGroupSlug', 'researchEntityKey'] as const;

export function unreadResearchEntitySlugAlias(
  resolved: Record<string, { value?: unknown; sourceName?: string }>,
): { field: string; sourceName: string } | null {
  for (const field of UNREAD_RESEARCH_ENTITY_SLUG_ALIASES) {
    const candidate = resolved[field];
    if (candidate && textValue(candidate.value)) {
      return { field, sourceName: textValue(candidate.sourceName) || 'unknown' };
    }
  }
  return null;
}

const RETIRED_ACCESS_OBSERVATION_FIELDS = new Set([
  'acceptingUndergrads',
  'openness',
  'undergraduateLogisticsStudentLevel',
  'undergraduateLogisticsCompensation',
  'undergraduateLogisticsTimeCommitment',
  'undergraduateLogisticsModality',
  'undergraduateLogisticsCurrentAvailability',
]);

export function shouldIgnoreObservationForEntityMaterialization(
  entityType: ObservedEntityType,
  observation: MaterializerObservationLike,
): boolean {
  if (observation.field && MATERIALIZER_MANAGED_FIELDS.has(observation.field)) {
    return true;
  }
  if (entityType === 'fellowship' && isEnrichOnlyFellowshipSourceUrl(observation)) {
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
    undergradEvidenceQuoteIsInadmissible(observation.value, observation.sourceName)
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
  // A rejected value is kept rather than dropped here, so it has to be taken from
  // the normalizer too: falling back to the raw input would reinstate the invisible
  // format characters the ingest step just removed (#2874), or the glued sentence
  // boundary it just separated (#3096).
  const ingestCleaned = ingest.rejected
    ? withHarvestTextDefectsCorrected(field, value)
    : ingest.value;
  return materializedFieldValue(entityType, field, ingestCleaned, existingValue, entityIdentity);
}

/**
 * Keeping the stored value when an observation is unrecognized is only safe while
 * the stored value is itself one the schema accepts. 190 archived rows hold a
 * retired `entityType` from an enum that has since narrowed, and re-asserting one
 * of those in a `$set` is what made the writer and the schema disagree by
 * construction: the update carried a value the model would reject, and only the
 * missing `runValidators` hid it. Returning undefined instead leaves the legacy
 * value untouched rather than re-writing it.
 */
function schemaEnumFallback(existingValue: unknown, allowed: readonly string[]): unknown {
  return typeof existingValue === 'string' && allowed.includes(existingValue)
    ? existingValue
    : undefined;
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
    if (typeof value === 'string' && researchGroupKinds.includes(value as any)) return value;
    return schemaEnumFallback(existingValue, researchGroupKinds);
  }
  if (isResearchEntityObservationType(entityType) && field === 'entityType') {
    if (typeof value === 'string' && researchEntityTypes.includes(value as any)) return value;
    return schemaEnumFallback(existingValue, researchEntityTypes);
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
    (field === 'fname' || field === 'lname' || field === 'displayName') &&
    typeof value === 'string'
  ) {
    return sanitizePersonName(value) ?? normalizePersonNameCasing(value);
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

const RESEARCH_ENTITY_GRANT_EVIDENCE_FIELDS = new Set([
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
]);

export function aggregateResearchEntityGrantEvidence(observations: MaterializerObservationLike[]): {
  recentGrants?: unknown[];
  recentGrantCount?: number;
  fundingAgencies?: string[];
} {
  const latest = new Map<string, MaterializerObservationLike>();
  for (const observation of observations) {
    if (!RESEARCH_ENTITY_GRANT_EVIDENCE_FIELDS.has(String(observation.field))) continue;
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

/**
 * Carries its own copy of the refusal vocabulary rather than calling
 * `isDisallowedResearchEntitySourceUrl`, and the advancement arm has to be added to
 * both: the serve-time predicate reaches the detail route but not the search-list DTO,
 * which projects `sourceUrls` with URL-safety checks only, so a value the serve
 * predicate hides is still shipped on browse while it remains stored (#2240 family).
 * Refusing it here is what actually empties the field, which is why the stranded
 * advancement observations that #2550 left live cannot re-contaminate a row through
 * `observations:catch-up-materialize` or a redirect backfill (#2614).
 */
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
      !isEphemeralDeployHostUrl(url) &&
      !isDirectoryLoaderUrl(url) &&
      !isFacetedOrSectionIndexUrl(url) &&
      !isInstitutionalAdvancementUrl(url) &&
      // The map arm has to be in both copies for the reason the docblock gives: the
      // serve-time predicate misses the search-list DTO, so refusing it here is what
      // actually empties the stored field (#3184).
      !isMapOrDirectionsUrl(url) &&
      !isBoilerplatePlatformHostUrl(url),
  );
  if (!entityIdentity) return kept;
  const entityForMatch: ResearchEntityIdentity = {
    ...entityIdentity,
    sourceUrls: kept as string[],
  };
  return kept.filter((url) => personProfileSourceMatchesEntity(url, entityForMatch));
}

/**
 * Whether `priorUrl` is the same person's retired path on the host that now
 * publishes them at `nextUrl`. `supersedesOfficialProfileUrl` owns the direction
 * and the same-host rule, so a second roster page cannot displace a citation.
 *
 * The person check is not redundant with the supersession rule. That rule reasons
 * about host and path shape only, so on an entity citing several colleagues on one
 * departmental host - a center's affiliated-people citations - a `/profile/<lead>`
 * would otherwise be read as superseding every colleague's `/people/<slug>`.
 */
function isRetiredProfilePathForSamePerson(priorUrl: unknown, nextUrl: unknown): boolean {
  if (typeof priorUrl !== 'string' || typeof nextUrl !== 'string') return false;
  if (!supersedesOfficialProfileUrl(priorUrl, nextUrl)) return false;
  const nextTokens = personPageNameTokensFromUrl(nextUrl);
  const priorTokens = personPageNameTokensFromUrl(priorUrl);
  if (!nextTokens || !priorTokens) return false;
  return priorTokens.join('-') === nextTokens.join('-');
}

/**
 * The stored citations a freshly projected lead profile URL retires: the same
 * host's older non-canonical path for the same person, which the department has
 * since moved onto its canonical `/profile/<slug>` page.
 *
 * Dropping is what makes the projection idempotent. It only ever appended, so once
 * a department moved a page the entity kept citing the dead path forever and served
 * it beside the live one; a repair pass over stored rows would then be undone by
 * the next materialization (#2522).
 */
export function withoutSupersededProfileSourceUrls(
  sourceUrls: readonly unknown[],
  leadProfileUrl: string,
): string[] {
  return sourceUrls
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .filter((url) => !isRetiredProfilePathForSamePerson(url, leadProfileUrl));
}

/**
 * A citation the current log does not re-assert is not thereby retracted.
 *
 * `sourceUrls` is deliberately absent from `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, but the
 * projection used to write the resolver's list over the stored one, so silence did the
 * retracting: any materialize without a fresh scrape in the same pass - a rematerialize, a
 * catch-up, a gate re-derive - dropped a real citation. Measured on Development, 60 of the
 * first 2,676 live rows examined lost one, including grant records and personal lab sites
 * (#3476).
 *
 * Removal still happens and still needs a positive reason. Two kinds of reason reach here.
 * `condemned` carries what the arms actually dropped this pass - the different-person
 * retraction, the #613 profile supersession, the directory-graft stage, the vocabulary filter -
 * and anything they dropped stays gone. But those arms only ever saw what the pass derived, so
 * a stored graft the pass never re-derived was never offered to them and would come back
 * uncondemned. Their predicates therefore run again over the candidates, which is a different
 * thing from feeding the candidates to the arms that DERIVE from a citation.
 *
 * This runs after every arm that DERIVES a `websiteUrl` from a citation, and that ordering is the
 * whole point. Re-admitting before them makes a stale citation an authoritative input: a
 * `websiteUrl` retraction retires its observation, the promotion arm then reads the list and
 * re-adopts the same site from the citation, and #2542's and #3452's "the next pass keeps it
 * absent" both fail. The stored citation is evidence the row was seen, not evidence of what it
 * says now. It runs before the Yale-status derivation and the #1802 provenance fallback, because
 * both read the list the pass will write: after them, a restored in-memoriam page would sit
 * beside an active status, and an already-sourced row would accrue a provenance url.
 */
export function planStoredCitationReadmission(input: {
  stored: unknown;
  planned: unknown;
  condemned: ReadonlySet<string>;
  entity: ResearchEntityHostOwnerIdentity;
  citationIdentity?: ResearchEntityIdentity | null;
  sourceLinkHealth?: unknown;
}): string[] | null {
  const stored = Array.isArray(input.stored)
    ? input.stored.filter((url): url is string => typeof url === 'string' && Boolean(url.trim()))
    : [];
  // Nothing was going to be written, so there is nothing to shrink and nothing to restore.
  if (stored.length === 0 || !Array.isArray(input.planned)) return null;
  const planned = input.planned.filter((url): url is string => typeof url === 'string');
  const plannedProfileDestinations = new Set(planned.map(normalizeOfficialProfileDestination));
  // Called without an identity on purpose, so only the URL-shape filter runs: the identity arm
  // would refuse a cross-school page the row legitimately cites, which is a retraction with no
  // positive reason (#2945).
  const admissible = sanitizeResearchEntitySourceUrlsForMaterialization(stored) as string[];
  const readmitted = admissible.filter(
    (url) =>
      !input.condemned.has(url) &&
      !planned.includes(url) &&
      !(
        isLikelyOfficialPersonProfileUrl(url) &&
        plannedProfileDestinations.has(normalizeOfficialProfileDestination(url))
      ) &&
      !planned.some((next) => isRetiredProfilePathForSamePerson(url, next)) &&
      !isKnownDeadSourceUrl(input.sourceLinkHealth, url) &&
      !isDirectoryGraftCitation(url, input.entity) &&
      !(
        input.citationIdentity &&
        personProfileSourceIsADifferentPersonThanCitedOwner(url, input.citationIdentity)
      ),
  );
  if (readmitted.length === 0) return null;
  // Stored order first, so the row's own citation order is stable and this pass appends.
  return [...readmitted, ...planned].filter((url, index, all) => all.indexOf(url) === index);
}

const LEAD_IDENTITY_OBSERVATION_FIELDS = new Set([
  'inferredPiUserId',
  'inferredPiUserKey',
  'inferredDirectorName',
]);

/**
 * An observation's `sourceUrl` is immutable, so a lead whose profile page has
 * since been removed would be re-projected onto `sourceUrls` by every later
 * materialization - neither a re-scrape nor a re-materialize can retract it
 * (#2567). Candidates the corpus positively knows are gone are therefore
 * skipped in confidence order, so a lower-confidence live profile still
 * supplies the #613 way in. `isKnownDeadSourceUrl` fails open on an unprobed
 * URL, so this narrows what may be minted and never widens it.
 *
 * A probe verdict alone is not durable enough on its own: the repair lane
 * rewrites the dead citation to the live CMS path and drops the dead URL's
 * `sourceLinkHealth` entry with it, so the verdict is gone on the next pass
 * while the observation's provenance still points at the retired path. The
 * entity's own surviving citation is therefore the second, permanent reason to
 * refuse - a candidate the entity already cites the successor of is retired by
 * the host's own reckoning, which is the same relation `withoutSupersededProfileSourceUrls`
 * reads in the other direction.
 *
 * A page belonging to somebody other than the person the entity's own citations
 * establish as its own is refused for the same reason and in the same place: inside
 * the candidate filter, so a refused page loses to the next acceptable candidate.
 * Filtering the winner afterwards would let the refused stranger win the ranking and
 * then vanish, taking the #613 way in with it while the row's own person's live page
 * sat in the same observation set (#2945).
 */
export function officialLeadProfileSourceUrl(
  observations: MaterializerObservationLike[],
  storedSourceLinkHealth?: unknown,
  citedSourceUrls: readonly unknown[] = [],
  entityIdentity?: ResearchEntityIdentity,
): string | undefined {
  const winner = observations
    .filter(
      (observation) =>
        typeof observation.field === 'string' &&
        LEAD_IDENTITY_OBSERVATION_FIELDS.has(observation.field) &&
        isLikelyOfficialPersonProfileUrl(observation.sourceUrl) &&
        !isKnownDeadSourceUrl(storedSourceLinkHealth, observation.sourceUrl) &&
        !citedSourceUrls.some((cited) =>
          isRetiredProfilePathForSamePerson(observation.sourceUrl, cited),
        ) &&
        !(
          entityIdentity &&
          personProfileSourceIsADifferentPersonThanCitedOwner(observation.sourceUrl, entityIdentity)
        ),
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
  storedSourceLinkHealth?: unknown,
  entityIdentity?: ResearchEntityIdentity,
): string | undefined {
  const ranked = observations
    .filter(
      (observation) =>
        textValue(observation.sourceUrl) &&
        !isKnownDeadSourceUrl(storedSourceLinkHealth, observation.sourceUrl),
    )
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .map((observation) => String(observation.sourceUrl).trim());
  // The identity is passed here rather than only at the caller so a refused page
  // loses to the next acceptable candidate. Filtering afterwards would let the
  // refused page win the ranking and then vanish, leaving the row unsourced while
  // an acceptable provenance url was available (#2945).
  const sanitized = sanitizeResearchEntitySourceUrlsForMaterialization(
    entityIdentity
      ? ranked.filter(
          (url) => !personProfileSourceIsADifferentPersonThanCitedOwner(url, entityIdentity),
        )
      : ranked,
  );
  return Array.isArray(sanitized) ? (sanitized[0] as string | undefined) : undefined;
}

/**
 * The identity a `sourceUrls` projection arbitrates a surname collision with: every
 * person page the row cites, stored or already projected this pass.
 *
 * The union rather than either list alone. The stored list is the floor, because a
 * projection that empties `sourceUrls` must not lose the owner in the same pass that
 * mints its replacement. The list projected this pass has to be added to it, because
 * a row that first learns its own person's page in this pass cites that owner by the
 * time the projections run, and reading only the stored snapshot would find no owner
 * to arbitrate with and mint the stranger beside it (#2945).
 */
export function researchEntityIdentityWithCitationsThroughThisPass(
  entityIdentity: ResearchEntityIdentity | undefined,
  storedSourceUrls: unknown,
  projectedSourceUrls: readonly unknown[],
): ResearchEntityIdentity | undefined {
  if (!entityIdentity) return entityIdentity;
  return {
    ...entityIdentity,
    citedPersonPageUrls: [
      ...(Array.isArray(storedSourceUrls) ? storedSourceUrls : []),
      ...projectedSourceUrls,
    ].filter((url): url is string => typeof url === 'string'),
  };
}

export function deriveResearchEntityWebsiteUrl(
  set: Record<string, unknown>,
  entityDoc?: Record<string, unknown> | null,
): WebsiteUrlBackfillResolution {
  const merged = (field: string): unknown => (field in set ? set[field] : entityDoc?.[field]);
  // entityType and kind are passed because the resolver's own guards are person-scoped:
  // without them every type-gated refusal inside `isPromotableWebsiteUrl` reads an
  // undefined type and cannot fire, so the backfill script and the materializer applied
  // different rules to the same value (#2708).
  return resolveBackfillWebsiteUrl({
    websiteUrl: merged('websiteUrl'),
    website: merged('website'),
    sourceUrls: merged('sourceUrls'),
    name: merged('name'),
    displayName: merged('displayName'),
    entityType: merged('entityType'),
    kind: merged('kind'),
  });
}

/**
 * Whether clearing the research home has anything to clear. A row whose `websiteUrl` is
 * already absent or empty gains no meaning from being set to `''`, and writing it anyway
 * reports a field write that changed nothing and grows the population of rows storing
 * `''` rather than nothing, which is what makes `{ websiteUrl: { $exists: true } }`
 * useless as a "has a research home" query (#2708).
 */
export function clearedWebsiteUrlIsWorthWriting(
  set: Record<string, unknown>,
  entityDoc?: Record<string, unknown> | null,
): boolean {
  const current = 'websiteUrl' in set ? set.websiteUrl : entityDoc?.websiteUrl;
  return typeof current === 'string' && current.trim().length > 0;
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
      (obs) =>
        obs._id && obs.field === field && obs.sourceName && contributingSources.has(obs.sourceName),
    )
    .find((obs) => comparableObservationValue(obs.value) === resolvedValue);
  if (!match?._id) return null;

  // `observationId` is the reference observation retention reads to decide a row
  // is still cited (`OBSERVATION_REFERENCE_SPECS`), so writing the observation's
  // id into `sourceId` left every cited row unprotected while the protection
  // spec still looked present (#2897). Each key holds what its ref declares:
  // `sourceId` the `Source`, `observationId` the `Observation`.
  //
  // Key order must match `fieldProvenanceSchema`'s declaration order, because
  // `materializerValuesDeepEqual` compares with `JSON.stringify` and Mongoose
  // stores a subdocument in schema order: emitting these keys in any other order
  // makes every re-projection differ from the stored value, so the diff-skip
  // no-op never converges and each run rewrites and re-syncs the entity.
  return {
    ...(match.sourceId ? { sourceId: match.sourceId } : {}),
    sourceName: match.sourceName,
    sourceUrl: match.sourceUrl || '',
    observationId: match._id,
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

export interface InferredPiLeadFacts {
  personId: string;
  legacyRole: string;
  confidence: number;
  startedAt: Date;
  sourceName: string;
  sourceUrl: string;
  observedAt: Date;
}

/**
 * The lead facts an `inferredPiUserId` observation states, as the canonical write needs
 * them.
 *
 * This replaced a builder that produced a `research_entity_members`-shaped
 * `{ filter, update }`, a collection retired in #210, which its only caller unpacked in
 * memory and never applied. That indirection hid a field mismatch for 4,658 lead edges:
 * the builder wrote the source name at `fieldProvenance.role.sourceName` while the
 * unpacker read a top-level `sourceName` nobody set, so `rosterProvenance.sourceName` was
 * always undefined and `retireNonOwnerPiEdges`' fail-closed refusal for an edge that cites
 * a source could never fire (#3254). Stating the facts once, in the shape the consumer
 * actually wants, is what makes a second reader of the same value impossible.
 */
export function buildInferredPiLeadFacts(
  researchEntityId: string,
  observation: InferredPiObservation,
): InferredPiLeadFacts | null {
  const userId = String(observation.value || '').trim();
  const safeResearchEntityId = normalizeMaterializerObjectId(researchEntityId);
  const safeUserId = normalizeMaterializerObjectId(userId);
  if (!safeResearchEntityId || !safeUserId) {
    return null;
  }
  const observedAt = observation.observedAt || new Date();
  return {
    personId: String(safeUserId),
    legacyRole: 'pi',
    confidence: typeof observation.confidence === 'number' ? observation.confidence : 0.5,
    startedAt: observedAt,
    sourceName: observation.sourceName || '',
    sourceUrl: observation.sourceUrl || '',
    observedAt,
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
const LEAD_MEMBER_ROLES = LEAD_ROLE_LEGACY_LABELS;
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

export type RosterMemberUnresolvedReason =
  | 'no-identity-evidence'
  | 'evidence-names-nobody'
  | 'evidence-names-someone-else'
  | 'evidence-ambiguous';

export type RosterMemberIdentity =
  | { researcher: any; basis: RosterIdentityBasis }
  | { researcher: null; unresolved: RosterMemberUnresolvedReason };

async function liveResearcherForAccount(accountId: unknown): Promise<any | null> {
  if (!accountId) return null;
  return Researcher.findOne({ accountId, archived: { $ne: true } })
    .select('_id displayName')
    .lean();
}

async function liveResearchersHoldingNetid(netid: string): Promise<any[]> {
  const accounts: any[] = await Account.find({ netid })
    .limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT)
    .lean();
  const byAccount = await Promise.all(
    accounts.filter(accountIsLive).map((account) => liveResearcherForAccount(account._id)),
  );
  const byIdentifier: any[] = await Researcher.find({
    'identifiers.netid': netid,
    archived: { $ne: true },
  })
    .select('_id displayName')
    .limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT)
    .lean();
  return [...byAccount, ...byIdentifier].filter(Boolean);
}

async function researchersNamedByIdentityEvidence(
  evidence: RosterMemberIdentityEvidence,
): Promise<any[]> {
  const named = new Map<string, any>();
  const add = (researcher: any) => {
    if (researcher?._id) named.set(String(researcher._id), researcher);
  };
  const claimantsByUrl = await liveResearchersClaimingOfficialProfileUrls(
    evidence.linkedProfileUrls,
  );
  for (const claimants of claimantsByUrl.values()) {
    if (claimants.length === 1) add(claimants[0]);
  }
  for (const email of evidence.emails) {
    const account = await soleLiveAccountClaimingEmail(email);
    add(await liveResearcherForAccount(account?._id));
  }
  for (const netid of evidence.netids) {
    for (const researcher of await liveResearchersHoldingNetid(netid)) add(researcher);
  }
  return [...named.values()];
}

/**
 * Who a roster listing names, decided only by identity evidence: the listing's profile
 * URL, or a Yale profile URL, email or netid its own profile page states. A name never
 * joins; it only vetoes a candidate the evidence reached, as every other lane's email and
 * profile-page join does, and two agreeing candidates resolve to nobody (#3802).
 */
export async function resolveRosterMemberIdentity(
  resolved: Record<string, ResolvedField>,
  listedName: string,
): Promise<RosterMemberIdentity> {
  const byProfileUrl = await findUniqueResearcherForRosterMember(resolved);
  if (byProfileUrl) return { researcher: byProfileUrl, basis: 'profile-url' };
  const evidenceField = resolved[ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD];
  const evidence = evidenceField?.hasConflict
    ? null
    : parseRosterMemberIdentityEvidence(evidenceField?.value);
  if (!evidence || !listedName) return { researcher: null, unresolved: 'no-identity-evidence' };
  const named = await researchersNamedByIdentityEvidence(evidence);
  if (named.length === 0) return { researcher: null, unresolved: 'evidence-names-nobody' };
  const agreeing = named.filter((researcher) =>
    observedPersonNameAgreesWith(researcher.displayName, listedName),
  );
  if (agreeing.length === 0) {
    return { researcher: null, unresolved: 'evidence-names-someone-else' };
  }
  if (agreeing.length > 1) return { researcher: null, unresolved: 'evidence-ambiguous' };
  return { researcher: agreeing[0], basis: 'identity-evidence' };
}

/**
 * Sources whose unresolved listing is not minted as a name-only person when a researcher
 * with an identity already holds the name: such a mint is folded back by the
 * accountless-shell dedupe on the name alone, and the lane re-mints it on its next read,
 * so the center serves the person twice between the two (#3802). Adding a source needs
 * the same measurement of what its refused listings cost.
 */
const SOURCES_THAT_REFUSE_A_NAMESAKE_MINT: ReadonlySet<string> = new Set([
  CENTERS_INSTITUTES_SOURCE_NAME,
]);

async function listingWouldMintANamesake(
  plan: RosterMemberCanonicalPlan,
  identity: RosterMemberIdentity,
): Promise<boolean> {
  if (identity.researcher || plan.personReferenceId) return false;
  const sourceName = textValue(plan.facts.rosterProvenance?.sourceName);
  if (!SOURCES_THAT_REFUSE_A_NAMESAKE_MINT.has(sourceName)) return false;
  return identifiedResearcherHoldsDisplayName(plan.facts.displayName);
}

const DIRECTOR_NAME_CANDIDATE_LIMIT = 40;

/**
 * A named director is only resolvable by name when exactly one live researcher
 * answers to that name. Two or more is a namesake collision, which is the defect
 * class that puts one person's work on another person's page, so an ambiguous
 * name resolves to nobody rather than to a guess.
 *
 * Candidates are narrowed on the surname and then judged by the same
 * `observedPersonNameAgreesWith` comparator every other lane uses, so the
 * diacritic and apostrophe handling stays in one place.
 */
async function findUniqueResearcherByObservedDirectorName(name: string): Promise<any | null> {
  const observed = splitName(textValue(name));
  if (!observed.last || !observed.first) return null;
  const candidates = await Researcher.find({
    archived: { $ne: true },
    displayName: new RegExp(escapeRegex(observed.last), 'i'),
  })
    .select('_id displayName profile.title')
    .limit(DIRECTOR_NAME_CANDIDATE_LIMIT + 1)
    .lean();
  if (candidates.length > DIRECTOR_NAME_CANDIDATE_LIMIT) return null;
  const agreeing = candidates.filter((candidate: any) =>
    observedPersonNameAgreesWith(candidate.displayName, textValue(name)),
  );
  if (agreeing.length !== 1) return null;
  const only = agreeing[0] as any;
  if (isTraineeLevelTitle(textValue(only.profile?.title))) return null;
  return only;
}

/**
 * How many fields the roster lane actually wrote.
 *
 * Named and exported because the lane used to report `Object.keys(resolved).length`,
 * its count of resolved INPUTS, on every pass including one that changed nothing.
 * `unchanged` is the common case on a re-run and a refusal writes nothing at all,
 * so both are zero (#210).
 */
export const rosterMemberFieldsWritten = (
  outcome: CanonicalMembershipOutcome,
  fieldsResolved: number,
): number => (outcome === 'created' || outcome === 'updated' ? fieldsResolved : 0);

export function buildRosterMemberCanonicalPlan(
  researchEntityId: string,
  resolved: Record<string, ProvenanceResolvedField>,
  user: Record<string, unknown> | null = null,
): RosterMemberCanonicalPlan | null {
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
    textValue(resolved.identityKey?.value) || officialProfileIdentityKey(profileUrl);
  const membershipKey =
    textValue(resolved.membershipKey?.value) || rosterMembershipKey(identityKey, role);
  if ((!name && !userId) || (!userId && !identityKey)) {
    return null;
  }

  const roleSource = resolved.role;
  const observedAt = roleSource?.observedAt || new Date();
  const confidence = typeof roleSource?.confidence === 'number' ? roleSource.confidence : 0.5;
  const sourceUrl = textValue(roleSource?.sourceUrl);
  const sourceName = textValue(roleSource?.sourceName);

  const evidenceStatus = textValue(resolved.evidenceStatus?.value);
  const sectionLabel = textValue(resolved.sectionLabel?.value);

  return {
    role,
    matchName: name,
    personReferenceId: userId,
    identityKey,
    facts: {
      legacyRole: role,
      displayName: name || undefined,
      evidenceStatus: evidenceStatus || undefined,
      isCurrentMember: true,
      confidence,
      startedAt: observedAt,
      rosterProvenance: {
        sourceName: sourceName || undefined,
        sourceUrl: sourceUrl || undefined,
        profileUrl: profileUrl || undefined,
        sectionLabel: sectionLabel || undefined,
        evidenceStatus: evidenceStatus || undefined,
        membershipKey: membershipKey || undefined,
        observedAt,
        freshnessExpiresAt: coerceRosterProvenanceDate(resolved.freshnessExpiresAt?.value),
      },
    },
    fieldsResolved: Object.keys(resolved).length,
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

/**
 * Only a lane whose edges a two-read retirement governs may adopt, because adopting hands
 * the edge to that lane's retirement: `official-research-home-roster` ends an edge on a
 * single snapshot that omits it, which would end an adopted edge on the read that adopted
 * it. Adding a source here requires that its retirement meet the same two-read rule.
 */
const SOURCES_THAT_ADOPT_UNPROVENANCED_EDGES: ReadonlySet<string> = new Set([
  CENTERS_INSTITUTES_SOURCE_NAME,
]);

/**
 * The person must be the one the listing's profile URL resolved to, never a name match, so
 * a namesake's edge is not adopted (#3799).
 */
async function adoptListedPersonUnprovenancedEdges(
  researchEntityId: string,
  plan: RosterMemberCanonicalPlan,
  personId: mongoose.Types.ObjectId | undefined,
): Promise<number> {
  const provenance = plan.facts.rosterProvenance;
  const sourceName = textValue(provenance?.sourceName);
  const listedRole = canonicalRoleForLegacy(plan.role);
  const listedMembershipKey = textValue(provenance?.membershipKey);
  const profilePersonId = toMaterializerObjectId(plan.personReferenceId);
  if (
    !personId ||
    !profilePersonId?.equals(personId) ||
    !plan.identityKey ||
    !listedRole ||
    !listedMembershipKey ||
    !SOURCES_THAT_ADOPT_UNPROVENANCED_EDGES.has(sourceName)
  ) {
    return 0;
  }
  return adoptUnprovenancedRoleAssignments(researchEntityId, {
    personId: profilePersonId,
    sourceName,
    sourceUrl: textValue(provenance?.sourceUrl) || undefined,
    profileUrl: textValue(provenance?.profileUrl) || undefined,
    listedRole,
    listedMembershipKey,
    listedObservedAt: provenance?.observedAt ?? new Date(),
    membershipKeyForRole: (role) =>
      rosterMembershipKey(plan.identityKey, LEGACY_ROLE_BY_CANONICAL[role] ?? ''),
    adoptedAt: new Date(),
  });
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
  const resolved = withResolvedFieldProvenance(
    resolveAllFields(resolverObs, { now: options.now ?? new Date() }),
    observations,
  );
  const researchGroupKey = textValue(resolved[RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD]?.value);
  if (!researchGroupKey) {
    const unreadAlias = unreadResearchEntitySlugAlias(resolved);
    if (unreadAlias) {
      console.warn(
        `[materialize] roster member discarded: source ${sanitizeLogValue(
          unreadAlias.sourceName,
        )} states the research-entity slug under "${unreadAlias.field}", which no reader accepts. ` +
          `Expected "${RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD}". The edge is NOT written (#3274).`,
      );
    }
    return {
      entityType: 'researchGroupMember',
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: unreadAlias
        ? 'research-entity-slug-under-an-unread-alias'
        : 'missing-research-group-key',
    };
  }

  const routedRosterHome = options.chunkPrefetch?.liveEntityDocForKey(
    'researchEntity',
    researchGroupKey,
  );
  const entity: any = routedRosterHome?.hit
    ? routedRosterHome.value
    : await ResearchEntity.findOne({
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
  const listedName =
    textValue(resolved.name?.value) ||
    memberNameFromInferredUserName(resolved.inferredUserName?.value);
  const identity = await resolveRosterMemberIdentity(resolved, listedName);
  const researcher = identity.researcher;
  const memberIdentity = researcher?._id
    ? await canonicalResearcherIdentity(idValue(researcher._id))
    : undefined;
  const plan = buildRosterMemberCanonicalPlan(researchEntityId, resolved, researcher);
  if (!plan) {
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
  if (await listingWouldMintANamesake(plan, identity)) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'unresolved-identity-namesake',
    };
  }
  if ('basis' in identity && plan.facts.rosterProvenance) {
    plan.facts.rosterProvenance.identityBasis = identity.basis;
  }

  if (options.dryRun) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      // A dry run applies nothing, so it reports the plan's size rather than a
      // write count it cannot have.
      fieldsWritten: 0,
      fieldsPlanned: plan.fieldsResolved,
      conflicts: plan.conflicts,
      created: false,
      resolved,
    };
  }

  const resolvedRole = plan.role;
  const { roster, matches } = await findCanonicalRosterMatch(researchEntityId, {
    researcherId: plan.personReferenceId,
    name: plan.matchName,
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
      await adoptListedPersonUnprovenancedEdges(
        researchEntityId,
        plan,
        toMaterializerObjectId(plan.personReferenceId),
      );
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
  const { outcome, personId } = await writeCanonicalMembership(researchEntityId, plan.facts, {
    netid: memberIdentity?.netid,
    email: memberIdentity?.email,
    orcid: memberIdentity?.orcid,
    displayName: plan.facts.displayName ?? '',
    hasCanonicalSourceReference: Boolean(plan.personReferenceId),
    resolvedPersonId:
      'basis' in identity && identity.basis === 'identity-evidence'
        ? toMaterializerObjectId(plan.personReferenceId)
        : undefined,
  });
  await adoptListedPersonUnprovenancedEdges(researchEntityId, plan, personId);
  return {
    entityType: 'researchGroupMember',
    entityId: materializerDocumentId(entity._id),
    entityKey: identifier.entityKey,
    fieldsWritten: rosterMemberFieldsWritten(outcome, plan.fieldsResolved),
    fieldsPlanned: plan.fieldsResolved,
    membershipOutcome: outcome,
    conflicts: plan.conflicts,
    created: outcome === 'created' || (!existing && outcome === 'updated'),
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

export async function planInferredPiMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<InferredPiLeadFacts[]> {
  const leads: InferredPiLeadFacts[] = [];
  const piObservations = observations.filter((obs) => obs.field === 'inferredPiUserId');
  for (const observation of piObservations) {
    const facts = buildInferredPiLeadFacts(researchEntityId, observation);
    if (facts) leads.push(facts);
  }

  const piKeyObservations = observations.filter((obs) => obs.field === 'inferredPiUserKey');
  for (const observation of piKeyObservations) {
    const resolution = await resolveInferredPiKeyIdentity(
      inferredPiUserKeyIdentity(observation.value),
    );
    if (resolution.status !== 'matched' || !resolution.researcherId) continue;
    const facts = buildInferredPiLeadFacts(researchEntityId, {
      ...observation,
      value: resolution.researcherId.toString(),
    });
    if (facts) leads.push(facts);
  }
  return leads;
}

export async function materializeInferredPiMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<void> {
  for (const facts of await planInferredPiMembership(researchEntityId, observations)) {
    await materializeCanonicalPiMembership(researchEntityId, facts);
  }
}

type RosterEmailAliasResolution =
  | { status: 'resolved'; netid: string }
  | { status: 'absent' }
  | { status: 'ambiguous' };

/**
 * A department roster publishes the friendly email alias (`first.last`) rather than the
 * netid (`fl123`), and the alias passes the netid shape test, so `inferredPiUserKey`
 * carries `netid:<alias>` and every netid lookup on it misses
 * (`docs/research-model.md:31`). #2776 refused to mint a researcher for those keys for a
 * sound reason: the mint could stamp neither a netid nor an account, so it would leave an
 * orphan person and the entity still on `missing_lead`.
 *
 * `yale-directory` carries `email` as a field on its `user` observations, so the corpus
 * holds the alias-to-netid map without a new lane. #2810 measured that it is only half
 * keyed by the real netid: of 18,397 live email observations, 8,769 carry a netid-shaped
 * key and 9,628 an alias-shaped one, because the directory publishes the alias in its own
 * netid field too. Two rules keep that from defeating the resolution:
 *
 *   - An observation is keyed `netid:<value>`, so the value is read through
 *     `userLookupValueForInferredPiUserKey` rather than off the raw key. #2810 found 192
 *     researchers stamped `netid:<alias>`, which `researcherPersonNameResolver` looks up
 *     as a bare netid and therefore never matches: a key that resolves to nobody.
 *   - A candidate equal to the alias itself is dropped, because resolving an alias to
 *     itself stamps the alias as a join key, which is what #2776 refused. Equality is the
 *     test rather than the alias shape: 170 accounts hold a netid containing a dot, so
 *     shape alone would refuse real netids.
 *
 * Dropping the self-match is also what makes one person's two records resolve instead of
 * refusing, since their alias-keyed and netid-keyed rows both match the address.
 * Fails closed when an alias still maps to more than one netid. `ambiguous` is reported
 * apart from `absent` because the two mean opposite things downstream: an alias the
 * directory maps to two identities must not then be resolved by the name it spells.
 */
export async function resolveNetidForRosterEmailAlias(
  alias: string,
): Promise<RosterEmailAliasResolution> {
  const local = alias.trim().toLowerCase();
  if (!local || local.includes('@') || !local.includes('.')) return { status: 'absent' };
  const matches = (await Observation.find(
    {
      entityType: 'user',
      field: 'email',
      superseded: false,
      value: new RegExp(`^${escapeRegex(local)}@`, 'i'),
    },
    { entityKey: 1 },
  ).lean()) as Array<{ entityKey?: unknown }>;
  const netids = uniqueStrings(
    matches
      .map((match) => userLookupValueForInferredPiUserKey(match.entityKey).toLowerCase())
      .filter((netid) => Boolean(netid) && netid !== local),
  );
  if (netids.length === 1) return { status: 'resolved', netid: netids[0] };
  return { status: netids.length > 1 ? 'ambiguous' : 'absent' };
}

export async function netidForRosterEmailAlias(alias: string): Promise<string | undefined> {
  const resolution = await resolveNetidForRosterEmailAlias(alias);
  return resolution.status === 'resolved' ? resolution.netid : undefined;
}

interface InferredPiKeyIdentity {
  netid?: string;
  name: string;
  emailAliasName?: string;
}

function personNameFromKeySlug(slug: string): string {
  return slug
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .join(' ');
}

function inferredPiUserKeyIdentity(value: unknown): InferredPiKeyIdentity {
  const raw = typeof value === 'string' ? value.trim() : '';
  const nameSlugMatch = raw.match(DEPT_USER_KEY_PATTERN) ?? raw.match(NAME_SLUG_USER_KEY_PATTERN);
  if (nameSlugMatch) {
    return { name: personNameFromKeySlug(nameSlugMatch[1]) };
  }
  const lookupValue = userLookupValueForInferredPiUserKey(value);
  if (!lookupValue || lookupValue.includes('@')) return { name: '' };
  const netid = lookupValue.toLowerCase();
  return {
    netid,
    name: '',
    ...(isLikelyYaleEmailLocalPart(netid) ? { emailAliasName: personNameFromKeySlug(netid) } : {}),
  };
}

/**
 * Netid, then the directory's alias-to-netid map (#2799), then the name the key carries.
 * The order is load-bearing: the alias map is the directory's own statement about whose
 * address this is, so it outranks the name the alias merely spells, and reordering the two
 * would silently re-point the leads #2799 already resolves.
 *
 * `emailAliasName` is the name a `netid:<first>.<last>` payload implies rather than asserts,
 * and is kept apart from `name` because the researcher-mint gate may act on an asserted name
 * only (#2776). Just `^netid:` and the bare form are stripped to a bare payload, so a
 * `nih-pi:` key still carries its namespace here and stays excluded from both by
 * construction.
 *
 * An alias the directory maps to two netids stops the walk rather than falling through to
 * the name, because the map is evidence that the address names two identities, and a name
 * the corpus happens to hold once would otherwise pick a person the directory contradicts.
 */
async function resolveInferredPiKeyIdentity(
  identity: InferredPiKeyIdentity,
): Promise<ResearcherPersonNameResolution> {
  if (identity.netid) {
    const byNetid = await resolveResearcherIdForPersonName('', { netid: identity.netid });
    if (byNetid.status === 'matched') return byNetid;
    const aliasMapping = await resolveNetidForRosterEmailAlias(identity.netid);
    if (aliasMapping.status === 'ambiguous') return { status: 'ambiguous' };
    if (aliasMapping.status === 'resolved' && aliasMapping.netid !== identity.netid) {
      const byHealedNetid = await resolveResearcherIdForPersonName('', {
        netid: aliasMapping.netid,
      });
      if (byHealedNetid.status === 'matched') return byHealedNetid;
    }
  }
  const name = identity.name || identity.emailAliasName || '';
  if (!name) return { status: 'absent' };
  return resolveResearcherIdForPersonName(name, {});
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
  facts: InferredPiLeadFacts,
): Promise<void> {
  const identity = await canonicalResearcherIdentity(facts.personId);
  await materializeCanonicalMembership(
    researchEntityId,
    {
      legacyRole: facts.legacyRole,
      displayName: identity.displayName,
      isCurrentMember: true,
      confidence: facts.confidence,
      startedAt: facts.startedAt,
      rosterProvenance: {
        sourceName: facts.sourceName || undefined,
        sourceUrl: facts.sourceUrl || undefined,
        observedAt: facts.observedAt,
      },
    },
    {
      netid: identity.netid,
      email: identity.email,
      orcid: identity.orcid,
      displayName: identity.displayName,
      hasCanonicalSourceReference: true,
    },
  );
}

const SCHOOL_INHERITANCE_LEAD_ROLES = ['PI', 'DIRECTOR'];

export const LEAD_PI_SCHOOL_INHERITANCE_SOURCE = 'lead-pi-school-inheritance';

const LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE = 0.6;

const LEAD_PI_INHERITED_FIELDS = ['school', 'departments'];

function isWriteScoped(
  writeOnlyFields: readonly string[] | undefined,
): writeOnlyFields is readonly string[] {
  return Boolean(writeOnlyFields && writeOnlyFields.length > 0);
}

function writeScopeAdmits(
  writeOnlyFields: readonly string[] | undefined,
  fields: readonly string[],
): boolean {
  if (!isWriteScoped(writeOnlyFields)) return true;
  const scope = withDerivedMaterializerFields(writeOnlyFields);
  return fields.some((field) => scope.includes(field));
}

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
  | 'has-school-and-department'
  | 'multi-pi-kind'
  | 'no-single-lead'
  | 'no-department'
  | 'no-school-derivable'
  | 'out-of-scope';

export interface LeadPiSchoolInheritanceResult {
  inherited: boolean;
  school?: string;
  departments?: string[];
  skipped?: LeadPiSchoolInheritanceSkip;
  /** Fields this pass asserted as observations, so the value survives a re-projection. */
  observed?: string[];
  observationSkipped?: 'source-not-registered' | 'observation-refused';
  indexSyncFailed?: true;
}

/**
 * Which of the two org-unit fields a row still needs from its lead. The lead
 * supplies both, so a row already carrying a school can still be missing the
 * department: `has-school` used to end the whole function, which left 241
 * student-ready rows out of the department facet even though their own PI's home
 * department was already stored (#2802).
 */
type LeadPiInheritanceScope = 'school-and-department' | 'department-only';

export function leadPiSchoolInheritanceGate(input: {
  manuallyLockedFields?: string[];
  school?: unknown;
  schools?: unknown;
  kind?: unknown;
  departments?: unknown;
}):
  | Extract<
      LeadPiSchoolInheritanceSkip,
      'locked' | 'has-school' | 'has-school-and-department' | 'multi-pi-kind'
    >
  | LeadPiInheritanceScope {
  const locked = input.manuallyLockedFields ?? [];
  if (locked.includes('school') || locked.includes('departments')) return 'locked';
  if (MULTI_PI_ORG_KINDS.has(textValue(input.kind).toLowerCase())) return 'multi-pi-kind';
  const existingSchools = Array.isArray(input.schools)
    ? (input.schools as unknown[]).map((value) => textValue(value)).filter(Boolean)
    : [];
  const hasSchool = Boolean(textValue(input.school)) || existingSchools.length > 0;
  const hasDepartment =
    Array.isArray(input.departments) &&
    (input.departments as unknown[]).map((value) => textValue(value)).filter(Boolean).length > 0;
  if (hasSchool && hasDepartment) return 'has-school-and-department';
  if (hasSchool) return 'department-only';
  return 'school-and-department';
}

type DepartmentValueTest = (value: unknown) => boolean;

async function departmentValueNamesADepartment(
  effectiveSchool: unknown,
): Promise<DepartmentValueTest> {
  const canonicalizer = await getOrgUnitCanonicalizer();
  const schoolKey =
    typeof effectiveSchool === 'string' && effectiveSchool.trim()
      ? canonicalizer.canonicalizeSchool(effectiveSchool).value.trim().toLocaleLowerCase()
      : '';
  return (value) =>
    canonicalizer
      .canonicalizeDepartments(value)
      .values.some((department) => department.toLocaleLowerCase() !== schoolKey);
}

async function canonicalLeadDepartment(rawDepartment: string): Promise<string | undefined> {
  const canonicalizer = await getOrgUnitCanonicalizer();
  const canonical = canonicalizer.canonicalizeDepartments([rawDepartment]);
  if (canonical.values.length !== 1 || canonical.unmatched.length > 0) return undefined;
  return canonical.values[0];
}

async function leadDepartmentWithParentSchool(
  rawDepartment: string,
): Promise<{ department: string; school: string } | undefined> {
  const canonicalizer = await getOrgUnitCanonicalizer();
  const canonical = canonicalizer.canonicalizeDepartments([rawDepartment]);
  if (canonical.values.length !== 1 || canonical.unmatched.length > 0) return undefined;
  const department = canonical.values[0];
  const school = canonicalizer.schoolForDepartment(department);
  return school ? { department, school } : undefined;
}

export async function inheritSchoolFromLeadPi(
  researchEntityId: string,
  options: {
    manuallyLockedFields?: string[];
    dryRun?: boolean;
    chunkPrefetch?: MaterializationReadSource;
    writeOnlyFields?: readonly string[];
  } = {},
): Promise<LeadPiSchoolInheritanceResult> {
  if (!writeScopeAdmits(options.writeOnlyFields, LEAD_PI_INHERITED_FIELDS)) {
    return { inherited: false, skipped: 'out-of-scope' };
  }
  const routedInheritanceRow = options.chunkPrefetch?.entityDocForId(
    'researchEntity',
    researchEntityId,
  );
  const entity = (
    routedInheritanceRow?.hit
      ? routedInheritanceRow.value
      : await ResearchEntity.findById(researchEntityId)
          .select('school departments schools kind entityType')
          .lean()
  ) as {
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
    departments: entity.departments,
  });
  if (gate !== 'school-and-department' && gate !== 'department-only') {
    return { inherited: false, skipped: gate };
  }

  const leadResearcherId = await resolveSingleLeadResearcherId(researchEntityId);
  if (!leadResearcherId) return { inherited: false, skipped: 'no-single-lead' };
  const rawDepartment = await leadResearcherDepartment(leadResearcherId);
  if (!rawDepartment) return { inherited: false, skipped: 'no-department' };
  const leadOrgUnit = await leadDepartmentWithParentSchool(rawDepartment);
  // Department-only inheritance needs the canonical department but not its parent
  // school, so an unmapped parent must not withhold the department the row is
  // actually missing.
  const canonicalDepartment =
    leadOrgUnit?.department ?? (await canonicalLeadDepartment(rawDepartment));
  if (gate === 'school-and-department' && !leadOrgUnit) {
    return { inherited: false, skipped: 'no-school-derivable' };
  }
  if (!canonicalDepartment) return { inherited: false, skipped: 'no-department' };

  const existingDepartments = Array.isArray(entity.departments)
    ? (entity.departments as unknown[]).map((value) => textValue(value)).filter(Boolean)
    : [];
  const set: Record<string, unknown> = {
    ...(gate === 'school-and-department' && leadOrgUnit ? { school: leadOrgUnit.school } : {}),
    ...(existingDepartments.length === 0 ? { departments: [canonicalDepartment] } : {}),
  };
  await applyResearchEntityOrgUnitCanonicalization(set, entity);
  if (gate === 'department-only') {
    // Canonicalization derives a parent school from the department it just set, so
    // it would rewrite the school this row already holds to the lead's own school -
    // a School of the Environment row becoming School of Medicine because its PI is
    // appointed in Genetics. The row's own school is the better evidence.
    delete set.school;
    delete set.schools;
  }
  const derivedSchool = textValue(set.school);
  if (gate === 'school-and-department' && !derivedSchool) {
    return { inherited: false, skipped: 'no-school-derivable' };
  }
  const departments = Array.isArray(set.departments)
    ? (set.departments as string[])
    : existingDepartments;
  if (departments.length === 0) return { inherited: false, skipped: 'no-department' };

  if (options.dryRun) {
    return { inherited: true, ...(derivedSchool ? { school: derivedSchool } : {}), departments };
  }

  const inheritedFields = [
    ...(derivedSchool ? ['school'] : []),
    ...(existingDepartments.length === 0 ? ['departments'] : []),
  ];
  const assertion = await assertLeadPiInheritanceObservations(researchEntityId, {
    ...(derivedSchool ? { school: derivedSchool } : {}),
    ...(existingDepartments.length === 0 ? { departments } : {}),
  });
  const evidence = await leadPiInheritanceEvidence(researchEntityId, {
    ...(derivedSchool ? { school: derivedSchool } : {}),
    ...(existingDepartments.length === 0 ? { departments } : {}),
  });
  if (inheritedFields.some((field) => !evidence.has(field))) {
    return {
      inherited: false,
      observationSkipped: assertion.observationSkipped ?? 'observation-refused',
    };
  }
  for (const [field, observation] of evidence) {
    set[`confidenceByField.${field}`] = LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE;
    set[`fieldProvenance.${field}`] = {
      sourceId: observation.sourceId,
      sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
      sourceUrl: observation.sourceUrl || '',
      observationId: observation._id,
      observedAt: observation.observedAt,
      confidence: LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE,
    };
  }
  await withResearchEntityWriteTransaction((session) =>
    ResearchEntity.updateOne({ _id: researchEntityId }, { $set: set }, { session }),
  );
  const fresh = await ResearchEntity.findById(researchEntityId).lean();
  const indexSynced = !!fresh && (await syncEntity('researchEntity', fresh));
  return {
    inherited: true,
    ...(derivedSchool ? { school: derivedSchool } : {}),
    departments,
    ...assertion,
    ...(indexSynced ? {} : { indexSyncFailed: true as const }),
  };
}

/**
 * The org unit the row's own single lead PI carries, with no gate.
 *
 * `leadPiSchoolInheritanceGate` skips a row that already states both fields, which is
 * every row a previous inheritance pass wrote. So re-running the lane cannot re-back
 * its own output, and re-backing needs the derivation without the gate in front of it.
 */
export async function rederiveLeadPiOrgUnit(
  researchEntityId: string,
): Promise<{ school?: string; department?: string }> {
  const leadResearcherId = await resolveSingleLeadResearcherId(researchEntityId);
  if (!leadResearcherId) return {};
  const rawDepartment = await leadResearcherDepartment(leadResearcherId);
  if (!rawDepartment) return {};
  const leadOrgUnit = await leadDepartmentWithParentSchool(rawDepartment);
  const department = leadOrgUnit?.department ?? (await canonicalLeadDepartment(rawDepartment));
  return {
    ...(leadOrgUnit?.school ? { school: leadOrgUnit.school } : {}),
    ...(department ? { department } : {}),
  };
}

interface LeadPiInheritanceObservation {
  _id: mongoose.Types.ObjectId;
  sourceId?: mongoose.Types.ObjectId;
  sourceUrl?: string;
  observedAt?: Date;
}

async function leadPiInheritanceEvidence(
  researchEntityId: string,
  values: { school?: string; departments?: string[] },
): Promise<Map<string, LeadPiInheritanceObservation>> {
  const evidence = new Map<string, LeadPiInheritanceObservation>();
  const fields = Object.keys(values);
  if (fields.length === 0) return evidence;
  const observations = await Observation.find({
    entityType: 'researchEntity',
    entityId: researchEntityId,
    sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
    field: { $in: fields },
    superseded: false,
  })
    .sort({ observedAt: -1 })
    .select('_id field value sourceId sourceUrl observedAt')
    .lean<Array<LeadPiInheritanceObservation & { field: string; value?: unknown }>>();
  for (const observation of observations) {
    if (evidence.has(observation.field)) continue;
    const asserted = values[observation.field as keyof typeof values];
    if (JSON.stringify(observation.value) !== JSON.stringify(asserted)) continue;
    evidence.set(observation.field, observation);
  }
  return evidence;
}

/**
 * Asserts the inherited org unit as evidence, so the value is reachable by a later
 * retraction instead of persisting because nothing clears it.
 *
 * The direct `$set` stays: `projectFromLog` builds its `$set` from the resolved map
 * only, so an observation appended here is not read until the NEXT projection and the
 * row would serve nothing in between.
 *
 * A missing Source row degrades to no write rather than throwing, because this runs
 * inside every materialize and an unseeded environment must not stop the projection;
 * writing the value anyway would author provenance no observation backs (#3769).
 */
export async function assertLeadPiInheritanceObservations(
  researchEntityId: string,
  values: { school?: string; departments?: string[] },
  deps: {
    getSource?: typeof getSourceByName;
    append?: typeof appendObservations;
  } = {},
): Promise<Pick<LeadPiSchoolInheritanceResult, 'observed' | 'observationSkipped'>> {
  const fields = Object.entries(values).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );
  if (fields.length === 0) return {};
  const source = await (deps.getSource ?? getSourceByName)(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
  if (!source) return { observationSkipped: 'source-not-registered' };
  const entity = (await ResearchEntity.findById(researchEntityId).select('slug').lean()) as {
    slug?: unknown;
  } | null;
  const entityKey = textValue(entity?.slug);
  if (!entityKey) return { observationSkipped: 'observation-refused' };
  const appended = await (deps.append ?? appendObservations)(
    fields.map(([field, value]) => ({
      entityType: 'researchEntity' as const,
      entityId: researchEntityId,
      entityKey,
      field,
      value,
      confidenceOverride: LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE,
    })),
    {
      sourceId: source._id,
      sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceWeight: LEAD_PI_SCHOOL_INHERITANCE_CONFIDENCE,
      dryRun: false,
    },
  );
  if (appended.inserted < fields.length) return { observationSkipped: 'observation-refused' };
  return { observed: fields.map(([field]) => field) };
}

export interface InferredDirectorMaterializationResult {
  written: boolean;
  promoted: boolean;
  removedDuplicates: number;
  userId?: string;
  role?: string;
  skipped?: 'no-observation' | 'unresolved-user' | 'name-mismatch';
}

/**
 * Promote a center's named director to a `director` member.
 *
 * Reads the entity-level `inferredDirector*` observations emitted by
 * `center-director-llm`, resolves the name (+ profile URL) to a UNIQUE canonical
 * Researcher, and upserts a lead member row. Resolution is required: an unresolved or
 * ambiguous name is skipped, never written, so a hallucinated leadership name
 * cannot mint a lead.
 *
 * The resolved person must also BE the person this run named. The director fields
 * supersede independently and two of them are emitted conditionally, so a run that
 * names a new director without a profile URL leaves the previous director's URL live
 * and unopposed - and that URL is the only key `findUniqueResearcherForRosterMember`
 * joins on. Without the name check the lane would write a lead whose `personId` is the
 * former director and whose `displayName` is the new one, silently and with no
 * conflict flag (#2668).
 *
 * Any pre-existing non-lead roster row for the same person
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
  const researcher =
    (await findUniqueResearcherForRosterMember(lookupFields)) ||
    (await findUniqueResearcherByObservedDirectorName(name));
  if (!researcher?._id) return { ...empty, skipped: 'unresolved-user' };

  const researcherId = idValue(researcher._id);
  const roleSource = fieldObs('inferredDirectorRole') || nameObs;
  const observedAt = roleSource.observedAt || new Date();
  const confidence = typeof roleSource.confidence === 'number' ? roleSource.confidence : 0.85;
  const sourceUrl = textValue(roleSource.sourceUrl);
  const sourceName = textValue(roleSource.sourceName);

  const directorResearcherId = researcherId;
  const directorEnrichment = await canonicalResearcherIdentity(researcherId);
  if (!observedPersonNameAgreesWith(directorEnrichment.displayName, textValue(name))) {
    return { ...empty, skipped: 'name-mismatch' };
  }
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
    archivedEntityUpdate(DEPT_ROSTER_SHELL_FOLD_ARCHIVE_REASON, {
      canonicalGroupId: canonicalId,
      lastObservedAt: now,
    }),
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

async function resolveRelationshipTarget(
  researchEntityModel: Pick<typeof ResearchEntity, 'findOne' | 'find' | 'findById'>,
  targetEntityKey: string,
): Promise<{
  canonicalFacultyResearchAreaTarget: { _id?: unknown } | null;
  target: { _id?: unknown; name?: unknown; slug?: string } | null;
  resolvedTarget: { _id?: unknown; slug?: unknown } | null;
}> {
  const canonicalFacultyResearchAreaTarget =
    (await findExistingResearchEntityByFacultyResearchAreaIdentity(researchEntityModel as any, {
      entityKey: targetEntityKey,
      entityType: 'FACULTY_RESEARCH_AREA',
    })) as { _id?: unknown } | null;
  const target = (await researchEntityModel
    .findOne({ slug: targetEntityKey, archived: { $ne: true } }, { _id: 1, name: 1, slug: 1 })
    .lean()) as { _id?: unknown; name?: unknown; slug?: string } | null;
  return {
    canonicalFacultyResearchAreaTarget,
    target,
    resolvedTarget: canonicalFacultyResearchAreaTarget || target,
  };
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
  const resolved = withResolvedFieldProvenance(
    resolveAllFields(resolverObs, { now: options.now ?? new Date() }),
    observations,
  );

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

  const { canonicalFacultyResearchAreaTarget, target, resolvedTarget } =
    await resolveRelationshipTarget(researchEntityModel, targetEntityKey);
  if (!resolvedTarget?._id) return skip('target-not-resolved');
  if (relationshipEndpointsAreSameEntity(source._id, resolvedTarget._id)) {
    return skip('self-relationship');
  }

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

  const sourceUrl = textValue(resolved.targetEntityKey?.sourceUrl);
  if (!canonicalFacultyResearchAreaTarget && target?._id) {
    await syncProfileBackedFacultyResearchAreaMemberFromIdentity(
      normalizeMaterializerObjectId(target._id) || '',
      {
        entityKey: targetEntityKey,
        name: target.name,
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrl,
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
  const confidence = Math.max(0, ...observations.map((o) => Number(o.confidence) || 0));
  const observedAt = latestObservationDate(observations);

  const update: Record<string, unknown> = {
    sourceResearchEntityId,
    targetResearchEntityId,
    relationshipType: resolvedRelationshipType,
    label,
    evidenceStrength,
    confidence: confidence || 0.7,
    archived: false,
    lastObservedAt: observedAt,
  };
  if (sourceUrl) update.sourceUrl = sourceUrl;

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
      { $set: attributedArchiveSet(SUPERSEDED_RELATIONSHIP_TYPE_ARCHIVE_REASON) },
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

/**
 * Namespaces whose `inferredPiUserKey` payload is a person-name slug rather than an
 * identifier. Only `dept:<unit>:<name>` was parsed as a name, so a `ysm:<name>` or
 * `bbs:<name>` key fell through to a netid lookup that cannot succeed: the payload is a
 * name, not a netid, and it is not an email alias either, so #2799's directory map does
 * not reach it. Measured on Development: 1,022 such keys, of a 120 sample 81 resolve to
 * exactly one researcher, 22 are ambiguous and 17 absent.
 *
 * `nih-pi:` is deliberately excluded. Those keys name grant PIs who may not hold a Yale
 * appointment at all, and 16 of the rows carrying them also raise
 * `grant_only_no_current_yale_source`.
 */
const NAME_SLUG_USER_KEY_PATTERN = /^(?:ysm|bbs|yse):(.+)$/i;

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

/**
 * A yale.edu `/people/` or `/profile/` page. Exported so a data operation selects the
 * same evidence the engine joins on rather than restating the predicate (#2325).
 */
export function officialUserProfileUrlsFromObservations(
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

// A record-specific application page (a CommunityForce FundDetails URL) is unique to one
// fund, and distinct funds share titles ("Summer Research Fellowship" at several colleges),
// so a same-title row that already cites a different fund's page is a different fund. On
// Development, matching on title alone would have folded 19 pairs of distinct funds into
// one row each, and the two funds would overwrite each other every run (#3984).
// A fund page that says to apply through a common application asserts that other fund's
// page as its applicationLink (#4216), so the page the observations were read from names
// the fund before the applicationLink does.
function observedRecordSpecificFundPage(obs: any[]): string {
  const readFromFundPage = obs.find(
    (o) => typeof o.sourceUrl === 'string' && recordSpecificApplicationPortalIdentity(o.sourceUrl),
  );
  if (readFromFundPage) return String(readFromFundPage.sourceUrl).trim();
  const applicationLink = obs.find(
    (o) => o.field === 'applicationLink' && typeof o.value === 'string',
  );
  return String(applicationLink?.value || '').trim();
}

function citesADifferentRecordSpecificApplication(candidate: any, obs: any[]): boolean {
  const observedFund = recordSpecificApplicationPortalIdentity(observedRecordSpecificFundPage(obs));
  const candidateFund = recordSpecificApplicationPortalIdentity(
    String(candidate?.applicationLink || '').trim(),
  );
  return Boolean(observedFund && candidateFund && observedFund !== candidateFund);
}

/**
 * Re-scrape dedupe: a fellowship whose title drifted slightly mints a new
 * sourceKey (title slug) and would otherwise create a duplicate record (#609).
 * When the exact sourceKey misses, resolve to an existing record whose
 * normalized title matches, category-agnostic. Candidates are limited to
 * records owned by the same source scraper, to legacy records with no
 * sourceName (the pre-scrape imports the catalog scraper should adopt rather
 * than clone), and to records an enrich-only source owns, so two distinct
 * owning producers never merge. The enrich-only exception is how the owning
 * lane reclaims a row an enrich-only source took over (#3984); it also lets any
 * lane adopt a row the enrich-only source legitimately owns, which is intended,
 * because such a source owns a row only while no other lane does. Prefers a
 * live record, then the most recently updated one.
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
    $or: [
      { sourceName },
      { sourceName: { $in: ['', null, ...ENRICH_ONLY_FELLOWSHIP_SOURCES] } },
      { sourceName: { $exists: false } },
    ],
  }).lean();
  const matches = candidates.filter(
    (candidate: any) =>
      normalizedProgramTitleKey(String(candidate.title || '')) === titleKey &&
      !citesADifferentRecordSpecificApplication(candidate, obs),
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
 * is read from its record-specific CommunityForce FundDetails URL, which is also
 * its applicationLink unless the page routes applications elsewhere (#4216). The same fund linked from a public fellowship page carries
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
  const applicationLink = observedRecordSpecificFundPage(obs);
  const fund = recordSpecificApplicationPortalIdentity(applicationLink);
  if (!fund) return null;

  const query = new URL(applicationLink).search.replace(/^\?/, '');
  const observingLane = observedOwningFellowshipLane(obs);
  const candidates = (
    await Model.find({
      applicationLink: new RegExp(`^https?://[^/?#]+[^?#]*\\?${escapeRegex(query)}$`, 'i'),
      archived: { $ne: true },
      ...(observingLane ? { sourceName: { $ne: observingLane } } : {}),
    })
      .limit(2)
      .lean()
  ).filter(
    (candidate: any) =>
      recordSpecificApplicationPortalIdentity(String(candidate.applicationLink || '').trim()) ===
      fund,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

// An owning lane finds its own rows by sourceKey, title and page, so a row it already owns
// that shares this application link is a different program admitted through the same
// application, not this record (#3988). The enrich-only catalog owns no row in that sense.
function observedOwningFellowshipLane(obs: any[]): string | null {
  const sourceName = obs.find((o) => o.field === 'sourceName' && typeof o.value === 'string')
    ?.value as string | undefined;
  return sourceName && !ENRICH_ONLY_FELLOWSHIP_SOURCES.has(sourceName) ? sourceName : null;
}

async function findEntityDocByIdentifier(
  Model: mongoose.Model<any>,
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  obs: any[],
  prefetch?: MaterializationReadSource,
): Promise<any | null> {
  const entityId = normalizeMaterializerObjectId(identifier.entityId);
  if (entityId) {
    const prefetched = prefetch?.entityDocForId(entityType, entityId);
    if (prefetched?.hit) return prefetched.value;
    return Model.findById(entityId).lean();
  }

  if (!identifier.entityKey) return null;

  const keyField = uniqueKeyFieldForIdentifier(entityType, identifier.entityKey);
  if (!keyField) throw new Error(`No keyField for entityType=${entityType}`);

  const keyValue = uniqueKeyValueForIdentifier(entityType, identifier.entityKey, obs);
  if (!keyValue) return null;

  const prefetched = prefetch?.entityDocForKey(entityType, keyValue);
  if (prefetched?.hit) return prefetched.value;
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
  prefetch?: MaterializationReadSource,
): Promise<any[]> {
  const entityIdObjectId = toMaterializerObjectId(entityId);
  if (!entityIdObjectId) return [];
  const alreadyIncluded = new Set(
    entityKeyScopedObservations.map((observation) => String(observation._id)),
  );
  const prefetched = prefetch?.observationsForId(entityType, entityIdObjectId);
  const entityIdMatches = prefetched?.hit
    ? (prefetched.value as any[])
    : await Observation.find({
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
  prefetch?: MaterializationReadSource,
): Promise<any[]> {
  if (!entityKey) return [];
  const entityIdObjectId = toMaterializerObjectId(entityId);
  const alreadyIncluded = new Set(
    entityIdScopedObservations.map((observation) => String(observation._id)),
  );
  const prefetched = prefetch?.observationsForKey(entityType, entityKey);
  const entityKeyMatches = prefetched?.hit
    ? (prefetched.value as any[])
    : await Observation.find({
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

// A merged-in row's evidence enriches the survivor but never re-states who the
// survivor is: its name, type, lead and visibility are the survivor's own, so a
// loser's identity observations would re-open the merge decision on every resolve.
const SURVIVOR_OWNED_RESEARCH_ENTITY_FIELDS = new Set([
  'name',
  'slug',
  'displayName',
  'entityType',
  'kind',
  'archived',
  'school',
  'sourceCategory',
  'affiliatedNames',
  'lead',
  'leadVerification',
  'officialProfileLeadEvidence',
  'inferredPiUserKey',
  'inferredPiUserId',
  'inferredDirectorName',
  'inferredDirectorUserName',
  'inferredDirectorRole',
  'inferredDirectorTitle',
  'inferredDirectorProfileUrl',
  'studentVisibilityTier',
  'studentVisibilityOverrideTier',
  'studentVisibilitySuppressionReason',
  'studentVisibilityReviewNote',
]);

// These lanes fork a lab identity (`name`, `kind`, `entityType`, `websiteUrl`) on
// one profile link, so once one of them has typed the survivor from the survivor's
// own key its website is part of that decision. A loser's website would otherwise
// serve a lab address under a type the survivor's own lane chose because it found
// no lab (#3585). Adding a lane here also requires it to emit `entityType` and
// `websiteUrl` from the same link, which `skills/scrapers/SKILL.md` records.
export const LAB_IDENTITY_DECIDING_SOURCES: ReadonlySet<string> = new Set([
  'yse-faculty-directory',
  'ysm-faculty-directory',
  'dept-faculty-roster',
]);

const LAB_IDENTITY_WEBSITE_FIELDS: ReadonlySet<string> = new Set(['websiteUrl', 'website']);

// Mirrors the merge plan's `trustedAreaShellEntities` guard (#604, #3330): an area
// or funding shell's topics and prose must not graft onto a real research row.
const LOW_TRUST_SHELL_GUARDED_RESEARCH_ENTITY_FIELDS = new Set([
  'researchAreas',
  'fullDescription',
  'shortDescription',
  'description',
]);

// The card and the body are one statement, so a loser card beside the survivor's own
// body would serve a summary of a different page.
const MERGED_SURVIVOR_PROSE_FIELDS = new Set([
  'description',
  'shortDescription',
  'fullDescription',
]);

// A stored `false` or `0` is also the schema default, so only provenance shows it was observed.
function storedFieldHasValue(value: unknown, hasProvenance: boolean): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return hasProvenance && Number.isFinite(value);
  if (typeof value === 'boolean') return value || hasProvenance;
  return false;
}

export interface MergedSurvivorEvidence {
  observations: any[];
  mergedInKeys: string[];
  mergedInRows: Array<Pick<MergedInResearchEntityRow, '_id' | 'slug'>>;
  evidenceObservations: any[];
  survivorLaneOwnsWebsite: boolean;
  droppedLoserWebsiteValues: unknown[];
  loserRosterAppointments: any[];
}

/**
 * The merged-survivor candidate read, answered from the frozen read source when it can answer
 * every key and id, and from the corpus otherwise.
 *
 * Composed per key and per id rather than issued as one `$or` query, because that is the shape
 * the read source speaks. All-or-nothing on purpose: a partial answer would silently mix frozen
 * evidence with live evidence, which is worse than reading live and saying so. A frozen source
 * records each key it cannot answer, which is how the benchmark learns its input is incomplete
 * instead of reporting a fully frozen input it does not have (#3849).
 */
function routedObservationsForKeysAndIds(
  entityType: ObservedEntityType,
  keys: readonly string[],
  ids: readonly unknown[],
  prefetch?: MaterializationReadSource,
): any[] | undefined {
  if (!prefetch) return undefined;
  const answered: any[] = [];
  let complete = true;
  for (const key of keys) {
    const hit = prefetch.observationsForKey(entityType, key);
    if (hit.hit) answered.push(...(hit.value as any[]));
    else complete = false;
  }
  for (const id of ids) {
    const hit = prefetch.observationsForId(entityType, id);
    if (hit.hit) answered.push(...(hit.value as any[]));
    else complete = false;
  }
  if (!complete) return undefined;
  const byId = new Map<string, any>();
  for (const observation of answered) byId.set(String(observation._id), observation);
  return [...byId.values()];
}

/**
 * Resolves a live survivor over its own observations plus those of every row whose
 * tombstone chain reaches it (#3560), so a survivor-key and a loser-key materialize
 * read the same evidence set. Evidence is not re-keyed; each observation keeps the
 * trust of the row that emitted it.
 */
export async function mergedSurvivorEvidence(
  entityType: ObservedEntityType,
  survivor: { _id?: unknown; slug?: unknown; [field: string]: unknown },
  loadedObservations: any[],
  prefetch?: MaterializationReadSource,
): Promise<MergedSurvivorEvidence> {
  const survivorId = toMaterializerObjectId(survivor._id);
  const unmerged = {
    observations: loadedObservations,
    mergedInKeys: [],
    mergedInRows: [],
    evidenceObservations: loadedObservations,
    survivorLaneOwnsWebsite: false,
    droppedLoserWebsiteValues: [],
    loserRosterAppointments: [],
  };
  if (!survivorId) return unmerged;
  if (prefetch?.hasNoMergedInRows(survivorId)) return unmerged;
  const mergedInRows = await listResearchEntityMergedInRows(survivorId);
  if (mergedInRows.length === 0) return unmerged;

  const survivorSlug = textValue(survivor.slug);
  const loserSlugById = new Map(mergedInRows.map((row) => [String(row._id), textValue(row.slug)]));
  const loserSlugs = new Set([...loserSlugById.values()].filter(Boolean));
  const allowedEntityIds = new Set([String(survivorId), ...loserSlugById.keys()]);

  const alreadyIncluded = new Set(loadedObservations.map((observation) => String(observation._id)));
  const candidateKeys = [survivorSlug, ...loserSlugs].filter(Boolean);
  const candidateIds = mergedInRows.map((row) => row._id);
  const candidates =
    routedObservationsForKeysAndIds(entityType, candidateKeys, candidateIds, prefetch) ??
    (await Observation.find({
      entityType,
      ...materializationReadScopeFilter(),
      $or: [{ entityKey: { $in: candidateKeys } }, { entityId: { $in: candidateIds } }],
    }).lean());
  const added = candidates.filter(
    (observation: any) =>
      !alreadyIncluded.has(String(observation._id)) &&
      (!observation.entityId || allowedEntityIds.has(String(observation.entityId))),
  );
  const { kept } = partitionObservationsByInvalidatedRun(added, await invalidatedScrapeRunIds());

  const loserOrigin = (observation: any): { slug: string } | undefined => {
    const entityId = observation.entityId ? String(observation.entityId) : '';
    if (entityId && loserSlugById.has(entityId)) return { slug: loserSlugById.get(entityId) || '' };
    if (entityId === String(survivorId)) return undefined;
    const entityKey = textValue(observation.entityKey);
    if (entityKey && entityKey !== survivorSlug && loserSlugs.has(entityKey)) {
      return { slug: entityKey };
    }
    return undefined;
  };
  const survivorIsLowTrustShell = isLowTrustAreaShellSlug(survivorSlug);
  // A locked type or a refused value means an operator, not the lane, decided who
  // this row is, so the lane has no claim on the website either.
  const survivorTypeIsLocked =
    Array.isArray(survivor.manuallyLockedFields) &&
    survivor.manuallyLockedFields.includes('entityType');
  const survivorOwnsItsWebsite =
    !survivorTypeIsLocked &&
    [...loadedObservations, ...kept].some(
      (observation: any) =>
        !loserOrigin(observation) &&
        observation.field === 'entityType' &&
        LAB_IDENTITY_DECIDING_SOURCES.has(String(observation.sourceName || '')) &&
        Boolean(textValue(observation.value)) &&
        !valueIsRefused(survivor.fieldValueRefusals, 'entityType', observation.value),
    );
  // The resolver breaks an exact weight tie by array order, so the union is put in
  // one fixed order rather than the entry key's own observations first.
  const entryPointIndependentOrder = [...loadedObservations, ...kept].sort((a: any, b: any) =>
    String(a._id).localeCompare(String(b._id)),
  );
  // A loser's observation is another page's statement about another row, so it may
  // fill an empty field the survivor has no evidence for but never displace what the
  // survivor holds: in one ranking a newer same-source loser row collapses the
  // survivor's away, a higher-confidence loser source wins outright, and a loser's
  // school-level roster label sanitizes a stored department to nothing (#3581).
  // A stored value a loser observation backs is that loser's own fill, not the
  // survivor's, so it stays open to later observations from the same loser only: a
  // survivor merged from several same-source rosters otherwise swaps a primary
  // department for a secondary program whenever a different roster is read last.
  // A field cleared when no evidence reaches it is gated on observations only, since
  // gating it on its own stored fill would clear it on one resolve and refill it on
  // the next.
  // A school or campus label in the departments slot names no department, so it
  // cannot hold the field against a loser's real one (#3610).
  const namesADepartment = await departmentValueNamesADepartment(survivor.school);
  const holdsNoDepartment = (observation: any): boolean =>
    observation.field === 'departments' && !namesADepartment(observation.value);
  const survivorHeldFields = new Set(
    entryPointIndependentOrder
      .filter((observation: any) => !loserOrigin(observation) && !holdsNoDepartment(observation))
      .map((observation: any) => String(observation.field || '')),
  );
  const storedSurvivor =
    typeof (survivor as { toObject?: unknown }).toObject === 'function'
      ? (
          survivor as unknown as {
            toObject: (options: { flattenMaps: boolean }) => Record<string, unknown>;
          }
        ).toObject({ flattenMaps: true })
      : survivor;
  const storedProvenance = objectRecord(storedSurvivor.fieldProvenance);
  const provenanceObservationId = (field: string) =>
    String(objectRecord(storedProvenance[field]).observationId ?? '');
  const provenanceObservationIds = Object.keys(storedProvenance)
    .map(provenanceObservationId)
    .filter((id) => mongoose.isValidObjectId(id));
  const backingLoserSlugByObservationId = new Map<string, string>();
  if (provenanceObservationIds.length > 0) {
    // A provenance id names an observation this survivor or one of its losers wrote, so the
    // candidate read above has almost always already loaded it. Resolving from that set first
    // removes a query on the common path and keeps the read inside whatever answered it, frozen
    // or live; only ids it does not hold are asked for (#3849).
    const inHandById = new Map<string, any>();
    for (const observation of [...loadedObservations, ...candidates] as any[]) {
      inHandById.set(String(observation._id), observation);
    }
    const missingIds = provenanceObservationIds.filter((id) => !inHandById.has(id));
    const provenanceObservations = [
      ...provenanceObservationIds.map((id) => inHandById.get(id)).filter(Boolean),
      ...(missingIds.length > 0
        ? await Observation.find({ _id: { $in: missingIds } })
            .select('_id entityId entityKey')
            .lean()
        : []),
    ];
    for (const observation of provenanceObservations as any[]) {
      const loser = loserOrigin(observation);
      if (loser) backingLoserSlugByObservationId.set(String(observation._id), loser.slug);
    }
  }
  const backingLoserSlugByField = new Map<string, string>();
  for (const [field, value] of Object.entries(storedSurvivor)) {
    if (CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS.includes(field)) continue;
    const backingLoserSlug = backingLoserSlugByObservationId.get(provenanceObservationId(field));
    if (backingLoserSlug !== undefined) {
      backingLoserSlugByField.set(field, backingLoserSlug);
      continue;
    }
    if (storedFieldHasValue(value, storedProvenance[field] !== undefined)) {
      survivorHeldFields.add(field);
    }
  }
  const proseBackingLoserSlug = [...MERGED_SURVIVOR_PROSE_FIELDS]
    .map((proseField) => backingLoserSlugByField.get(proseField))
    .find((slug) => slug !== undefined);
  const isRosterAppointment = (observation: any): boolean =>
    observation.field === 'departments' &&
    observation.sourceName === DEPARTMENT_ROSTER_APPOINTMENT_SOURCE &&
    namesADepartment(observation.value);
  const survivorReadOnARoster = entryPointIndependentOrder.some(
    (observation: any) => !loserOrigin(observation) && isRosterAppointment(observation),
  );
  const droppedLoserWebsiteValues: unknown[] = [];
  const loserRosterAppointments: any[] = [];
  const observations = entryPointIndependentOrder.filter((observation: any) => {
    const loser = loserOrigin(observation);
    if (!loser) return true;
    const field = String(observation.field || '');
    if (survivorReadOnARoster && isRosterAppointment(observation)) {
      loserRosterAppointments.push(observation);
      return false;
    }
    if (SURVIVOR_OWNED_RESEARCH_ENTITY_FIELDS.has(field)) return false;
    if (survivorOwnsItsWebsite && LAB_IDENTITY_WEBSITE_FIELDS.has(field)) {
      droppedLoserWebsiteValues.push(observation.value);
      return false;
    }
    if (survivorHeldFields.has(field) && !RESEARCH_ENTITY_GRANT_EVIDENCE_FIELDS.has(field)) {
      return false;
    }
    if (
      MERGED_SURVIVOR_PROSE_FIELDS.has(field) &&
      [...MERGED_SURVIVOR_PROSE_FIELDS].some((proseField) => survivorHeldFields.has(proseField))
    ) {
      return false;
    }
    const backingLoserSlug = MERGED_SURVIVOR_PROSE_FIELDS.has(field)
      ? proseBackingLoserSlug
      : backingLoserSlugByField.get(field);
    if (
      backingLoserSlug !== undefined &&
      backingLoserSlug !== loser.slug &&
      !RESEARCH_ENTITY_GRANT_EVIDENCE_FIELDS.has(field)
    ) {
      return false;
    }
    return !(
      !survivorIsLowTrustShell &&
      isLowTrustAreaShellSlug(loser.slug) &&
      LOW_TRUST_SHELL_GUARDED_RESEARCH_ENTITY_FIELDS.has(field)
    );
  });

  const survivorStatedWebsites = websiteIdentitiesStatedBy(
    observations.filter((observation: any) => !loserOrigin(observation)),
  );
  return {
    observations,
    mergedInKeys: [...loserSlugById.keys(), ...loserSlugs],
    mergedInRows: mergedInRows.map((row) => ({ _id: row._id, slug: row.slug })),
    evidenceObservations: [...loadedObservations, ...kept],
    survivorLaneOwnsWebsite: survivorOwnsItsWebsite,
    droppedLoserWebsiteValues: droppedLoserWebsiteValues.filter(
      (value) => !survivorStatedWebsites.has(websiteIdentity(value)),
    ),
    loserRosterAppointments,
  };
}

async function observationsMergedIntoLiveSurvivor(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  prefetch?: MaterializationReadSource,
): Promise<any[]> {
  const entityId = toMaterializerObjectId(identifier.entityId);
  const lookup = entityId
    ? { _id: entityId }
    : identifier.entityKey
      ? { slug: identifier.entityKey }
      : null;
  if (!lookup) return [];
  const routedSurvivor =
    typeof (lookup as { slug?: unknown }).slug === 'string'
      ? prefetch?.liveEntityDocForKey(entityType, String((lookup as { slug: string }).slug))
      : prefetch?.liveEntityDocForId(entityType, (lookup as { _id?: unknown })._id);
  const survivor = (
    routedSurvivor?.hit
      ? routedSurvivor.value
      : await ResearchEntity.findOne({ ...lookup, archived: { $ne: true } })
          .select('_id slug fieldValueRefusals manuallyLockedFields')
          .lean()
  ) as Parameters<typeof mergedSurvivorEvidence>[1] | null;
  if (!survivor) return [];
  return (await mergedSurvivorEvidence(entityType, survivor, [])).observations;
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
 * Compared with `.toLowerCase()` on both sides, so `Https://WWW.Host/Path/` and
 * `https://host/path` are one identity. Query and fragment are dropped: a Yale
 * person page serves the same person with or without a tracking parameter.
 */
function officialProfileIdentityUrlKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '').toLowerCase();
    return pathname ? `${host}${pathname}` : '';
  } catch {
    return '';
  }
}

const OFFICIAL_PROFILE_URL_JOIN_CANDIDATE_LIMIT = 10;

// The stored link is matched on the identity key rather than the literal string, so a
// scheme, a `www.` label, a trailing slash or a tracking query does not hide a researcher
// who already carries the same page.
const officialProfileUrlStoredPatterns = (identityKeys: readonly string[]): RegExp[] =>
  identityKeys.map(
    (identityKey) =>
      new RegExp(`^https?://(?:www\\.)?${escapeRegex(identityKey)}/*(?:[?#].*)?$`, 'i'),
  );

const researcherOfficialProfileIdentityKeys = (researcher: any): string[] =>
  (Array.isArray(researcher?.profileLinks) ? researcher.profileLinks : [])
    .filter((link: ResearcherProfileLink) => link?.kind === 'YALE_OFFICIAL')
    .map((link: ResearcherProfileLink) => officialProfileIdentityUrlKey(link.url));

const OFFICIAL_PROFILE_URL_CLAIMANTS_LIMIT = 200;

async function liveResearchersClaimingOfficialProfileUrls(
  observedUrls: string[],
): Promise<Map<string, any[]>> {
  const identityKeys = uniqueStrings(observedUrls.map(officialProfileIdentityUrlKey));
  const claimantsByKey = new Map<string, any[]>();
  if (identityKeys.length === 0) return claimantsByKey;
  const candidates: any[] = await Researcher.find({
    archived: { $ne: true },
    profileLinks: {
      $elemMatch: {
        kind: 'YALE_OFFICIAL',
        url: { $in: officialProfileUrlStoredPatterns(identityKeys) },
      },
    },
  })
    .select('_id displayName profileLinks')
    .limit(OFFICIAL_PROFILE_URL_CLAIMANTS_LIMIT)
    .lean();
  for (const candidate of candidates) {
    for (const key of new Set(researcherOfficialProfileIdentityKeys(candidate))) {
      if (!identityKeys.includes(key)) continue;
      claimantsByKey.set(key, [...(claimantsByKey.get(key) ?? []), candidate]);
    }
  }
  return claimantsByKey;
}

/**
 * A `yale.edu/people/…` or `yale.edu/profile/…` page belongs to one person, so a
 * live researcher already carrying it as a `YALE_OFFICIAL` link is a per-person join
 * key rather than a name guess. Only `YALE_OFFICIAL` counts: `LAB_ABOUT` names a lab
 * a whole group shares (#2946) and `profile.websiteUrl` can hold the same borrowed
 * lab URL (#2719), so neither identifies an individual.
 *
 * Fails closed unless exactly one live researcher claims the URL. 17 of these URLs on
 * Development are carried by more than one researcher, and picking either would graft
 * one person's evidence onto the other.
 */
async function soleLiveResearcherClaimingOfficialProfileUrl(
  observedUrls: string[],
): Promise<any | undefined> {
  const identityKeys = uniqueStrings(observedUrls.map(officialProfileIdentityUrlKey));
  if (identityKeys.length === 0) return undefined;
  const storedUrlPatterns = officialProfileUrlStoredPatterns(identityKeys);
  const candidates: any[] = await Researcher.find({
    archived: { $ne: true },
    profileLinks: {
      $elemMatch: {
        kind: 'YALE_OFFICIAL',
        url: { $in: storedUrlPatterns },
      },
    },
  })
    .limit(OFFICIAL_PROFILE_URL_JOIN_CANDIDATE_LIMIT)
    .lean();
  const claiming = candidates.filter((candidate) =>
    (Array.isArray(candidate.profileLinks) ? candidate.profileLinks : []).some(
      (link: ResearcherProfileLink) =>
        link?.kind === 'YALE_OFFICIAL' &&
        identityKeys.includes(officialProfileIdentityUrlKey(link.url)),
    ),
  );
  return claiming.length === 1 ? claiming[0] : undefined;
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

/**
 * The researcher projection's write gate for display profile text. It carries the
 * invisible-format-character strip as well as the schema length bound, because this
 * path resolves observation values itself instead of going through
 * `sanitizeProjectedField`, so nothing else on it would normalize a scraped title
 * (#2874).
 */
function normalizedResearcherProfileText(
  key: keyof ResearcherDisplayProfile,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = stripInvisibleFormatCharacters(value);
  if (!normalized) return undefined;
  const bound = researcherDisplayProfileSchema.path(key).options.maxlength;
  if (typeof bound !== 'number' || normalized.length <= bound) return normalized;
  return normalized.slice(0, bound).trim() || undefined;
}

/**
 * A folded dept-roster shell is archived without superseding its observations
 * (`foldDeptRosterShellIntoCanonicalResearchEntity`), so a live `inferredPiUserKey` can
 * outlive the entity that asserted it. The lead materializer already requires a live
 * entity (`inferredPiLeadReclaim`), and minting a person on a dead entity's word would
 * create a record no entity can ever use.
 */
async function liveResearchEntityNamesUserKeyAsLead(userEntityKey: string): Promise<boolean> {
  const attributions = (await Observation.find(
    { field: 'inferredPiUserKey', value: userEntityKey, superseded: false },
    { entityKey: 1, entityId: 1 },
  ).lean()) as Array<{ entityKey?: unknown; entityId?: unknown }>;
  const slugs = uniqueStrings(attributions.map((attribution) => attribution.entityKey));
  const entityIds = attributions
    .map((attribution) => normalizeMaterializerObjectId(attribution.entityId))
    .filter((entityId): entityId is string => Boolean(entityId));
  const namingEntity: Array<Record<string, unknown>> = [];
  if (slugs.length > 0) namingEntity.push({ slug: { $in: slugs } });
  if (entityIds.length > 0) namingEntity.push({ _id: { $in: entityIds } });
  if (namingEntity.length === 0) return false;
  return Boolean(await ResearchEntity.exists({ archived: { $ne: true }, $or: namingEntity }));
}

async function materializeUserIdentityToResearcher(
  identifier: { entityId?: string; entityKey?: string },
  obs: any[],
  options: MaterializeOptions = {},
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
  const resolved = resolveAllFields(resolverObs, { now: options.now ?? new Date() });
  const resolvedValue = (field: string): unknown => resolved[field]?.value;

  const netid =
    normalizedAccountNetid(uniqueKeyValueForIdentifier('user', identifier.entityKey, obs)) ??
    normalizedAccountNetid(resolvedValue('netid'));
  // Normalized before the name resolver reads it, not just before it is stored: an
  // invisible format character inside a surname makes the person match nobody (#2874).
  const displayName = stripInvisibleFormatCharacters(
    textValue(resolvedValue('displayName')) ||
      [textValue(resolvedValue('fname')), textValue(resolvedValue('lname'))]
        .filter(Boolean)
        .join(' ')
        .trim(),
  );
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
  let identityJoin: UserIdentityJoin | undefined = researcher ? 'account-netid' : undefined;
  let personNameStatus: ResearcherPersonNameResolutionStatus | undefined;
  if (!researcher && displayName) {
    const resolution = await resolveResearcherIdForPersonName(displayName, {
      netid: accountNetid ?? netid,
    });
    personNameStatus = resolution.status;
    if (resolution.status === 'matched' && resolution.researcherId) {
      researcher = await Researcher.findById(resolution.researcherId);
      if (researcher) identityJoin = 'person-name';
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
      identityJoin = 'account-email';
    }
  }
  /**
   * Most people this materializer sees have no Account at all - accounts are created
   * only at login - so neither the netid lookup nor the email join can reach them, and
   * resolution falls to the name. On Development the name resolver then returns
   * `ambiguous` for 2,062 of the 5,053 keys it cannot resolve: the corpus holds
   * same-surname candidates and correctly refuses to guess. #2927 measured what
   * loosening the comparator costs and closed as disproven, so the tie is broken with a
   * per-person identifier instead of a looser name.
   *
   * A `yale.edu/people/…` or `/profile/…` page is that identifier. It belongs to one
   * person, and a researcher already carrying it as a `YALE_OFFICIAL` link is usually
   * the same person reached earlier under a different entityKey, whose alias key strands
   * the rest of the evidence (#2831). Joining on the page recovers 54 keys, 48 of them
   * ties the name resolver refused.
   *
   * Like the email join it runs last and fills only, and carries its own name check
   * because no name resolver sits behind it: a stored link can be borrowed (#2719), and
   * a borrowed page plus no name check is the #2768 graft. The check refuses 113 keys
   * whose observed name contradicts the page's owner.
   */
  let identityJoinedOnOfficialProfileUrlAlone = false;
  if (!researcher && displayName) {
    const urlResearcher = await soleLiveResearcherClaimingOfficialProfileUrl(
      officialUserProfileUrlsFromObservations(materializationObs),
    );
    if (urlResearcher && observedPersonNameAgreesWith(urlResearcher.displayName, displayName)) {
      researcher = await Researcher.findById(urlResearcher._id);
      identityJoinedOnOfficialProfileUrlAlone = Boolean(researcher);
      if (researcher) identityJoin = 'official-profile-page';
    }
  }
  const accountId: mongoose.Types.ObjectId | undefined = account?._id;

  // #2129 refuses to mint a person from a bare directory identity, and that stays.
  // A person the corpus already names as the lead of a research entity is not a bare
  // directory identity: the attribution IS the research signal the refusal is looking
  // for. Measured on Development: 655 entities are held from students on missing_lead,
  // 624 carry an `inferredPiUserKey`, and 596 of those keys reach nobody even though
  // 139 of a 150 sample already have a `user` observation naming that person (#2773).
  //
  // The signal is an EXACT key match, never a name match: `inferredPiUserKey` values
  // and `user` entityKeys share one namespaced grammar, and 3,316 of 5,501 PI keys
  // match a user entityKey outright. #2767 refused scattered-token name matching after
  // two wrong-person joins, so this path does not guess at names.
  //
  // Three conditions keep the mint from adding records nobody can use:
  //   - Only `absent` may mint. `ambiguous` means the corpus already holds same-name
  //     candidates, so minting would add one more, and `dedupeAccountlessResearcherShells`
  //     cannot heal equal-tier same-name shells: every later pass would stay ambiguous
  //     and mint again, while raising ambiguity for every other lane that resolves names.
  //   - Only a key that ASSERTS an identity may mint, which is the `dept:<ns>:<slug>` shape
  //     `materializeInferredPiMembership` derives a name from, or an alias the directory
  //     maps to a real netid. #2763 lets the lead resolver read a `netid:<first>.<last>`
  //     payload as a name too, but that name is implied rather than asserted, so minting on
  //     it would let a misspelled alias invent a person; an unmapped alias-shaped key can
  //     also stamp neither a netid nor an account (see `accountNetidForResearcherLink`;
  //     accounts are created only at login), leaving an orphan person and the entity still
  //     on `missing_lead`.
  //   - Only a live entity's attribution may mint (`liveResearchEntityNamesUserKeyAsLead`).
  let mintedFromPiAttribution = false;
  if (!researcher) {
    const attributionKey = textValue(identifier.entityKey);
    const keyIdentity = inferredPiUserKeyIdentity(attributionKey);
    // #2776 allowed a mint only for a `dept:<ns>:<name>` key, because
    // `materializeInferredPiMembership` could resolve back to nothing else: an alias-shaped
    // key resolves through `identifiers.netid` or an Account, and the mint could stamp
    // neither. #2799 removes that constraint for an alias the directory maps to a real
    // netid, since the mint can then stamp the person's own netid and the lead materializer
    // resolves back to this record.
    const resolvedNetid = keyIdentity.netid
      ? await netidForRosterEmailAlias(keyIdentity.netid)
      : undefined;
    const resolvableBack = Boolean(keyIdentity.name) || Boolean(resolvedNetid);
    const namedAsLead =
      Boolean(displayName) &&
      personNameStatus === 'absent' &&
      resolvableBack &&
      (await liveResearchEntityNamesUserKeyAsLead(attributionKey));
    if (!namedAsLead) {
      return skipped('directory-identity-without-research-signal');
    }
    // A netid another researcher already holds aborts the mint on the unique
    // `identifiers.netid` index (#2810 measured 5 such failures per apply run), so it fails
    // closed here instead. The claimant is not adopted: this path runs only when the name
    // resolver reached nobody, and it excludes archived records while the index does not, so
    // the reachable claimant is one the name resolver deliberately passed over. #2767 refused
    // scattered-token name matching after two wrong-person joins, and adopting a record on a
    // netid the resolver would not follow is the same graft by another route.
    if (resolvedNetid && (await Researcher.exists({ 'identifiers.netid': resolvedNetid }))) {
      return skipped('resolved-netid-already-claimed');
    }
    if (options.dryRun) {
      return skipped('dry-run-would-mint-researcher');
    }
    researcher = new Researcher({
      displayName,
      ...(accountId ? { accountId } : {}),
      // Stamped from the directory's own observation of this person's netid, never from the
      // alias itself, so the alias is not promoted to a join key (`research-model.md:36`).
      ...(resolvedNetid ? { identifiers: { netid: resolvedNetid } } : {}),
      status: 'UNKNOWN',
      archived: false,
    });
    mintedFromPiAttribution = true;
    identityJoin = 'minted-from-pi-attribution';
  }
  const created = mintedFromPiAttribution;

  let fieldsWritten = 0;
  // An email-only or profile-URL-only join enriches the profile but never renames the
  // researcher: the address and the page vouched for which person this is, not for what
  // that person is called. Both joins already required the names to agree, so a rename
  // here could only swap one accepted spelling of the same person for another.
  const identityJoinedWithoutANameResolver =
    identityJoinedOnEmailAlone || identityJoinedOnOfficialProfileUrlAlone;
  if (
    !identityJoinedWithoutANameResolver &&
    displayName &&
    researcher.displayName !== displayName
  ) {
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
    const bounded = normalizedResearcherProfileText(key, value);
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
  } else if (!netidToStamp && priorNetid && priorNetid.includes(':')) {
    // #2810: 192 researchers were stamped `netid:<alias>`, the observation key rather than the
    // netid inside it, and every `identifiers.netid` lookup reads a bare netid, so the key
    // matched nobody. A netid never contains a colon, so the malformed value is re-resolved
    // through the alias it carries and dropped when that resolves to nothing. Healing here
    // rather than in a repair script means any later pass over the record corrects it, and
    // these records carry no account, so nothing else would ever restamp them.
    const healedNetid = await netidForRosterEmailAlias(
      userLookupValueForInferredPiUserKey(priorNetid),
    );
    researcher.set('identifiers.netid', healedNetid);
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

  // Every other materializer arm returns its plan here rather than writing, and this
  // one did not: `dryRun` was honoured only on the mint branch above, so a resolved
  // researcher's profile, identifiers and profileLinks were saved on a dry run. That
  // defeated `observations:materialize-pi-attributed-users`, whose default IS dry run
  // and whose `assertScriptApplyAllowed` guard is skipped unless `--apply` is passed,
  // so its "enriched" rows had already been written before an operator saw them.
  if (options.dryRun) {
    return {
      entityType: 'user',
      entityId: materializerDocumentId(researcher._id),
      entityKey: identifier.entityKey,
      fieldsWritten,
      conflicts,
      created,
      resolved,
      ...(identityJoin ? { identityJoin } : {}),
    };
  }

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
    ...(identityJoin ? { identityJoin } : {}),
  };
}

/**
 * The two corpus facts the name-authority guard cannot derive from the record in
 * front of it: whether an eponym is anybody's surname, and whether that somebody
 * is this record's own lead. Required rather than optional, so a caller that
 * cannot reach either has to say so with `NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY`
 * instead of selecting the weaker judgement by omitting an argument (#2368).
 */
export interface ResearchEntityNameIdentityAuthority {
  knownPersonSurnames: ReadonlySet<string>;
  leadPersonName: string;
}

/** An explicit declaration that neither corpus fact is available. */
export const NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY: ResearchEntityNameIdentityAuthority = {
  knownPersonSurnames: NO_SURNAME_ROSTER,
  leadPersonName: '',
};

export async function loadResearchEntityNameIdentityAuthority(
  researchEntityId: unknown,
  prefetch?: MaterializationReadSource,
): Promise<ResearchEntityNameIdentityAuthority> {
  const prefetchedLead = prefetch?.soleLeadPersonId(researchEntityId);
  return {
    knownPersonSurnames: await loadKnownPersonSurnameRoster(),
    leadPersonName: await loadResearchEntityLeadPersonName(
      researchEntityId,
      prefetchedLead?.hit ? prefetchedLead.value : undefined,
    ),
  };
}

export interface ProjectFromLogInput {
  resolved: Record<string, ResolvedField>;
  nameIdentityAuthority: ResearchEntityNameIdentityAuthority;
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  entityDoc: any;
  materializationObs: any[];
  resolverObs: ResolverObservation[];
  fullDescriptionShellGated: boolean;
  undergradEvidenceQuoteWithdrawnBy?: ReadonlySet<string>;
  droppedLoserWebsiteValues?: readonly unknown[];
  loserRosterReads?: readonly ResolverObservation[];
  now: Date;
  synthesizeCardDescription?: (fullDescription: string) => Promise<string>;
  writeOnlyFields?: string[];
  provenanceOnly?: boolean;
  readRowUnderOwnIdentity?: boolean;
  researchAreasHaveNoLiveEvidence?: boolean;
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
  /**
   * Reported separately from `set` even though its corrections are already folded into
   * it, because a stage that silently corrects the corpus cannot be measured: the
   * refusals in particular are invisible in a `$set` by construction.
   */
  storedTextNormalization: StoredTextNormalizationPlan;
  retiredProvenanceFields: string[];
  relinkedProvenance: Record<string, Record<string, unknown>>;
  unbackedResearchAreas?: UnbackedResearchAreaOutcome;
}

export const RESEARCH_ENTITY_IDENTITY_NAME_FIELDS = ['name', 'displayName'] as const;

function isPersonBiographyDescription(candidateText: string): boolean {
  return isHighConfidencePersonBio(candidateText) || isCareerBiographyDescription(candidateText);
}

// The pre-step ranks one servable body below another, so it uses the narrow biography test
// `researchHomeDescriptionSelection` records as safe for ranking; the wide one also flags
// research prose that opens on a title (#4280).
function isRankablePersonBiography(candidateText: string): boolean {
  return isDemotablePersonBio(candidateText) || isCareerBiographyDescription(candidateText);
}

/**
 * A `fullDescription` that the served-copy sanitizer strips renders as nothing, so
 * the row serves no description while storing hundreds of characters. The usual
 * case is an affiliated organization's own description grafted onto a person-scoped
 * row ("<Centre> was founded in 2010 to facilitate..."), which is correct prose
 * about the wrong subject.
 *
 * The resolver cannot catch it: by design it makes no DB calls, so it has no entity
 * context, and every predicate it owns reads that text exactly like genuine person
 * research. Only the sanitizer, which knows whose row this is, can tell them apart.
 * So the winner is judged here against `servingBarAcceptsFullDescription` and, when it
 * cannot serve, the next ranked candidate that can is adopted instead, preferring one
 * that is not a person biography.
 *
 * Mirrors `enforceResearchEntityNameAuthority`: same `resolveFieldRanked` walk, same
 * refusal discipline. The guard requires the incumbent to be unservable, so this can
 * never displace a description a student can already read, and it never touches a
 * manually locked field. When no candidate survives, the stored value is left alone
 * rather than cleared: an unservable description is inert, and clearing it would
 * discard the only text a future lane could repair.
 */
function adoptServableFullDescription(input: {
  /** The instant the projection is evaluated at, so recency decay is reproducible (#3839). */
  now: Date;
  entityType: ObservedEntityType;
  set: Record<string, unknown>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  derivedKind: string | undefined;
  resolverObs: ResolverObservation[];
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  materializationObs: MaterializerObservationLike[];
  leadPersonName: string;
}): number {
  const field = 'fullDescription';
  if (input.manuallyLockedFields.includes(field)) return 0;
  const { set, entityDoc, confidenceByField } = input;

  const identity = {
    name: set.name ?? entityDoc?.name,
    displayName: set.displayName ?? entityDoc?.displayName,
    slug: entityDoc?.slug,
    entityType: set.entityType ?? entityDoc?.entityType,
    kind: set.kind ?? input.derivedKind ?? entityDoc?.kind,
    researchAreas: set.researchAreas ?? entityDoc?.researchAreas,
  };
  const servesAsDescription = (value: unknown): boolean => {
    const text = textValue(value);
    if (!text) return false;
    return servingBarAcceptsFullDescription(
      entityDoc,
      { ...set, kind: identity.kind },
      text,
      input.leadPersonName,
    );
  };

  const servedValue = set[field] ?? entityDoc?.[field];
  if (!textValue(servedValue) || servesAsDescription(servedValue)) return 0;

  const servable = resolveFieldRanked(field, input.resolverObs, {
    now: input.now,
    manuallyLockedFields: input.manuallyLockedFields,
    manualValues: input.manualValues,
    descriptionEntityKind: descriptionEntityKindForResearchEntity(entityDoc),
  })
    .map((candidate) => ({
      candidate,
      provenance: fieldProvenanceForResolvedObservation(field, candidate, input.materializationObs),
      // Through the projected-field sanitizer rather than `textValue` alone. An adopted
      // candidate is a stored body like any other, and staging one raw is how a description
      // reached the corpus still carrying its invisible format characters after #2874 had
      // already handled the resolver's own winner (#3408). It is judged after sanitizing
      // because that is the text the row would store (#3437).
      materialized: sanitizeProjectedField(
        input.entityType,
        field,
        textValue(candidate.value),
        entityDoc?.[field],
        { slug: entityDoc?.slug, name: identity.name, displayName: identity.displayName },
      ),
    }))
    .filter(
      ({ materialized }) =>
        textValue(materialized) !== textValue(servedValue) && servesAsDescription(materialized),
    );
  // Research prose that serves is preferred, and a biography that serves still outranks an
  // incumbent that serves nothing, because refusing it took a served row off the surface
  // (#4280).
  const replacement =
    servable.find(({ materialized }) => !isRankablePersonBiography(textValue(materialized))) ??
    servable[0];

  if (!replacement) return 0;

  set[field] = replacement.materialized;
  confidenceByField[field] = replacement.candidate.confidence;
  if (replacement.provenance) set[`fieldProvenance.${field}`] = replacement.provenance;
  return 1;
}

/**
 * A department winner that names no department (a school, a campus, a funder's
 * administrative unit) is dropped by org-unit canonicalization, so the row ends with
 * `departments: []` even when a lower-weight observation names a real department.
 * Roster sources carry more confidence than lead-PI inheritance, so a school-level
 * roster label ("Yale School of Public Health") out-voted the inherited department on
 * every resolve (#3610). The resolver has no org-unit catalog, so the winner is
 * judged here and the next ranked candidate that names a department is adopted.
 * When none does, the stored departments are left alone: a label that names no
 * department is not evidence that the row has none.
 * Returns the change to the written-field count.
 */
async function adoptDepartmentNamingCandidate(input: {
  entityType: ObservedEntityType;
  set: Record<string, unknown>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  resolverObs: ResolverObservation[];
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  materializationObs: MaterializerObservationLike[];
  sourceEntityIdentity: ResearchEntityIdentity | undefined;
  /** The instant the projection is evaluated at, so recency decay is reproducible (#3839). */
  now: Date;
}): Promise<number> {
  const field = 'departments';
  const { set, entityDoc, confidenceByField } = input;
  if (input.manuallyLockedFields.includes(field) || !(field in set)) return 0;
  const namesADepartment = await departmentValueNamesADepartment(
    'school' in set ? set.school : entityDoc?.school,
  );
  if (namesADepartment(set[field])) return 0;

  const replacement = resolveFieldRanked(field, input.resolverObs, {
    now: input.now,
    manuallyLockedFields: input.manuallyLockedFields,
    manualValues: input.manualValues,
  }).find((candidate) => namesADepartment(candidate.value));
  if (replacement) {
    set[field] = sanitizeProjectedField(
      input.entityType,
      field,
      replacement.value,
      entityDoc?.[field],
      input.sourceEntityIdentity,
    );
    confidenceByField[field] = replacement.confidence;
    const provenance = fieldProvenanceForResolvedObservation(
      field,
      replacement,
      input.materializationObs,
    );
    if (provenance) set[`fieldProvenance.${field}`] = provenance;
    else delete set[`fieldProvenance.${field}`];
    return 0;
  }

  if (!namesADepartment(entityDoc?.[field])) return 0;
  delete set[field];
  delete set[`fieldProvenance.${field}`];
  const storedConfidence = entityDoc?.confidenceByField?.[field];
  if (typeof storedConfidence === 'number') confidenceByField[field] = storedConfidence;
  else delete confidenceByField[field];
  return -1;
}

export const DEPARTMENT_ROSTER_APPOINTMENT_SOURCE = 'dept-faculty-roster';
export const DEPARTMENT_ROSTER_APPOINTMENT_CURRENCY_DAYS = 14;

/**
 * Each department roster page that lists a person is an independent appointment, so
 * a roster-won `departments` is the union of every roster department still being
 * read, not the one page ranked first (#3621). The resolver weighs each page's list
 * as a rival value, so a cross-listing displaced the home department whenever it was
 * read last.
 *
 * A department observation's fingerprint carries its value, so a page that stops
 * listing the person never supersedes its old value; it just stops being refreshed.
 * Measured on Development, 147 of 173 multi-value roster groups held a value last
 * read 30 or more days before its sibling. Only values read within the currency
 * window of the row's newest roster read combine, which is what keeps the field from
 * hoarding every page that ever listed the person (#3330).
 */
async function combineDepartmentRosterAppointments(input: {
  set: Record<string, unknown>;
  entityDoc: any;
  rosterReads: readonly ResolverObservation[];
  manuallyLockedFields: string[];
}): Promise<void> {
  const field = 'departments';
  const { set, entityDoc } = input;
  if (input.manuallyLockedFields.includes(field) || !Array.isArray(set[field])) return;
  if (
    textValue(objectRecord(set[`fieldProvenance.${field}`]).sourceName) !==
    DEPARTMENT_ROSTER_APPOINTMENT_SOURCE
  ) {
    return;
  }
  const rosterReads = refusedResolverObservations(
    input.rosterReads.filter(
      (observation) =>
        observation.field === field &&
        observation.sourceName === DEPARTMENT_ROSTER_APPOINTMENT_SOURCE &&
        Array.isArray(observation.value),
    ),
    entityDoc?.fieldValueRefusals,
  ).kept;
  const readTime = (observation: ResolverObservation) =>
    new Date(observation.observedAt as any).getTime() || 0;
  const newestRead = Math.max(0, ...rosterReads.map(readTime));
  const currencyFloor = newestRead - DEPARTMENT_ROSTER_APPOINTMENT_CURRENCY_DAYS * 86_400_000;
  const namesADepartment = await departmentValueNamesADepartment(
    'school' in set ? set.school : entityDoc?.school,
  );
  const currentAppointments = rosterReads
    .filter((observation) => readTime(observation) >= currencyFloor)
    .sort(
      (left, right) =>
        readTime(right) - readTime(left) ||
        JSON.stringify(left.value).localeCompare(JSON.stringify(right.value)),
    )
    .flatMap((observation) => (observation.value as unknown[]).map((item) => textValue(item)))
    .filter((item) => item && namesADepartment([item]));
  const canonicalizer = await getOrgUnitCanonicalizer();
  const departmentKey = (value: string) =>
    canonicalizer.canonicalizeDepartments([value]).values[0] ?? value.trim().toLowerCase();
  const winner = (set[field] as unknown[]).map((value) => textValue(value)).filter(Boolean);
  const byKey = new Map<string, string>();
  for (const item of [...winner, ...currentAppointments]) {
    const key = departmentKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  if (byKey.size === new Set(winner.map(departmentKey)).size) return;
  const storedKeys = Array.isArray(entityDoc?.[field])
    ? (entityDoc[field] as unknown[]).map((value) => departmentKey(textValue(value)))
    : [];
  const keys = [...byKey.keys()];
  set[field] = [
    ...storedKeys.filter((key) => byKey.has(key)),
    ...keys.filter((key) => !storedKeys.includes(key)),
  ].map((key) => byKey.get(key));
}

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
  /** The instant the projection is evaluated at, so recency decay is reproducible (#3839). */
  now: Date;
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
  nameIdentityAuthority: ResearchEntityNameIdentityAuthority;
}): number {
  const { set, unset, confidenceByField, entityDoc } = input;
  const recordIdentity = {
    entityType: set.entityType ?? entityDoc?.entityType,
    kind: set.kind ?? input.derivedKind ?? entityDoc?.kind,
    slug: entityDoc?.slug ?? input.sourceEntityIdentity?.slug,
    personName: input.nameIdentityAuthority.leadPersonName,
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
  // Citations, not the resolved website: the website resolver refuses a shared
  // academic host's root to a person-scoped row (#2359), so by the time this runs
  // the field no longer holds the host whose name the row may have taken. The
  // citation survives that refusal and is what the shared-host name arm reads
  // (#2360).
  const recordCitedUrls = [recordWebsiteUrl, set.sourceUrls ?? entityDoc?.sourceUrls];
  const namesNothingUsable = (candidateName: unknown, websiteUrl: unknown): boolean =>
    isPlaceholderEntityName(candidateName) ||
    // An external platform's brand names no research home, and it is refused here
    // as well as at ingest for the same reason filler is: an already-stored
    // "Google Scholar" is re-projected from its own active observation on every
    // pass, so the ingest guard alone would leave the row repairable only by hand
    // (#2285, the #2367 argument applied to a second furniture class).
    isExternalScholarlyPlatformLinkLabelName(candidateName) ||
    // An appointment title or a bare host name is what the `unusable_name` gate
    // blocker already refuses to publish, and refusing it here as well is what gives
    // it a repair path. Without this arm the value stays stored and, when it is
    // person-name-shaped, `personScopedResearchEntityNameFromPersonName` below
    // launders it into "<title> Faculty Research", a form the gate predicate can no
    // longer recognise, so the row publishes headed with an endowed chair (#3368).
    (isPersonScopedResearchEntity(recordIdentity) &&
      isUnrecoverablePersonScopedEntityName(candidateName)) ||
    // A profile page advertises the series its subject convenes, so the most
    // prominent title on the page is a monthly speaker series that several faculty
    // co-lead rather than this person's research record.
    (isPersonScopedResearchEntity(recordIdentity) && namesAScholarlyEventSeries(candidateName)) ||
    // Roster-corroborated rather than path-only, because this is a write
    // chokepoint: a lab name whose eponym appears nowhere in the URL path
    // ("The Mougous Lab" on `mougouslab.org`) is refused at harvest and was still
    // stored here, which made the all-source backstop weaker than the per-source
    // guard it backs up (#2369).
    personScopedResearchEntityNameNamesSomethingElse({
      ...recordIdentity,
      candidateName,
      websiteUrl,
      knownPersonSurnames: input.nameIdentityAuthority.knownPersonSurnames,
      recordCitedUrls,
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
      now: input.now,
      manuallyLockedFields: input.manuallyLockedFields,
      manualValues: input.manualValues,
      descriptionEntityKind: descriptionEntityKindForResearchEntity(entityDoc),
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
    if (field === 'name') {
      const fromLead = personScopedResearchEntityNameFromLeadPersonName({
        ...recordIdentity,
        leadPersonName: input.nameIdentityAuthority.leadPersonName,
        currentName: servedValue,
      });
      if (fromLead && fromLead !== textValue(servedValue)) {
        set[field] = fromLead;
        delete set[`fieldProvenance.${field}`];
        delete confidenceByField[field];
        if (objectRecord(entityDoc?.fieldProvenance?.[field]).sourceUrl) {
          unset[`fieldProvenance.${field}`] = '';
        }
        fieldsWritten++;
      }
      continue;
    }
    delete set[field];
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (textValue(entityDoc?.[field])) {
      unset[field] = '';
      unset[`fieldProvenance.${field}`] = '';
      fieldsWritten++;
    }
  }

  // Runs after the refusals so a grafted bare person name is replaced by a ranked
  // candidate first and only what survives is normalized. The value is the same one
  // the roster scrapers write, so a row whose only name observation is a bare person
  // name is repaired here rather than staying hand-fixable (#2373/#2507).
  for (const field of RESEARCH_ENTITY_IDENTITY_NAME_FIELDS) {
    if (input.manuallyLockedFields.includes(field)) continue;
    if (field in unset) continue;
    const servedValue = set[field] ?? entityDoc?.[field];
    const derived =
      personScopedResearchEntityNameFromPersonName({
        ...recordIdentity,
        candidateName: servedValue,
      }) ||
      labResearchEntityNameFromStaleFacultyResearchSuffix({
        ...recordIdentity,
        candidateName: servedValue,
      });
    if (!derived || derived === textValue(servedValue)) continue;
    set[field] = derived;
    fieldsWritten++;
  }
  return fieldsWritten;
}

/**
 * A slug names the row it is stored on, so an observed slug may only mint one.
 * Merge-redirect resolution and resolve-at-mint adoption both replace the document
 * the identifier found with a different canonical, after which the observed slug
 * belongs to the key that found the row rather than to the row being written.
 * Planning it renames a live entity, invalidating every bookmark, redirect and
 * search-index document keyed on the old slug, and the unique index on
 * `research_entities.slug` is the only thing that has been refusing the write
 * (#2905).
 */
export function projectedSlugWouldRenameExistingResearchEntity(
  entityDoc: { slug?: unknown } | null | undefined,
  projectedSlug: unknown,
): boolean {
  const currentSlug = textValue(entityDoc?.slug);
  return currentSlug.length > 0 && textValue(projectedSlug) !== currentSlug;
}

/**
 * A description sanitizer that empties a non-empty candidate has REJECTED that
 * candidate; it has not learned the entity has no description. Staging its `''`
 * is how the projection destroyed stored prose: the ranked recovery walk below
 * only replaces the empty plan when some candidate passes
 * `fullDescriptionIsAcceptable`, so when none does the `$set` writes `''` over
 * the body the row was serving and the row picks up `thin_description`,
 * `missing_card_description` and `public_description_invariant_failed` (#2958).
 *
 * Nothing can put that body back. `fullDescription` and `shortDescription` are
 * `QUALITY_GUARDED_PROSE_FIELDS`, which field retraction refuses to declare
 * (`isIngestDroppableObservationField`), and neither is in
 * `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, so this projection is the only
 * path in the engine that clears them. Declining here is the same
 * "demoted, never dropped" rule the `kind`, `entityType` and `rosterEnrichment`
 * branches of `materializedFieldValue` already follow by returning `existingValue`.
 *
 * An empty RESOLVED value still projects: that is a source stating emptiness
 * rather than a transform inferring it, and this guard must not turn into a
 * blanket refusal to ever clear a field.
 */
export function descriptionSanitizerRejectedCandidateOverStoredProse(
  entityType: ObservedEntityType,
  field: string,
  resolvedValue: unknown,
  projectedValue: unknown,
  existingValue: unknown,
): boolean {
  return (
    isResearchEntityObservationType(entityType) &&
    MATERIALIZED_DESCRIPTION_FIELDS.has(field) &&
    typeof resolvedValue === 'string' &&
    textValue(resolvedValue).length > 0 &&
    textValue(projectedValue).length === 0 &&
    textValue(existingValue).length > 0
  );
}

/**
 * The serving check's own verdict on a candidate body, asked of the row as this pass
 * would leave it. The adoption bar used to be `fullDescriptionQuality` alone, which is
 * weaker than the serve chain's sanitizers, so a body could win the field and then be
 * refused at serve time while a body that serves sat lower in the ranked list (#3437).
 * Calling the serving function itself, rather than restating it, is what keeps the two
 * bars one predicate.
 */
export function servingBarAcceptsFullDescription(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  candidateText: string,
  leadPersonName: string,
): boolean {
  const projectedFields = Object.fromEntries(
    Object.entries(projected).filter(([field]) => !field.includes('.')),
  );
  // Topic canonicalization and derivation run after the description is chosen, so the
  // stored topics are what the gate will judge the body against (#4280).
  const researchAreas = entityDoc?.researchAreas ?? projectedFields.researchAreas;
  // Judged as the row will store it: the stored-text normalization runs at the end of
  // the pass and repairs harvest defects such as glued sentences (#4280).
  const storedText = String(withHarvestTextDefectsCorrected('fullDescription', candidateText));
  const entity = {
    ...(entityDoc || {}),
    ...projectedFields,
    researchAreas,
    fullDescription: storedText,
  };
  const leadMemberNames = leadPersonName ? [leadPersonName] : [];
  const representation = buildResearchEntityPublicDescriptionRepresentation({
    entity,
    leadMemberNames,
  });
  return (
    representation.invariant.fullDescriptionUseful &&
    textValue(servedResearchEntityCopy(representation.entity, leadMemberNames).fullDescription)
      .length > 0
  );
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
    undergradEvidenceQuoteWithdrawnBy = new Set<string>(),
    droppedLoserWebsiteValues = [],
    loserRosterReads = [],
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
        // The STORED citations, which `sanitizeResearchEntitySourceUrlsForMaterialization`
        // must not overwrite with the list being written: the person-page owner check
        // reads whose page the row has already committed to, and a projection that
        // empties the list would otherwise lose the owner in the same pass that mints
        // its replacement (#2945). The `sourceUrls` projections widen this to the
        // citations projected this pass as well, via
        // `researchEntityIdentityWithCitationsThroughThisPass`.
        citedPersonPageUrls: entityDoc?.sourceUrls,
        fullDescription: entityDoc?.fullDescription,
        recentGrants: entityDoc?.recentGrants,
      }
    : undefined;
  let conflicts = 0;
  let fieldsWritten = 0;
  let unbackedResearchAreas: UnbackedResearchAreaOutcome | undefined;
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
    if (
      isResearchEntityObservationType(entityType) &&
      field === 'slug' &&
      projectedSlugWouldRenameExistingResearchEntity(entityDoc, nextValue)
    ) {
      continue;
    }
    const projectedValue = sanitizeProjectedField(
      entityType,
      field,
      nextValue,
      entityDoc?.[field],
      sourceEntityIdentity,
    );
    if (
      descriptionSanitizerRejectedCandidateOverStoredProse(
        entityType,
        field,
        nextValue,
        projectedValue,
        entityDoc?.[field],
      )
    ) {
      continue;
    }
    set[field] = projectedValue;
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
      now: input.now,
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
      nameIdentityAuthority: input.nameIdentityAuthority,
    });
    fieldsWritten += adoptServableFullDescription({
      now: input.now,
      entityType,
      set,
      confidenceByField,
      entityDoc,
      derivedKind,
      resolverObs,
      manuallyLockedFields,
      manualValues,
      materializationObs,
      leadPersonName: input.nameIdentityAuthority.leadPersonName,
    });
    fieldsWritten += await adoptDepartmentNamingCandidate({
      now: input.now,
      entityType,
      set,
      confidenceByField,
      entityDoc,
      resolverObs,
      manuallyLockedFields,
      manualValues,
      materializationObs,
      sourceEntityIdentity,
    });
    await combineDepartmentRosterAppointments({
      set,
      entityDoc,
      rosterReads: [...resolverObs, ...loserRosterReads],
      manuallyLockedFields,
    });
  }
  let fullRestatesCurrentCard = false;
  if (isResearchEntityObservationType(entityType)) {
    if (!manuallyLockedFields.includes('fullDescription') && resolved.fullDescription) {
      const currentShortForFullDistinctness = textValue(
        set.shortDescription ?? entityDocShortDescriptionForRestatementGuard(entityDoc),
      );
      const cardShortForFullInversion = textValue(
        set.shortDescription ?? entityDoc?.shortDescription,
      );
      const winnerFull = textValue(set.fullDescription);
      const fullDescriptionReadsWell = (candidateText: string): boolean =>
        !!candidateText &&
        fullDescriptionQuality(candidateText).isUseful &&
        !isFullDescriptionRestatementOfShortDescription(
          candidateText,
          currentShortForFullDistinctness,
        );
      const fullDescriptionServes = (candidateText: string): boolean =>
        servingBarAcceptsFullDescription(
          entityDoc,
          set,
          candidateText,
          input.nameIdentityAuthority.leadPersonName,
        );
      const winnerFullReadsWell = fullDescriptionReadsWell(winnerFull);
      const winnerFullAcceptable = winnerFullReadsWell && fullDescriptionServes(winnerFull);
      const winnerFullUseful =
        winnerFullAcceptable && !isPoorerThanCardDescription(winnerFull, cardShortForFullInversion);
      // Both reasons the winner can be rejected above are relationships to the
      // CARD rather than judgements of the body, and a career biography satisfies
      // both by construction: a resume never restates a research card and is never
      // thinner than one. So the walk below was selecting a biography precisely on
      // the rows whose card is good research prose, which is the pairing a student
      // reads as a defect and the one no count catches, because the card gate
      // passes and `missing_card_description` never fires (#2901).
      //
      // The same explicit biography rejection the access-signal lane's displacement
      // bar carries, and the same pair of predicates the confidence resolver's bio
      // demotion selects on, so what the resolver demotes the walk cannot re-adopt.
      // Refusing every candidate leaves `chosen` undefined and keeps the resolver's
      // winner, which is what the restatement branch below already wants: it keeps
      // the body and reconsiders the card, because the card is derivable from the
      // body and the body is not derivable from the card (#2721).
      if (!winnerFullUseful) {
        const rankedFull = resolveFieldRanked('fullDescription', resolverObs, {
          now: input.now,
          manuallyLockedFields,
          manualValues,
          descriptionEntityKind: descriptionEntityKindForResearchEntity(entityDoc),
        });
        let readableFallback: { materialized: unknown; candidate: ResolvedField } | undefined;
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
          if (!fullDescriptionReadsWell(materializedText)) continue;
          if (isPersonBiographyDescription(materializedText)) continue;
          if (!readableFallback) readableFallback = { materialized, candidate };
          if (!fullDescriptionServes(materializedText)) continue;
          if (!fallback) fallback = { materialized, candidate };
          if (!isPoorerThanCardDescription(materializedText, cardShortForFullInversion)) {
            preferred = { materialized, candidate };
            break;
          }
        }
        // An already-acceptable winner is only ever replaced by a candidate that
        // also fixes the inversion: falling back to the ranked runner-up when no
        // such candidate exists would demote a full the current rules accept.
        // A candidate the serving check refuses is adopted only where it was before
        // that check joined the bar, and never over a winner the serving check accepts,
        // so a row with no servable candidate keeps what it had (#3437).
        const chosen =
          preferred ??
          (winnerFullAcceptable
            ? undefined
            : (fallback ??
              (winnerFullReadsWell || fullDescriptionServes(winnerFull)
                ? undefined
                : readableFallback)));
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
        // Keep the body, reconsider the CARD. `observationStore`'s sibling guard states
        // the reason: the card is derivable from the full and the full is not derivable
        // from the card, so blanking the full destroys the irrecoverable half. Blanking
        // it also produced the state the visibility gate punishes - a row holding a card,
        // no body, and a usable body sitting resolved at confidence 1.0 (#2721).
        //
        // This reopens the card for re-derivation below even though it already clears the
        // card bar, while still ranking any replacement against it. Card resolution may
        // return nothing better and keep the stored card; that leaves a mildly redundant
        // pair, which is strictly better than a row students cannot see at all.
        fullRestatesCurrentCard = true;
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
      reconsiderCurrentShortDescription: fullRestatesCurrentCard,
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
    // Skipped when the card in play came from this body - either card resolution just
    // produced it (for a program-like entity `resolveGroundedCardDescription` returns
    // nothing but `deriveProgramCardShortDescription` of this full), or the branch above
    // already decided to keep the body and reconsider the card instead. A card derived
    // FROM the full restates it by construction, so blanking the full here would leave a
    // card with no body, which is the #2721 state the visibility gate punishes.
    if (
      isProgramLikeEntity &&
      !fullRestatesCurrentCard &&
      !groundedShortDescription &&
      !manuallyLockedFields.includes('fullDescription')
    ) {
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
    const canonicalizeResearchAreas =
      input.applyResearchEntityResearchAreaCanonicalization ??
      applyResearchEntityResearchAreaCanonicalization;
    const observedResearchAreas = set.researchAreas;
    await (input.applyDescriptionResearchAreaDerivation ?? applyDescriptionResearchAreaDerivation)(
      set,
      entityDoc,
    );
    await (
      input.applyResearchEntityOrgUnitCanonicalization ?? applyResearchEntityOrgUnitCanonicalization
    )(set, entityDoc, orgUnitProfileUrls);
    await canonicalizeResearchAreas(set, set.departments ?? entityDoc?.departments);
    const observedResearchAreasWhollyRejected =
      hasNonEmptyStringArray(observedResearchAreas) && isEmptyArray(set.researchAreas);
    let researchAreasResolvedFromObservation =
      hasNonEmptyStringArray(observedResearchAreas) && !observedResearchAreasWhollyRejected;
    if (observedResearchAreasWhollyRejected) {
      researchAreasResolvedFromObservation = await resolveResearchAreasOverAdmissibleObservations({
        now: input.now,
        set,
        confidenceByField,
        entityDoc,
        resolverObs,
        manuallyLockedFields,
        manualValues,
        materializationObs,
        canonicalizeResearchAreas,
      });
    }
    // Derive again if canonicalization emptied the list, because the first attempt
    // above returns early on a non-empty `researchAreas` and rejection runs AFTER it.
    // A row whose winning observation names only its own department and a
    // division-level label therefore ends with no chips and never reaches the
    // fallback written for exactly that case: the observation is non-empty when the
    // fallback looks, and empty by the time anything could use it. Measured on
    // Development, a served row carrying six observed areas stored none for this
    // reason (#3252 cohort, and the `no website and no topics` panel metric).
    //
    // Ordering matters rather than the guard: deriving before rejection would let a
    // rejected label suppress the fallback, and deriving without canonicalizing the
    // result would write an uncanonical chip. So this runs after rejection and
    // canonicalizes what it derives.
    const storedResearchAreasOutrankRejectedObservation =
      observedResearchAreasWhollyRejected &&
      isEmptyArray(set.researchAreas) &&
      hasNonEmptyStringArray(
        await admittedResearchAreas(
          canonicalizeResearchAreas,
          Array.isArray(entityDoc?.researchAreas) ? entityDoc.researchAreas : [],
          set.departments ?? entityDoc?.departments,
        ),
      );
    if (
      !storedResearchAreasOutrankRejectedObservation &&
      Array.isArray(set.researchAreas) &&
      set.researchAreas.length === 0
    ) {
      const beforeFallback = set.researchAreas;
      delete set.researchAreas;
      await (
        input.applyDescriptionResearchAreaDerivation ?? applyDescriptionResearchAreaDerivation
      )(set, { ...(entityDoc ?? {}), researchAreas: [] });
      if (Array.isArray(set.researchAreas) && set.researchAreas.length > 0) {
        await (
          input.applyResearchEntityResearchAreaCanonicalization ??
          applyResearchEntityResearchAreaCanonicalization
        )(set, set.departments ?? entityDoc?.departments);
      }
      if (!Array.isArray(set.researchAreas)) set.researchAreas = beforeFallback;
    }
    if (observedResearchAreasWhollyRejected && isEmptyArray(set.researchAreas)) {
      fieldsWritten -= await keepStoredResearchAreasOverWhollyRejectedObservation({
        set,
        confidenceByField,
        entityDoc,
        canonicalizeResearchAreas,
      });
    }
    // The resolver can still hold an observation the shared predicate does not credit
    // (an `entityKey` match carrying another row's `entityId`), and evidence the
    // resolver used always outranks a derivation.
    if (input.researchAreasHaveNoLiveEvidence && !researchAreasResolvedFromObservation) {
      const plannedResearchAreasBefore = 'researchAreas' in set;
      unbackedResearchAreas = await rederiveUnbackedResearchAreas({
        set,
        unset,
        entityDoc,
        derive:
          input.applyDescriptionResearchAreaDerivation ?? applyDescriptionResearchAreaDerivation,
        canonicalizeResearchAreas,
      });
      fieldsWritten += Number('researchAreas' in set) - Number(plannedResearchAreasBefore);
    }
    reconcileDerivedResearchAreaProvenance(set, unset, entityDoc);
    // The detail-page official-profile CTA reads only entity.sourceUrls, so a
    // lead's official profile page must land there or the way-in disappears
    // even though it is a known source (issue #613).
    const citationsCondemnedThisPass = new Set<string>();
    if (!manuallyLockedFields.includes('sourceUrls')) {
      // Every arm in this block derives from the resolver's list, exactly as before. The stored
      // citations this pass does not re-derive are re-admitted at the END of the projection
      // instead, by `planStoredCitationReadmission` (#3476), for a reason worth stating:
      // making the stored list an INPUT here resurrects what a retraction just removed. A
      // `websiteUrl` retraction retires its observation, and then the promotion arm below reads
      // the citation list and re-adopts the same site from the stale citation, so #2542's and
      // #3452's "the next pass keeps it absent" both failed. Re-admission has to sit after
      // every derivation that reads a citation, not before them.
      const storedSourceUrls = Array.isArray(set.sourceUrls)
        ? (set.sourceUrls as unknown[])
        : Array.isArray(entityDoc?.sourceUrls)
          ? (entityDoc?.sourceUrls as unknown[])
          : [];
      // Every citation any arm below drops, so the re-admission can tell a removal with a
      // positive reason from a citation the pass merely did not re-derive. Staging through one
      // function is what makes that complete: an arm that assigns `set.sourceUrls` directly
      // would have its removal read as silence and be handed straight back.
      const stageSourceUrls = (next: unknown): void => {
        const before = Array.isArray(set.sourceUrls)
          ? (set.sourceUrls as unknown[])
          : storedSourceUrls;
        const after = Array.isArray(next) ? (next as unknown[]) : [];
        for (const url of before) {
          if (typeof url === 'string' && !after.includes(url)) citationsCondemnedThisPass.add(url);
        }
        set.sourceUrls = next;
      };
      const citationIdentity = researchEntityIdentityWithCitationsThroughThisPass(
        sourceEntityIdentity,
        entityDoc?.sourceUrls,
        storedSourceUrls,
      );
      // #2945 stopped a same-surname stranger's page being minted, but said nothing
      // about the rows already citing one, and nothing else re-projects `sourceUrls`
      // on those rows, so the graft was served indefinitely (#3000). The retraction
      // runs before the #613 projection and outside its `leadProfileUrl` branch, both
      // deliberately: a row with no lead-profile observation this pass is exactly the
      // row nothing else would ever revisit. It cannot empty the list, because the arm
      // needs a second, identity-named cited page to fire at all, and that page is
      // read from this same list.
      const currentSourceUrls = citationIdentity
        ? storedSourceUrls.filter(
            (url) => !personProfileSourceIsADifferentPersonThanCitedOwner(url, citationIdentity),
          )
        : storedSourceUrls;
      if (currentSourceUrls.length !== storedSourceUrls.length) {
        stageSourceUrls(sanitizeResearchEntitySourceUrlsForMaterialization(currentSourceUrls));
        fieldsWritten++;
      }
      const leadProfileUrl = officialLeadProfileSourceUrl(
        materializationObs,
        entityDoc?.sourceLinkHealth,
        [
          ...currentSourceUrls,
          ...(Array.isArray(entityDoc?.sourceUrls) ? (entityDoc?.sourceUrls as unknown[]) : []),
        ],
        researchEntityIdentityWithCitationsThroughThisPass(
          sourceEntityIdentity,
          entityDoc?.sourceUrls,
          currentSourceUrls,
        ),
      );
      if (leadProfileUrl) {
        const retained = withoutSupersededProfileSourceUrls(currentSourceUrls, leadProfileUrl);
        const leadDestination = normalizeOfficialProfileDestination(leadProfileUrl);
        const alreadyPresent = retained.some(
          (url) => normalizeOfficialProfileDestination(url) === leadDestination,
        );
        if (!alreadyPresent || retained.length !== currentSourceUrls.length) {
          stageSourceUrls(
            sanitizeResearchEntitySourceUrlsForMaterialization(
              alreadyPresent ? retained : [...retained, leadProfileUrl],
            ),
          );
          fieldsWritten++;
        }
      }
      // Runs last in the block so it reads every citation this pass will write, whether
      // the #613 projection staged it or the stored list carried it. A live observation
      // asserting the roster URL is therefore re-filtered on each pass, which is why
      // nothing here retires an observation.
      const graftRetraction = planDirectoryGraftCitationRetraction({
        entity: {
          entityType: set.entityType ?? entityDoc?.entityType,
          kind: set.kind ?? entityDoc?.kind,
        },
        sourceUrls: Array.isArray(set.sourceUrls)
          ? (set.sourceUrls as unknown[])
          : (currentSourceUrls as unknown[]),
      });
      if (graftRetraction.refused) {
        console.log(
          `[directory-graft-citation] kept a readable citation: ${graftRetraction.refused}`,
        );
      }
      if (graftRetraction.removed.length > 0) {
        stageSourceUrls(graftRetraction.next);
        fieldsWritten++;
      }
    }
    // websiteUrl resolves after the #613 sourceUrls projection: it clears a profile-page
    // websiteUrl the entity already cites, so it has to see the projection this same pass
    // or the duplicate way-in stays live until the next materialization (issue #2352).
    const clearLoserOnlySurvivorWebsite = (field: SurvivorOwnedWebsiteField) => {
      const clearsLoserOnlyWebsite = planSurvivorOwnedWebsiteClear({
        field,
        stored: entityDoc,
        staged: set,
        droppedLoserValues: droppedLoserWebsiteValues,
        lockedFields: manuallyLockedFields,
      });
      if (!clearsLoserOnlyWebsite) return;
      console.log(
        `[survivor-owned-website] cleared a ${field} only a merged-in loser's evidence backed`,
      );
      set[field] = '';
      fieldsWritten++;
    };
    clearLoserOnlySurvivorWebsite('website');
    if (!manuallyLockedFields.includes('websiteUrl')) {
      // The vocabulary that already knows this URL is not a research home now stops
      // the write instead of only annotating an audit (#3167). It screens the
      // resolver's own winner as well as the promotion below, because either can put
      // the value on the row. Refusing an adoption never cleared a stored value, which
      // left every value written before an arm existed served forever and grew one
      // `retire*WebsiteUrls` repair script per arm; `planRefusedStoredWebsiteUrlClear`
      // below closes that, reading the gate's own verdict so it covers every arm (#3432).
      // Two write-blocking arms are scoped by WHO cites the URL rather than by the URL
      // alone, so omitting this identity does not weaken the gate uniformly - it breaks
      // it in both directions at once. `umbrella-page-cited-by-person` runs through
      // `isPersonScopedHostTenant`, an allowlist, so with no entity it never fires and a
      // research-group host root is adopted onto a person's row, which is the hole
      // the umbrella repair script existed to sweep after the fact, until this gate made
      // it spent and #3469 deleted it. `multi-tenant-host-root` inverts: it refuses unless the row is shown to own
      // the host, so with no entity it refuses a shared academic host root even for the
      // organization whose own name names it.
      //
      // Read staged-over-stored, because a pass that retypes the row must gate on the
      // type it is about to leave standing rather than the one it is replacing.
      const websiteUrlHostOwner: ResearchEntityHostOwnerIdentity = {
        name: set.name ?? entityDoc?.name,
        displayName: set.displayName ?? entityDoc?.displayName,
        entityType: set.entityType ?? entityDoc?.entityType,
        kind: set.kind ?? derivedKind ?? entityDoc?.kind,
      };
      const resolvedWriteRefusal =
        typeof set.websiteUrl === 'string' && set.websiteUrl.trim()
          ? researchHomeWebsiteUrlWriteRefusal(set.websiteUrl, websiteUrlHostOwner)
          : null;
      if (resolvedWriteRefusal) {
        console.log(
          `[website-url-refusal] declined a resolved websiteUrl: ${resolvedWriteRefusal}`,
        );
        delete set.websiteUrl;
      }
      clearLoserOnlySurvivorWebsite('websiteUrl');
      if (
        planUnsourcedProvenanceWebsiteUrlClear({
          stored: entityDoc,
          staged: set,
          observations: materializationObs,
          lockedFields: manuallyLockedFields,
        })
      ) {
        console.log(
          '[unsourced-provenance-website-url] cleared a websiteUrl written without evidence',
        );
        set.websiteUrl = '';
        fieldsWritten++;
      }
      // Ordered ahead of the promotion deliberately: emptying the slot here lets the
      // promotion below refill it from an admissible citation on this same pass, so a
      // row trades a refused research home for its best evidenced one rather than for
      // nothing. When no citation qualifies the `''` written here is what persists,
      // because `clearedWebsiteUrlIsWorthWriting` then reads the staged `''` and
      // declines to write a second one.
      const refusedStoredWebsiteUrl = planRefusedStoredWebsiteUrlClear({
        stored: entityDoc,
        staged: set,
        identity: websiteUrlHostOwner,
        lockedFields: manuallyLockedFields,
      });
      if (refusedStoredWebsiteUrl.skipped) {
        console.log(
          `[refused-stored-website-url] kept a refused websiteUrl: ${refusedStoredWebsiteUrl.skipped} (${refusedStoredWebsiteUrl.refusal})`,
        );
      }
      if (refusedStoredWebsiteUrl.clear) {
        console.log(
          `[refused-stored-website-url] cleared a stored websiteUrl the gate refuses: ${refusedStoredWebsiteUrl.refusal}`,
        );
        set.websiteUrl = '';
        fieldsWritten++;
      }
      const websiteResolution = deriveResearchEntityWebsiteUrl(set, entityDoc);
      // This lane promotes a cited sourceUrl into an empty websiteUrl slot, and until
      // #3167 a `manuallyLockedFields` entry was the only thing that could stop it.
      // That is why clearing a wrong websiteUrl never held: the resolver dropped the
      // value and this lane put it straight back from the citation. A refusal has to
      // reach both paths or it reaches neither.
      const promotedRowRefusal =
        websiteResolution.action === 'set' &&
        valueIsRefused(entityDoc?.fieldValueRefusals, 'websiteUrl', websiteResolution.websiteUrl);
      const promotedRuleRefusal =
        websiteResolution.action === 'set'
          ? researchHomeWebsiteUrlWriteRefusal(websiteResolution.websiteUrl, websiteUrlHostOwner)
          : null;
      const promotedLoserOwnedWebsite =
        websiteResolution.action === 'set' &&
        isDroppedLoserWebsite(websiteResolution.websiteUrl, droppedLoserWebsiteValues);
      if (promotedLoserOwnedWebsite) {
        console.log(
          "[survivor-owned-website] declined to promote a merged-in loser's lab website from a citation",
        );
      }
      const promotedValueIsRefused =
        promotedRowRefusal || Boolean(promotedRuleRefusal) || promotedLoserOwnedWebsite;
      if (promotedRowRefusal) {
        console.log(
          '[field-value-refusal] declined to promote a refused websiteUrl from a citation',
        );
      }
      if (promotedRuleRefusal) {
        console.log(
          `[website-url-refusal] declined to promote a cited websiteUrl: ${promotedRuleRefusal}`,
        );
      }
      if (websiteResolution.action === 'set' && !promotedValueIsRefused) {
        set.websiteUrl = websiteResolution.websiteUrl;
        fieldsWritten++;
      } else if (
        websiteResolution.action === 'clear' &&
        clearedWebsiteUrlIsWorthWriting(set, entityDoc)
      ) {
        set.websiteUrl = '';
        fieldsWritten++;
      }
    }
    // Ordered after every description arm deliberately, because this reads the value the
    // pass will LEAVE standing rather than the value it started with: an arm that stages
    // the stored prose back would otherwise overwrite a `''` written earlier and the clear
    // would silently not hold. The resolver screen already dropped the refused
    // observation, so in the ordinary case nothing is staged here and this is the only
    // stage that can reach the stored value (#3438).
    for (const clear of planRefusedStoredDescriptionClears({
      stored: entityDoc,
      staged: set,
      lockedFields: manuallyLockedFields,
    })) {
      if (clear.skipped) {
        console.log(`[refused-stored-description] kept a refused ${clear.field}: ${clear.skipped}`);
        continue;
      }
      console.log(`[refused-stored-description] cleared a refused ${clear.field}`);
      set[clear.field] = '';
      fieldsWritten++;
    }
    const storedQuoteClear = planStoredUndergradEvidenceQuoteClear({
      stored: entityDoc,
      staged: set,
      withdrawingSources: undergradEvidenceQuoteWithdrawnBy,
      lockedFields: manuallyLockedFields,
    });
    if (storedQuoteClear?.skipped) {
      console.log(
        `[stored-undergrad-evidence-quote] kept a ${storedQuoteClear.reason} undergradEvidenceQuote: ${storedQuoteClear.skipped}`,
      );
    } else if (storedQuoteClear) {
      console.log(
        `[stored-undergrad-evidence-quote] cleared a ${storedQuoteClear.reason} undergradEvidenceQuote`,
      );
      set.undergradEvidenceQuote = '';
      fieldsWritten++;
    }
    const readmittedCitations = planStoredCitationReadmission({
      stored: entityDoc?.sourceUrls,
      planned: set.sourceUrls,
      condemned: citationsCondemnedThisPass,
      entity: {
        entityType: set.entityType ?? entityDoc?.entityType,
        kind: set.kind ?? entityDoc?.kind,
      },
      citationIdentity: researchEntityIdentityWithCitationsThroughThisPass(
        sourceEntityIdentity,
        entityDoc?.sourceUrls,
        Array.isArray(set.sourceUrls) ? (set.sourceUrls as unknown[]) : [],
      ),
      sourceLinkHealth: entityDoc?.sourceLinkHealth,
    });
    if (readmittedCitations) {
      set.sourceUrls = readmittedCitations;
      fieldsWritten++;
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
        const provenanceSourceUrl = bestMaterializationProvenanceSourceUrl(
          materializationObs,
          entityDoc?.sourceLinkHealth,
          researchEntityIdentityWithCitationsThroughThisPass(
            sourceEntityIdentity,
            entityDoc?.sourceUrls,
            currentSourceUrls,
          ),
        );
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
    // Only a pass that read the row under its own key or id has seen all of the
    // row's own contact evidence; a pass entered through another key has not (#3609).
    const clearableFields = input.readRowUnderOwnIdentity
      ? [...CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS, ...RESEARCH_ENTITY_CONTACT_FIELDS]
      : CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS;
    for (const field of clearableFields) {
      if (manuallyLockedFields.includes(field)) continue;
      if (field in set) continue;
      if (fieldsWithLiveObservation.has(field)) continue;
      if (!isClearableStaleFieldValue((entityDoc as Record<string, unknown>)[field])) continue;
      unset[field] = '';
      delete confidenceByField[field];
    }
  }

  // Runs last of the field stages, because it reads the value this pass will leave
  // standing rather than any one arm's output, and before the `writeOnlyFields`
  // restriction below, so a scoped materialize stays scoped (#3408).
  const storedTextNormalization = planStoredTextNormalization({
    entityType,
    stored: entityDoc as Record<string, unknown> | null,
    staged: set,
    lockedFields: manuallyLockedFields,
  });
  Object.assign(set, storedTextNormalization.set);

  if (entityType === 'fellowship') {
    for (const field of fellowshipFieldsWithheldBySourcePrecedence({
      stored: entityDoc as Record<string, unknown> | null,
      staged: set,
      resolved,
    })) {
      delete set[field];
      delete set[`fieldProvenance.${field}`];
      if (field in confidenceByField && entityDoc?.confidenceByField?.[field] !== undefined) {
        confidenceByField[field] = entityDoc.confidenceByField[field];
      } else {
        delete confidenceByField[field];
      }
      fieldsWritten = Math.max(0, fieldsWritten - 1);
    }
    const classification = planFellowshipClassification({
      stored: entityDoc as Record<string, unknown> | null,
      staged: set,
      unset,
      lockedFields: manuallyLockedFields,
      observedValues: Object.fromEntries(
        Object.entries(resolved).map(([field, resolution]) => [field, resolution.value]),
      ),
    });
    for (const [field, value] of Object.entries(classification.set)) {
      if (!(field in set) || JSON.stringify(set[field]) !== JSON.stringify(value)) fieldsWritten++;
      set[field] = value;
      delete unset[field];
    }
    for (const field of classification.withdrawn) {
      delete set[field];
      delete confidenceByField[field];
    }
    for (const field of classification.unset) {
      unset[field] = '';
      fieldsWritten++;
    }
  }

  const scopedFields =
    input.writeOnlyFields && input.writeOnlyFields.length > 0
      ? withDerivedMaterializerFields(input.writeOnlyFields)
      : undefined;
  if (scopedFields) {
    fieldsWritten = restrictMaterializerSetToFields(set, unset, confidenceByField, scopedFields);
  }
  // After the scope restriction, which drops any `unset` key it does not name, so the
  // retirement is scoped by passing the scope through rather than by being filtered.
  // A provenance-only pass writes none of this projection, so it plans against the stored row.
  const projectedWrites = input.provenanceOnly ? { set: {}, unset: {} } : { set, unset };
  const retiredProvenanceFields = isResearchEntityObservationType(entityType)
    ? await planNeverBackedFieldProvenanceRetirement({
        stored: entityDoc as Record<string, unknown> | null,
        ...projectedWrites,
        lockedFields: manuallyLockedFields,
        scopedFields,
      })
    : [];
  const retiredUnset = Object.fromEntries(
    retiredProvenanceFields.map((field) => [`fieldProvenance.${field}`, '' as const]),
  );
  Object.assign(unset, retiredUnset);
  const relinkedProvenance = isResearchEntityObservationType(entityType)
    ? await planUnrecordedProvenanceObservationRelink({
        stored: entityDoc as Record<string, unknown> | null,
        set: projectedWrites.set,
        unset: { ...projectedWrites.unset, ...retiredUnset },
        lockedFields: manuallyLockedFields,
        scopedFields,
      })
    : {};
  if (!input.provenanceOnly) {
    for (const [field, entry] of Object.entries(relinkedProvenance)) {
      set[`fieldProvenance.${field}`] = entry;
    }
  }
  return {
    set,
    unset,
    confidenceByField,
    conflicts,
    fieldsWritten,
    storedTextNormalization,
    retiredProvenanceFields,
    relinkedProvenance,
    ...(unbackedResearchAreas &&
    !input.provenanceOnly &&
    (!scopedFields || scopedFields.includes('researchAreas'))
      ? { unbackedResearchAreas }
      : {}),
  };
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

/**
 * On unless explicitly disabled. The opt-in default was correct while the resolver
 * answered no URL key and so folded nothing (#3027), and stopped being correct once
 * the `website-url` arm returned: measured on Development it folds 32 mints that
 * would otherwise become duplicate rows, with 0 ambiguous (#3036).
 *
 * This is the single owner of the default. Absence must not be read as "off"
 * anywhere else, which is why the hermetic fence now states a value rather than
 * deleting the name.
 */
export function c4ResolveAtMintEntitiesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSweepStageEnabledByDefault(env.C4_RESOLVE_AT_MINT_ENTITIES);
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
  prefetch?: MaterializationReadSource,
): Promise<CandidateEntity[]> {
  if (resolverType === 'fellowship') {
    if (key.ns !== 'source-key') return [];
    const doc = (await Fellowship.findOne({ sourceKey: key.value }).select('_id title').lean()) as {
      _id: unknown;
      title?: string;
    } | null;
    return doc ? [{ id: String(doc._id), name: doc.title }] : [];
  }
  if (key.ns === 'slug') {
    const routedCandidate = prefetch?.liveEntityDocForKey('researchEntity', key.value);
    const doc = (
      routedCandidate?.hit
        ? routedCandidate.value
        : await ResearchEntity.findOne({ slug: key.value, archived: { $ne: true } })
            .select('_id name studentVisibilityTier')
            .lean()
    ) as { _id: unknown; name?: string; studentVisibilityTier?: string } | null;
    return doc ? [{ id: String(doc._id), name: doc.name, tier: doc.studentVisibilityTier }] : [];
  }
  // The key is normalized and the stored URL is not, so the lookup enumerates the
  // spellings that fold into it rather than requiring a second normalized copy of the
  // URL on the row. Two candidates are enough: `resolveCanonical` only distinguishes
  // none, one, and more than one, and more than one is ambiguous either way.
  if (key.ns === 'website-url') {
    const variants = websiteUrlIdentityKeyVariants(key.value);
    if (variants.length === 0) return [];
    const docs = (await ResearchEntity.find({
      websiteUrl: { $in: variants },
      archived: { $ne: true },
    })
      .select('_id name studentVisibilityTier')
      .limit(2)
      .lean()) as Array<{ _id: unknown; name?: string; studentVisibilityTier?: string }>;
    return docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      tier: doc.studentVisibilityTier,
    }));
  }
  // `profile-lab-url` and `org-name` still resolve to nothing. Their keys lower-case
  // the path segments and the org name respectively, which the stored value does not,
  // so neither has an enumerable inverse; a merged identity is instead reached through
  // its archived row's canonicalGroupId tombstone (#3027). Measured on Development, a
  // profile-lab-url arm would fold 5 mints the website-url arm does not already (#3036).
  return [];
}

async function resolveCanonicalForEntityMint(
  entityType: ObservedEntityType,
  obs: Array<{ field: string; value?: unknown }>,
  prefetch?: MaterializationReadSource,
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
      findCandidatesByKey: (_type, key) => findEntityCandidatesByKey(resolverType, key, prefetch),
    },
  );
}

export async function materializeEntity(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  // Structural, not a convention: a projection derived with locks ignored reaching
  // the write below is exactly the silent unfreeze that re-opening a lock is a
  // separate reviewed operation to prevent (#2612).
  if (options.reviseRevisitableFieldLocks && !options.dryRun) {
    throw new Error('materializeEntity reviseRevisitableFieldLocks requires dryRun');
  }
  if (options.auditFieldLocksIgnoringRecord && !options.dryRun) {
    throw new Error('materializeEntity auditFieldLocksIgnoringRecord requires dryRun');
  }
  if (options.auditFieldLocksIgnoringRecord && options.reviseRevisitableFieldLocks) {
    throw new Error(
      'materializeEntity auditFieldLocksIgnoringRecord and reviseRevisitableFieldLocks are mutually exclusive',
    );
  }
  const filter: any = { entityType, ...materializationReadScopeFilter() };
  if (identifier.entityId) filter.entityId = identifier.entityId;
  else if (identifier.entityKey) filter.entityKey = identifier.entityKey;
  else throw new Error('materializeEntity requires entityId or entityKey');

  // Load-bearing in Beta and Production, not a defensive nicety: the promotion
  // path copies materialized collections without the evidence store, so both hold
  // a full entity corpus against ZERO observations (measured 2026-09-05:
  // Development 420,906 observations / 7,000 entities; Beta 0 / 6,440; Production
  // 0 / 6,440). Every materializeEntity call there reaches this line with an empty
  // set. Removing this return does not no-op - the unset-on-empty pass below nulls
  // observation-backed fields (`methods` measured) while the returned counters
  // still report fieldsWritten 0, so a corpus-wide field drop would look like a
  // clean run. Pinned by entityMaterializerEmptyObservationGuard.integration.test.ts
  // (#2467); do not remove without reading it.
  const prefetchedObservations = identifier.entityId
    ? options.chunkPrefetch?.observationsForId(entityType, identifier.entityId)
    : options.chunkPrefetch?.observationsForKey(entityType, identifier.entityKey as string);
  const readObservations = prefetchedObservations?.hit
    ? (prefetchedObservations.value as any[])
    : await Observation.find(filter).lean();

  // An operator quarantines a bad run's evidence with `invalidated: true`. Honour it
  // here, at the one point every write path reads evidence, so `materializeFromRun`,
  // `observations:catch-up-materialize` and any future caller inherit the fence
  // instead of each needing its own. Before #2469 nothing on the write path read the
  // flag, so a quarantined run's observations were indistinguishable from good ones.
  const { kept: withheldFiltered, withheld } = partitionObservationsByInvalidatedRun(
    readObservations,
    await invalidatedScrapeRunIds(),
  );
  if (withheld.length > 0) {
    // Reported distinctly from "no evidence": both write nothing and both would
    // otherwise return identical counters, which is the ambiguity that made the
    // empty-observation guard below invisible (#2467).
    console.warn(
      `materializeEntity: withheld ${withheld.length} observation(s) for ${entityType} ${sanitizeLogValue(
        identifier.entityKey || identifier.entityId,
      )} from invalidated scrape run(s) (#2469)`,
    );
  }

  let obs = withheldFiltered;
  if (obs.length === 0 && isResearchEntityObservationType(entityType)) {
    obs = await observationsMergedIntoLiveSurvivor(entityType, identifier, options.chunkPrefetch);
  }
  if (obs.length === 0) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      ...(withheld.length > 0 ? { skipped: 'invalidated-run-evidence' } : {}),
    };
  }

  if (entityType === 'researchGroupMember') {
    return materializeRosterMember(identifier, obs, options);
  }

  if (entityType === 'researchEntityRelationship') {
    return materializeResearchEntityRelationship(identifier, obs, options);
  }

  if (entityType === 'user') {
    return materializeUserIdentityToResearcher(identifier, obs, options);
  }

  if (entityType === 'orgUnit') {
    // An org-unit observation becomes a Signal on the department rather than a
    // field on the OrgUnit document, so it deliberately does not reach
    // `entityModelFor`: OrgUnit is an ingest-time canonical lookup table, and
    // writing scraped prose into it would make the department pill a scraped
    // value.
    const orgUnitResult = await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: identifier.entityKey || '',
      observations: obs,
      dryRun: options.dryRun,
    });
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      postMaterializationMetrics: {
        entryPathways: 0,
        accessSignals: orgUnitResult.signalsWritten,
        contactRoutes: 0,
        postedOpportunities: 0,
        guardedContactRoutes: 0,
        staleEvidenceSkipped: 0,
        conflicts: 0,
        errors: orgUnitResult.rejected,
      },
    };
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
  entityDoc = await findEntityDocByIdentifier(
    Model,
    entityType,
    identifier,
    obs,
    options.chunkPrefetch,
  );
  if (entityDoc) entityIdString = String(entityDoc._id);

  // A merged shell's canonicalGroupId tombstone is the durable record that this
  // identity belongs to the survivor, so a re-scrape of the shell's source
  // materializes INTO that survivor (#3027). Never fall through to the shell
  // itself: findEntityDocByIdentifier resolves by slug without an archived filter,
  // so writing here would re-activate and re-index the shell and undo the merge
  // (#1957). An unresolvable chain is therefore a no-op rather than a local write.
  if (
    isResearchEntityObservationType(entityType) &&
    entityDoc &&
    entityDoc.archived === true &&
    entityDoc.canonicalGroupId
  ) {
    const tombstoneCanonical = await resolveResearchEntityCanonicalByTombstone(entityDoc);
    if (tombstoneCanonical) {
      entityDoc = tombstoneCanonical;
      entityIdString = String(tombstoneCanonical._id);
    } else {
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
  const programTyped =
    isResearchEntityObservationType(entityType) &&
    winningObservedEntityTypeIsRetiredProgram(obs, options.now ?? new Date());

  if (programTyped) {
    const programKey = entityDoc ? textValue(entityDoc.slug) : identifier.entityKey;
    if (await programLivesAsFellowship(programKey)) {
      const archiveUpdate =
        entityDoc && entityDoc.archived !== true
          ? archivedEntityUpdate(PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON)
          : undefined;
      if (archiveUpdate && !options.dryRun) {
        await ResearchEntity.updateOne(
          { _id: entityDoc._id, archived: { $ne: true } },
          archiveUpdate,
        );
        await deleteFromIndex('researchEntity', String(entityDoc._id));
      }
      return {
        entityType,
        entityId: entityDoc ? materializerDocumentId(entityDoc._id) : undefined,
        entityKey: identifier.entityKey,
        fieldsWritten: archiveUpdate && !options.dryRun ? 1 : 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'program-lives-on-programs',
        ...(archiveUpdate
          ? { plannedSet: archiveUpdate.$set, plannedUnset: archiveUpdate.$unset }
          : {}),
      };
    }
  }

  if (programTyped && !entityDoc) {
    const healedEntityType = healedEntityTypeForRetiredProgramObservations(
      obs,
      options.now ?? new Date(),
    );
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

  // C4 resolve-at-mint for research entities and fellowships (env-flagged). This is
  // the resolver's only caller: `C4_RESOLVE_AT_MINT_USERS` has no reader, so the
  // person mint below runs its own identity cascade rather than a parallel copy of
  // this contract. An existing canonical is adopted before minting a duplicate;
  // blocked skips; ambiguous and mint fall through.
  if (
    c4ResolveAtMintEntitiesEnabled() &&
    (isResearchEntityObservationType(entityType) || entityType === 'fellowship') &&
    !entityDoc
  ) {
    const resolution = await resolveCanonicalForEntityMint(entityType, obs, options.chunkPrefetch);
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
      options.chunkPrefetch,
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
      options.chunkPrefetch,
    );
    if (excludedByKeyScope.length > 0) obs = [...obs, ...excludedByKeyScope];
  }

  let mergedInKeys: string[] = [];
  let mergedInRows: MergedSurvivorEvidence['mergedInRows'] = [];
  let researchAreaEvidenceObservations: any[] = obs;
  let droppedLoserWebsiteValues: unknown[] = [];
  let loserRosterReads: ResolverObservation[] = [];
  if (isResearchEntityObservationType(entityType) && entityDoc && entityDoc.archived !== true) {
    const merged = await mergedSurvivorEvidence(entityType, entityDoc, obs, options.chunkPrefetch);
    obs = merged.observations;
    mergedInKeys = merged.mergedInKeys;
    mergedInRows = merged.mergedInRows;
    researchAreaEvidenceObservations = merged.evidenceObservations;
    droppedLoserWebsiteValues = merged.droppedLoserWebsiteValues;
    loserRosterReads = merged.loserRosterAppointments.map((o: any) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
    }));
    if (obs.length === 0) {
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
  }

  let foreignContactWithheld = false;
  if (isResearchEntityObservationType(entityType) && entityDoc) {
    const rowKeyedObs = withoutForeignContactObservations(obs, entityDoc);
    foreignContactWithheld = rowKeyedObs.length !== obs.length;
    obs = rowKeyedObs;
    if (obs.length === 0) {
      return {
        entityType,
        entityId: materializerDocumentId(entityDoc._id),
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'no-row-keyed-evidence',
      };
    }
  }

  const storedLockedFields: string[] = (entityDoc && entityDoc.manuallyLockedFields) || [];
  // `reviseRevisitableFieldLocks` asks what this projection would produce if the
  // named locks were not there, which is the only way to learn whether the engine
  // now agrees with a value a repair pinned. It is a question, not a policy:
  // `research-entity:release-field-locks` passes it with `dryRun` and compares the
  // answer to the stored value before releasing anything (#2612).
  const locksToRevise = options.reviseRevisitableFieldLocks;
  const locksToAudit = options.auditFieldLocksIgnoringRecord;
  const manuallyLockedFields: string[] = locksToRevise
    ? storedLockedFields.filter(
        (field) =>
          !(locksToRevise.includes(field) && isRevisitableFieldLockOnEntity(entityDoc, field)),
      )
    : locksToAudit
      ? storedLockedFields.filter((field) => !locksToAudit.includes(field))
      : storedLockedFields;
  const manualValues: Record<string, unknown> = {};
  for (const f of manuallyLockedFields) {
    if (entityDoc && entityDoc[f] !== undefined) manualValues[f] = entityDoc[f];
  }

  const undergradEvidenceQuoteWithdrawnBy = isResearchEntityObservationType(entityType)
    ? sourcesWithdrawingUndergradEvidenceQuote(obs, entityDoc)
    : new Set<string>();
  const materializationObs = collapseLatestWins(
    withoutWithdrawnUndergradEvidenceQuotes(
      withoutUnpairedProfileHomeIdentity(
        obs.filter((o: any) => !shouldIgnoreObservationForEntityMaterialization(entityType, o)),
        entityDoc?.fieldValueRefusals,
      ),
      undergradEvidenceQuoteWithdrawnBy,
    ),
    entityType,
  );

  // #3500 bars a shared page at ingest, so no lane stores a new one. It cannot reach
  // what is already stored, and the resolver ranks every live observation, so a
  // pre-guard shared-page candidate can still win the field. Measured while clearing
  // the standing corpus, 4 of 46 rows whose borrowed description was refused
  // rematerialized straight onto another borrowed description, because a refusal is
  // keyed on the value it named and the next candidate was a different shared page
  // (#3481). Screening here is what stops that repair needing a second pass.
  const ownEntityKeys = new Set(
    [
      entityIdString,
      identifier.entityKey,
      identifier.entityId,
      isResearchEntityObservationType(entityType) ? textValue(entityDoc?.slug) : '',
      ...mergedInKeys,
    ]
      .map((value) => String(value || ''))
      .filter(Boolean),
  );
  const ownershipCandidates = materializationObs.map((o: any) => ({
    entityType: entityType as string,
    field: o.field,
    value: o.value,
    sourceUrl: o.sourceUrl,
  }));
  const ownershipCiters = await loadDescriptionSourceCiters(
    ownershipGuardedCitedUrls(ownershipCandidates),
  );
  const ownershipScreen = screenDescriptionsOnSharedPages(
    ownershipCandidates.map((candidate, index) => ({
      ...(materializationObs[index] as any),
      entityType: candidate.entityType,
    })),
    ownershipCiters,
    ownEntityKeys,
  );
  if (ownershipScreen.dropped.length > 0) {
    console.log(
      `[description-ownership] ${entityType} ${entityIdString || identifier.entityKey || ''}: dropped ${
        ownershipScreen.dropped.length
      } description candidate(s) citing a page other rows own: ${ownershipScreen.dropped
        .map((entry) => `${entry.field}/${entry.foreignCiters} other citers`)
        .join(', ')}`,
    );
  }

  const resolverObs: ResolverObservation[] = ownershipScreen.kept.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));

  // A refusal removes one VALUE from consideration, never the field, so whatever
  // rivals remain still resolve normally and a field whose every candidate is
  // refused resolves to nothing. That is the retraction a repair was reaching for
  // when it wrote a lock instead (#3167).
  const refusalScreen = refusedResolverObservations(resolverObs, entityDoc?.fieldValueRefusals);
  if (refusalScreen.refused.length > 0) {
    console.log(
      `[field-value-refusal] ${entityType} ${entityIdString || identifier.entityKey || ''}: dropped ${
        refusalScreen.refused.length
      } refused observation(s): ${refusalScreen.refused
        .map((entry) => `${entry.field}/${entry.rule}`)
        .join(', ')}`,
    );
  }

  // Read off the stored row rather than off this pass's own resolved values,
  // because `entityType` and `kind` are themselves resolved here and the prose
  // bars need the kind before that happens. A row being created for the first
  // time has no stored citations, so it takes the `organization` default and the
  // next pass over it decides on evidence.
  const descriptionEntityKind = descriptionEntityKindForResearchEntity(entityDoc);

  // One instant for the whole projection, so the resolver's recency decay and every
  // date the projection derives agree with each other and with a later replay (#3589).
  const projectionNow = options.now ?? new Date();
  const resolved = resolveAllFields(refusalScreen.kept, {
    manuallyLockedFields,
    manualValues,
    descriptionEntityKind,
    now: projectionNow,
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
        const replacement = resolveFieldRanked(shellGatedField, refusalScreen.kept, {
          now: projectionNow,
          manuallyLockedFields,
          manualValues,
          descriptionEntityKind,
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

  const nameIdentityAuthority =
    options.nameIdentityAuthority ??
    (isResearchEntityObservationType(entityType)
      ? await loadResearchEntityNameIdentityAuthority(
          entityDoc?._id ?? entityIdString,
          options.chunkPrefetch,
        )
      : NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY);

  const readRowUnderOwnIdentity =
    Boolean(entityDoc) &&
    (mergedInKeys.length > 0 ||
      (Boolean(identifier.entityKey) && identifier.entityKey === textValue(entityDoc?.slug)) ||
      (Boolean(identifier.entityId) && identifier.entityId === entityIdString));
  const researchAreasHaveNoLiveEvidence =
    isResearchEntityObservationType(entityType) &&
    readRowUnderOwnIdentity &&
    (await storedResearchAreasHaveNoLiveEvidence({
      entityDoc,
      mergedInRows,
      observations: researchAreaEvidenceObservations,
      manuallyLockedFields,
    }));

  const projection = await projectFromLog(entityType, {
    resolved,
    nameIdentityAuthority,
    manuallyLockedFields,
    manualValues,
    entityDoc,
    materializationObs,
    // Every re-rank walk in the projection reads these, so they are the refusal-screened
    // set the resolver itself read: a walk over the unscreened set can adopt a value this
    // row refuses, which the #3438 clear then blanks over an admissible rival (#3884).
    resolverObs: refusalScreen.kept,
    fullDescriptionShellGated,
    undergradEvidenceQuoteWithdrawnBy,
    droppedLoserWebsiteValues,
    loserRosterReads,
    now: projectionNow,
    synthesizeCardDescription: options.synthesizeCardDescription,
    writeOnlyFields: options.writeOnlyFields,
    provenanceOnly: options.onlyReconcileFieldProvenance,
    readRowUnderOwnIdentity,
    researchAreasHaveNoLiveEvidence,
  });
  const { conflicts } = projection;
  const { set, unset, fieldsWritten } = options.onlyReconcileFieldProvenance
    ? {
        set: Object.fromEntries(
          Object.entries(projection.relinkedProvenance).map(([field, entry]) => [
            `fieldProvenance.${field}`,
            entry,
          ]),
        ),
        unset: Object.fromEntries(
          projection.retiredProvenanceFields.map((field) => [`fieldProvenance.${field}`, '']),
        ) as Record<string, ''>,
        fieldsWritten: 0,
      }
    : projection;
  const unbackedResearchAreasOutcome = projection.unbackedResearchAreas
    ? { unbackedResearchAreas: projection.unbackedResearchAreas }
    : {};

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
      ...unbackedResearchAreasOutcome,
    };
  }

  if (options.onlyReconcileFieldProvenance && !entityDoc) {
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts,
      created: false,
      resolved,
      skipped: 'no-scoped-fields',
      ...unbackedResearchAreasOutcome,
    };
  }

  options.chunkPrefetch?.markTouched(
    entityIdString,
    identifier.entityId,
    identifier.entityKey,
    entityDoc?._id,
    textValue(entityDoc?.slug),
  );
  if (!entityDoc) options.chunkPrefetch?.markCreated();

  const entityScalarUnchanged =
    Boolean(entityDoc) &&
    isMaterializerProjectionNoOp(
      entityDoc as Record<string, unknown>,
      set,
      unset,
      Object.keys(Model.schema?.paths ?? {}),
    );

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
        ...unbackedResearchAreasOutcome,
      };
    }
    // Skip the write (and, below, the redundant search re-sync) when the
    // projection recomputed the same values it already stored - only the managed
    // lastObservedAt would differ. Unconditional sub-projections (membership,
    // access, logistics, browse-rank) still run; they have their own change
    // detection and can change independently of the scalar projection.
    if (!entityScalarUnchanged) {
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(unset).length > 0) update.$unset = unset;
      // The scraper path writes the entire corpus, so without runValidators every
      // schema enum on every materialized field was documentation rather than a
      // constraint: creates go through Model.create and are validated, updates were
      // not, and that asymmetry is how retired enum members kept being re-asserted
      // (#2137). Update validators only check the paths present in the update, so
      // this asserts what the projection decided, not the whole stored document.
      if (isResearchEntityObservationType(entityType)) {
        await withResearchEntityWriteTransaction((session) =>
          Model.updateOne({ _id: entityDoc._id }, update, { session, runValidators: true }),
        );
      } else {
        await Model.updateOne({ _id: entityDoc._id }, update, { runValidators: true });
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
  }

  let indexStale = false;
  if (isSyncableEntityType(entityType) && entityIdString && !entityScalarUnchanged) {
    const fresh = await Model.findById(entityIdString).lean();
    indexStale = !fresh || !(await syncEntity(entityType, fresh));
  }

  if (options.onlyReconcileFieldProvenance) {
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts,
      created,
      resolved,
      ...(indexStale ? { indexSyncFailed: true as const } : {}),
      ...(entityScalarUnchanged ? { skipped: 'unchanged' as const } : {}),
    };
  }

  // A field-scoped pass writes only its scope, and the rematerialize report compares
  // fields, so an edge, signal or fold written here would be invisible (#3874).
  const skipPostProjectionEvidence =
    isWriteScoped(options.writeOnlyFields) && !options.keepPostProjectionEvidence;
  let postMaterializationMetrics: ReportPostMaterializationMetrics | undefined;
  if (isResearchEntityObservationType(entityType) && entityIdString) {
    if (!options.dryRun) {
      if (!skipPostProjectionEvidence) {
        await materializeInferredPiMembership(entityIdString, materializationObs);
        await materializeInferredDirectorMembership(entityIdString, materializationObs);
      }
      const inheritance = await inheritSchoolFromLeadPi(entityIdString, {
        manuallyLockedFields,
        chunkPrefetch: options.chunkPrefetch,
        writeOnlyFields: options.writeOnlyFields,
      });
      if (inheritance.inherited) indexStale = !!inheritance.indexSyncFailed;
    }
    const accessResult = skipPostProjectionEvidence
      ? { accessSignals: 0, staleEvidenceSkipped: 0, errors: 0 }
      : await materializeAccessForResearchGroup(
          {
            researchEntityId: entityIdString,
            entityKey: identifier.entityKey,
          },
          mergedInKeys.length > 0 || foreignContactWithheld
            ? (obs as AccessObservation[])
            : undefined,
        );
    postMaterializationMetrics = {
      entryPathways: 0,
      accessSignals: accessResult.accessSignals,
      contactRoutes: 0,
      postedOpportunities: 0,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: accessResult.staleEvidenceSkipped,
      conflicts: 0,
      errors: accessResult.errors,
    };

    // Recompute the browse-ranking score now that access signals exist, and
    // re-sync the entity so the default /research ordering stays fresh.
    if (!options.dryRun) {
      try {
        const browseRank = await recomputeBrowseRankForEntities([entityIdString]);
        if (browseRank.updated > 0) indexStale = browseRank.indexSyncFailures > 0;
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
    !skipPostProjectionEvidence &&
    isResearchEntityObservationType(entityType) &&
    entityIdString &&
    isDeptRosterKey(identifier.entityKey)
  ) {
    const fold = await foldDeptRosterShellIntoCanonicalResearchEntity(entityIdString);
    if (fold.folded) options.chunkPrefetch?.markTouched(fold.canonicalEntityId);
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
    ...unbackedResearchAreasOutcome,
    ...(indexStale ? { indexSyncFailed: true as const } : {}),
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

const liveOtherSourceObservations = (filter: Record<string, unknown>) =>
  Observation.find({
    ...filter,
    ...materializationReadScopeFilter(),
    sourceName: { $ne: CENTERS_INSTITUTES_SOURCE_NAME },
  })
    .select('entityKey field value sourceName observedAt confidence sourceUrl')
    .lean() as Promise<any[]>;

async function centerMembershipKeysAssertedByOtherSources(
  centerEntityKey: string,
): Promise<Set<string>> {
  const slugRows = await liveOtherSourceObservations({
    entityType: 'researchGroupMember',
    field: RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD,
    value: centerEntityKey,
  });
  const memberKeys = uniqueStrings(slugRows.map((row) => textValue(row.entityKey)));
  if (memberKeys.length === 0) return new Set();
  const rows = await liveOtherSourceObservations({
    entityType: 'researchGroupMember',
    entityKey: { $in: memberKeys },
    field: { $in: ['profileUrl', 'role', 'identityKey', 'membershipKey'] },
  });
  const bySourceAndKey = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const group = `${textValue(row.sourceName)}\u0000${textValue(row.entityKey)}`;
    const fields = bySourceAndKey.get(group) ?? {};
    fields[textValue(row.field)] = textValue(row.value);
    bySourceAndKey.set(group, fields);
  }
  const keys = new Set<string>();
  for (const fields of bySourceAndKey.values()) {
    const role = normalizeMemberRole(fields.role);
    const identityKey = fields.identityKey || officialProfileIdentityKey(fields.profileUrl || '');
    const membershipKey = fields.membershipKey || rosterMembershipKey(identityKey, role);
    if (membershipKey) keys.add(membershipKey);
  }
  return keys;
}

async function centerPersonRolesAssertedByOtherSources(
  centerEntityKey: string,
): Promise<Set<string>> {
  const rows = await liveOtherSourceObservations({
    entityType: 'researchEntity',
    entityKey: centerEntityKey,
    field: {
      $in: [
        'inferredDirectorName',
        'inferredDirectorUserName',
        'inferredDirectorRole',
        'inferredDirectorProfileUrl',
      ],
    },
  });
  const bySource = new Map<string, any[]>();
  for (const row of rows) {
    const source = textValue(row.sourceName);
    bySource.set(source, [...(bySource.get(source) ?? []), row]);
  }
  const personRoles = new Set<string>();
  for (const sourceRows of bySource.values()) {
    const fieldValue = (field: string) => sourceRows.find((row) => row.field === field)?.value;
    const userName = fieldValue('inferredDirectorUserName');
    if (!userName) continue;
    const profileUrl = textValue(fieldValue('inferredDirectorProfileUrl'));
    const lookupFields: Record<string, ResolvedField> = {
      inferredUserName: {
        value: userName,
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
    const name =
      textValue(fieldValue('inferredDirectorName')) || memberNameFromInferredUserName(userName);
    const researcher =
      (await findUniqueResearcherForRosterMember(lookupFields)) ||
      (await findUniqueResearcherByObservedDirectorName(name));
    const researcherId = idValue(researcher?._id);
    if (!researcherId) continue;
    const legacyRole =
      textValue(fieldValue('inferredDirectorRole')).toLowerCase() === 'co-director'
        ? 'co-director'
        : 'director';
    const role = canonicalRoleForLegacy(legacyRole);
    if (role) personRoles.add(`${researcherId}|${role}`);
  }
  return personRoles;
}

async function centerRelationshipTargetIdsAssertedByOtherSources(
  centerEntityKey: string,
): Promise<Set<string>> {
  const sourceRows = await liveOtherSourceObservations({
    entityType: 'researchEntityRelationship',
    field: 'sourceEntityKey',
    value: centerEntityKey,
  });
  const relationshipKeys = uniqueStrings(sourceRows.map((row) => textValue(row.entityKey)));
  if (relationshipKeys.length === 0) return new Set();
  const targetRows = await liveOtherSourceObservations({
    entityType: 'researchEntityRelationship',
    entityKey: { $in: relationshipKeys },
    field: 'targetEntityKey',
  });
  const targetIds = new Set<string>();
  for (const targetKey of uniqueStrings(targetRows.map((row) => textValue(row.value)))) {
    const targetId = await resolveCenterRelationshipTargetId(targetKey);
    if (targetId) targetIds.add(targetId);
  }
  return targetIds;
}

async function resolveCenterRelationshipTargetId(targetEntityKey: string): Promise<string | null> {
  const { resolvedTarget } = await resolveRelationshipTarget(ResearchEntity, targetEntityKey);
  return normalizeMaterializerObjectId(resolvedTarget?._id) || null;
}

export function centerRosterRetirementDeps(
  options: MaterializeOptions,
): CenterRosterRetirementDeps {
  return {
    membershipKeysAssertedByOtherSources: centerMembershipKeysAssertedByOtherSources,
    personRolesAssertedByOtherSources: centerPersonRolesAssertedByOtherSources,
    relationshipTargetIdsAssertedByOtherSources: centerRelationshipTargetIdsAssertedByOtherSources,
    resolveRelationshipTargetId: resolveCenterRelationshipTargetId,
    rematerializeMemberKey: async (memberKey: string) => {
      await materializeEntity('researchGroupMember', { entityKey: memberKey }, options);
    },
  };
}

function logCenterRosterRetirement(result: CenterRosterRetirementResult): void {
  const acted = result.centers.filter((center) => center.verdict === 'retire');
  const frozen = result.centers.filter((center) => center.verdict === 'frozen');
  const notAdmitted = result.centers.filter((center) => !center.verdict);
  const sum = (key: 'retiredMemberKeys' | 'retiredEdges' | 'retiredLeadEdges') =>
    acted.reduce((total, center) => total + (center.counts?.[key] ?? 0), 0);
  const indexSyncFailures = acted.reduce(
    (total, center) => total + (center.applied?.indexSyncFailures ?? 0),
    0,
  );
  console.info(
    `[center-roster-retirement] ${result.dryRun ? 'planned' : 'reconciled'} ${result.centers.length} center read(s): ${acted.length} retiring (${sum('retiredMemberKeys')} member keys, ${sum('retiredEdges')} role edges of which ${sum('retiredLeadEdges')} leads), ${frozen.length} frozen, ${notAdmitted.length} read(s) not admitted, ${indexSyncFailures} center index sync failure(s)`,
  );
}

export const MATERIALIZATION_CHUNK_SIZE = 100;

export interface ObservedEntityRow {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
}

export type ObservedEntityOutcome = { result: MaterializeResult } | { error: unknown };

async function loadChunkPrefetch(
  entityType: ObservedEntityType,
  rows: readonly ObservedEntityRow[],
): Promise<MaterializationChunkPrefetch | undefined> {
  const researchEntityModel = isResearchEntityObservationType(entityType)
    ? entityModelFor(entityType)
    : undefined;
  const keyField = researchEntityModel ? uniqueKeyFieldFor(entityType) : null;
  try {
    return await MaterializationChunkPrefetch.load({
      entityType,
      rows,
      readScopeFilter: materializationReadScopeFilter(),
      ...(researchEntityModel && keyField
        ? { entityDocs: { model: researchEntityModel, keyField } }
        : {}),
    });
  } catch (error) {
    console.warn(
      `materializeFromRun: chunk prefetch for ${entityType} failed, reading rows one by one:`,
      sanitizeLogValue(error),
    );
    return undefined;
  }
}

export async function materializeObservedEntitiesInChunks(
  rows: readonly ObservedEntityRow[],
  options: MaterializeOptions,
  onRow: (row: ObservedEntityRow, outcome: ObservedEntityOutcome) => void,
  chunkSize: number = MATERIALIZATION_CHUNK_SIZE,
): Promise<void> {
  let start = 0;
  while (start < rows.length) {
    const entityType = rows[start].entityType;
    let end = start + 1;
    while (end < rows.length && end - start < chunkSize && rows[end].entityType === entityType) {
      end += 1;
    }
    const chunk = rows.slice(start, end);
    const chunkPrefetch = await loadChunkPrefetch(entityType, chunk);
    for (const row of chunk) {
      let outcome: ObservedEntityOutcome;
      try {
        outcome = {
          result: await materializeEntity(
            row.entityType,
            { entityId: row.entityId, entityKey: row.entityKey },
            chunkPrefetch ? { ...options, chunkPrefetch } : options,
          ),
        };
      } catch (error) {
        outcome = { error };
      }
      onRow(row, outcome);
    }
    start = end;
  }
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
  indexSyncFailures: number;
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
      indexSyncFailures: 0,
      postMaterializationMetrics: emptyPostMaterializationMetrics(),
    };
  }

  // Refuse the whole run up front rather than relying on the per-entity fence, so an
  // operator who quarantined this run sees one explicit refusal instead of a page of
  // per-key warnings, and so the run is never enumerated at all (#2469).
  if (await isScrapeRunInvalidated(runObjectId)) {
    console.warn(
      `materializeFromRun: refusing invalidated scrape run ${sanitizeLogValue(scrapeRunId)}; its observations stay quarantined (#2469)`,
    );
    return {
      materialized: 0,
      created: 0,
      updated: 0,
      conflicts: 0,
      skipped: 0,
      errors: 0,
      indexSyncFailures: 0,
      postMaterializationMetrics: emptyPostMaterializationMetrics(),
    };
  }
  const distinct = await Observation.aggregate([
    {
      $match: {
        scrapeRunId: runObjectId,
        entityType: {
          $nin: ['paper', 'departmentRosterHealth', 'ysmLabIndexHealth', 'centerRosterHealth'],
        },
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
  const staleIndexEntityIds = new Set<string>();
  let staleIndexRowsWithoutId = 0;
  const unbackedResearchAreaOutcomes: Partial<Record<UnbackedResearchAreaOutcome, number>> = {};
  const postMaterializationMetrics = emptyPostMaterializationMetrics();
  const { failedDocumentIds } = await withDeferredIndexConfirmation(() =>
    materializeObservedEntitiesInChunks(
      distinct.map((row) => ({
        entityType: row._id.entityType,
        entityId: row._id.entityId ? String(row._id.entityId) : undefined,
        entityKey: row._id.entityKey || undefined,
      })),
      options,
      (row, outcome) => {
        if ('error' in outcome) {
          errors++;
          console.error(
            `materializeFromRun: ${row.entityType} ${row.entityKey || row.entityId} failed:`,
            sanitizeLogValue(outcome.error),
          );
          return;
        }
        const res = outcome.result;
        materialized++;
        if (res.created) created++;
        else if (!res.skipped) updated++;
        if (res.skipped) skipped++;
        conflicts += res.conflicts;
        if (res.indexSyncFailed) {
          if (res.entityId) staleIndexEntityIds.add(String(res.entityId));
          else staleIndexRowsWithoutId += 1;
        }
        if (res.unbackedResearchAreas) {
          unbackedResearchAreaOutcomes[res.unbackedResearchAreas] =
            (unbackedResearchAreaOutcomes[res.unbackedResearchAreas] ?? 0) + 1;
        }
        addPostMaterializationMetrics(postMaterializationMetrics, res.postMaterializationMetrics);
      },
    ),
  );
  for (const documentId of failedDocumentIds) staleIndexEntityIds.add(documentId);
  const indexSyncFailures = staleIndexEntityIds.size + staleIndexRowsWithoutId;
  if (Object.keys(unbackedResearchAreaOutcomes).length > 0) {
    console.info(
      `[unbacked-research-areas] rows whose stored researchAreas no live evidence states: ${JSON.stringify(unbackedResearchAreaOutcomes)}`,
    );
  }
  if (indexSyncFailures > 0) {
    console.warn(
      `materializeFromRun: ${indexSyncFailures} row(s) failed their last index resync, so search and browse order still serve the previous documents for those rows until a reindex`,
    );
  }
  const rosterMembersArchived = await reconcileOfficialRosterSnapshotsFromRun(scrapeRunId, options);
  const centerRosterRetirement = await reconcileCenterRosterRetirementsFromRun(
    scrapeRunId,
    centerRosterRetirementDeps(options),
    { dryRun: options.dryRun },
  );
  if (centerRosterRetirement.outcome !== 'no-center-roster-read') {
    logCenterRosterRetirement(centerRosterRetirement);
  }
  // Runs beside the centres retirement because it is the same contract over another lane's claims.
  // Lane-wide rather than per run's snapshots, because a claim is absent only when NO track still
  // lists the row, and a run's own reads are already among the admitted ones (#3852).
  const bbsTrackRetirement = await reconcileBbsTrackRetirementsFromRun(
    scrapeRunId,
    {
      rematerializeResearchEntity: async (identifier) => {
        await materializeEntity('researchEntity', identifier, options);
      },
    },
    { dryRun: options.dryRun },
  );
  if (bbsTrackRetirement.outcome !== 'no-bbs-track-read') {
    console.log(
      `[bbs-track-retirement] ${bbsTrackRetirement.outcome}${
        bbsTrackRetirement.verdict ? ` (${bbsTrackRetirement.verdict})` : ''
      }: ${JSON.stringify(bbsTrackRetirement.counts ?? {})}`,
    );
  }
  const departureResult = await reconcileFacultyRosterDeparturesFromRun(scrapeRunId, options);
  // An operator who switched the lane on needs to see why it did nothing;
  // silence made three separate dormancy causes invisible at once (#2410).
  const expectedQuietOutcomes: FacultyRosterDepartureOutcome[] = [
    'reconciled',
    'planned',
    'disabled',
  ];
  // `disabled` is stated rather than passed over, for the reason #2428 records: the
  // flag is read in one file and set nowhere, so a reader of the log has no other
  // way to learn that the quiet is a switch rather than an absence of departures.
  if (departureResult.outcome === 'disabled') {
    console.info(
      '[faculty-departure] lane off for this run: SCRAPER_FACULTY_DEPARTURE_DETECTION is not "true", so no absence was evaluated. Plan it read-only with "yarn --cwd server research-entity:audit-departure-lane".',
    );
  } else if (!expectedQuietOutcomes.includes(departureResult.outcome)) {
    console.warn(`[faculty-departure] no reconciliation this run: ${departureResult.outcome}`);
  } else if (departureResult.outcome === 'reconciled') {
    // A `reconciled` run used to log nothing at all, so an operator who had just
    // switched the lane on could not tell it from a run that never reached the
    // corpus, which is the same blind spot as the `disabled` silence above. `held`
    // and `regatedEntities` are the two counts worth reading: the first is how
    // often a Yale page still named the person, the second is how many rows the
    // decision actually reached, since a written status with no re-gate leaves the
    // row serving.
    console.info(
      `[faculty-departure] reconciled ${departureResult.governedDepartments.length} department(s): ${departureResult.suppressed} suppressed, ${departureResult.cleared} cleared, ${departureResult.held} held on Yale-profile evidence, ${departureResult.planned.record_first_absence} first absence(s) recorded, ${departureResult.regatedEntities} row(s) re-gated`,
    );
  }
  const ysmLabDelistingResult = await reconcileYsmLabDelistingFromRun(scrapeRunId, options);
  const expectedQuietDelistingOutcomes: YsmLabDelistingOutcome[] = [
    'reconciled',
    'disabled',
    'dry-run',
    // A run of any other source emits no A-Z index snapshot, which is the normal
    // case rather than a dormancy signal worth warning about on every pass.
    'no-index-health-observation',
  ];
  if (!expectedQuietDelistingOutcomes.includes(ysmLabDelistingResult.outcome)) {
    console.warn(
      `[ysm-lab-delisting] no reconciliation this run: ${ysmLabDelistingResult.outcome}`,
    );
  }
  // Runs after every entity has been projected, so a retraction reads the log the
  // projection just resolved from rather than racing it (#2542). Unlike the two
  // lanes above, a dry run still plans and reports: an operator has to be able to
  // read the drop-guard fraction before authorizing a pass that deletes evidence.
  const fieldRetractionResult = await reconcileFieldRetractionsFromRun(scrapeRunId, options);
  const expectedQuietRetractionOutcomes: FieldRetractionOutcome[] = [
    'reconciled',
    'planned',
    // A run of any source with no declared retraction contract is the normal case.
    'source-not-retraction-capable',
    'no-complete-reads',
  ];
  // `disabled` is stated rather than passed over in silence. #2428 records a lane
  // that is unreachable by default and whose quiet is indistinguishable from
  // "there was no work", so the flag being off has to be readable from the run log.
  if (fieldRetractionResult.outcome === 'disabled') {
    console.info(
      '[field-retraction] lane off for this run: SCRAPER_FIELD_RETRACTION is not "true", so no field was retracted and no absence was evaluated',
    );
  } else if (!expectedQuietRetractionOutcomes.includes(fieldRetractionResult.outcome)) {
    console.warn(`[field-retraction] no reconciliation this run: ${fieldRetractionResult.outcome}`);
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
          materializationIndexSyncFailures: indexSyncFailures,
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
    indexSyncFailures,
    postMaterializationMetrics,
  };
}
