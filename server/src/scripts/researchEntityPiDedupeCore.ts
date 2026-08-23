import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import {
  concreteLabWebsiteForEntity,
  entityCarriesConcreteWebsite,
  isConcreteResearchHomeEntity,
  isProfileAreaShellEntity,
} from '../utils/profileAreaDuplicateRisk';
import {
  isCustomYaleResearchHomeSubdomain,
  isListingOrIndexUrl,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../utils/researchHomeWebsiteUrl';

export interface ResearchEntityPiDedupeRow {
  userId: string;
  normalizedName: string;
  piFirstName?: string;
  piLastName?: string;
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
    departments?: string[];
    researchAreas?: string[];
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

export interface OfficialLabUrlDedupeRow {
  url: string;
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

function timeValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function canonicalScore(entity: ResearchEntityPiDedupeRow['entities'][number]): number {
  const slug = entity.slug || '';
  const hasFullDescription = Boolean((entity.fullDescription || '').trim());
  const hasShortDescription = Boolean((entity.shortDescription || '').trim());
  const isSpecialShell =
    slug.startsWith('faculty-research-area-') ||
    slug.startsWith('nih-pi-') ||
    slug.startsWith('nsf-pi-');
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
    (slug.startsWith('nih-pi-') || slug.startsWith('nsf-pi-') ? -80 : 0)
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
      host.endsWith('.nsf.gov')
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
  const hasFundingSlug = slug.startsWith('nih-pi-') || slug.startsWith('nsf-pi-');
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
  if (personPrefix.length === 0 && !isProfileBackedSurnameLabShell(entity, row)) return null;
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
    const byScore = scoreEntity(b) - scoreEntity(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const duplicates = entities.filter((entity) => entity.id !== canonical.id);
  if (duplicates.length === 0) return null;
  const { canonicalName, canonicalWebsiteUrl } = carriedCanonicalIdentity(canonical, entities, row);
  return {
    userId: row.userId,
    normalizedName: row.normalizedName,
    canonicalEntityId: canonical.id,
    duplicateEntityIds: duplicates.map((entity) => entity.id),
    canonicalSlug: canonical.slug,
    duplicateSlugs: duplicates.map((entity) => entity.slug || entity.id),
    mergedDepartments: uniqueStrings(entities.flatMap((entity) => entity.departments || [])),
    mergedResearchAreas: cleanMergedResearchAreas(
      entities.flatMap((entity) => entity.researchAreas || []),
      { sanitizeProfileChrome: true },
    ),
    mergedSourceUrls: uniqueStrings([
      ...entities.flatMap((entity) => entity.sourceUrls || []),
      ...entities.map((entity) => entity.websiteUrl),
    ]),
    ...(canonicalName ? { canonicalName } : {}),
    ...(canonicalWebsiteUrl ? { canonicalWebsiteUrl } : {}),
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
  // An entity that carries its own real (non-profile, non-funding) lab website is the
  // concrete research home, not a thin profile-area shell - never archive it into a
  // PI-derived grant "<PI> Lab" shell and discard its name/site (issue #456).
  const duplicateShells = [...profileAreaShells, ...profileBackedSurnameShells].filter(
    (entity) => !entityCarriesConcreteWebsite(entity),
  );
  const duplicateShellIds = new Set(duplicateShells.map((entity) => entity.id));
  const concreteHomes = entities.filter((entity) => {
    if (duplicateShellIds.has(entity.id)) return false;
    if (isFundingOnlyEntity(entity)) return false;
    if (entityCarriesConcreteWebsite(entity)) return true;
    if (!isConcreteResearchHomeEntity(entity)) return false;
    if (profileAreaShells.length > 0) return true;
    return [entity.websiteUrl, ...(entity.sourceUrls || [])].some(isOfficialYaleLabUrl);
  });
  if (duplicateShells.length === 0 || concreteHomes.length === 0) return null;

  const canonical = [...concreteHomes].sort((a, b) => {
    const byScore = canonicalScore(b) - canonicalScore(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const duplicates = duplicateShells.filter((entity) => entity.id !== canonical.id);
  if (duplicates.length === 0) return null;

  const group = buildGroupFromCluster(row, [canonical, ...duplicates], (entity) =>
    entity.id === canonical.id ? Number.MAX_SAFE_INTEGER : canonicalScore(entity),
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
    const canonical = entities.find((entity) => entity.id === group.canonicalEntityId);
    const descriptionCarry = canonical ? bestDescriptionCarry(canonical, entities) : {};
    return [{ ...group, ...descriptionCarry, dedupeCategory: 'shared_person_id' as const }];
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

  return {
    userId: row.userId,
    normalizedName: row.normalizedName,
    canonicalEntityId: canonical.id,
    duplicateEntityIds: fundingDuplicates.map((entity) => entity.id),
    canonicalSlug: canonical.slug,
    duplicateSlugs: fundingDuplicates.map((entity) => entity.slug || entity.id),
    mergedDepartments: uniqueStrings(entities.flatMap((entity) => entity.departments || [])),
    mergedResearchAreas: cleanMergedResearchAreas(
      entities.flatMap((entity) => entity.researchAreas || []),
      { sanitizeProfileChrome: true },
    ),
    mergedSourceUrls: uniqueStrings([
      ...entities.flatMap((entity) => entity.sourceUrls || []),
      ...entities.map((entity) => entity.websiteUrl),
    ]),
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
  'PROGRAM',
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

  return {
    userId: `org-name:${normalizedName}`,
    normalizedName,
    canonicalEntityId: canonical.id,
    duplicateEntityIds: duplicates.map((entity) => entity.id),
    canonicalSlug: canonical.slug,
    duplicateSlugs: duplicates.map((entity) => entity.slug || entity.id),
    mergedDepartments: uniqueStrings(entities.flatMap((entity) => entity.departments || [])),
    mergedResearchAreas: cleanMergedResearchAreas(
      entities.flatMap((entity) => entity.researchAreas || []),
    ),
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
