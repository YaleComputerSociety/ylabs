/**
 * Reads pending Observations for a given entity, resolves field values via the
 * ConfidenceResolver, and writes the resolved values back to the entity collection.
 *
 * For person identities, materializes a canonical Researcher/Account (lookup by
 * entityKey, e.g. netid).
 */
import { startLongRunProgress } from '../utils/longRunProgress';
import {
  isPersonResearchRow,
  narrowedLabSiteDescriptionValue,
  withLabSiteDescriptionsNarrowedToResearch,
} from '../utils/researchStatementPassage';
import {
  everyCitedPersonPageUrl,
  identityWithPersonPageUrls,
  withoutNamesakePersonPageDescriptions,
} from './utils/namesakePersonPageDescriptions';
import {
  withoutRefusedNonYaleMicrositeDescriptions,
  withoutRefusedNonYaleMicrositePageFields,
} from './utils/nonYaleMicrositeDescriptionScreen';
import { leadGrantAwardRecordKeys } from './utils/grantRecordPage';
import { cachedCardFor } from './cardSynthesisDerivation';
import { withoutModelCalls } from '../utils/modelClient';
import {
  decideResearcherFieldWrite,
  isFillOnlyFieldValue,
  researcherFieldWriter,
  OWN_KEY_FALLBACK_TITLE_FIELD,
  storedValueCountsAsPresent,
  type ResearcherGatedField,
} from '../utils/researcherFieldWriters';
import { isDepartmentHeadingChrome } from './utils/departmentHeadingChrome';
import { withoutDepartmentHeadingObservations } from './departmentHeadingObservationScreen';
import {
  catalogDepartment,
  storedDepartmentAfterExportDecode,
  withDirectoryExportDepartmentsDecoded,
} from './directoryExportDepartmentEvidence';
import { storedDepartmentIsBacked } from './storedDepartmentBacking';
import type { CanonicalDepartment } from './utils/directoryExportDepartment';
import {
  primaryDepartmentStatingKeysForMaterialization,
  resetPrimaryDepartmentStatingKeysCache,
} from './primaryDepartmentStatingKeys';
import {
  changedResearcherPaths,
  expandUserMaterializerScope,
  partitionPlannedPaths,
  scopedResearcherUpdate,
  scopedResearcherWrites,
  ORCID_PROFILE_LINK_PATH,
  userScopeAdmits,
  valueAtPath,
  withoutRepeatedParentPaths,
} from './userMaterializerFieldScope';
import {
  planResearcherRefusedStoredValueClear,
  researcherHasLiveRefusals,
  researcherRefusesValue,
  withoutResearcherRefusedObservations,
} from '../utils/researcherFieldValueRefusals';
import { isGrantLaneObservationOutsideEnrichment } from './grantLaneSourceNames';
import {
  comparablePageStatedName,
  PAGE_STATED_NAME_SOURCES,
  withoutSiteSharedPageNames,
} from './siteSharedPageName';
import {
  inferredPiKeyNamesRoleOrUnitMailbox,
  userKeyNamesRoleOrUnitMailbox,
} from './roleMailboxUserKey';
import {
  isProfileTemplateChrome,
  withoutProfileTemplateWidgets,
} from '../utils/profileTemplateChrome';
import {
  researcherCarriesIdentityEvidence,
  type ResearcherIdentityEvidenceSource,
} from '../utils/researcherIdentity';
import mongoose from 'mongoose';
import {
  Observation,
  ObservedEntityType,
  type ObservationExtractionSource,
} from '../models/observation';
import {
  coreFacilityWebsiteKeysForMaterialization,
  isCoreFacilityWebsite,
  withoutCoreFacilityCitationsOnPersonRow,
  withoutCoreFacilityPagesOnPersonRow,
  withoutCoreFacilityPersonWebsiteObservations,
} from './coreFacilityWebsites';
import {
  isOverSharedPersonWebsite,
  overSharedPersonWebsiteKeysForMaterialization,
  withoutOverSharedPersonWebsiteObservations,
} from './overSharedPersonWebsite';
import {
  isOverSharedPersonImage,
  overSharedPersonImageKeysForMaterialization,
  withoutOverSharedPersonImageObservations,
} from './overSharedPersonImage';
import { ResearchEntity } from '../models/researchEntity';
import { websiteUrlIdentityKeyRedirectEquivalents } from '../services/websiteUrlRedirectLandings';
import {
  DERIVED_RESEARCH_AREA_SOURCE_NAME,
  RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
} from '../models/fieldProvenanceBacking';
import {
  derivedResearchAreaProvenance,
  loadResearchTopicsDerivation,
  researchPageTopicsStateFor,
  storedDerivedResearchAreasAreStale,
  type DerivedResearchAreaCandidate,
} from './researchPageTopicsDerivation';
import { RESEARCH_PAGE_TEXT_FIELD } from './utils/researchPageText';
import {
  archivedEntityUpdate,
  PROGRAM_GATE_DERIVED_FIELDS,
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
import { cannotOwnResearchHome } from '../utils/researchHomeOwnership';
import { looksLikeYaleNetid } from '../utils/yaleNetid';
import {
  buildResearchAreasCardSummary,
  deriveShortDescriptionFromFullDescription,
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
  isBiographyRatherThanResearch,
  opensByStatingResearch,
} from '../utils/biographyRatherThanResearch';
import {
  descriptionEntityKindForResearchEntity,
  isHighConfidencePersonBio,
} from '../utils/researchHomeDescriptionSelection';
import {
  isWeakCardLine,
  bodyFitsAsItsOwnCard,
  cardLineFitsBrowseCard,
  cardGroundingScore,
  isUngroundedSynthesizedCard,
  resolveGroundedCardDescription,
  servedCardClearsGateBar,
} from '../utils/groundedCardSynthesis';
import { isProgramTitleQualifierDrift, normalizedProgramTitleKey } from '../utils/programTitle';
import {
  collapseDuplicateResearchHomeSuffix,
  normalizeResearchEntityNameDashes,
  normalizeResearchEntityNameSmartQuotes,
  recaseAllCapsResearchEntityName,
  stripResearchHomeNameCaptionWrapper,
  stripResearchHomeNamePersonCredentials,
  stripTrailingResearchHomeDescription,
} from '../utils/researchEntityNameNormalization';
import {
  NO_SURNAME_ROSTER,
  eponymMatchesIdentity,
  eponymousLabNameSurnameCandidates,
  isPersonScopedResearchEntity,
  isPlaceholderEntityName,
  isUnrecoverablePersonScopedEntityName,
  namesAScholarlyEventSeries,
  personScopedNameIsACampusBuilding,
  facultyResearchNameFromUnassertedLabSuffix,
  labResearchEntityNameFromStaleFacultyResearchSuffix,
  personScopedResearchEntityNameFromLeadPersonName,
  personScopedResearchEntityNameFromPersonName,
  personScopedResearchEntityNameNamesSomethingElse,
  personIdentityTokens,
  isExternalScholarlyPlatformLinkLabelName,
  isOffSitePageTitleForPersonScopedName,
  isLabShapedResearchHome,
  isRefusedResearchEntityName,
  nameCarriesPersonIdentity,
  namesAResearchGroupRatherThanAPerson,
  entityKeyPersonTokens,
} from '../utils/researchHomeNameIdentityAuthority';
import {
  type LabRowRoster,
  loadKnownPersonSurnameRoster,
  loadLabRowRoster,
  loadResearchEntityLeadPersonIds,
  loadResearchEntityLeadPersonName,
  loadResearchEntitySoleLeadPersonId,
  normalizedLabRowName,
} from '../utils/researchHomeNameIdentityRoster';
import {
  deriveGrantEntryForLeads,
  NO_INVESTIGATOR_IS_PROVABLY_NOT_A_LEAD,
  recordedGrantInvestigators,
  type ProvablyNotALead,
} from './utils/grantInvestigators';
import { loadProvablyNotALead } from './utils/grantLeadIdentity';
import { isComposedFullNameLabName, ownLabEvidence } from '../utils/unbackedLabSelfDescription';
import {
  resolveAllFields,
  resolveField,
  resolveFieldRanked,
  ResolverObservation,
  ResolvedField,
  siteDeclaredOwnNamesFromObservations,
  sourceRanksOnlyAsFieldFallback,
  WRITTEN_DESCRIPTION_SOURCE_NAME,
} from './confidenceResolver';
import {
  MaterializationChunkPrefetch,
  prefetchObjectIdString,
  userKeyReferenceId,
  type MaterializationReadSource,
  type UserIdentityJoinCache,
  type UserKeyJoinEvidence,
  type UserKeyReference,
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
  noteResearcherSearchInputChange,
  researcherSearchDocumentInputs,
  researcherSearchDocumentInputsChanged,
  withResearcherSearchInputResync,
} from '../services/researcherLinkedSearchResync';
import {
  listResearchEntityMergedInRows,
  listResearchEntityMergedInRowsBySurvivor,
  resolveResearchEntityCanonicalByTombstone,
  type MergedInResearchEntityRow,
  type ResearchEntityTombstoneNode,
} from '../services/researchEntityCanonicalTombstone';
import {
  facultyResearchAreaSlugForPersonName,
  isLowTrustAreaShellSlug,
} from '../utils/researchEntityShellSlug';
import { sanitizeMethodChipLabel } from '../utils/researchAreaLabelHygiene';
import {
  deriveCanonicalKeys,
  resolveCanonical,
  type CandidateEntity,
  type CanonicalKey,
  type CanonicalResolution,
} from './resolveCanonical';
import {
  entitiesShareLeadPersonName,
  normalizeOrgDedupeName,
  normalizeWebsiteUrlIdentityKey,
  ORG_NAME_DEDUPE_ENTITY_TYPES,
  websiteUrlIdentityKeyVariants,
} from '../scripts/researchEntityPiDedupeCore';
import {
  isListedLabTargetKey,
  RELATIONSHIP_TARGET_LEAD_NAME_FIELD,
  RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
  relationshipTargetIdentities,
  type RelationshipTargetIdentity,
} from './centerRelationshipTarget';
import { isSweepStageEnabledByDefault } from '../scripts/sweepStageFlags';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import {
  currentDirectoryRemovalMintGuard,
  loadDirectoryRemovalMintGuard,
  REMOVED_BY_REQUEST,
  researcherIsRemovedByRequest,
  withDirectoryRemovalMintGuard,
} from '../services/directoryRemovalMintGuard';
import {
  liveResearchEntityNamedByKeyObservations,
  reslugAdoptedKeyNamesOnlyArchivedRows,
  researchEntityMintSlugNamesARemovedResearcher,
} from './renamedResearchEntityAdoption';
import {
  materializeAccessForResearchGroup,
  type AccessObservation,
  type AccessSignalChangePlan,
} from './accessMaterializer';
import {
  sanitizeObservationField,
  withHarvestTextDefectsCorrected,
} from './observationFieldSanitizer';
import {
  planStoredTextNormalization,
  type StoredTextNormalizationPlan,
} from './storedTextNormalization';
import { planFellowshipClassification } from './fellowshipClassificationDerivation';
import { fellowshipDisplayProse, OBSERVED_FELLOWSHIP_PROSE_FIELDS } from './fellowshipProse';
import {
  ENRICH_ONLY_FELLOWSHIP_SOURCES,
  FUND_AUTHORITY_FIELDS,
  FUND_RETIREMENT_FIELD,
  YALE_FELLOWSHIP_DATABASE_SOURCE,
  fellowshipAbsenceClearWithheldBySourcePrecedence,
  fellowshipFieldsWithheldBySourcePrecedence,
  storedFellowshipSourceUrlIsUnbacked,
  isWithdrawnFellowshipCitation,
  newestFundTitle,
} from './fellowshipSourcePrecedence';
import {
  fellowshipCitationsObservedIn,
  fundFacetsDescribeProgram,
  fundKeyCitedByFellowship,
  fundKeysCitedByFellowship,
  fundSpeaksForFellowship,
  newestFundRetirement,
  preferFundFacetObservations,
} from './fellowshipFundFacets';
import {
  fellowshipFieldsAssertedAbsent,
  planFellowshipAbsenceClears,
  withoutFellowshipFieldsAssertedAbsent,
  type FellowshipAbsenceClear,
} from './fellowshipFieldAbsence';
import {
  FELLOWSHIP_EVIDENCE_ONLY_FIELDS,
  planFellowshipUnbackedFieldClears,
} from './fellowshipUnbackedFieldClear';
import {
  isDirectoryGraftCitation,
  planDirectoryGraftCitationRetraction,
} from './directoryGraftCitations';
import {
  planRefusedStoredWebsiteUrlClear,
  planWithheldLegacyWebsiteClear,
} from './refusedStoredWebsiteUrl';
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
  CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
  isLegacyFacultyResearchEntityType,
  isPersonScopedResearchEntityShape,
} from '../models/storedVocabularies';
import {
  isPersonRowForProfileHomeClaims,
  profileHomeClaimKey,
  profileHomeOrganizationClaimKeys,
  withoutPersonRowOrganizationHomeClaims,
  type ProfileHomeClaimObservation,
} from './personRowOrganizationClaims';
import {
  storedFieldIsCreditedToACoursePage,
  withoutCoursePageEvidence,
} from './coursePageEvidenceScreen';
import {
  directoryContradictsNetidForAddress,
  directoryNetidsOf,
  directoryOwnerNetidsOfAddresses,
  loadDirectoryNetidsByAddress,
  netidOfNetidUserKey,
  screenDirectoryContradictedProfileEvidenceForKey,
  withoutDirectoryContradictedProfileEvidenceForKey,
  profilePageContradictsNetid,
  profilePageOwnerNetids,
  type ProfilePageOwnerNetids,
} from './directoryContradictedProfileNetid';
import { derivedResearcherEmail } from './verifiedResearcherEmail';
import { STAFF_SCREENED_ROSTER_ROLES, screenedRosterRole } from './rosterStaffTitleScreen';
import {
  loadResearchEntityLeadPageDeparture,
  type PersonPageDeparture,
} from './personPageDeparture';
import {
  storedResearchAreasCameFromAPersonProfileOnAnOrganizationRow,
  withoutPersonProfileTopicsOnOrganizationRow,
} from './personProfileTopicScreen';
import {
  REFUSED_WEBSITE_URL_FIELD,
  isLaneWithdrawnWebsiteUrl,
  type LaneWithdrawableWebsiteField,
  planLaneWithdrawnWebsiteUrlClear,
  withoutLaneRefusedWebsiteUrls,
} from './laneRefusedWebsiteUrl';
import {
  REFUSED_RESEARCH_HOME_NAME_FIELD,
  withoutLaneRefusedResearchHomeNames,
} from './laneRefusedResearchHomeName';
import {
  LANE_PAGE_HEALTH_FIELD,
  planGoneLanePageFieldClears,
  withoutGoneLanePageObservations,
} from './lanePageHealth';
import {
  planNeverBackedFieldProvenanceRetirement,
  planUnrecordedProvenanceObservationRelink,
} from './neverBackedFieldProvenance';
import { planRetiredEvidenceFieldClears } from './retiredEvidenceFieldClear';
import {
  planCollectivePageStoredDescriptionClears,
  planProfileTemplateChromeStoredDescriptionClears,
  planRefusedStoredDescriptionClears,
} from './refusedStoredDescription';
import {
  evidenceMemberOf,
  mergedInEntityKeysAndIds,
  mergedInMemberOf,
  mergedRowEvidenceIdentity,
  observationBelongsToMergedRow,
} from './mergedRowEvidenceIdentity';
import { grantCoPiListedPersonIds } from './grantCoPiListing';
import {
  isPersonRow,
  leadsTheRowIsNamedAfter,
  mergedRedirectAdmission,
  type MergedRedirectAdmission,
  type MergedRedirectLead,
} from './mergedRedirectIdentity';
import { stripInvisibleFormatCharacters } from '../utils/invisibleFormatCharacters';
import { servablePersonTitle, stripTitleFieldLabel } from '../utils/titleHygiene';
import type { ReportPostMaterializationMetrics } from './runReport';
import { withoutUnsupportedMethodClauses } from '../utils/methodClauseSupport';
import { isModelTextSource } from './sourceCoverageRegistry';
import {
  statesPersonalPastFraming,
  restatesPastFramedEvidence,
} from './utils/extractedDescriptionScope';
import {
  isResearchAreaEchoDescription,
  isStudiesResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { cleanPublicProfileBio } from '../services/profileService';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { withoutAdviseeProgramsMovedToMentors } from '../services/hostedUndergraduates';
import { servedResearchEntityCopy } from '../services/servedResearchEntityCard';
import { agenciesBackedByRunningAwards } from '../services/servedCurrentFunding';
import { isKnownDeadSourceUrl } from '../services/sourceLinkHealth';
import {
  SITE_TITLE_LAB_NAME_SOURCE,
  isUnbackedLabNameShell,
} from '../services/studentVisibilityTier';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isEphemeralDeployHostUrl, isSelfReferentialUrl } from '../utils/urlSafety';
import { evidenceAssertsALab } from './utils/labClaimEvidence';
import { normalizePersonNameCasing } from './utils/personNameCasing';
import { sanitizePersonGivenName, sanitizePersonName } from '../utils/personNameHygiene';
import {
  anyNamesStateConflictingMiddleInitials,
  observedPersonNameAgreesWith,
} from './utils/personNameAgreement';
import { namesStatedAtPersonPages, personPagesStatingOrcid } from './utils/personPageStatedNames';
import { SURNAME_FETCH_LIMIT, statesMiddleInitial, surnameFetchRegex } from './utils/piNameMatch';
import {
  parseRosterMemberIdentityEvidence,
  ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
  type RosterMemberIdentityEvidence,
} from './utils/rosterMemberIdentityEvidence';
import { isRoleOrUnitMailbox, splitName, yaleUnitMailboxTokens } from './utils/scraperHelpers';
import { isTraineeLevelTitle } from '../utils/traineeLevelTitle';
import {
  isBoilerplatePlatformHostUrl,
  isCoursePageUrl,
  isDirectoryLoaderUrl,
  isFacetedOrSectionIndexUrl,
  isInadmissiblePersonWebsiteUrl,
  isInstitutionalAdvancementUrl,
  isMapOrDirectionsUrl,
  isPostingPageUrl,
  recordSpecificApplicationPortalIdentity,
  isLinkedPublicationOrDocumentUrl,
  researchHomeWebsiteUrlWriteRefusal,
  isWithheldResearchWebsiteUrl,
  withoutUncreditedCreditOnlyCitations,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';
import {
  isSamePersonWebsite,
  preferredPersonWebsiteCandidate,
  websiteStandsAboveStored,
  websiteStandsBelowStored,
} from '../utils/personWebsiteStanding';
import { namesAPostingRatherThanResearch } from '../utils/postingName';
import {
  isLikelyOfficialPersonProfileUrl,
  normalizeOfficialProfileDestination,
  officialProfileDestinationStoredPattern,
} from '../services/leadProfileIdentity';
import {
  directoryPairsAddressesWithAnotherNetid,
  officialProfileLinkHeldByConflictingIdentity,
} from '../services/officialProfileLinkIdentity';
import {
  planStoredUndergradEvidenceQuoteClear,
  sourcesWithdrawingUndergradEvidenceQuote,
  undergradEvidenceQuoteIsInadmissible,
  withoutWithdrawnUndergradEvidenceQuotes,
} from './storedUndergradEvidenceQuote';
import { withResearchEntityWriteTransaction } from '../services/researchEntityWriteTransaction';
import { carryResearchPlansToSurvivor } from '../services/researchPlanMergeCarry';
import { archiveResearchEntities } from '../services/archivedResearchEntityRoleEdges';
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
  canonicalMemberIsRemovedByRequest,
  identifiedResearcherHoldsDisplayName,
  materializeCanonicalMembership,
  nameOnlyResolutionName,
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
import { latestFullCoverageRunIdByLane } from './latestFullCoverageRun';
import {
  officialProfileIdentityUrlKey,
  officialProfileUrlSpellings,
} from './utils/officialProfileIdentityUrlKey';
import {
  embeddedNetidContradictsCandidate,
  netidsEmbeddedInUserEvidence,
} from './utils/embeddedNetidContradiction';
import { personPagesNameDifferentPeople } from './utils/officialProfilePageIdentityConflict';
import { grantAwardIdentity } from './utils/grantAwardIdentity';
import { reconcileRosterMintWithdrawalsFromRun } from './rosterMintWithdrawal';
import { reconcileBbsTrackRetirementsFromRun } from './bbsTrackRosterRetirement';
import { reconcileCenterAffiliationHandOffFromRun } from './centerAffiliationHandOff';
import {
  reconcileCenterDirectorRetirementsFromRun,
  reconcileCodeLaneDirectorRetirementsFromRun,
} from './centerDirectorRetirement';
import { CENTER_DIRECTOR_SOURCE_NAME } from './centerDirectorReadSnapshot';
import {
  OFFICIAL_PROFILE_DIRECTOR_LANE,
  reconcileOfficialProfileDirectorRetirementsFromRun,
} from './officialProfileDirectorRetirement';
import {
  CENTER_AFFILIATION_CODE_ROSTER_LANE,
  CENTER_AFFILIATION_ROSTER_LANE,
  CENTER_AFFILIATION_ROSTER_SOURCE_NAME,
  CENTERS_INSTITUTES_ROSTER_LANE,
  CENTERS_INSTITUTES_SOURCE_NAME,
  reconcileCenterRosterRetirementsFromRun,
  type CenterRosterLane,
  type CenterRosterRetirementDeps,
  type CenterRosterRetirementResult,
} from './centerRosterRetirement';
import {
  resolveResearcherIdForPersonName,
  type ResearcherPersonNameResolution,
} from '../services/researcherPersonNameResolver';
import { isPlausiblePersonOrcid, plausiblePersonOrcid } from '../utils/orcid';
import {
  Researcher,
  orcidProfileLinksAgreeWithIdentifier,
  researcherDisplayProfileSchema,
  type ResearcherDisplayProfile,
  type ResearcherEmailSupport,
  type ResearcherProfileLink,
} from '../models/researcher';
import { Account } from '../models/account';
import {
  composeOfficialProfileLink,
  selectOfficialYaleProfileUrl,
  supersedesOfficialProfileUrl,
} from '../scripts/backfillResearcherOfficialProfileLinksCore';
import { canonicalScholarCitationUrl } from '../scripts/promoteScholarCandidateProfileLinksCore';
import {
  protectedRoleEdgeFor,
  RoleAssignment,
  type RoleAssignmentRole,
  type RoleAssignmentRosterProvenance,
  type RosterIdentityBasis,
} from '../models/roleAssignment';
import {
  DEPARTMENT_ROSTER_HEALTH_FIELD,
  isEntityAuthoritativeSnapshot,
  reconcileFacultyRosterDeparturesFromRun,
  rosterHealthReadAt,
  snapshotDiscoveredEntityKeys,
  type DepartmentRosterHealthSnapshot,
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
import {
  isLlmDescriptionFromDepartmentCollectivePage,
  ownershipGuardedCitedUrls,
} from './descriptionSourceOwnership';
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
import { recordScrapeRunProgress } from './scrapeRunProgress';
import {
  canonicalRoleForLegacy,
  LEAD_ROLE_CANONICAL_VALUES,
  LEAD_ROLE_LEGACY_LABELS,
  LEGACY_ROLE_BY_CANONICAL,
} from '../models/canonicalRoleMapping';
import {
  RESEARCH_HOME_CANDIDATE_FIELDS,
  rowIsNamedForPerson,
  type GrantTargetPerson,
  type ResearchHomeCandidate,
} from './canonicalResearchHomeResolver';
import { isYaleHostname } from '../utils/yaleHost';
import {
  loadCurrentLeadPersonIdsByEntity,
  loadDistinctPeopleVerdictIndex,
  mergeGroupJoinsDistinctPeople,
} from '../services/distinctPeopleVerdicts';
import { distinctPeopleVerdictPairsJoinedByFold } from './distinctPeopleVerdict';

interface MaterializeOptions {
  dryRun?: boolean;
  /**
   * Plan as if these archived research rows were already deleted, so a dry run answers
   * whether deleting a retired row would let the next resolve mint it again (#5189).
   * `dryRun` is required: the option asks a question, and a projection planned against a
   * row that still exists must never reach a write.
   */
  treatArchivedResearchEntitiesAsAbsent?: ReadonlySet<string>;
  chunkPrefetch?: MaterializationReadSource;
  syncMeilisearch?: boolean;
  synthesizeCardDescription?: CardSynthesizer;
  resynthesizeCutCards?: boolean;
  resynthesizeWeakCards?: boolean;
  cardModel?: string;
  writeOnlyFields?: string[];
  userWriteOnlyFields?: readonly string[];
  /**
   * Keep the field-less post-projection steps (inferred lead edges, access-signal
   * upserts, the department-roster fold) on a `writeOnlyFields` pass. The merge
   * fill-only pass needs them to carry the merged-in evidence; the rematerialize
   * report compares fields and would not see them, so it leaves this off (#3874).
   */
  keepPostProjectionEvidence?: boolean;
  accessSignalsOnly?: boolean;
  /**
   * Resolve only the row's lead edges from its inferred-lead evidence, projecting no field. A
   * field-scoped pass skips edges because its report compares fields (#3874), so this is the
   * one scope that reaches them; a dry run reports the plan instead of writing it.
   */
  leadEdgesOnly?: boolean;
  onlyReconcileFieldProvenance?: boolean;
  /**
   * Observed entity types a run materialize leaves untouched (#5890). Their rows are neither read
   * into a projection nor written; the run's other types and its reconciliation still run.
   */
  skipEntityTypes?: readonly string[];
  /**
   * Plan center roster retirement without applying it, for every center roster lane, so a run
   * whose roster read is known to miss listed members can still project its listings (#5897).
   */
  skipCenterRosterRetirement?: boolean;
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

export type CardSynthesizer = (
  fullDescription: string,
  evidenceTexts?: readonly string[],
) => Promise<string>;

/**
 * Materialization reads cached outputs only and never calls a model (#5537): the card for the
 * body being projected comes from the card cache, judged now, and a body with no entry gets
 * no new card, so the card resolution falls back to its stored, copied and derived candidates.
 */
export function defaultMaterializerCardSynthesizer(
  entityName: string = '',
  _model?: string,
): CardSynthesizer {
  return (fullDescription, evidenceTexts) =>
    cachedCardFor({ fullDescription, evidenceTexts, entityName });
}

/**
 * Fields the materializer co-derives in one pass, so a field-scoped materialization
 * that writes one member without the rest of its closure would reintroduce the very
 * drift it was run to remove (#2144). `kind` is a pure function of `entityType`;
 * `applyResearchEntityOrgUnitCanonicalization` recomputes `schools` from `school`
 * plus `departments` and `orgAffiliationLabels` from `departments`, so a scope that
 * wrote `departments` alone would leave the stored `schools` facet describing the
 * old departments. `aggregateResearchEntityGrantEvidence` derives the four grant
 * fields from one award union, so a count written without its list would disagree.
 * The Yale-status derivation writes its cache, its active flag and its reason together,
 * so a scope naming one of them writes all three (#5721).
 * Each closure is symmetric because every member is a legal
 * `--only-fields` value (#2536).
 */
export const YALE_STATUS_DERIVED_FIELDS = [
  'yaleStatusCache',
  'activeAtYaleCache',
  'yaleStatusReasonCache',
] as const;

export const MATERIALIZER_DERIVED_FIELD_GROUPS: ReadonlyArray<readonly string[]> = [
  ['entityType', 'kind'],
  ['school', 'schools', 'departments', 'orgAffiliationLabels'],
  ['recentGrants', 'recentGrantPeriods', 'recentGrantCount', 'fundingAgencies'],
  YALE_STATUS_DERIVED_FIELDS,
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
  // A Yale-status re-derivation reads stored evidence and observes nothing new, so a scope
  // made only of it leaves the row's observation stamp alone.
  const observesTheRow = valueFields.some(
    (field) => !(YALE_STATUS_DERIVED_FIELDS as readonly string[]).includes(field),
  );
  if (observesTheRow) set.lastObservedAt = new Date();
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
  /**
   * A repair pass's test for a card that clears the bar but does not say what is studied
   * (`isWeakCardLine`). Set only by `--resynthesize-weak-cards`; a weak current
   * card is then reconsidered and replaced only by a line that shows whole and is not weak.
   */
  weakCard?: (card: string) => boolean;
  /**
   * Lets a stored card that clears the bar but is cut on the browse card reach card
   * synthesis. Off by default because a synthesis that yields no fitting line writes
   * nothing, so every routine materialize of that row would repeat the same LLM calls.
   */
  resynthesizeCutCards?: boolean;
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
  if (!sanitizeResearchEntityShortDescription(candidate)) return false;
  if (isUngroundedSynthesizedCard({ card: candidate, body: fullDescription })) return false;
  const shortQuality = isProgramLike ? programCardShortDescriptionQuality : shortDescriptionQuality;
  return shortQuality(candidate, fullDescription).isUseful;
}

/**
 * Whether the body this pass serves is the written description (#4788), in which case
 * its card is chosen by `resolveWrittenBodyCard` rather than by the copied-card path.
 */
export function writtenBodyCardBasis(input: {
  set: Record<string, unknown>;
  entityDoc: any;
  fullDescription: string;
  cardLocked: boolean;
}): { followsWrittenBody: boolean } {
  if (input.cardLocked || !input.fullDescription) return { followsWrittenBody: false };
  const fullProvenance = (
    Object.hasOwn(input.set, 'fullDescription')
      ? input.set['fieldProvenance.fullDescription']
      : input.entityDoc?.fieldProvenance?.fullDescription
  ) as { sourceName?: unknown } | undefined;
  return { followsWrittenBody: fullProvenance?.sourceName === WRITTEN_DESCRIPTION_SOURCE_NAME };
}

/**
 * The share of a kept card's distinctive tokens the written body must contain. It is the
 * written body's own grounding floor against its evidence (`COVERAGE_MIN_OVERLAP`), so a
 * copied card is kept only when it is about what the body says. A card the serve chain
 * would surrender as ungrounded is refused separately, by the serving bar.
 */
const WRITTEN_BODY_KEPT_CARD_MIN_GROUNDING = 0.45;
const WRITTEN_BODY_CARD_SYNTHESIS_ATTEMPTS = 2;

/**
 * The two shapes a written body's card must never take (#4788 follow-up): a sentence
 * that only re-lists the row's topic chips, which the serve sanitizer blanks, and the
 * body itself, which leaves no card beside the body it restates.
 */
export function isRefusedWrittenBodyCard(
  card: string,
  body: string,
  researchAreas: unknown,
): boolean {
  return (
    !card ||
    card.toLowerCase() === body.toLowerCase() ||
    isFullDescriptionRestatementOfShortDescription(body, card) ||
    isTopicChipEchoCard(card, researchAreas)
  );
}

function isTopicChipEchoCard(card: string, researchAreas: unknown): boolean {
  const areas = Array.isArray(researchAreas) ? researchAreas : [];
  const chipSummary = buildResearchAreasCardSummary(areas);
  return (
    (!!chipSummary && card.toLowerCase() === chipSummary.toLowerCase()) ||
    isStudiesResearchAreaEchoDescription(card, areas) ||
    isResearchAreaEchoDescription(card)
  );
}

interface WrittenBodyCardCheckInput {
  card: string;
  body: string;
  researchAreas: unknown;
  servingBarAccepts: (card: string) => boolean;
  requireGrounding: boolean;
  evidenceTexts?: readonly string[];
}

export function isAcceptableWrittenBodyCard(input: WrittenBodyCardCheckInput): boolean {
  return (
    !isRefusedWrittenBodyCard(input.card, input.body, input.researchAreas) &&
    passesWrittenBodyCardContentChecks(input)
  );
}

/**
 * A written body that fits the card limits and passes every content check a card is held
 * to serves as its own card (owner decision 2026-11-12, #5537). The #4788 refusal of a
 * card that restates its body is not applied, because here the card is the body; a body
 * longer than a card still refuses a card that restates it.
 */
export function isAcceptableBodyAsItsOwnCard(
  input: Omit<WrittenBodyCardCheckInput, 'card' | 'requireGrounding'>,
): boolean {
  const body = textValue(input.body);
  return (
    bodyFitsAsItsOwnCard(body) &&
    !isTopicChipEchoCard(body, input.researchAreas) &&
    passesWrittenBodyCardContentChecks({ ...input, card: body, requireGrounding: false })
  );
}

function passesWrittenBodyCardContentChecks(input: WrittenBodyCardCheckInput): boolean {
  return (
    withoutUnsupportedMethodClauses(input.card, [input.body, ...(input.evidenceTexts ?? [])])
      .stripped === 0 &&
    !statesPersonalPastFraming(input.card) &&
    !restatesPastFramedEvidence(input.card, [input.body, ...(input.evidenceTexts ?? [])]) &&
    (!input.requireGrounding ||
      cardGroundingScore(input.card, input.body) >= WRITTEN_BODY_KEPT_CARD_MIN_GROUNDING) &&
    input.servingBarAccepts(input.card)
  );
}

const WRITTEN_BODY_CARD_EVIDENCE_FIELDS = new Set([
  'fullDescription',
  'shortDescription',
  'description',
  'summary',
  'bio',
  'researchInterestSummary',
  'researchSummary',
]);

const INGEST_CHECKED_DESCRIPTION_SOURCE = 'lab-microsite-description-llm';

/**
 * The page text a card is checked against, beside the body it serves with, so a method a
 * card names is checked against what the pages say rather than against the body alone
 * (#4914). The body itself is passed separately. Model-written values are left out as the
 * writer leaves them out, except the extraction lane's body, which that lane checks
 * against its fetched page, and a profile template's widget labels, which describe no
 * one, are removed.
 */
export function cardDescriptionEvidence(observations: readonly ResolverObservation[]): string[] {
  return observations
    .filter(
      (obs) =>
        WRITTEN_BODY_CARD_EVIDENCE_FIELDS.has(obs.field) &&
        (!isModelTextSource(obs.sourceName) ||
          (obs.sourceName === INGEST_CHECKED_DESCRIPTION_SOURCE &&
            obs.field === 'fullDescription')) &&
        typeof obs.value === 'string',
    )
    .map((obs) => withoutProfileTemplateWidgets(obs.value))
    .filter(Boolean);
}

/**
 * A card the body does not write, a lane's copied card or one stored before the method
 * rule, held to the rule a written body's card is (#4914): an unsupported method clause
 * is stripped, leaving the claim it modified, and `card` is null when nothing is left.
 */
export function methodCheckedCopiedCard(
  card: unknown,
  body: string,
  evidenceTexts: readonly string[],
): { card: string | null; changed: boolean } {
  const text = textValue(card);
  if (!text) return { card: text || null, changed: false };
  const outcome = withoutUnsupportedMethodClauses(text, [body, ...evidenceTexts]);
  if (outcome.stripped === 0) return { card: text, changed: false };
  return { card: outcome.text, changed: true };
}

/**
 * A copied card the browse card cuts does not displace a stored card that shows whole and
 * that the body still supports: every materialize re-projects the lane's card, so without
 * this a line a `--resynthesize-cut-cards` pass wrote was reverted by the next routine
 * materialize (#4834).
 */
export function storedCardOutranksCutCopiedCard(input: {
  copiedCard: unknown;
  storedCard: unknown;
  body: string;
  isProgramLike: boolean;
}): boolean {
  const copied = textValue(input.copiedCard);
  const stored = textValue(input.storedCard);
  if (!copied || !stored || copied === stored) return false;
  if (writtenBodyCardShowsWhole(copied, input.body)) return false;
  return (
    writtenBodyCardShowsWhole(stored, input.body) &&
    resolvedShortDescriptionCandidateIsUsable(stored, input.body, input.isProgramLike)
  );
}

export type WrittenBodyCardChoice =
  | { kind: 'stored'; card: string }
  | { kind: 'observed'; card: string; index: number }
  | { kind: 'derived'; card: string }
  | { kind: 'synthesized'; card: string }
  | { kind: 'body'; card: string }
  | { kind: 'none' };

/**
 * A card the browse card shows as written: it fits, and the serve chain will not surrender
 * it as ungrounded for the body's longer lead. A card synthesized from page evidence can
 * name what the body does not, and 89 of 120 cut served cards on Development on
 * 2026-10-05 were fitting stored cards surrendered that way (#4809).
 */
export function writtenBodyCardShowsWhole(card: string, body: unknown): boolean {
  return cardLineFitsBrowseCard(card) && !isUngroundedSynthesizedCard({ card, body });
}

/**
 * The card a written body serves with. A candidate is acceptable when it is not a
 * topic-chip echo or the body itself and the serving bar accepts it; stored and observed
 * cards must also be grounded in the written body. The order is: the first acceptable
 * candidate (stored, then each copied card observation, then the body's own lead
 * sentence) that shows whole on the browse card; else a synthesized line that shows whole;
 * else the first acceptable candidate even though the browse card cuts it; else a
 * synthesized line that does not show whole; else the body itself when it fits as its own
 * card (`isAcceptableBodyAsItsOwnCard`); else no card rather than a wrong one.
 *
 * Synthesis is spent only when a candidate showing whole on the browse card is missing and the
 * caller hands over `synthesize`, at most WRITTEN_BODY_CARD_SYNTHESIS_ATTEMPTS calls. The
 * materializer hands it over when the written body changed or the stored card is
 * unacceptable, which bounds the spend to once per body version, and for a stored cut
 * card only under --resynthesize-cut-cards, so a routine re-materialize of an unchanged
 * body with an acceptable stored card stays stable and makes no call.
 */
export async function resolveWrittenBodyCard(input: {
  body: string;
  storedCard: unknown;
  observedCards: readonly unknown[];
  researchAreas: unknown;
  servingBarAccepts: (card: string) => boolean;
  evidenceTexts?: readonly string[];
  synthesize?: CardSynthesizer;
  isWeak?: (card: string) => boolean;
}): Promise<WrittenBodyCardChoice> {
  const preferred = (card: string): boolean =>
    writtenBodyCardShowsWhole(card, input.body) && !(input.isWeak?.(card) ?? false);
  const acceptable = (card: string, requireGrounding: boolean): boolean =>
    isAcceptableWrittenBodyCard({
      card,
      body: input.body,
      researchAreas: input.researchAreas,
      servingBarAccepts: input.servingBarAccepts,
      requireGrounding,
      evidenceTexts: input.evidenceTexts,
    });
  const stored = textValue(input.storedCard);
  const candidates: Exclude<WrittenBodyCardChoice, { kind: 'none' }>[] = [];
  if (stored && acceptable(stored, true)) candidates.push({ kind: 'stored', card: stored });
  for (const [index, value] of input.observedCards.entries()) {
    const card = textValue(value);
    if (card && card !== stored && acceptable(card, true)) {
      candidates.push({ kind: 'observed', card, index });
    }
  }
  const derived = textValue(deriveShortDescriptionFromFullDescription(input.body));
  if (derived && acceptable(derived, false)) candidates.push({ kind: 'derived', card: derived });
  // A card the browse card would cut mid-sentence is held back while a line that shows
  // whole is sought, and is still the answer when none is found (#4809).
  const fitting = candidates.find((choice) => preferred(choice.card));
  if (fitting) return fitting;
  if (input.synthesize) {
    let longSynthesized = '';
    for (let attempt = 0; attempt < WRITTEN_BODY_CARD_SYNTHESIS_ATTEMPTS; attempt += 1) {
      const card = textValue(await input.synthesize(input.body, input.evidenceTexts));
      if (!card || !acceptable(card, false)) continue;
      if (preferred(card)) return { kind: 'synthesized', card };
      longSynthesized ||= card;
    }
    if (candidates[0]) return candidates[0];
    if (longSynthesized) return { kind: 'synthesized', card: longSynthesized };
  }
  if (candidates[0]) return candidates[0];
  return isAcceptableBodyAsItsOwnCard(input)
    ? { kind: 'body', card: textValue(input.body) }
    : { kind: 'none' };
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
    Boolean(sanitizeResearchEntityShortDescription(current)) &&
    shortQuality(input.currentShortDescription, input.fullDescription).isUseful;
  const currentFitsBrowseCard =
    writtenBodyCardShowsWhole(current, input.fullDescription) &&
    !(input.weakCard?.(current) ?? false);
  if (currentClearsCardBar && currentFitsBrowseCard && !input.reconsiderCurrentShortDescription) {
    return null;
  }
  const currentIsCutCard = currentClearsCardBar && !currentFitsBrowseCard;
  const reconsideredOnlyBecauseCut = currentIsCutCard && !input.reconsiderCurrentShortDescription;
  const grounded = await resolveGroundedCardDescription({
    fullDescription: input.fullDescription,
    researchAreas: input.researchAreas,
    isProgramLike: input.isProgramLike,
    synthesize:
      currentIsCutCard && !input.resynthesizeCutCards && !(input.weakCard?.(current) ?? false)
        ? undefined
        : input.synthesize,
    refuseCandidate: (candidate) => !sanitizeResearchEntityShortDescription(candidate),
    isWeak: input.weakCard,
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
  // A current card reconsidered only because the browse card cuts it is replaced
  // only by a line that shows whole; trading one cut line for another is churn.
  if (
    reconsideredOnlyBecauseCut &&
    (!writtenBodyCardShowsWhole(grounded, input.fullDescription) ||
      (input.weakCard?.(grounded) ?? false))
  ) {
    return null;
  }
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
  /** Rows other than this one whose write this materialize made but whose index sync failed. */
  otherIndexSyncFailedEntityIds?: string[];
  skipped?: string;
  plannedSet?: Record<string, unknown>;
  plannedUnset?: Record<string, ''>;
  plannedWriteSkip?: 'no-scoped-fields' | 'unchanged';
  plannedPaths?: string[];
  droppedPaths?: string[];
  identityJoin?: UserIdentityJoin;
  unbackedResearchAreas?: UnbackedResearchAreaOutcome;
  /** Fellowship fields this pass cleared because their only source states they have none. */
  fellowshipAbsenceClears?: FellowshipAbsenceClear[];
  /** Fellowship fields this pass cleared because no live observation states them (#4586). */
  fellowshipUnbackedClears?: string[];
  accessSignalChanges?: AccessSignalChangePlan;
  leadEdgeResolution?: LeadEdgeResolution;
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
const MATERIALIZED_DESCRIPTION_FIELDS = new Set([
  'fullDescription',
  'shortDescription',
  'description',
]);
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

function plannedWriteSkipReason(
  set: Record<string, unknown>,
  unset: Record<string, unknown>,
): 'no-scoped-fields' | 'unchanged' {
  return Object.keys(set).length === 0 && Object.keys(unset).length === 0
    ? 'no-scoped-fields'
    : 'unchanged';
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
 *
 * The pairing is per read rather than per row: a read whose name was refused at ingest still
 * restated the type, and an older read's name kept that newer type live (#5283).
 */
export function withoutUnpairedProfileHomeIdentity<T extends ProfileHomeClaimObservation>(
  observations: T[],
  fieldValueRefusals: unknown,
): T[] {
  const namedClaims = new Set(
    observations
      .filter(
        (observation) =>
          observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
          observation.field === 'name' &&
          textValue(observation.value).length > 0 &&
          !valueIsRefused(fieldValueRefusals, 'name', observation.value),
      )
      .map(profileHomeClaimKey),
  );
  return observations.filter(
    (observation) =>
      observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
      !PROFILE_HOME_PAIRED_IDENTITY_FIELDS.has(String(observation.field)) ||
      namedClaims.has(profileHomeClaimKey(observation)),
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
  derivedResearchAreas?: DerivedResearchAreaCandidate;
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
  const provenance =
    fieldProvenanceForResolvedObservation('researchAreas', resolved, input.materializationObs) ??
    derivedResearchAreaProvenanceFor('researchAreas', resolved, input.derivedResearchAreas);
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

/**
 * Whether the source the stored topics are credited to has had its own claim on this row retired.
 *
 * The union rule keeps a stored list no live observation states, because a hand-read found such
 * chips right 29 of 39 times (#3836). A list whose credited source then retired the very claim
 * that set it is not of unknown standing: the evidence was withdrawn, so keeping the list would
 * make every lane retirement inert on a row no other source describes (#3980).
 */
async function storedResearchAreasSourceRetiredItsClaim(
  entityDoc: any,
  mergedInRows: ReadonlyArray<Pick<MergedInResearchEntityRow, '_id' | 'slug'>>,
): Promise<boolean> {
  const sourceName = objectRecord(
    objectRecord(entityDoc?.fieldProvenance).researchAreas,
  ).sourceName;
  if (typeof sourceName !== 'string' || !sourceName) return false;
  if (sourceName === DERIVED_RESEARCH_AREA_SOURCE_NAME) return false;
  const rows = [entityDoc, ...mergedInRows];
  const ids = rows.flatMap((row) => {
    const id = serializedDocumentId(row?._id);
    return id
      ? [id, ...(mongoose.isValidObjectId(id) ? [new mongoose.Types.ObjectId(id)] : [])]
      : [];
  });
  const slugs = rows.map((row) => textValue(row?.slug)).filter(Boolean);
  if (ids.length === 0 && slugs.length === 0) return false;
  const retired = await Observation.exists({
    sourceName,
    field: 'researchAreas',
    superseded: true,
    'rollback.rolledBackAt': { $exists: true },
    $or: [{ entityId: { $in: ids } }, { entityKey: { $in: slugs } }],
  });
  return Boolean(retired);
}

export type UnbackedResearchAreaOutcome =
  | 'retired-with-its-evidence'
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
  storedEvidenceRetired?: boolean;
  derive: typeof applyDescriptionResearchAreaDerivation;
  canonicalizeResearchAreas: ResearchAreaCanonicalizationStep;
}): Promise<UnbackedResearchAreaOutcome> {
  const { set, unset, entityDoc } = input;
  const stored: unknown[] = Array.isArray(entityDoc?.researchAreas) ? entityDoc.researchAreas : [];
  const kept: unknown[] =
    'researchAreas' in set
      ? Array.isArray(set.researchAreas)
        ? set.researchAreas
        : []
      : input.storedEvidenceRetired
        ? []
        : stored;
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
    if (input.storedEvidenceRetired && kept.length === 0) {
      set.researchAreas = [];
      return 'retired-with-its-evidence';
    }
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

/**
 * A stored name the engine now refuses: a profile-linked home shape this lane stored before
 * it refused that shape at the name step (#5226), or a sentence-shaped name from any lane
 * (#5739). A refusal retracts nothing, so the stored value stays live. The type and kind the
 * profile lane paired with its name then fall through `withoutUnpairedProfileHomeIdentity`.
 */
function isInadmissibleProfileHomeName(observation: MaterializerObservationLike): boolean {
  return (
    (observation.field === 'name' || observation.field === 'displayName') &&
    isRefusedResearchEntityName(observation.value, observation.sourceName)
  );
}

export function shouldIgnoreObservationForEntityMaterialization(
  entityType: ObservedEntityType,
  observation: MaterializerObservationLike,
): boolean {
  if (observation.field && MATERIALIZER_MANAGED_FIELDS.has(observation.field)) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    isObservationOnlyResearchEntityField(observation.field)
  ) {
    return true;
  }
  if (entityType === 'user' && observation.field === OFFICIAL_PROFILE_PUBLICATIONS_FIELD) {
    return true;
  }
  if (entityType === 'fellowship' && isWithdrawnFellowshipCitation(observation)) {
    return true;
  }
  if (entityType === 'user' && isOfficialProfileBioChromeObservation(observation)) {
    return true;
  }
  if (
    entityType === 'user' &&
    (observation.field === 'website' || observation.field === 'websiteUrl') &&
    isInadmissiblePersonWebsiteUrl(observation.value)
  ) {
    return true;
  }
  if (
    entityType === 'user' &&
    observation.field === 'title' &&
    typeof observation.value === 'string' &&
    !servablePersonTitle(observation.value)
  ) {
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
  if (
    isResearchEntityObservationType(entityType) &&
    observation.field === 'methods' &&
    statesNoAdmissibleMethod(observation.value)
  ) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    (observation.field === REFUSED_WEBSITE_URL_FIELD ||
      observation.field === REFUSED_RESEARCH_HOME_NAME_FIELD ||
      observation.field === LANE_PAGE_HEALTH_FIELD)
  ) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    isGrantLaneObservationOutsideEnrichment(observation)
  ) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    observation.field === 'inferredPiUserKey' &&
    inferredPiKeyNamesRoleOrUnitMailbox(
      userEntityKeyForInferredPiUserKey(observation.value),
      observation,
    )
  ) {
    return true;
  }
  // A course page describes a class, so nothing read off it is evidence about a research
  // entity: dropping it here keeps an already-stored course name, type or description
  // inert on every resolve without a lock (#5213).
  if (isResearchEntityObservationType(entityType) && isCoursePageUrl(observation.sourceUrl)) {
    return true;
  }
  if (isResearchEntityObservationType(entityType) && isInadmissibleProfileHomeName(observation)) {
    return true;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    !!observation.field &&
    MATERIALIZED_DESCRIPTION_FIELDS.has(observation.field) &&
    isProfileTemplateChrome(observation.value)
  ) {
    return true;
  }
  return (
    isResearchEntityObservationType(entityType) &&
    !!observation.field &&
    RETIRED_ACCESS_OBSERVATION_FIELDS.has(observation.field)
  );
}

// The projection keeps a rejected value rather than dropping it, so a list that states no
// method at all would otherwise stay stored; ignoring it lets clear-on-empty withdraw it.
function statesNoAdmissibleMethod(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((chip) => !sanitizeMethodChipLabel(chip))
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

function statesOnlyAdviseesMovedToMentors(observation: ResolverObservation): boolean {
  return (
    observation.field === 'pastUndergradAdvisees' &&
    Array.isArray(observation.value) &&
    observation.value.length > 0 &&
    withoutAdviseeProgramsMovedToMentors(observation.value).length === 0
  );
}

function withoutObservedAdviseesMovedToMentors(
  observations: ResolverObservation[],
): ResolverObservation[] {
  const anotherAdviseeObservationRemains = observations.some(
    (observation) =>
      observation.field === 'pastUndergradAdvisees' &&
      !statesOnlyAdviseesMovedToMentors(observation),
  );
  return observations.flatMap((observation) => {
    if (observation.field !== 'pastUndergradAdvisees' || !Array.isArray(observation.value)) {
      return [observation];
    }
    if (statesOnlyAdviseesMovedToMentors(observation) && anotherAdviseeObservationRemains) {
      return [];
    }
    return [{ ...observation, value: withoutAdviseeProgramsMovedToMentors(observation.value) }];
  });
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
  if (isResearchEntityObservationType(entityType) && field === 'pastUndergradAdvisees') {
    return withoutAdviseeProgramsMovedToMentors(value);
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
    OBSERVED_FELLOWSHIP_PROSE_FIELDS.has(field) &&
    typeof value === 'string'
  ) {
    return fellowshipDisplayProse(field, value) ?? value;
  }
  if (
    isResearchEntityObservationType(entityType) &&
    (field === 'name' || field === 'displayName') &&
    typeof value === 'string'
  ) {
    return recaseAllCapsResearchEntityName(
      normalizeResearchEntityNameSmartQuotes(
        normalizeResearchEntityNameDashes(
          collapseDuplicateResearchHomeSuffix(
            stripResearchHomeNamePersonCredentials(
              stripResearchHomeNameCaptionWrapper(stripTrailingResearchHomeDescription(value)),
            ),
          ),
        ),
      ),
    );
  }
  if (
    entityType === 'user' &&
    (field === 'fname' || field === 'lname' || field === 'displayName') &&
    typeof value === 'string'
  ) {
    return servedUserNameField(field, value);
  }
  if (isResearchEntityObservationType(entityType) && field === 'rosterEnrichment') {
    return rosterEnrichmentWithRetainedSuccessfulSnapshot(value, existingValue);
  }
  return value;
}

const grantIdentity = (value: unknown): string => {
  const grant = objectRecord(value);
  return grantAwardIdentity(grant) ?? `record:${JSON.stringify(grant)}`;
};

const grantEndTime = (value: unknown): number => {
  const time = new Date(objectRecord(value).endDate as any).getTime();
  return Number.isFinite(time) ? time : -Infinity;
};

const keepLaterEndingGrant = (grants: Map<string, unknown>, grant: unknown): void => {
  const identity = grantIdentity(grant);
  const held = grants.get(identity);
  if (held !== undefined && grantEndTime(held) > grantEndTime(grant)) return;
  grants.set(identity, grant);
};

const RESEARCH_ENTITY_GRANT_EVIDENCE_FIELDS = new Set([
  'recentGrants',
  'recentGrantPeriods',
  'recentGrantCount',
  'fundingAgencies',
]);

export function grantEvidenceRecordsInvestigators(
  observations: readonly MaterializerObservationLike[],
): boolean {
  return observations.some(
    (observation) =>
      (observation.field === 'recentGrants' || observation.field === 'recentGrantPeriods') &&
      Array.isArray(observation.value) &&
      observation.value.some((entry) => recordedGrantInvestigators(entry) !== undefined),
  );
}

const awardPeriodOf = (award: unknown): Record<string, unknown> => {
  const record = objectRecord(award);
  return {
    id: record.id,
    agency: record.agency,
    ...(record.startDate ? { startDate: record.startDate } : {}),
    ...(record.endDate ? { endDate: record.endDate } : {}),
  };
};

const newestStartFirst = (left: unknown, right: unknown): number => {
  const leftTime = new Date(objectRecord(left).startDate as any).getTime();
  const rightTime = new Date(objectRecord(right).startDate as any).getTime();
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
};

// The count, the periods and the funder list are derived from the one set of awards the
// row is eligible to serve, before the list is cut to its newest ten, so an award that is
// withheld or refused can never survive in a count or a funder a lane stated on its own
// (#5779, #5785). A lane's own `recentGrantCount` observation is therefore never read: an
// award it counts but never lists or dates is not an award the row can show.
export function aggregateResearchEntityGrantEvidence(
  observations: MaterializerObservationLike[],
  leadPersonIds: ReadonlySet<string> = new Set(),
  isProvablyNotALead: ProvablyNotALead = NO_INVESTIGATOR_IS_PROVABLY_NOT_A_LEAD,
): {
  recentGrants?: unknown[];
  recentGrantPeriods?: unknown[];
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
  const latestValues = [...latest.values()];
  if (latestValues.length === 0) return {};

  const listed = new Map<string, unknown>();
  const eligible = new Map<string, unknown>();
  const awardsBySource = new Map<string, unknown[]>();
  const eligibleBySource = new Map<string, unknown[]>();
  let hasGrantSnapshot = false;
  const admit = (sourceName: string, entries: unknown[], carriesRole: boolean) => {
    const admitted: unknown[] = [];
    for (const entry of entries) {
      awardsBySource.set(sourceName, [...(awardsBySource.get(sourceName) ?? []), entry]);
      const derived = deriveGrantEntryForLeads(entry, leadPersonIds, {
        carriesRole,
        isProvablyNotALead,
      });
      if (derived.outcome === 'withheld') continue;
      eligibleBySource.set(sourceName, [
        ...(eligibleBySource.get(sourceName) ?? []),
        derived.entry,
      ]);
      admitted.push(derived.entry);
    }
    return admitted;
  };
  for (const observation of latestValues) {
    if (observation.field !== 'recentGrantPeriods' || !Array.isArray(observation.value)) continue;
    for (const period of admit(String(observation.sourceName || ''), observation.value, false)) {
      keepLaterEndingGrant(eligible, period);
    }
  }
  for (const observation of latestValues) {
    if (observation.field !== 'recentGrants' || !Array.isArray(observation.value)) continue;
    hasGrantSnapshot = true;
    for (const grant of admit(String(observation.sourceName || ''), observation.value, true)) {
      keepLaterEndingGrant(listed, grant);
      keepLaterEndingGrant(eligible, grant);
    }
  }

  const agencies = new Map<string, string>();
  for (const observation of latestValues) {
    if (observation.field !== 'fundingAgencies' || !Array.isArray(observation.value)) continue;
    const sourceName = String(observation.sourceName || '');
    const eligibleAwards = eligibleBySource.get(sourceName) ?? [];
    if (eligibleAwards.length === 0) continue;
    const backed = agenciesBackedByRunningAwards(
      observation.value,
      awardsBySource.get(sourceName) ?? [],
      eligibleAwards,
    );
    for (const agency of Array.isArray(backed) ? backed : []) {
      const normalized = textValue(agency);
      if (normalized && !agencies.has(normalized.toLowerCase())) {
        agencies.set(normalized.toLowerCase(), normalized);
      }
    }
  }

  const eligibleAwards = [...eligible.values()];
  return {
    ...(hasGrantSnapshot
      ? { recentGrants: [...listed.values()].sort(newestStartFirst).slice(0, 10) }
      : {}),
    recentGrantPeriods: eligibleAwards.map(awardPeriodOf),
    recentGrantCount: eligibleAwards.length,
    fundingAgencies: [...agencies.values()],
  };
}

async function researchEntityGrantEvidence(
  entityIdString: string | undefined,
  materializationObs: MaterializerObservationLike[],
): Promise<ReturnType<typeof aggregateResearchEntityGrantEvidence>> {
  if (!entityIdString || !grantEvidenceRecordsInvestigators(materializationObs)) {
    return aggregateResearchEntityGrantEvidence(materializationObs);
  }
  const grantLeadPersonIds = new Set(
    ((await loadResearchEntityLeadPersonIds([entityIdString])).get(entityIdString) ?? []).filter(
      Boolean,
    ),
  );
  return aggregateResearchEntityGrantEvidence(
    materializationObs,
    grantLeadPersonIds,
    await loadProvablyNotALead(grantLeadPersonIds, materializationObs),
  );
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
  const undergraduates = Array.isArray(enrichment.undergraduates) ? enrichment.undergraduates : [];
  if (memberKeys.length === 0 && undergraduates.length === 0) return undefined;
  if (!sourceUrl || !observedAt || !freshnessExpiresAt) return undefined;
  return {
    state: enrichment.state,
    memberKeys,
    sourceUrl,
    ...(textValue(enrichment.configOrigin)
      ? { configOrigin: textValue(enrichment.configOrigin) }
      : {}),
    ...(undergraduates.length > 0 ? { undergraduates } : {}),
    ...(textValue(enrichment.alumniSourceUrl)
      ? { alumniSourceUrl: textValue(enrichment.alumniSourceUrl) }
      : {}),
    ...(enrichment.sourcePublishedAt ? { sourcePublishedAt: enrichment.sourcePublishedAt } : {}),
    observedAt,
    freshnessExpiresAt,
  };
};

const rosterConfigOrigin = (enrichment: Record<string, unknown>): string =>
  textValue(enrichment.configOrigin) || 'static';

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
  const sameOrigin = retained && rosterConfigOrigin(retained) === rosterConfigOrigin(enrichment);
  return sameOrigin ? { ...enrichment, lastSuccessfulSnapshot: retained } : enrichment;
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
      !isBoilerplatePlatformHostUrl(url) &&
      !isCoursePageUrl(url),
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
  if (!Array.isArray(sanitized)) return undefined;
  // A paper or file a lane read only to verify the lead is not the page to cite when a
  // profile or roster page also produced the row; it stays the fallback when nothing
  // else did, where the caller still refuses it unless a served field was read from it (#5114).
  return (sanitized.find((url) => !isLinkedPublicationOrDocumentUrl(url)) ?? sanitized[0]) as
    string | undefined;
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

/**
 * The identity the lead-profile and provenance projections refuse a namesake's page with
 * (#5764): the citations through this pass plus every person page the row's own
 * observations cite, so a namesake's page a lane copied into `sourceUrls` cannot stand in
 * as the row's only owner and be copied again.
 */
export function withObservedPersonPages(
  entityIdentity: ResearchEntityIdentity | undefined,
  observedPersonPageUrls: readonly string[],
): ResearchEntityIdentity | undefined {
  return entityIdentity
    ? identityWithPersonPageUrls(entityIdentity, observedPersonPageUrls)
    : entityIdentity;
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

/**
 * Page text is stored for materialize-time readers (#5296), not served, so no field on the
 * row ever carries it and neither the public DTO nor the search index can reach it.
 */
function isObservationOnlyResearchEntityField(field: string | undefined): boolean {
  return field === RESEARCH_PAGE_TEXT_FIELD;
}

function derivedResearchAreaProvenanceFor(
  field: string,
  resolved: ResolvedField,
  candidate: DerivedResearchAreaCandidate | undefined,
): Record<string, unknown> | null {
  if (field !== 'researchAreas' || !candidate) return null;
  if (!resolved.contributingSources.includes(candidate.sourceName)) return null;
  if (comparableObservationValue(resolved.value) !== comparableObservationValue(candidate.value)) {
    return null;
  }
  return derivedResearchAreaProvenance(candidate);
}

function resolverObservationOfDerivedCandidate(
  candidate: DerivedResearchAreaCandidate,
): ResolverObservation {
  return {
    field: candidate.field,
    value: candidate.value,
    sourceName: candidate.sourceName,
    confidence: candidate.confidence,
    observedAt: candidate.observedAt,
  };
}

const storedResearchAreasProvenance = (entityDoc: any): unknown =>
  objectRecord(entityDoc?.fieldProvenance).researchAreas;

/**
 * A stored list credited to a page-topics derivation, and not shown stale, is backed by
 * that derivation even when no observation states it, so the unbacked-list union never
 * extends or replaces it.
 */
function storedResearchAreasCreditedToStandingDerivation(
  entityDoc: any,
  storedDerivationStale: boolean,
): boolean {
  const sourceName = objectRecord(storedResearchAreasProvenance(entityDoc)).sourceName;
  return sourceName === RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME && !storedDerivationStale;
}

function clearStaleResearchPageTopicsProvenance(
  set: Record<string, unknown>,
  unset: Record<string, ''>,
  storedDerivationStale: boolean,
): void {
  if (!storedDerivationStale) return;
  if (DERIVED_RESEARCH_AREA_PROVENANCE_PATH in set) return;
  unset[DERIVED_RESEARCH_AREA_PROVENANCE_PATH] = '';
}

function fieldProvenanceForResolvedObservation(
  field: string,
  resolved: ResolvedField,
  observations: MaterializerObservationLike[],
): Record<string, unknown> | null {
  const resolvedValue = comparableObservationValue(resolved.value);
  const contributingSources = new Set(resolved.contributingSources);
  const candidates = observations.filter(
    (obs) =>
      obs._id && obs.field === field && obs.sourceName && contributingSources.has(obs.sourceName),
  );
  const match =
    candidates.find((obs) => comparableObservationValue(obs.value) === resolvedValue) ??
    candidates.find((obs) => observationNarrowsToResolvedValue(obs, resolvedValue));
  return match ? observationFieldProvenance(match, resolved.confidence) : null;
}

/**
 * The resolver reads a person's lab-site description narrowed to its research passage, so its
 * winner carries text no stored observation states verbatim. Matching on the raw value alone
 * found no observation for that winner, and every adoption site then kept the provenance of
 * the body it had just displaced.
 */
function observationNarrowsToResolvedValue(
  obs: MaterializerObservationLike,
  resolvedValue: string,
): boolean {
  const narrowed = narrowedLabSiteDescriptionValue(obs);
  return !!narrowed && comparableObservationValue(narrowed) === resolvedValue;
}

function observationFieldProvenance(
  match: MaterializerObservationLike,
  fallbackConfidence?: number,
): Record<string, unknown> | null {
  if (!match._id) return null;
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
    confidence: match.confidence ?? fallbackConfidence,
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

async function liveResearchersHoldingRosterProfileUrl(
  resolved: Record<string, ResolvedField>,
  limit: number,
): Promise<any[]> {
  const profileUrlPattern = officialProfileDestinationStoredPattern(
    textValue(resolved.profileUrl?.value),
  );
  if (!profileUrlPattern) return [];
  return Researcher.find({
    archived: { $ne: true },
    $or: [{ 'profileLinks.url': profileUrlPattern }, { 'profile.websiteUrl': profileUrlPattern }],
  })
    .select(ROSTER_CANDIDATE_IDENTITY_PROJECTION)
    .limit(limit)
    .lean();
}

async function findUniqueResearcherForRosterMember(
  resolved: Record<string, ResolvedField>,
): Promise<any | null> {
  const researchers = await liveResearchersHoldingRosterProfileUrl(resolved, 2);
  return researchers.length === 1 ? researchers[0] : null;
}

const SHARED_PROFILE_URL_HOLDER_LIMIT = 10;

const ROSTER_CANDIDATE_IDENTITY_PROJECTION =
  '_id displayName identifiers.netid identifiers.email identifiers.orcid profileLinks.kind';

/**
 * Of several records that all agree with a listed name and that the listing's evidence
 * reached, the one carrying identity is the member when it is the only such record; a
 * name-only twin never takes the seat from it (#5592). Otherwise the set is unchanged.
 */
function preferIdentityBackedAgreeing<T extends ResearcherIdentityEvidenceSource>(
  agreeing: readonly T[],
): readonly T[] {
  if (agreeing.length < 2) return agreeing;
  const identityBacked = agreeing.filter((candidate) =>
    researcherCarriesIdentityEvidence(candidate),
  );
  return identityBacked.length === 1 ? identityBacked : agreeing;
}

/**
 * A profile URL several researchers hold reaches every one of them, so the listed name
 * vetoes the holders it disagrees with, as it vetoes every other candidate the evidence
 * reached: exactly one agreeing holder is the member, and none or several resolve to
 * nobody (#4500). More holders than the limit is a URL that identifies nobody.
 */
function holderTheListedNameLeaves(holders: readonly any[], listedName: string): any | null {
  if (holders.length > SHARED_PROFILE_URL_HOLDER_LIMIT) return null;
  const agreeing = preferIdentityBackedAgreeing(
    holders.filter((holder) => observedPersonNameAgreesWith(holder.displayName, listedName)),
  );
  return agreeing.length === 1 ? agreeing[0] : null;
}

const SHARED_PROFILE_URL_LISTING_LIMIT = 20;

export interface RosterListingScope {
  researchGroupKey: string;
  sourceName: string;
  now: Date;
}

interface SharedProfileUrlListing {
  names: string[];
  role: string;
}

const listedNamesAgree = (left: string, right: string): boolean =>
  observedPersonNameAgreesWith(left, right) || observedPersonNameAgreesWith(right, left);

async function listingsSharingProfileUrl(
  profileUrl: string,
  scope: RosterListingScope,
): Promise<SharedProfileUrlListing[]> {
  const profileUrlPattern = officialProfileDestinationStoredPattern(profileUrl);
  if (!profileUrlPattern || !scope.researchGroupKey || !scope.sourceName) return [];
  const readScope = materializationReadScopeFilter();
  const listing = {
    entityType: 'researchGroupMember' as const,
    sourceName: scope.sourceName,
    ...readScope,
  };
  const keysCarryingUrl = (await Observation.distinct('entityKey', {
    ...listing,
    field: 'profileUrl',
    value: profileUrlPattern,
  })) as string[];
  if (keysCarryingUrl.length < 2) return [];
  const keysOnThisEntity = (
    (await Observation.distinct('entityKey', {
      ...listing,
      entityKey: { $in: keysCarryingUrl },
      field: RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD,
      value: scope.researchGroupKey,
    })) as unknown[]
  )
    .map(textValue)
    .filter(Boolean)
    .slice(0, SHARED_PROFILE_URL_LISTING_LIMIT);
  if (keysOnThisEntity.length < 2) return [];
  const rows = (await Observation.find({
    ...listing,
    entityKey: { $in: keysOnThisEntity },
    field: { $in: ['name', 'inferredUserName', 'role'] },
  })
    .select('entityKey field value sourceName confidence observedAt')
    .lean()) as any[];
  const observationsByKey = new Map<string, ResolverObservation[]>();
  for (const row of rows) {
    const key = textValue(row.entityKey);
    observationsByKey.set(key, [
      ...(observationsByKey.get(key) ?? []),
      {
        field: row.field,
        value: row.value,
        sourceName: row.sourceName,
        confidence: row.confidence,
        observedAt: row.observedAt,
      },
    ]);
  }
  return [...observationsByKey.values()].map((observations) => {
    const listed = resolveAllFields(observations, { now: scope.now });
    return {
      names: uniqueStrings([
        listed.name?.value,
        memberNameFromInferredUserName(listed.inferredUserName?.value),
      ]),
      role: normalizeMemberRole(listed.role?.value),
    };
  });
}

const SITE_LEAD_ROLES: RoleAssignmentRole[] = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'];
const SITE_ENTITY_LIMIT = 20;

async function liveLeadsOfEntitiesAtWebsite(
  url: string,
  scope: RosterListingScope,
): Promise<any[]> {
  const sitePattern = officialProfileDestinationStoredPattern(url);
  if (!sitePattern) return [];
  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    slug: { $ne: scope.researchGroupKey },
    websiteUrl: sitePattern,
  })
    .select('_id')
    .limit(SITE_ENTITY_LIMIT)
    .lean()) as any[];
  if (entities.length === 0) return [];
  const leadIds = (await RoleAssignment.distinct('personId', {
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: entities.map((entity) => entity._id) },
    role: { $in: SITE_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })) as unknown[];
  if (leadIds.length === 0) return [];
  return Researcher.find({ _id: { $in: leadIds }, archived: { $ne: true } })
    .select('_id displayName')
    .lean();
}

type ProfileUrlHolderForListing = {
  holder: any | null;
  holderEdgeToEnd: any | null;
  vetoedHolders?: any[];
  urlNamesAnotherSiteLead?: boolean;
};

/**
 * A sole listing whose name disagrees with the researcher holding its URL is either the
 * holder under a variant spelling or someone else whose lab site the holder borrowed
 * (#4350). A name cannot tell those apart, but the corpus can: when the URL is the website
 * of a live research entity, that entity's current leads are who the site belongs to. A
 * holder among them keeps the join, a lead the listed name agrees with takes it, and a
 * holder who only borrows another lead's site names nobody.
 */
async function soleListingProfileUrlHolder(
  holder: any,
  listedName: string,
  profileUrl: string,
  scope: RosterListingScope,
): Promise<ProfileUrlHolderForListing> {
  const leads = await liveLeadsOfEntitiesAtWebsite(profileUrl, scope);
  if (leads.length === 0) return { holder, holderEdgeToEnd: null };
  const agreeingLeads = leads.filter((lead) =>
    observedPersonNameAgreesWith(lead.displayName, listedName),
  );
  if (agreeingLeads.length === 1) return { holder: agreeingLeads[0], holderEdgeToEnd: holder };
  if (leads.some((lead) => String(lead._id) === String(holder._id))) {
    return { holder, holderEdgeToEnd: null };
  }
  return { holder: null, holderEdgeToEnd: holder, urlNamesAnotherSiteLead: true };
}

async function profileUrlHolderForListing(
  resolved: Record<string, ResolvedField>,
  listedName: string,
  scope: RosterListingScope,
): Promise<ProfileUrlHolderForListing> {
  const holders = await liveResearchersHoldingRosterProfileUrl(
    resolved,
    SHARED_PROFILE_URL_HOLDER_LIMIT + 1,
  );
  if (holders.length > 1) {
    const holder = holderTheListedNameLeaves(holders, listedName);
    if (!holder) return { holder: null, holderEdgeToEnd: null };
    const otherListings = await listingsSharingProfileUrl(
      textValue(resolved.profileUrl?.value),
      scope,
    );
    const listedElsewhere = (candidate: any) =>
      otherListings.some((entry) =>
        entry.names.some((name) => observedPersonNameAgreesWith(candidate.displayName, name)),
      );
    return {
      holder,
      holderEdgeToEnd: null,
      vetoedHolders: holders.filter(
        (candidate) => String(candidate._id) !== String(holder._id) && !listedElsewhere(candidate),
      ),
    };
  }
  const holder = holders[0] ?? null;
  if (!holder || observedPersonNameAgreesWith(holder.displayName, listedName)) {
    return { holder, holderEdgeToEnd: null };
  }
  const profileUrl = textValue(resolved.profileUrl?.value);
  const listings = await listingsSharingProfileUrl(profileUrl, scope);
  const listsAnotherPerson = listings.some((entry) =>
    entry.names.some((name) => !listedNamesAgree(name, listedName)),
  );
  if (!listsAnotherPerson) {
    return soleListingProfileUrlHolder(holder, listedName, profileUrl, scope);
  }
  const role = normalizeMemberRole(resolved.role?.value);
  const holderOwnListingStatesRole = listings.some(
    (entry) =>
      entry.role === role &&
      entry.names.some((name) => observedPersonNameAgreesWith(holder.displayName, name)),
  );
  return { holder: null, holderEdgeToEnd: holderOwnListingStatesRole ? null : holder };
}

export type RosterMemberUnresolvedReason =
  | 'no-identity-evidence'
  | 'evidence-names-nobody'
  | 'evidence-names-someone-else'
  | 'evidence-ambiguous';

export type RosterMemberIdentity = (
  | { researcher: any; basis: RosterIdentityBasis }
  | { researcher: null; unresolved: RosterMemberUnresolvedReason }
) & {
  misattributedProfileUrlHolderId?: mongoose.Types.ObjectId;
  vetoedProfileUrlHolderIds?: mongoose.Types.ObjectId[];
  profileUrlNamesAnotherSiteLead?: boolean;
  evidenceNamesOneOtherResearcher?: boolean;
};

async function liveResearcherById(researcherId: unknown): Promise<any | null> {
  return Researcher.findOne({ _id: researcherId, archived: { $ne: true } })
    .select(ROSTER_CANDIDATE_IDENTITY_PROJECTION)
    .lean();
}

async function liveResearchersHoldingNetid(netid: string): Promise<any[]> {
  return Researcher.find({ 'identifiers.netid': netid, archived: { $ne: true } })
    .select(ROSTER_CANDIDATE_IDENTITY_PROJECTION)
    .limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT)
    .lean();
}

interface IdentityEvidenceWitnesses {
  researcher: any;
  urls: string[];
  emails: string[];
  netids: string[];
}

async function identityEvidenceWitnessesByResearcher(
  evidence: RosterMemberIdentityEvidence,
): Promise<Map<string, IdentityEvidenceWitnesses>> {
  const witnesses = new Map<string, IdentityEvidenceWitnesses>();
  const witnessFor = (researcher: any): IdentityEvidenceWitnesses | null => {
    if (!researcher?._id) return null;
    const id = String(researcher._id);
    const existing = witnesses.get(id) ?? { researcher, urls: [], emails: [], netids: [] };
    witnesses.set(id, existing);
    return existing;
  };
  const claimantsByUrl = await liveResearchersClaimingOfficialProfileUrls(
    evidence.linkedProfileUrls,
  );
  for (const url of evidence.linkedProfileUrls) {
    const claimants = claimantsByUrl.get(officialProfileIdentityUrlKey(url)) ?? [];
    if (claimants.length === 1) witnessFor(claimants[0])?.urls.push(url);
  }
  for (const email of evidence.emails) {
    const claimant = await soleLiveResearcherClaimingEmail(email);
    witnessFor(claimant?._id ? await liveResearcherById(claimant._id) : null)?.emails.push(email);
  }
  for (const netid of evidence.netids) {
    for (const researcher of await liveResearchersHoldingNetid(netid)) {
      witnessFor(researcher)?.netids.push(netid);
    }
  }
  return witnesses;
}

/**
 * A linked page or address names a candidate only while nothing says it belongs to someone
 * else. A URL that spells a name names every namesake equally, so a candidate is dropped when
 * the member's own page or address is one the Yale directory pairs with a different netid, and
 * each link or address is dropped when the candidate refuses it or when that page's own stated
 * email names a different netid (#5641, #5693, #5751).
 */
async function withoutContradictedIdentityWitnesses(
  evidence: RosterMemberIdentityEvidence,
  witnesses: Map<string, IdentityEvidenceWitnesses>,
): Promise<any[]> {
  if (witnesses.size === 0) return [];
  const refusals = new Map(
    (
      (await Researcher.find({ _id: { $in: [...witnesses.values()].map((w) => w.researcher._id) } })
        .select('_id fieldValueRefusals')
        .lean()) as Array<{ _id: unknown; fieldValueRefusals?: unknown }>
    ).map((row) => [String(row._id), row.fieldValueRefusals]),
  );
  const pageOwners = await profilePageOwnerNetids(
    [evidence.pageUrl, ...evidence.linkedProfileUrls],
    materializationReadScopeFilter(),
  );
  const directory = evidence.emails.length > 0 ? await loadDirectoryNetidsByAddress() : undefined;
  const memberPageAddressOwners = directory
    ? directoryOwnerNetidsOfAddresses(evidence.emails, directory)
    : undefined;
  const netidsTheDirectoryHolds =
    directory && memberPageAddressOwners ? directoryNetidsOf(directory) : new Set<string>();
  const kept: any[] = [];
  for (const [id, witness] of witnesses) {
    const netid = textValue(witness.researcher?.identifiers?.netid).toLowerCase();
    const refused = refusals.get(id);
    const memberPageNamesSomeoneElse =
      Boolean(netid) &&
      (profilePageContradictsNetid(pageOwners, evidence.pageUrl, netid) ||
        (memberPageAddressOwners !== undefined &&
          !memberPageAddressOwners.has(netid) &&
          netidsTheDirectoryHolds.has(netid)));
    if (memberPageNamesSomeoneElse) continue;
    const urls = witness.urls.filter(
      (url) =>
        !researcherRefusesValue(refused, 'profileLink', url) &&
        !(netid && profilePageContradictsNetid(pageOwners, url, netid)),
    );
    const emails = witness.emails.filter(
      (email) => !researcherRefusesValue(refused, 'email', email),
    );
    if (urls.length + emails.length + witness.netids.length > 0) kept.push(witness.researcher);
  }
  return kept;
}

async function researchersNamedByIdentityEvidence(
  evidence: RosterMemberIdentityEvidence,
): Promise<any[]> {
  return withoutContradictedIdentityWitnesses(
    evidence,
    await identityEvidenceWitnessesByResearcher(evidence),
  );
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
  scope: RosterListingScope = { researchGroupKey: '', sourceName: '', now: new Date() },
): Promise<RosterMemberIdentity> {
  const byProfileUrl = await profileUrlHolderForListing(resolved, listedName, scope);
  const misattributedProfileUrlHolderId = toMaterializerObjectId(byProfileUrl.holderEdgeToEnd?._id);
  const vetoedProfileUrlHolderIds = (byProfileUrl.vetoedHolders ?? [])
    .map((vetoed) => toMaterializerObjectId(vetoed?._id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  if (byProfileUrl.holder) {
    return {
      researcher: byProfileUrl.holder,
      basis: 'profile-url',
      ...(misattributedProfileUrlHolderId ? { misattributedProfileUrlHolderId } : {}),
      ...(vetoedProfileUrlHolderIds.length > 0 ? { vetoedProfileUrlHolderIds } : {}),
    };
  }
  const identity = await resolveRosterMemberIdentityFromEvidence(resolved, listedName);
  return {
    ...identity,
    ...(misattributedProfileUrlHolderId ? { misattributedProfileUrlHolderId } : {}),
    ...(byProfileUrl.urlNamesAnotherSiteLead && !identity.researcher
      ? { profileUrlNamesAnotherSiteLead: true }
      : {}),
  };
}

async function resolveRosterMemberIdentityFromEvidence(
  resolved: Record<string, ResolvedField>,
  listedName: string,
): Promise<RosterMemberIdentity> {
  const evidenceField = resolved[ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD];
  const evidence = evidenceField?.hasConflict
    ? null
    : parseRosterMemberIdentityEvidence(evidenceField?.value);
  if (!evidence || !listedName) return { researcher: null, unresolved: 'no-identity-evidence' };
  const named = await researchersNamedByIdentityEvidence(evidence);
  if (named.length === 0) return { researcher: null, unresolved: 'evidence-names-nobody' };
  const agreeing = preferIdentityBackedAgreeing(
    named.filter((researcher) => observedPersonNameAgreesWith(researcher.displayName, listedName)),
  );
  if (agreeing.length === 0) {
    return {
      researcher: null,
      unresolved: 'evidence-names-someone-else',
      ...(named.length === 1 ? { evidenceNamesOneOtherResearcher: true } : {}),
    };
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

async function endMisattributedProfileUrlHolderEdges(
  researchEntityId: string,
  plan: RosterMemberCanonicalPlan,
  personId?: mongoose.Types.ObjectId,
): Promise<number> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  const provenance = plan.facts.rosterProvenance;
  const sourceName = textValue(provenance?.sourceName);
  const membershipKey = textValue(provenance?.membershipKey);
  if (!entityObjectId || !sourceName || !membershipKey) return 0;
  const ended = await RoleAssignment.updateMany(
    {
      ...(personId ? { personId } : {}),
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityObjectId,
      'rosterProvenance.sourceName': sourceName,
      'rosterProvenance.membershipKey': membershipKey,
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    },
    { $set: { state: 'HISTORICAL', endedAt: provenance?.observedAt ?? new Date() } },
  );
  return ended.modifiedCount ?? 0;
}

/**
 * A roster membership key names one listed person, so once a listing resolved by name alone
 * has written its edge, another person's live edge under the same source and key is an
 * earlier resolution of the same listing: a name-only holder whose stored name drifted, so
 * the next read minted a second row and left the first one's edge CURRENT (#4758). It is
 * ended on the read, which is derivation rather than repair. Only a name-only twin is ended:
 * a twin whose edge records an identity basis, or a listing whose identity the lane proved,
 * is left to the accountless-shell dedupe, which folds that shell into
 * the proven holder through this very edge (#3802), and a profile URL that two listings on
 * the entity share is left alone, because there the key does not name one person (#4500).
 */
async function endSupersededListingHolderEdges(
  researchEntityId: string,
  plan: RosterMemberCanonicalPlan,
  keptPersonId: mongoose.Types.ObjectId,
  scope: RosterListingScope,
): Promise<number> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  const provenance = plan.facts.rosterProvenance;
  const sourceName = textValue(provenance?.sourceName);
  const membershipKey = textValue(provenance?.membershipKey);
  if (!entityObjectId || !sourceName || !membershipKey) return 0;
  const profileUrl = textValue(provenance?.profileUrl);
  if (profileUrl && (await listingsSharingProfileUrl(profileUrl, scope)).length > 1) return 0;
  const ended = await RoleAssignment.updateMany(
    {
      personId: { $ne: keptPersonId },
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityObjectId,
      'rosterProvenance.sourceName': sourceName,
      'rosterProvenance.membershipKey': membershipKey,
      'rosterProvenance.identityBasis': { $exists: false },
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    },
    { $set: { state: 'HISTORICAL', endedAt: provenance?.observedAt ?? new Date() } },
  );
  return ended.modifiedCount ?? 0;
}

/**
 * The staff title screen moves a listing between its listed faculty role and `staff`, and the
 * membership key carries the role, so the edge written under the other role is the same
 * listing's earlier resolution and is ended on the read, in either direction (#5746).
 * An adopted edge was not written by this listing, so it stays with center roster retirement
 * and its freeze.
 */
async function endListingEdgesUnderTheOtherScreenedRole(
  researchEntityId: string,
  plan: RosterMemberCanonicalPlan,
  personId: mongoose.Types.ObjectId,
): Promise<number> {
  if (textValue(plan.resolved.membershipKey?.value)) return 0;
  const listedRole = normalizeMemberRole(plan.resolved.role?.value);
  if (!STAFF_SCREENED_ROSTER_ROLES.has(listedRole)) return 0;
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  const provenance = plan.facts.rosterProvenance;
  const sourceName = textValue(provenance?.sourceName);
  if (!entityObjectId || !sourceName || !plan.identityKey) return 0;
  const otherKeys = [listedRole, 'staff']
    .filter((role) => role !== plan.role)
    .map((role) => rosterMembershipKey(plan.identityKey, role));
  const ended = await RoleAssignment.updateMany(
    {
      personId,
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityObjectId,
      'rosterProvenance.sourceName': sourceName,
      'rosterProvenance.membershipKey': { $in: otherKeys },
      'rosterProvenance.adoptedAt': { $exists: false },
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    },
    { $set: { state: 'HISTORICAL', endedAt: provenance?.observedAt ?? new Date() } },
  );
  return ended.modifiedCount ?? 0;
}

/**
 * A listing whose own member page names exactly one identified researcher by email, URL or
 * netid, under a name the listed name does not agree with, is that researcher under a
 * variant name far more often than a stranger: a blind sample of the 20 such centers
 * listings found 19 the same person and none different. Minting it name-only made the twin
 * the shell dedupe cannot fold on the name, so the listing writes nothing until the
 * conflict is resolved by a fold (#5677).
 */
function listingWouldMintAnIdentityConflict(
  plan: RosterMemberCanonicalPlan,
  identity: RosterMemberIdentity,
): boolean {
  if (identity.researcher || plan.personReferenceId) return false;
  if (!identity.evidenceNamesOneOtherResearcher) return false;
  return SOURCES_THAT_REFUSE_A_NAMESAKE_MINT.has(
    textValue(plan.facts.rosterProvenance?.sourceName),
  );
}

async function listingWouldMintANamesake(
  plan: RosterMemberCanonicalPlan,
  identity: RosterMemberIdentity,
): Promise<boolean> {
  if (identity.researcher || plan.personReferenceId) return false;
  const sourceName = textValue(plan.facts.rosterProvenance?.sourceName);
  if (!SOURCES_THAT_REFUSE_A_NAMESAKE_MINT.has(sourceName)) return false;
  return identifiedResearcherHoldsDisplayName(plan.facts.displayName);
}

/**
 * A named director is only resolvable by name when exactly one live researcher
 * answers to that name. Two or more is a namesake collision, which is the defect
 * class that puts one person's work on another person's page, so an ambiguous
 * name resolves to nobody rather than to a guess.
 *
 * Candidates are narrowed with the person-name resolver's anchored surname pattern
 * and limit, because an unanchored surname matched a short surname inside longer
 * names and overflowed the cap, so a common short surname never resolved (#5296).
 * They are then judged by the same `observedPersonNameAgreesWith` comparator every
 * other lane uses, so the diacritic and apostrophe handling stays in one place.
 */
export async function findUniqueResearcherByObservedDirectorName(
  name: string,
): Promise<any | null> {
  const observed = splitName(textValue(name));
  if (!observed.last || !observed.first) return null;
  const surnamePattern = surnameFetchRegex(observed.last);
  if (!surnamePattern) return null;
  const candidates = await Researcher.find({
    archived: { $ne: true },
    displayName: surnamePattern,
  })
    .select('_id displayName profile.title')
    .limit(SURNAME_FETCH_LIMIT)
    .lean();
  if (candidates.length >= SURNAME_FETCH_LIMIT) return null;
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

export function rosterRoleAfterStaffTitleScreen(
  role: string,
  resolved: Record<string, ResolvedField>,
): string {
  return screenedRosterRole(role, [
    textValue(resolved.title?.value),
    textValue(resolved.profileTitle?.value),
  ]);
}

export function buildRosterMemberCanonicalPlan(
  researchEntityId: string,
  resolved: Record<string, ProvenanceResolvedField>,
  user: Record<string, unknown> | null = null,
): RosterMemberCanonicalPlan | null {
  if (!normalizeMaterializerObjectId(researchEntityId)) return null;
  const role = rosterRoleAfterStaffTitleScreen(normalizeMemberRole(resolved.role?.value), resolved);
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
  const listingTitle = textValue(resolved.title?.value);

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
        listingTitle: listingTitle || undefined,
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
  listingObservations: any[],
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const observations = collapseLatestWins(listingObservations, 'researchGroupMember');
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
  const entity: any =
    (routedRosterHome?.hit
      ? routedRosterHome.value
      : await ResearchEntity.findOne({
          slug: researchGroupKey,
          archived: { $ne: true },
        })
          .select('_id')
          .lean()) ?? (await liveResearchEntityNamedByKeyObservations(researchGroupKey));
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
  const listingScope: RosterListingScope = {
    researchGroupKey,
    sourceName: textValue(resolved.role?.sourceName),
    now: options.now ?? new Date(),
  };
  const identity = await resolveRosterMemberIdentity(resolved, listedName, listingScope);
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
  if (!researcher && namesAResearchGroupRatherThanAPerson(listedName)) {
    if (!options.dryRun) await endMisattributedProfileUrlHolderEdges(researchEntityId, plan);
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'listed-name-names-a-research-group',
    };
  }
  if (identity.misattributedProfileUrlHolderId && !options.dryRun) {
    await endMisattributedProfileUrlHolderEdges(
      researchEntityId,
      plan,
      identity.misattributedProfileUrlHolderId,
    );
  }
  // An edge the lane gave a holder the listed name vetoed carries this listing's source and
  // membership key on this entity, and nothing else asserts it, so the read ends it rather
  // than leaving another person served under this listing (#5582).
  if (!options.dryRun) {
    for (const vetoedHolderId of identity.vetoedProfileUrlHolderIds ?? []) {
      await endMisattributedProfileUrlHolderEdges(researchEntityId, plan, vetoedHolderId);
    }
  }
  if (listingWouldMintAnIdentityConflict(plan, identity)) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'unresolved-identity-conflict',
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
  if (identity.profileUrlNamesAnotherSiteLead) {
    return {
      entityType: 'researchGroupMember',
      entityId: materializerDocumentId(entity._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved,
      skipped: 'profile-url-names-another-site-lead',
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
  if (personId) await endListingEdgesUnderTheOtherScreenedRole(researchEntityId, plan, personId);
  if (personId && !('basis' in identity)) {
    await endSupersededListingHolderEdges(researchEntityId, plan, personId, listingScope);
  }
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
    ...(outcome === REMOVED_BY_REQUEST ? { skipped: REMOVED_BY_REQUEST } : {}),
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

/**
 * The backfill once filed a person page under whichever researcher held a matching name, and
 * the same pass named that researcher as the row's lead, citing the page. When the page's own
 * email belongs, by the directory, to a different netid than the named researcher's, the page
 * is not evidence that this researcher leads the row (#5693). Screened on every read, like the
 * page's identity under the wrong key, so the immutable observation stops creating the edge.
 */
export async function contradictedPageLeadObservations(
  observations: MaterializerObservationLike[],
  owners?: ProfilePageOwnerNetids,
): Promise<Set<MaterializerObservationLike>> {
  const candidates = observations.filter(
    (obs) =>
      obs.field === 'inferredPiUserId' &&
      obs.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
      textValue(obs.sourceUrl) &&
      normalizeMaterializerObjectId(textValue(obs.value)),
  );
  const screened = new Set<MaterializerObservationLike>();
  if (candidates.length === 0) return screened;
  const pageOwners =
    owners ??
    (await profilePageOwnerNetids(
      candidates.map((obs) => obs.sourceUrl),
      materializationReadScopeFilter(),
    ));
  if (pageOwners.byPage.size === 0) return screened;
  const researchers = (await Researcher.find({
    _id: { $in: candidates.map((obs) => normalizeMaterializerObjectId(textValue(obs.value))) },
  })
    .select('_id identifiers.netid')
    .lean()) as Array<{ _id: unknown; identifiers?: { netid?: string } }>;
  const netidById = new Map(
    researchers.map((researcher) => [String(researcher._id), researcher.identifiers?.netid]),
  );
  for (const obs of candidates) {
    const netid = netidById.get(textValue(obs.value));
    if (profilePageContradictsNetid(pageOwners, obs.sourceUrl, netid)) screened.add(obs);
  }
  return screened;
}

export async function planInferredPiMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
  screenedLeadObservations?: ReadonlySet<MaterializerObservationLike>,
): Promise<InferredPiLeadFacts[]> {
  const leads: InferredPiLeadFacts[] = [];
  const screened =
    screenedLeadObservations ?? (await contradictedPageLeadObservations(observations));
  const piObservations = observations.filter(
    (obs) => obs.field === 'inferredPiUserId' && !screened.has(obs),
  );
  for (const observation of piObservations) {
    const facts = buildInferredPiLeadFacts(researchEntityId, observation);
    if (facts) leads.push(facts);
  }

  const piKeyObservations = observations.filter(
    (obs) =>
      obs.field === 'inferredPiUserKey' &&
      !inferredPiKeyNamesRoleOrUnitMailbox(userEntityKeyForInferredPiUserKey(obs.value), obs),
  );
  let entityName: string | undefined;
  const loadEntityName = async (): Promise<string> => {
    entityName ??= textValue(
      ((await ResearchEntity.findById(researchEntityId).select('name').lean()) as any)?.name,
    );
    return entityName;
  };
  for (const observation of piKeyObservations) {
    const resolution = await resolveInferredPiUserKey(observation.value, loadEntityName);
    if (resolution.status !== 'matched' || !resolution.researcherId) continue;
    const facts = buildInferredPiLeadFacts(researchEntityId, {
      ...observation,
      value: resolution.researcherId.toString(),
    });
    if (facts) leads.push(facts);
  }
  return leads;
}

const inferredLeadKeyPerson = (observation: MaterializerObservationLike) => {
  const lookupValue = userLookupValueForInferredPiUserKey(observation.value);
  return {
    identifiers: lookupValue.includes('@') ? { email: lookupValue } : { netid: lookupValue },
    profileLinks: observation.sourceUrl ? [{ url: observation.sourceUrl }] : [],
  };
};

/**
 * A faculty research profile is one person's own row, so it is not minted for a person
 * removed from the directory (#4160): neither the identity its inferred lead key states nor
 * the researcher that key resolves to may be on the list. Read only while the list holds
 * entries, so an empty list costs no lookup.
 */
async function facultyResearchProfileMintIsRemovedByRequest(
  insert: Record<string, unknown>,
  observations: MaterializerObservationLike[],
): Promise<boolean> {
  if (insert.entityType !== 'FACULTY_RESEARCH_AREA') return false;
  const guard = await currentDirectoryRemovalMintGuard();
  if (!guard.active) return false;
  const statesARemovedLead = observations.some(
    (observation) =>
      observation.field === 'inferredPiUserKey' &&
      guard.refusesPerson(inferredLeadKeyPerson(observation)),
  );
  let removed = statesARemovedLead;
  if (!removed) {
    const leads = await planInferredPiMembership(
      new mongoose.Types.ObjectId().toString(),
      observations,
    );
    for (const lead of leads) {
      if (await researcherIsRemovedByRequest(guard, lead.personId)) {
        removed = true;
        break;
      }
    }
  }
  if (removed) guard.recordRefusal();
  return removed;
}

export interface ContradictedPageLeadEdge {
  personId: string;
  sourceUrl: string;
}

export function contradictedPageLeadEdges(
  screened: ReadonlySet<MaterializerObservationLike>,
): ContradictedPageLeadEdge[] {
  const edges = new Map<string, ContradictedPageLeadEdge>();
  for (const obs of screened) {
    const personId = textValue(obs.value);
    const sourceUrl = textValue(obs.sourceUrl);
    edges.set(`${personId} ${sourceUrl}`, { personId, sourceUrl });
  }
  return [...edges.values()];
}

/**
 * The lane's own lead edge from a screened page ends on the read, which is derivation: the edge
 * cites the page as its source, and the page no longer says this person leads the row. Only the
 * backfill's edge citing that page is ended, so a lead edge any other evidence wrote stays.
 */
async function contradictedPageLeadEdgesToEnd(
  researchEntityId: string,
  edges: readonly ContradictedPageLeadEdge[],
  pendingAssertions?: PendingLeadAssertions,
): Promise<LeadEdgeToEnd[]> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  if (!entityObjectId || edges.length === 0) return [];
  const ended: LeadEdgeToEnd[] = [];
  for (const edge of edges) {
    const personId = toMaterializerObjectId(edge.personId);
    if (!personId) continue;
    const pending = pendingAssertions?.get(edge.personId);
    if (
      pending &&
      (pending.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
        pending.sourceUrl !== edge.sourceUrl)
    ) {
      continue;
    }
    const docs = (await RoleAssignment.find({
      personId,
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityObjectId,
      role: 'PI',
      'rosterProvenance.sourceName': OFFICIAL_PROFILE_PI_BACKFILL_SOURCE,
      'rosterProvenance.sourceUrl': edge.sourceUrl,
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    })
      .select('_id')
      .lean()) as Array<{ _id: unknown }>;
    for (const doc of docs) {
      ended.push({ edgeId: String(doc._id), personId: edge.personId, reason: 'contradicted-page' });
    }
  }
  return ended;
}

export type LeadEdgeEndReason =
  'contradicted-page' | 'retired-evidence' | 'contradicted-sourceless';

export interface LeadEdgeToEnd {
  edgeId: string;
  personId: string;
  reason: LeadEdgeEndReason;
}

type PendingLeadAssertions = ReadonlyMap<string, { sourceName: string; sourceUrl: string }>;

interface DryRunLeadEdgeOverlay {
  pendingAssertions: PendingLeadAssertions;
  endedEdgeIds: ReadonlySet<string>;
}

export interface LeadEdgeResolution {
  asserted: Array<{
    personId: string;
    sourceName: string;
    sourceUrl: string;
    isNewEdge: boolean;
    role?: RoleAssignmentRole;
  }>;
  ended: LeadEdgeToEnd[];
}

async function endLeadEdges(
  edges: readonly LeadEdgeToEnd[],
  extraFilter: object = {},
): Promise<void> {
  const ids = edges.map((edge) => toMaterializerObjectId(edge.edgeId)).filter(Boolean);
  if (ids.length === 0) return;
  await RoleAssignment.updateMany(
    { _id: { $in: ids }, state: { $ne: 'HISTORICAL' }, ...extraFilter },
    { $set: { state: 'HISTORICAL', endedAt: new Date() } },
  );
}

export interface InferredPiLeadEdge {
  id: string;
  personId: string;
  sourceName?: string;
  sourceUrl?: string;
}

export interface InferredPiEvidenceRead {
  personId: string;
  sourceName?: string;
  sourceUrl?: string;
  live: boolean;
}

/**
 * A grant-inferred lead edge cites the observation that last asserted it. Once every read of
 * that citation is superseded, rolled back or from an invalidated run, and nothing live on the
 * row still names the person as lead, the edge has no evidence left and stops being a lead.
 * This is derivation on the resolve: it writes no field and needs no lock, and an edge with
 * no recorded citation, or one whose citation was never read here, is left alone (#5979).
 */
export function inferredPiEdgesWithOnlyRetiredEvidence(
  edges: readonly InferredPiLeadEdge[],
  evidence: readonly InferredPiEvidenceRead[],
  plannedLeadPersonIds: ReadonlySet<string>,
): string[] {
  return edges
    .filter((edge) => {
      if (!edge.sourceName || plannedLeadPersonIds.has(edge.personId)) return false;
      const personReads = evidence.filter((read) => read.personId === edge.personId);
      if (personReads.some((read) => read.live)) return false;
      return personReads.some(
        (read) =>
          read.sourceName === edge.sourceName && (read.sourceUrl || '') === (edge.sourceUrl || ''),
      );
    })
    .map((edge) => edge.id);
}

async function retiredEvidenceLeadEdgesToEnd(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
  plannedLeadPersonIds: ReadonlySet<string>,
): Promise<LeadEdgeToEnd[]> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  if (!entityObjectId) return [];
  const edgeDocs = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityObjectId,
    role: 'PI',
    'rosterProvenance.sourceName': { $nin: [null, ''] },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('_id personId rosterProvenance')
    .lean()) as Array<{
    _id: unknown;
    personId?: unknown;
    rosterProvenance?: { sourceName?: string; sourceUrl?: string };
  }>;
  const edges: InferredPiLeadEdge[] = edgeDocs
    .map((edge) => ({
      id: String(edge._id),
      personId: String(edge.personId ?? ''),
      sourceName: textValue(edge.rosterProvenance?.sourceName),
      sourceUrl: textValue(edge.rosterProvenance?.sourceUrl),
    }))
    .filter((edge) => edge.personId && !plannedLeadPersonIds.has(edge.personId));
  if (edges.length === 0) return [];
  const row = (await ResearchEntity.findById(entityObjectId).select('slug').lean()) as {
    slug?: string;
  } | null;
  const entityKeys = uniqueStrings([
    textValue(row?.slug),
    ...observations.map((observation) =>
      textValue((observation as { entityKey?: unknown }).entityKey),
    ),
  ]).filter(Boolean);
  const reads = (await Observation.find({
    field: 'inferredPiUserId',
    value: { $in: uniqueStrings(edges.map((edge) => edge.personId)) },
    $or: [
      { entityId: { $in: [entityObjectId, String(entityObjectId)] } },
      ...(entityKeys.length > 0 ? [{ entityKey: { $in: entityKeys } }] : []),
    ],
  })
    .select('value sourceName sourceUrl superseded rollback scrapeRunId')
    .lean()) as any[];
  const invalidatedRuns = new Set(await invalidatedScrapeRunIds());
  const evidence: InferredPiEvidenceRead[] = reads.map((read) => ({
    personId: textValue(read.value),
    sourceName: textValue(read.sourceName),
    sourceUrl: textValue(read.sourceUrl),
    live:
      read.superseded !== true &&
      !read.rollback?.rolledBackAt &&
      !invalidatedRuns.has(read.scrapeRunId == null ? '' : String(read.scrapeRunId)),
  }));
  const personById = new Map(edges.map((edge) => [edge.id, edge.personId]));
  return inferredPiEdgesWithOnlyRetiredEvidence(edges, evidence, plannedLeadPersonIds).map(
    (edgeId) => ({ edgeId, personId: personById.get(edgeId) ?? '', reason: 'retired-evidence' }),
  );
}

/**
 * A lead whose triple carries a refusal (an operator end, or a DISPUTED detachment with no live
 * edge beside it) is not asserted again, so the plan a dry run reports is the write an apply
 * makes: the membership writer refuses the triple too (#5979).
 */
async function withoutProtectedLeads(
  researchEntityId: string,
  planned: InferredPiLeadFacts[],
): Promise<InferredPiLeadFacts[]> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  if (!entityObjectId || planned.length === 0) return planned;
  const kept: InferredPiLeadFacts[] = [];
  for (const facts of planned) {
    const personId = toMaterializerObjectId(facts.personId);
    const role = canonicalRoleForLegacy(facts.legacyRole);
    const blocked =
      personId &&
      role &&
      (await protectedRoleEdgeFor({
        personId,
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': entityObjectId,
        role,
      })) !== null;
    if (!blocked) kept.push(facts);
  }
  return kept;
}

/**
 * The row's lead edges as its inferred-lead evidence decides them. Each step reads the edges
 * the step before it left, so an apply writes in the order the steps run, and a dry run reads
 * the stored edges without the assertions it would have made.
 */
export async function resolveLeadEdges(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
  options: { apply: boolean },
): Promise<LeadEdgeResolution> {
  const screened = await contradictedPageLeadObservations(observations);
  const planned = await withoutProtectedLeads(
    researchEntityId,
    await planInferredPiMembership(researchEntityId, observations, screened),
  );
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  const ledBefore = new Set(
    entityObjectId && planned.length > 0
      ? (
          (await RoleAssignment.find({
            'target.kind': 'RESEARCH_ENTITY',
            'target.id': entityObjectId,
            role: 'PI',
            state: { $ne: 'HISTORICAL' },
            archived: { $ne: true },
          })
            .select('personId')
            .lean()) as Array<{ personId?: unknown }>
        ).map((edge) => String(edge.personId ?? ''))
      : [],
  );
  if (options.apply) {
    for (const facts of planned) {
      await materializeCanonicalPiMembership(researchEntityId, facts);
    }
  }
  const ended: LeadEdgeToEnd[] = [];
  const endedEdgeIds = new Set<string>();
  const end = async (edges: LeadEdgeToEnd[], extraFilter?: object) => {
    const fresh = edges.filter((edge) => !endedEdgeIds.has(edge.edgeId));
    for (const edge of fresh) endedEdgeIds.add(edge.edgeId);
    ended.push(...fresh);
    if (options.apply) await endLeadEdges(fresh, extraFilter);
  };
  const dryRunOverlay: DryRunLeadEdgeOverlay | undefined = options.apply
    ? undefined
    : {
        pendingAssertions: new Map(
          planned.map((facts) => [
            facts.personId,
            { sourceName: textValue(facts.sourceName), sourceUrl: textValue(facts.sourceUrl) },
          ]),
        ),
        endedEdgeIds,
      };
  await end(
    await contradictedPageLeadEdgesToEnd(
      researchEntityId,
      contradictedPageLeadEdges(screened),
      dryRunOverlay?.pendingAssertions,
    ),
  );
  const plannedLeadPersonIds = new Set(planned.map((facts) => facts.personId));
  await end(
    await retiredEvidenceLeadEdgesToEnd(researchEntityId, observations, plannedLeadPersonIds),
  );
  await end(
    await sourcelessLeadEdgesToEnd(
      researchEntityId,
      observations,
      plannedLeadPersonIds,
      dryRunOverlay,
    ),
    { 'rosterProvenance.sourceName': { $in: [null, ''] } },
  );
  return {
    asserted: planned.map((facts) => ({
      personId: facts.personId,
      sourceName: facts.sourceName,
      sourceUrl: facts.sourceUrl,
      isNewEdge: !ledBefore.has(facts.personId),
    })),
    ended,
  };
}

export async function materializeInferredPiMembership(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
): Promise<void> {
  await resolveLeadEdges(researchEntityId, observations, { apply: true });
}

export interface SourcelessLeadEdgeRow extends ResearchHomeCandidate {
  leadVerification?: {
    leads?: Array<{ personId?: unknown; verdict?: unknown; matchedBy?: unknown }>;
  };
}

export interface RowLeadEdge {
  id: string;
  personId: string;
  hasRecordedSource: boolean;
}

/**
 * Owner decision on #5979 C4, option (a): a lead edge with no recorded source is kept until a
 * current lane contradicts it. It is contradicted when nothing live names the person as lead
 * (no live lead read resolves to them, and the row's site does not confirm them by their own
 * profile link or the site address), and either the site's verdict for them is CONTRADICTED,
 * or the row is named for another person who holds a lead edge a lane recorded while the row
 * is not named for this one. A site that merely mentions the person confirms only that they
 * appear there: a blind ballot found such a mention was a trainee on another person's lab.
 */
export function contradictedSourcelessLeadEdgeIds(input: {
  row: SourcelessLeadEdgeRow;
  edges: readonly RowLeadEdge[];
  people: ReadonlyMap<string, GrantTargetPerson>;
  plannedLeadPersonIds: ReadonlySet<string>;
}): string[] {
  const judgementFor = (personId: string) =>
    (input.row.leadVerification?.leads ?? []).find(
      (judgement) => String(judgement.personId ?? '') === personId,
    );
  const namedFor = (personId: string) => {
    const person = input.people.get(personId);
    return Boolean(person) && rowIsNamedForPerson(input.row, person!);
  };
  const recordedOwners = new Set(
    input.edges
      .filter((edge) => edge.hasRecordedSource && namedFor(edge.personId))
      .map((edge) => edge.personId),
  );
  return input.edges
    .filter((edge) => {
      if (edge.hasRecordedSource || input.plannedLeadPersonIds.has(edge.personId)) return false;
      if (recordedOwners.has(edge.personId)) return false;
      const judgement = judgementFor(edge.personId);
      if (judgement?.verdict === 'CONTRADICTED') return true;
      if (judgement?.verdict === 'CONFIRMED' && judgement.matchedBy !== 'NAMED_ON_PAGE') {
        return false;
      }
      const ownedByAnother = [...recordedOwners].some((owner) => owner !== edge.personId);
      return ownedByAnother && !namedFor(edge.personId);
    })
    .map((edge) => edge.id);
}

async function sourcelessLeadEdgesToEnd(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
  plannedLeadPersonIds: ReadonlySet<string>,
  dryRunOverlay?: DryRunLeadEdgeOverlay,
): Promise<LeadEdgeToEnd[]> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  if (!entityObjectId) return [];
  const edgeDocs = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityObjectId,
    role: { $in: LEAD_ROLE_CANONICAL_VALUES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('_id personId rosterProvenance')
    .lean()) as Array<{
    _id: unknown;
    personId?: unknown;
    rosterProvenance?: { sourceName?: string };
  }>;
  const storedEdges: RowLeadEdge[] = edgeDocs.map((edge) => ({
    id: String(edge._id),
    personId: String(edge.personId ?? ''),
    hasRecordedSource: Boolean(textValue(edge.rosterProvenance?.sourceName)),
  }));
  const edges = dryRunOverlay
    ? leadEdgesAfterPendingAssertions(storedEdges, dryRunOverlay)
    : storedEdges;
  if (!edges.some((edge) => !edge.hasRecordedSource)) return [];
  const directorRead = await resolveInferredDirector(observations);
  const liveLeadPersonIds =
    'director' in directorRead
      ? new Set([...plannedLeadPersonIds, directorRead.director.researcherId])
      : plannedLeadPersonIds;
  const row = (await ResearchEntity.findById(entityObjectId)
    .select(`${RESEARCH_HOME_CANDIDATE_FIELDS} leadVerification`)
    .lean()) as SourcelessLeadEdgeRow | null;
  if (!row) return [];
  const people = (await Researcher.find({
    _id: { $in: uniqueStrings(edges.map((edge) => edge.personId)) },
  })
    .select('_id displayName profileLinks')
    .lean()) as Array<{ _id: unknown } & GrantTargetPerson>;
  const ended = contradictedSourcelessLeadEdgeIds({
    row,
    edges,
    people: new Map(people.map((person) => [String(person._id), person])),
    plannedLeadPersonIds: liveLeadPersonIds,
  });
  const personById = new Map(edges.map((edge) => [edge.id, edge.personId]));
  return ended.map((edgeId) => ({
    edgeId,
    personId: personById.get(edgeId) ?? '',
    reason: 'contradicted-sourceless',
  }));
}

function leadEdgesAfterPendingAssertions(
  edges: readonly RowLeadEdge[],
  overlay: DryRunLeadEdgeOverlay,
): RowLeadEdge[] {
  const sourcedPersonIds = new Set(
    [...overlay.pendingAssertions]
      .filter(([, assertion]) => assertion.sourceName)
      .map(([personId]) => personId),
  );
  const live = edges
    .filter((edge) => !overlay.endedEdgeIds.has(edge.id))
    .map((edge) =>
      sourcedPersonIds.has(edge.personId) ? { ...edge, hasRecordedSource: true } : edge,
    );
  const inserted = [...sourcedPersonIds]
    .filter((personId) => !live.some((edge) => edge.personId === personId))
    .map((personId) => ({ id: `pending:${personId}`, personId, hasRecordedSource: true }));
  return [...live, ...inserted];
}

type RosterEmailAliasResolution =
  { status: 'resolved'; netid: string } | { status: 'absent' } | { status: 'ambiguous' };

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
 * A candidate that is not a Yale netid, such as another alias key, is never a target (#5740).
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
    { entityKey: 1, sourceName: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: unknown; sourceName?: unknown; value?: unknown }>;
  const directory = matches.some(
    (match) => match.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE,
  )
    ? await loadDirectoryNetidsByAddress()
    : new Map();
  const netids = uniqueStrings(
    matches
      .filter(
        (match) =>
          match.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE ||
          !directoryContradictsNetidForAddress(
            netidNamedByUserEntityKey(match.entityKey),
            match.value,
            directory,
          ),
      )
      .map((match) => netidNamedByUserEntityKey(match.entityKey))
      .filter((netid) => looksLikeYaleNetid(netid) && netid !== local),
  );
  if (netids.length === 1) return { status: 'resolved', netid: netids[0] };
  return { status: netids.length > 1 ? 'ambiguous' : 'absent' };
}

/**
 * The netid a `user` entityKey names, or nothing when the key belongs to another namespace.
 * A grant lane keys its people `nsf-pi:<name>` and carries their address as an `email`
 * observation, so reading every key as a netid made that name a second netid for the alias
 * and turned a resolvable alias `ambiguous`.
 */
export function netidNamedByUserEntityKey(entityKey: unknown): string {
  const netid = userLookupValueForInferredPiUserKey(entityKey).toLowerCase();
  return NAMESPACED_USER_KEY_PATTERN.test(netid) || /\s/.test(netid) ? '' : netid;
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
type InferredPiKeyResolution = ResearcherPersonNameResolution & {
  aliasNamesSeveralNetids?: boolean;
};

async function resolveInferredPiKeyIdentity(
  identity: InferredPiKeyIdentity,
): Promise<InferredPiKeyResolution> {
  if (identity.netid) {
    const byNetid = await resolveResearcherIdForPersonName('', { netid: identity.netid });
    // A local-part netid that matches is the alias's own twin account, so the directory's
    // map still outranks it, or the twin keeps every observation keyed on the alias (#4988).
    if (byNetid.status === 'matched' && !isLikelyYaleEmailLocalPart(identity.netid)) {
      return byNetid;
    }
    const aliasMapping = await resolveNetidForRosterEmailAlias(identity.netid);
    if (aliasMapping.status === 'resolved' && aliasMapping.netid !== identity.netid) {
      const byHealedNetid = await resolveResearcherIdForPersonName('', {
        netid: aliasMapping.netid,
      });
      if (byHealedNetid.status === 'matched') return byHealedNetid;
    }
    if (byNetid.status === 'matched') return byNetid;
    if (aliasMapping.status === 'ambiguous') {
      return { status: 'ambiguous', aliasNamesSeveralNetids: true };
    }
  }
  const name = identity.name || identity.emailAliasName || '';
  if (!name) return { status: 'absent' };
  return resolveResearcherIdForPersonName(name, {});
}

const NAMESPACED_USER_KEY_PATTERN = /^[a-z][a-z-]*:/i;
const BARE_ROSTER_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const YALE_EMAIL_PATTERN = /^([a-z0-9][a-z0-9._-]*)@(?:[a-z0-9-]+\.)*yale\.edu$/i;

/**
 * The `user` entityKey a stored `inferredPiUserKey` names. Department rosters and the YSM
 * directory have stored the same identity three ways - `netid:<alias>`, the bare alias, and
 * the Yale email address - while `user` observations are keyed only by the first, so a bare
 * or email key matched no `user` key and the person it names was never reached (#4697).
 * Derived on every read rather than rewritten, so the stored evidence stays as observed.
 */
export function userEntityKeyForInferredPiUserKey(value: unknown): string {
  const raw = textValue(value);
  if (!raw || NAMESPACED_USER_KEY_PATTERN.test(raw)) return raw;
  const email = raw.match(YALE_EMAIL_PATTERN);
  if (email) return `netid:${email[1].toLowerCase()}`;
  if (BARE_ROSTER_ALIAS_PATTERN.test(raw)) return `netid:${raw.toLowerCase()}`;
  return raw;
}

export async function userIdentityJoinForKey(
  userEntityKey: string,
): Promise<{ join: UserIdentityJoinResult; observations: any[] } | undefined> {
  const read = await Observation.find({
    entityType: 'user',
    entityKey: userEntityKey,
    ...materializationReadScopeFilter(),
  }).lean();
  const kept = await withoutDirectoryContradictedProfileEvidenceForKey(
    userEntityKey,
    partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds()).kept,
  );
  if (kept.length === 0) return undefined;
  return {
    join: await joinUserIdentityToExistingResearcher({ entityKey: userEntityKey }, kept),
    observations: kept,
  };
}

const isLiveObservation = (observation: any): boolean =>
  observation?.superseded !== true && !observation?.rollback?.rolledBackAt;

const liveObservationsStatingEmail = (observations: readonly any[], email: string): any[] =>
  observations.filter(
    (observation) =>
      observation?.field === 'email' &&
      isLiveObservation(observation) &&
      !shouldIgnoreObservationForEntityMaterialization('user', observation) &&
      normalizedAccountEmail(observation.value) === email,
  );

export interface EmailSupportJoinedKey {
  entityKey: string;
  observations: readonly any[];
}

/**
 * Whether evidence still states a researcher's stored address (#5627). A `user` key counts
 * only when the engine's own identity join reaches this researcher from it, so an address a
 * namesake's key states never backs the record. `joinedKey` is the key a materialize pass is
 * resolving, already joined to this researcher, which a researcher still being minted cannot
 * reach through a fresh join.
 */
export async function researcherEmailSupport(
  researcher: { _id?: unknown; identifiers?: { email?: unknown } | null },
  joinedKey?: EmailSupportJoinedKey,
): Promise<ResearcherEmailSupport | undefined> {
  const email = normalizedAccountEmail(researcher.identifiers?.email);
  const researcherId = idValue(researcher._id);
  if (!email || !researcherId) return undefined;
  const candidateKeys = (
    (await Observation.distinct('entityKey', {
      entityType: 'user',
      field: 'email',
      value: new RegExp(`^${escapeRegex(email)}$`, 'i'),
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    })) as unknown[]
  )
    .map(textValue)
    .filter((key) => key && key !== joinedKey?.entityKey)
    .sort();
  const sources = new Set<string>();
  const addSources = (observations: readonly any[]) => {
    for (const observation of liveObservationsStatingEmail(observations, email)) {
      sources.add(textValue(observation.sourceName));
    }
  };
  if (joinedKey) addSources(joinedKey.observations);
  for (const entityKey of candidateKeys) {
    const read = await userIdentityJoinForKey(entityKey);
    if (idValue(read?.join.researcher?._id) !== researcherId) continue;
    addSources(read?.observations ?? []);
  }
  const sortedSources = [...sources].filter(Boolean).sort();
  return { supported: sortedSources.length > 0, sources: sortedSources, computedForEmail: email };
}

export const sameResearcherEmailSupport = (
  stored: Partial<ResearcherEmailSupport> | undefined | null,
  computed: ResearcherEmailSupport | undefined,
): boolean =>
  (!stored && !computed) ||
  (Boolean(stored) &&
    Boolean(computed) &&
    stored?.supported === computed?.supported &&
    stored?.computedForEmail === computed?.computedForEmail &&
    JSON.stringify(stored?.sources ?? []) === JSON.stringify(computed?.sources ?? []));

async function researcherReachedByUserIdentity(
  userEntityKey: string,
): Promise<{ researcherId: mongoose.Types.ObjectId; observedTitle?: string } | undefined> {
  const join = (await userIdentityJoinForKey(userEntityKey))?.join;
  if (!join?.researcher?._id) return undefined;
  return { researcherId: join.researcher._id, observedTitle: join.title };
}

/**
 * The researcher a key's own per-person identifier names: the sole live claimant of the
 * key's observed email, else the sole live holder of the official profile page it cites,
 * either under a name that agrees with the one the key observes. Both are per-person
 * identifiers where the directory's alias map is not, so they still decide when that map
 * names two netids for the alias (#2799 stops the netid and name walk there).
 */
async function researcherIdentifiedByUserKeyIdentifier(
  userEntityKey: string,
): Promise<{ researcherId: mongoose.Types.ObjectId; observedTitle?: string } | undefined> {
  const read = await userIdentityJoinForKey(userEntityKey);
  if (!read?.join.displayName) return undefined;
  const { join, observations } = read;
  const identified = (researcher: any) =>
    researcher?._id ? { researcherId: researcher._id, observedTitle: join.title } : undefined;
  const observedEmail = normalizedAccountEmail(join.resolved.email?.value);
  const byEmail = observedEmail
    ? await researcherTheObservedEmailNames(observedEmail, join.displayName)
    : undefined;
  if (byEmail) return identified(byEmail);
  const pageHolder = await soleLiveResearcherClaimingOfficialProfileUrl(
    officialProfileJoinUrlsFromObservations(
      observations.filter((o: any) => !shouldIgnoreObservationForEntityMaterialization('user', o)),
    ),
  );
  return pageHolder && observedPersonNameAgreesWith(pageHolder.displayName, join.displayName)
    ? identified(pageHolder)
    : undefined;
}

async function namesAnotherPersonsLab(entityName: string, personName: string): Promise<boolean> {
  const eponyms = eponymousLabNameSurnameCandidates(entityName);
  if (eponyms.length === 0) return false;
  const identity = personIdentityTokens(personName);
  if (eponyms.some((eponym) => eponymMatchesIdentity(eponym, identity))) return false;
  const knownSurnames = await loadKnownPersonSurnameRoster();
  return eponyms.some((eponym) => knownSurnames.has(eponym));
}

async function researcherCanLeadEntity(
  researcherId: mongoose.Types.ObjectId,
  entityName: string,
  observedTitle?: string,
): Promise<boolean> {
  const researcher: any = await Researcher.findById(researcherId)
    .select('displayName profile.title')
    .lean();
  if (!researcher) return false;
  const title = textValue(researcher.profile?.title) || textValue(observedTitle);
  if (cannotOwnResearchHome(title)) return false;
  return !(await namesAnotherPersonsLab(entityName, textValue(researcher.displayName)));
}

/**
 * Resolves a stored PI key to a researcher. The netid, alias-map and key-name walk runs
 * first on the key as stored, and whatever it matches stands exactly as before.
 * Two routes are added after it. Both refuse a researcher whose title cannot own a
 * research row, since a lead edge on such a person is retired again by
 * `retireNonOwnerPiEdges`, and a researcher other than the person an eponymous lab name
 * names as a known researcher's surname, because a roster that lists a lab member under the
 * PI field yields a key that is faithfully that member's (measured: 3 of the first 22 rows
 * these routes reached). The surname roster keeps a topical name from reading as a person's:
 *   - a bare or email key, read in `user`-key form (`userEntityKeyForInferredPiUserKey`);
 *   - the identity join the `user` materializer itself uses (email account, official
 *     profile page, full observed name), so the reclaim reaches the researcher the
 *     materializer already enriches for this key rather than reporting it unresolved.
 * An alias the directory maps to several netids still stops the walk, except that the key's
 * own observed address or official page may still name its sole live holder
 * (`researcherIdentifiedByUserKeyIdentifier`).
 */
async function resolveInferredPiUserKey(
  value: unknown,
  entityName: () => Promise<string>,
): Promise<ResearcherPersonNameResolution> {
  const asStored = await resolveInferredPiKeyIdentity(inferredPiUserKeyIdentity(value));
  if (asStored.status === 'matched') return asStored;
  const userKey = userEntityKeyForInferredPiUserKey(value);
  const byKeyIdentifier = async (): Promise<ResearcherPersonNameResolution> => {
    const identified = await researcherIdentifiedByUserKeyIdentifier(userKey);
    if (!identified) return asStored;
    const canLead = await researcherCanLeadEntity(
      identified.researcherId,
      await entityName(),
      identified.observedTitle,
    );
    return canLead ? { status: 'matched', researcherId: identified.researcherId } : asStored;
  };
  if (asStored.aliasNamesSeveralNetids) return byKeyIdentifier();
  if (userKey !== textValue(value)) {
    const asUserKey = await resolveInferredPiKeyIdentity(inferredPiUserKeyIdentity(userKey));
    if (asUserKey.aliasNamesSeveralNetids) return byKeyIdentifier();
    if (asUserKey.status === 'matched' && asUserKey.researcherId) {
      return (await researcherCanLeadEntity(asUserKey.researcherId, await entityName()))
        ? asUserKey
        : asStored;
    }
  }
  const joined = await researcherReachedByUserIdentity(userKey);
  if (!joined) return asStored;
  const canLead = await researcherCanLeadEntity(
    joined.researcherId,
    await entityName(),
    joined.observedTitle,
  );
  return canLead ? { status: 'matched', researcherId: joined.researcherId } : asStored;
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
    .select('displayName identifiers')
    .lean();
  if (!researcher) return { displayName: '' };
  return {
    netid: textValue(researcher.identifiers?.netid) || undefined,
    email: textValue(researcher.identifiers?.email) || undefined,
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
  const researcher = (await Researcher.findById(researcherId).select('profile').lean()) as {
    profile?: { primaryDepartment?: unknown };
  } | null;
  return textValue(researcher?.profile?.primaryDepartment) || undefined;
}

export type LeadPiSchoolInheritanceSkip =
  | 'locked'
  | 'has-school'
  | 'has-school-and-department'
  | 'multi-pi-kind'
  | 'no-single-lead'
  | 'no-department'
  | 'no-school-derivable'
  | 'inherited-matches-lead'
  | 'out-of-scope';

export interface LeadPiSchoolInheritanceResult {
  inherited: boolean;
  school?: string;
  departments?: string[];
  skipped?: LeadPiSchoolInheritanceSkip;
  /** Fields this pass asserted as observations, so the value survives a re-projection. */
  observed?: string[];
  refreshed?: Array<'school' | 'departments'>;
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

export function leadPiInheritedFields(fieldProvenance: unknown): Set<'school' | 'departments'> {
  const entries = (fieldProvenance ?? {}) as Record<string, { sourceName?: unknown } | undefined>;
  const inherited = new Set<'school' | 'departments'>();
  for (const field of ['school', 'departments'] as const) {
    if (entries[field]?.sourceName === LEAD_PI_SCHOOL_INHERITANCE_SOURCE) inherited.add(field);
  }
  return inherited;
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
          .select(
            'school departments schools kind entityType fieldProvenance.school fieldProvenance.departments',
          )
          .lean()
  ) as {
    school?: unknown;
    departments?: unknown;
    schools?: unknown;
    kind?: unknown;
    fieldProvenance?: unknown;
  } | null;
  if (!entity) return { inherited: false };
  const gate = leadPiSchoolInheritanceGate({
    manuallyLockedFields: options.manuallyLockedFields,
    school: entity.school,
    schools: entity.schools,
    kind: entity.kind,
    departments: entity.departments,
  });
  const inheritedFields = leadPiInheritedFields(entity.fieldProvenance);
  const refreshable = gate === 'has-school-and-department' && inheritedFields.size > 0;
  if (gate !== 'school-and-department' && gate !== 'department-only' && !refreshable) {
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
  const refreshesSchool =
    gate !== 'school-and-department' &&
    inheritedFields.has('school') &&
    Boolean(leadOrgUnit) &&
    textValue(entity.school) !== leadOrgUnit?.school;
  const fillsDepartments = existingDepartments.length === 0;
  const refreshesDepartments =
    !fillsDepartments &&
    inheritedFields.has('departments') &&
    !existingDepartments.includes(canonicalDepartment);
  const writesSchool = gate === 'school-and-department' || refreshesSchool;
  const writesDepartments = fillsDepartments || refreshesDepartments;
  if (!writesSchool && !writesDepartments) {
    return { inherited: false, skipped: 'inherited-matches-lead' };
  }
  const set: Record<string, unknown> = {
    ...(writesSchool && leadOrgUnit ? { school: leadOrgUnit.school } : {}),
    ...(writesDepartments ? { departments: [canonicalDepartment] } : {}),
  };
  await applyResearchEntityOrgUnitCanonicalization(set, entity);
  if (!writesSchool) {
    // Canonicalization derives a parent school from the department it just set, so
    // it would rewrite the school this row already holds to the lead's own school -
    // a School of the Environment row becoming School of Medicine because its PI is
    // appointed in Genetics. The row's own school is the better evidence.
    delete set.school;
    if (!refreshesDepartments) delete set.schools;
  }
  const refreshed = [
    ...(refreshesSchool ? (['school'] as const) : []),
    ...(refreshesDepartments ? (['departments'] as const) : []),
  ];
  if (refreshed.length > 0 && !writesDepartments) {
    // A refresh replaces only the inherited fields, so a department another source
    // stated and the labels derived from it stay as stored.
    delete set.departments;
    delete set.orgAffiliationLabels;
  }
  const derivedSchool = textValue(set.school);
  if (gate === 'school-and-department' && !derivedSchool) {
    return { inherited: false, skipped: 'no-school-derivable' };
  }
  const departments = Array.isArray(set.departments)
    ? (set.departments as string[])
    : existingDepartments;
  if (departments.length === 0) return { inherited: false, skipped: 'no-department' };
  const refreshReport = refreshed.length > 0 ? { refreshed: [...refreshed] } : {};

  if (options.dryRun) {
    return {
      inherited: true,
      ...(derivedSchool ? { school: derivedSchool } : {}),
      departments,
      ...refreshReport,
    };
  }

  const writtenFields = [
    ...(derivedSchool ? ['school'] : []),
    ...(writesDepartments ? ['departments'] : []),
  ];
  const assertedValues = {
    ...(derivedSchool ? { school: derivedSchool } : {}),
    ...(writesDepartments ? { departments } : {}),
  };
  const assertion = await assertLeadPiInheritanceObservations(researchEntityId, assertedValues);
  const evidence = await leadPiInheritanceEvidence(researchEntityId, assertedValues);
  if (writtenFields.some((field) => !evidence.has(field))) {
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
    ...refreshReport,
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
  skipped?:
    | 'no-observation'
    | 'unresolved-user'
    | 'name-mismatch'
    | Exclude<CanonicalMembershipOutcome, 'created' | 'updated' | 'unchanged'>;
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
/**
 * Where the code lane (`center-director`) names a director, its observations alone decide
 * the lead: the director fields supersede per field, so mixing a name from one lane with a
 * profile URL from another would write one person's edge under another's name (#5296).
 */
function preferredDirectorObservations(
  observations: MaterializerObservationLike[],
): MaterializerObservationLike[] {
  const codeLane = observations.filter(
    (obs) =>
      textValue(obs.sourceName) === CENTER_DIRECTOR_SOURCE_NAME &&
      textValue(obs.field).startsWith('inferredDirector'),
  );
  return codeLane.some((obs) => obs.field === 'inferredDirectorUserName') ? codeLane : observations;
}

interface ResolvedInferredDirector {
  researcherId: string;
  name: string;
  role: 'director' | 'co-director';
  profileUrl: string;
  roleSource: MaterializerObservationLike;
  enrichment: Awaited<ReturnType<typeof canonicalResearcherIdentity>>;
}

function inferredDirectorIdentity(director: ResolvedInferredDirector): CanonicalMemberIdentity {
  const personId = toMaterializerObjectId(director.researcherId);
  return {
    netid: director.enrichment.netid,
    email: director.enrichment.email,
    orcid: director.enrichment.orcid,
    displayName: director.name,
    hasCanonicalSourceReference: true,
    ...(personId ? { resolvedPersonId: personId } : {}),
  };
}

async function resolveInferredDirector(
  observations: MaterializerObservationLike[],
): Promise<
  | { director: ResolvedInferredDirector }
  | { skipped: 'no-observation' | 'unresolved-user' | 'name-mismatch' }
> {
  const directorObservations = preferredDirectorObservations(observations);
  const fieldObs = (field: string) => directorObservations.find((obs) => obs.field === field);
  const nameObs = fieldObs('inferredDirectorUserName');
  if (!nameObs || !nameObs.value) return { skipped: 'no-observation' };

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
  if (!researcher?._id) return { skipped: 'unresolved-user' };

  const researcherId = idValue(researcher._id);
  const enrichment = await canonicalResearcherIdentity(researcherId);
  if (!observedPersonNameAgreesWith(enrichment.displayName, textValue(name))) {
    return { skipped: 'name-mismatch' };
  }
  return {
    director: {
      researcherId,
      name,
      role,
      profileUrl,
      roleSource: fieldObs('inferredDirectorRole') || nameObs,
      enrichment,
    },
  };
}

/**
 * The director edge the row's director-lane evidence decides, planned the way the director
 * writer would make it, so a `leadEdges` dry run previews it and an apply writes it. A
 * director an operator ended on this row is not planned, because the writer refuses it.
 */
export async function resolveDirectorLeadEdge(
  researchEntityId: string,
  observations: MaterializerObservationLike[],
  options: { apply: boolean },
): Promise<LeadEdgeResolution['asserted']> {
  const entityObjectId = toMaterializerObjectId(researchEntityId);
  if (!entityObjectId) return [];
  const resolution = await resolveInferredDirector(observations);
  if ('skipped' in resolution) return [];
  const { researcherId, role: legacyRole, profileUrl, roleSource } = resolution.director;
  const personId = toMaterializerObjectId(researcherId);
  const role = canonicalRoleForLegacy(legacyRole);
  if (!personId || !role) return [];
  const triple = {
    personId,
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityObjectId,
    role,
  };
  if ((await protectedRoleEdgeFor(triple)) !== null) return [];
  if (
    !options.apply &&
    (await canonicalMemberIsRemovedByRequest(
      inferredDirectorIdentity(resolution.director),
      personId,
      profileUrl || undefined,
    ))
  ) {
    return [];
  }
  const isNewEdge = !(await RoleAssignment.exists({
    ...triple,
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  }));
  if (options.apply) {
    const written = await materializeInferredDirectorMembership(researchEntityId, observations);
    if (!written.written) return [];
  }
  return [
    {
      personId: String(personId),
      sourceName: textValue(roleSource.sourceName),
      sourceUrl: profileUrl || textValue(roleSource.sourceUrl),
      isNewEdge,
      role,
    },
  ];
}

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

  const resolution = await resolveInferredDirector(observations);
  if ('skipped' in resolution) return { ...empty, skipped: resolution.skipped };
  const { researcherId, name, role, profileUrl, roleSource } = resolution.director;
  const observedAt = roleSource.observedAt || new Date();
  const confidence = typeof roleSource.confidence === 'number' ? roleSource.confidence : 0.85;
  const sourceUrl = textValue(roleSource.sourceUrl);
  const sourceName = textValue(roleSource.sourceName);

  const directorResearcherId = researcherId;
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

  const directorPersonId = toMaterializerObjectId(directorResearcherId);
  const directorIdentity = inferredDirectorIdentity(resolution.director);
  const directorOutcome = await materializeCanonicalMembership(
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
  if (
    directorOutcome !== 'created' &&
    directorOutcome !== 'updated' &&
    directorOutcome !== 'unchanged'
  ) {
    return { ...empty, skipped: directorOutcome };
  }

  const supersededPersonId =
    directorPersonId ?? (await resolveCanonicalResearcherId(directorIdentity));
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

function servedUserNameField(field: string, value: string): string {
  const sanitized = field === 'fname' ? sanitizePersonGivenName(value) : sanitizePersonName(value);
  return sanitized ?? normalizePersonNameCasing(value);
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

async function heldLeadPersonId(researchEntityId: string): Promise<string | undefined> {
  const targetId = toMaterializerObjectId(researchEntityId);
  if (!targetId) return undefined;
  const held = (await RoleAssignment.findOne({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': targetId,
    role: 'PI',
  })
    .select('personId')
    .lean()) as { personId?: unknown } | null;
  return held ? normalizeMaterializerObjectId(held.personId) || '' : undefined;
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

interface PiLinkedResearchEntityCandidate {
  _id: unknown;
  name?: unknown;
  slug?: string;
  entityType?: unknown;
  kind?: unknown;
  studentVisibilityTier?: unknown;
  fullDescription?: unknown;
  createdAt?: unknown;
}

async function piLinkedResearchEntityCandidatesByPersonName(
  Model: mongoose.Model<any, any, any, any>,
  personName: string,
): Promise<PiLinkedResearchEntityCandidate[]> {
  if (!personName) return [];

  const researcherIdString = await findUniqueResearcherIdByPersonName(personName);
  const researcherId = toMaterializerObjectId(researcherIdString);
  if (!researcherId) return [];
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
  if (candidateIds.length === 0) return [];

  return Model.find({
    _id: { $in: candidateIds },
    archived: { $ne: true },
  })
    .select('_id name slug entityType kind studentVisibilityTier fullDescription createdAt')
    .lean();
}

async function resolveUniquePiLinkedResearchEntityByPersonName(
  Model: mongoose.Model<any, any, any, any>,
  personName: string,
): Promise<any | null> {
  const candidates = await piLinkedResearchEntityCandidatesByPersonName(Model, personName);
  return uniqueNonGeneratedPiLinkedResearchEntity(Model, personName, candidates);
}

async function uniqueNonGeneratedPiLinkedResearchEntity(
  Model: mongoose.Model<any, any, any, any>,
  personName: string,
  candidates: PiLinkedResearchEntityCandidate[],
): Promise<any | null> {
  if (candidates.length === 0) return null;
  const parts = personName.split(/\s+/).filter(Boolean);
  const compatibleNames = piCompatibleResearchEntityNames(
    parts.slice(0, -1).join(' '),
    parts[parts.length - 1],
  );
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
  Model: mongoose.Model<any, any, any, any>,
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

function deptRosterFoldPreferenceKey(candidate: PiLinkedResearchEntityCandidate): string[] {
  const createdAt = new Date(candidate.createdAt as string | number | Date).getTime();
  return [
    candidate.studentVisibilityTier === 'student_ready' ? '0' : '1',
    isFacultyResearchAreaKey(candidate.slug) ? '0' : '1',
    textValue(candidate.fullDescription) ? '0' : '1',
    String(Number.isFinite(createdAt) ? createdAt : Number.MAX_SAFE_INTEGER).padStart(16, '0'),
    textValue(candidate.slug),
  ];
}

function compareDeptRosterFoldPreference(
  left: PiLinkedResearchEntityCandidate,
  right: PiLinkedResearchEntityCandidate,
): number {
  const leftKey = deptRosterFoldPreferenceKey(left);
  const rightKey = deptRosterFoldPreferenceKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] !== rightKey[index]) return leftKey[index] < rightKey[index] ? -1 : 1;
  }
  return 0;
}

export function preferredGeneratedFoldTarget(
  candidates: PiLinkedResearchEntityCandidate[],
): PiLinkedResearchEntityCandidate | null {
  if (candidates.some((candidate) => !isGeneratedResearchEntitySlug(candidate.slug))) return null;
  const personRows = candidates.filter((candidate) => isPersonScopedResearchEntityShape(candidate));
  if (personRows.length === 0) return null;
  return [...personRows].sort(compareDeptRosterFoldPreference)[0];
}

async function deptRosterShellFoldTarget(personName: string): Promise<any | null> {
  const candidates = await piLinkedResearchEntityCandidatesByPersonName(ResearchEntity, personName);
  const nonGenerated = await uniqueNonGeneratedPiLinkedResearchEntity(
    ResearchEntity,
    personName,
    candidates,
  );
  if (nonGenerated) return nonGenerated;
  return preferredGeneratedFoldTarget(candidates);
}

/**
 * A department-roster observation mints a `dept-<dept>-<person>` shell per
 * appointment. Left alone, these never get a canonicalGroupId tombstone or Meili
 * cleanup (#584) because they never go through a dedupe merge - the exact gap in
 * #1364. When the shell's inferred PI already has a real, non-generated research
 * home, fold the shell into it immediately: merge the additive fields, archive the
 * shell with a canonicalGroupId tombstone, and remove it from the search index, so
 * no per-appointment orphan is ever left standing. The shell usually carries the
 * PI edge this same pass wrote, so the archive moves its edges to the canonical row
 * or archives them as redundant there (#4752).
 */
export async function foldDeptRosterShellIntoCanonicalResearchEntity(
  shellEntityId: string,
): Promise<{ folded: boolean; canonicalEntityId?: string; canonicalIndexSyncFailed?: true }> {
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

  const canonical = await deptRosterShellFoldTarget(personName);
  const canonicalId = normalizeMaterializerObjectId(canonical?._id);
  if (!canonicalId || canonicalId === String(shell._id)) return { folded: false };
  const joinedVerdictPairs = await mergeGroupJoinsDistinctPeople({
    canonicalEntityId: canonicalId,
    duplicateEntityIds: [String(shell._id)],
  });
  if (joinedVerdictPairs.length > 0) return { folded: false };

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
  await archiveResearchEntities({
    ids: [shell._id],
    archivedReason: DEPT_ROSTER_SHELL_FOLD_ARCHIVE_REASON,
    set: { canonicalGroupId: canonicalId, lastObservedAt: now },
    survivorId: canonicalId,
    now,
  });
  await carryResearchPlansToSurvivor({
    survivorId: canonicalId,
    duplicateIds: [String(shell._id)],
    apply: true,
    now,
  });
  await deleteFromIndex('researchEntity', String(shell._id));

  const foldedCanonical = await ResearchEntity.findById(canonicalId).lean();
  const canonicalIndexSynced =
    !!foldedCanonical && (await syncEntity('researchEntity', foldedCanonical));

  return {
    folded: true,
    canonicalEntityId: canonicalId,
    ...(canonicalIndexSynced ? {} : { canonicalIndexSyncFailed: true as const }),
  };
}

export async function syncProfileBackedFacultyResearchAreaMemberFromIdentity(
  researchEntityId: string,
  identity: {
    entityKey?: string;
    name?: unknown;
    entityType?: unknown;
    userId?: string;
    sourceName?: string;
    sourceUrl?: string;
    confidence?: number;
  },
  deps: ProfileBackedFacultyResearchAreaMemberDeps = {},
): Promise<{
  synced: boolean;
  created: boolean;
  researchEntityId?: string;
  userId?: string;
  skipped?:
    | 'not-faculty-research-area'
    | 'lead-edge-held'
    | 'user-not-resolved'
    | typeof REMOVED_BY_REQUEST;
}> {
  const observedEntityType = textValue(identity.entityType);
  const observedKey = textValue(identity.entityKey);
  const isFacultyResearchArea =
    observedEntityType === 'FACULTY_RESEARCH_AREA' || isFacultyResearchAreaKey(observedKey);
  if (!isFacultyResearchArea) {
    return { synced: false, created: false, skipped: 'not-faculty-research-area' };
  }

  const heldLead = await heldLeadPersonId(researchEntityId);
  if (heldLead !== undefined) {
    return {
      synced: false,
      created: false,
      researchEntityId,
      ...(heldLead ? { userId: heldLead } : {}),
      skipped: 'lead-edge-held',
    };
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

  const outcome = await materializeCanonicalMembership(
    researchEntityId,
    {
      legacyRole: 'pi',
      displayName,
      isCurrentMember: true,
      confidence,
      startedAt: observedAt,
      rosterProvenance: {
        sourceName: textValue(identity.sourceName) || undefined,
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

  if (outcome === REMOVED_BY_REQUEST) {
    return { synced: false, created: false, researchEntityId, skipped: REMOVED_BY_REQUEST };
  }
  return {
    synced: !outcome.startsWith('refused-'),
    created: outcome === 'created',
    researchEntityId,
    userId: researcherId,
  };
}

function latestObservationDate(observations: Array<{ observedAt?: Date }>): Date {
  const timestamps = observations
    .map((observation) => new Date(observation.observedAt || 0).getTime())
    .filter((time) => Number.isFinite(time));
  if (timestamps.length === 0) return new Date();
  return new Date(Math.max(...timestamps));
}

interface ResolvedRelationshipTargetRow {
  _id?: unknown;
  name?: unknown;
  slug?: unknown;
  entityType?: unknown;
}

export async function resolveRelationshipTarget(
  researchEntityModel: Pick<typeof ResearchEntity, 'findOne' | 'find' | 'findById'>,
  identity: RelationshipTargetIdentity,
): Promise<{
  canonicalFacultyResearchAreaTarget: { _id?: unknown } | null;
  target: ResolvedRelationshipTargetRow | null;
  resolvedTarget: ResolvedRelationshipTargetRow | null;
}> {
  const { targetEntityKey } = identity;
  const canonicalFacultyResearchAreaTarget =
    (await findExistingResearchEntityByFacultyResearchAreaIdentity(researchEntityModel as any, {
      entityKey: targetEntityKey,
      entityType: 'FACULTY_RESEARCH_AREA',
    })) as ResolvedRelationshipTargetRow | null;
  const target = ((await researchEntityModel
    .findOne(
      { slug: targetEntityKey, archived: { $ne: true } },
      { _id: 1, name: 1, slug: 1, entityType: 1 },
    )
    .lean()) ??
    (await liveResearchEntityNamedByKeyObservations(
      targetEntityKey,
      '_id name slug entityType',
    ))) as ResolvedRelationshipTargetRow | null;
  const namedTarget = canonicalFacultyResearchAreaTarget || target;
  return {
    canonicalFacultyResearchAreaTarget,
    target,
    resolvedTarget:
      namedTarget ||
      (isListedLabTargetKey(targetEntityKey)
        ? ((await rowServingListedLabWebsite(researchEntityModel, identity)) ??
          (await rowLedByListedLabLead(researchEntityModel, identity)))
        : await rowLedByListedPersonAtListedWebsite(researchEntityModel, identity)),
  };
}

const LISTED_LAB_NON_TARGET_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];

export async function rowServingListedLabWebsite(
  researchEntityModel: Pick<typeof ResearchEntity, 'find'>,
  identity: RelationshipTargetIdentity,
): Promise<ResolvedRelationshipTargetRow | null> {
  const websiteKey = normalizeWebsiteUrlIdentityKey(identity.targetWebsiteUrl);
  if (!websiteKey) return null;
  const rowsAtWebsite = (await researchEntityModel
    .find(
      {
        websiteUrl: { $in: websiteUrlIdentityKeyVariants(websiteKey) },
        entityType: { $nin: LISTED_LAB_NON_TARGET_ENTITY_TYPES },
        archived: { $ne: true },
      },
      { _id: 1, name: 1, slug: 1, entityType: 1 },
    )
    .limit(2)
    .lean()) as ResolvedRelationshipTargetRow[];
  return rowsAtWebsite.length === 1 ? rowsAtWebsite[0] : null;
}

/**
 * A listed lab whose site no row serves resolves through the head its own page names,
 * by the same name arm a listed person takes, so it reaches the row that person leads.
 */
export async function rowLedByListedLabLead(
  researchEntityModel: Pick<typeof ResearchEntity, 'findOne' | 'find' | 'findById'>,
  identity: RelationshipTargetIdentity,
): Promise<ResolvedRelationshipTargetRow | null> {
  const leadKey = facultyResearchAreaSlugForPersonName(textValue(identity.targetLeadName));
  if (!leadKey) return null;
  const { resolvedTarget } = await resolveRelationshipTarget(researchEntityModel, {
    targetEntityKey: leadKey,
  });
  return resolvedTarget;
}

export async function rowLedByListedPersonAtListedWebsite(
  researchEntityModel: Pick<typeof ResearchEntity, 'find'>,
  identity: RelationshipTargetIdentity,
): Promise<ResolvedRelationshipTargetRow | null> {
  const websiteKey = normalizeWebsiteUrlIdentityKey(identity.targetWebsiteUrl);
  const personName = personNameFromFacultyResearchArea(identity.targetEntityKey);
  if (!websiteKey || !personName) return null;
  const rowsAtWebsite = (await researchEntityModel
    .find(
      { websiteUrl: { $in: websiteUrlIdentityKeyVariants(websiteKey) }, archived: { $ne: true } },
      { _id: 1, name: 1, slug: 1, entityType: 1 },
    )
    .lean()) as ResolvedRelationshipTargetRow[];
  if (rowsAtWebsite.length === 0) return null;
  const researcherId = toMaterializerObjectId(await findUniqueResearcherIdByPersonName(personName));
  if (!researcherId) return null;
  const ledRowIds = new Set(
    (
      (await RoleAssignment.find({
        personId: researcherId,
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': { $in: rowsAtWebsite.map((row) => row._id) },
        role: 'PI',
        state: { $ne: 'HISTORICAL' },
        archived: { $ne: true },
      })
        .select('target.id')
        .lean()) as Array<{ target?: { id?: unknown } }>
    )
      .map((assignment) => normalizeMaterializerObjectId(assignment.target?.id))
      .filter(Boolean),
  );
  const ledRows = rowsAtWebsite.filter((row) =>
    ledRowIds.has(normalizeMaterializerObjectId(row._id) || ''),
  );
  return ledRows.length === 1 ? ledRows[0] : null;
}

/**
 * Where the code lane (`center-affiliation-roster`) lists an affiliation, its observations
 * alone decide the relationship, so the stored citation and target site come from the
 * repeatable read rather than from `center-affiliation-llm` (#5296).
 */
export function preferredRelationshipObservations<
  Row extends { sourceName?: unknown; field?: unknown },
>(observations: Row[]): Row[] {
  const codeLane = observations.filter(
    (obs) => textValue(obs.sourceName) === CENTER_AFFILIATION_ROSTER_SOURCE_NAME,
  );
  return codeLane.some((obs) => obs.field === 'targetEntityKey') ? codeLane : observations;
}

async function materializeResearchEntityRelationship(
  identifier: { entityId?: string; entityKey?: string },
  allObservations: any[],
  options: MaterializeOptions,
  deps: ResolvedRelationshipMaterializationDeps = {},
): Promise<MaterializeResult> {
  const observations = preferredRelationshipObservations(allObservations);
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

  const source = ((await researchEntityModel
    .findOne({ slug: sourceEntityKey, archived: { $ne: true } }, { _id: 1 })
    .lean()) ?? (await liveResearchEntityNamedByKeyObservations(sourceEntityKey))) as {
    _id?: unknown;
  } | null;
  if (!source?._id) return skip('source-not-resolved');

  const { canonicalFacultyResearchAreaTarget, target, resolvedTarget } =
    await resolveRelationshipTarget(researchEntityModel, {
      targetEntityKey,
      targetWebsiteUrl: textValue(resolved[RELATIONSHIP_TARGET_WEBSITE_URL_FIELD]?.value),
      targetLeadName: textValue(resolved[RELATIONSHIP_TARGET_LEAD_NAME_FIELD]?.value),
    });
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
        sourceName: textValue(resolved.targetEntityKey?.sourceName),
        sourceUrl,
        confidence: Math.max(0, ...observations.map((o) => Number(o.confidence) || 0)),
      },
    );
  }

  const sourceResearchEntityId = normalizeMaterializerObjectId(source._id) || '';
  const targetResearchEntityId = normalizeMaterializerObjectId(resolvedTarget._id) || '';
  if (!sourceResearchEntityId || !targetResearchEntityId) return skip('target-not-resolved');
  // Prefer linking the center to the member's existing PI-led lab (a rich page)
  // over a thin faculty-research-area stub: a resolved target that is not a
  // `FACULTY_RESEARCH_AREA` row is a real research home → AFFILIATED_LAB.
  const resolvedRelationshipType = centerRelationshipTypeForResolvedTarget(
    resolvedTarget,
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
 * Pick the relationship type for a center→target edge. The resolved row's own
 * `entityType` decides: a `FACULTY_RESEARCH_AREA` row stays MEMBER_RESEARCH_AREA and
 * any other kind of row is a real research home → AFFILIATED_LAB. Slug shape is only
 * the fallback for a row with no stored type, because a faculty research row promoted
 * to a lab keeps its generated `faculty-research-area-*` slug (#5068).
 */
export function centerRelationshipTypeForResolvedTarget(
  resolvedTarget: { slug?: unknown; entityType?: unknown } | null | undefined,
  fallbackType: string,
): string {
  const entityType = textValue(resolvedTarget?.entityType).toUpperCase();
  if (entityType) return entityType === 'FACULTY_RESEARCH_AREA' ? fallbackType : 'AFFILIATED_LAB';
  const slug = textValue(resolvedTarget?.slug);
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
      return isYaleHostname(parsed.hostname) && /\/(?:people|profile)\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}

/**
 * The pages the official-profile identity join may match: every `/people/` or `/profile/`
 * page, plus the page `composeOfficialProfileLink` would stamp as this person's
 * `YALE_OFFICIAL` link. A department that keeps person pages on another path
 * (`/faculty-directory/<slug>`) has that page stamped on the researcher it reaches, so
 * reading only the `/people/` shape back left the stamped page unable to identify the
 * same person on the next key that cites it.
 */
function officialProfileJoinUrlsFromObservations(
  observations: MaterializerObservationLike[],
): string[] {
  const stampedPages = observations
    .filter(
      (observation) =>
        observation.field === 'profileUrls' &&
        Boolean(observation.value) &&
        typeof observation.value === 'object',
    )
    .map((observation) =>
      selectOfficialYaleProfileUrl(observation.value as Record<string, unknown>),
    );
  return uniqueStrings([...officialUserProfileUrlsFromObservations(observations), ...stampedPages]);
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

function entityModelFor(entityType: ObservedEntityType): mongoose.Model<any, any, any, any> | null {
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
  Model: mongoose.Model<any, any, any, any>,
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
  Model: mongoose.Model<any, any, any, any>,
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
  Model: mongoose.Model<any, any, any, any>,
  obs: any[],
): Promise<any | null> {
  const applicationLink = observedRecordSpecificFundPage(obs);
  const fund = recordSpecificApplicationPortalIdentity(applicationLink);
  if (!fund) return null;

  const query = new URL(applicationLink).search.replace(/^\?/, '');
  const observingLane = observedOwningFellowshipLane(obs);
  const candidatesCitingFund = async (archived: boolean) =>
    (
      await Model.find({
        applicationLink: new RegExp(`^https?://[^/?#]+[^?#]*\\?${escapeRegex(query)}$`, 'i'),
        archived: archived ? true : { $ne: true },
        ...(observingLane ? { sourceName: { $ne: observingLane } } : {}),
      })
        .limit(2)
        .lean()
    ).filter(
      (candidate: any) =>
        recordSpecificApplicationPortalIdentity(String(candidate.applicationLink || '').trim()) ===
        fund,
    );
  const active = await candidatesCitingFund(false);
  if (active.length > 0) return active.length === 1 ? active[0] : null;
  // A fund retirement archives the row it resolved to, so a later read of the same fund,
  // retired or republished, must resolve to that row rather than mint a duplicate (#4174).
  const archived = await candidatesCitingFund(true);
  return archived.length === 1 ? archived[0] : null;
}

// An owning lane finds its own rows by sourceKey, title and page, so a row it already owns
// that shares this application link is a different program admitted through the same
// application, not this record (#3988). The enrich-only catalog owns no row in that sense.
function observedOwningFellowshipLane(obs: any[]): string | null {
  const sourceName = obs.find((o) => o.field === 'sourceName' && typeof o.value === 'string')
    ?.value as string | undefined;
  return sourceName && !ENRICH_ONLY_FELLOWSHIP_SOURCES.has(sourceName) ? sourceName : null;
}

async function fundFacetObservationsCitedBy(
  entityDoc: any,
  prefetch?: MaterializationReadSource,
): Promise<any[]> {
  const fundKey = fundKeyCitedByFellowship(entityDoc);
  if (!fundKey) return [];
  const routedFundEvidence = routedObservationsForKeysAndIds('fellowship', [fundKey], [], prefetch);
  const read =
    routedFundEvidence ??
    (await Observation.find({
      entityType: 'fellowship',
      ...materializationReadScopeFilter(),
      entityKey: fundKey,
      sourceName: YALE_FELLOWSHIP_DATABASE_SOURCE,
      field: { $in: [...FUND_AUTHORITY_FIELDS, 'title', FUND_RETIREMENT_FIELD] },
    }).lean());
  const { kept } = partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds());
  const retirement = newestFundRetirement(kept);
  if (!fundFacetsDescribeProgram(entityDoc?.title, newestFundTitle(kept))) return [];
  return kept.filter(
    (observation: any) =>
      observation === retirement ||
      (observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE &&
        FUND_AUTHORITY_FIELDS.has(String(observation.field))),
  );
}

async function evidenceOnlyFieldsStatedByFundsCitedBy(
  entityDoc: any,
  prefetch?: MaterializationReadSource,
): Promise<Set<string>> {
  const fundKeys = fundKeysCitedByFellowship(entityDoc);
  if (fundKeys.length === 0) return new Set();
  const read =
    routedObservationsForKeysAndIds('fellowship', fundKeys, [], prefetch) ??
    (await Observation.find({
      entityType: 'fellowship',
      ...materializationReadScopeFilter(),
      entityKey: { $in: fundKeys },
      sourceName: YALE_FELLOWSHIP_DATABASE_SOURCE,
      field: { $in: [...FELLOWSHIP_EVIDENCE_ONLY_FIELDS] },
    }).lean());
  const { kept } = partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds());
  return new Set(
    kept
      .filter(
        (observation: any) =>
          observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE &&
          FELLOWSHIP_EVIDENCE_ONLY_FIELDS.includes(String(observation.field)),
      )
      .map((observation: any) => String(observation.field)),
  );
}

async function findEntityDocByIdentifier(
  Model: mongoose.Model<any, any, any, any>,
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
export function hasRequiredFieldsForCreate(
  entityType: ObservedEntityType,
  insert: Record<string, unknown>,
): boolean {
  if (isResearchEntityObservationType(entityType)) {
    return !!insert.name;
  }
  if (entityType === 'fellowship') {
    return !!insert.title;
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

// A loser's PI attribution may name the survivor's lead only while the survivor states
// none of its own, because a merge leaves the roster that lists the person reading the
// loser's key, and a survivor with no lead of its own would otherwise be held on
// `missing_lead` by a lead the merge itself established. The person-mint gate asks
// `mergedSurvivorEvidence` itself, so both read one condition.
const MERGED_LOSER_PI_LEAD_FIELDS: ReadonlySet<string> = new Set([
  'inferredPiUserKey',
  'inferredPiUserId',
]);

const PI_LEAD_LOCK_FIELDS: ReadonlySet<string> = new Set([...MERGED_LOSER_PI_LEAD_FIELDS, 'lead']);

async function personNamedByPiAttribution(
  attribution: any,
  entityName: () => Promise<string>,
): Promise<string> {
  if (attribution.field === 'inferredPiUserId') {
    return normalizeMaterializerObjectId(textValue(attribution.value)) || `id:${attribution.value}`;
  }
  const resolution = await resolveInferredPiUserKey(attribution.value, entityName);
  return resolution.status === 'matched' && resolution.researcherId
    ? String(resolution.researcherId)
    : `key:${textValue(attribution.value)}`;
}

async function liveResearcherIdsAmong(personIds: readonly unknown[]): Promise<Set<string>> {
  const objectIds = personIds
    .map((personId) => toMaterializerObjectId(personId))
    .filter((personId): personId is mongoose.Types.ObjectId => Boolean(personId));
  if (objectIds.length === 0) return new Set();
  const live = (await Researcher.find({ _id: { $in: objectIds }, archived: { $ne: true } })
    .select('_id')
    .lean()) as Array<{ _id: unknown }>;
  return new Set(live.map((researcher) => String(researcher._id)));
}

// The losers must name one person, and that person must be the only lead the survivor
// already holds from any lane, so a merge never puts a second lead beside the first.
// An attribution that resolves to an archived researcher names nobody who can lead, so
// it neither counts as a second person nor reaches the survivor: a roster's retired
// mailbox-shaped key would otherwise veto the person the same roster names today.
async function loserLeadAttributionsTheSurvivorTakes(
  survivorId: mongoose.Types.ObjectId,
  survivorName: string,
  attributions: any[],
): Promise<any[]> {
  if (attributions.length === 0) return [];
  const named = [];
  for (const attribution of attributions) {
    named.push({
      attribution,
      person: await personNamedByPiAttribution(attribution, async () => survivorName),
    });
  }
  const resolvedPeople = named
    .map(({ person }) => person)
    .filter((person) => mongoose.isValidObjectId(person));
  const livePeople = await liveResearcherIdsAmong(resolvedPeople);
  const usable = named.filter(
    ({ person }) => !mongoose.isValidObjectId(person) || livePeople.has(person),
  );
  const people = new Set(usable.map(({ person }) => person));
  if (people.size !== 1) return [];
  const [person] = people;
  const heldLeads = await liveResearcherIdsAmong(
    (await RoleAssignment.distinct('personId', {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': survivorId,
      role: { $in: SCHOOL_INHERITANCE_LEAD_ROLES },
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    })) as unknown[],
  );
  return [...heldLeads].every((held) => held === person)
    ? usable.map(({ attribution }) => attribution)
    : [];
}

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
  survivorReadOnARoster: boolean;
  mergedInSourceUrlValues: string[];
  redirectRefusedObservations: number;
  fieldsBackedByRefusedListings: string[];
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

function yaleNetidsListedBy(observations: readonly any[]): string[] {
  const netids = new Set<string>();
  for (const observation of observations) {
    const value = textValue(observation.value).toLowerCase();
    if (observation.field === 'inferredPiUserKey') {
      const userKey = userEntityKeyForInferredPiUserKey(value);
      if (userKey.startsWith('netid:')) netids.add(userKey.slice('netid:'.length));
    } else if (observation.field === 'contactEmail' || observation.field === 'email') {
      const local = value.match(YALE_EMAIL_PATTERN)?.[1];
      if (local) netids.add(local);
    }
  }
  return [...netids];
}

function profileDestinationsListedBy(observations: readonly any[]): string[] {
  const pages = observations.flatMap((observation: any) => [
    observation.sourceUrl,
    ...(observation.field === 'sourceUrls'
      ? Array.isArray(observation.value)
        ? observation.value
        : [observation.value]
      : []),
  ]);
  return uniqueStrings(
    pages
      .map((page) => textValue(page))
      .filter((page) => isLikelyOfficialPersonProfileUrl(page))
      .map((page) => normalizeOfficialProfileDestination(page))
      .filter(Boolean),
  );
}

function verifiedPrimaryProfileDestinations(profileLinks: unknown): string[] {
  return (Array.isArray(profileLinks) ? profileLinks : [])
    .filter(
      (link: any) =>
        link?.kind === 'YALE_OFFICIAL' && link?.purpose === 'PRIMARY_IDENTITY' && link?.verifiedAt,
    )
    .map((link: any) => normalizeOfficialProfileDestination(textValue(link.url)))
    .filter(Boolean);
}

const ROW_LEAD_OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  'inferredPiUserId',
  'inferredPiUserKey',
]);

async function namedLeadWitnessesOfRow(
  survivor: { _id?: unknown; name?: unknown; entityType?: unknown; kind?: unknown },
  ownLeadObservations: MaterializerObservationLike[],
): Promise<MergedRedirectLead[]> {
  const survivorId = survivor._id;
  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': survivorId,
    role: { $in: SITE_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('personId rosterProvenance.sourceName')
    .lean()) as Array<{ personId?: unknown; rosterProvenance?: { sourceName?: string } }>;
  const edgeSourceNamesByPerson = new Map<string, Array<string | undefined>>();
  for (const edge of edges) {
    const personId = edge.personId ? String(edge.personId) : '';
    if (!personId) continue;
    edgeSourceNamesByPerson.set(personId, [
      ...(edgeSourceNamesByPerson.get(personId) ?? []),
      edge.rosterProvenance?.sourceName,
    ]);
  }
  if (edgeSourceNamesByPerson.size === 0) return [];
  const leads = (await Researcher.find({
    _id: { $in: [...edgeSourceNamesByPerson.keys()] },
    archived: { $ne: true },
  })
    .select('_id displayName identifiers.netid profileLinks')
    .lean()) as any[];
  const grantCoPiListed = grantCoPiListedPersonIds({
    leadFacts: await planInferredPiMembership(String(survivorId), ownLeadObservations),
    rowLeadPersonIds: edgeSourceNamesByPerson.keys(),
    edgeSourceNamesByPerson,
  });
  return leadsTheRowIsNamedAfter(
    survivor,
    leads.map((lead) => ({
      personId: String(lead._id),
      displayName: lead.displayName,
      netid: lead.identifiers?.netid,
      profileDestinations: verifiedPrimaryProfileDestinations(lead.profileLinks),
    })),
    grantCoPiListed,
  );
}

async function observationsFiledUnderSurvivor(
  entityType: ObservedEntityType,
  survivor: { _id?: unknown; slug?: unknown },
  prefetch?: MaterializationReadSource,
): Promise<any[]> {
  const survivorId = toMaterializerObjectId(survivor._id);
  const survivorSlug = textValue(survivor.slug);
  const keys = survivorSlug ? [survivorSlug] : [];
  const ids = survivorId ? [survivorId] : [];
  if (keys.length === 0 && ids.length === 0) return [];
  const read =
    routedObservationsForKeysAndIds(entityType, keys, ids, prefetch) ??
    (await Observation.find({
      entityType,
      ...materializationReadScopeFilter(),
      $or: [{ entityKey: { $in: keys } }, { entityId: { $in: ids } }],
    }).lean());
  return partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds()).kept;
}

export interface MergedRedirectRefusals {
  slugs: ReadonlySet<string>;
  refuses: (observation: any) => boolean;
  admissions: Partial<Record<MergedRedirectAdmission, number>>;
}

/**
 * The merged-away person listings a person survivor refuses (#5771). A refused listing's
 * observations stay filed under its own key, exactly as an unresolvable tombstone chain
 * leaves them, so nothing about the merge itself is rewritten.
 */
export async function mergedRedirectRefusedListings(
  survivor: { _id?: unknown; name?: unknown; entityType?: unknown; kind?: unknown },
  mergedInRows: readonly MergedInResearchEntityRow[],
  observations: readonly any[],
): Promise<MergedRedirectRefusals> {
  const admissions: Partial<Record<MergedRedirectAdmission, number>> = {};
  const none = { slugs: new Set<string>(), refuses: () => false, admissions };
  if (!isPersonRow(survivor) || mergedInRows.length === 0) return none;
  const listings = (await ResearchEntity.find({ _id: { $in: mergedInRows.map((row) => row._id) } })
    .select('_id slug name entityType kind')
    .lean()) as any[];
  const personListings = listings.filter((listing) => isPersonRow(listing));
  if (personListings.length === 0) return none;
  const listingIds = new Set(personListings.map((listing) => String(listing._id)));
  const listingSlugs = new Set(personListings.map((listing) => textValue(listing.slug)));
  const ownLeadObservations = observations.filter(
    (observation: any) =>
      ROW_LEAD_OBSERVATION_FIELDS.has(String(observation.field ?? '')) &&
      !listingSlugs.has(textValue(observation.entityKey)) &&
      !listingIds.has(normalizeMaterializerObjectId(observation.entityId) ?? ''),
  );
  const namedLeads = await namedLeadWitnessesOfRow(survivor, ownLeadObservations);
  const refusedSlugs = new Set<string>();
  const refusedIds = new Set<string>();
  for (const listing of personListings) {
    const slug = textValue(listing.slug);
    const id = String(listing._id);
    const filedUnderListing = observations.filter(
      (observation: any) =>
        (slug && textValue(observation.entityKey) === slug) ||
        normalizeMaterializerObjectId(observation.entityId) === id,
    );
    const admission = mergedRedirectAdmission(survivor, namedLeads, {
      slug,
      name: listing.name,
      entityType: listing.entityType,
      kind: listing.kind,
      netids: yaleNetidsListedBy(filedUnderListing),
      pageDestinations: profileDestinationsListedBy(filedUnderListing),
    });
    admissions[admission] = (admissions[admission] ?? 0) + 1;
    if (admission !== 'refused') continue;
    if (slug) refusedSlugs.add(slug);
    refusedIds.add(id);
  }
  if (refusedIds.size === 0) return none;
  return {
    slugs: refusedSlugs,
    admissions,
    refuses: (observation: any) =>
      refusedSlugs.has(textValue(observation.entityKey)) ||
      refusedIds.has(normalizeMaterializerObjectId(observation.entityId) ?? ''),
  };
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
  unscreenedLoadedObservations: any[],
  prefetch?: MaterializationReadSource,
): Promise<MergedSurvivorEvidence> {
  const survivorId = toMaterializerObjectId(survivor._id);
  const unmerged = {
    observations: unscreenedLoadedObservations,
    mergedInKeys: [],
    mergedInRows: [],
    evidenceObservations: unscreenedLoadedObservations,
    survivorLaneOwnsWebsite: false,
    droppedLoserWebsiteValues: [],
    loserRosterAppointments: [],
    survivorReadOnARoster: false,
    mergedInSourceUrlValues: [],
    redirectRefusedObservations: 0,
    fieldsBackedByRefusedListings: [],
  };
  if (!survivorId) return unmerged;
  if (prefetch?.hasNoMergedInRows(survivorId)) return unmerged;
  const mergedInRows = await listResearchEntityMergedInRows(survivorId);
  if (mergedInRows.length === 0) return unmerged;

  const survivorSlug = textValue(survivor.slug);
  const identity = mergedRowEvidenceIdentity({ _id: survivorId, slug: survivorSlug }, mergedInRows);

  const alreadyIncluded = new Set(
    unscreenedLoadedObservations.map((observation) => String(observation._id)),
  );
  const candidateKeys = [...identity.entityKeys];
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
      observationBelongsToMergedRow(identity, observation),
  );
  const { kept: unscreenedKept } = partitionObservationsByInvalidatedRun(
    added,
    await invalidatedScrapeRunIds(),
  );
  const refusedListings = await mergedRedirectRefusedListings(survivor, mergedInRows, [
    ...unscreenedLoadedObservations,
    ...unscreenedKept,
  ]);
  const loadedObservations = unscreenedLoadedObservations.filter(
    (observation) => !refusedListings.refuses(observation),
  );
  const kept = unscreenedKept.filter((observation: any) => !refusedListings.refuses(observation));
  const redirectRefusedObservations =
    unscreenedLoadedObservations.length +
    unscreenedKept.length -
    loadedObservations.length -
    kept.length;

  const loserOrigin = (observation: any) => mergedInMemberOf(identity, observation);
  const survivorIsLowTrustShell = isLowTrustAreaShellSlug(survivorSlug);
  // A locked type or a refused value means an operator, not the lane, decided who
  // this row is, so the lane has no claim on the website either.
  const survivorTypeIsLocked =
    Array.isArray(survivor.manuallyLockedFields) &&
    survivor.manuallyLockedFields.includes('entityType');
  const survivorLeadIsLocked =
    Array.isArray(survivor.manuallyLockedFields) &&
    survivor.manuallyLockedFields.some((field: unknown) => PI_LEAD_LOCK_FIELDS.has(String(field)));
  const survivorStatesItsOwnPiLead = [...loadedObservations, ...kept].some(
    (observation: any) =>
      !loserOrigin(observation) && MERGED_LOSER_PI_LEAD_FIELDS.has(String(observation.field || '')),
  );
  const loserLeadAttributions =
    survivorLeadIsLocked || survivorStatesItsOwnPiLead
      ? []
      : [...loadedObservations, ...kept].filter(
          (observation: any) =>
            loserOrigin(observation) &&
            MERGED_LOSER_PI_LEAD_FIELDS.has(String(observation.field || '')) &&
            !valueIsRefused(
              survivor.fieldValueRefusals,
              String(observation.field),
              observation.value,
            ),
        );
  const takenLoserLeadIds = new Set(
    (
      await loserLeadAttributionsTheSurvivorTakes(
        survivorId,
        textValue(survivor.name),
        loserLeadAttributions,
      )
    ).map((observation: any) => String(observation._id)),
  );
  const loserNamesLeadOfLeadlessSurvivor = (observation: any): boolean =>
    takenLoserLeadIds.has(String(observation._id));
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
  // A refused value is not evidence for the survivor, so it cannot hold a field against a
  // loser's admissible fill: the row would serve nothing while the loser's statement waited.
  const isRefusedForSurvivor = (observation: any): boolean =>
    valueIsRefused(survivor.fieldValueRefusals, String(observation.field || ''), observation.value);
  const survivorHeldFields = new Set(
    entryPointIndependentOrder
      .filter(
        (observation: any) =>
          !loserOrigin(observation) &&
          !holdsNoDepartment(observation) &&
          !isRefusedForSurvivor(observation) &&
          !sourceRanksOnlyAsFieldFallback(String(observation.field || ''), observation.sourceName),
      )
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
  const fieldsBackedByRefusedListings: string[] = [];
  for (const [field, value] of Object.entries(storedSurvivor)) {
    if (CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS.includes(field)) continue;
    const backingLoserSlug = backingLoserSlugByObservationId.get(provenanceObservationId(field));
    if (backingLoserSlug !== undefined && refusedListings.slugs.has(backingLoserSlug)) {
      if (!SURVIVOR_OWNED_RESEARCH_ENTITY_FIELDS.has(field))
        fieldsBackedByRefusedListings.push(field);
      continue;
    }
    if (backingLoserSlug !== undefined) {
      backingLoserSlugByField.set(field, backingLoserSlug);
      continue;
    }
    if (
      storedFieldHasValue(value, storedProvenance[field] !== undefined) &&
      !valueIsRefused(survivor.fieldValueRefusals, field, value) &&
      !sourceRanksOnlyAsFieldFallback(field, objectRecord(storedProvenance[field]).sourceName)
    ) {
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
  const survivorStoredType = textValue(storedSurvivor.entityType);
  const survivorObservesItsOwnType = entryPointIndependentOrder.some(
    (observation: any) => !loserOrigin(observation) && observation.field === 'entityType',
  );
  const loserCorroboratesUnbackedSurvivorType = (observation: any): boolean =>
    observation.field === 'entityType' &&
    !survivorTypeIsLocked &&
    !survivorObservesItsOwnType &&
    Boolean(survivorStoredType) &&
    textValue(observation.value) === survivorStoredType &&
    !valueIsRefused(survivor.fieldValueRefusals, 'entityType', observation.value);
  const droppedLoserWebsiteValues: unknown[] = [];
  const loserRosterAppointments: any[] = [];
  const observations = entryPointIndependentOrder.filter((observation: any) => {
    const loser = loserOrigin(observation);
    if (!loser) return true;
    const field = String(observation.field || '');
    if (isRosterAppointment(observation)) {
      loserRosterAppointments.push(observation);
      if (survivorReadOnARoster) return false;
    }
    if (loserCorroboratesUnbackedSurvivorType(observation)) return true;
    if (loserNamesLeadOfLeadlessSurvivor(observation)) return true;
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
  const mergedInSourceUrlValues = [
    ...new Set(
      entryPointIndependentOrder
        .filter(
          (observation: any) => loserOrigin(observation) && observation.field === 'sourceUrls',
        )
        .flatMap((observation: any) =>
          Array.isArray(observation.value) ? observation.value : [observation.value],
        )
        .map((value: unknown) => textValue(value).trim())
        .filter(Boolean),
    ),
  ];
  return {
    observations,
    mergedInSourceUrlValues,
    mergedInKeys: mergedInEntityKeysAndIds(identity),
    mergedInRows: mergedInRows.map((row) => ({ _id: row._id, slug: row.slug })),
    evidenceObservations: [...loadedObservations, ...kept],
    survivorLaneOwnsWebsite: survivorOwnsItsWebsite,
    droppedLoserWebsiteValues: droppedLoserWebsiteValues.filter(
      (value) => !survivorStatedWebsites.has(websiteIdentity(value)),
    ),
    loserRosterAppointments,
    survivorReadOnARoster,
    redirectRefusedObservations,
    fieldsBackedByRefusedListings,
  };
}

/**
 * The merged-in rows' cited pages that are a lead's own verified primary Yale profile.
 *
 * A merge left the person's other department profile on the archived row, because a
 * loser's `sourceUrls` never fills a survivor that holds its own (#3584), so the
 * survivor stopped citing a page about its own lead (#4695). Only the lead's verified
 * primary identity page qualifies, so no other row's claims attach: the survivor already
 * names that person as its lead, and the profile link was verified as theirs.
 */
export async function mergedInLeadProfileSourceUrls(
  survivorId: unknown,
  mergedInSourceUrlValues: readonly string[],
): Promise<string[]> {
  if (mergedInSourceUrlValues.length === 0) return [];
  const leadIds = (await RoleAssignment.distinct('personId', {
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': survivorId,
    role: { $in: SITE_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })) as unknown[];
  if (leadIds.length === 0) return [];
  const leads = (await Researcher.find({ _id: { $in: leadIds }, archived: { $ne: true } })
    .select('profileLinks')
    .lean()) as any[];
  return selectMergedInLeadProfileSourceUrls(mergedInSourceUrlValues, leads);
}

export function selectMergedInLeadProfileSourceUrls(
  mergedInSourceUrlValues: readonly string[],
  leads: ReadonlyArray<{ profileLinks?: unknown }>,
): string[] {
  const verifiedPrimaryDestinations = new Set(
    leads.flatMap((lead) => verifiedPrimaryProfileDestinations(lead.profileLinks)),
  );
  if (verifiedPrimaryDestinations.size === 0) return [];
  return mergedInSourceUrlValues.filter(
    (url) =>
      isLikelyOfficialPersonProfileUrl(url) &&
      verifiedPrimaryDestinations.has(normalizeOfficialProfileDestination(url)),
  );
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
          .select('_id slug name entityType kind fieldValueRefusals manuallyLockedFields')
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
 * The one person an address names, counting a researcher's own `identifiers.email` and every
 * live account that claims it as claimants of one identity space, so the join fails closed
 * exactly as it did when every address lived on an account (#5000). An account and the
 * researcher holding its netid are one claimant, and an account no researcher's netid matches
 * still counts, because it is still a second person holding the address. Accounts are
 * environment-local (#5088), so the link is the netid rather than a stored account `_id`.
 */
async function soleLiveResearcherClaimingEmail(email: string): Promise<any | undefined> {
  const accounts: any[] = (
    await Account.find({ email }).limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT).lean()
  ).filter(accountIsLive);
  const accountNetids = accounts.map((account) => normalizedAccountNetid(account.netid));
  const linkableNetids = accountNetids.filter((netid): netid is string => Boolean(netid));
  const linked: any[] = linkableNetids.length
    ? await Researcher.find({ 'identifiers.netid': { $in: linkableNetids } })
        .select('_id displayName identifiers.netid')
        .lean()
    : [];
  const holders: any[] = await Researcher.find({
    'identifiers.email': email,
    archived: { $ne: true },
  })
    .select('_id displayName identifiers.netid')
    .limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT)
    .lean();
  const claimants = new Map<string, any>();
  for (const researcher of [...linked, ...holders])
    claimants.set(String(researcher._id), researcher);
  const linkedNetids = new Set(linked.map((researcher) => researcher.identifiers?.netid));
  const unlinkedAccounts = accounts.filter(
    (_account, index) => !accountNetids[index] || !linkedNetids.has(accountNetids[index]),
  );
  if (claimants.size + unlinkedAccounts.length !== 1) return undefined;
  return claimants.values().next().value;
}

async function researcherTheObservedEmailNames(
  observedEmail: string,
  displayName: string,
): Promise<any | null> {
  const claimant = await soleLiveResearcherClaimingEmail(observedEmail);
  const emailResearcher = claimant?._id ? await Researcher.findById(claimant._id) : null;
  if (!emailResearcher) return null;
  return !displayName || observedPersonNameAgreesWith(emailResearcher.displayName, displayName)
    ? emailResearcher
    : null;
}

/**
 * The researcher a `user` key's netid reaches: the researcher holding it as
 * `identifiers.netid`. An alias the directory maps to another live holder's netid resolves to
 * that holder, as it did when every alias twin was an account (#4988), and either side may
 * hold the alias or its target (#5000). An alias the directory does not map is never an
 * identity netid, so a researcher stamped with it is not reached on it (#5740).
 */
async function researcherReachedByIdentityNetid(netid: string): Promise<any | null> {
  const target =
    (await aliasNetidWithLiveHolder(netid)) ?? (looksLikeYaleNetid(netid) ? netid : undefined);
  return target ? Researcher.findOne({ 'identifiers.netid': target }) : null;
}

async function aliasNetidWithLiveHolder(netid: string): Promise<string | undefined> {
  if (!isLikelyYaleEmailLocalPart(netid)) return undefined;
  const aliasAccountHeld = Boolean(await Account.exists({ netid }));
  const aliasResearcher: any = aliasAccountHeld
    ? null
    : await Researcher.findOne({ 'identifiers.netid': netid }).select('displayName').lean();
  if (!aliasAccountHeld && !aliasResearcher) return undefined;
  const resolution = await resolveNetidForRosterEmailAlias(netid);
  if (resolution.status !== 'resolved' || resolution.netid === netid) return undefined;
  const targetAccount: any = await Account.findOne({ netid: resolution.netid }).lean();
  const targetResearcher: any = await Researcher.findOne({
    'identifiers.netid': resolution.netid,
    archived: { $ne: true },
  })
    .select('displayName')
    .lean();
  if (aliasAccountHeld) {
    const liveTarget = accountIsLive(targetAccount ?? undefined) || Boolean(targetResearcher);
    return liveTarget ? resolution.netid : undefined;
  }
  // An alias only a researcher holds was never redirected while alias twins were accounts,
  // and the directory map can name another person, so the redirect needs agreeing names.
  return targetResearcher &&
    observedPersonNameAgreesWith(targetResearcher.displayName, aliasResearcher.displayName)
    ? resolution.netid
    : undefined;
}

/**
 * The live account a local-part netid resolves to through the directory's alias map, when
 * that is a different account from the one the netid names.
 *
 * An account whose netid is an email local part is the alias's twin of a real-netid account
 * (#4988). Looked up first, it holds every observation keyed `netid:<local part>`, and it is
 * still found once archived because the netid lookup does not filter archived accounts, so a
 * fold of the twin stranded those observations (#4924). The directory's map is its own
 * statement of whose address this is, so it outranks the twin, and only a live account can
 * win, which keeps an archived real account from re-opening the split.
 */
async function liveAccountTheAliasResolvesTo(netid: string): Promise<any | undefined> {
  if (!isLikelyYaleEmailLocalPart(netid)) return undefined;
  const resolution = await resolveNetidForRosterEmailAlias(netid);
  if (resolution.status !== 'resolved' || resolution.netid === netid) return undefined;
  const account = await Account.findOne({ netid: resolution.netid }).lean();
  return account && accountIsLive(account) ? account : undefined;
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
    .select('_id displayName profileLinks identifiers.netid identifiers.email identifiers.orcid')
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

async function mergedSurvivorTakesLoserLeadAttribution(
  loser: ResearchEntityTombstoneNode,
  entityType: ObservedEntityType,
  userEntityKey: string,
): Promise<boolean> {
  const canonical = await resolveResearchEntityCanonicalByTombstone(loser);
  if (!canonical) return false;
  const survivor = (await ResearchEntity.findOne({ _id: canonical._id, archived: { $ne: true } })
    .select('_id slug name entityType kind fieldValueRefusals manuallyLockedFields')
    .lean()) as Parameters<typeof mergedSurvivorEvidence>[1] | null;
  if (!survivor) return false;
  const { kept: ownObservations } = partitionObservationsByInvalidatedRun(
    await Observation.find({
      entityType,
      ...materializationReadScopeFilter(),
      $or: [
        { entityId: canonical._id },
        ...(textValue(survivor.slug)
          ? [{ entityKey: textValue(survivor.slug), entityId: null }]
          : []),
      ],
    }).lean(),
    await invalidatedScrapeRunIds(),
  );
  const { observations } = await mergedSurvivorEvidence(entityType, survivor, ownObservations);
  return observations.some(
    (observation: any) =>
      observation.field === 'inferredPiUserKey' &&
      userEntityKeyForInferredPiUserKey(observation.value) === userEntityKey,
  );
}

/**
 * A folded dept-roster shell is archived without superseding its observations
 * (`foldDeptRosterShellIntoCanonicalResearchEntity`), so a live `inferredPiUserKey` can
 * outlive the entity that asserted it. The lead materializer already requires a live
 * entity (`inferredPiLeadReclaim`), and minting a person on a dead entity's word would
 * create a record no entity can ever use. A merged-in loser's attribution is the
 * exception: its survivor resolves over it while stating no lead of its own
 * (`mergedSurvivorEvidence`), so the person it names is the lead that survivor uses.
 */
async function liveResearchEntityNamesUserKeyAsLead(userEntityKey: string): Promise<boolean> {
  const attributions = (
    (await Observation.find(
      {
        field: 'inferredPiUserKey',
        value: { $in: inferredPiUserKeyValuesThatCouldName(userEntityKey) },
        superseded: false,
      },
      { entityType: 1, entityKey: 1, entityId: 1, value: 1 },
    ).lean()) as Array<{
      entityType?: ObservedEntityType;
      entityKey?: unknown;
      entityId?: unknown;
      value?: unknown;
    }>
  ).filter((attribution) => userEntityKeyForInferredPiUserKey(attribution.value) === userEntityKey);
  const slugs = uniqueStrings(attributions.map((attribution) => attribution.entityKey));
  const entityIds = attributions
    .map((attribution) => normalizeMaterializerObjectId(attribution.entityId))
    .filter((entityId): entityId is string => Boolean(entityId));
  const namingEntity: Array<Record<string, unknown>> = [];
  if (slugs.length > 0) namingEntity.push({ slug: { $in: slugs } });
  if (entityIds.length > 0) namingEntity.push({ _id: { $in: entityIds } });
  if (namingEntity.length === 0) return false;
  const named = (await ResearchEntity.find({ $or: namingEntity })
    .select('_id slug archived canonicalGroupId')
    .lean()) as unknown as ResearchEntityTombstoneNode[];
  if (named.some((entity) => entity.archived !== true)) return true;
  for (const loser of named.filter((entity) => entity.canonicalGroupId)) {
    const attribution = attributions.find(
      (candidate) =>
        textValue(candidate.entityKey) === loser.slug ||
        normalizeMaterializerObjectId(candidate.entityId) === String(loser._id),
    );
    if (
      attribution?.entityType &&
      (await mergedSurvivorTakesLoserLeadAttribution(loser, attribution.entityType, userEntityKey))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A name match is a guess, and the person page the evidence cites is a per-person identifier,
 * so a candidate whose own official page on that site is a different person's page is
 * refused (#5324). Joining it renames the record after the observed person while it keeps
 * the other person's page, which is how a same-surname stranger came to be served as a lead.
 */
function officialPersonPagesContradictNameMatch(observations: any[], candidate: any): boolean {
  const storedOfficialUrls = (Array.isArray(candidate?.profileLinks) ? candidate.profileLinks : [])
    .filter((link: ResearcherProfileLink) => link?.kind === 'YALE_OFFICIAL')
    .map((link: ResearcherProfileLink) => String(link.url ?? ''));
  return personPagesNameDifferentPeople(
    officialUserProfileUrlsFromObservations(observations),
    storedOfficialUrls,
  );
}

async function identityPagesNameAnotherMiddleInitial(
  candidate: any,
  observedDisplayName: string,
): Promise<boolean> {
  if (!statesMiddleInitial(splitName(observedDisplayName).first)) return false;
  const officialPages = (Array.isArray(candidate?.profileLinks) ? candidate.profileLinks : [])
    .filter((link: ResearcherProfileLink) => link?.kind === 'YALE_OFFICIAL')
    .map((link: ResearcherProfileLink) => textValue(link.url))
    .filter(Boolean);
  const orcidPages = await personPagesStatingOrcid(
    Observation.collection,
    textValue(candidate?.identifiers?.orcid),
  );
  const statedNames = await namesStatedAtPersonPages(Observation.collection, [
    ...officialPages,
    ...orcidPages,
  ]);
  return anyNamesStateConflictingMiddleInitials(
    [candidate?.displayName, ...statedNames],
    [observedDisplayName],
  );
}

/**
 * A roster stores the lead it names as `netid:<alias>`, the bare alias or the Yale address
 * (#4697), and `userEntityKeyForInferredPiUserKey` reads all three as one `user` key. Matching
 * only the `netid:` spelling refused every lead whose roster stored one of the other two.
 */
function inferredPiUserKeyValuesThatCouldName(userEntityKey: string): Array<string | RegExp> {
  const payload = userEntityKey.match(/^netid:(.+)$/)?.[1];
  if (!payload || !BARE_ROSTER_ALIAS_PATTERN.test(payload)) return [userEntityKey];
  return [
    userEntityKey,
    new RegExp(`^(?:netid:)?${escapeRegex(payload)}(?:@(?:[a-z0-9-]+\\.)*yale\\.edu)?$`, 'i'),
  ];
}

type RosterAliasEmailMint =
  { status: 'mintable'; email: string } | { status: 'refused'; reason: string };

async function otherPersonPrintsAddress(
  email: string,
  userEntityKey: string,
  displayName: string,
): Promise<boolean> {
  const printers = (await Observation.find(
    {
      entityType: 'user',
      field: 'email',
      superseded: false,
      value: new RegExp(`^${escapeRegex(email)}$`, 'i'),
      entityKey: { $ne: userEntityKey },
    },
    { entityKey: 1 },
  ).lean()) as Array<{ entityKey?: unknown }>;
  const otherKeys = uniqueStrings(printers.map((printer) => printer.entityKey));
  if (otherKeys.length === 0) return false;
  const nameObservations = (await Observation.find(
    {
      entityType: 'user',
      entityKey: { $in: otherKeys },
      field: { $in: ['fname', 'lname', 'displayName'] },
      superseded: false,
    },
    { entityKey: 1, field: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: unknown; field?: string; value?: unknown }>;
  return otherKeys.some((key) => {
    const own = nameObservations.filter((observation) => textValue(observation.entityKey) === key);
    const valueOf = (field: string) =>
      textValue(own.find((observation) => observation.field === field)?.value);
    const name =
      valueOf('displayName') || [valueOf('fname'), valueOf('lname')].filter(Boolean).join(' ');
    return Boolean(name) && !observedPersonNameAgreesWith(name, displayName);
  });
}

/**
 * Owner decision 2026-10-19, narrowing #2776: an official roster or profile page that prints
 * a person's own `first.last@yale.edu` address is enough to create that person, keyed by the
 * address rather than a netid. Every condition is a reason the address could name someone
 * else, so each refuses with its own reason:
 *   - the key's own observed address must be exactly `<alias>@yale.edu`, so the key and the
 *     address are one identity rather than an alias that merely spells a name;
 *   - an office mailbox is printed for a whole unit (#5332);
 *   - the alias must spell the name the roster prints, read with the nickname-aware
 *     comparator the identity joins use;
 *   - a live researcher or account already holding the address, or a live researcher
 *     holding the official page, is someone the identity joins refused on the name, so the
 *     mint would be a second record for a person the corpus already disputes;
 *   - an address another `user` key prints under a disagreeing name is shared.
 * The alias is never stamped as a netid (`research-model.md`), and the address resolves the
 * key back to this record on the next pass through the email join.
 */
async function rosterAliasEmailMintIdentity(input: {
  userEntityKey: string;
  alias: string;
  displayName: string;
  observedEmail: string | undefined;
  observations: MaterializerObservationLike[];
}): Promise<RosterAliasEmailMint> {
  const refused = (reason: string): RosterAliasEmailMint => ({ status: 'refused', reason });
  const email = `${input.alias.toLowerCase()}@yale.edu`;
  if (!input.alias || input.observedEmail !== email) {
    return refused('alias-key-without-its-own-yale-address');
  }
  const unitTokens = yaleUnitMailboxTokens(
    input.observations.map((observation) => observation.sourceUrl),
  );
  if (isRoleOrUnitMailbox(email, unitTokens)) return refused('alias-email-names-office-mailbox');
  if (!observedPersonNameAgreesWith(personNameFromKeySlug(input.alias), input.displayName)) {
    return refused('alias-disagrees-with-roster-name');
  }
  const emailHolder =
    (await Researcher.exists({ 'identifiers.email': email, archived: { $ne: true } })) ||
    (await Account.find({ email }).limit(ACCOUNT_EMAIL_JOIN_CANDIDATE_LIMIT).lean()).some(
      accountIsLive,
    );
  if (emailHolder) return refused('alias-email-claimed-by-another-researcher');
  const pageHolders = await liveResearchersClaimingOfficialProfileUrls(
    officialProfileJoinUrlsFromObservations(input.observations),
  );
  if (pageHolders.size > 0) return refused('official-profile-claimed-by-another-researcher');
  if (await otherPersonPrintsAddress(email, input.userEntityKey, input.displayName)) {
    return refused('alias-email-printed-for-another-person');
  }
  return { status: 'mintable', email };
}

export interface UserIdentityJoinResult {
  resolved: ReturnType<typeof resolveAllFields>;
  netid: string | undefined;
  displayName: string;
  title: string | undefined;
  primaryDepartment: string | undefined;
  imageUrl: string | undefined;
  websiteUrl: string | undefined;
  websiteUrlConfidence: number | undefined;
  orcid: string | undefined;
  profileUrls: Record<string, unknown> | undefined;
  account: any;
  researcher: any;
  identityJoin: UserIdentityJoin | undefined;
  personNameHeldByNobody: boolean;
  identityJoinedOnEmailAlone: boolean;
  identityJoinedOnOfficialProfileUrlAlone: boolean;
}

function laneReadOf(observation: any): string {
  const runId = textValue(observation.scrapeRunId ? String(observation.scrapeRunId) : '');
  if (runId) return `run:${runId}`;
  return `at:${new Date(observation.observedAt as any).getTime() || 0}`;
}

const DIRECTORY_TITLE_SOURCES: ReadonlySet<string> = new Set([
  'yale-directory',
  'yale-directory-csv',
]);

function newestLaneReadOfUserTitles<T extends { field?: unknown; sourceName?: unknown }>(
  observations: readonly T[],
): T[] {
  const newestByLane = new Map<string, any>();
  for (const observation of observations as any[]) {
    if (observation.field !== 'title') continue;
    const lane = textValue(observation.sourceName);
    const incumbent = newestByLane.get(lane);
    const at = new Date(observation.observedAt as any).getTime() || 0;
    const incumbentAt = incumbent ? new Date(incumbent.observedAt as any).getTime() || 0 : -1;
    if (at > incumbentAt) newestByLane.set(lane, observation);
  }
  return observations.filter((observation: any) => {
    if (observation.field !== 'title') return true;
    const newest = newestByLane.get(textValue(observation.sourceName));
    return laneReadOf(observation) === laneReadOf(newest);
  });
}

/**
 * The lanes whose `user` title is read from the person's own official profile page's title
 * block, each verified against its extractor (#5578), mapped to the extraction marker a read
 * must carry, if any. Every other title lane copies that page, reads another page, or cannot
 * say which element it read: the A-Z index reads a lab page's contact widget, and the
 * backfill takes the first title-classed element on the page. The roster reads either its
 * listing or the profile, so only a read marked as taken from the profile's title block
 * counts; an unmarked roster read, including every one stored before the marker, does not.
 */
export const FIRST_HAND_USER_TITLE_SOURCES: ReadonlyMap<
  string,
  ObservationExtractionSource | undefined
> = new Map([
  ['ysm-faculty-directory', undefined],
  ['yse-faculty-directory', undefined],
  ['dept-faculty-roster', 'profileTitleBlock'],
]);

export function isFirstHandUserTitleRead(observation: {
  sourceName?: unknown;
  extraction?: { source?: unknown } | null;
}): boolean {
  const lane = textValue(observation.sourceName);
  if (!FIRST_HAND_USER_TITLE_SOURCES.has(lane)) return false;
  const requiredMarker = FIRST_HAND_USER_TITLE_SOURCES.get(lane);
  return !requiredMarker || observation.extraction?.source === requiredMarker;
}

const CURATED_USER_TITLE_SOURCES: ReadonlySet<string> = new Set([
  'manual-admin-edit',
  'manual-pi-edit',
]);

/**
 * Where a first-hand read may grant authority: the researcher's own official pages, read by
 * each lane's latest full-coverage run. A read from an earlier run is a page the lane has
 * not re-read since, so it can be stale (#5578).
 */
export interface FirstHandTitleScope {
  officialPageKeys: ReadonlySet<string>;
  latestFullRunIdByLane: ReadonlyMap<string, string>;
}

function isFirstHandUserTitle(observation: any, scope: FirstHandTitleScope): boolean {
  const lane = textValue(observation.sourceName);
  return (
    observation.field === 'title' &&
    isFirstHandUserTitleRead(observation) &&
    scope.officialPageKeys.has(officialProfileIdentityUrlKey(observation.sourceUrl)) &&
    Boolean(observation.scrapeRunId) &&
    String(observation.scrapeRunId) === scope.latestFullRunIdByLane.get(lane)
  );
}

function observedAtMs(observation: any): number {
  return new Date(observation.observedAt as any).getTime() || 0;
}

/**
 * The newest first-hand read. A read stating more than one value has no stored emit order
 * (a re-read value keeps its first `_id`), so the earliest `_id` breaks the tie: an
 * arbitrary but stable choice, which the first-hand extractors avoid needing by emitting
 * only the leading title.
 */
function newestFirstHandUserTitle<T>(
  observations: readonly T[],
  scope: FirstHandTitleScope,
): T | undefined {
  let newest: any;
  for (const observation of observations as any[]) {
    if (!isFirstHandUserTitle(observation, scope)) continue;
    if (!newest) {
      newest = observation;
      continue;
    }
    const at = observedAtMs(observation);
    const newestAt = observedAtMs(newest);
    if (at > newestAt) newest = observation;
    else if (at === newestAt && String(observation._id ?? '') < String(newest._id ?? '')) {
      newest = observation;
    }
  }
  return newest;
}

function newestLaneReadUserTitleEvidence<T extends { field?: unknown; sourceName?: unknown }>(
  observations: readonly T[],
): T[] {
  const newest = newestLaneReadOfUserTitles(observations);
  const isDirectoryTitle = (observation: any) =>
    observation.field === 'title' && DIRECTORY_TITLE_SOURCES.has(textValue(observation.sourceName));
  const statedElsewhere = newest.some(
    (observation: any) => observation.field === 'title' && !isDirectoryTitle(observation),
  );
  return statedElsewhere ? newest.filter((observation) => !isDirectoryTitle(observation)) : newest;
}

/**
 * The title evidence a person's title is resolved from, owned here for both the single-key
 * and the pooled path (#5578). Callers screen hygiene first, so a refused read is already
 * gone and the next newest first-hand read stands in for it.
 *
 * Source authority decides first. Given the researcher's official profile pages, the
 * newest fresh first-hand read of one of them (`FIRST_HAND_USER_TITLE_SOURCES`, read by
 * the lane's latest full-coverage run) is the title outright: older first-hand reads and
 * every copying lane are dropped. An operator's or PI's own edit stays beside it and keeps
 * the precedence the resolver gives it.
 *
 * With no first-hand read, or no researcher to read pages from, each lane is read as of
 * its newest read. A `user` title observation is value-keyed, so a lane's old value stays
 * live beside its new one; reading the newest read only, over every key the caller pools,
 * counts a lane that read the person under two keys once. Every title of that read is
 * kept, because one roster run can state several titles for one person. The directory's
 * title lags the person's own page, so it serves only when no other source states one.
 * Derived on every read; nothing is superseded.
 */
export function userTitleEvidence<T extends { field?: unknown; sourceName?: unknown }>(
  observations: readonly T[],
  firstHandScope?: FirstHandTitleScope,
): T[] {
  const firstHand = firstHandScope
    ? newestFirstHandUserTitle(observations, firstHandScope)
    : undefined;
  if (!firstHand) return newestLaneReadUserTitleEvidence(observations);
  return observations.filter(
    (observation: any) =>
      observation.field !== 'title' ||
      observation === firstHand ||
      CURATED_USER_TITLE_SOURCES.has(textValue(observation.sourceName)),
  );
}

async function latestFullRunIdByFirstHandLane(
  cache?: UserIdentityJoinCache,
): Promise<ReadonlyMap<string, string>> {
  const cached = cache?.latestFullRunIdByLane();
  if (cached) return cached;
  const byLane = await latestFullCoverageRunIdByLane([...FIRST_HAND_USER_TITLE_SOURCES.keys()]);
  cache?.rememberLatestFullRunIdByLane(byLane);
  return byLane;
}

/**
 * The researcher's official pages no other live researcher also claims. A page two live
 * researchers carry cannot say whose title it states, so it confers no authority, failing
 * closed the way the official-page join does with several claimants (#5578). Remembered
 * per researcher for the chunk; an identity write clears it with the rest of the joins.
 */
async function soleClaimedOfficialPageKeys(
  researcher: any,
  cache?: UserIdentityJoinCache,
): Promise<ReadonlySet<string>> {
  const researcherId = prefetchObjectIdString(researcher?._id);
  const cached = researcherId ? cache?.soleClaimedPagesFor(researcherId) : undefined;
  if (cached) return cached;
  const officialUrls = (Array.isArray(researcher?.profileLinks) ? researcher.profileLinks : [])
    .filter((link: ResearcherProfileLink) => link?.kind === 'YALE_OFFICIAL')
    .map((link: ResearcherProfileLink) => textValue(link.url))
    .filter(Boolean);
  const claimantsByKey = await liveResearchersClaimingOfficialProfileUrls(officialUrls);
  const keys: ReadonlySet<string> = new Set(
    researcherOfficialProfileIdentityKeys(researcher).filter(
      (key) => key && (claimantsByKey.get(key)?.length ?? 0) <= 1,
    ),
  );
  if (researcherId) cache?.rememberSoleClaimedPages(researcherId, keys);
  return keys;
}

/**
 * The read-only half of `materializeUserIdentityToResearcher`: which existing researcher a
 * person's `user` observations reach, and by which join. The inferred-PI lead resolver
 * calls it too, so a PI key that names a `user` key reaches the same researcher the user
 * materializer enriches rather than a narrower netid-then-name lookup (#4697).
 */
function deriveUserIdentityFields(materializationObs: any[], now: Date) {
  const resolverObs: ResolverObservation[] = userTitleEvidence(materializationObs)
    .filter((o: any) => o.field !== 'orcid' || isPlausiblePersonOrcid(o.value))
    .map((o: any) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
    }));
  const resolved = resolveAllFields(resolverObs, { now });
  const resolvedValue = (field: string): unknown => resolved[field]?.value;
  const servedUserName = (field: string): string => {
    const value = textValue(resolvedValue(field));
    return value && servedUserNameField(field, value);
  };
  // Normalized before the name resolver reads it, not just before it is stored: an
  // invisible format character inside a surname makes the person match nobody (#2874).
  const displayName = stripInvisibleFormatCharacters(
    servedUserName('displayName') ||
      [servedUserName('fname'), servedUserName('lname')].filter(Boolean).join(' ').trim(),
  );
  const title = stripTitleFieldLabel(textValue(resolvedValue('title'))) || undefined;
  const primaryDepartment = textValue(resolvedValue('primaryDepartment')) || undefined;
  const imageUrl = textValue(resolvedValue('imageUrl')) || undefined;
  const websiteCandidate = preferredPersonWebsiteCandidate([
    ...resolveFieldRanked('websiteUrl', resolverObs, { now }),
    ...resolveFieldRanked('website', resolverObs, { now }),
  ]);
  const websiteUrl = textValue(websiteCandidate?.value) || undefined;
  const websiteUrlConfidence = websiteCandidate?.confidence;
  const orcid = plausiblePersonOrcid(resolvedValue('orcid')) || undefined;
  const profileUrls =
    resolvedValue('profileUrls') && typeof resolvedValue('profileUrls') === 'object'
      ? (resolvedValue('profileUrls') as Record<string, unknown>)
      : undefined;
  return {
    resolved,
    displayName,
    title,
    primaryDepartment,
    imageUrl,
    websiteUrl,
    websiteUrlConfidence,
    orcid,
    profileUrls,
  };
}

export async function joinUserIdentityToExistingResearcher(
  identifier: { entityId?: string; entityKey?: string },
  obs: any[],
  now: Date = new Date(),
): Promise<UserIdentityJoinResult> {
  const keyNamesAnOfficeMailbox = userKeyNamesRoleOrUnitMailbox(identifier.entityKey, obs);
  const materializationObs = keyNamesAnOfficeMailbox
    ? []
    : withoutDepartmentHeadingObservations(
        withDirectoryExportDepartmentsDecoded(
          withoutCoreFacilityPersonWebsiteObservations(
            withoutOverSharedPersonWebsiteObservations(
              withoutOverSharedPersonImageObservations(
                obs.filter((o: any) => !shouldIgnoreObservationForEntityMaterialization('user', o)),
                await overSharedPersonImageKeysForMaterialization(),
              ),
              await overSharedPersonWebsiteKeysForMaterialization(),
            ),
            await coreFacilityWebsiteKeysForMaterialization(),
          ),
          await catalogDepartment(),
        ),
      );
  const derived = deriveUserIdentityFields(materializationObs, now);
  const { resolved, displayName } = derived;
  const resolvedValue = (field: string): unknown => resolved[field]?.value;

  const netid = keyNamesAnOfficeMailbox
    ? undefined
    : (normalizedAccountNetid(uniqueKeyValueForIdentifier('user', identifier.entityKey, obs)) ??
      normalizedAccountNetid(resolvedValue('netid')));
  const observedEmail = normalizedAccountEmail(resolvedValue('email'));

  let account: any = netid ? await Account.findOne({ netid }).lean() : null;
  if (account && netid) account = (await liveAccountTheAliasResolvesTo(netid)) ?? account;
  const accountNetid = normalizedAccountNetid(account?.netid);

  let researcher: any = netid ? await researcherReachedByIdentityNetid(netid) : null;
  let identityJoin: UserIdentityJoin | undefined = researcher ? 'account-netid' : undefined;
  const keyEmails = materializationObs
    .filter((o: any) => o.field === 'email')
    .map((o: any) => o.value);
  const directoryGivesKeyEmailsToAnotherNetid = async (candidate: any): Promise<boolean> =>
    directoryPairsAddressesWithAnotherNetid(
      keyEmails,
      candidate,
      await loadDirectoryNetidsByAddress(),
    );
  let personNameHeldByNobody = false;
  if (!researcher && displayName) {
    const resolution = await resolveResearcherIdForPersonName(displayName, {
      netid: accountNetid ?? netid,
      identity: { emails: keyEmails, orcid: derived.orcid },
    });
    personNameHeldByNobody =
      resolution.status === 'absent' ||
      (resolution.status === 'ambiguous' && resolution.everyCandidateNamesSomeoneElse === true);
    if (resolution.status === 'matched' && resolution.researcherId) {
      const nameMatch = await Researcher.findById(resolution.researcherId);
      if (
        nameMatch &&
        !officialPersonPagesContradictNameMatch(materializationObs, nameMatch) &&
        !(await identityPagesNameAnotherMiddleInitial(nameMatch, displayName)) &&
        !embeddedNetidContradictsCandidate(
          netidsEmbeddedInUserEvidence(identifier.entityKey, materializationObs),
          nameMatch.identifiers?.netid,
        ) &&
        !(await directoryGivesKeyEmailsToAnotherNetid(nameMatch))
      ) {
        researcher = nameMatch;
        identityJoin = 'person-name';
      }
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
    const candidate = await researcherTheObservedEmailNames(observedEmail, displayName);
    const emailResearcher =
      candidate && !researcherRefusesValue(candidate.fieldValueRefusals, 'email', observedEmail)
        ? candidate
        : null;
    if (emailResearcher) {
      researcher = emailResearcher;
      const emailResearcherNetid = normalizedAccountNetid(emailResearcher.identifiers?.netid);
      account = emailResearcherNetid
        ? ((await Account.findOne({ netid: emailResearcherNetid }).lean()) ?? null)
        : null;
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
      officialProfileJoinUrlsFromObservations(materializationObs),
    );
    if (urlResearcher && observedPersonNameAgreesWith(urlResearcher.displayName, displayName)) {
      const pageMatch = await Researcher.findById(urlResearcher._id);
      if (
        pageMatch &&
        !(await identityPagesNameAnotherMiddleInitial(pageMatch, displayName)) &&
        !(await directoryGivesKeyEmailsToAnotherNetid(pageMatch))
      ) {
        researcher = pageMatch;
        identityJoinedOnOfficialProfileUrlAlone = true;
        identityJoin = 'official-profile-page';
      }
    }
  }
  const refusals = researcher?.fieldValueRefusals;
  const served = researcherHasLiveRefusals(refusals)
    ? deriveUserIdentityFields(
        withoutResearcherRefusedObservations(materializationObs, refusals),
        now,
      )
    : derived;
  return {
    ...served,
    resolved: served.resolved,
    netid,
    displayName,
    account,
    researcher,
    identityJoin,
    personNameHeldByNobody,
    identityJoinedOnEmailAlone,
    identityJoinedOnOfficialProfileUrlAlone,
  };
}

const USER_KEY_HINT = { entityType: 1, entityKey: 1, field: 1, observedAt: -1 } as const;
const USER_ID_HINT = { entityType: 1, entityId: 1, field: 1, observedAt: -1 } as const;

function userKeyReferenceOf(observation: {
  entityKey?: unknown;
  entityId?: unknown;
}): UserKeyReference | undefined {
  const entityKey = textValue(observation.entityKey);
  if (entityKey) return { entityKey };
  const entityId = prefetchObjectIdString(observation.entityId);
  return entityId ? { entityId } : undefined;
}

function sameUserKeyReference(a: UserKeyReference, b: UserKeyReference): boolean {
  return userKeyReferenceId(a) === userKeyReferenceId(b);
}

/**
 * Every person key the researcher's own identity can find: its netid in either key form,
 * its address on a live `email` observation, and its official profile pages as a cited
 * `sourceUrl`. Read from the researcher alone, so every key of one person sees one set.
 */
async function userKeysNamingResearcherIdentity(
  researcher: any,
  readScope: Record<string, unknown> = materializationReadScopeFilter(),
): Promise<UserKeyReference[]> {
  const netid = normalizedAccountNetid(researcher.identifiers?.netid);
  const account: any = netid ? await Account.findOne({ netid }).select('email').lean() : null;
  const emails = uniqueStrings(
    [researcher.identifiers?.email, account?.email]
      .map((email) => normalizedAccountEmail(email))
      .filter((email): email is string => Boolean(email)),
  );
  const officialPages = uniqueStrings(
    (researcher.profileLinks || [])
      .filter((link: ResearcherProfileLink) => link.kind === 'YALE_OFFICIAL')
      .flatMap((link: ResearcherProfileLink) => {
        const url = textValue(link.url);
        return url ? officialProfileUrlSpellings(url) : [];
      }),
  );
  const clauses: Record<string, unknown>[] = [{ entityId: researcher._id }];
  if (netid) clauses.push({ entityKey: { $in: [netid, `netid:${netid}`] } });
  if (emails.length > 0) clauses.push({ field: 'email', value: { $in: emails } });
  if (officialPages.length > 0) clauses.push({ sourceUrl: { $in: officialPages } });
  const found = (await Observation.find(
    { entityType: 'user', ...readScope, $or: clauses },
    { entityKey: 1, entityId: 1 },
  ).lean()) as Array<{ entityKey?: unknown; entityId?: unknown }>;
  const references = new Map<string, UserKeyReference>();
  for (const observation of found) {
    const reference = userKeyReferenceOf(observation);
    if (reference) references.set(userKeyReferenceId(reference), reference);
  }
  return [...references.values()];
}

const NOT_ROLLED_BACK = { 'rollback.rolledBackAt': { $exists: false } };

interface StoredDepartmentReading {
  field?: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string;
}

/**
 * Every `primaryDepartment` reading, live or superseded but not rolled back, on any key that
 * names the researcher plus the key being resolved. Keys are found over superseded readings
 * too, so a key whose every reading was retired still counts for what it once stated.
 */
async function storedDepartmentReadingsOverEveryKey(
  researcher: any,
  ownKey: UserKeyReference | undefined,
): Promise<{ references: UserKeyReference[]; readings: StoredDepartmentReading[] }> {
  const references = await userKeysNamingResearcherIdentity(researcher, NOT_ROLLED_BACK);
  if (ownKey) references.push(ownKey);
  const entityKeys = uniqueStrings(references.map((reference) => textValue(reference.entityKey)));
  const entityIds = references
    .map((reference) => toMaterializerObjectId(reference.entityId))
    .filter(Boolean);
  const identity: Record<string, unknown>[] = [];
  if (entityKeys.length > 0) identity.push({ entityKey: { $in: entityKeys } });
  if (entityIds.length > 0) identity.push({ entityId: { $in: entityIds } });
  if (identity.length === 0) return { references, readings: [] };
  const readings = (await Observation.find(
    { entityType: 'user', field: 'primaryDepartment', ...NOT_ROLLED_BACK, $or: identity },
    { field: 1, value: 1, sourceName: 1, sourceUrl: 1 },
  ).lean()) as StoredDepartmentReading[];
  return { references, readings };
}

const ENGINE_JOINED_BACKING_KEY_CAP = 25;

const personNameTokens = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((token) => token.length > 1)
    : [];

/**
 * The readings of keys outside the researcher's identity keys that state the stored value and
 * that the engine's own join (`userIdentityJoinForKey`) reaches the researcher from, which is
 * how a person-name-joined roster key backs a department (#6049). Read only when the identity
 * keys did not settle the answer. Candidates come from the batch's value-to-keys map and are
 * narrowed to keys whose own `lname` reading shares a name token with the researcher, because
 * a name join needs the names to agree; the engine join alone decides which of them join. More
 * than the cap of narrowed candidates is `undetermined`, which every caller reads
 * conservatively.
 */
async function storedDepartmentReadingsOfEngineJoinedKeys(
  researcher: any,
  stored: string,
  canonicalDepartment: CanonicalDepartment,
  known: readonly UserKeyReference[],
): Promise<StoredDepartmentReading[] | 'undetermined'> {
  const statingKeys = await primaryDepartmentStatingKeysForMaterialization();
  const knownKeys = new Set(known.map((reference) => textValue(reference.entityKey)));
  const candidates = uniqueStrings(
    [...statingKeys]
      .filter(([value]) => storedDepartmentIsBacked(stored, [{ value }], canonicalDepartment))
      .flatMap(([, keys]) => [...keys]),
  ).filter((key) => !knownKeys.has(key));
  if (candidates.length === 0) return [];
  const researcherTokens = new Set(personNameTokens(researcher.displayName));
  if (researcherTokens.size === 0) return [];
  const lastNames = (await Observation.find(
    { entityType: 'user', entityKey: { $in: candidates }, field: 'lname', ...NOT_ROLLED_BACK },
    { entityKey: 1, value: 1 },
  )
    .hint(USER_KEY_HINT)
    .lean()) as Array<{ entityKey?: unknown; value?: unknown }>;
  const named = uniqueStrings(
    lastNames
      .filter((reading) =>
        personNameTokens(reading.value).some((token) => researcherTokens.has(token)),
      )
      .map((reading) => textValue(reading.entityKey)),
  );
  if (named.length > ENGINE_JOINED_BACKING_KEY_CAP) return 'undetermined';
  const researcherId = String(researcher._id);
  const joinedKeys: string[] = [];
  for (const key of named) {
    const join = await userIdentityJoinForKey(key);
    if (String(join?.join?.researcher?._id ?? '') === researcherId) joinedKeys.push(key);
  }
  if (joinedKeys.length === 0) return [];
  return (await Observation.find(
    {
      entityType: 'user',
      entityKey: { $in: joinedKeys },
      field: 'primaryDepartment',
      ...NOT_ROLLED_BACK,
    },
    { field: 1, value: 1, sourceName: 1, sourceUrl: 1 },
  )
    .hint(USER_KEY_HINT)
    .lean()) as StoredDepartmentReading[];
}

/**
 * Whether some `primaryDepartment` observation, live or superseded, on any key that names the
 * researcher states its stored department (#6049), counting a key the engine joins by name too
 * (#5741). An unavailable catalog reads as backed, so a spelling the decode cannot check is
 * never cleared.
 */
async function storedDepartmentBackedByAnyReading(
  researcher: any,
  ownKey: UserKeyReference | undefined,
): Promise<boolean> {
  const stored = textValue(researcher.profile?.primaryDepartment);
  if (!stored) return true;
  const canonicalDepartment = await catalogDepartment();
  if (!canonicalDepartment) return true;
  const { references, readings } = await storedDepartmentReadingsOverEveryKey(researcher, ownKey);
  if (storedDepartmentIsBacked(stored, readings, canonicalDepartment)) return true;
  const joined = await storedDepartmentReadingsOfEngineJoinedKeys(
    researcher,
    stored,
    canonicalDepartment,
    references,
  );
  return joined === 'undetermined' || storedDepartmentIsBacked(stored, joined, canonicalDepartment);
}

async function liveObservationsOfUserKeys(
  references: readonly UserKeyReference[],
  prefetch?: MaterializationReadSource,
): Promise<Map<string, any[]>> {
  const byReference = new Map<string, any[]>();
  const unreadKeys: string[] = [];
  const unreadIds: string[] = [];
  for (const reference of references) {
    const routed = reference.entityKey
      ? prefetch?.observationsForKey('user', reference.entityKey)
      : prefetch?.observationsForId('user', reference.entityId);
    if (routed?.hit) byReference.set(userKeyReferenceId(reference), routed.value as any[]);
    else if (reference.entityKey) unreadKeys.push(reference.entityKey);
    else if (reference.entityId) unreadIds.push(reference.entityId);
  }
  const [byKey, byId] = await Promise.all([
    unreadKeys.length > 0
      ? Observation.find({
          entityType: 'user',
          ...materializationReadScopeFilter(),
          entityKey: { $in: unreadKeys },
        })
          .hint(USER_KEY_HINT)
          .lean()
      : Promise.resolve([]),
    unreadIds.length > 0
      ? Observation.find({
          entityType: 'user',
          ...materializationReadScopeFilter(),
          entityId: { $in: unreadIds.map((id) => new mongoose.Types.ObjectId(id)) },
        })
          .hint(USER_ID_HINT)
          .lean()
      : Promise.resolve([]),
  ]);
  for (const key of unreadKeys) byReference.set(userKeyReferenceId({ entityKey: key }), []);
  for (const id of unreadIds) byReference.set(userKeyReferenceId({ entityId: id }), []);
  for (const observation of byKey as any[]) {
    byReference
      .get(userKeyReferenceId({ entityKey: textValue(observation.entityKey) }))
      ?.push(observation);
  }
  for (const observation of byId as any[]) {
    const entityId = prefetchObjectIdString(observation.entityId);
    if (entityId) byReference.get(userKeyReferenceId({ entityId }))?.push(observation);
  }
  return byReference;
}

function userTitleObservations(observations: readonly any[]): any[] {
  return observations.filter(
    (observation) =>
      observation.field === 'title' &&
      !shouldIgnoreObservationForEntityMaterialization('user', observation),
  );
}

async function userKeyJoinEvidence(
  reference: UserKeyReference,
  readObservations: any[],
  now: Date,
): Promise<UserKeyJoinEvidence> {
  const unscreened = partitionObservationsByInvalidatedRun(
    readObservations,
    await invalidatedScrapeRunIds(),
  ).kept;
  const kept = await withoutDirectoryContradictedProfileEvidenceForKey(
    reference.entityKey,
    unscreened,
  );
  const unjoined: UserKeyJoinEvidence = { researcherId: undefined, titleObservations: [] };
  if (kept.length === 0) return unjoined;
  const screened = await screenedUserIdentityJoin(reference, kept, now);
  if ('skipped' in screened) return unjoined;
  return {
    researcherId: prefetchObjectIdString(screened.join.researcher?._id),
    titleObservations: userTitleObservations(screened.observations),
  };
}

export interface UserKeyResearcherJoins {
  joinedResearcherId?: string;
  namingResearcherIds: string[];
}

export async function userKeyResearcherJoins(
  entityKey: string,
  now: Date = new Date(),
): Promise<UserKeyResearcherJoins> {
  const reference: UserKeyReference = { entityKey };
  const observations =
    (await liveObservationsOfUserKeys([reference])).get(userKeyReferenceId(reference)) ?? [];
  if (observations.length === 0) return { namingResearcherIds: [] };
  const joinedResearcherId = (await userKeyJoinEvidence(reference, observations, now)).researcherId;
  const netid = normalizedAccountNetid(entityKey.replace(/^netid:/, ''));
  const emails = uniqueStrings(
    observations
      .filter((observation: any) => observation.field === 'email')
      .map((observation: any) => normalizedAccountEmail(observation.value))
      .filter((email): email is string => Boolean(email)),
  );
  const accountNetids = emails.length
    ? (
        (await Account.find({ email: { $in: emails } })
          .select('netid')
          .lean()) as any[]
      )
        .map((account) => normalizedAccountNetid(account.netid))
        .filter((value): value is string => Boolean(value))
    : [];
  const claimants = await liveResearchersClaimingOfficialProfileUrls(
    uniqueStrings(observations.map((observation: any) => textValue(observation.sourceUrl))),
  );
  const candidateIds = new Set<string>(
    [...claimants.values()]
      .flat()
      .map((researcher) => prefetchObjectIdString(researcher?._id))
      .filter((id): id is string => Boolean(id)),
  );
  if (joinedResearcherId) candidateIds.add(joinedResearcherId);
  const netids = uniqueStrings([...(netid ? [netid] : []), ...accountNetids]);
  const clauses: Record<string, unknown>[] = [];
  if (netids.length > 0) clauses.push({ 'identifiers.netid': { $in: netids } });
  if (emails.length > 0) clauses.push({ 'identifiers.email': { $in: emails } });
  if (candidateIds.size > 0) {
    clauses.push({
      _id: { $in: [...candidateIds].map((id) => new mongoose.Types.ObjectId(id)) },
    });
  }
  if (clauses.length === 0) return { joinedResearcherId, namingResearcherIds: [] };
  const researchers = (await Researcher.find({ archived: { $ne: true }, $or: clauses })
    .select('_id identifiers profileLinks')
    .lean()) as any[];
  const namingResearcherIds: string[] = [];
  for (const researcher of researchers) {
    const named = await userKeysNamingResearcherIdentity(researcher);
    if (named.some((candidate) => sameUserKeyReference(candidate, reference))) {
      const id = prefetchObjectIdString(researcher._id);
      if (id) namingResearcherIds.push(id);
    }
  }
  return { joinedResearcherId, namingResearcherIds: namingResearcherIds.sort() };
}

function personTitleFrom(observations: readonly any[], now: Date): string | undefined {
  const resolved = resolveField(
    'title',
    observations.map((observation) => ({
      field: observation.field,
      value: observation.value,
      sourceName: observation.sourceName,
      confidence: observation.confidence,
      observedAt: observation.observedAt,
    })),
    { now },
  );
  return stripTitleFieldLabel(textValue(resolved?.value)) || undefined;
}

/**
 * A researcher's title is resolved over the title evidence of every person key whose own
 * engine join reaches the researcher, not over the one key being materialized, so the
 * stored title no longer depends on which key materialized last (#5578). A key the
 * researcher's identity cannot find (one the name resolver alone joined) adds its own
 * title only when no key the researcher can find states one, which keeps the answer the
 * same from both sides. That own-key fallback is the one title that is not the same from
 * every key, so it is reported as such and the caller gates it by writer precedence.
 */
interface ResearcherTitle {
  title: string | undefined;
  fromOwnKeyFallback: boolean;
  fromFreshFirstHand: boolean;
}

async function researcherTitleOverEveryJoiningKey(input: {
  researcher: any;
  identifier: UserKeyReference;
  ownObservations: readonly any[];
  ownTitle: string | undefined;
  now: Date;
  prefetch?: MaterializationReadSource;
}): Promise<ResearcherTitle> {
  const ownKeyFallback = (title: string | undefined): ResearcherTitle => ({
    title,
    fromOwnKeyFallback: true,
    fromFreshFirstHand: false,
  });
  const researcherId = prefetchObjectIdString(input.researcher?._id);
  if (!researcherId) return ownKeyFallback(input.ownTitle);
  const cache = input.prefetch?.userIdentityJoins;
  let candidates = cache?.candidatesFor(researcherId);
  if (!candidates) {
    candidates = await userKeysNamingResearcherIdentity(input.researcher);
    cache?.rememberCandidates(researcherId, candidates);
  }
  const own = input.identifier;
  const ownKeyIsFindable = candidates.some((candidate) => sameUserKeyReference(candidate, own));
  const others = candidates.filter((candidate) => !sameUserKeyReference(candidate, own));
  const evidence = new Map<string, UserKeyJoinEvidence>();
  const unjoined: UserKeyReference[] = [];
  for (const candidate of others) {
    const cached = cache?.joinFor(candidate);
    if (cached) evidence.set(userKeyReferenceId(candidate), cached);
    else unjoined.push(candidate);
  }
  if (unjoined.length > 0) {
    const observationsByReference = await liveObservationsOfUserKeys(unjoined, input.prefetch);
    const joins = await Promise.all(
      unjoined.map((candidate) =>
        userKeyJoinEvidence(
          candidate,
          observationsByReference.get(userKeyReferenceId(candidate)) ?? [],
          input.now,
        ),
      ),
    );
    unjoined.forEach((candidate, index) => {
      cache?.rememberJoin(candidate, joins[index]);
      evidence.set(userKeyReferenceId(candidate), joins[index]);
    });
  }
  const refusals = input.researcher?.fieldValueRefusals;
  const pooled: any[] = withoutResearcherRefusedObservations(
    [...evidence.values()]
      .filter((joined) => joined.researcherId === researcherId)
      .flatMap((joined) => joined.titleObservations as any[]),
    refusals,
  );
  const ownTitleObservations = withoutResearcherRefusedObservations(
    userTitleObservations(input.ownObservations),
    refusals,
  );
  if (ownKeyIsFindable) pooled.push(...ownTitleObservations);
  const scope: FirstHandTitleScope = {
    officialPageKeys: await soleClaimedOfficialPageKeys(input.researcher, cache),
    latestFullRunIdByLane: await latestFullRunIdByFirstHandLane(cache),
  };
  const pooledTitle = personTitleFrom(userTitleEvidence(pooled, scope), input.now);
  if (pooledTitle) {
    return {
      title: pooledTitle,
      fromOwnKeyFallback: false,
      fromFreshFirstHand: Boolean(newestFirstHandUserTitle(pooled, scope)),
    };
  }
  return ownKeyFallback(
    personTitleFrom(userTitleEvidence(ownTitleObservations, scope), input.now) ?? input.ownTitle,
  );
}

export interface ScreenedPageWithdrawal {
  researcherId: string;
  officialLinkUrls: string[];
  orcid?: string;
  imageUrl?: string;
}

interface WithdrawalHolder {
  _id: unknown;
  identifiers?: { orcid?: string };
  profile?: { imageUrl?: string };
  profileLinks?: ResearcherProfileLink[];
}

/**
 * Whether every live `user` observation stating this value for the field was read from a page
 * that names another netid. Only for values that identify one person, an ORCID or a photo URL,
 * so a value many people share, such as a title, is never attributed by its value alone.
 */
async function personValueOnlyFromContradictedPages(
  field: 'orcid' | 'imageUrl',
  value: string,
  netid: string,
  readScope: Record<string, unknown>,
): Promise<boolean> {
  const values = field === 'orcid' ? [value, value.toUpperCase(), value.toLowerCase()] : [value];
  const assertions = (await Observation.find(
    { entityType: 'user', field, ...readScope, value: { $in: [...new Set(values)] } },
    { sourceUrl: 1 },
  ).lean()) as Array<{ sourceUrl?: unknown }>;
  if (assertions.length === 0) return false;
  const owners = await profilePageOwnerNetids(
    assertions.map((assertion) => assertion.sourceUrl),
    readScope,
  );
  return assertions.every((assertion) =>
    profilePageContradictsNetid(owners, assertion.sourceUrl, netid),
  );
}

async function planContradictedPageWithdrawalForHolder(
  holder: WithdrawalHolder,
  netid: string,
  screenedPageUrls: readonly string[],
): Promise<ScreenedPageWithdrawal | undefined> {
  const readScope = materializationReadScopeFilter();
  const officialUrls = (holder.profileLinks ?? [])
    .filter((link) => link?.kind === 'YALE_OFFICIAL' && typeof link.url === 'string')
    .map((link) => link.url);
  const linkOwners = await profilePageOwnerNetids(officialUrls, readScope);
  const screened = new Set(screenedPageUrls);
  const officialLinkUrls = officialUrls.filter(
    (url) => screened.has(url) || profilePageContradictsNetid(linkOwners, url, netid),
  );
  const storedOrcid = textValue(holder.identifiers?.orcid);
  const orcid =
    storedOrcid &&
    (await personValueOnlyFromContradictedPages('orcid', storedOrcid, netid, readScope))
      ? storedOrcid
      : undefined;
  const storedImage = textValue(holder.profile?.imageUrl);
  const imageUrl =
    storedImage &&
    (await personValueOnlyFromContradictedPages('imageUrl', storedImage, netid, readScope))
      ? storedImage
      : undefined;
  if (officialLinkUrls.length === 0 && !orcid && !imageUrl) return undefined;
  return {
    researcherId: String(holder._id),
    officialLinkUrls,
    ...(orcid ? { orcid } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

const WITHDRAWAL_HOLDER_FIELDS =
  '_id identifiers.netid identifiers.orcid profile.imageUrl profileLinks';

/**
 * What a namesake's record keeps only because a screened page once spoke for it: the official
 * link the misattributed page evidence gave it, which the official-page join reads as identity,
 * and an ORCID copied from that page. Each goes with its evidence (#5693).
 *
 * A link is withdrawn when it is a screened page, or when the page it points at states an email
 * the directory gives to a different netid, which covers a host or path variant of the same
 * person page that no exact URL match reaches. An ORCID is withdrawn only when every live
 * observation asserting it was read from such a page, so a value any of the person's own
 * evidence states stays. Only the live holder of the key's own netid is touched.
 */
export async function planScreenedPageWithdrawal(
  entityKey: string | undefined,
  screenedPageUrls: string[],
): Promise<ScreenedPageWithdrawal | undefined> {
  const netid = netidOfNetidUserKey(entityKey);
  if (!netid || screenedPageUrls.length === 0) return undefined;
  const holder = (await Researcher.findOne({ archived: { $ne: true }, 'identifiers.netid': netid })
    .select(WITHDRAWAL_HOLDER_FIELDS)
    .lean()) as WithdrawalHolder | null;
  if (!holder) return undefined;
  return planContradictedPageWithdrawalForHolder(holder, netid, screenedPageUrls);
}

/**
 * The same withdrawal for a researcher reached by any key, so a link to another person's page
 * does not survive just because none of the holder's own keys is screened (#5737). The
 * researcher's own netid is the witness, and the alias-twin rule in
 * `profilePageContradictsNetid` still applies.
 */
export async function planHeldContradictedPageWithdrawal(
  holder: WithdrawalHolder & { identifiers?: { netid?: string; orcid?: string } },
): Promise<ScreenedPageWithdrawal | undefined> {
  const netid = textValue(holder.identifiers?.netid).toLowerCase();
  if (!netid) return undefined;
  return planContradictedPageWithdrawalForHolder(holder, netid, []);
}

function applyWithdrawalToResearcherDocument(
  researcher: any,
  plan: ScreenedPageWithdrawal,
): number {
  let changed = 0;
  const links: ResearcherProfileLink[] = researcher.profileLinks ?? [];
  const withdrawn = new Set(plan.officialLinkUrls);
  const orcidLink = plan.orcid ? new RegExp(`(?:^|/)${escapeRegex(plan.orcid)}/*$`, 'i') : null;
  const keptLinks = links.filter(
    (link) =>
      !(link?.kind === 'YALE_OFFICIAL' && withdrawn.has(link.url)) &&
      !(orcidLink && link?.kind === 'ORCID' && orcidLink.test(String(link.url ?? ''))),
  );
  if (keptLinks.length !== links.length) {
    researcher.profileLinks = keptLinks;
    changed += 1;
  }
  if (plan.orcid && researcher.identifiers?.orcid) {
    researcher.set('identifiers.orcid', undefined);
    changed += 1;
  }
  if (plan.imageUrl && researcher.profile?.imageUrl) {
    researcher.set('profile.imageUrl', undefined);
    changed += 1;
  }
  return changed;
}

/**
 * A key's evidence read from a person page that the directory gives to another netid is not
 * evidence about the researcher the key joined, so it is dropped before the profile is written
 * (#5737). Without this, a key joined to the wrong person re-stamps that page's link and photo
 * on every pass after the held link is withdrawn.
 */
async function withoutPagesNamingAnotherNetid<T extends { sourceUrl?: unknown }>(
  observations: T[],
  netid: string,
): Promise<T[]> {
  const pages = [
    ...new Set(observations.map((observation) => textValue(observation.sourceUrl)).filter(Boolean)),
  ];
  if (pages.length === 0) return observations;
  const owners = await profilePageOwnerNetids(pages, materializationReadScopeFilter());
  if (owners.byPage.size === 0) return observations;
  return observations.filter(
    (observation) => !profilePageContradictsNetid(owners, observation.sourceUrl, netid),
  );
}

type ScreenedUserIdentityJoin =
  | { join: UserIdentityJoinResult; observations: any[] }
  | { skipped: 'office-mailbox-user-key' | 'page-evidence-names-another-netid' };

/**
 * The join a user key's own materialization acts on, shared with every reader that pools a
 * key's evidence so a pooled key is screened exactly as it would be when it materializes.
 */
async function screenedUserIdentityJoin(
  identifier: UserKeyReference,
  observations: any[],
  now: Date,
): Promise<ScreenedUserIdentityJoin> {
  if (userKeyNamesRoleOrUnitMailbox(identifier.entityKey, observations)) {
    return { skipped: 'office-mailbox-user-key' };
  }
  const join = await joinUserIdentityToExistingResearcher(identifier, observations, now);
  const joinedNetid = textValue(join.researcher?.identifiers?.netid).toLowerCase();
  if (!join.researcher?._id || !joinedNetid) return { join, observations };
  const kept = await withoutPagesNamingAnotherNetid(observations, joinedNetid);
  if (kept.length === observations.length) return { join, observations };
  const rejoined =
    kept.length > 0 ? await joinUserIdentityToExistingResearcher(identifier, kept, now) : undefined;
  if (!rejoined || String(rejoined.researcher?._id ?? '') !== String(join.researcher._id)) {
    return { skipped: 'page-evidence-names-another-netid' };
  }
  return { join: rejoined, observations: kept };
}

async function officialPageNamesAnotherNetid(
  pageUrl: string,
  researcher: { identifiers?: { netid?: string } },
): Promise<boolean> {
  const netid = textValue(researcher.identifiers?.netid).toLowerCase();
  if (!netid) return false;
  const owners = await profilePageOwnerNetids([pageUrl], materializationReadScopeFilter());
  return profilePageContradictsNetid(owners, pageUrl, netid);
}

function userWriteScope(options: MaterializeOptions): string[] | undefined {
  return options.userWriteOnlyFields && options.userWriteOnlyFields.length > 0
    ? expandUserMaterializerScope(options.userWriteOnlyFields)
    : undefined;
}

const unionSorted = (...lists: ReadonlyArray<readonly string[] | undefined>): string[] =>
  [...new Set(lists.flatMap((list) => list ?? []))].sort();

function withScreenedWithdrawalPaths(
  result: MaterializeResult,
  withdrawal: ScreenedPageWithdrawalOutcome,
): MaterializeResult {
  return {
    ...result,
    plannedPaths: unionSorted(result.plannedPaths, withdrawal.plannedPaths),
    droppedPaths: unionSorted(result.droppedPaths, withdrawal.droppedPaths),
  };
}

interface ScreenedPageWithdrawalOutcome {
  written: number;
  plannedPaths: string[];
  droppedPaths: string[];
}

function scopeScreenedPageWithdrawal(
  plan: ScreenedPageWithdrawal,
  scope: readonly string[],
): { plan: ScreenedPageWithdrawal; plannedPaths: string[]; droppedPaths: string[] } {
  const planned = [
    ...(plan.officialLinkUrls.length > 0 ? ['profileLinks'] : []),
    ...(plan.orcid ? [ORCID_PROFILE_LINK_PATH, 'identifiers.orcid'] : []),
    ...(plan.imageUrl ? ['profile.imageUrl'] : []),
  ];
  const { kept, dropped } = partitionPlannedPaths(planned, scope);
  return {
    plan: {
      researcherId: plan.researcherId,
      officialLinkUrls: kept.includes('profileLinks') ? plan.officialLinkUrls : [],
      ...(plan.orcid &&
      (kept.includes(ORCID_PROFILE_LINK_PATH) || kept.includes('identifiers.orcid'))
        ? { orcid: plan.orcid }
        : {}),
      ...(plan.imageUrl && kept.includes('profile.imageUrl') ? { imageUrl: plan.imageUrl } : {}),
    },
    plannedPaths: kept,
    droppedPaths: dropped,
  };
}

async function withdrawScreenedOfficialProfileLinks(
  entityKey: string | undefined,
  screenedPageUrls: string[],
  options: MaterializeOptions,
): Promise<ScreenedPageWithdrawalOutcome> {
  const none: ScreenedPageWithdrawalOutcome = { written: 0, plannedPaths: [], droppedPaths: [] };
  const plannedPlan = await planScreenedPageWithdrawal(entityKey, screenedPageUrls);
  if (!plannedPlan) return none;
  const scope = userWriteScope(options);
  const scoped = scope ? scopeScreenedPageWithdrawal(plannedPlan, scope) : undefined;
  const plan = scoped?.plan ?? plannedPlan;
  const paths = {
    plannedPaths: scoped?.plannedPaths ?? [],
    droppedPaths: scoped?.droppedPaths ?? [],
  };
  if (scoped && scoped.plannedPaths.length === 0) return { ...none, ...paths };
  if (options.dryRun) return { written: 1, ...paths };
  const pulls: Array<Record<string, unknown>> = [];
  if (plan.officialLinkUrls.length > 0) {
    pulls.push({ kind: 'YALE_OFFICIAL', url: { $in: plan.officialLinkUrls } });
  }
  if (plan.orcid) {
    pulls.push({ kind: 'ORCID', url: new RegExp(`(?:^|/)${escapeRegex(plan.orcid)}/*$`, 'i') });
  }
  const unset: Record<string, ''> = {
    ...(plan.orcid && (!scope || userScopeAdmits(scope, 'identifiers.orcid'))
      ? { 'identifiers.orcid': '' as const }
      : {}),
    ...(plan.imageUrl ? { 'profile.imageUrl': '' as const } : {}),
  };
  const result = await Researcher.updateOne(
    { _id: plan.researcherId },
    {
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      ...(pulls.length
        ? { $pull: { profileLinks: pulls.length === 1 ? pulls[0] : { $or: pulls } } }
        : {}),
    },
  );
  return { written: result.modifiedCount > 0 ? 1 : 0, ...paths };
}

async function releaseFieldWritersThatNoLongerReach(
  researcher: any,
  materializingKey: string,
): Promise<void> {
  const writers: Map<string, { userKey?: string }> | undefined = researcher.profileFieldWriters;
  if (!writers?.size) return;
  const siblingKeys = new Set(
    [...writers.values()]
      .map((writer) => writer?.userKey)
      .filter((key): key is string => Boolean(key) && key !== materializingKey),
  );
  for (const key of siblingKeys) {
    const reached = await researcherReachedByUserIdentity(key);
    if (reached && String(reached.researcherId) === String(researcher._id)) continue;
    for (const [field, writer] of [...writers.entries()]) {
      if (writer?.userKey === key) writers.delete(field);
    }
  }
}

function researcherJoinIdentitySnapshot(researcher: any): string {
  return JSON.stringify([
    researcher.displayName,
    researcher.archived,
    researcher.identifiers?.netid,
    researcher.identifiers?.email,
    (researcher.profileLinks || []).map((link: ResearcherProfileLink) => [link.kind, link.url]),
  ]);
}

function researcherSnapshot(researcher: any): Record<string, unknown> {
  return typeof researcher?.toObject === 'function'
    ? researcher.toObject({ flattenMaps: true, depopulate: true })
    : structuredClone(researcher);
}

async function writeScopedResearcherPlan(input: {
  researcher: any;
  storedResearcher: Record<string, unknown>;
  scope: readonly string[];
  identifier: { entityId?: string; entityKey?: string };
  resolved: Record<string, ResolvedField>;
  conflicts: number;
  identityJoin: UserIdentityJoin | undefined;
  dryRun: boolean;
}): Promise<MaterializeResult> {
  const planned = researcherSnapshot(input.researcher);
  const { kept, dropped } = partitionPlannedPaths(
    changedResearcherPaths(input.storedResearcher, planned),
    input.scope,
  );
  const result = (fieldsWritten: number): MaterializeResult => ({
    entityType: 'user',
    entityId: materializerDocumentId(input.researcher._id),
    entityKey: input.identifier.entityKey,
    fieldsWritten,
    conflicts: input.conflicts,
    created: false,
    resolved: input.resolved,
    plannedPaths: kept,
    droppedPaths: dropped,
    ...(input.identityJoin ? { identityJoin: input.identityJoin } : {}),
  });
  if (input.dryRun) return result(kept.length);
  if (kept.length === 0) return result(0);
  const candidate = Researcher.hydrate(input.storedResearcher);
  for (const { path, value } of scopedResearcherWrites(input.storedResearcher, planned, kept)) {
    candidate.set(path, value);
  }
  await candidate.validate();
  await Researcher.updateOne(
    { _id: input.researcher._id },
    scopedResearcherUpdate(input.storedResearcher, planned, kept),
  );
  if (researcherSearchDocumentInputsChanged(input.storedResearcher, candidate)) {
    await noteResearcherSearchInputChange(input.researcher._id);
  }
  return result(kept.length);
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

  const screened = await screenedUserIdentityJoin(identifier, obs, options.now ?? new Date());
  if ('skipped' in screened) return skipped(screened.skipped);
  const { join, observations: screenedObservations } = screened;
  const {
    resolved,
    displayName,
    title,
    primaryDepartment,
    imageUrl,
    websiteUrl,
    websiteUrlConfidence,
    orcid,
    profileUrls,
    personNameHeldByNobody,
    identityJoinedOnEmailAlone,
    identityJoinedOnOfficialProfileUrlAlone,
    account,
  } = join;
  let { researcher, identityJoin } = join;
  const scope = userWriteScope(options);
  const storedResearcher: Record<string, unknown> | undefined =
    scope && researcher?._id ? researcherSnapshot(researcher) : undefined;
  const searchInputsBeforeWrite = researcher?._id
    ? researcherSearchDocumentInputs(researcher)
    : undefined;
  const accountId: mongoose.Types.ObjectId | undefined = account?._id;
  let heldPageFieldsWithdrawn = 0;
  if (researcher?._id) {
    const heldPlan = await planHeldContradictedPageWithdrawal(researcher);
    if (heldPlan)
      heldPageFieldsWithdrawn = applyWithdrawalToResearcherDocument(researcher, heldPlan);
  }

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
  //   - Only a name nobody holds may mint: `absent`, or `ambiguous` with every same-surname
  //     candidate naming someone else (#4388). Any other `ambiguous` means the corpus
  //     already holds candidates that could be this person, so minting would add one more,
  //     and `dedupeAccountlessResearcherShells` cannot heal equal-tier same-name shells:
  //     every later pass would stay ambiguous and mint again, while raising ambiguity for
  //     every other lane that resolves names. A minted name resolves `matched` on the next
  //     pass, so the wider reading still converges.
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
  if (!researcher && scope) return skipped('field-scoped-run-mints-no-researcher');
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
    const nameHeldByNobody = Boolean(displayName) && personNameHeldByNobody;
    const mintsFromAliasEmail = Boolean(
      keyIdentity.emailAliasName && !keyIdentity.name && !resolvedNetid,
    );
    const resolvableBack =
      Boolean(keyIdentity.name) || Boolean(resolvedNetid) || mintsFromAliasEmail;
    const namedAsLead =
      nameHeldByNobody &&
      resolvableBack &&
      (await liveResearchEntityNamesUserKeyAsLead(attributionKey));
    if (!namedAsLead) {
      return skipped('directory-identity-without-research-signal');
    }
    const aliasEmailMint = mintsFromAliasEmail
      ? await rosterAliasEmailMintIdentity({
          userEntityKey: attributionKey,
          alias: keyIdentity.netid ?? '',
          displayName,
          observedEmail: normalizedAccountEmail(resolved.email?.value),
          observations: obs.filter(
            (o: any) => !shouldIgnoreObservationForEntityMaterialization('user', o),
          ),
        })
      : undefined;
    if (aliasEmailMint?.status === 'refused') {
      return skipped(aliasEmailMint.reason);
    }
    const mintedEmail = aliasEmailMint?.status === 'mintable' ? aliasEmailMint.email : undefined;
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
    const mintGuard = await currentDirectoryRemovalMintGuard();
    if (
      mintGuard.refusesPerson({
        identifiers: {
          netid: resolvedNetid,
          email: mintedEmail ?? normalizedAccountEmail(resolved.email?.value),
          orcid,
        },
        profileLinks: Object.values(profileUrls ?? {})
          .filter((url): url is string => typeof url === 'string')
          .map((url) => ({ url })),
      })
    ) {
      mintGuard.recordRefusal();
      return skipped(REMOVED_BY_REQUEST);
    }
    if (options.dryRun) {
      return skipped('dry-run-would-mint-researcher');
    }
    researcher = new Researcher({
      displayName,
      // Stamped from the directory's own observation of this person's netid, never from the
      // alias itself, so the alias is not promoted to a join key (`research-model.md:36`).
      ...(resolvedNetid ? { identifiers: { netid: resolvedNetid } } : {}),
      ...(mintedEmail ? { identifiers: { email: mintedEmail } } : {}),
      status: 'UNKNOWN',
      archived: false,
    });
    mintedFromPiAttribution = true;
    identityJoin = 'minted-from-pi-attribution';
  }
  const created = mintedFromPiAttribution;
  const {
    title: researcherTitle,
    fromOwnKeyFallback: titleFromOwnKeyFallback,
    fromFreshFirstHand: titleFromFreshFirstHand,
  } = created
    ? { title, fromOwnKeyFallback: true, fromFreshFirstHand: false }
    : await researcherTitleOverEveryJoiningKey({
        researcher,
        identifier: identifier.entityKey
          ? { entityKey: identifier.entityKey }
          : { entityId: prefetchObjectIdString(identifier.entityId) },
        ownObservations: screenedObservations,
        ownTitle: title,
        now: options.now ?? new Date(),
        prefetch: options.chunkPrefetch,
      });
  const joinIdentityBeforeWrite = researcherJoinIdentitySnapshot(researcher);

  let fieldsWritten = heldPageFieldsWithdrawn;
  // An email-only or profile-URL-only join enriches the profile but never renames the
  // researcher: the address and the page vouched for which person this is, not for what
  // that person is called. Both joins already required the names to agree, so a rename
  // here could only swap one accepted spelling of the same person for another.
  const identityJoinedWithoutANameResolver =
    identityJoinedOnEmailAlone || identityJoinedOnOfficialProfileUrlAlone;
  const writerKey = identifier.entityKey || String(identifier.entityId ?? '');
  const titleHeldByFallbackWriter = Boolean(
    researcher.profileFieldWriters?.get?.(OWN_KEY_FALLBACK_TITLE_FIELD),
  );
  if (writerKey) await releaseFieldWritersThatNoLongerReach(researcher, writerKey);
  const resolvedConfidence = (...fields: string[]): unknown =>
    fields.map((field) => resolved[field]?.confidence).find((value) => value !== undefined);
  const storedFieldValue = (field: ResearcherGatedField): unknown =>
    field === 'displayName' ? researcher.displayName : researcher.profile?.[field];
  const settleFieldWriter = (
    field: ResearcherGatedField,
    value: string | undefined,
    confidence: unknown,
    valueOutranksStored = false,
    storedValuePresent: boolean = Boolean(textValue(storedFieldValue(field))),
  ): boolean => {
    const decision = decideResearcherFieldWrite(
      researcher.profileFieldWriters,
      field,
      researcherFieldWriter(
        writerKey,
        identityJoin,
        confidence,
        isFillOnlyFieldValue(field, resolved[field]?.contributingSources),
      ),
      Boolean(value),
      storedValuePresent,
      valueOutranksStored,
    );
    if (!decision.write) {
      if (decision.releaseWriter) researcher.profileFieldWriters.delete(field);
      return false;
    }
    if (decision.writerChanged) {
      if (!researcher.profileFieldWriters) researcher.profileFieldWriters = new Map();
      researcher.profileFieldWriters.set(field, decision.writer);
    }
    return true;
  };
  const nameValue = !identityJoinedWithoutANameResolver && displayName ? displayName : undefined;
  if (
    (!writerKey ||
      settleFieldWriter('displayName', nameValue, resolvedConfidence('displayName', 'lname'))) &&
    nameValue &&
    researcher.displayName !== nameValue
  ) {
    researcher.displayName = nameValue;
    fieldsWritten += 1;
  }
  researcher.profile = researcher.profile || {};
  const servedTitle = normalizedResearcherProfileText(
    'title',
    servablePersonTitle(researcherTitle),
  );
  // #5578 is scoped to fresh first-hand reads: without one, a servable stored title stays as
  // it is, and only an empty or unservable one is filled. A title an own-key fallback wrote
  // stays under #5706 precedence, so the keys that fall back still settle. The rest is #5801.
  const titleInScope =
    titleFromFreshFirstHand ||
    !servablePersonTitle(researcher.profile.title) ||
    (titleFromOwnKeyFallback && titleHeldByFallbackWriter);
  const titleWrites =
    titleInScope &&
    (!titleFromOwnKeyFallback ||
      !writerKey ||
      settleFieldWriter(OWN_KEY_FALLBACK_TITLE_FIELD, servedTitle, resolvedConfidence('title')));
  if (titleInScope && !titleFromOwnKeyFallback && servedTitle) {
    // A fallback writer recorded before the pool stated a title was never ranked against the
    // keys that may fall back next, so it must not decide a later fallback round.
    researcher.profileFieldWriters?.delete(OWN_KEY_FALLBACK_TITLE_FIELD);
  }
  if (titleWrites && servedTitle && researcher.profile.title !== servedTitle) {
    researcher.profile.title = servedTitle;
    fieldsWritten += 1;
  }
  const overSharedWebsiteKeys = await overSharedPersonWebsiteKeysForMaterialization();
  const coreFacilityWebsiteKeys = await coreFacilityWebsiteKeysForMaterialization();
  const isScreenedOutPersonWebsite = (value: unknown): boolean =>
    isInadmissiblePersonWebsiteUrl(value) ||
    isOverSharedPersonWebsite(value, overSharedWebsiteKeys) ||
    isCoreFacilityWebsite(value, coreFacilityWebsiteKeys);
  const storedWebsiteSurvivingScreens =
    isScreenedOutPersonWebsite(researcher.profile.websiteUrl) ||
    researcherRefusesValue(
      researcher.fieldValueRefusals,
      'websiteUrl',
      researcher.profile.websiteUrl,
    )
      ? undefined
      : researcher.profile.websiteUrl;
  if (isDepartmentHeadingChrome(researcher.profile.primaryDepartment)) {
    researcher.profile.primaryDepartment = undefined;
    fieldsWritten += 1;
  }
  const storedDepartment = storedDepartmentAfterExportDecode(
    researcher.profile.primaryDepartment,
    await catalogDepartment(),
  );
  if (storedDepartment.changed) {
    researcher.profile.primaryDepartment = storedDepartment.department;
    fieldsWritten += 1;
  }
  if (
    isOverSharedPersonImage(
      researcher.profile.imageUrl,
      await overSharedPersonImageKeysForMaterialization(),
    )
  ) {
    researcher.profile.imageUrl = undefined;
    researcher.profileFieldWriters?.delete('imageUrl');
    fieldsWritten += 1;
  }
  const storedDepartmentBacked =
    !writerKey ||
    !primaryDepartment ||
    !isFillOnlyFieldValue('primaryDepartment', resolved.primaryDepartment?.contributingSources) ||
    researcher.profileFieldWriters?.get?.('primaryDepartment')
      ? true
      : await storedDepartmentBackedByAnyReading(
          researcher,
          identifier.entityKey
            ? { entityKey: identifier.entityKey }
            : prefetchObjectIdString(identifier.entityId)
              ? { entityId: prefetchObjectIdString(identifier.entityId) }
              : undefined,
        );
  for (const [key, value, confidence] of [
    ['primaryDepartment', primaryDepartment, resolvedConfidence('primaryDepartment')],
    ['imageUrl', imageUrl, resolvedConfidence('imageUrl')],
    ['websiteUrl', websiteUrl, websiteUrlConfidence],
  ] as const) {
    const bounded = normalizedResearcherProfileText(key, value);
    const storedValue = researcher.profile[key];
    if (key === 'websiteUrl' && websiteStandsBelowStored(bounded, storedWebsiteSurvivingScreens)) {
      continue;
    }
    const outranksStoredWebsite =
      key === 'websiteUrl' && websiteStandsAboveStored(bounded, storedWebsiteSurvivingScreens);
    const storedValuePresent = storedValueCountsAsPresent(
      researcher.profileFieldWriters,
      key,
      Boolean(textValue(storedValue)),
      key === 'primaryDepartment' ? storedDepartmentBacked : true,
    );
    if (
      writerKey &&
      !settleFieldWriter(key, bounded, confidence, outranksStoredWebsite, storedValuePresent)
    ) {
      continue;
    }
    if (key === 'websiteUrl' && isSamePersonWebsite(storedWebsiteSurvivingScreens, bounded)) {
      continue;
    }
    if (bounded && storedValue !== bounded) {
      researcher.profile[key] = bounded;
      fieldsWritten += 1;
    }
  }
  if (researcher.profile.title) {
    const storedTitle = servablePersonTitle(researcher.profile.title);
    if (storedTitle !== researcher.profile.title) {
      researcher.profile.title = storedTitle;
      fieldsWritten += 1;
    }
  }
  if (isScreenedOutPersonWebsite(researcher.profile.websiteUrl)) {
    researcher.profile.websiteUrl = undefined;
    fieldsWritten += 1;
  }
  const refusedStoredValues = planResearcherRefusedStoredValueClear(researcher);
  for (const path of refusedStoredValues.unset) {
    researcher.set(path, undefined);
    fieldsWritten += 1;
  }
  if (refusedStoredValues.profileLinkUrlsToPull.length > 0) {
    const refusedUrls = new Set(refusedStoredValues.profileLinkUrlsToPull);
    researcher.profileLinks = (researcher.profileLinks || []).filter(
      (link: ResearcherProfileLink) => !refusedUrls.has(String(link.url)),
    );
    fieldsWritten += refusedUrls.size;
  }
  const storedOrcid: string | undefined = researcher.identifiers?.orcid;
  const priorOrcid = isPlausiblePersonOrcid(storedOrcid) ? storedOrcid : undefined;
  const storedOrcidIsImplausible = Boolean(storedOrcid) && !priorOrcid;
  const priorOrcidLinks: ResearcherProfileLink[] = storedOrcidIsImplausible
    ? []
    : (researcher.profileLinks || []).filter(
        (link: ResearcherProfileLink) => link.kind === 'ORCID',
      );
  let orcidFieldsWritten = 0;
  if (orcid && priorOrcid !== orcid) {
    researcher.identifiers = { ...(researcher.identifiers || {}), orcid };
    orcidFieldsWritten += 1;
  } else if (storedOrcidIsImplausible) {
    researcher.set('identifiers.orcid', undefined);
    orcidFieldsWritten += 1;
  }
  const priorNetid: string | undefined = researcher.identifiers?.netid;
  const netidToStamp = await accountNetidForResearcherLink(accountId, account);
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

  const priorEmail: string | undefined = researcher.identifiers?.email;
  let emailFieldsWritten = 0;
  const storedUnlessScoped = (path: string, planned: unknown): unknown =>
    storedResearcher && scope && !userScopeAdmits(scope, path)
      ? valueAtPath(storedResearcher, path)
      : planned;
  const derivedEmail = await derivedResearcherEmail(
    {
      _id: researcher._id,
      netid: textValue(storedUnlessScoped('identifiers.netid', researcher.identifiers?.netid)),
      displayName: textValue(storedUnlessScoped('displayName', researcher.displayName)),
    },
    textValue(priorEmail),
  );
  if (derivedEmail) {
    researcher.set('identifiers.email', derivedEmail);
    emailFieldsWritten += 1;
    fieldsWritten += 1;
  }

  const now = new Date();
  const refusesProfileLink = (link: ResearcherProfileLink | undefined): boolean =>
    Boolean(link) &&
    researcherRefusesValue(researcher.fieldValueRefusals, 'profileLink', link?.url);
  const existingLinkKinds = new Set(
    (researcher.profileLinks || []).map((link: ResearcherProfileLink) => link.kind),
  );
  const composedOfficialLink = profileUrls
    ? composeOfficialProfileLink({ profileUrls }, now)
    : undefined;
  const officialLink =
    composedOfficialLink &&
    !refusesProfileLink(composedOfficialLink) &&
    !(await officialProfileLinkHeldByConflictingIdentity(composedOfficialLink.url, researcher, {
      readScope: materializationReadScopeFilter(),
    })) &&
    !(await officialPageNamesAnotherNetid(composedOfficialLink.url, researcher))
      ? composedOfficialLink
      : undefined;
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
  const scholarLink = scholarUrl ? scholarProfileLink(scholarUrl, now) : undefined;
  if (scholarLink && !refusesProfileLink(scholarLink) && !existingLinkKinds.has('GOOGLE_SCHOLAR')) {
    researcher.profileLinks.push(scholarLink);
    fieldsWritten += 1;
  }
  if (orcid) {
    const currentOrcidLink = orcidProfileLink(orcid, now);
    if (
      !refusesProfileLink(currentOrcidLink) &&
      priorOrcidLinks.every((link) => link.url !== currentOrcidLink.url)
    ) {
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
  const emailSupport = await researcherEmailSupport(researcher, {
    entityKey: textValue(identifier.entityKey),
    observations: obs,
  });
  if (!sameResearcherEmailSupport(researcher.identifiers?.emailSupport, emailSupport)) {
    researcher.set('identifiers.emailSupport', emailSupport);
    fieldsWritten += 1;
  }
  let conflicts = 0;

  // A stored row can already hold an ORCID link its identifier does not back, because
  // raw bulk writes skip the schema validator (#4501), and the validator rejects the
  // whole save. So the planned link is always the one the final identifier backs.
  const reconcileOrcidLinkWithIdentifier = (): void => {
    const identifierOrcid: string | undefined = researcher.identifiers?.orcid;
    const links: ResearcherProfileLink[] = researcher.profileLinks || [];
    if (orcidProfileLinksAgreeWithIdentifier(links, identifierOrcid)) return;
    const contradictedOrcidLinks = links
      .filter((link) => link.kind === 'ORCID')
      .map((link) => link.url);
    researcher.profileLinks = [
      ...links.filter((link) => link.kind !== 'ORCID'),
      ...(identifierOrcid ? [orcidProfileLink(identifierOrcid.toUpperCase(), now)] : []).filter(
        (link) => !refusesProfileLink(link),
      ),
    ];
    fieldsWritten += 1;
    conflicts += 1;
    console.warn(
      'Researcher ORCID profile link contradicts identifiers.orcid; planning the link the identifier backs:',
      sanitizeLogValue({
        researcherId: materializerDocumentId(researcher._id),
        entityKey: identifier.entityKey,
        identifierOrcid: identifierOrcid ?? null,
        contradictedOrcidLinks,
      }),
    );
  };
  reconcileOrcidLinkWithIdentifier();

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
    reconcileOrcidLinkWithIdentifier();
  };

  // The email was verified against the netid being stamped, so it goes with that netid.
  const forgiveNetidCollision = (): void => {
    researcher.set('identifiers.netid', priorNetid);
    fieldsWritten -= netidFieldsWritten;
    netidFieldsWritten = 0;
    if (emailFieldsWritten > 0) {
      researcher.set('identifiers.email', priorEmail);
      researcher.set('identifiers.emailSupport', undefined);
      fieldsWritten -= emailFieldsWritten;
      emailFieldsWritten = 0;
    }
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

  if (scope && storedResearcher) {
    const scopedResult = await writeScopedResearcherPlan({
      researcher,
      storedResearcher,
      scope,
      identifier,
      resolved,
      conflicts,
      identityJoin,
      dryRun: Boolean(options.dryRun),
    });
    if (!options.dryRun && scopedResult.fieldsWritten > 0) {
      options.chunkPrefetch?.userIdentityJoins?.forgetAll();
    }
    return scopedResult;
  }

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
      plannedPaths: withoutRepeatedParentPaths(researcher.modifiedPaths?.() ?? []),
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
  if (created || researcherJoinIdentitySnapshot(researcher) !== joinIdentityBeforeWrite) {
    options.chunkPrefetch?.userIdentityJoins?.forgetAll();
  }
  if (
    searchInputsBeforeWrite !== undefined &&
    researcherSearchDocumentInputs(researcher) !== searchInputsBeforeWrite
  ) {
    await noteResearcherSearchInputChange(researcher._id);
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
  /** The sole lead's person id; absent or empty where there is not exactly one, which disables the lab retype. */
  leadPersonId?: string;
  /** Every live lab row, read for the lab retype; absent disables it. */
  labRowRoster?: LabRowRoster;
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
  const prefetchedLeadPersonId = prefetchedLead?.hit ? prefetchedLead.value : undefined;
  return {
    knownPersonSurnames: await loadKnownPersonSurnameRoster(),
    leadPersonName: await loadResearchEntityLeadPersonName(
      researchEntityId,
      prefetchedLeadPersonId,
    ),
    leadPersonId: await loadResearchEntitySoleLeadPersonId(
      researchEntityId,
      prefetchedLeadPersonId,
    ),
    labRowRoster: await loadLabRowRoster(),
  };
}

export interface ProjectFromLogInput {
  leadPageDeparture?: PersonPageDeparture;
  resolved: Record<string, ResolvedField>;
  nameIdentityAuthority: ResearchEntityNameIdentityAuthority;
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  entityDoc: any;
  materializationObs: any[];
  /** Websites live `CORE_FACILITY` rows hold, which a person's row may not cite (#5788). */
  coreFacilityWebsiteKeys?: ReadonlySet<string>;
  /** Every person page the row's own live observations cite (#5764). */
  observedPersonPageUrls?: readonly string[];
  resolverObs: ResolverObservation[];
  derivedResearchAreas?: DerivedResearchAreaCandidate;
  storedDerivedResearchAreasStale?: boolean;
  fullDescriptionShellGated: boolean;
  undergradEvidenceQuoteWithdrawnBy?: ReadonlySet<string>;
  fellowshipFieldsAssertedAbsent?: ReadonlyMap<string, ReadonlySet<string>>;
  droppedLoserWebsiteValues?: readonly unknown[];
  fieldsBackedByRefusedListings?: readonly string[];
  mergedInLeadProfileUrls?: readonly string[];
  laneWithdrawnWebsiteValues?: readonly unknown[];
  gonePageWithdrawnValuesByField?: ReadonlyMap<string, readonly unknown[]>;
  siteSharedPageNames?: ReadonlySet<string>;
  loserRosterReads?: readonly ResolverObservation[];
  survivorReadOnARoster?: boolean;
  rosterPersonKeys?: readonly unknown[];
  chunkPrefetch?: MaterializationReadSource;
  mergedInRows?: ReadonlyArray<Pick<MergedInResearchEntityRow, '_id' | 'slug'>>;
  now: Date;
  synthesizeCardDescription?: CardSynthesizer;
  resynthesizeCutCards?: boolean;
  resynthesizeWeakCards?: boolean;
  cardModel?: string;
  writeOnlyFields?: string[];
  provenanceOnly?: boolean;
  readRowUnderOwnIdentity?: boolean;
  fellowshipFieldsStatedByCitedFunds?: ReadonlySet<string>;
  researchAreasHaveNoLiveEvidence?: boolean;
  storedResearchAreasEvidenceRetired?: boolean;
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
  fellowshipAbsenceClears?: FellowshipAbsenceClear[];
  fellowshipUnbackedClears?: string[];
}

export const RESEARCH_ENTITY_IDENTITY_NAME_FIELDS = ['name', 'displayName'] as const;

function isPersonBiographyDescription(candidateText: string): boolean {
  return (
    isHighConfidencePersonBio(candidateText) ||
    isCareerBiographyDescription(candidateText) ||
    isBiographyRatherThanResearch(candidateText)
  );
}

function isResearchProse(candidateText: string): boolean {
  return !isBiographyRatherThanResearch(candidateText) && opensByStatingResearch(candidateText);
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
 * refusal discipline. The guard requires the incumbent to be unservable or a biography,
 * so the only description a student can already read that this displaces is a biography,
 * and only for research prose that also serves (#4288); it never touches a manually
 * locked field. When no candidate survives, the stored value is left alone
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
  if (!textValue(servedValue)) return 0;
  const incumbentServes = servesAsDescription(servedValue);
  if (incumbentServes && !isBiographyRatherThanResearch(textValue(servedValue))) return 0;

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
  // A biography is a fallback only (#4288): an incumbent biography that serves yields to
  // servable research prose and to nothing else, and one that serves nothing still yields to a
  // servable biography, because refusing that took a served row off the surface (#4280).
  // Displacing a biography that serves must not cost the row its card: a research body that
  // restates the card leaves no card to serve, which held a served row on Development (#4288).
  const keepsDescriptionPair = (value: unknown): boolean =>
    servingBarAcceptsDescriptionPair(
      entityDoc,
      { ...set, kind: identity.kind },
      textValue(value),
      input.leadPersonName,
    );
  const replacement = incumbentServes
    ? servable.find(
        ({ materialized }) =>
          isResearchProse(textValue(materialized)) && keepsDescriptionPair(materialized),
      )
    : (servable.find(
        ({ materialized }) => !isBiographyRatherThanResearch(textValue(materialized)),
      ) ?? servable[0]);

  if (!replacement) return 0;

  set[field] = replacement.materialized;
  confidenceByField[field] = replacement.candidate.confidence;
  if (replacement.provenance) set[`fieldProvenance.${field}`] = replacement.provenance;
  return 1;
}

/**
 * The card analog of `adoptServableFullDescription` (#4392). The write-time card check
 * reads the quality bar alone, while the serve sanitizer also blanks a first-person
 * line, so a higher-confidence verbatim "we study ..." card outranked a servable card
 * from another lane and the row served no card at all. When the projected card would
 * serve blank, the next ranked candidate that would serve is adopted; when none would,
 * the stored card is left for the dedicated card re-derivation below, which treats a
 * card the serve sanitizer blanks as not clearing the card bar and synthesizes one.
 */
function adoptServableShortDescription(input: {
  now: Date;
  set: Record<string, unknown>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  derivedKind: string | undefined;
  resolverObs: ResolverObservation[];
  manuallyLockedFields: string[];
  manualValues: Record<string, unknown>;
  materializationObs: MaterializerObservationLike[];
}): number {
  const field = 'shortDescription';
  if (input.manuallyLockedFields.includes(field)) return 0;
  const { set, entityDoc, confidenceByField } = input;
  const fullDescription = set.fullDescription ?? entityDoc?.fullDescription;
  const isProgramLike = isProgramLikeResearchEntity({
    kind: set.kind ?? input.derivedKind ?? entityDoc?.kind,
    entityType: set.entityType ?? entityDoc?.entityType,
  });
  const servesAsCard = (value: unknown): boolean => {
    const served = sanitizeResearchEntityShortDescription(textValue(value));
    return (
      Boolean(served) &&
      servedCardClearsGateBar({
        shortDescription: served,
        fullDescription,
        researchAreas: set.researchAreas ?? entityDoc?.researchAreas,
        entityType: set.entityType ?? entityDoc?.entityType,
        kind: set.kind ?? input.derivedKind ?? entityDoc?.kind,
      })
    );
  };

  const incumbent = set[field] ?? entityDoc?.[field];
  if (!textValue(incumbent) || servesAsCard(incumbent)) return 0;

  const replacement = resolveFieldRanked(field, input.resolverObs, {
    now: input.now,
    manuallyLockedFields: input.manuallyLockedFields,
    manualValues: input.manualValues,
  }).find(
    (candidate) =>
      textValue(candidate.value) !== textValue(incumbent) &&
      servesAsCard(candidate.value) &&
      resolvedShortDescriptionCandidateIsUsable(candidate.value, fullDescription, isProgramLike),
  );
  if (!replacement) return 0;

  set[field] = textValue(replacement.value);
  confidenceByField[field] = replacement.confidence;
  const provenance = fieldProvenanceForResolvedObservation(
    field,
    replacement,
    input.materializationObs,
  );
  if (provenance) set[`fieldProvenance.${field}`] = provenance;
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
 * After a research row is merged or re-keyed, the roster keeps reading its page but files
 * the person's appointment under the person key, so the row's own department observation
 * stops being refreshed and falls outside the currency window while the page still lists
 * the person (#4694). A person-keyed roster read naming the same department is therefore
 * a read of that appointment: it dates it, and it never adds a department of its own.
 */
async function personKeyedRosterDepartmentReads(
  keys: unknown[],
  prefetch?: MaterializationReadSource,
): Promise<ResolverObservation[]> {
  const personKeys = [...new Set(keys.map((key) => textValue(key)).filter(Boolean))];
  if (personKeys.length === 0) return [];
  const personObservations =
    routedObservationsForKeysAndIds('user', personKeys, [], prefetch) ??
    (await Observation.find({
      entityType: 'user',
      entityKey: { $in: personKeys },
      field: 'departments',
      sourceName: DEPARTMENT_ROSTER_APPOINTMENT_SOURCE,
      ...materializationReadScopeFilter(),
    }).lean());
  const reads = (personObservations as any[]).filter(
    (observation) =>
      observation.field === 'departments' &&
      observation.sourceName === DEPARTMENT_ROSTER_APPOINTMENT_SOURCE,
  ) as Array<ResolverObservation & { scrapeRunId?: unknown }>;
  return partitionObservationsByInvalidatedRun(reads, await invalidatedScrapeRunIds()).kept;
}

interface DepartmentRosterReread {
  departmentKey: string;
  readAt: number;
  scrapeRunId: string;
  listedEntityKeys: ReadonlySet<string>;
}

const scrapeRunIdOf = (value: unknown): string => (value ? String(value) : '');

/**
 * Every live roster snapshot that read its whole page, as the department it governs and
 * the keys it listed. An incomplete or unread snapshot says nothing about who a page
 * lists, so it is left out rather than read as an absence (#3251).
 */
async function authoritativeDepartmentRosterRereads(
  departmentKey: (value: string) => string,
): Promise<DepartmentRosterReread[]> {
  const snapshots = (await Observation.find({
    entityType: 'departmentRosterHealth',
    field: DEPARTMENT_ROSTER_HEALTH_FIELD,
    ...materializationReadScopeFilter(),
  })
    .select('value observedAt scrapeRunId')
    .lean()) as Array<{ value?: unknown; observedAt?: unknown; scrapeRunId?: unknown }>;
  return snapshots.flatMap((row) => {
    const snapshot = (row.value ?? {}) as DepartmentRosterHealthSnapshot;
    const deptName = textValue(snapshot.deptName).trim();
    if (!deptName || !isEntityAuthoritativeSnapshot(snapshot)) return [];
    const readAt = (rosterHealthReadAt(snapshot) ?? new Date(row.observedAt as any)).getTime();
    if (!Number.isFinite(readAt)) return [];
    return [
      {
        departmentKey: departmentKey(deptName),
        readAt,
        scrapeRunId: scrapeRunIdOf(row.scrapeRunId),
        listedEntityKeys: new Set(snapshotDiscoveredEntityKeys(snapshot)),
      },
    ];
  });
}

/**
 * An appointment is retired only when the newest later complete read of its own
 * department's roster no longer lists the row under any of its keys. A read of some other
 * department is not evidence about this one, so a run scoped to a few rosters leaves
 * every other roster's appointments standing (#5824). The snapshot of the appointment's
 * own run is not a re-read either, nor is that of any person-keyed read that dates it: it
 * is written after the walk, and a cross-listed programme lane's appointees are never in
 * its keys, so it would retire the appointment that run just read.
 */
function rosterAppointmentRereadWithoutListing(
  appointmentDepartmentKeys: readonly string[],
  appointmentReadTime: number,
  appointmentReadingRunIds: ReadonlySet<string>,
  rereads: readonly DepartmentRosterReread[],
  rowEntityKeys: ReadonlySet<string>,
): boolean {
  if (appointmentDepartmentKeys.length === 0) return false;
  return appointmentDepartmentKeys.every((key) => {
    const later = rereads.filter(
      (reread) =>
        reread.departmentKey === key &&
        reread.readAt > appointmentReadTime &&
        !appointmentReadingRunIds.has(reread.scrapeRunId),
    );
    if (later.length === 0) return false;
    const newestReadAt = Math.max(...later.map((reread) => reread.readAt));
    return later
      .filter((reread) => reread.readAt === newestReadAt)
      .every((reread) =>
        [...rowEntityKeys].every((entityKey) => !reread.listedEntityKeys.has(entityKey)),
      );
  });
}

function rosterAppointmentReads(
  observation: ResolverObservation,
  personReads: readonly ResolverObservation[],
): ResolverObservation[] {
  const departmentsOf = (value: unknown) =>
    (Array.isArray(value) ? value : [value])
      .map((item) => textValue(item).trim().toLowerCase())
      .filter(Boolean);
  const departments = new Set(departmentsOf(observation.value));
  return [
    observation,
    ...personReads.filter((read) =>
      departmentsOf(read.value).some((department) => departments.has(department)),
    ),
  ];
}

export function rosterAppointmentReadTime(
  observation: ResolverObservation,
  personReads: readonly ResolverObservation[],
): number {
  return Math.max(
    ...rosterAppointmentReads(observation, personReads).map(
      (read) => new Date(read.observedAt as any).getTime() || 0,
    ),
  );
}

function rosterAppointmentReadingRunIds(
  observation: ResolverObservation,
  personReads: readonly ResolverObservation[],
): Set<string> {
  return new Set(
    rosterAppointmentReads(observation, personReads)
      .map((read) => scrapeRunIdOf((read as { scrapeRunId?: unknown }).scrapeRunId))
      .filter(Boolean),
  );
}

/**
 * Each department roster page that lists a person is an independent appointment, so
 * a roster-won `departments` is the union of every roster department still being
 * read, not the one page ranked first (#3621). A survivor that reads no roster of its
 * own takes its merged-in rows' current roster appointments the same way, appended
 * after its own departments, because that is the only roster evidence it has (#4694). The resolver weighs each page's list
 * as a rival value, so a cross-listing displaced the home department whenever it was
 * read last.
 *
 * A department observation's fingerprint carries its value, so a page that stops
 * listing the person never supersedes its old value; it just stops being refreshed.
 * Measured on Development, 147 of 173 multi-value roster groups held a value last
 * read 30 or more days before its sibling. A value read within the currency window of
 * the row's newest roster read combines; an older one combines until its own
 * department's roster is read again in full without listing the row, which is what
 * keeps the field from hoarding every page that ever listed the person (#3330) without
 * letting a run scoped to one roster age out every other roster's appointment (#5824).
 */
async function combineDepartmentRosterAppointments(input: {
  set: Record<string, unknown>;
  entityDoc: any;
  rosterReads: readonly ResolverObservation[];
  mergedInRosterReads: readonly ResolverObservation[];
  survivorReadOnARoster: boolean;
  rosterPersonKeys: readonly unknown[];
  rowEntityKeys: readonly unknown[];
  chunkPrefetch?: MaterializationReadSource;
  manuallyLockedFields: string[];
}): Promise<void> {
  const field = 'departments';
  const { set, entityDoc } = input;
  if (input.manuallyLockedFields.includes(field)) return;
  const winnerIsARoster =
    textValue(objectRecord(set[`fieldProvenance.${field}`]).sourceName) ===
    DEPARTMENT_ROSTER_APPOINTMENT_SOURCE;
  const winnerValue = Array.isArray(set[field])
    ? set[field]
    : !(field in set) && Array.isArray(entityDoc?.[field])
      ? entityDoc[field]
      : undefined;
  if (!Array.isArray(winnerValue)) return;
  if (!winnerIsARoster && (input.survivorReadOnARoster || input.mergedInRosterReads.length === 0)) {
    return;
  }
  const rosterReads = refusedResolverObservations(
    (winnerIsARoster
      ? [...input.rosterReads, ...input.mergedInRosterReads]
      : input.mergedInRosterReads
    ).filter(
      (observation) =>
        observation.field === field &&
        observation.sourceName === DEPARTMENT_ROSTER_APPOINTMENT_SOURCE &&
        Array.isArray(observation.value),
    ),
    entityDoc?.fieldValueRefusals,
  ).kept;
  const ownReadTime = (observation: ResolverObservation) =>
    new Date(observation.observedAt as any).getTime() || 0;
  // The floor stays on each read's own date, so a person-keyed read can only bring an
  // appointment back into the window, never push another one out of it.
  const newestRead = Math.max(0, ...rosterReads.map(ownReadTime));
  const currencyFloor = newestRead - DEPARTMENT_ROSTER_APPOINTMENT_CURRENCY_DAYS * 86_400_000;
  const anyReadIsStale = [...rosterReads, ...input.mergedInRosterReads].some(
    (observation) => ownReadTime(observation) < currencyFloor,
  );
  const personReads = anyReadIsStale
    ? await personKeyedRosterDepartmentReads([...input.rosterPersonKeys], input.chunkPrefetch)
    : [];
  const readTime = (observation: ResolverObservation) =>
    rosterAppointmentReadTime(observation, personReads);
  const namesADepartment = await departmentValueNamesADepartment(
    'school' in set ? set.school : entityDoc?.school,
  );
  const canonicalizer = await getOrgUnitCanonicalizer();
  const departmentKey = (value: string) =>
    canonicalizer.canonicalizeDepartments([value]).values[0] ?? value.trim().toLowerCase();
  const departmentKeysOf = (observation: ResolverObservation) =>
    (Array.isArray(observation.value) ? observation.value : [observation.value])
      .map((item) => textValue(item))
      .filter(Boolean)
      .map(departmentKey);
  const rereads = anyReadIsStale ? await authoritativeDepartmentRosterRereads(departmentKey) : [];
  const rowEntityKeys = new Set(
    [...input.rowEntityKeys, ...input.rosterPersonKeys]
      .map((key) => textValue(key))
      .filter(Boolean),
  );
  const isCurrent = (observation: ResolverObservation) =>
    readTime(observation) >= currencyFloor ||
    !rosterAppointmentRereadWithoutListing(
      departmentKeysOf(observation),
      readTime(observation),
      rosterAppointmentReadingRunIds(observation, personReads),
      rereads,
      rowEntityKeys,
    );
  const currentAppointments = rosterReads
    .filter(isCurrent)
    .sort(
      (left, right) =>
        readTime(right) - readTime(left) ||
        JSON.stringify(left.value).localeCompare(JSON.stringify(right.value)),
    )
    .flatMap((observation) => (observation.value as unknown[]).map((item) => textValue(item)))
    .filter((item) => item && namesADepartment([item]));
  const keysNamedBy = (observations: readonly ResolverObservation[]) =>
    new Set(observations.flatMap(departmentKeysOf));
  const winner = (winnerValue as unknown[]).map((value) => textValue(value)).filter(Boolean);
  const winnerKeys = new Set(winner.map(departmentKey));
  const winnerIsStored = !Array.isArray(set[field]);
  const currentKeys = keysNamedBy(input.mergedInRosterReads.filter(isCurrent));
  const survivorKeys = keysNamedBy(
    input.rosterReads.filter((observation) => observation.field === field),
  );
  const staleMergedInKeys = winnerIsStored
    ? [...keysNamedBy(input.mergedInRosterReads.filter((read) => !isCurrent(read)))].filter(
        (key) => !currentKeys.has(key) && !survivorKeys.has(key),
      )
    : [];
  const byKey = new Map<string, string>();
  for (const item of [...winner, ...currentAppointments]) {
    const key = departmentKey(item);
    if (!byKey.has(key) && !staleMergedInKeys.includes(key)) byKey.set(key, item);
  }
  if (byKey.size === 0) return;
  if (byKey.size === winnerKeys.size && [...byKey.keys()].every((key) => winnerKeys.has(key))) {
    return;
  }
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
  siteSharedPageNames?: ReadonlySet<string>;
}): number {
  const { set, unset, confidenceByField, entityDoc } = input;
  const siteSharedPageNames = input.siteSharedPageNames ?? new Set<string>();
  const withdrawnRetype = reclassifyWithdrawnProfileHomeOrganizationRetype({
    set,
    unset,
    confidenceByField,
    entityDoc,
    manuallyLockedFields: input.manuallyLockedFields,
    materializationObs: input.materializationObs,
    leadPersonName: input.nameIdentityAuthority.leadPersonName,
  });
  const personRow = isPersonRowForProfileHomeClaims(
    { slug: entityDoc?.slug, leadPersonName: input.nameIdentityAuthority.leadPersonName },
    input.materializationObs,
  );
  const servesAsFacultyResearch =
    personRow &&
    textValue(set.entityType ?? entityDoc?.entityType).toUpperCase() === 'FACULTY_RESEARCH_AREA';
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
  const servedProvenance = (field: string): Record<string, unknown> =>
    objectRecord(set[`fieldProvenance.${field}`] ?? entityDoc?.fieldProvenance?.[field]);
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
  const siteDeclaredOwnNames = [
    ...new Set(siteDeclaredOwnNamesFromObservations(input.resolverObs)),
  ].sort();
  const namesNothingUsable = (candidateName: unknown, websiteUrl: unknown): boolean =>
    isPlaceholderEntityName(candidateName) ||
    namesAPostingRatherThanResearch(candidateName) ||
    isPostingPageUrl(websiteUrl) ||
    isCoursePageUrl(websiteUrl) ||
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
    (isPersonScopedResearchEntity(recordIdentity) &&
      personScopedNameIsACampusBuilding({
        candidateName,
        personName: recordIdentity.personName,
      })) ||
    (isPersonScopedResearchEntity(recordIdentity) &&
      isOffSitePageTitleForPersonScopedName({
        candidateName,
        sourceUrl: websiteUrl,
        personName: recordIdentity.personName,
        siteDeclaredOwnNames,
        entityType: recordIdentity.entityType,
      })) ||
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
      siteDeclaredOwnNames,
    });

  let fieldsWritten = withdrawnRetype ? 1 : 0;
  const storedSiteDeclaredOwnNames: unknown[] = Array.isArray(entityDoc?.siteDeclaredOwnNames)
    ? entityDoc.siteDeclaredOwnNames
    : [];
  if (siteDeclaredOwnNames.join('\n') !== storedSiteDeclaredOwnNames.join('\n')) {
    if (siteDeclaredOwnNames.length > 0) set.siteDeclaredOwnNames = siteDeclaredOwnNames;
    else unset.siteDeclaredOwnNames = '';
    fieldsWritten++;
  }
  for (const field of RESEARCH_ENTITY_IDENTITY_NAME_FIELDS) {
    if (input.manuallyLockedFields.includes(field)) continue;
    const servedValue = set[field] ?? entityDoc?.[field];
    const provenance = servedProvenance(field);
    if (
      !textValue(servedValue) ||
      (!namesNothingUsable(servedValue, provenance.sourceUrl) &&
        !(
          PAGE_STATED_NAME_SOURCES.has(String(provenance.sourceName ?? '')) &&
          siteSharedPageNames.has(comparablePageStatedName(servedValue))
        ) &&
        !isRefusedResearchEntityName(servedValue, provenance.sourceName) &&
        !(
          (withdrawnRetype || (personRow && !isLabShapedResearchHome(servedValue))) &&
          isWithdrawnProfileHomeName(servedValue, provenance.sourceName, input.materializationObs)
        ))
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
          !siteSharedPageNames.has(comparablePageStatedName(materialized)) &&
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

  // A person's row projected as faculty research serves its own name, on every resolve rather
  // than only the one that retypes it, so a display name left from the lab or organization it
  // was typed as, or re-resolved from a live observation, can neither keep that identity nor be
  // suffixed into a hybrid of the two by the derivations below (#5283). A display name carrying
  // the lead's own name (an eponymous lab, a spelling of the person) is the person's and stays.
  if (servesAsFacultyResearch && !input.manuallyLockedFields.includes('displayName')) {
    const displayName = textValue(set.displayName ?? entityDoc?.displayName);
    if (
      displayName &&
      displayName !== textValue(set.name ?? entityDoc?.name) &&
      !nameCarriesPersonIdentity(displayName, input.nameIdentityAuthority.leadPersonName)
    ) {
      delete set.displayName;
      delete set['fieldProvenance.displayName'];
      delete confidenceByField.displayName;
      if (textValue(entityDoc?.displayName)) {
        unset.displayName = '';
        unset['fieldProvenance.displayName'] = '';
        fieldsWritten++;
      }
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

  const labAssertedByLiveObservation = evidenceAssertsALab(
    ...input.resolverObs
      .filter((observation) =>
        (RESEARCH_ENTITY_IDENTITY_NAME_FIELDS as readonly string[]).includes(observation.field),
      )
      .map((observation) => textValue(observation.value)),
  );
  for (const field of RESEARCH_ENTITY_IDENTITY_NAME_FIELDS) {
    if (input.manuallyLockedFields.includes(field)) continue;
    if (field in unset) continue;
    const servedValue = set[field] ?? entityDoc?.[field];
    const derived = facultyResearchNameFromUnassertedLabSuffix({
      ...recordIdentity,
      candidateName: servedValue,
      labAssertedByLiveObservation,
    });
    if (!derived) continue;
    set[field] = derived;
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (objectRecord(entityDoc?.fieldProvenance?.[field]).sourceUrl) {
      unset[`fieldProvenance.${field}`] = '';
    }
    fieldsWritten++;
  }
  const siteStatedLab = siteStatedLabForWebsite(
    input.materializationObs,
    documentAsProjected(set, unset, entityDoc).websiteUrl,
    entityDoc?.fieldValueRefusals,
  );
  const siteStatedLabName = textValue(siteStatedLab?.name.value);
  fieldsWritten += reclassifyUnbackedLabAsFacultyResearch({
    set,
    unset,
    confidenceByField,
    entityDoc,
    manuallyLockedFields: input.manuallyLockedFields,
    labAssertedByLiveObservation,
    leadPersonName: input.nameIdentityAuthority.leadPersonName,
    siteStatedLabName,
  });
  fieldsWritten += reclassifyUnstatedOrganizationTypeOnFacultyResearchName({
    set,
    unset,
    confidenceByField,
    entityDoc,
    manuallyLockedFields: input.manuallyLockedFields,
    materializationObs: input.materializationObs,
    leadPersonName: input.nameIdentityAuthority.leadPersonName,
  });
  fieldsWritten += reclassifyEvidencedFacultyResearchAsLab({
    set,
    unset,
    confidenceByField,
    entityDoc,
    manuallyLockedFields: input.manuallyLockedFields,
    authority: input.nameIdentityAuthority,
  });
  fieldsWritten += reclassifySiteNamedResearchAsLab({
    set,
    unset,
    confidenceByField,
    entityDoc,
    manuallyLockedFields: input.manuallyLockedFields,
    authority: input.nameIdentityAuthority,
    siteStatedLab,
  });
  // A heading composed from a bare person name gains its suffix here, after the
  // observation normalizer ran on the suffix-less value.
  for (const field of RESEARCH_ENTITY_IDENTITY_NAME_FIELDS) {
    if (input.manuallyLockedFields.includes(field) || field in unset) continue;
    const servedValue = textValue(set[field] ?? entityDoc?.[field]);
    const recased = recaseAllCapsResearchEntityName(servedValue);
    if (!servedValue || recased === servedValue) continue;
    set[field] = recased;
    fieldsWritten++;
  }
  return fieldsWritten;
}

const othersThan = (ids: ReadonlySet<string> | undefined, self: string): boolean =>
  [...(ids ?? [])].some((id) => id !== self);

/**
 * A `FACULTY_RESEARCH_AREA` row whose own evidence says its lead runs a lab is that lab,
 * so it is re-derived as `LAB` under the lab's name on every resolve, with no lock.
 *
 * The evidence is a cited site with "lab" beside the lead's surname, or a recorded,
 * non-LLM description naming "<surname> Lab" (`ownLabEvidence`). It is withheld when the
 * lead already has a lab row, which is a merge rather than a retype (2026-08-25
 * precedence), when the cited lab site also belongs to another person's lab row, and
 * when the row has no lead. "<surname> Lab" yields to "<full name> Lab" when another
 * person's lab row already carries it, and a row with no unclaimed name stays as it is.
 */
function reclassifyEvidencedFacultyResearchAsLab(input: {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  manuallyLockedFields: string[];
  authority: ResearchEntityNameIdentityAuthority;
}): number {
  const { set, unset, confidenceByField, entityDoc, authority } = input;
  const roster = authority.labRowRoster;
  const leadPersonId = textValue(authority.leadPersonId);
  const person = textValue(authority.leadPersonName);
  if (!roster || !leadPersonId || !person) return 0;
  if (['entityType', 'kind', 'name'].some((field) => input.manuallyLockedFields.includes(field))) {
    return 0;
  }
  const projected = documentAsProjected(set, unset, entityDoc);
  if (textValue(projected.entityType).toUpperCase() !== 'FACULTY_RESEARCH_AREA') return 0;
  const evidence = ownLabEvidence(projected, person);
  if (!evidence) return 0;
  const selfId = serializedDocumentId(entityDoc?._id) || '';
  if (othersThan(roster.labIdsByLeadPersonId.get(leadPersonId), selfId)) return 0;
  if (
    evidence.labUrlTokens.some((token) =>
      othersThan(roster.leadPersonIdsByLabUrlToken.get(token), leadPersonId),
    )
  ) {
    return 0;
  }

  const labIdentity = { entityType: 'LAB', kind: mapEntityTypeToResearchGroupKind('LAB') };
  const nameIsFree = (name: string): boolean =>
    Boolean(name) &&
    !othersThan(roster.leadPersonIdsByLabName.get(normalizedLabRowName(name)), leadPersonId);
  const fullName = personScopedResearchEntityNameFromLeadPersonName({
    ...labIdentity,
    slug: projected.slug,
    leadPersonName: person,
  });
  const labName = nameIsFree(evidence.surnameLabName)
    ? evidence.surnameLabName
    : nameIsFree(fullName)
      ? fullName
      : '';
  if (!labName) return 0;

  set.entityType = labIdentity.entityType;
  set.kind = labIdentity.kind;
  for (const field of ['entityType', 'kind', ...RESEARCH_ENTITY_IDENTITY_NAME_FIELDS]) {
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (entityDoc?.fieldProvenance?.[field]) unset[`fieldProvenance.${field}`] = '';
  }
  set.name = labName;
  if (textValue(projected.displayName) && !input.manuallyLockedFields.includes('displayName')) {
    set.displayName = labName;
  }
  return 1;
}

/**
 * The lab name and type the row's own current website states in its title, as the
 * faculty-research promotion read them (#5059). Tied to the current website: a name read
 * from a site the row no longer serves says nothing about it, so it is not evidence once
 * the website moves. A refused name or a refused `LAB` type is not evidence either, since
 * this reads observations the resolver's refusal screen never saw.
 */
export function siteStatedLabForWebsite(
  observations: readonly MaterializerObservationLike[],
  websiteUrl: unknown,
  fieldValueRefusals: unknown,
): { name: MaterializerObservationLike; entityType: MaterializerObservationLike } | null {
  const website = websiteIdentity(textValue(websiteUrl));
  if (!website || valueIsRefused(fieldValueRefusals, 'entityType', 'LAB')) return null;
  const latestFromSite = (field: string, admits: (value: unknown) => boolean) => {
    let latest: MaterializerObservationLike | undefined;
    for (const observation of observations) {
      if (observation.sourceName !== SITE_TITLE_LAB_NAME_SOURCE || observation.field !== field) {
        continue;
      }
      if (websiteIdentity(textValue(observation.sourceUrl)) !== website) continue;
      if (!admits(observation.value)) continue;
      const observedAt =
        observation.observedAt instanceof Date ? observation.observedAt.getTime() : 0;
      const latestAt = latest?.observedAt instanceof Date ? latest.observedAt.getTime() : -1;
      if (observedAt > latestAt) latest = observation;
    }
    return latest;
  };
  const name = latestFromSite(
    'name',
    (value) => Boolean(textValue(value)) && !valueIsRefused(fieldValueRefusals, 'name', value),
  );
  const entityType = latestFromSite(
    'entityType',
    (value) => textValue(value).toUpperCase() === 'LAB',
  );
  return name && entityType ? { name, entityType } : null;
}

/**
 * A row whose own current website states a lab name in its title is that lab, so it is
 * re-derived as `LAB` under that name on every resolve, with no lock (#5059).
 *
 * The rosters that mint faculty research rows each assert the default type and the
 * placeholder name, and two agreeing rosters outvote the one observation read from the
 * lab's own site, so resolution alone reverted promoted rows. The promotion wrote the
 * observation only after refusing a shared group, another researcher's site, and a name
 * the identity authority does not read as the row's own. Withheld when the lead already
 * has another lab row, which is a merge rather than a retype (2026-08-25 precedence).
 * The name and type keep the site observations as provenance, which is what the serve
 * gate (`isUnbackedLabNameShell`) reads as a name read off the row's own website.
 */
function reclassifySiteNamedResearchAsLab(input: {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  manuallyLockedFields: string[];
  authority: ResearchEntityNameIdentityAuthority;
  siteStatedLab: ReturnType<typeof siteStatedLabForWebsite>;
}): number {
  const { set, unset, confidenceByField, entityDoc, authority, siteStatedLab } = input;
  if (!siteStatedLab) return 0;
  if (['entityType', 'kind', 'name'].some((field) => input.manuallyLockedFields.includes(field))) {
    return 0;
  }
  const siteStatedLabName = textValue(siteStatedLab.name.value);
  const projected = documentAsProjected(set, unset, entityDoc);
  const type = textValue(projected.entityType).toUpperCase();
  if (type !== 'FACULTY_RESEARCH_AREA' && type !== 'LAB') return 0;
  const provenanceFor = {
    name: observationFieldProvenance(siteStatedLab.name),
    entityType: observationFieldProvenance(siteStatedLab.entityType),
  };
  if (
    type === 'LAB' &&
    textValue(projected.name) === siteStatedLabName &&
    materializerValuesDeepEqual(projected.fieldProvenance?.name, provenanceFor.name) &&
    materializerValuesDeepEqual(projected.fieldProvenance?.entityType, provenanceFor.entityType)
  ) {
    return 0;
  }
  const leadPersonId = textValue(authority.leadPersonId);
  const selfId = serializedDocumentId(entityDoc?._id) || '';
  if (
    leadPersonId &&
    othersThan(authority.labRowRoster?.labIdsByLeadPersonId.get(leadPersonId), selfId)
  ) {
    return 0;
  }

  const labIdentity = { entityType: 'LAB', kind: mapEntityTypeToResearchGroupKind('LAB') };
  set.entityType = labIdentity.entityType;
  set.kind = labIdentity.kind;
  for (const field of ['kind', ...RESEARCH_ENTITY_IDENTITY_NAME_FIELDS]) {
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (entityDoc?.fieldProvenance?.[field]) unset[`fieldProvenance.${field}`] = '';
  }
  for (const [field, provenance] of Object.entries(provenanceFor)) {
    if (!provenance) continue;
    delete unset[`fieldProvenance.${field}`];
    set[`fieldProvenance.${field}`] = provenance;
  }
  set.name = siteStatedLabName;
  if (textValue(projected.displayName) && !input.manuallyLockedFields.includes('displayName')) {
    set.displayName = siteStatedLabName;
  }
  return 1;
}

function documentAsProjected(
  set: Record<string, unknown>,
  unset: Record<string, ''>,
  entityDoc: any,
): Record<string, any> {
  const view: Record<string, any> = { ...(entityDoc ?? {}) };
  const fieldProvenance: Record<string, unknown> = { ...(entityDoc?.fieldProvenance ?? {}) };
  for (const [key, value] of Object.entries(set)) {
    if (key.startsWith('fieldProvenance.'))
      fieldProvenance[key.slice('fieldProvenance.'.length)] = value;
    else view[key] = value;
  }
  for (const key of Object.keys(unset)) {
    if (key.startsWith('fieldProvenance.'))
      delete fieldProvenance[key.slice('fieldProvenance.'.length)];
    else delete view[key];
  }
  view.fieldProvenance = fieldProvenance;
  return view;
}

// The website arms run after the identity derivations, so a value staged here may still be
// one they refuse, and a profile page they never store must not back a lab the gate, which
// reads the stored row, holds as unbacked. Each field is screened as its own arm screens
// it, and a locked field is one no arm touches.
function withWebsitesThePassKeeps(
  projected: Record<string, any>,
  manuallyLockedFields: readonly string[],
): Record<string, any> {
  const identity: ResearchEntityHostOwnerIdentity = {
    name: projected.name,
    displayName: projected.displayName,
    entityType: projected.entityType,
    kind: projected.kind,
  };
  const kept = (field: 'websiteUrl' | 'website', refuses: (value: string) => boolean) => {
    const value = projected[field];
    if (manuallyLockedFields.includes(field)) return value;
    return typeof value === 'string' && value.trim() && refuses(value) ? '' : value;
  };
  return {
    ...projected,
    websiteUrl: kept('websiteUrl', (value) =>
      Boolean(researchHomeWebsiteUrlWriteRefusal(value, identity)),
    ),
    website: kept('website', (value) => isWithheldResearchWebsiteUrl(value, identity)),
  };
}

/**
 * A `LAB` row whose lab name nothing backs is one person's faculty research, so it is
 * re-derived as `FACULTY_RESEARCH_AREA` under the person-scoped name on every resolve.
 *
 * The backing test is the gate's own `unbacked_lab_name` predicate, so the two cannot
 * disagree: before this, the gate held such a row and no lane could ever clear it.
 * A live observation asserting a lab keeps the row as it is, matching #4641 for rows
 * already typed `FACULTY_RESEARCH_AREA`. No field is locked; the type and name are a
 * derivation from the absence of lab evidence and come back if that evidence appears.
 *
 * Only the lead's eponym is renamed: every word before "Lab" has to be a word of the
 * lead's own name. A topic or programme name ("Computational Vision Lab") is the row's
 * own designation even with nothing citing it, and reads as a bare person name by
 * shape alone, so it stays held. A leadless row stays held too; `missing_lead` would
 * hold it whatever its name.
 */
function reclassifyUnbackedLabAsFacultyResearch(input: {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  manuallyLockedFields: string[];
  labAssertedByLiveObservation: boolean;
  leadPersonName: unknown;
  siteStatedLabName?: string;
}): number {
  const { set, unset, confidenceByField, entityDoc } = input;
  if (['entityType', 'kind', 'name'].some((field) => input.manuallyLockedFields.includes(field))) {
    return 0;
  }
  const projected = documentAsProjected(set, unset, entityDoc);
  // A name the row's own current website states in its title is read, not composed (#5059).
  if (input.siteStatedLabName && textValue(projected.name) === input.siteStatedLabName) return 0;
  // A composed full-name heading is what the live name observations repeat, so their
  // assertion of a lab is not evidence of one.
  if (
    input.labAssertedByLiveObservation &&
    !isComposedFullNameLabName(projected, input.leadPersonName)
  ) {
    return 0;
  }
  if (
    !isUnbackedLabNameShell(
      withWebsitesThePassKeeps(projected, input.manuallyLockedFields),
      input.leadPersonName,
    )
  )
    return 0;

  const facultyResearchIdentity = {
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: mapEntityTypeToResearchGroupKind('FACULTY_RESEARCH_AREA'),
  };
  const eponym = textValue(projected.name).replace(/\s+lab(?:oratory)?$/i, '');
  if (!eponymNamesOnlyTheLead(eponym, input.leadPersonName)) return 0;
  const derivedName = personScopedResearchEntityNameFromLeadPersonName({
    ...facultyResearchIdentity,
    slug: projected.slug,
    leadPersonName: input.leadPersonName,
  });
  if (!derivedName) return 0;

  set.entityType = facultyResearchIdentity.entityType;
  set.kind = facultyResearchIdentity.kind;
  for (const field of ['entityType', 'kind', ...RESEARCH_ENTITY_IDENTITY_NAME_FIELDS]) {
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (entityDoc?.fieldProvenance?.[field]) unset[`fieldProvenance.${field}`] = '';
  }
  set.name = derivedName;
  if (textValue(projected.displayName) && !input.manuallyLockedFields.includes('displayName')) {
    set.displayName = derivedName;
  }
  return 1;
}

const FACULTY_RESEARCH_NAME_SUFFIX = /\sFaculty Research$/;

const ORGANIZATION_TYPES_A_PERSON_ROW_WAS_GRAFTED = new Set(['CENTER', 'INITIATIVE', 'INSTITUTE']);

/**
 * A row titled "<person> Faculty Research" whose organizational type no live
 * observation states is that person's faculty research, so it is re-derived as
 * `FACULTY_RESEARCH_AREA` on every resolve, with no lock.
 *
 * The type is what #3886 left behind: `official-profile-pi-backfill` asserted a linked
 * home's name, kind and type as one claim, the name half was retired, and
 * `withoutUnpairedProfileHomeIdentity` now withdraws the type half on every resolve.
 * A withdrawn type resolves to nothing rather than to a rival, and a merged row's
 * losers may not state a survivor-owned field, so the stored graft persisted with no
 * evidence behind it while the name, which only a person-scoped roster composes,
 * said faculty research. A live observation of the type, an operator edit included,
 * keeps the row as it is, unless the operator has refused that type on the row.
 *
 * The suffix alone does not make a row person-scoped, so every word before it has to
 * be a word of the lead's own name, as for `reclassifyUnbackedLabAsFacultyResearch`;
 * an organization whose name ends the same way, or a leadless row, keeps its type.
 */
function reclassifyUnstatedOrganizationTypeOnFacultyResearchName(input: {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  manuallyLockedFields: string[];
  materializationObs: MaterializerObservationLike[];
  leadPersonName: unknown;
}): number {
  const { set, unset, confidenceByField, entityDoc } = input;
  if (['entityType', 'kind', 'name'].some((field) => input.manuallyLockedFields.includes(field))) {
    return 0;
  }
  const projected = documentAsProjected(set, unset, entityDoc);
  const type = textValue(projected.entityType).toUpperCase();
  if (!ORGANIZATION_TYPES_A_PERSON_ROW_WAS_GRAFTED.has(type)) return 0;
  const names = [projected.name, projected.displayName].map(textValue).filter(Boolean);
  const namesTheLeadsFacultyResearch = (name: string) =>
    FACULTY_RESEARCH_NAME_SUFFIX.test(name) &&
    eponymNamesOnlyTheLead(name.replace(FACULTY_RESEARCH_NAME_SUFFIX, ''), input.leadPersonName);
  if (names.length === 0 || !names.every(namesTheLeadsFacultyResearch)) return 0;
  const typeIsStated = input.materializationObs.some(
    (observation) =>
      observation.field === 'entityType' &&
      textValue(observation.value).toUpperCase() === type &&
      !valueIsRefused(entityDoc?.fieldValueRefusals, 'entityType', observation.value),
  );
  if (typeIsStated) return 0;

  set.entityType = 'FACULTY_RESEARCH_AREA';
  set.kind = mapEntityTypeToResearchGroupKind('FACULTY_RESEARCH_AREA');
  for (const field of ['entityType', 'kind']) {
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (entityDoc?.fieldProvenance?.[field]) unset[`fieldProvenance.${field}`] = '';
  }
  return 1;
}

/**
 * A row `official-profile-pi-backfill` retyped into an organization keeps the stored name,
 * type and kind once every observation behind them is withdrawn, because a withdrawn field
 * resolves to nothing rather than to a rival. On a person's row that is the retype the owner
 * ruled out (2026-10-17, #5283), so the row is re-derived as faculty research on every resolve,
 * with no lock, and the name authority then replaces the lane's withdrawn name. A row that keeps
 * a lab-shaped name some other source still states is that lab, so it is re-derived as `LAB`. A live
 * observation of the stored type, an operator edit included, keeps the row as it is.
 */
function reclassifyWithdrawnProfileHomeOrganizationRetype(input: {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  confidenceByField: Record<string, number>;
  entityDoc: any;
  manuallyLockedFields: string[];
  materializationObs: MaterializerObservationLike[];
  leadPersonName: unknown;
}): boolean {
  const { set, unset, confidenceByField, entityDoc } = input;
  if (['entityType', 'kind', 'name'].some((field) => input.manuallyLockedFields.includes(field))) {
    return false;
  }
  if ('entityType' in set) return false;
  const storedType = textValue(entityDoc?.entityType).toUpperCase();
  if (!ORGANIZATION_TYPES_A_PERSON_ROW_WAS_GRAFTED.has(storedType)) return false;
  if (entityDoc?.fieldProvenance?.entityType?.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE) {
    return false;
  }
  const storedTypeIsStated = input.materializationObs.some(
    (observation) =>
      observation.field === 'entityType' &&
      textValue(observation.value).toUpperCase() === storedType &&
      !valueIsRefused(entityDoc?.fieldValueRefusals, 'entityType', observation.value),
  );
  if (storedTypeIsStated) return false;
  if (
    !isPersonRowForProfileHomeClaims(
      { slug: entityDoc?.slug, leadPersonName: input.leadPersonName },
      input.materializationObs,
    )
  ) {
    return false;
  }
  const keptName = set.name ?? entityDoc?.name;
  const keptNameProvenance = objectRecord(
    set['fieldProvenance.name'] ?? entityDoc?.fieldProvenance?.name,
  );
  const keepsItsOwnLabName =
    !isWithdrawnProfileHomeName(
      keptName,
      keptNameProvenance.sourceName,
      input.materializationObs,
    ) && isLabShapedResearchHome(keptName);
  const personRowType = keepsItsOwnLabName ? 'LAB' : 'FACULTY_RESEARCH_AREA';
  set.entityType = personRowType;
  set.kind = mapEntityTypeToResearchGroupKind(personRowType);
  for (const field of ['entityType', 'kind']) {
    delete set[`fieldProvenance.${field}`];
    delete confidenceByField[field];
    if (entityDoc?.fieldProvenance?.[field]) unset[`fieldProvenance.${field}`] = '';
  }
  return true;
}

const comparableName = (value: unknown): string =>
  textValue(value).replace(/\s+/g, ' ').toLowerCase();

function isWithdrawnProfileHomeName(
  servedValue: unknown,
  provenanceSourceName: unknown,
  materializationObs: MaterializerObservationLike[],
): boolean {
  if (provenanceSourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE) return false;
  const served = comparableName(servedValue);
  return !materializationObs.some(
    (observation) =>
      observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
      (observation.field === 'name' || observation.field === 'displayName') &&
      comparableName(observation.value) === served,
  );
}

function eponymNamesOnlyTheLead(eponym: string, leadPersonName: unknown): boolean {
  const eponymTokens = personIdentityTokens(eponym);
  const leadTokens = new Set(personIdentityTokens(leadPersonName));
  return eponymTokens.length > 0 && eponymTokens.every((token) => leadTokens.has(token));
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

function servingRepresentationForCandidate(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  candidateText: string,
  leadPersonName: string,
) {
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
  return {
    leadMemberNames,
    representation: buildResearchEntityPublicDescriptionRepresentation({ entity, leadMemberNames }),
  };
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
  const { representation, leadMemberNames } = servingRepresentationForCandidate(
    entityDoc,
    projected,
    candidateText,
    leadPersonName,
  );
  return (
    representation.strictQuality.full.isUseful &&
    textValue(servedResearchEntityCopy(representation.entity, leadMemberNames).fullDescription)
      .length > 0
  );
}

export function servingBarAcceptsDescriptionPair(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  candidateText: string,
  leadPersonName: string,
): boolean {
  const { representation } = servingRepresentationForCandidate(
    entityDoc,
    projected,
    candidateText,
    leadPersonName,
  );
  return representation.invariant.pass && representation.strictQuality.full.isUseful;
}

/**
 * The serving check's verdict on a card beside a written body, asked of the row as this
 * pass would leave it: the public description invariant passes and the card the gate
 * judges is complete, which is exactly what `missing_card_description` and
 * `public_description_invariant_failed` read.
 */
export function servingBarAcceptsWrittenBodyCard(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  body: string,
  card: string,
  leadPersonName: string,
): boolean {
  const { representation } = servingRepresentationForCandidate(
    entityDoc,
    { ...projected, shortDescription: card },
    body,
    leadPersonName,
  );
  return representation.invariant.pass && representation.quality.cardState === 'complete';
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
    observedPersonPageUrls = [],
    coreFacilityWebsiteKeys = new Set<string>(),
    resolverObs,
    fullDescriptionShellGated,
    undergradEvidenceQuoteWithdrawnBy = new Set<string>(),
    fellowshipFieldsAssertedAbsent: fellowshipAbsentByField = new Map<
      string,
      ReadonlySet<string>
    >(),
    droppedLoserWebsiteValues = [],
    fieldsBackedByRefusedListings = [],
    mergedInLeadProfileUrls = [],
    laneWithdrawnWebsiteValues = [],
    gonePageWithdrawnValuesByField = new Map<string, readonly unknown[]>(),
    loserRosterReads = [],
    survivorReadOnARoster = false,
    rosterPersonKeys = [],
    chunkPrefetch,
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
  let fellowshipAbsenceClears: FellowshipAbsenceClear[] = [];
  let fellowshipUnbackedClears: string[] = [];
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
      const provenance =
        fieldProvenanceForResolvedObservation(field, r, materializationObs) ??
        derivedResearchAreaProvenanceFor(field, r, input.derivedResearchAreas);
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
      siteSharedPageNames: input.siteSharedPageNames,
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
    fieldsWritten += adoptServableShortDescription({
      now: input.now,
      set,
      confidenceByField,
      entityDoc,
      derivedKind,
      resolverObs,
      manuallyLockedFields,
      manualValues,
      materializationObs,
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
      rosterReads: resolverObs,
      mergedInRosterReads: loserRosterReads,
      survivorReadOnARoster,
      rosterPersonKeys,
      rowEntityKeys: [entityDoc?.slug, ...(input.mergedInRows ?? []).map((row) => row.slug)],
      chunkPrefetch,
      manuallyLockedFields,
    });
  }
  let fullRestatesCurrentCard = false;
  if (isResearchEntityObservationType(entityType)) {
    if (!manuallyLockedFields.includes('fullDescription') && resolved.fullDescription) {
      // A written body's card is chosen from that body afterwards (#4788), so the card
      // stored now is not yet its card, and judging the body against it let a card that
      // merely restated the written body hand the field back to copied text.
      const winnerIsWrittenBody =
        (set['fieldProvenance.fullDescription'] as { sourceName?: unknown } | undefined)
          ?.sourceName === WRITTEN_DESCRIPTION_SOURCE_NAME;
      const currentShortForFullDistinctness = winnerIsWrittenBody
        ? ''
        : textValue(
            set.shortDescription ?? entityDocShortDescriptionForRestatementGuard(entityDoc),
          );
      const cardShortForFullInversion = winnerIsWrittenBody
        ? ''
        : textValue(set.shortDescription ?? entityDoc?.shortDescription);
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
    const writtenCard = writtenBodyCardBasis({
      set,
      entityDoc,
      fullDescription,
      cardLocked: manuallyLockedFields.includes('shortDescription'),
    });
    const cardSynthesizer =
      input.synthesizeCardDescription ??
      defaultMaterializerCardSynthesizer(entityName, input.cardModel);
    const weakCardTest = input.resynthesizeWeakCards
      ? (card: string) =>
          isWeakCardLine(card, {
            researchAreas: set.researchAreas ?? entityDoc?.researchAreas,
          })
      : undefined;
    let groundedShortDescription: string | null = null;
    if (writtenCard.followsWrittenBody) {
      delete set.shortDescription;
      delete set['fieldProvenance.shortDescription'];
      delete confidenceByField.shortDescription;
      const observedCards = resolveFieldRanked('shortDescription', resolverObs, {
        now: input.now,
        manuallyLockedFields,
        manualValues,
        descriptionEntityKind: descriptionEntityKindForResearchEntity(entityDoc),
      });
      const storedCard = textValue(entityDoc?.shortDescription);
      const writtenBodyResearchAreas = set.researchAreas ?? entityDoc?.researchAreas;
      const servingBarAccepts = (card: string) =>
        servingBarAcceptsWrittenBodyCard(
          entityDoc,
          set,
          fullDescription,
          card,
          input.nameIdentityAuthority.leadPersonName,
        );
      const cardEvidenceTexts = cardDescriptionEvidence(resolverObs);
      const storedCardIsTheBodyAsItsOwnCard =
        storedCard === fullDescription &&
        isAcceptableBodyAsItsOwnCard({
          body: fullDescription,
          researchAreas: writtenBodyResearchAreas,
          servingBarAccepts,
          evidenceTexts: cardEvidenceTexts,
        });
      const storedCardUnacceptable =
        !!storedCard &&
        !storedCardIsTheBodyAsItsOwnCard &&
        !isAcceptableWrittenBodyCard({
          card: storedCard,
          body: fullDescription,
          researchAreas: writtenBodyResearchAreas,
          servingBarAccepts,
          requireGrounding: true,
          evidenceTexts: cardEvidenceTexts,
        });
      const writtenBodyChanged =
        fullDescription !==
        sanitizeResearchEntityDescription(textValue(entityDoc?.fullDescription));
      const choice = await resolveWrittenBodyCard({
        body: fullDescription,
        storedCard,
        observedCards: observedCards.map((candidate) => candidate.value),
        researchAreas: writtenBodyResearchAreas,
        servingBarAccepts,
        evidenceTexts: cardEvidenceTexts,
        synthesize:
          writtenBodyChanged ||
          storedCardUnacceptable ||
          (input.resynthesizeCutCards &&
            !!storedCard &&
            !writtenBodyCardShowsWhole(storedCard, fullDescription)) ||
          (!!weakCardTest && !!storedCard && weakCardTest(storedCard))
            ? cardSynthesizer
            : undefined,
        isWeak: weakCardTest,
      });
      if (choice.kind === 'observed') {
        const candidate = observedCards[choice.index];
        set.shortDescription = choice.card;
        confidenceByField.shortDescription = candidate.confidence;
        const provenance = fieldProvenanceForResolvedObservation(
          'shortDescription',
          candidate,
          materializationObs,
        );
        if (provenance) set['fieldProvenance.shortDescription'] = provenance;
        fieldsWritten++;
      } else if (
        choice.kind === 'derived' ||
        choice.kind === 'synthesized' ||
        choice.kind === 'body'
      ) {
        groundedShortDescription = choice.card;
      } else if (choice.kind === 'none' && storedCardUnacceptable) {
        unset.shortDescription = '';
        unset['fieldProvenance.shortDescription'] = '';
        fieldsWritten++;
      }
    } else {
      const cardLocked = manuallyLockedFields.includes('shortDescription');
      const keepsStoredCard =
        !fullDescriptionShellGated &&
        !cardLocked &&
        storedCardOutranksCutCopiedCard({
          copiedCard: set.shortDescription,
          storedCard: entityDoc?.shortDescription,
          body: fullDescription,
          isProgramLike: isProgramLikeEntity,
        });
      if (keepsStoredCard) {
        delete set.shortDescription;
        delete set['fieldProvenance.shortDescription'];
        const storedCardConfidence = entityDoc?.confidenceByField?.shortDescription;
        if (typeof storedCardConfidence === 'number') {
          confidenceByField.shortDescription = storedCardConfidence;
        } else {
          delete confidenceByField.shortDescription;
        }
        fieldsWritten = Math.max(0, fieldsWritten - 1);
      }
      const copiedCard =
        fullDescriptionShellGated || cardLocked
          ? { card: null, changed: false }
          : methodCheckedCopiedCard(
              set.shortDescription ?? entityDoc?.shortDescription,
              fullDescription,
              cardDescriptionEvidence(resolverObs),
            );
      if (copiedCard.changed) {
        if (copiedCard.card) {
          if (!Object.hasOwn(set, 'shortDescription')) fieldsWritten++;
          set.shortDescription = copiedCard.card;
        } else {
          delete set.shortDescription;
          delete set['fieldProvenance.shortDescription'];
          delete confidenceByField.shortDescription;
        }
      }
      groundedShortDescription = await resolveMaterializedShortDescription({
        fullDescription,
        // When the single-PI-shell guard just rejected fullDescription in favor
        // of the entity's existing org-level value, shortDescription must be
        // re-derived from that corrected body rather than kept as-is: it may
        // still be the seed PI's own grant sentence and now contradicts the
        // fixed full (issue #1595).
        currentShortDescription: fullDescriptionShellGated
          ? undefined
          : copiedCard.changed
            ? (copiedCard.card ?? undefined)
            : (set.shortDescription ?? entityDoc?.shortDescription),
        reconsiderCurrentShortDescription:
          (keepsStoredCard
            ? isFullDescriptionRestatementOfShortDescription(
                fullDescription,
                textValue(entityDoc?.shortDescription),
              )
            : fullRestatesCurrentCard) ||
          (copiedCard.changed && !copiedCard.card),
        resynthesizeCutCards: input.resynthesizeCutCards,
        researchAreas: set.researchAreas ?? entityDoc?.researchAreas,
        isProgramLike: isProgramLikeEntity,
        manuallyLocked: cardLocked,
        synthesize: cardSynthesizer,
      });
      if (
        copiedCard.changed &&
        !copiedCard.card &&
        !groundedShortDescription &&
        textValue(entityDoc?.shortDescription)
      ) {
        unset.shortDescription = '';
        unset['fieldProvenance.shortDescription'] = '';
        fieldsWritten++;
      }
    }
    if (groundedShortDescription) {
      set.shortDescription = groundedShortDescription;
      const fullDescriptionConfidence = resolved.fullDescription?.confidence;
      if (typeof fullDescriptionConfidence === 'number') {
        confidenceByField.shortDescription = fullDescriptionConfidence;
      }
      const provenance =
        (set['fieldProvenance.fullDescription'] as Record<string, unknown> | undefined) ??
        (resolved.fullDescription
          ? fieldProvenanceForResolvedObservation(
              'fullDescription',
              resolved.fullDescription,
              materializationObs,
            )
          : undefined);
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
        derivedResearchAreas: input.derivedResearchAreas,
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
        storedEvidenceRetired: input.storedResearchAreasEvidenceRetired === true,
        derive:
          input.applyDescriptionResearchAreaDerivation ?? applyDescriptionResearchAreaDerivation,
        canonicalizeResearchAreas,
      });
      fieldsWritten += Number('researchAreas' in set) - Number(plannedResearchAreasBefore);
    }
    reconcileDerivedResearchAreaProvenance(set, unset, entityDoc);
    clearStaleResearchPageTopicsProvenance(
      set,
      unset,
      input.storedDerivedResearchAreasStale === true,
    );
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
        withObservedPersonPages(
          researchEntityIdentityWithCitationsThroughThisPass(
            sourceEntityIdentity,
            entityDoc?.sourceUrls,
            currentSourceUrls,
          ),
          observedPersonPageUrls,
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
      const citedNow = (): unknown[] =>
        Array.isArray(set.sourceUrls) ? (set.sourceUrls as unknown[]) : currentSourceUrls;
      const missingLeadProfiles = mergedInLeadProfileUrls.filter(
        (url) =>
          !isKnownDeadSourceUrl(entityDoc?.sourceLinkHealth, url) &&
          ![
            ...citedNow(),
            ...(Array.isArray(entityDoc?.sourceUrls) ? (entityDoc?.sourceUrls as unknown[]) : []),
          ].some((cited) => isRetiredProfilePathForSamePerson(url, cited)) &&
          !citedNow().some(
            (cited) =>
              typeof cited === 'string' &&
              normalizeOfficialProfileDestination(cited) ===
                normalizeOfficialProfileDestination(url),
          ),
      );
      const seenLeadProfileDestinations = new Set<string>();
      const distinctMissingLeadProfiles = missingLeadProfiles.filter((url) => {
        const destination = normalizeOfficialProfileDestination(url);
        if (seenLeadProfileDestinations.has(destination)) return false;
        seenLeadProfileDestinations.add(destination);
        return true;
      });
      if (distinctMissingLeadProfiles.length > 0) {
        stageSourceUrls(
          sanitizeResearchEntitySourceUrlsForMaterialization([
            ...citedNow(),
            ...distinctMissingLeadProfiles,
          ]),
        );
        fieldsWritten++;
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
    const clearLaneWithdrawnWebsite = (field: LaneWithdrawableWebsiteField) => {
      const clearsLaneWithdrawnWebsite = planLaneWithdrawnWebsiteUrlClear({
        field,
        stored: entityDoc,
        staged: set,
        withdrawnValues: laneWithdrawnWebsiteValues,
        lockedFields: manuallyLockedFields,
      });
      if (!clearsLaneWithdrawnWebsite) return;
      console.log(`[lane-refused-website-url] cleared a ${field} its own lane has since refused`);
      set[field] = '';
      fieldsWritten++;
    };
    clearLoserOnlySurvivorWebsite('website');
    clearLaneWithdrawnWebsite('website');
    const withheldLegacyWebsite = planWithheldLegacyWebsiteClear({
      stored: entityDoc,
      staged: set,
      identity: {
        name: set.name ?? entityDoc?.name,
        displayName: set.displayName ?? entityDoc?.displayName,
        entityType: set.entityType ?? entityDoc?.entityType,
        kind: set.kind ?? derivedKind ?? entityDoc?.kind,
        coreFacilityWebsiteKeys,
      },
      lockedFields: manuallyLockedFields,
    });
    if (withheldLegacyWebsite.skipped) {
      console.log(
        `[withheld-legacy-website] kept a withheld website: ${withheldLegacyWebsite.skipped}`,
      );
    }
    if (withheldLegacyWebsite.declineStaged) {
      console.log('[withheld-legacy-website] declined a resolved website the payload withholds');
      delete set.website;
    }
    if (withheldLegacyWebsite.clearStored) {
      console.log('[withheld-legacy-website] cleared a stored website the payload withholds');
      set.website = '';
      fieldsWritten++;
    }
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
        coreFacilityWebsiteKeys,
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
      clearLaneWithdrawnWebsite('websiteUrl');
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
      const promotedLaneWithdrawnWebsite =
        websiteResolution.action === 'set' &&
        isLaneWithdrawnWebsiteUrl(websiteResolution.websiteUrl, laneWithdrawnWebsiteValues);
      if (promotedLaneWithdrawnWebsite) {
        console.log(
          '[lane-refused-website-url] declined to promote a citation its own lane has since refused',
        );
      }
      const promotedValueIsRefused =
        promotedRowRefusal ||
        Boolean(promotedRuleRefusal) ||
        promotedLoserOwnedWebsite ||
        promotedLaneWithdrawnWebsite;
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
    const storedDescriptionClears = [
      ...planCollectivePageStoredDescriptionClears({
        stored: entityDoc,
        staged: set,
        lockedFields: manuallyLockedFields,
      }).map((clear) => ({
        clear,
        tag: 'collective-page-description',
        reason: 'narrated from a department page',
      })),
      ...planProfileTemplateChromeStoredDescriptionClears({
        stored: entityDoc,
        staged: set,
        lockedFields: manuallyLockedFields,
      }).map((clear) => ({
        clear,
        tag: 'profile-template-chrome-description',
        reason: 'that is profile template chrome',
      })),
    ];
    for (const { clear, tag, reason } of storedDescriptionClears) {
      if (clear.skipped) {
        console.log(`[${tag}] kept ${clear.field}: ${clear.skipped}`);
        continue;
      }
      if (set[clear.field] === '') continue;
      console.log(`[${tag}] cleared ${clear.field} ${reason}`);
      set[clear.field] = '';
      fieldsWritten++;
      if (clear.field === 'shortDescription') {
        const survivingBody = textValue(set.fullDescription ?? entityDoc?.fullDescription);
        const derivedCard = survivingBody
          ? deriveShortDescriptionFromFullDescription(survivingBody)
          : '';
        if (
          derivedCard &&
          !isFullDescriptionRestatementOfShortDescription(survivingBody, derivedCard) &&
          shortDescriptionQuality(derivedCard, survivingBody).isUseful
        ) {
          set.shortDescription = derivedCard;
          const bodyProvenance =
            set['fieldProvenance.fullDescription'] ?? entityDoc?.fieldProvenance?.fullDescription;
          if (bodyProvenance) set['fieldProvenance.shortDescription'] = bodyProvenance;
          else unset['fieldProvenance.shortDescription'] = '';
        }
      }
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
    if (!manuallyLockedFields.includes('sourceUrls')) {
      const citedThisPass = Array.isArray(set.sourceUrls)
        ? (set.sourceUrls as unknown[])
        : Array.isArray(entityDoc?.sourceUrls)
          ? (entityDoc?.sourceUrls as unknown[])
          : [];
      const projected = documentAsProjected(set, unset, entityDoc);
      const keptCitations = withoutUncreditedCreditOnlyCitations(
        citedThisPass,
        projected.fieldProvenance,
        projected,
      );
      if (keptCitations.length !== citedThisPass.length) {
        set.sourceUrls = keptCitations;
        fieldsWritten++;
      }
      const withoutFacilityPages = withoutCoreFacilityPagesOnPersonRow(keptCitations, {
        entityType: set.entityType ?? entityDoc?.entityType,
        kind: set.kind ?? derivedKind ?? entityDoc?.kind,
        coreFacilityWebsiteKeys,
      });
      if (withoutFacilityPages.length !== keptCitations.length) {
        console.log('[core-facility-citation] dropped a facility page from a person row');
        set.sourceUrls = withoutFacilityPages;
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
        leadPageDeparture: input.leadPageDeparture,
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
          withObservedPersonPages(
            researchEntityIdentityWithCitationsThroughThisPass(
              sourceEntityIdentity,
              entityDoc?.sourceUrls,
              currentSourceUrls,
            ),
            observedPersonPageUrls,
          ),
        );
        const projected = documentAsProjected(set, unset, entityDoc);
        const citableProvenanceSourceUrl =
          provenanceSourceUrl &&
          withoutUncreditedCreditOnlyCitations(
            [provenanceSourceUrl],
            projected.fieldProvenance,
            projected,
          )[0];
        if (citableProvenanceSourceUrl) {
          set.sourceUrls = sanitizeResearchEntitySourceUrlsForMaterialization([
            ...currentSourceUrls,
            citableProvenanceSourceUrl,
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
    for (const field of fieldsBackedByRefusedListings) {
      if (manuallyLockedFields.includes(field)) continue;
      if (field in set || field in unset) continue;
      if (fieldsWithLiveObservation.has(field)) continue;
      if (!isClearableStaleFieldValue((entityDoc as Record<string, unknown>)[field])) continue;
      console.log(`[merge-redirect-identity] cleared a ${field} only a refused listing backed`);
      delete set[`fieldProvenance.${field}`];
      unset[field] = '';
      unset[`fieldProvenance.${field}`] = '';
      delete confidenceByField[field];
    }
    for (const field of planGoneLanePageFieldClears({
      stored: entityDoc as Record<string, unknown>,
      staged: set,
      fieldsWithLiveObservation,
      withdrawnValuesByField: gonePageWithdrawnValuesByField,
      lockedFields: manuallyLockedFields,
      storedForm: (field, value) => sanitizeProjectedField(entityType, field, value),
    })) {
      console.log(`[lane-page-health] cleared a ${field} only a gone page's read backed`);
      delete set[field];
      delete set[`fieldProvenance.${field}`];
      unset[field] = '';
      delete confidenceByField[field];
    }
    const retiredEvidenceClears = input.readRowUnderOwnIdentity
      ? await planRetiredEvidenceFieldClears({
          stored: entityDoc as Record<string, unknown>,
          staged: set,
          unset,
          fieldsWithLiveObservation,
          lockedFields: manuallyLockedFields,
          storedForm: (field, value) => sanitizeProjectedField(entityType, field, value),
          mergedInRows: input.mergedInRows,
        })
      : [];
    for (const field of retiredEvidenceClears) {
      console.log(
        `[retired-evidence] cleared a ${field} whose every backing observation is retired`,
      );
      delete set[field];
      delete set[`fieldProvenance.${field}`];
      unset[field] = '';
      unset[`fieldProvenance.${field}`] = '';
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
    unset,
    lockedFields: manuallyLockedFields,
  });
  Object.assign(set, storedTextNormalization.set);

  if (entityType === 'fellowship') {
    for (const field of fellowshipFieldsWithheldBySourcePrecedence({
      stored: entityDoc as Record<string, unknown> | null,
      staged: set,
      resolved,
      fundSpeaksForRow: fundSpeaksForFellowship(entityDoc, newestFundTitle(materializationObs)),
      storedSourceUrlUnbacked: storedFellowshipSourceUrlIsUnbacked({
        stored: entityDoc as Record<string, unknown> | null,
        liveObservations: resolverObs,
        readRowUnderOwnIdentity: input.readRowUnderOwnIdentity === true,
      }),
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
    // Runs after the precedence stage, so a field that stage just withheld reads as
    // unstaged here and the clear decides on what the row will actually be left with,
    // and before the classifier, which reads `unset` as a cleared value (#4230).
    fellowshipAbsenceClears = planFellowshipAbsenceClears({
      stored: entityDoc as Record<string, unknown> | null,
      staged: set,
      resolvedFields: Object.keys(resolved),
      absentByField: fellowshipAbsentByField,
      withheldBySourcePrecedence: (_field, assertedBy) =>
        fellowshipAbsenceClearWithheldBySourcePrecedence({
          stored: entityDoc as Record<string, unknown> | null,
          assertedBy,
        }),
    });
    for (const clear of fellowshipAbsenceClears) {
      unset[clear.field] = '';
      delete confidenceByField[clear.field];
      fieldsWritten++;
    }
    fellowshipUnbackedClears = planFellowshipUnbackedFieldClears({
      stored: entityDoc as Record<string, unknown> | null,
      staged: set,
      unset,
      liveObservedFields: new Set(resolverObs.map((o) => o.field)),
      fieldsStatedByCitedFunds: input.fellowshipFieldsStatedByCitedFunds ?? new Set(),
      readRowUnderOwnIdentity: input.readRowUnderOwnIdentity === true,
    });
    for (const field of fellowshipUnbackedClears) {
      unset[field] = '';
      delete confidenceByField[field];
      fieldsWritten++;
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
    for (const field of PROGRAM_GATE_DERIVED_FIELDS) {
      if (field in set || field in unset) fieldsWritten = Math.max(0, fieldsWritten - 1);
      delete set[field];
      delete set[`fieldProvenance.${field}`];
      delete unset[field];
      delete confidenceByField[field];
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
        mergedInRows: input.mergedInRows,
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
        mergedInRows: input.mergedInRows,
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
    ...(fellowshipAbsenceClears.length > 0 ? { fellowshipAbsenceClears } : {}),
    ...(fellowshipUnbackedClears.length > 0 ? { fellowshipUnbackedClears } : {}),
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

/**
 * Resolve-at-mint runs no lead-person clustering, so a row reached only through a
 * recorded redirect is a candidate only when it names the same lab or the same lead as
 * the mint. A retired page that redirects to another host's root otherwise folds a mint
 * into whatever row serves that root (#5638).
 */
function redirectCandidateAgreesOnName(
  self: CandidateEntity | undefined,
  candidateName: string | undefined,
): boolean {
  const selfName = (self?.name ?? '').trim();
  const otherName = (candidateName ?? '').trim();
  if (!selfName || !otherName) return false;
  const selfOrgName = normalizeOrgDedupeName(selfName);
  if (selfOrgName && selfOrgName === normalizeOrgDedupeName(otherName)) return true;
  return entitiesShareLeadPersonName(
    { name: selfName } as Parameters<typeof entitiesShareLeadPersonName>[0],
    { name: otherName } as Parameters<typeof entitiesShareLeadPersonName>[1],
  );
}

/**
 * Resolve-at-mint cannot compare lead researcher ids, because a mint has no lead edges
 * yet, so the redirect arm never folds a person-led row, on either side; the website-url
 * dedupe lane, which refuses distinct leads (#5684), decides those once edges exist. A
 * missed fold there is recovered on the next pass, a wrong one is not (#5688).
 */
function firstStatedText(obs: Array<{ field: string; value?: unknown }>, field: string): string {
  const hit = obs.find((o) => o.field === field && typeof o.value === 'string' && o.value.trim());
  return hit ? String(hit.value).trim() : '';
}

function mintIsPersonLed(
  obs: Array<{ field: string; value?: unknown }>,
  entityKey: string | undefined,
): boolean {
  const entityType = firstStatedText(obs, 'entityType');
  const kind = firstStatedText(obs, 'kind');
  if (entityType || kind) return isPersonScopedResearchEntityShape({ entityType, kind });
  return entityKeyPersonTokens(firstStatedText(obs, 'slug') || entityKey).length > 0;
}

const FACULTY_RESEARCH_KINDS: ReadonlySet<string> = new Set(['individual', 'solo']);

function isFacultyResearchShape(shape: { entityType?: unknown; kind?: unknown }): boolean {
  const entityType = textValue(shape.entityType);
  if (entityType) {
    return (
      entityType === CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE ||
      isLegacyFacultyResearchEntityType(entityType)
    );
  }
  return FACULTY_RESEARCH_KINDS.has(textValue(shape.kind).toLowerCase());
}

/**
 * A lab or organization stated by its own observations is never folded into a faculty
 * research row through a shared website, whatever the recorded verdicts say: the row is one
 * person's own, and a shared lab site folded into it carried the other co-lead's edge onto it
 * (#5979). The lab mints its own row instead.
 */
function mintStatesNonFacultyResearchShape(
  obs: Array<{ field: string; value?: unknown }>,
): boolean {
  const entityType = firstStatedText(obs, 'entityType');
  const kind = firstStatedText(obs, 'kind');
  if (!entityType && !kind) return false;
  return !isFacultyResearchShape({ entityType, kind });
}

async function findEntityCandidatesByKey(
  resolverType: 'researchEntity' | 'fellowship',
  key: CanonicalKey,
  prefetch?: MaterializationReadSource,
  self?: CandidateEntity,
  mintPersonLed = false,
  mintIsNotFacultyResearch = false,
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
    const directVariants = websiteUrlIdentityKeyVariants(key.value);
    if (directVariants.length === 0) return [];
    type WebsiteCandidateDoc = {
      _id: unknown;
      name?: string;
      studentVisibilityTier?: string;
      entityType?: string;
      kind?: string;
    };
    const select = '_id name studentVisibilityTier entityType kind';
    const direct = (await ResearchEntity.find({
      websiteUrl: { $in: directVariants },
      archived: { $ne: true },
    })
      .select(select)
      .limit(2)
      .lean()) as WebsiteCandidateDoc[];
    if (mintIsNotFacultyResearch && direct.some(isFacultyResearchShape)) return [];
    const redirectVariants =
      direct.length > 0 || mintPersonLed
        ? []
        : (await websiteUrlIdentityKeyRedirectEquivalents(key.value)).flatMap(
            websiteUrlIdentityKeyVariants,
          );
    const redirected =
      redirectVariants.length === 0
        ? []
        : ((await ResearchEntity.find({
            websiteUrl: { $in: redirectVariants },
            entityType: { $nin: [...ORG_NAME_DEDUPE_ENTITY_TYPES] },
            archived: { $ne: true },
          })
            .select(select)
            .limit(2)
            .lean()) as WebsiteCandidateDoc[]);
    const docs =
      direct.length > 0
        ? direct
        : redirected.filter(
            (doc) =>
              !isPersonScopedResearchEntityShape(doc) &&
              redirectCandidateAgreesOnName(self, doc.name),
          );
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
  entityKey?: string,
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
  const resolverSelf = buildEntityResolverSelf(obs);
  const resolution = await resolveCanonical(
    { type: resolverType, keys, self: resolverSelf },
    {
      findCandidatesByKey: (_type, key) =>
        findEntityCandidatesByKey(
          resolverType,
          key,
          prefetch,
          resolverSelf,
          mintIsPersonLed(obs, entityKey),
          mintStatesNonFacultyResearchShape(obs),
        ),
    },
  );
  if (
    resolution.status === 'existing' &&
    resolverType === 'researchEntity' &&
    (await mintAdoptionJoinsDistinctPeople(obs, resolution.canonicalId, resolverSelf.name ?? ''))
  ) {
    return { status: 'mint', reservedKeys: [] };
  }
  return resolution;
}

/** Lead researcher ids a not-yet-minted row's own lead observations name. */
export async function leadPersonIdsFromLeadObservations(
  obs: ReadonlyArray<{ field: string; value?: unknown; sourceName?: string }>,
  entityName: string,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const observation of obs) {
    if (observation.field !== 'inferredPiUserId') continue;
    const id = normalizeMaterializerObjectId(String(observation.value ?? '').trim());
    if (id) ids.add(String(id));
  }
  for (const observation of obs) {
    if (observation.field !== 'inferredPiUserKey') continue;
    if (
      inferredPiKeyNamesRoleOrUnitMailbox(
        userEntityKeyForInferredPiUserKey(observation.value),
        observation as MaterializerObservationLike,
      )
    ) {
      continue;
    }
    const resolved = await resolveInferredPiUserKey(observation.value, async () => entityName);
    if (resolved.status === 'matched' && resolved.researcherId) {
      ids.add(String(resolved.researcherId));
    }
  }
  return [...ids];
}

async function mintAdoptionJoinsDistinctPeople(
  obs: ReadonlyArray<{ field: string; value?: unknown }>,
  canonicalId: string,
  entityName: string,
): Promise<boolean> {
  const verdicts = await loadDistinctPeopleVerdictIndex();
  if (verdicts.size === 0) return false;
  const mintLeads = await leadPersonIdsFromLeadObservations(obs, entityName);
  if (mintLeads.length === 0) return false;
  const canonicalLeads = (await loadCurrentLeadPersonIdsByEntity([canonicalId])).get(canonicalId);
  return (
    distinctPeopleVerdictPairsJoinedByFold([mintLeads, canonicalLeads ?? []], verdicts).length > 0
  );
}

export function materializeEntity(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  return withoutModelCalls('materializeEntity', () =>
    materializeEntityWithoutModelCalls(entityType, identifier, options),
  );
}

async function materializeEntityWithoutModelCalls(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const { value: result, failedEntityIds } = await withResearcherSearchInputResync(() =>
    withDirectoryRemovalMintGuard(() =>
      materializeEntityUnderRemovalGuard(entityType, identifier, options),
    ),
  );
  if (failedEntityIds.length === 0) return result;
  return {
    ...result,
    otherIndexSyncFailedEntityIds: [
      ...new Set([...(result.otherIndexSyncFailedEntityIds ?? []), ...failedEntityIds]),
    ],
  };
}

async function materializeEntityUnderRemovalGuard(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  // Structural, not a convention: a projection derived with locks ignored reaching
  // the write below is exactly the silent unfreeze that re-opening a lock is a
  // separate reviewed operation to prevent (#2612).
  if (options.treatArchivedResearchEntitiesAsAbsent && !options.dryRun) {
    throw new Error('materializeEntity treatArchivedResearchEntitiesAsAbsent requires dryRun');
  }
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
    const { kept: userObs, screenedPageUrls } =
      await screenDirectoryContradictedProfileEvidenceForKey(identifier.entityKey, obs);
    const withdrawal = await withdrawScreenedOfficialProfileLinks(
      identifier.entityKey,
      screenedPageUrls,
      options,
    );
    const withdrawnLinks = withdrawal.written;
    const scoped = Boolean(userWriteScope(options));
    if (userObs.length === 0) {
      return {
        entityType,
        ...identifier,
        fieldsWritten: withdrawnLinks,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'directory-contradicts-profile-netid',
        ...(scoped
          ? { plannedPaths: withdrawal.plannedPaths, droppedPaths: withdrawal.droppedPaths }
          : {}),
      };
    }
    const result = await materializeUserIdentityToResearcher(identifier, userObs, options);
    const merged = scoped ? withScreenedWithdrawalPaths(result, withdrawal) : result;
    return withdrawnLinks
      ? { ...merged, fieldsWritten: merged.fieldsWritten + withdrawnLinks }
      : merged;
  }

  if (entityType === 'orgUnit') {
    // An org-unit observation has no materialized form since #4637, and it
    // deliberately does not reach `entityModelFor`: OrgUnit is an ingest-time
    // canonical lookup table, and writing scraped prose into it would make the
    // department pill a scraped value.
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      postMaterializationMetrics: {
        entryPathways: 0,
        accessSignals: 0,
        contactRoutes: 0,
        postedOpportunities: 0,
        guardedContactRoutes: 0,
        staleEvidenceSkipped: 0,
        conflicts: 0,
        errors: 0,
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
  let renamedFromKey: string | undefined;
  if (isResearchEntityObservationType(entityType) && !entityDoc && !identifier.entityId) {
    const renamed = await liveResearchEntityNamedByKeyObservations(identifier.entityKey);
    if (renamed?._id) entityDoc = await Model.findById(renamed._id).lean();
    if (entityDoc) renamedFromKey = identifier.entityKey;
  }
  if (
    entityDoc?.archived === true &&
    options.treatArchivedResearchEntitiesAsAbsent?.has(String(entityDoc._id))
  ) {
    entityDoc = null;
    entityIdString = undefined;
  }
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
    const refusedRedirect =
      tombstoneCanonical &&
      (await mergedRedirectRefusedListings(
        tombstoneCanonical,
        [entityDoc],
        [
          ...(await observationsFiledUnderSurvivor(
            entityType,
            tombstoneCanonical,
            options.chunkPrefetch,
          )),
          ...obs,
        ],
      ));
    if (refusedRedirect && obs.every((observation: any) => refusedRedirect.refuses(observation))) {
      return {
        entityType,
        entityId: materializerDocumentId(entityDoc._id),
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'merge-redirect-identity-refused',
      };
    }
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
        await archiveResearchEntities({
          ids: [entityDoc._id],
          archivedReason: PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON,
        });
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

  if (isResearchEntityObservationType(entityType) && entityDoc?.archived === true) {
    return {
      entityType,
      entityId: materializerDocumentId(entityDoc._id),
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'archived-research-entity',
    };
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
    const resolution = await resolveCanonicalForEntityMint(
      entityType,
      obs,
      options.chunkPrefetch,
      identifier.entityKey,
    );
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
  let fieldsBackedByRefusedListings: string[] = [];
  let mergedInLeadProfileUrls: string[] = [];
  let loserRosterReads: ResolverObservation[] = [];
  let survivorReadOnARoster = false;
  if (isResearchEntityObservationType(entityType) && entityDoc && entityDoc.archived !== true) {
    const merged = await mergedSurvivorEvidence(entityType, entityDoc, obs, options.chunkPrefetch);
    obs = merged.observations;
    mergedInKeys = merged.mergedInKeys;
    mergedInRows = merged.mergedInRows;
    researchAreaEvidenceObservations = merged.evidenceObservations;
    droppedLoserWebsiteValues = merged.droppedLoserWebsiteValues;
    fieldsBackedByRefusedListings = merged.fieldsBackedByRefusedListings;
    mergedInLeadProfileUrls = await mergedInLeadProfileSourceUrls(
      entityDoc._id,
      merged.mergedInSourceUrlValues,
    );
    loserRosterReads = merged.loserRosterAppointments.map((o: any) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
      scrapeRunId: o.scrapeRunId,
    }));
    survivorReadOnARoster = merged.survivorReadOnARoster;
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
  let siteSharedPageNames: ReadonlySet<string> = new Set<string>();
  if (isResearchEntityObservationType(entityType) && entityDoc) {
    const rowKeyedObs = withoutForeignContactObservations(obs, {
      _id: entityDoc._id,
      slug: entityDoc.slug,
      renamedFromKey,
    });
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

  if (isResearchEntityObservationType(entityType) && entityDoc) {
    const siteSharedPageNameWithdrawal = await withoutSiteSharedPageNames(
      withoutCoursePageEvidence(withoutPersonProfileTopicsOnOrganizationRow(obs, entityDoc)),
      entityDoc,
      options.chunkPrefetch,
    );
    obs = siteSharedPageNameWithdrawal.observations;
    siteSharedPageNames = siteSharedPageNameWithdrawal.withdrawnNames;
    researchAreaEvidenceObservations = withoutCoursePageEvidence(
      withoutPersonProfileTopicsOnOrganizationRow(researchAreaEvidenceObservations, entityDoc),
    );
  }

  const accessPassObservations =
    mergedInKeys.length > 0 || foreignContactWithheld ? (obs as AccessObservation[]) : undefined;
  if (options.accessSignalsOnly && isResearchEntityObservationType(entityType) && entityIdString) {
    const accessResult = await materializeAccessForResearchGroup(
      { researchEntityId: entityIdString, entityKey: identifier.entityKey },
      accessPassObservations,
      { dryRun: options.dryRun },
    );
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      ...(accessResult.skipped ? { skipped: accessResult.skipped } : {}),
      ...(accessResult.changes ? { accessSignalChanges: accessResult.changes } : {}),
    };
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

  const rowEvidenceIdentity = mergedRowEvidenceIdentity(entityDoc ?? {}, mergedInRows);
  const undergradEvidenceQuoteWithdrawnBy = isResearchEntityObservationType(entityType)
    ? sourcesWithdrawingUndergradEvidenceQuote(obs, entityDoc)
    : new Set<string>();
  // A lane's claim that a field has no value withdraws that lane's own live
  // assertions of it before anything resolves, so a rival lane's value still wins the
  // field and only a field nothing states at all reaches the clear (#4230).
  const fellowshipAbsentByField =
    entityType === 'fellowship'
      ? fellowshipFieldsAssertedAbsent(obs)
      : new Map<string, Set<string>>();
  const laneScopedRowIdentities = new Set(
    [entityIdString, identifier.entityKey, identifier.entityId, textValue(entityDoc?.slug)]
      .map((value) => String(value || ''))
      .filter(Boolean),
  );
  const gonePageWithdrawal =
    isResearchEntityObservationType(entityType) || entityType === 'fellowship'
      ? withoutGoneLanePageObservations(obs, laneScopedRowIdentities)
      : { observations: obs, withdrawnValuesByField: new Map<string, unknown[]>() };
  const profileHomeOrganizationClaims = isResearchEntityObservationType(entityType)
    ? profileHomeOrganizationClaimKeys(gonePageWithdrawal.observations)
    : new Set<string>();
  const personRowOrganizationClaims =
    profileHomeOrganizationClaims.size > 0 &&
    entityDoc &&
    isPersonRowForProfileHomeClaims(
      {
        slug: entityDoc.slug,
        leadPersonName:
          options.nameIdentityAuthority?.leadPersonName ??
          (await loadResearchEntityLeadPersonName(entityDoc._id ?? entityIdString)),
      },
      gonePageWithdrawal.observations,
    )
      ? profileHomeOrganizationClaims
      : new Set<string>();
  const laneWebsiteWithdrawal = isResearchEntityObservationType(entityType)
    ? withoutLaneRefusedWebsiteUrls(
        withoutLaneRefusedResearchHomeNames(
          withoutPersonRowOrganizationHomeClaims(
            gonePageWithdrawal.observations,
            personRowOrganizationClaims,
          ),
          laneScopedRowIdentities,
        ),
        laneScopedRowIdentities,
      )
    : { observations: obs, withdrawnValues: [] };
  const coreFacilityWebsiteKeys = isResearchEntityObservationType(entityType)
    ? await coreFacilityWebsiteKeysForMaterialization()
    : new Set<string>();
  const fellowshipEvidence =
    entityType === 'fellowship'
      ? preferFundFacetObservations(
          gonePageWithdrawal.observations,
          await fundFacetObservationsCitedBy(
            entityDoc ?? fellowshipCitationsObservedIn(obs),
            options.chunkPrefetch,
          ),
        )
      : laneWebsiteWithdrawal.observations;
  const materializationObs = collapseLatestWins(
    withoutFellowshipFieldsAssertedAbsent(
      withoutWithdrawnUndergradEvidenceQuotes(
        withoutUnpairedProfileHomeIdentity(
          withoutCoreFacilityCitationsOnPersonRow(
            fellowshipEvidence.filter(
              (o: any) => !shouldIgnoreObservationForEntityMaterialization(entityType, o),
            ),
            { entityType: entityDoc?.entityType, kind: entityDoc?.kind },
            coreFacilityWebsiteKeys,
          ),
          entityDoc?.fieldValueRefusals,
        ),
        undergradEvidenceQuoteWithdrawnBy,
      ),
      fellowshipAbsentByField,
    ),
    entityType,
    (observation: any) =>
      evidenceMemberOf(rowEvidenceIdentity, observation) ?? rowEvidenceIdentity.rowMember,
  );

  if (options.leadEdgesOnly && isResearchEntityObservationType(entityType)) {
    if (!entityDoc || !entityIdString) {
      return {
        entityType,
        ...identifier,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved: {},
        skipped: 'no-row-keyed-evidence',
      };
    }
    const piResolution = await resolveLeadEdges(entityIdString, materializationObs, {
      apply: !options.dryRun,
    });
    const leadEdgeResolution: LeadEdgeResolution = {
      ...piResolution,
      asserted: [
        ...piResolution.asserted,
        ...(await resolveDirectorLeadEdge(entityIdString, materializationObs, {
          apply: !options.dryRun,
        })),
      ],
    };
    let leadEdgeIndexStale = false;
    if (!options.dryRun) {
      try {
        const browseRank = await recomputeBrowseRankForEntities([entityIdString]);
        leadEdgeIndexStale =
          browseRank.updated > 0 &&
          browseRank.indexSyncFailures + (browseRank.indexSyncDeferred ?? 0) > 0;
      } catch (error) {
        console.error(
          'Failed to recompute browseRankScore:',
          sanitizeLogValue({ entityId: entityIdString, error }),
        );
        leadEdgeIndexStale = true;
      }
    }
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      leadEdgeResolution,
      ...(leadEdgeIndexStale ? { indexSyncFailed: true as const } : {}),
    };
  }

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
    undefined,
    isResearchEntityObservationType(entityType)
      ? {
          websiteUrl: entityDoc?.websiteUrl,
          entityType: entityDoc?.entityType,
          kind: entityDoc?.kind,
        }
      : undefined,
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

  const collectivePageScreened = ownershipScreen.kept.filter(
    (o: any) => !isLlmDescriptionFromDepartmentCollectivePage(o, entityDoc?.name),
  );
  if (collectivePageScreened.length < ownershipScreen.kept.length) {
    console.log(
      `[description-collective-page] ${entityType} ${entityIdString || identifier.entityKey || ''}: dropped ${
        ownershipScreen.kept.length - collectivePageScreened.length
      } model-written description candidate(s) citing a department page`,
    );
  }

  const namesakeScreened =
    isResearchEntityObservationType(entityType) &&
    isPersonResearchRow({ entityType: entityDoc?.entityType, kind: entityDoc?.kind })
      ? withoutNamesakePersonPageDescriptions(
          collectivePageScreened,
          {
            slug: textValue(entityDoc?.slug),
            name: textValue(entityDoc?.name),
            displayName: textValue(entityDoc?.displayName),
            sourceUrls: Array.isArray(entityDoc?.sourceUrls) ? entityDoc.sourceUrls : [],
          },
          obs,
        )
      : collectivePageScreened;
  if (namesakeScreened.length < collectivePageScreened.length) {
    console.log(
      `[description-namesake-page] ${entityType} ${entityIdString || identifier.entityKey || ''}: dropped ${
        collectivePageScreened.length - namesakeScreened.length
      } description candidate(s) citing a namesake's person page`,
    );
  }

  // Read off `obs`, because the set the projection reads has already dropped the page text.
  // When the code lane's topic hand-off (#5418, held) re-lands, it must screen
  // `namesakeScreened` before the derived candidate is appended here, so the hand-off
  // can never drop it.
  const researchPageTopics = isResearchEntityObservationType(entityType)
    ? await researchPageTopicsStateFor(
        obs,
        loadResearchTopicsDerivation,
        storedResearchAreasProvenance(entityDoc),
      )
    : {};
  const derivedResearchAreas = researchPageTopics.candidate;
  const storedDerivedResearchAreasStale = storedDerivedResearchAreasAreStale(
    storedResearchAreasProvenance(entityDoc),
    researchPageTopics,
  );
  const isPersonResearchEntityRow =
    isResearchEntityObservationType(entityType) &&
    isPersonResearchRow({ entityType: entityDoc?.entityType, kind: entityDoc?.kind });
  const micrositeLeadName = isPersonResearchEntityRow
    ? (options.nameIdentityAuthority?.leadPersonName ??
      (await loadResearchEntityLeadPersonName(entityDoc?._id ?? entityIdString)))
    : '';
  const micrositeLeadNames = micrositeLeadName ? [micrositeLeadName] : [];
  const grantEvidence = isResearchEntityObservationType(entityType)
    ? await researchEntityGrantEvidence(entityIdString, materializationObs)
    : undefined;
  const micrositeLeadGrantAwardRecordKeys = leadGrantAwardRecordKeys(grantEvidence?.recentGrants);
  const micrositeOwnershipScreened = isPersonResearchEntityRow
    ? withoutRefusedNonYaleMicrositePageFields(
        withoutRefusedNonYaleMicrositeDescriptions(
          namesakeScreened,
          micrositeLeadNames,
          obs,
          micrositeLeadGrantAwardRecordKeys,
        ),
        micrositeLeadNames,
        obs,
        micrositeLeadGrantAwardRecordKeys,
      )
    : namesakeScreened;
  if (micrositeOwnershipScreened.length < namesakeScreened.length) {
    console.log(
      `[description-microsite-ownership] ${entityType} ${entityIdString || identifier.entityKey || ''}: dropped ${
        namesakeScreened.length - micrositeOwnershipScreened.length
      } lab-site candidate(s) citing a non-Yale page not confirmed as the lead's`,
    );
  }

  const resolverObs: ResolverObservation[] = [
    ...withoutObservedAdviseesMovedToMentors(
      micrositeOwnershipScreened.map((o: any) => ({
        field: o.field,
        value: o.value,
        sourceName: o.sourceName,
        confidence: o.confidence,
        observedAt: o.observedAt,
        scrapeRunId: o.scrapeRunId,
      })),
    ),
    ...(derivedResearchAreas ? [resolverObservationOfDerivedCandidate(derivedResearchAreas)] : []),
  ];

  // A refusal removes one VALUE from consideration, never the field, so whatever
  // rivals remain still resolve normally and a field whose every candidate is
  // refused resolves to nothing. That is the retraction a repair was reaching for
  // when it wrote a lock instead (#3167).
  const rawRefusalScreen = refusedResolverObservations(resolverObs, entityDoc?.fieldValueRefusals);
  const refusalScreen = {
    ...rawRefusalScreen,
    kept: isPersonResearchRow({ entityType: entityDoc?.entityType, kind: entityDoc?.kind })
      ? withLabSiteDescriptionsNarrowedToResearch(rawRefusalScreen.kept)
      : rawRefusalScreen.kept,
  };
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
  if (grantEvidence) {
    if (grantEvidence.recentGrants && resolved.recentGrants) {
      resolved.recentGrants.value = grantEvidence.recentGrants;
    }
    if (grantEvidence.recentGrantPeriods && resolved.recentGrantPeriods) {
      resolved.recentGrantPeriods.value = grantEvidence.recentGrantPeriods;
    }
    if (grantEvidence.recentGrantCount !== undefined && resolved.recentGrantCount) {
      resolved.recentGrantCount.value = grantEvidence.recentGrantCount;
    }
    if (grantEvidence.fundingAgencies !== undefined && resolved.fundingAgencies) {
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
      Boolean(renamedFromKey) ||
      (Boolean(identifier.entityKey) &&
        identifier.entityKey ===
          textValue(entityType === 'fellowship' ? entityDoc?.sourceKey : entityDoc?.slug)) ||
      (Boolean(identifier.entityId) && identifier.entityId === entityIdString));
  const researchAreasHaveNoLiveEvidence =
    isResearchEntityObservationType(entityType) &&
    readRowUnderOwnIdentity &&
    !storedResearchAreasCreditedToStandingDerivation(entityDoc, storedDerivedResearchAreasStale) &&
    (await storedResearchAreasHaveNoLiveEvidence({
      entityDoc,
      mergedInRows,
      observations: researchAreaEvidenceObservations,
      manuallyLockedFields,
    }));
  const storedResearchAreasEvidenceRetired =
    researchAreasHaveNoLiveEvidence &&
    (storedDerivedResearchAreasStale ||
      storedResearchAreasCameFromAPersonProfileOnAnOrganizationRow(entityDoc) ||
      storedFieldIsCreditedToACoursePage(entityDoc, 'researchAreas') ||
      (await storedResearchAreasSourceRetiredItsClaim(entityDoc, mergedInRows)));

  const leadPageDeparture =
    isResearchEntityObservationType(entityType) && entityDoc?._id
      ? await loadResearchEntityLeadPageDeparture(String(entityDoc._id), options.now ?? new Date())
      : undefined;
  const projection = await projectFromLog(entityType, {
    leadPageDeparture,
    resolved,
    nameIdentityAuthority,
    manuallyLockedFields,
    manualValues,
    entityDoc,
    materializationObs,
    coreFacilityWebsiteKeys,
    observedPersonPageUrls: everyCitedPersonPageUrl(obs),
    // Every re-rank walk in the projection reads these, so they are the refusal-screened
    // set the resolver itself read: a walk over the unscreened set can adopt a value this
    // row refuses, which the #3438 clear then blanks over an admissible rival (#3884).
    resolverObs: refusalScreen.kept,
    derivedResearchAreas,
    storedDerivedResearchAreasStale,
    fullDescriptionShellGated,
    undergradEvidenceQuoteWithdrawnBy,
    fellowshipFieldsAssertedAbsent: fellowshipAbsentByField,
    droppedLoserWebsiteValues,
    fieldsBackedByRefusedListings,
    mergedInLeadProfileUrls,
    laneWithdrawnWebsiteValues: laneWebsiteWithdrawal.withdrawnValues,
    gonePageWithdrawnValuesByField: gonePageWithdrawal.withdrawnValuesByField,
    siteSharedPageNames,
    loserRosterReads,
    survivorReadOnARoster,
    rosterPersonKeys: researchAreaEvidenceObservations
      .filter((observation: any) => observation.field === 'inferredPiUserKey')
      .map((observation: any) => observation.value),
    chunkPrefetch: options.chunkPrefetch,
    mergedInRows,
    now: projectionNow,
    synthesizeCardDescription: options.synthesizeCardDescription,
    resynthesizeCutCards: options.resynthesizeCutCards,
    resynthesizeWeakCards: options.resynthesizeWeakCards,
    cardModel: options.cardModel,
    writeOnlyFields: options.writeOnlyFields,
    provenanceOnly: options.onlyReconcileFieldProvenance,
    readRowUnderOwnIdentity,
    fellowshipFieldsStatedByCitedFunds:
      entityType === 'fellowship' && readRowUnderOwnIdentity
        ? await evidenceOnlyFieldsStatedByFundsCitedBy(entityDoc, options.chunkPrefetch)
        : undefined,
    researchAreasHaveNoLiveEvidence,
    storedResearchAreasEvidenceRetired,
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
  const reportedProjectionOutcomes = {
    ...(projection.unbackedResearchAreas
      ? { unbackedResearchAreas: projection.unbackedResearchAreas }
      : {}),
    ...(projection.fellowshipAbsenceClears
      ? { fellowshipAbsenceClears: projection.fellowshipAbsenceClears }
      : {}),
    ...(projection.fellowshipUnbackedClears
      ? { fellowshipUnbackedClears: projection.fellowshipUnbackedClears }
      : {}),
  };

  const entityScalarUnchanged =
    Boolean(entityDoc) &&
    isMaterializerProjectionNoOp(
      entityDoc as Record<string, unknown>,
      set,
      unset,
      Object.keys(Model.schema?.paths ?? {}),
    );

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
      ...(entityScalarUnchanged ? { plannedWriteSkip: plannedWriteSkipReason(set, unset) } : {}),
      ...reportedProjectionOutcomes,
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
      ...reportedProjectionOutcomes,
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
        ...reportedProjectionOutcomes,
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
    if (
      isResearchEntityObservationType(entityType) &&
      (await reslugAdoptedKeyNamesOnlyArchivedRows(identifier.entityKey))
    ) {
      return {
        entityType,
        entityId: undefined,
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved,
        skipped: 'reslug-adopted-key-names-only-archived-rows',
      };
    }
    if (
      isResearchEntityObservationType(entityType) &&
      ((await facultyResearchProfileMintIsRemovedByRequest(insert, materializationObs)) ||
        (await researchEntityMintSlugNamesARemovedResearcher(keyValue)))
    ) {
      return {
        entityType,
        entityId: undefined,
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved,
        skipped: REMOVED_BY_REQUEST,
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
  const otherIndexSyncFailedEntityIds: string[] = [];
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
          accessPassObservations,
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
        if (browseRank.updated > 0) {
          indexStale = browseRank.indexSyncFailures + (browseRank.indexSyncDeferred ?? 0) > 0;
        }
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
    if (fold.canonicalIndexSyncFailed && fold.canonicalEntityId) {
      otherIndexSyncFailedEntityIds.push(fold.canonicalEntityId);
    }
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
    ...reportedProjectionOutcomes,
    ...(indexStale ? { indexSyncFailed: true as const } : {}),
    ...(otherIndexSyncFailedEntityIds.length > 0 ? { otherIndexSyncFailedEntityIds } : {}),
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
    const entity: any =
      (await ResearchEntity.findOne({
        slug: snapshotObservation.entityKey,
        archived: { $ne: true },
      })
        .select('_id')
        .lean()) ?? (await liveResearchEntityNamedByKeyObservations(snapshotObservation.entityKey));
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

const liveOtherSourceObservations = (filter: Record<string, unknown>, sourceName: string) =>
  Observation.find({
    ...filter,
    ...materializationReadScopeFilter(),
    sourceName: { $ne: sourceName },
  })
    .select('entityKey field value sourceName observedAt confidence sourceUrl')
    .lean() as Promise<any[]>;

async function centerMembershipKeysAssertedByOtherSources(
  centerEntityKey: string,
  sourceName: string,
): Promise<Set<string>> {
  const slugRows = await liveOtherSourceObservations(
    {
      entityType: 'researchGroupMember',
      field: RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD,
      value: centerEntityKey,
    },
    sourceName,
  );
  const memberKeys = uniqueStrings(slugRows.map((row) => textValue(row.entityKey)));
  if (memberKeys.length === 0) return new Set();
  const rows = await liveOtherSourceObservations(
    {
      entityType: 'researchGroupMember',
      entityKey: { $in: memberKeys },
      field: {
        $in: ['profileUrl', 'role', 'identityKey', 'membershipKey', 'title', 'profileTitle'],
      },
    },
    sourceName,
  );
  const bySourceAndKey = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const group = `${textValue(row.sourceName)}\u0000${textValue(row.entityKey)}`;
    const fields = bySourceAndKey.get(group) ?? {};
    fields[textValue(row.field)] = textValue(row.value);
    bySourceAndKey.set(group, fields);
  }
  const keys = new Set<string>();
  for (const fields of bySourceAndKey.values()) {
    const role = screenedRosterRole(normalizeMemberRole(fields.role), [
      fields.title,
      fields.profileTitle,
    ]);
    const identityKey = fields.identityKey || officialProfileIdentityKey(fields.profileUrl || '');
    const membershipKey = fields.membershipKey || rosterMembershipKey(identityKey, role);
    if (membershipKey) keys.add(membershipKey);
  }
  return keys;
}

async function centerPersonRolesAssertedByOtherSources(
  centerEntityKey: string,
  sourceName: string,
): Promise<Set<string>> {
  const rows = await liveOtherSourceObservations(
    {
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
    },
    sourceName,
  );
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
  sourceName: string,
): Promise<Set<string>> {
  const sourceRows = await liveOtherSourceObservations(
    {
      entityType: 'researchEntityRelationship',
      field: 'sourceEntityKey',
      value: centerEntityKey,
    },
    sourceName,
  );
  const relationshipKeys = uniqueStrings(sourceRows.map((row) => textValue(row.entityKey)));
  if (relationshipKeys.length === 0) return new Set();
  const targetRows = await liveOtherSourceObservations(
    {
      entityType: 'researchEntityRelationship',
      entityKey: { $in: relationshipKeys },
      field: {
        $in: [
          'targetEntityKey',
          RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
          RELATIONSHIP_TARGET_LEAD_NAME_FIELD,
        ],
      },
    },
    sourceName,
  );
  const targetIds = new Set<string>();
  const targets = relationshipTargetIdentities(
    targetRows.map((row) => ({
      entityKey: textValue(row.entityKey),
      field: textValue(row.field),
      value: row.value,
    })),
  );
  for (const target of targets) {
    const targetId = await resolveCenterRelationshipTargetId(target);
    if (targetId) targetIds.add(targetId);
  }
  return targetIds;
}

async function resolveCenterRelationshipTargetId(
  target: RelationshipTargetIdentity,
): Promise<string | null> {
  const { resolvedTarget } = await resolveRelationshipTarget(ResearchEntity, target);
  return normalizeMaterializerObjectId(resolvedTarget?._id) || null;
}

export function centerRosterRetirementDeps(
  options: MaterializeOptions,
  lane: CenterRosterLane = CENTERS_INSTITUTES_ROSTER_LANE,
): CenterRosterRetirementDeps {
  return {
    membershipKeysAssertedByOtherSources: (centerEntityKey) =>
      centerMembershipKeysAssertedByOtherSources(centerEntityKey, lane.sourceName),
    personRolesAssertedByOtherSources: (centerEntityKey) =>
      centerPersonRolesAssertedByOtherSources(centerEntityKey, lane.sourceName),
    relationshipTargetIdsAssertedByOtherSources: (centerEntityKey) =>
      centerRelationshipTargetIdsAssertedByOtherSources(centerEntityKey, lane.sourceName),
    resolveRelationshipTargetId: resolveCenterRelationshipTargetId,
    rematerializeMemberKey: async (memberKey: string) => {
      await materializeEntity('researchGroupMember', { entityKey: memberKey }, options);
    },
  };
}

function logCenterRosterRetirement(
  result: CenterRosterRetirementResult,
  lane: CenterRosterLane = CENTERS_INSTITUTES_ROSTER_LANE,
): void {
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
    `[center-roster-retirement] ${lane.sourceName} ${result.dryRun ? 'planned' : 'reconciled'} ${result.centers.length} center read(s): ${acted.length} retiring (${sum('retiredMemberKeys')} member keys, ${sum('retiredEdges')} role edges of which ${sum('retiredLeadEdges')} leads), ${frozen.length} frozen, ${notAdmitted.length} read(s) not admitted, ${indexSyncFailures} center index sync failure(s)`,
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

export const MATERIALIZATION_CONCURRENCY_ENV = 'MATERIALIZE_CONCURRENCY';
export const MAX_MATERIALIZATION_CONCURRENCY = 16;
export const DEFAULT_MATERIALIZATION_CONCURRENCY = 8;

export function materializationConcurrencyFromEnv(
  value: string | undefined = process.env[MATERIALIZATION_CONCURRENCY_ENV],
): number {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_MATERIALIZATION_CONCURRENCY;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_MATERIALIZATION_CONCURRENCY);
}

export interface ChunkConcurrencyPartition {
  independent: ObservedEntityRow[];
  sequential: ObservedEntityRow[];
  /**
   * The sequential rows that are department-roster shells safe to run beside each other,
   * each with the person its fold is keyed on. Absent rows run strictly in order.
   */
  deptShellPersonByRow?: ReadonlyMap<ObservedEntityRow, string>;
}

/** Every archived row merged into each live survivor, keyed by the survivor's id. */
export type ChunkMergeGroups = ReadonlyMap<string, ReadonlyArray<MergedInResearchEntityRow>>;

interface StoredRowWritableAlone {
  id: string;
  /** The ids and keys of every row this one reads as its own: itself and its merged-in rows. */
  groupKeys: string[];
}

function liveStoredResearchEntity(
  row: ObservedEntityRow,
  chunkPrefetch: MaterializationReadSource,
): { id: string; slug: string } | undefined {
  if (!isResearchEntityObservationType(row.entityType) || isDeptRosterKey(row.entityKey)) {
    return undefined;
  }
  const lookup = row.entityId
    ? chunkPrefetch.entityDocForId(row.entityType, row.entityId)
    : row.entityKey
      ? chunkPrefetch.entityDocForKey(row.entityType, row.entityKey)
      : undefined;
  if (!lookup?.hit || !lookup.value) return undefined;
  const doc = lookup.value as {
    _id?: unknown;
    slug?: unknown;
    archived?: unknown;
    canonicalGroupId?: unknown;
  };
  if (doc.archived === true || doc.canonicalGroupId) return undefined;
  const id = prefetchObjectIdString(doc._id);
  return id ? { id, slug: textValue(doc.slug) } : undefined;
}

function storedResearchEntityWritableAlone(
  row: ObservedEntityRow,
  chunkPrefetch: MaterializationReadSource,
  mergeGroups: ChunkMergeGroups | undefined,
): StoredRowWritableAlone | undefined {
  const stored = liveStoredResearchEntity(row, chunkPrefetch);
  if (!stored) return undefined;
  const ownKeys = [stored.id, stored.slug].filter(Boolean);
  if (chunkPrefetch.hasNoMergedInRows(stored.id)) return { id: stored.id, groupKeys: ownKeys };
  const mergedIn = mergeGroups?.get(stored.id);
  if (!mergedIn) return undefined;
  const mergedInKeys = mergedIn.flatMap((member) =>
    [prefetchObjectIdString(member._id), textValue(member.slug)].filter((key): key is string =>
      Boolean(key),
    ),
  );
  return { id: stored.id, groupKeys: [...ownKeys, ...mergedInKeys] };
}

function storedDocumentIdFor(
  row: ObservedEntityRow,
  chunkPrefetch: MaterializationReadSource,
): string | undefined {
  if (!isResearchEntityObservationType(row.entityType)) return undefined;
  const lookup = row.entityId
    ? chunkPrefetch.entityDocForId(row.entityType, row.entityId)
    : row.entityKey
      ? chunkPrefetch.entityDocForKey(row.entityType, row.entityKey)
      : undefined;
  if (!lookup?.hit || !lookup.value) return undefined;
  return prefetchObjectIdString((lookup.value as { _id?: unknown })._id);
}

/** Every id and key a row names: its own identifiers and the stored row they resolve to. */
function rowReferenceKeys(
  row: ObservedEntityRow,
  chunkPrefetch: MaterializationReadSource,
): Set<string> {
  return new Set(
    [row.entityId, row.entityKey, storedDocumentIdFor(row, chunkPrefetch)].filter(
      (key): key is string => Boolean(key),
    ),
  );
}

const deptShellPersonKey = (value: unknown): string => {
  const personName = personNameFromDeptRosterEntityName(value);
  return personName ? nameOnlyResolutionName(personName).toLowerCase() : '';
};

/**
 * A department-roster shell writes itself and then folds into the research row its person
 * already leads, so its only cross-row effect is keyed on that person. It may run beside
 * other shells when it is live and unmerged, no other row in the chunk names it, and every
 * name its observations assert is the stored person, so the person its fold reads cannot
 * change while it runs (#5555).
 */
function deptShellPersonWritableBesideShells(
  row: ObservedEntityRow,
  chunkPrefetch: MaterializationReadSource,
  rowsReferencingKey: ReadonlyMap<string, number>,
): string | undefined {
  if (!isResearchEntityObservationType(row.entityType) || !isDeptRosterKey(row.entityKey)) {
    return undefined;
  }
  const lookup = row.entityId
    ? chunkPrefetch.entityDocForId(row.entityType, row.entityId)
    : chunkPrefetch.entityDocForKey(row.entityType, String(row.entityKey));
  if (!lookup.hit || !lookup.value) return undefined;
  const doc = lookup.value as {
    _id?: unknown;
    slug?: unknown;
    name?: unknown;
    archived?: unknown;
    canonicalGroupId?: unknown;
  };
  if (doc.archived === true || doc.canonicalGroupId) return undefined;
  const id = prefetchObjectIdString(doc._id);
  if (!id || !chunkPrefetch.hasNoMergedInRows(id)) return undefined;
  const ownReferences = rowReferenceKeys(row, chunkPrefetch);
  const ownKeys = [id, textValue(doc.slug), row.entityId, row.entityKey].filter(
    (key): key is string => Boolean(key),
  );
  const namedBySibling = ownKeys.some(
    (key) => (rowsReferencingKey.get(key) ?? 0) - (ownReferences.has(key) ? 1 : 0) > 0,
  );
  if (namedBySibling) return undefined;
  const person = deptShellPersonKey(doc.name);
  if (!person) return undefined;
  const observations = row.entityId
    ? chunkPrefetch.observationsForId(row.entityType, row.entityId)
    : chunkPrefetch.observationsForKey(row.entityType, String(row.entityKey));
  if (!observations.hit) return undefined;
  const assertsAnotherPerson = observations.value.some(
    (observation: any) =>
      observation?.field === 'name' && deptShellPersonKey(observation.value) !== person,
  );
  return assertsAnotherPerson ? undefined : person;
}

/**
 * Runs the chunk's sequential rows in their original order, except that a run of
 * consecutive department-roster shells for different people runs at once. A shell for a
 * person already in the current run starts the next run, so two shells of one person never
 * overlap and every shell keeps its order against every row that stays strictly sequential.
 */
export async function runSequentialRowsWithDeptShellSpans(
  sequential: readonly ObservedEntityRow[],
  deptShellPersonByRow: ReadonlyMap<ObservedEntityRow, string> | undefined,
  concurrency: number,
  work: (row: ObservedEntityRow) => Promise<void>,
): Promise<void> {
  let span: ObservedEntityRow[] = [];
  let spanPeople = new Set<string>();
  const flush = async () => {
    if (span.length === 1) await work(span[0]);
    else if (span.length > 1) await runWithConcurrency(span, concurrency, work);
    span = [];
    spanPeople = new Set();
  };
  for (const row of sequential) {
    const person = deptShellPersonByRow?.get(row);
    if (!person) {
      await flush();
      await work(row);
      continue;
    }
    if (spanPeople.has(person)) await flush();
    span.push(row);
    spanPeople.add(person);
  }
  await flush();
}

/**
 * The merge groups of the chunk's live survivors, loaded only when the chunk will run in
 * parallel. A failed load returns nothing, which keeps every survivor sequential.
 */
async function loadChunkMergeGroups(
  chunk: readonly ObservedEntityRow[],
  chunkPrefetch: MaterializationReadSource,
): Promise<ChunkMergeGroups | undefined> {
  const survivorIds = [
    ...new Set(
      chunk
        .map((row) => liveStoredResearchEntity(row, chunkPrefetch)?.id)
        .filter((id): id is string => Boolean(id) && !chunkPrefetch.hasNoMergedInRows(id)),
    ),
  ];
  if (survivorIds.length === 0) return undefined;
  try {
    return await listResearchEntityMergedInRowsBySurvivor(survivorIds);
  } catch (error) {
    console.warn(
      'materializeFromRun: merge groups for a chunk failed to load; its survivors run sequentially:',
      sanitizeLogValue(error),
    );
    return undefined;
  }
}

/**
 * Only a row that updates its own live, already-stored research entity may run beside
 * others, and only when no other row in the chunk names any row it reads as its own: a
 * create can be adopted by a sibling's identity lookup and a `dept-*` key can fold into
 * another row, so both stay in the original sequential order (#5521). A merged survivor
 * reads its merged-in rows' evidence but writes only itself, so it runs in parallel once its
 * whole merge group is known and no sibling row is keyed by the survivor or by any row merged
 * into it, because such a sibling resolves to the same survivor and writes it (#5555).
 */
export function partitionChunkForConcurrency(
  chunk: readonly ObservedEntityRow[],
  chunkPrefetch: MaterializationReadSource | undefined,
  mergeGroups?: ChunkMergeGroups,
): ChunkConcurrencyPartition {
  if (!chunkPrefetch) return { independent: [], sequential: [...chunk] };
  const writableByRow = new Map<ObservedEntityRow, StoredRowWritableAlone>();
  const rowsReferencingKey = new Map<string, number>();
  for (const row of chunk) {
    const writable = storedResearchEntityWritableAlone(row, chunkPrefetch, mergeGroups);
    if (writable) writableByRow.set(row, writable);
    for (const key of rowReferenceKeys(row, chunkPrefetch)) {
      rowsReferencingKey.set(key, (rowsReferencingKey.get(key) ?? 0) + 1);
    }
  }
  const independent: ObservedEntityRow[] = [];
  const sequential: ObservedEntityRow[] = [];
  for (const row of chunk) {
    const writable = writableByRow.get(row);
    const ownReferences = rowReferenceKeys(row, chunkPrefetch);
    const namedByNoSibling =
      writable !== undefined &&
      writable.groupKeys.every(
        (key) => (rowsReferencingKey.get(key) ?? 0) - (ownReferences.has(key) ? 1 : 0) === 0,
      );
    if (namedByNoSibling) independent.push(row);
    else sequential.push(row);
  }
  const deptShellPersonByRow = new Map<ObservedEntityRow, string>();
  for (const row of sequential) {
    const person = deptShellPersonWritableBesideShells(row, chunkPrefetch, rowsReferencingKey);
    if (person) deptShellPersonByRow.set(row, person);
  }
  return {
    independent,
    sequential,
    ...(deptShellPersonByRow.size > 0 ? { deptShellPersonByRow } : {}),
  };
}

async function materializeChunkRow(
  row: ObservedEntityRow,
  options: MaterializeOptions,
  chunkPrefetch: MaterializationReadSource | undefined,
  onRow: (row: ObservedEntityRow, outcome: ObservedEntityOutcome) => void,
): Promise<void> {
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
  recordScrapeRunProgress();
  onRow(row, outcome);
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(lanes);
}

export async function materializeObservedEntitiesInChunks(
  rows: readonly ObservedEntityRow[],
  options: MaterializeOptions,
  onRow: (row: ObservedEntityRow, outcome: ObservedEntityOutcome) => void,
  chunkSize: number = MATERIALIZATION_CHUNK_SIZE,
  concurrency: number = materializationConcurrencyFromEnv(),
): Promise<{ linkedRowIndexSyncFailedEntityIds: Set<string> }> {
  resetPrimaryDepartmentStatingKeysCache();
  const linkedRowIndexSyncFailedEntityIds = new Set<string>();
  let start = 0;
  while (start < rows.length) {
    const entityType = rows[start].entityType;
    let end = start + 1;
    while (end < rows.length && end - start < chunkSize && rows[end].entityType === entityType) {
      end += 1;
    }
    const chunk = rows.slice(start, end);
    const { failedEntityIds } = await withResearcherSearchInputResync(() =>
      materializeChunk(chunk, entityType, options, onRow, concurrency),
    );
    for (const entityId of failedEntityIds) linkedRowIndexSyncFailedEntityIds.add(entityId);
    start = end;
  }
  return { linkedRowIndexSyncFailedEntityIds };
}

async function materializeChunk(
  chunk: readonly ObservedEntityRow[],
  entityType: ObservedEntityType,
  options: MaterializeOptions,
  onRow: (row: ObservedEntityRow, outcome: ObservedEntityOutcome) => void,
  concurrency: number,
): Promise<void> {
  const chunkPrefetch = await loadChunkPrefetch(entityType, chunk);
  if (concurrency <= 1) {
    for (const row of chunk) await materializeChunkRow(row, options, chunkPrefetch, onRow);
    return;
  }
  const mergeGroups = chunkPrefetch ? await loadChunkMergeGroups(chunk, chunkPrefetch) : undefined;
  const { independent, sequential, deptShellPersonByRow } = partitionChunkForConcurrency(
    chunk,
    chunkPrefetch,
    mergeGroups,
  );
  const work = (row: ObservedEntityRow) => materializeChunkRow(row, options, chunkPrefetch, onRow);
  await runWithConcurrency(independent, concurrency, work);
  await runSequentialRowsWithDeptShellSpans(sequential, deptShellPersonByRow, concurrency, work);
}

interface MaterializeFromRunCounts {
  materialized: number;
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  errors: number;
  indexSyncFailures: number;
  postMaterializationMetrics: Required<ReportPostMaterializationMetrics>;
  userFieldScope?: UserFieldScopeReport;
}

export interface UserFieldScopeRow {
  entityKey?: string;
  entityId?: string;
  fieldsWritten: number;
  plannedPaths: string[];
  droppedPaths: string[];
  skipped?: string;
  error?: string;
}

export interface UserFieldScopeSummary {
  onlyFields: string[];
  scope: string[];
  keys: number;
  keysWriting: number;
  plannedPathSet: string[];
  droppedPathSet: string[];
  skipped: Record<string, number>;
  errors: number;
}

export interface UserFieldScopeReport extends UserFieldScopeSummary {
  rowsOutsideUserSkipped: Record<string, number>;
  runReconciliationsSkipped: true;
  rows: UserFieldScopeRow[];
}

export function userFieldScopeRow(
  identifier: { entityKey?: string; entityId?: string },
  outcome: { result: MaterializeResult } | { error: unknown },
): UserFieldScopeRow {
  if ('error' in outcome) {
    return {
      ...identifier,
      fieldsWritten: 0,
      plannedPaths: [],
      droppedPaths: [],
      error: sanitizeLogValue((outcome.error as Error)?.message ?? String(outcome.error)),
    };
  }
  const { result } = outcome;
  return {
    ...identifier,
    fieldsWritten: result.fieldsWritten,
    plannedPaths: result.plannedPaths ?? [],
    droppedPaths: result.droppedPaths ?? [],
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
}

export function summarizeUserFieldScopeRows(
  onlyFields: readonly string[],
  rows: readonly UserFieldScopeRow[],
): UserFieldScopeSummary {
  const skipped: Record<string, number> = {};
  for (const row of rows) if (row.skipped) skipped[row.skipped] = (skipped[row.skipped] ?? 0) + 1;
  return {
    onlyFields: [...onlyFields],
    scope: expandUserMaterializerScope(onlyFields),
    keys: rows.length,
    keysWriting: rows.filter((row) => row.fieldsWritten > 0).length,
    plannedPathSet: unionSorted(...rows.map((row) => row.plannedPaths)),
    droppedPathSet: unionSorted(...rows.map((row) => row.droppedPaths)),
    skipped,
    errors: rows.filter((row) => row.error).length,
  };
}

export function withoutUserFieldScopeRows<T extends { userFieldScope?: UserFieldScopeReport }>(
  counts: T,
): T | (Omit<T, 'userFieldScope'> & { userFieldScope: Omit<UserFieldScopeReport, 'rows'> }) {
  if (!counts.userFieldScope) return counts;
  const { rows: _rows, ...summary } = counts.userFieldScope;
  return { ...counts, userFieldScope: summary };
}

async function materializeUserRowsInFieldScope(
  rows: ReadonlyArray<{ entityType: ObservedEntityType; entityId?: string; entityKey?: string }>,
  options: MaterializeOptions,
): Promise<MaterializeFromRunCounts> {
  const onlyFields = [...(options.userWriteOnlyFields ?? [])];
  const rowsOutsideUserSkipped: Record<string, number> = {};
  const userRows = rows.filter((row) => {
    if (row.entityType === 'user') return true;
    rowsOutsideUserSkipped[row.entityType] = (rowsOutsideUserSkipped[row.entityType] ?? 0) + 1;
    return false;
  });
  const scopeRows: UserFieldScopeRow[] = [];
  let conflicts = 0;
  const progress = startLongRunProgress('field-scoped-user-materialize', userRows.length);
  const { linkedRowIndexSyncFailedEntityIds } = await materializeObservedEntitiesInChunks(
    userRows,
    options,
    (row, outcome) => {
      progress.tick('error' in outcome);
      scopeRows.push(
        userFieldScopeRow({ entityKey: row.entityKey, entityId: row.entityId }, outcome),
      );
      if ('result' in outcome) conflicts += outcome.result.conflicts;
    },
    MATERIALIZATION_CHUNK_SIZE,
    1,
  ).finally(() => progress.stop());
  const summary = summarizeUserFieldScopeRows(onlyFields, scopeRows);
  return {
    materialized: scopeRows.filter((row) => !row.error).length,
    created: 0,
    updated: scopeRows.filter((row) => !row.error && !row.skipped).length,
    conflicts,
    skipped: scopeRows.filter((row) => row.skipped).length,
    errors: summary.errors,
    indexSyncFailures: linkedRowIndexSyncFailedEntityIds.size,
    postMaterializationMetrics: emptyPostMaterializationMetrics(),
    userFieldScope: {
      ...summary,
      rowsOutsideUserSkipped,
      runReconciliationsSkipped: true,
      rows: scopeRows,
    },
  };
}

export async function materializeFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<MaterializeFromRunCounts & { removedByRequest: number }> {
  const guard = await loadDirectoryRemovalMintGuard();
  const counts = await withDirectoryRemovalMintGuard(
    () => materializeFromRunUnderRemovalGuard(scrapeRunId, options),
    guard,
  );
  if (guard.refusals > 0) {
    console.info(
      `[directory-removal] refused ${guard.refusals} mint or attachment(s) for people removed from the directory by request`,
    );
  }
  return { ...counts, removedByRequest: guard.refusals };
}

async function materializeFromRunUnderRemovalGuard(
  scrapeRunId: string,
  options: MaterializeOptions,
): Promise<MaterializeFromRunCounts> {
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
  if (options.skipEntityTypes?.length) {
    const skipped = new Set(options.skipEntityTypes);
    for (let index = distinct.length - 1; index >= 0; index -= 1) {
      if (skipped.has(distinct[index]._id?.entityType)) distinct.splice(index, 1);
    }
  }
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

  if (userWriteScope(options)) {
    return materializeUserRowsInFieldScope(
      distinct.map((row) => ({
        entityType: row._id.entityType,
        entityId: row._id.entityId ? String(row._id.entityId) : undefined,
        entityKey: row._id.entityKey || undefined,
      })),
      options,
    );
  }

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
  const {
    value: { linkedRowIndexSyncFailedEntityIds },
    failedDocumentIds,
  } = await withDeferredIndexConfirmation(() =>
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
        for (const entityId of res.otherIndexSyncFailedEntityIds ?? []) {
          staleIndexEntityIds.add(entityId);
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
  for (const entityId of linkedRowIndexSyncFailedEntityIds) staleIndexEntityIds.add(entityId);
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
  const centerRosterRetirementDryRun =
    options.dryRun === true || options.skipCenterRosterRetirement === true;
  const centerRosterRetirement = await reconcileCenterRosterRetirementsFromRun(
    scrapeRunId,
    centerRosterRetirementDeps(options),
    { dryRun: centerRosterRetirementDryRun },
  );
  if (centerRosterRetirement.outcome !== 'no-center-roster-read') {
    logCenterRosterRetirement(centerRosterRetirement);
  }
  const centerAffiliationRetirement = await reconcileCenterRosterRetirementsFromRun(
    scrapeRunId,
    centerRosterRetirementDeps(options, CENTER_AFFILIATION_ROSTER_LANE),
    { dryRun: centerRosterRetirementDryRun, lane: CENTER_AFFILIATION_ROSTER_LANE },
  );
  if (centerAffiliationRetirement.outcome !== 'no-center-roster-read') {
    logCenterRosterRetirement(centerAffiliationRetirement, CENTER_AFFILIATION_ROSTER_LANE);
  }
  const centerAffiliationCodeRetirement = await reconcileCenterRosterRetirementsFromRun(
    scrapeRunId,
    centerRosterRetirementDeps(options, CENTER_AFFILIATION_CODE_ROSTER_LANE),
    { dryRun: centerRosterRetirementDryRun, lane: CENTER_AFFILIATION_CODE_ROSTER_LANE },
  );
  if (centerAffiliationCodeRetirement.outcome !== 'no-center-roster-read') {
    logCenterRosterRetirement(centerAffiliationCodeRetirement, CENTER_AFFILIATION_CODE_ROSTER_LANE);
  }
  const centerAffiliationHandOff = await reconcileCenterAffiliationHandOffFromRun(
    scrapeRunId,
    centerRosterRetirementDeps(options, CENTER_AFFILIATION_ROSTER_LANE),
    { dryRun: options.dryRun },
  );
  if (centerAffiliationHandOff) {
    console.info(`[center-affiliation-hand-off] ${JSON.stringify(centerAffiliationHandOff)}`);
  }
  const centerDirectorRetirement = await reconcileCenterDirectorRetirementsFromRun(scrapeRunId, {
    dryRun: options.dryRun,
  });
  if (centerDirectorRetirement) {
    console.info(
      `[center-director-retirement] ${centerDirectorRetirement.dryRun ? 'planned' : 'reconciled'} ${centerDirectorRetirement.centersRead} center read(s): ${centerDirectorRetirement.retiredEdges} lead edge(s) ended, ${centerDirectorRetirement.edgesAwaitingSecondRead} awaiting a second read, ${centerDirectorRetirement.unjudgedEdges} not judged, ${centerDirectorRetirement.indexSyncFailures} center index sync failure(s)`,
    );
  }
  const codeLaneDirectorRetirement = await reconcileCodeLaneDirectorRetirementsFromRun(
    scrapeRunId,
    { dryRun: options.dryRun },
  );
  if (codeLaneDirectorRetirement) {
    console.info(`[center-director-code-retirement] ${JSON.stringify(codeLaneDirectorRetirement)}`);
  }
  const officialProfileDirectorRetirement =
    await reconcileOfficialProfileDirectorRetirementsFromRun(
      scrapeRunId,
      centerRosterRetirementDeps(options, OFFICIAL_PROFILE_DIRECTOR_LANE),
      { dryRun: options.dryRun },
    );
  if (officialProfileDirectorRetirement) {
    console.info(
      `[official-profile-director-retirement] ${JSON.stringify(officialProfileDirectorRetirement)}`,
    );
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
  const rosterMintWithdrawal = await reconcileRosterMintWithdrawalsFromRun(
    scrapeRunId,
    { dryRun: options.dryRun },
    {
      rematerializeResearchEntity: async (entityKey) => {
        await materializeEntity('researchEntity', { entityKey }, options);
      },
    },
  );
  if (rosterMintWithdrawal.outcome !== 'no-roster-health-observations') {
    console.info(
      `[roster-mint-withdrawal] ${rosterMintWithdrawal.outcome}: ${JSON.stringify(rosterMintWithdrawal.counts)}`,
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
  const fieldRetractionResult = await reconcileFieldRetractionsFromRun(scrapeRunId, {
    dryRun: options.dryRun,
    rederiveUser: (identifier) => materializeEntity('user', identifier, { dryRun: false }),
  });
  if (fieldRetractionResult.userFieldRetraction) {
    const userRetraction = fieldRetractionResult.userFieldRetraction;
    console.info(
      `[field-retraction] user ${userRetraction.outcome}: ${JSON.stringify({
        ...userRetraction.counts,
        retiredObservations: userRetraction.retiredObservations,
        rederivedSubjects: userRetraction.rederivedSubjects,
        rederiveErrors: userRetraction.rederiveErrors,
      })}`,
    );
  }
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
