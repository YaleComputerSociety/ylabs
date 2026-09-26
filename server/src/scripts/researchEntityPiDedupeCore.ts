import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import {
  isAreaShellSlug,
  isFundingShellSlug,
  isLowTrustAreaShellSlug,
} from '../utils/researchEntityShellSlug';
import {
  concreteLabWebsiteForEntity,
  entityCarriesConcreteWebsite,
  isCenterOrInstituteEntity,
  isConcreteResearchHomeEntity,
  isProfileAreaShellEntity,
} from '../utils/profileAreaDuplicateRisk';
import {
  isCustomYaleResearchHomeSubdomain,
  isListingOrIndexUrl,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../utils/researchHomeWebsiteUrl';
import { personPagePrefixesForHost } from '../utils/yalePersonPagePrefix';

export interface ResearchEntityPiDedupeRow {
  userId: string;
  normalizedName: string;
  piFirstName?: string;
  piLastName?: string;
  primaryAppointmentProfileUrl?: string;
  entities: Array<{
    id: string;
    slug?: string;
    name?: string;
    kind?: string;
    entityType?: string;
    websiteUrl?: string;
    fullDescription?: string;
    shortDescription?: string;
    sourceUrls?: string[];
    sourceLinkHealth?: unknown;
    departments?: string[];
    researchAreas?: string[];
    recentGrants?: unknown[];
    recentGrantCount?: number;
    fundingAgencies?: string[];
    piRoleCorroborated?: boolean;
    identitySourceUrl?: string;
  }>;
}

export interface ResearchEntityPiDedupeGroup {
  userId: string;
  normalizedName: string;
  canonicalEntityId: string;
  duplicateEntityIds: string[];
  canonicalSlug?: string;
  duplicateSlugs: string[];
  mergedDepartments: string[];
  mergedResearchAreas: string[];
  mergedSourceUrls: string[];
  canonicalName?: string;
  canonicalWebsiteUrl?: string;
  canonicalFullDescription?: string;
  canonicalShortDescription?: string;
  dedupeCategory?: 'profile_area_shell_with_concrete_home' | 'shared_person_id';
  mergedRecentGrants?: unknown[];
  mergedRecentGrantCount?: number;
  mergedFundingAgencies?: string[];
}

export interface SameNameDifferentPersonQuarantine {
  normalizedName: string;
  entities: Array<{ id: string; slug?: string; personId: string }>;
}

export interface MultiPersonEntityQuarantine {
  id: string;
  slug?: string;
  personIds: string[];
}

export interface ConflatedPersonProfileQuarantine {
  canonicalEntityId: string;
  canonicalSlug?: string;
  duplicateSlugs: string[];
  personProfileIdentities: string[];
}

export interface OfficialLabUrlDedupeRow {
  url: string;
  entities: ResearchEntityPiDedupeRow['entities'];
}

export interface WebsiteUrlDedupeRow {
  websiteUrl: string;
  entities: ResearchEntityPiDedupeRow['entities'];
}

export interface CurrentMemberDedupeRow {
  id: string;
  confidence?: number;
  lastObservedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  sourceUrl?: string | null;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));
}

const MAX_MERGED_RECENT_GRANTS = 10;

function grantRecordIdentity(grant: unknown): string {
  const record = (grant && typeof grant === 'object' ? grant : {}) as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  return id ? `id:${id.toLowerCase()}` : `record:${JSON.stringify(record)}`;
}

function grantRecordStartTime(grant: unknown): number {
  const record = (grant && typeof grant === 'object' ? grant : {}) as Record<string, unknown>;
  const time = new Date(record.startDate as any).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function mergedGrantEvidenceFromEntities(entities: ResearchEntityPiDedupeRow['entities']): {
  mergedRecentGrants: unknown[];
  mergedRecentGrantCount: number;
  mergedFundingAgencies: string[];
} {
  const grants = new Map<string, unknown>();
  let recentGrantCount = 0;
  for (const entity of entities) {
    for (const grant of entity.recentGrants || []) {
      grants.set(grantRecordIdentity(grant), grant);
    }
    if (typeof entity.recentGrantCount === 'number' && Number.isFinite(entity.recentGrantCount)) {
      recentGrantCount += Math.max(0, Math.floor(entity.recentGrantCount));
    }
  }
  const mergedRecentGrants = [...grants.values()]
    .sort((left, right) => grantRecordStartTime(right) - grantRecordStartTime(left))
    .slice(0, MAX_MERGED_RECENT_GRANTS);
  const mergedFundingAgencies = uniqueStrings(
    entities.flatMap((entity) => entity.fundingAgencies || []),
  );
  return {
    mergedRecentGrants,
    mergedRecentGrantCount: recentGrantCount,
    mergedFundingAgencies,
  };
}

/**
 * The observation fields a merge may re-key from an archived duplicate onto its survivor.
 *
 * Deliberately only the funding evidence. A grant enriches the row a person's profile
 * owns and never asserts that row's identity (#3145), so re-keying a duplicate's `name`,
 * `slug`, `kind`, `entityType` or `displayName` would move the fabricated "<person> Lab"
 * claim that #3160 retired onto a row which had real evidence. Adding a field here
 * grants its lane naming authority over the survivor, so a new entry needs evidence that
 * the duplicate's lane was entitled to assert it.
 */
export const MERGE_RELINKABLE_OBSERVATION_FIELDS = [
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
] as const;

export interface StrandedObservationRelinkCandidate {
  id: unknown;
  entityKey?: string;
  field?: string;
  entityId?: unknown;
}

/**
 * The funding observations a merge left stranded on an archived duplicate's key.
 *
 * The merge's reference relink is keyed on `entityId`, so an observation written with
 * only an `entityKey` is never moved. Measured on Development, all 112 live funding
 * observations sitting on the 32 archived merge shells carried no `entityId`, so the
 * relink moved none of them, and the survivor loses that evidence on its next
 * materialize pass: the pass projects from the observations the survivor's own key can
 * reach, so a field write the materializer does not own cannot survive it (#3145).
 */
export function planStrandedFundingObservationRelink(args: {
  survivorKey: string;
  duplicateKeys: readonly (string | undefined)[];
  observations: readonly StrandedObservationRelinkCandidate[];
}): { survivorKey: string; ids: unknown[]; fields: string[] } | null {
  const survivorKey = (args.survivorKey || '').trim();
  if (!survivorKey) return null;
  const duplicateKeys = new Set(
    args.duplicateKeys
      .map((key) => (key || '').trim())
      .filter((key) => Boolean(key) && key !== survivorKey),
  );
  if (duplicateKeys.size === 0) return null;

  const relinkable = args.observations.filter(
    (observation) =>
      duplicateKeys.has((observation.entityKey || '').trim()) &&
      MERGE_RELINKABLE_OBSERVATION_FIELDS.includes(
        (observation.field || '') as (typeof MERGE_RELINKABLE_OBSERVATION_FIELDS)[number],
      ) &&
      !observation.entityId,
  );
  if (relinkable.length === 0) return null;

  return {
    survivorKey,
    ids: relinkable.map((observation) => observation.id),
    fields: uniqueStrings(relinkable.map((observation) => String(observation.field || ''))),
  };
}

function timeValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function rosterHost(value: string | undefined): string {
  try {
    return new URL((value || '').trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The department roster a person's primary appointment lives on, taken from their own
 * official profile URL. A cross-listed professor appears on a second school's roster
 * too, so both rosters mint a research home for one person, and only the appointment
 * roster describes the research they actually direct.
 */
export function primaryAppointmentRosterHost(
  row: Pick<ResearchEntityPiDedupeRow, 'primaryAppointmentProfileUrl'>,
): string {
  const url = (row.primaryAppointmentProfileUrl || '').trim();
  if (!url) return '';
  if (!personProfileIdentityFromUrl(url)) return '';
  return rosterHost(url);
}

export function entityMintedByPrimaryAppointmentRoster(
  row: Pick<ResearchEntityPiDedupeRow, 'primaryAppointmentProfileUrl'>,
  entity: ResearchEntityPiDedupeRow['entities'][number],
): boolean {
  const appointmentHost = primaryAppointmentRosterHost(row);
  if (!appointmentHost) return false;
  const mintedByHost = rosterHost(entity.identitySourceUrl);
  return mintedByHost !== '' && mintedByHost === appointmentHost;
}

function primaryAppointmentRank(
  row: Pick<ResearchEntityPiDedupeRow, 'primaryAppointmentProfileUrl'>,
  entity: ResearchEntityPiDedupeRow['entities'][number],
): number {
  return entityMintedByPrimaryAppointmentRoster(row, entity) ? 1 : 0;
}

function withoutPrimaryAppointmentPreference(
  row: ResearchEntityPiDedupeRow,
): ResearchEntityPiDedupeRow {
  return { ...row, primaryAppointmentProfileUrl: undefined };
}

function canonicalScore(entity: ResearchEntityPiDedupeRow['entities'][number]): number {
  const slug = entity.slug || '';
  const hasFullDescription = Boolean((entity.fullDescription || '').trim());
  const hasShortDescription = Boolean((entity.shortDescription || '').trim());
  const isSpecialShell = isLowTrustAreaShellSlug(slug);
  return (
    (entity.sourceUrls?.length || 0) * 4 +
    (entity.departments?.length || 0) * 3 +
    (entity.researchAreas?.length || 0) * 2 +
    (hasYaleEvidence(entity) ? 20 : 0) +
    ((entity.websiteUrl || '').trim() ? 5 : 0) +
    (entityCarriesConcreteWebsite(entity) ? 6 : 0) +
    (hasFullDescription ? 18 : 0) +
    (hasShortDescription ? 8 : 0) +
    (!isSpecialShell ? 80 : 0) +
    (slug.startsWith('dept-') ? 2 : 0) +
    (slug.startsWith('ysm-') ? 8 : 0) +
    (slug.startsWith('faculty-research-area-') ? 10 : 0) +
    (isFundingShellSlug(slug) ? -80 : 0)
  );
}

function isFundingSourceUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(value || '');
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'reporter.nih.gov' ||
      host.endsWith('.reporter.nih.gov') ||
      host === 'nih.gov' ||
      host.endsWith('.nih.gov') ||
      host === 'nsf.gov' ||
      host.endsWith('.nsf.gov') ||
      host === 'usaspending.gov' ||
      host.endsWith('.usaspending.gov') ||
      host === 'osti.gov' ||
      host.endsWith('.osti.gov')
    );
  } catch {
    return false;
  }
}

function isYaleSourceUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(value || '');
    const host = parsed.hostname.toLowerCase();
    return host === 'yale.edu' || host.endsWith('.yale.edu');
  } catch {
    return false;
  }
}

