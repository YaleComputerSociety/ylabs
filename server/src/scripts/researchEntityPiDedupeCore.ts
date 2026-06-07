import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import {
  isConcreteResearchHomeEntity,
  isProfileAreaShellEntity,
} from '../utils/profileAreaDuplicateRisk';

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
  dedupeCategory?: 'profile_area_shell_with_concrete_home';
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
    return (host === 'yale.edu' || host.endsWith('.yale.edu')) && /\/profile\//i.test(parsed.pathname);
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
  const duplicateShells = [...profileAreaShells, ...profileBackedSurnameShells];
  const duplicateShellIds = new Set(duplicateShells.map((entity) => entity.id));
  const concreteHomes = entities.filter(
    (entity) => {
      if (duplicateShellIds.has(entity.id)) return false;
      if (!isConcreteResearchHomeEntity(entity) || isFundingOnlyEntity(entity)) return false;
      if (profileAreaShells.length > 0) return true;
      return [entity.websiteUrl, ...(entity.sourceUrls || [])].some(isOfficialYaleLabUrl);
    },
  );
  if (duplicateShells.length === 0 || concreteHomes.length === 0) return null;

  const canonical = [...concreteHomes].sort((a, b) => {
    const byScore = canonicalScore(b) - canonicalScore(a);
    if (byScore !== 0) return byScore;
    return (a.slug || a.id).localeCompare(b.slug || b.id);
  })[0];
  const duplicates = duplicateShells.filter((entity) => entity.id !== canonical.id);
  if (duplicates.length === 0) return null;

  const group = buildGroupFromCluster(
    row,
    [canonical, ...duplicates],
    (entity) => (entity.id === canonical.id ? Number.MAX_SAFE_INTEGER : canonicalScore(entity)),
  );
  if (!group) return null;
  return {
    ...group,
    dedupeCategory: 'profile_area_shell_with_concrete_home',
  };
}

function dedupePlanGroupsByEntitySet(groups: ResearchEntityPiDedupeGroup[]): ResearchEntityPiDedupeGroup[] {
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