function hasYaleEvidence(entity: ResearchEntityPiDedupeRow['entities'][number]): boolean {
  return [entity.websiteUrl, ...(entity.sourceUrls || [])].some(isYaleSourceUrl);
}

function isFundingOnlyEntity(entity: ResearchEntityPiDedupeRow['entities'][number]): boolean {
  const slug = (entity.slug || '').toLowerCase();
  const sourceUrls = entity.sourceUrls || [];
  const hasFundingSlug = isFundingShellSlug(slug);
  const hasFundingSource = sourceUrls.some(isFundingSourceUrl);
  const hasNonFundingSource = sourceUrls.some((url) => !isFundingSourceUrl(url));

  return (hasFundingSlug || hasFundingSource) && !hasYaleEvidence(entity) && !hasNonFundingSource;
}

function fundingCanonicalScore(entity: ResearchEntityPiDedupeRow['entities'][number]): number {
  return (
    (hasYaleEvidence(entity) ? 100 : 0) +
    (isFundingOnlyEntity(entity) ? -100 : 0) +
    canonicalScore(entity)
  );
}

function isOfficialYaleLabUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(value || '');
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    return host === 'medicine.yale.edu' && /^\/lab\/[^/]+$/i.test(path);
  } catch {
    return false;
  }
}

function isOfficialYaleProfileUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(value || '');
    const host = parsed.hostname.toLowerCase();
    return (
      (host === 'yale.edu' || host.endsWith('.yale.edu')) && /\/profile\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function cleanMergedResearchAreas(
  values: Array<string | undefined>,
  options: { sanitizeProfileChrome?: boolean } = {},
): string[] {
  const unique = uniqueStrings(values);
  if (!options.sanitizeProfileChrome) return unique;
  return sanitizeProfileResearchTerms(unique);
}

function trustedAreaShellEntities(
  entities: ResearchEntityPiDedupeRow['entities'],
): ResearchEntityPiDedupeRow['entities'] {
  const trustedEntities = entities.filter((entity) => !isLowTrustAreaShellSlug(entity.slug));
  return trustedEntities.length > 0 ? trustedEntities : entities;
}

function mergedResearchAreasFromEntities(
  entities: ResearchEntityPiDedupeRow['entities'],
  options: { sanitizeProfileChrome?: boolean } = {},
): string[] {
  return cleanMergedResearchAreas(
    trustedAreaShellEntities(entities).flatMap((entity) => entity.researchAreas || []),
    options,
  );
}

/**
 * Cross-cutting institute scrapers (e.g. Wu Tsai Institute) seed a broad
 * affiliate's generated `faculty-research-area-*` shell with the institute's
 * own home-department tuple. That seed is a reasonable guess for narrow,
 * single-department centers but is wrong for entities the institute merely
 * affiliates with across unrelated disciplines (a CS lab, a humanities
 * scholar). Dedupe historically unioned it into the canonical entity
 * unconditionally. Each of these three names is also a legitimate standalone
 * department elsewhere, so the graft signature is the full trio co-occurring
 * together, not any one name in isolation.
 */
const BIOMEDICAL_DEPARTMENT_GRAFT_TUPLE_KEYS: string[][] = [
  ['neuroscience'],
  ['psychology'],
  [
    'molecular, cellular, and developmental biology',
    'molecular, cellular and developmental biology',
  ],
];

const BIOMEDICAL_RESEARCH_AREA_CORROBORATION_PATTERN =
  /\b(neuro\w*|psycholog\w*|cognit\w*|synap\w*|neural|brain|molecular biology|cellular biology|developmental biology|biomedical|physiolog\w*|psychiatr\w*)\b/i;

function hasBiomedicalResearchAreaCorroboration(researchAreas: string[]): boolean {
  return researchAreas.some((area) => BIOMEDICAL_RESEARCH_AREA_CORROBORATION_PATTERN.test(area));
}

function departmentKeys(entities: ResearchEntityPiDedupeRow['entities']): Set<string> {
  return new Set(
    entities
      .flatMap((entity) => entity.departments || [])
      .map((department) => department.trim().toLowerCase()),
  );
}

function hasFullBiomedicalGraftTuple(keys: Set<string>): boolean {
  return BIOMEDICAL_DEPARTMENT_GRAFT_TUPLE_KEYS.every((memberKeys) =>
    memberKeys.some((key) => keys.has(key)),
  );
}

/**
 * Departments merged across a dedupe cluster, gated so the Wu-Tsai-style
 * biomedical seed tuple only survives when the full three-department
 * signature is corroborated by the entity's own trusted departments or its
 * merged researchAreas - never on the tuple's presence in a low-trust shell
 * alone. Any other department, including a lone member of the tuple with no
 * co-occurring siblings, merges unconditionally.
 */
function mergeCorroboratedDepartments(
  entities: ResearchEntityPiDedupeRow['entities'],
  mergedResearchAreas: string[],
): string[] {
  const merged = uniqueStrings(entities.flatMap((entity) => entity.departments || []));
  const mergedKeys = departmentKeys(entities);
  if (!hasFullBiomedicalGraftTuple(mergedKeys)) return merged;
  if (hasBiomedicalResearchAreaCorroboration(mergedResearchAreas)) return merged;

  const trustedKeys = departmentKeys(trustedAreaShellEntities(entities));
  if (hasFullBiomedicalGraftTuple(trustedKeys)) return merged;

  const graftKeys = new Set(BIOMEDICAL_DEPARTMENT_GRAFT_TUPLE_KEYS.flat());
  return merged.filter((department) => !graftKeys.has(department.trim().toLowerCase()));
}

function normalizedWords(value: string | undefined): string[] {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedEntityName(value: string | undefined): string {
  return normalizedWords(value).join(' ');
}

function isFullPersonLabName(value: string | undefined): boolean {
  const words = normalizedWords(value).filter(
    (word) => !['the', 'lab', 'laboratory', 'research'].includes(word),
  );
  return words.length >= 2 && /\b(lab|laboratory|research)\b/i.test(value || '');
}

function isProfileBackedSurnameLabShell(
  entity: ResearchEntityPiDedupeRow['entities'][number],
  row: ResearchEntityPiDedupeRow,
): boolean {
  if ((entity.websiteUrl || '').trim()) return false;
  if (![entity.websiteUrl, ...(entity.sourceUrls || [])].some(isOfficialYaleProfileUrl)) {
    return false;
  }

  const lastNameWords = normalizedWords(row.piLastName);
  if (lastNameWords.length === 0) return false;

  const words = normalizedWords(entity.name).filter(
    (word) => !['the', 'lab', 'laboratory', 'research'].includes(word),
  );
  if (words.length !== lastNameWords.length) return false;
  return words.every((word, index) => word === lastNameWords[index]);
}

/**
 * A well-formed lab record with its own website whose name reduces to just the
 * PI's surname (e.g. "Roy Lab") is deliberately excluded from
 * `isProfileBackedSurnameLabShell` (that guard requires no own website, to avoid
 * clustering two different people who merely share a surname when the personId
 * link is uncertain). But when the entity is joined to this row's person by a
 * direct PI `RoleAssignment` (`piRoleCorroborated`), the personId linkage is
 * already certain, so the surname-only lab may safely cluster with the same
 * person's first-name-bearing funding shell (issue #1113). This corroboration
 * is set only on RoleAssignment-joined entities, never on name-only rows, so the
 * website guard still holds where the linkage is uncertain.
 */
function isPiRoleCorroboratedSurnameLab(
  entity: ResearchEntityPiDedupeRow['entities'][number],
  row: ResearchEntityPiDedupeRow,
): boolean {
  if (entity.piRoleCorroborated !== true) return false;
  if (normalizedWords(row.piFirstName).length === 0) return false;
  const lastNameWords = normalizedWords(row.piLastName);
  if (lastNameWords.length === 0) return false;
  const words = normalizedWords(entity.name).filter(
    (word) => !['the', 'lab', 'laboratory', 'research'].includes(word),
  );
  if (words.length !== lastNameWords.length) return false;
  return words.every((word, index) => word === lastNameWords[index]);
}

function entityNameTrailsPiSurname(
  entity: ResearchEntityPiDedupeRow['entities'][number],
  row: ResearchEntityPiDedupeRow,
): boolean {
  const lastNameWords = normalizedWords(row.piLastName);
  if (lastNameWords.length === 0) return false;
  const words = normalizedWords(entity.name).filter(
    (word) => !['the', 'lab', 'laboratory', 'research'].includes(word),
  );
  if (words.length < lastNameWords.length) return false;
  const trailingWords = words.slice(-lastNameWords.length);
  return trailingWords.every((word, index) => word === lastNameWords[index]);
}

function comparablePiLabName(
  entity: ResearchEntityPiDedupeRow['entities'][number],
  row: ResearchEntityPiDedupeRow,
): string | null {
  const lastNameWords = normalizedWords(row.piLastName);
  if (lastNameWords.length === 0) return null;

  const firstNameTokens = new Set(normalizedWords(row.piFirstName));
  const words = normalizedWords(entity.name).filter(
    (word) => !['the', 'lab', 'laboratory', 'research'].includes(word),
  );
  if (words.length < lastNameWords.length) return null;

  const trailingLastNameWords = words.slice(-lastNameWords.length);
  const matchesTrailingLastName =
    trailingLastNameWords.length === lastNameWords.length &&
    trailingLastNameWords.every((word, index) => word === lastNameWords[index]);
  if (!matchesTrailingLastName) return null;

  const personPrefix = words.slice(0, words.length - lastNameWords.length);
  if (
    personPrefix.length === 0 &&
    !isProfileBackedSurnameLabShell(entity, row) &&
    !isPiRoleCorroboratedSurnameLab(entity, row)
  ) {
    return null;
  }
  const hasUnexpectedPrefix = personPrefix.some(
    (word) => word.length > 1 && !firstNameTokens.has(word),
  );
  if (hasUnexpectedPrefix) return null;

  return lastNameWords.join(' ');
}

function dedupeEntityClusters(
  row: ResearchEntityPiDedupeRow,
): ResearchEntityPiDedupeRow['entities'][] {
  const entities = row.entities.filter((entity) => entity.id);
  if (entities.length <= 1) return [];

  const parent = new Map<string, string>();
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  for (const entity of entities) parent.set(entity.id, entity.id);

  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const matchBuckets = new Map<string, string[]>();

  for (const entity of entities) {
    const exactName = normalizedEntityName(entity.name);
    if (exactName) {
      const key = `name:${exactName}`;
      matchBuckets.set(key, [...(matchBuckets.get(key) || []), entity.id]);
    }

    const piLabName = comparablePiLabName(entity, row);
    if (piLabName) {
      const key = `pi-lab:${piLabName}`;
      matchBuckets.set(key, [...(matchBuckets.get(key) || []), entity.id]);
    }
  }

  for (const ids of matchBuckets.values()) {
    const uniqueIds = Array.from(new Set(ids));
    for (const id of uniqueIds.slice(1)) union(uniqueIds[0], id);
  }

  const components = new Map<string, ResearchEntityPiDedupeRow['entities']>();
  for (const id of byId.keys()) {
    const root = find(id);
    components.set(root, [...(components.get(root) || []), byId.get(id)!]);
  }

  return Array.from(components.values()).filter((cluster) => cluster.length > 1);
}

function buildGroupFromCluster(
  row: ResearchEntityPiDedupeRow,
  entities: ResearchEntityPiDedupeRow['entities'],
  scoreEntity: (entity: ResearchEntityPiDedupeRow['entities'][number]) => number = canonicalScore,
): ResearchEntityPiDedupeGroup | null {
  if (entities.length <= 1) return null;

  const canonical = [...entities].sort((a, b) => {
    const byAppointment = primaryAppointmentRank(row, b) - primaryAppointmentRank(row, a);
    if (byAppointment !== 0) return byAppointment;
    const byScore = scoreEntity(b) - scoreEntity(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const duplicates = entities.filter((entity) => entity.id !== canonical.id);
  if (duplicates.length === 0) return null;
  const { canonicalName, canonicalWebsiteUrl } = carriedCanonicalIdentity(canonical, entities, row);
  const descriptionCarry = bestDescriptionCarryFromEntities(canonical, entities);
  const grantEvidenceCarry = mergedGrantEvidenceFromEntities(entities);
  const mergedResearchAreas = mergedResearchAreasFromEntities(entities, {
    sanitizeProfileChrome: true,
  });
  return {
    userId: row.userId,
    normalizedName: row.normalizedName,
    canonicalEntityId: canonical.id,
    duplicateEntityIds: duplicates.map((entity) => entity.id),
    canonicalSlug: canonical.slug,
    duplicateSlugs: duplicates.map((entity) => entity.slug || entity.id),
    mergedDepartments: mergeCorroboratedDepartments(entities, mergedResearchAreas),
    mergedResearchAreas,
    mergedSourceUrls: uniqueStrings([
      ...entities.flatMap((entity) => entity.sourceUrls || []),
      ...entities.map((entity) => entity.websiteUrl),
    ]),
    ...(canonicalName ? { canonicalName } : {}),
    ...(canonicalWebsiteUrl ? { canonicalWebsiteUrl } : {}),
    ...descriptionCarry,
    ...(grantEvidenceCarry.mergedRecentGrants.length > 0
      ? { mergedRecentGrants: grantEvidenceCarry.mergedRecentGrants }
      : {}),
    ...(grantEvidenceCarry.mergedRecentGrantCount > 0
      ? { mergedRecentGrantCount: grantEvidenceCarry.mergedRecentGrantCount }
      : {}),
    ...(grantEvidenceCarry.mergedFundingAgencies.length > 0
      ? { mergedFundingAgencies: grantEvidenceCarry.mergedFundingAgencies }
      : {}),
  };
}

function carriedCanonicalIdentity(
  canonical: ResearchEntityPiDedupeRow['entities'][number],
  entities: ResearchEntityPiDedupeRow['entities'],
  row: ResearchEntityPiDedupeRow,
): { canonicalName?: string; canonicalWebsiteUrl?: string } {
  if (concreteLabWebsiteForEntity(canonical)) return {};
  const donor = entities.find(
    (entity) => entity.id !== canonical.id && entityCarriesConcreteWebsite(entity),
  );
  if (!donor) return {};

  const donorName = (donor.name || '').trim();
  const canonicalNameIsPiDerivedPlaceholder = comparablePiLabName(canonical, row) !== null;
  return {
    canonicalName: canonicalNameIsPiDerivedPlaceholder && donorName ? donorName : undefined,
    canonicalWebsiteUrl: concreteLabWebsiteForEntity(donor),
  };
}

function buildProfileAreaShellDuplicateGroup(
  row: ResearchEntityPiDedupeRow,
): ResearchEntityPiDedupeGroup | null {
  const entities = row.entities.filter((entity) => entity.id);
  if (entities.length <= 1) return null;

  const profileAreaShells = entities.filter((entity) => isProfileAreaShellEntity(entity));
  const profileBackedSurnameShells = entities.filter((entity) =>
    isProfileBackedSurnameLabShell(entity, row),
  );
  // A PI-named lab stub with no concrete website of its own folds into a same-PI home only when
  // that home is topical - its own name does not trail the PI surname (issue #1113). Folding into
  // a surname-named concrete home instead (e.g. "Townsend Lab") would cluster on a bare shared
  // surname whose personId link is uncorroborated, exactly the homonym risk #1138's guard exists
  // to reject, so a surname-only home never absorbs a person-named shell on name evidence alone.
  // Require exactly one concrete-website home too (issue #1136): when the person runs several
  // concrete-website labs the stub cannot be routed to the right one by name, so defer instead of
  // mis-merging it into the highest-scoring home.
  const concreteWebsiteHomeCount = entities.filter((entity) =>
    entityCarriesConcreteWebsite(entity),
  ).length;
  const hasTopicalConcreteWebsiteHome = entities.some(
    (entity) => entityCarriesConcreteWebsite(entity) && !entityNameTrailsPiSurname(entity, row),
  );
  const personNamedPiLabShells =
    hasTopicalConcreteWebsiteHome && concreteWebsiteHomeCount === 1
      ? entities.filter((entity) => comparablePiLabName(entity, row) !== null)
      : [];
  // An entity that carries its own real (non-profile, non-funding) lab website is the
  // concrete research home, not a thin profile-area shell - never archive it into a
  // PI-derived grant "<PI> Lab" shell and discard its name/site (issue #456).
  const shellCandidatesById = new Map<string, ResearchEntityPiDedupeRow['entities'][number]>();
  for (const entity of [
    ...profileAreaShells,
    ...profileBackedSurnameShells,
    ...personNamedPiLabShells,
  ]) {
    if (!entityCarriesConcreteWebsite(entity)) shellCandidatesById.set(entity.id, entity);
  }
  const duplicateShells = [...shellCandidatesById.values()];
  const duplicateShellIds = new Set(duplicateShells.map((entity) => entity.id));
  // A professor's eponymous profile-area/lab shell folds into their own lab, never into a
  // CENTER or INSTITUTE they merely belong to: center memberships are separate entities tracked
  // via RoleAssignment / ResearchEntityRelationship, so a center must never be selected as the
  // canonical survivor of an FRA-shadow merge (issue #1957). This exclusion is scoped to this
  // FRA-shadow selection path only; isConcreteResearchHomeEntity stays unchanged because the
  // CENTER-only org-dedupe lane relies on it.
  const concreteHomes = entities.filter((entity) => {
    if (duplicateShellIds.has(entity.id)) return false;
    if (isFundingOnlyEntity(entity)) return false;
    if (isCenterOrInstituteEntity(entity)) return false;
    if (entityCarriesConcreteWebsite(entity)) return true;
    if (!isConcreteResearchHomeEntity(entity)) return false;
    if (profileAreaShells.length > 0) return true;
    return [entity.websiteUrl, ...(entity.sourceUrls || [])].some(isOfficialYaleLabUrl);
  });
  if (duplicateShells.length === 0 || concreteHomes.length === 0) return null;

  const canonical = [...concreteHomes].sort((a, b) => {
    const byAppointment = primaryAppointmentRank(row, b) - primaryAppointmentRank(row, a);
    if (byAppointment !== 0) return byAppointment;
    const byScore = canonicalScore(b) - canonicalScore(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const duplicates = duplicateShells.filter((entity) => entity.id !== canonical.id);
  if (duplicates.length === 0) return null;

  const group = buildGroupFromCluster(
    withoutPrimaryAppointmentPreference(row),
    [canonical, ...duplicates],
    (entity) => (entity.id === canonical.id ? Number.MAX_SAFE_INTEGER : canonicalScore(entity)),
  );
  if (!group) return null;
  return {
    ...group,
    dedupeCategory: 'profile_area_shell_with_concrete_home',
  };
}

function dedupePlanGroupsByEntitySet(
  groups: ResearchEntityPiDedupeGroup[],
): ResearchEntityPiDedupeGroup[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = [group.canonicalEntityId, ...group.duplicateEntityIds].sort().join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildResearchEntityPiDedupePlan(
  rows: ResearchEntityPiDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  return rows.flatMap((row) => {
    const profileAreaGroup = buildProfileAreaShellDuplicateGroup(row);
    const genericGroups = dedupeEntityClusters(row)
      .map((cluster) => buildGroupFromCluster(row, cluster))
      .filter((group): group is ResearchEntityPiDedupeGroup => !!group);
    const profileAreaGroupShouldWin = profileAreaGroup?.duplicateSlugs.some((slug) =>
      String(slug || '').startsWith('faculty-research-area-'),
    );
    const groups = profileAreaGroupShouldWin
      ? [profileAreaGroup, ...genericGroups]
      : [...genericGroups, profileAreaGroup];
    return dedupePlanGroupsByEntitySet(
      groups.filter((group): group is ResearchEntityPiDedupeGroup => !!group),
    );
  });
}

/**
 * The duplicate ids from a same-lead dedupe plan, restricted so only a record the
 * person is PI of can be CALLED a duplicate.
 *
 * Grouping a person's records by any lead role is what lets their real lab join the
 * group holding their synthesized placeholder row. Left unconstrained the same
 * widening does the reverse: measured on Development it newly flagged a cancer
 * centre and two labs carrying their own sites, because someone who DIRECTS a
 * research home and leads labs has all of them in one group and the dedupe picks a
 * single canonical. Directing a research home is not duplicating it, so a
 * non-PI-led home may only ever be the canonical.
 *
 * A name-only group carries no PI claim for its user, so it keeps deciding on its
 * own evidence and is passed through untouched.
 */
export function piLedRestrictedDuplicateEntityIds(
  group: ResearchEntityPiDedupeGroup,
  isPiLed: (userId: string, entityId: string) => boolean,
): string[] {
  return (group.duplicateEntityIds || []).filter(
    (entityId) => !group.normalizedName.startsWith('same-pi:') || isPiLed(group.userId, entityId),
  );
}

export function samePiDuplicateEntityIdsRestrictedToPiLed(
  groups: ResearchEntityPiDedupeGroup[],
  isPiLed: (userId: string, entityId: string) => boolean,
): string[] {
  return groups.flatMap((group) => piLedRestrictedDuplicateEntityIds(group, isPiLed));
}

export function selectSamePiDuplicateRiskEntityIds(rows: ResearchEntityPiDedupeRow[]): Set<string> {
  return new Set(
    buildResearchEntityPiDedupePlan(rows).flatMap((group) => group.duplicateEntityIds || []),
  );
}

function fullestText(
  entities: ResearchEntityPiDedupeRow['entities'],
  field: 'fullDescription' | 'shortDescription',
): string {
  return (
    entities
      .map((entity) => (entity[field] || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || ''
  );
}

function bestDescriptionCarry(
  canonical: ResearchEntityPiDedupeRow['entities'][number],
  entities: ResearchEntityPiDedupeRow['entities'],
): { canonicalFullDescription?: string; canonicalShortDescription?: string } {
  const carry: { canonicalFullDescription?: string; canonicalShortDescription?: string } = {};
  const canonicalFull = (canonical.fullDescription || '').trim();
  const fullest = fullestText(entities, 'fullDescription');
  if (fullest && fullest.length > canonicalFull.length) carry.canonicalFullDescription = fullest;
  const canonicalShort = (canonical.shortDescription || '').trim();
  const fullestShort = fullestText(entities, 'shortDescription');
  if (fullestShort && fullestShort.length > canonicalShort.length) {
    carry.canonicalShortDescription = fullestShort;
  }
  return carry;
}

function bestDescriptionCarryFromEntities(
  canonical: ResearchEntityPiDedupeRow['entities'][number],
  entities: ResearchEntityPiDedupeRow['entities'],
): { canonicalFullDescription?: string; canonicalShortDescription?: string } {
  return bestDescriptionCarry(canonical, trustedAreaShellEntities(entities));
}

function entityPersonIdSets(rows: ResearchEntityPiDedupeRow[]): Map<string, Set<string>> {
  const byEntity = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const entity of row.entities) {
      if (!entity.id) continue;
      const persons = byEntity.get(entity.id) || new Set<string>();
      persons.add(row.userId);
      byEntity.set(entity.id, persons);
    }
  }
  return byEntity;
}

function multiPersonEntityIds(rows: ResearchEntityPiDedupeRow[]): Set<string> {
  const ids = new Set<string>();
  for (const [entityId, persons] of entityPersonIdSets(rows)) {
    if (persons.size > 1) ids.add(entityId);
  }
  return ids;
}

export function buildSharedPersonIdResearchEntityDedupePlan(
  rows: ResearchEntityPiDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  const sharedEntityIds = multiPersonEntityIds(rows);
  return rows.flatMap((row) => {
    const entities = row.entities.filter((entity) => entity.id && !sharedEntityIds.has(entity.id));
    if (entities.length <= 1) return [];
    const group = buildGroupFromCluster(row, entities);
    if (!group) return [];
    return [{ ...group, dedupeCategory: 'shared_person_id' as const }];
  });
}

export function buildMultiPersonEntityQuarantine(
  rows: ResearchEntityPiDedupeRow[],
): MultiPersonEntityQuarantine[] {
  const slugByEntity = new Map<string, string | undefined>();
  for (const row of rows) {
    for (const entity of row.entities) {
      if (!entity.id) continue;
      if (!slugByEntity.has(entity.id)) slugByEntity.set(entity.id, entity.slug);
    }
  }
  return Array.from(entityPersonIdSets(rows).entries())
    .filter(([, persons]) => persons.size > 1)
    .map(([id, persons]) => ({
      id,
      slug: slugByEntity.get(id),
      personIds: Array.from(persons),
    }));
}

export function buildSameNameDifferentPersonQuarantine(
  rows: ResearchEntityPiDedupeRow[],
): SameNameDifferentPersonQuarantine[] {
  const byName = new Map<string, Array<{ id: string; slug?: string; personId: string }>>();
  for (const row of rows) {
    for (const entity of row.entities) {
      if (!entity.id) continue;
      const normalized = normalizedEntityName(entity.name);
      if (!normalized) continue;
      const list = byName.get(normalized) || [];
      list.push({ id: entity.id, slug: entity.slug, personId: row.userId });
      byName.set(normalized, list);
    }
  }
  return Array.from(byName.entries())
    .filter(([, list]) => new Set(list.map((item) => item.personId)).size > 1)
    .map(([normalizedName, entities]) => ({ normalizedName, entities }));
}

function buildFundingGroupFromCluster(
  row: ResearchEntityPiDedupeRow,
  entities: ResearchEntityPiDedupeRow['entities'],
): ResearchEntityPiDedupeGroup | null {
  const fundingDuplicates = entities.filter(isFundingOnlyEntity);
  const canonicalCandidates = entities.filter((entity) => !isFundingOnlyEntity(entity));
  const yaleBackedCandidates = canonicalCandidates.filter(hasYaleEvidence);
  if (fundingDuplicates.length === 0 || yaleBackedCandidates.length === 0) return null;

  const canonical = [...yaleBackedCandidates].sort((a, b) => {
    const byScore = fundingCanonicalScore(b) - fundingCanonicalScore(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const descriptionCarry = bestDescriptionCarryFromEntities(canonical, entities);
  const grantEvidenceCarry = mergedGrantEvidenceFromEntities(entities);
  const mergedResearchAreas = mergedResearchAreasFromEntities(entities, {
    sanitizeProfileChrome: true,
  });

  return {
    userId: row.userId,
    normalizedName: row.normalizedName,
    canonicalEntityId: canonical.id,
    duplicateEntityIds: fundingDuplicates.map((entity) => entity.id),
    canonicalSlug: canonical.slug,
    duplicateSlugs: fundingDuplicates.map((entity) => entity.slug || entity.id),
    mergedDepartments: mergeCorroboratedDepartments(entities, mergedResearchAreas),
    mergedResearchAreas,
    mergedSourceUrls: uniqueStrings([
      ...entities.flatMap((entity) => entity.sourceUrls || []),
      ...entities.map((entity) => entity.websiteUrl),
    ]),
    ...descriptionCarry,
    ...(grantEvidenceCarry.mergedRecentGrants.length > 0
      ? { mergedRecentGrants: grantEvidenceCarry.mergedRecentGrants }
      : {}),
    ...(grantEvidenceCarry.mergedRecentGrantCount > 0
      ? { mergedRecentGrantCount: grantEvidenceCarry.mergedRecentGrantCount }
      : {}),
    ...(grantEvidenceCarry.mergedFundingAgencies.length > 0
      ? { mergedFundingAgencies: grantEvidenceCarry.mergedFundingAgencies }
      : {}),
  };
}

export function buildFundingResearchEntityDedupePlan(
  rows: ResearchEntityPiDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  return rows.flatMap((row) =>
    dedupeEntityClusters(row)
      .map((cluster) => buildFundingGroupFromCluster(row, cluster))
      .filter((group): group is ResearchEntityPiDedupeGroup => !!group),
  );
}

export function buildOfficialLabUrlResearchEntityDedupePlan(
  rows: OfficialLabUrlDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  const officialLabUrlScore = (entity: ResearchEntityPiDedupeRow['entities'][number]) =>
    canonicalScore(entity) + (isFullPersonLabName(entity.name) ? 12 : 0);

  return rows
    .filter((row) => isOfficialYaleLabUrl(row.url))
    .map((row) =>
      buildGroupFromCluster(
        {
          userId: `official-lab-url:${row.url}`,
          normalizedName: `official-lab-url:${row.url}`,
          entities: row.entities,
        },
        row.entities,
        officialLabUrlScore,
      ),
    )
    .filter((group): group is ResearchEntityPiDedupeGroup => !!group);
}

const PERSON_LEAD_NAME_STOPWORDS = new Set([
  'the',
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'research',
  'group',
  'groups',
  'center',
  'centre',
  'institute',
  'program',
  'faculty',
]);

/**
 * Normalizes a websiteUrl into a scheme-agnostic identity key: the same lab home
 * reached over `http://` and `https://`, with or without a trailing slash or a
 * leading `www.`, must collapse to one key so a URL-identity lane clusters them.
 * Query strings and fragments are dropped; an unparseable value yields ''.
 */
export function normalizeWebsiteUrlIdentityKey(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${host}${pathname}`;
}

const WEBSITE_URL_IDENTITY_KEY_SCHEMES = ['https://', 'http://'];
const WEBSITE_URL_IDENTITY_KEY_HOST_PREFIXES = ['', 'www.'];

/**
 * Every stored `websiteUrl` spelling that `normalizeWebsiteUrlIdentityKey` folds into
 * `key`, so a caller can look the key up with an equality query rather than storing a
 * second normalized copy of the URL on the row (#3036).
 *
 * Changing `normalizeWebsiteUrlIdentityKey` requires changing this with it: they are an
 * encoder and its inverse, and the inverse only recovers what the encoder drops
 * reversibly - the scheme, a leading `www.`, and a trailing slash. A URL carrying a
 * query string or a fragment cannot be recovered, because the encoder discards those
 * without recording them; measured on Development, 7 of 1,763 live `websiteUrl` values
 * are in that residue and none of them is a resolver target.
 */
export function websiteUrlIdentityKeyVariants(key: string): string[] {
  const trimmed = key.trim();
  if (!trimmed) return [];
  const variants: string[] = [];
  for (const scheme of WEBSITE_URL_IDENTITY_KEY_SCHEMES) {
    for (const hostPrefix of WEBSITE_URL_IDENTITY_KEY_HOST_PREFIXES) {
      variants.push(`${scheme}${hostPrefix}${trimmed}`);
      variants.push(`${scheme}${hostPrefix}${trimmed}/`);
    }
  }
  return variants;
}

const PERSON_PROFILE_URL_PATH = /\/(?:profile|people|person)\/([a-z0-9._-]+)$/i;

const PERSON_PROFILE_URL_LEAF = /^[a-z0-9._-]+$/i;

/**
 * The person slug on a host that nests a category between its person-page prefix
 * and the person, which `PERSON_PROFILE_URL_PATH` cannot see because it requires
 * the slug to sit directly under `profile`, `people` or `person`. So
 * `eeb.yale.edu/people/faculty/<person>` and
 * `environment.yale.edu/directory/faculty/<person>` were invisible to the
 * conflation refusal, and `directory` was not in the pattern at all (#2750).
 *
 * The prefixes come from `yalePersonPagePrefix`, which already owns this per host
 * from stored citations that were then live-probed, rather than from a second list
 * here that could disagree with it.
 *
 * A root-mapped host is deliberately excluded. Where the recorded prefix is empty
 * the path asserts nothing about the leaf, so `law.yale.edu/<anything>` would read
 * as somebody's profile; `isCorroboratedPersonPageUrl` refuses those on the same
 * ground and asks for a name match instead, which this caller has no name to make.
 * Widening here only ever refuses a merge, so a false identity costs a correct
 * merge rather than producing a wrong one, which is why the safe half of #2750's
 * suggestion is taken and the "allow any intermediate segment" half is not.
 */
function hostMappedPersonPageSlug(parsed: URL): string {
  const entry = personPagePrefixesForHost(parsed.hostname);
  if (!entry) return '';
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  const leaf = parts[parts.length - 1];
  if (!PERSON_PROFILE_URL_LEAF.test(leaf)) return '';
  const prefix = parts.slice(0, -1).join('/').toLowerCase();
  if (!prefix) return '';
  const mapped = [...entry.current, ...(entry.legacy || [])].some(
    (candidate) => candidate.toLowerCase() === prefix,
  );
  return mapped ? leaf : '';
}

const PERSON_PROFILE_CREDENTIAL_SUFFIX =
  /-(?:phd|md|mph|ms|msc|mba|ma|dvm|rn|do|dds|scd|edd|jd|jr|sr|ii|iii|iv)$/;

// A collection page, not a person. `/people/<x>` is a person on some directories and
// a listing subpage on others, and a lab-microsite crawl puts both into `sourceUrls`.
const PERSON_PROFILE_COLLECTION_TOKENS = new Set([
  'about',
  'alumni',
  'contact',
  'directory',
  'faculty',
  'group',
  'home',
  'index',
  'lab',
  'labs',
  'member',
  'members',
  'news',
  'our',
  'affiliates',
  'emeriti',
  'fellows',
  'instructors',
  'investigators',
  'leadership',
  'lecturers',
  'people',
  'person',
  'personnel',
  'postdocs',
  'profile',
  'profiles',
  'professor',
  'professors',
  'publications',
  'research',
  'researchers',
  'scholars',
  'staff',
  'students',
  'team',
  'trainees',
  'us',
]);

function personNameTokens(slug: string): string[] {
  return slug
    .split(/[-._]+/)
    .filter((token) => token.length > 1 && !/^\d+$/.test(token))
    .sort();
}

/**
 * The person a `/profile/<slug>` style URL names, as an order-, initial- and
 * credential-agnostic identity: `.../profile/ada-lovelace-phd` and
 * `.../profile/ada-lovelace` are one person, so are `min-wu` and `wu-min`
 * because directories publish the same person under both orders, and so are
 * `ada-b-lovelace` and `ada-lovelace` because only one directory carries the
 * middle initial. A trailing birth-death lifespan is dropped for the same reason
 * (see `stripPersonNameLifespanSuffix`): only some directories publish it, and it
 * names no additional person.
 *
 * A credential suffix is only stripped while two name tokens survive, because the
 * abbreviation list collides with real surnames: `Ma`, `Do`, and `Ms` are surnames,
 * so `/profile/lei-ma` must stay a person rather than decaying to '' and silently
 * disabling the conflation refusal for whoever it names. A single surviving token is
 * an identity for the same reason: a mononym directory slug such as `/profile/clark`
 * names a person, and reading it as "names no person" would switch the refusal off
 * for the very group that needs it.
 *
 * Returns '' only for a URL that names no person. That includes a collection page, so
 * a `/people/lab-members` or `/people/our-team` subpage is not read as a person named
 * "Lab Members". Unrecognised non-person slugs can still yield an identity, which
 * only ever refuses a merge, so the residual error is a missed merge and never a
 * wrong one.
 */
export function personProfileIdentityFromUrl(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  const match = parsed.pathname.replace(/\/+$/, '').match(PERSON_PROFILE_URL_PATH);
  const rawSlug = match ? match[1] : hostMappedPersonPageSlug(parsed);
  if (!rawSlug) return '';
  let slug = rawSlug.toLowerCase();
  for (;;) {
    if (!PERSON_PROFILE_CREDENTIAL_SUFFIX.test(slug)) break;
    const stripped = slug.replace(PERSON_PROFILE_CREDENTIAL_SUFFIX, '');
    if (personNameTokens(stripped).length < 2) break;
    slug = stripped;
  }
  const tokens = personNameTokens(slug);
  if (tokens.length === 0) return '';
  if (tokens.some((token) => PERSON_PROFILE_COLLECTION_TOKENS.has(token))) return '';
  return tokens.join('-');
}

export function distinctPersonProfileIdentities(urls: readonly string[] | undefined): string[] {
  const identities = new Set<string>();
  for (const url of urls || []) {
    const identity = personProfileIdentityFromUrl(url);
    if (identity) identities.add(identity);
  }
  return Array.from(identities).sort();
}

/**
 * Refuses on the group's pooled evidence rather than per entity, so a single row that
 * cites two directors' profiles refuses its own group too. That is deliberate: the
 * group carries only `mergedSourceUrls`, and a co-directed lab is exactly the shape
 * this cannot tell apart from a lab plus one of its members. The cost is a missed
 * merge for a co-directed lab, and the refusal is unconditional: it runs before the
 * plan the decision template is built from, so a quarantined group never reaches an
 * operator's `--accepted-decisions` file and no reviewed decision can override it.
 * Merging one takes correcting the conflating evidence first - dropping the other
 * person's profile URL from the row that should not cite it.
 *
 * A merge group whose evidence names two or more different people is not a
 * duplicate pair: every member of a lab legitimately cites the lab's own URL, so a
 * site-wide identity key clusters a member's profile row with the lab itself. It was a
 * large fraction of the URL-keyed lanes on Development (#2724); read the current rate
 * from `quarantinedConflatedPersonProfileGroups` in a dry-run report, as
 * `docs/research-entity-pi-dedupe-runbook.md` describes. `multiPersonEntityQuarantine`
 * cannot see it because it keys on RoleAssignment links, which these rows do not carry.
 */
export function groupConflatesDistinctPersonProfiles(
  group: Pick<ResearchEntityPiDedupeGroup, 'mergedSourceUrls'>,
): boolean {
  return distinctPersonProfileIdentities(group.mergedSourceUrls).length > 1;
}

export function partitionPlanByPersonProfileConflation<
  T extends Pick<
    ResearchEntityPiDedupeGroup,
    'mergedSourceUrls' | 'canonicalEntityId' | 'canonicalSlug' | 'duplicateSlugs'
  >,
>(groups: readonly T[]): { plan: T[]; quarantine: ConflatedPersonProfileQuarantine[] } {
  const plan: T[] = [];
  const quarantine: ConflatedPersonProfileQuarantine[] = [];
  for (const group of groups) {
    if (groupConflatesDistinctPersonProfiles(group)) {
      quarantine.push({
        canonicalEntityId: group.canonicalEntityId,
        canonicalSlug: group.canonicalSlug,
        duplicateSlugs: group.duplicateSlugs,
        personProfileIdentities: distinctPersonProfileIdentities(group.mergedSourceUrls),
      });
      continue;
    }
    plan.push(group);
  }
  return { plan, quarantine };
}

const SPECIFIC_PROFILE_LAB_URL_ENTITY_TYPES = new Set(['LAB', 'FACULTY_RESEARCH_AREA']);

const SPECIFIC_PROFILE_LAB_URL_PATH = /\/(lab|profile)\/([^/]+)$/i;

export function specificProfileLabUrlIdentityKey(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!(host === 'yale.edu' || host.endsWith('.yale.edu'))) return '';
  const match = parsed.pathname.replace(/\/+$/, '').match(SPECIFIC_PROFILE_LAB_URL_PATH);
  if (!match) return '';
  return `${host}/${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
}

const PERSON_SLUG_NAME = /(?:^|-)(?:faculty|dept-[a-z]+)-([a-z]+(?:-[a-z]+)+)$/;

/**
 * The surname a person-derived slug (`...faculty-<first>-<last>` or
 * `dept-<dept>-<first>-<last>`) encodes, or '' for
 * a clean lab slug (`ysm-<labname>`) or a bare-netid slug (`ysm-faculty-gcb27`) that
 * names no person. Used to keep a lab member whose own profile was minted under the
 * lab's name and URL ("Braddock Lab" on `ysm-faculty-hajime-kato`) from folding into
 * the namesake's lab: the names agree but the slugs name different people.
 */
function slugPersonSurname(slug: string | undefined): string {
  const match = (slug || '').toLowerCase().match(PERSON_SLUG_NAME);
  if (!match) return '';
  const parts = match[1].split('-');
  return parts[parts.length - 1];
}

function sharedNameSurname(entities: ResearchEntityPiDedupeRow['entities']): string {
  for (const entity of entities) {
    const tokens = personLeadNameTokens(entity.name);
    if (tokens.length > 0) return tokens[tokens.length - 1];
  }
  return '';
}

const specificProfileLabUrlCanonicalScore = (
  entity: ResearchEntityPiDedupeRow['entities'][number],
): number =>
  canonicalScore(entity) +
  (entity.entityType === 'LAB' ? 40 : 0) +
  (slugPersonSurname(entity.slug) === '' ? 15 : 0);

/**
 * `clusterEntitiesBySharedLeadPersonIdentity` unions transitively, so a bare-surname
 * node ("Smith Lab") can bridge two entities with explicit, conflicting first
 * names ("John Smith Lab" and "Robert Smith Lab") into one cluster even though the
 * two people never share a name directly. Merging that cluster would collapse two
 * different people, so reject any cluster that still contains a first-name conflict
 * after union-find: some pair shares the surname but carries disjoint, non-empty
 * first-name sets.
 */
export function clusterHasConflictingLeadFirstNames(
  entities: ResearchEntityPiDedupeRow['entities'],
): boolean {
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const tokensA = personLeadNameTokens(entities[i].name);
      const tokensB = personLeadNameTokens(entities[j].name);
      if (tokensA.length === 0 || tokensB.length === 0) continue;
      if (tokensA[tokensA.length - 1] !== tokensB[tokensB.length - 1]) continue;
      const firstNamesA = new Set(tokensA.slice(0, -1));
      const firstNamesB = new Set(tokensB.slice(0, -1));
      if (firstNamesA.size === 0 || firstNamesB.size === 0) continue;
      let shareFirstName = false;
      for (const token of firstNamesA) {
        if (firstNamesB.has(token)) {
          shareFirstName = true;
          break;
        }
      }
      if (!shareFirstName) return true;
    }
  }
  return false;
}

/**
 * Clusters entities that share a specific per-entity Yale page - a `/lab/<x>` or
 * `/profile/<x>` path - and folds them into one research home. The shared URL is a
 * strong same-entity key (one lab per lab page, one person per profile page), but a
 * URL match alone must not collapse two DIFFERENT people who happen to share a
 * surname or co-cite a page, so the same `clusterEntitiesBySharedLeadPersonIdentity`
 * gate the websiteUrl lane uses still applies: "John Smith Lab" and
 * "Jane Smith Lab" stay split. A concrete LAB is preferred as canonical so a
 * FACULTY_RESEARCH_AREA facet on the same profile folds into the lab rather than the
 * reverse. Funding shells and non {LAB, FACULTY_RESEARCH_AREA} types (a CENTER
 * or CORE_FACILITY the person merely belongs to) are excluded from this lane.
 */
export function buildSpecificProfileLabUrlResearchEntityDedupePlan(
  rows: OfficialLabUrlDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  const groups: ResearchEntityPiDedupeGroup[] = [];
  for (const row of rows) {
    const key = specificProfileLabUrlIdentityKey(row.url);
    if (!key) continue;
    const entities = row.entities.filter((entity) => entity.id);
    if (entities.length <= 1) continue;
    if (entities.some((entity) => isFundingShellSlug(entity.slug))) continue;
    if (
      !entities.every((entity) =>
        SPECIFIC_PROFILE_LAB_URL_ENTITY_TYPES.has(entity.entityType || ''),
      )
    ) {
      continue;
    }
    for (const cluster of clusterEntitiesBySharedLeadPersonIdentity(entities)) {
      const group = buildGroupFromCluster(
        {
          userId: `profile-lab-url:${key}`,
          normalizedName: `profile-lab-url:${key}`,
          entities: cluster,
        },
        cluster,
        specificProfileLabUrlCanonicalScore,
      );
      if (group) groups.push(group);
    }
  }
  return dedupePlanGroupsByEntitySet(groups);
}

function personLeadNameTokens(name: string | undefined): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PERSON_LEAD_NAME_STOPWORDS.has(token));
}

/**
 * Two entities sharing an identical websiteUrl are only the same lab if their
 * names agree on a person lead-name: the same trailing surname token plus a
 * compatible (or absent) first name. This is what separates a same-person clone
 * ("The Zimmerman Lab" / "Julie Zimmerman Lab") from a shared group/center site
 * hosting several distinct faculty (het.yale.edu across four physicists), which
 * have no shared surname and must never collapse (issue #1130).
 */
export function entitiesShareLeadPersonName(
  a: ResearchEntityPiDedupeRow['entities'][number],
  b: ResearchEntityPiDedupeRow['entities'][number],
): boolean {
  const tokensA = personLeadNameTokens(a.name);
  const tokensB = personLeadNameTokens(b.name);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  if (tokensA[tokensA.length - 1] !== tokensB[tokensB.length - 1]) return false;

  const firstNamesA = new Set(tokensA.slice(0, -1));
  const firstNamesB = new Set(tokensB.slice(0, -1));
  if (firstNamesA.size === 0 || firstNamesB.size === 0) return true;
  const [smaller, larger] =
    firstNamesA.size <= firstNamesB.size ? [firstNamesA, firstNamesB] : [firstNamesB, firstNamesA];
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

function dropClusterMembersWhoseSlugNamesAnotherPerson(
  cluster: ResearchEntityPiDedupeRow['entities'],
): ResearchEntityPiDedupeRow['entities'] {
  const identitySurname = sharedNameSurname(cluster);
  return cluster.filter((entity) => {
    const personSurname = slugPersonSurname(entity.slug);
    return !personSurname || personSurname === identitySurname;
  });
}

/**
 * Every URL-keyed lane merges on the same claim - these rows are one person's
 * research home - so the two refusals that make a transitively unioned cluster
 * safe belong to the clustering itself rather than to one lane's call site. A
 * lane that took the raw union-find components would collapse two distinct
 * same-surname people through a first-name-less bridge row, which is exactly the
 * defect the guards were written for (#1130, #2581).
 */
function clusterEntitiesBySharedLeadPersonIdentity(
  entities: ResearchEntityPiDedupeRow['entities'],
): ResearchEntityPiDedupeRow['entities'][] {
  const parent = new Map<string, string>();
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  for (const entity of entities) parent.set(entity.id, entity.id);
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      if (entitiesShareLeadPersonName(entities[i], entities[j])) {
        union(entities[i].id, entities[j].id);
      }
    }
  }

  const components = new Map<string, ResearchEntityPiDedupeRow['entities']>();
  for (const id of byId.keys()) {
    const root = find(id);
    components.set(root, [...(components.get(root) || []), byId.get(id)!]);
  }
  return Array.from(components.values())
    .filter((cluster) => cluster.length > 1)
    .filter((cluster) => !clusterHasConflictingLeadFirstNames(cluster))
    .map(dropClusterMembersWhoseSlugNamesAnotherPerson)
    .filter((cluster) => cluster.length > 1);
}

/**
 * The entity types the `--org-name-only` lane owns. A URL shared between one of
 * these and a person's research home is that person citing the organization's page,
 * not one entity named twice, so a URL-keyed person lane must not pair the two: on
 * Development the websiteUrl lane planned to archive a served `CORE_FACILITY` into a
 * suppressed person row that had been minted under the facility's own name (#2581).
 * Keyed on the org lane's own constant so the two lanes' vocabularies cannot drift.
 */
function isSharedOrganizationEntityType(entityType: string | undefined): boolean {
  return (ORG_NAME_DEDUPE_ENTITY_TYPES as readonly string[]).includes(entityType || '');
}

function isDistinctiveNonFundingWebsiteHost(value: string | undefined): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  if (isFundingSourceUrl(trimmed)) return false;
  try {
    return isDistinctiveOrgHost(new URL(trimmed));
  } catch {
    return false;
  }
}

/**
 * Clusters non-archived entities that share an identical (scheme/slash/www
 * normalized) websiteUrl and agree on a person lead-name. The canonical survivor
 * is the entity with an active PI RoleAssignment and the richer evidence, so a
 * newer PI-bio clone folds into the established lab. Groups that involve a
 * low-trust `faculty-research-area-` shell are left to the profile-area lane,
 * and shared group/center sites are excluded by the lead-name gate (issue
 * #1130). A `nih-pi-`/`nsf-pi-` funding shell is excluded too unless the shared
 * websiteUrl is a distinctive non-funding host - a real personal lab site,
 * rather than shared Yale evidence a funding-only shell could carry on its own
 * (issue #1147) - since the lead-name gate and the funding-slug canonical-score
 * penalty already keep the merge person-scoped and the concrete home canonical.
 * A shared organizational home is dropped from the cluster rather than refusing the
 * whole URL, for the reason `isSharedOrganizationEntityType` records: a centre's own
 * page is legitimately cited by several people, so refusing the URL outright would
 * also refuse the same-person duplicates citing it.
 */
export function buildWebsiteUrlResearchEntityDedupePlan(
  rows: WebsiteUrlDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  const websiteUrlCanonicalScore = (entity: ResearchEntityPiDedupeRow['entities'][number]) =>
    canonicalScore(entity) + (entity.piRoleCorroborated ? 200 : 0);

  const groups: ResearchEntityPiDedupeGroup[] = [];
  for (const row of rows) {
    const key = normalizeWebsiteUrlIdentityKey(row.websiteUrl);
    if (!key) continue;
    const cited = row.entities.filter((entity) => entity.id);
    if (cited.length <= 1) continue;
    if (cited.some((entity) => isAreaShellSlug(entity.slug))) continue;
    const entities = cited.filter((entity) => !isSharedOrganizationEntityType(entity.entityType));
    if (entities.length <= 1) continue;
    const hasFundingShellEntity = entities.some((entity) => isFundingShellSlug(entity.slug));
    if (hasFundingShellEntity && !isDistinctiveNonFundingWebsiteHost(row.websiteUrl)) continue;

    for (const cluster of clusterEntitiesBySharedLeadPersonIdentity(entities)) {
      const group = buildGroupFromCluster(
        {
          userId: `website-url:${key}`,
          normalizedName: `website-url:${key}`,
          entities: cluster,
        },
        cluster,
        websiteUrlCanonicalScore,
      );
      if (group) groups.push(group);
    }
  }
  return dedupePlanGroupsByEntitySet(groups);
}

export interface OrgNameDedupeEntity {
  id: string;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  websiteUrl?: string;
  fullDescription?: string;
  shortDescription?: string;
  sourceUrls?: string[];
  departments?: string[];
  researchAreas?: string[];
  memberCount?: number;
  hasAttachedPi?: boolean;
}

export const ORG_NAME_DEDUPE_ENTITY_TYPES = [
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
] as const;

const ORG_NAME_STOPWORDS = new Set([
  'the',
  'of',
  'for',
  'and',
  'at',
  'a',
  'an',
  'to',
  'in',
  'on',
  'yale',
]);

const ORG_TYPE_NAME_TOKENS = new Set([
  'center',
  'centre',
  'centers',
  'institute',
  'institutes',
  'initiative',
  'initiatives',
  'program',
  'programme',
  'programs',
  'group',
  'groups',
  'core',
  'cores',
  'facility',
  'facilities',
  'laboratory',
  'lab',
  'project',
  'projects',
]);

const ORG_DEDUPE_UMBRELLA_HOSTS = new Set(['yale.edu', 'www.yale.edu', 'research.yale.edu']);

function orgNameTokens(name: string | undefined): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !ORG_NAME_STOPWORDS.has(token));
}

export function normalizeOrgDedupeName(name: string | undefined): string {
  return orgNameTokens(name).join(' ');
}

function significantOrgNameTokens(name: string | undefined): string[] {
  return orgNameTokens(name).filter((token) => !ORG_TYPE_NAME_TOKENS.has(token));
}

function isDistinctiveOrgHost(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (ORG_DEDUPE_UMBRELLA_HOSTS.has(host)) return false;
  if (/(^|\.)yale\.edu$/i.test(url.hostname)) return isCustomYaleResearchHomeSubdomain(url);
  return true;
}

function isDistinctiveOrgHostUrl(value: string): boolean {
  try {
    return isDistinctiveOrgHost(new URL(value));
  } catch {
    return false;
  }
}

function orgCorroborationHosts(entity: OrgNameDedupeEntity): string[] {
  const hosts: string[] = [];
  for (const value of [entity.websiteUrl, ...(entity.sourceUrls || [])]) {
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (!isDistinctiveOrgHost(url)) continue;
    hosts.push(url.hostname.toLowerCase().replace(/^www\./, ''));
  }
  return Array.from(new Set(hosts));
}

function orgGroupSharesDistinctiveHost(entities: OrgNameDedupeEntity[]): boolean {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    for (const host of orgCorroborationHosts(entity)) {
      counts.set(host, (counts.get(host) || 0) + 1);
    }
  }
  return Array.from(counts.values()).some((count) => count >= 2);
}

function hasPiFreeOrgNameAnchor(entities: OrgNameDedupeEntity[]): boolean {
  return entities.some((entity) => !entity.hasAttachedPi);
}

export function isOrgNameDedupeGroupCorroborated(entities: OrgNameDedupeEntity[]): boolean {
  if (orgGroupSharesDistinctiveHost(entities)) return true;
  const representativeName = entities[0]?.name || entities[0]?.displayName;
  return significantOrgNameTokens(representativeName).length >= 2;
}

function isSecondPathShellSlug(slug: string | undefined): boolean {
  const value = (slug || '').toLowerCase();
  return (
    value.startsWith('yale-research-center-') ||
    value.startsWith('yale-research-core-') ||
    value.startsWith('research-yale-')
  );
}

function orgCanonicalScore(entity: OrgNameDedupeEntity): number {
  return (
    (entity.memberCount || 0) * 5 +
    (entity.departments?.length || 0) * 3 +
    (entity.researchAreas?.length || 0) * 2 +
    (entity.sourceUrls?.length || 0) +
    (bestDedicatedOrgWebsite(entity) ? 6 : 0) +
    ((entity.fullDescription || '').trim() ? 10 : 0) +
    ((entity.shortDescription || '').trim() ? 4 : 0) +
    (isSecondPathShellSlug(entity.slug) ? -40 : 0)
  );
}

function bestDedicatedOrgWebsite(entity: OrgNameDedupeEntity): string {
  const website = (entity.websiteUrl || '').trim();
  if (website && !isListingOrIndexUrl(website) && isDistinctiveOrgHostUrl(website)) {
    return website;
  }
  for (const sourceUrl of entity.sourceUrls || []) {
    const home = sourceUrlToResearchHomeWebsiteUrl(sourceUrl);
    if (home && isDistinctiveOrgHostUrl(home)) return home;
  }
  return '';
}

function cleanestOrgName(entities: OrgNameDedupeEntity[]): string {
  const names = entities.map((entity) => (entity.name || '').trim()).filter(Boolean);
  const withoutAbbreviation = names.filter((name) => !/\([^)]*\)/.test(name));
  const pool = withoutAbbreviation.length > 0 ? withoutAbbreviation : names;
  return pool.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || '';
}

function buildOrgNameDedupeGroup(
  normalizedName: string,
  entities: OrgNameDedupeEntity[],
): ResearchEntityPiDedupeGroup | null {
  if (entities.length <= 1) return null;

  const canonicalPool = hasPiFreeOrgNameAnchor(entities)
    ? entities.filter((entity) => !entity.hasAttachedPi)
    : entities;
  const canonical = [...canonicalPool].sort((a, b) => {
    const byScore = orgCanonicalScore(b) - orgCanonicalScore(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const duplicates = entities.filter((entity) => entity.id !== canonical.id);
  if (duplicates.length === 0) return null;

  const groupWebsite =
    bestDedicatedOrgWebsite(canonical) ||
    entities.map((entity) => bestDedicatedOrgWebsite(entity)).find(Boolean) ||
    '';
  const cleanName = cleanestOrgName(entities);
  const descriptionCarry = bestDescriptionCarry(canonical, entities);
  const mergedResearchAreas = cleanMergedResearchAreas(
    entities.flatMap((entity) => entity.researchAreas || []),
  );

  return {
    userId: `org-name:${normalizedName}`,
    normalizedName,
    canonicalEntityId: canonical.id,
    duplicateEntityIds: duplicates.map((entity) => entity.id),
    canonicalSlug: canonical.slug,
    duplicateSlugs: duplicates.map((entity) => entity.slug || entity.id),
    mergedDepartments: mergeCorroboratedDepartments(entities, mergedResearchAreas),
    mergedResearchAreas,
    mergedSourceUrls: uniqueStrings([
      ...entities.flatMap((entity) => entity.sourceUrls || []),
      ...entities.map((entity) => entity.websiteUrl),
    ]),
    ...(cleanName && cleanName !== (canonical.name || '').trim()
      ? { canonicalName: cleanName }
      : {}),
    ...(groupWebsite && groupWebsite !== (canonical.websiteUrl || '').trim()
      ? { canonicalWebsiteUrl: groupWebsite }
      : {}),
    ...descriptionCarry,
  };
}

export function buildOrgNameResearchEntityDedupePlan(
  entities: OrgNameDedupeEntity[],
): ResearchEntityPiDedupeGroup[] {
  const orgTypes = new Set<string>(ORG_NAME_DEDUPE_ENTITY_TYPES);
  const byKey = new Map<string, OrgNameDedupeEntity[]>();
  for (const entity of entities) {
    if (!entity.id) continue;
    if (!entity.entityType || !orgTypes.has(entity.entityType)) continue;
    const normalizedName = normalizeOrgDedupeName(entity.name || entity.displayName);
    if (!normalizedName) continue;
    const key = `${entity.entityType}::${normalizedName}`;
    byKey.set(key, [...(byKey.get(key) || []), entity]);
  }

  const groups: ResearchEntityPiDedupeGroup[] = [];
  for (const [key, groupEntities] of byKey) {
    if (groupEntities.length < 2) continue;
    if (!hasPiFreeOrgNameAnchor(groupEntities)) continue;
    if (!isOrgNameDedupeGroupCorroborated(groupEntities)) continue;
    const group = buildOrgNameDedupeGroup(key, groupEntities);
    if (group) groups.push(group);
  }
  return dedupePlanGroupsByEntitySet(groups);
}

export function shouldRetireDuplicateCurrentMembersForDedupeRun(options: {
  fundingOnly: boolean;
}): boolean {
  return !options.fundingOnly;
}

export function selectCurrentMemberIdsToRetire(rows: CurrentMemberDedupeRow[]): string[] {
  const members = rows.filter((row) => row.id);
  if (members.length <= 1) return [];

  const keep = [...members].sort((a, b) => {
    const byConfidence = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
    if (byConfidence !== 0) return byConfidence;

    const byObserved = timeValue(b.lastObservedAt) - timeValue(a.lastObservedAt);
    if (byObserved !== 0) return byObserved;

    const byUpdated = timeValue(b.updatedAt) - timeValue(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;

    const bySource = Number(Boolean(b.sourceUrl)) - Number(Boolean(a.sourceUrl));
    if (bySource !== 0) return bySource;

    return a.id.localeCompare(b.id);
  })[0];

  return members.filter((member) => member.id !== keep.id).map((member) => member.id);
}
