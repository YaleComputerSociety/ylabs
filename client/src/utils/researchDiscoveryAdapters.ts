import type { LabPaper } from '../types/labDetail';
import type { PathwayBestNextStepCategory, PathwaySearchHit } from '../types/pathway';
import type { ResearchEntity } from '../types/researchEntity';

export interface EvidenceSourceRowData {
  claim: string;
  sourceType?: string;
  url?: string;
  excerpt?: string;
  observedDate?: string;
  confidence?: number | string;
}

export interface ResearchIdentityInput {
  id: string;
  name: string;
  title?: string;
  departments?: string[];
  affiliations?: string[];
  netid?: string;
  labName?: string;
  labSlug?: string;
  profileUrl?: string;
  orcidUrl?: string;
  sourceCount?: number;
  matchLabel?: string;
  sourceContext?: string;
  evidence?: EvidenceSourceRowData[];
}

export interface ResearchIdentityConfidence {
  id: string;
  name: string;
  title?: string;
  departments: string[];
  affiliations: string[];
  netid?: string;
  labName?: string;
  labSlug?: string;
  profileUrl?: string;
  orcidUrl?: string;
  sourceCount: number;
  identityLabel: 'Identity: Yale-confirmed' | 'Identity: unresolved';
  matchLabel?: string;
  ambiguityLabel?: 'Possible same-name ambiguity';
  sourceContext?: string;
  evidence: EvidenceSourceRowData[];
}

export interface ResearchCluster {
  id: string;
  label: string;
  description: string;
  matchReason: string;
  entityCount: number;
  paperCount: number;
  pathwayCount: number;
  peopleCount: number;
  labels: string[];
  metadataTags: string[];
  entities: ResearchEntity[];
  pathways: PathwaySearchHit[];
  papers: LabPaper[];
  evidence: EvidenceSourceRowData[];
}

export interface GroupedResearchResults {
  clusters: ResearchCluster[];
  papers: LabPaper[];
  people: ResearchIdentityConfidence[];
  pathways: PathwaySearchHit[];
  interpretationChips: string[];
}

interface ClusterOptions {
  pathways?: PathwaySearchHit[];
  papers?: LabPaper[];
  limit?: number;
}

interface SearchSuggestionOptions {
  fallback?: string[];
  limit?: number;
}

export const RESEARCH_HOME_GROUPING_LABEL = 'Evidence-backed grouping';

const titleizeValue = (value?: string): string =>
  (value || '')
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const getPathwayActionLabel = (
  category?: PathwayBestNextStepCategory | string,
): string => {
  switch (category) {
    case 'apply':
      return 'Apply or view posting';
    case 'contact-program':
      return 'Contact program';
    case 'plan-outreach':
      return 'Plan outreach';
    case 'find-funding':
      return 'Find funding';
    case 'register-for-credit':
      return 'Ask about credit after finding a mentor';
    case 'save-for-thesis':
      return 'Save for thesis planning';
    case 'check-back-later':
    case 'save-for-later':
      return 'Save for later';
    default:
      return 'Review next step';
  }
};

export const getPathwayTypeLabel = (value?: string): string => {
  switch (value) {
    case 'POSTED_ROLE':
      return 'Posted role';
    case 'EXPLORATORY_CONTACT':
    case 'REACH_OUT_PLAUSIBLE':
      return 'Exploratory outreach';
    case 'STRUCTURED_PROGRAM':
      return 'Structured program';
    case 'FACULTY_SUPERVISION':
      return 'Faculty supervision';
    case 'INTERNSHIP':
      return 'Internship';
    default:
      return titleizeValue(value) || 'Pathway';
  }
};

export const getEvidenceStrengthLabel = (value?: string): string => {
  switch (value) {
    case 'DIRECT':
    case 'SOURCE_BACKED':
      return 'Direct evidence';
    case 'STRONG':
      return 'Strong evidence';
    case 'MODERATE':
      return 'Moderate evidence';
    case 'WEAK':
      return 'Early signal';
    default:
      return titleizeValue(value) || 'Evidence available';
  }
};

export const getEvidenceSignalLabel = (value?: string): string => {
  switch (value) {
    case 'POSTED_OPENING':
      return 'Posted opening';
    case 'RECURRING_PROGRAM':
      return 'Recurring program';
    case 'PAST_UNDERGRADS':
      return 'Past undergraduate participation';
    case 'CURRENT_UNDERGRADS':
      return 'Current undergraduate participation';
    case 'FACULTY_SUPERVISION':
      return 'Faculty supervision evidence';
    case 'FELLOWSHIP_COMPATIBLE':
      return 'Fellowship-compatible evidence';
    case 'CREDIT_FORMALIZATION_POSSIBLE':
      return 'Credit may be possible later';
    default:
      return titleizeValue(value) || 'Source evidence';
  }
};

export const buildPathwayEvidenceRows = (
  pathway: PathwaySearchHit,
): EvidenceSourceRowData[] => {
  const evidence = pathway.evidence?.[0];
  return [
    {
      claim:
        pathway.explanation ||
        pathway.bestNextStep ||
        pathway.studentFacingLabel ||
        'This pathway is connected to the current search.',
      sourceType: getEvidenceSignalLabel(evidence?.signalType || pathway.pathwayType),
      url: evidence?.sourceUrl || pathway.sourceUrls?.[0],
      excerpt: evidence?.excerpt,
      observedDate: evidence?.observedAt || pathway.lastObservedAt,
      confidence: evidence?.confidenceScore ?? pathway.confidence,
    },
  ];
};

const GENERIC_SUGGESTION_LABELS = new Set([
  'faculty research',
  'research profiles',
  'yale college',
  'school of medicine',
  'faculty of arts and sciences',
  'school of engineering & applied science',
]);

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const uniq = (values: Array<string | undefined | null>): string[] =>
  Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));

const isGenericMetadataLabel = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 3) return true;
  return GENERIC_SUGGESTION_LABELS.has(normalized) || normalized === 'research';
};

const meaningfulMetadata = (values: Array<string | undefined | null>): string[] =>
  uniq(values).filter((value) => !isGenericMetadataLabel(value));

const parseConfidence = (value?: number | string): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  const maybePercent = Number(normalized.replace('%', ''));
  if (!Number.isNaN(maybePercent)) {
    return maybePercent > 1 ? maybePercent / 100 : maybePercent;
  }
  if (['high', 'strong', 'very high', 'confident', 'source-backed'].includes(normalized)) return 0.9;
  if (['medium', 'moderate', 'likely', 'moderately'].includes(normalized)) return 0.65;
  if (['low', 'weak', 'uncertain', 'unresolved', 'possible', 'inferred'].includes(normalized)) return 0.35;
  return undefined;
};

const isMeaningfulResearchEntity = (entity: ResearchEntity): boolean =>
  meaningfulMetadata(entity.researchAreas).length > 0 ||
  meaningfulMetadata(entity.departments).length > 0 ||
  meaningfulMetadata([entity.school]).length > 0 ||
  (typeof entity.recentPaperCount === 'number' && entity.recentPaperCount > 0) ||
  meaningfulMetadata([entity.description]).length > 0 ||
  (entity.sourceUrls?.length || 0) > 0;

const parseProfileNetidFromEmail = (email: string | undefined): string | undefined => {
  if (!email) return undefined;
  const lower = email.toLowerCase().trim();
  const match = lower.match(/(?:mailto:)?([^@+\s]+(?:\+[^@]*)?)@yale\.edu$/i);
  if (!match) return undefined;
  return match[1]?.split('+')[0];
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'metadata';

const kindLabel = (kind?: string): string => {
  switch (kind) {
    case 'lab':
      return 'Labs';
    case 'center':
      return 'Centers';
    case 'institute':
      return 'Institutes';
    case 'program':
      return 'Programs';
    case 'initiative':
      return 'Initiatives';
    case 'individual':
    case 'solo':
      return 'Faculty research';
    default:
      return 'Research profiles';
  }
};

type ClusterMatchType = 'department' | 'research-area' | 'school' | 'kind';

const normalizeClusterLabel = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const normalizeDepartmentClusterLabel = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isShoutedLabel = (value: string): boolean =>
  /[A-Z]/.test(value) && value === value.toUpperCase();

const preferredReadableLabel = (current: string | undefined, next: string): string => {
  if (!current) return next;
  if (isShoutedLabel(current) && !isShoutedLabel(next)) return next;
  return current;
};

const isDepartmentLabelVariant = (a: string, b: string): boolean => {
  const first = a.trim();
  const second = b.trim();
  if (!first || !second) return false;
  if (Math.abs(first.length - second.length) !== 1) return false;
  const [shorter, longer] =
    first.length < second.length ? [first, second] : [second, first];
  return longer.length - shorter.length === 1 && longer === `${shorter}s`;
};

const clusterLabelForEntity = (
  entity: ResearchEntity,
): { label: string; matchType: ClusterMatchType } => {
  const normalizedDepartments = meaningfulMetadata(entity.departments || []);
  if (normalizedDepartments.length > 0) {
    return { label: normalizedDepartments[0], matchType: 'department' };
  }

  const normalizedResearchAreas = meaningfulMetadata(entity.researchAreas || []);
  if (normalizedResearchAreas.length > 0) {
    return { label: normalizedResearchAreas[0], matchType: 'research-area' };
  }

  return entity.school ? { label: entity.school, matchType: 'school' } : { label: kindLabel(entity.kind), matchType: 'kind' };
};

const MATCH_LABEL_BY_TYPE: Record<ClusterMatchType, string> = {
  department: 'department',
  'research-area': 'research area',
  school: 'school',
  kind: 'entity type',
};

const clusterMatchReason = (matchType: ClusterMatchType, label: string): string =>
  `Shared ${MATCH_LABEL_BY_TYPE[matchType]}: ${label}`;

const compactMetadataTags = (values: Array<string | undefined | null>, label: string): string[] => {
  const labelKey = normalizeDepartmentClusterLabel(label);
  const tags = new Map<string, string>();

  for (const tag of meaningfulMetadata(values)) {
    const normalizedTag = normalizeDepartmentClusterLabel(tag);
    if (
      normalizedTag === labelKey ||
      isDepartmentLabelVariant(normalizedTag, labelKey)
    ) {
      continue;
    }

    const key =
      Array.from(tags.keys()).find(
        (candidateKey) =>
          candidateKey === normalizedTag ||
          isDepartmentLabelVariant(normalizedTag, candidateKey),
      ) ?? normalizedTag;
    tags.set(key, preferredReadableLabel(tags.get(key), tag));
  }

  return Array.from(tags.values()).slice(0, 6);
};

const entityDisplayName = (entity: ResearchEntity): string =>
  entity.displayName || entity.name || 'Untitled research profile';

const entityIds = (entities: ResearchEntity[]): Set<string> =>
  new Set(entities.map((entity) => String(entity._id || entity.id || entity.slug)));

const pathwaysForEntities = (
  pathways: PathwaySearchHit[],
  entities: ResearchEntity[],
): PathwaySearchHit[] => {
  const ids = entityIds(entities);
  const slugs = new Set(entities.map((entity) => entity.slug).filter(Boolean));
  return pathways.filter((pathway) => {
    const entity = pathway.researchEntity;
    return ids.has(String(entity?._id)) || slugs.has(entity?.slug || '');
  });
};

const isPathwayResultRelevant = (pathway: PathwaySearchHit): boolean => {
  const evidenceConfidence = parseConfidence(
    pathway.evidence?.map((entry) => parseConfidence(entry.confidenceScore)).find((value) => value !== undefined),
  );
  const directConfidence = parseConfidence(pathway.confidence);
  const strongest = Math.max(evidenceConfidence ?? -1, directConfidence ?? -1);
  if (pathway.evidenceStrength === 'SOURCE_BACKED') {
    return strongest < 0 || strongest >= 0.35;
  }

  if (strongest < 0) {
    return (pathway.evidence?.length || 0) > 0 || (pathway.sourceUrls?.length || 0) > 0;
  }

  return strongest >= 0.35;
};

const hasPersonContextForDiscovery = (entity: ResearchEntity): boolean =>
  (entity.contactRole || '').trim().length > 0 ||
  (entity.contactEmail || '').trim().length > 0 ||
  (entity.sourceUrls || []).length > 0 ||
  (entity.departments || []).length > 0 ||
  (entity.accessSummary?.evidence || []).length > 0;

export function buildMetadataClusters(
  researchEntities: ResearchEntity[],
  options: ClusterOptions = {},
): ResearchCluster[] {
  const groups = new Map<
    string,
    { label: string; matchType: ClusterMatchType; entities: ResearchEntity[] }
  >();

  for (const entity of researchEntities) {
    const { label, matchType } = clusterLabelForEntity(entity);
    const normalizedLabel =
      matchType === 'department'
        ? normalizeDepartmentClusterLabel(label)
        : normalizeClusterLabel(label);
    const key =
      matchType === 'department'
        ? Array.from(groups.entries())
            .find(
              ([groupKey, group]) =>
                group.matchType === 'department' &&
                isDepartmentLabelVariant(normalizedLabel, groupKey),
            )?.[0] ?? normalizedLabel
        : normalizedLabel;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.entities.push(entity);
      continue;
    }
    groups.set(key, { label, matchType, entities: [entity] });
  }

  const clusters = Array.from(groups.values())
    .sort((a, b) => {
      if (a.entities.length !== b.entities.length) return b.entities.length - a.entities.length;
      return a.label.localeCompare(b.label);
    })
    .slice(0, options.limit ?? 6)
    .map(({ label, matchType, entities }) => {
      const pathways = pathwaysForEntities(options.pathways || [], entities);
      const papers = options.papers || [];
      const relevantEntities = entities.filter(isMeaningfulResearchEntity);
      const isGenericSingleton =
        entities.length === 1 &&
        !relevantEntities.length &&
        isGenericMetadataLabel(label);

      if (isGenericSingleton) {
        return null;
      }

      const sourceUrls = uniq(entities.flatMap((entity) => entity.sourceUrls || []));
      const metadataTags = compactMetadataTags([
        ...entities.flatMap((entity) => entity.researchAreas || []),
        ...entities.flatMap((entity) => entity.departments || []),
        ...entities.map((entity) => entity.school),
      ], label);
      const peopleCount = uniq(
        entities.filter(hasPersonContextForDiscovery).map((entity) => entity.contactName),
      ).length;
      const paperCount =
        papers.length ||
        entities.reduce((sum, entity) => sum + (entity.recentPaperCount || 0), 0);

      return {
        id: slugify(label),
        label,
        description:
          entities[0]?.description ||
          `Research homes connected by Yale ${MATCH_LABEL_BY_TYPE[matchType]} metadata for ${label}.`,
        matchReason: clusterMatchReason(matchType, label),
        entityCount: entities.length,
        paperCount,
        pathwayCount: pathways.length,
        peopleCount,
        labels: [RESEARCH_HOME_GROUPING_LABEL],
        metadataTags,
        entities,
        pathways,
        papers,
        evidence: [
          {
            claim: `${entities.length} Yale research ${
              entities.length === 1 ? 'profile shares' : 'profiles share'
            } ${label} metadata.`,
            sourceType: 'Research metadata',
            url: sourceUrls[0],
            confidence: 'metadata fallback',
          },
        ],
      };
    });

  return clusters.filter((cluster): cluster is ResearchCluster => cluster !== null);
}

export function buildDynamicSearchSuggestions(
  researchEntities: ResearchEntity[],
  options: SearchSuggestionOptions = {},
): string[] {
  const limit = options.limit ?? 4;
  const candidates = new Map<string, { label: string; score: number }>();

  const addCandidate = (label: string | undefined, score: number) => {
    const trimmed = (label || '').trim();
    const normalizedKey = normalizeDepartmentClusterLabel(trimmed);
    if (!trimmed || trimmed.length < 3 || GENERIC_SUGGESTION_LABELS.has(normalizedKey)) return;

    const key =
      Array.from(candidates.keys()).find(
        (candidateKey) =>
          candidateKey === normalizedKey ||
          isDepartmentLabelVariant(normalizedKey, candidateKey),
      ) ?? normalizedKey;
    const current = candidates.get(key);
    candidates.set(key, {
      label: preferredReadableLabel(current?.label, trimmed),
      score: (current?.score || 0) + score,
    });
  };

  for (const entity of researchEntities) {
    const paperBoost = Math.min(1, (entity.recentPaperCount || 0) / 10);
    entity.researchAreas?.forEach((area, index) => {
      addCandidate(area, (index === 0 ? 4 : 3) + paperBoost);
    });
    entity.departments?.forEach((department) => {
      addCandidate(department, 2 + paperBoost / 2);
    });
  }

  const suggestions = Array.from(candidates.values())
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .map((candidate) => candidate.label);

  for (const fallback of options.fallback || []) {
    if (suggestions.length >= limit) break;
    const exists = suggestions.some(
      (suggestion) => suggestion.toLowerCase() === fallback.toLowerCase(),
    );
    if (!exists) suggestions.push(fallback);
  }

  return suggestions.slice(0, limit);
}

const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

const identityDifferenceKey = (identity: ResearchIdentityInput): string =>
  [
    identity.netid || '',
    identity.title || '',
    ...(identity.departments || []),
    ...(identity.affiliations || []),
    identity.profileUrl || '',
    identity.orcidUrl || '',
    identity.sourceContext || '',
  ]
    .join('|')
    .toLowerCase();

export function buildIdentityConfidenceRecords(
  inputs: ResearchIdentityInput[],
): ResearchIdentityConfidence[] {
  const visibleInputs = inputs.filter((input) => input.name.trim().length > 0);
  const byName = new Map<string, ResearchIdentityInput[]>();
  for (const input of visibleInputs) {
    const key = normalizeName(input.name);
    byName.set(key, [...(byName.get(key) || []), input]);
  }

  return visibleInputs.map((input) => {
    const sameName = byName.get(normalizeName(input.name)) || [];
    const hasMeaningfulAmbiguity =
      sameName.length > 1 &&
      new Set(sameName.map((item) => identityDifferenceKey(item))).size > 1;
    const evidence = input.evidence || [
      {
        claim: input.sourceContext
          ? `Identity appears in ${input.sourceContext}.`
          : 'Identity is derived from available Yale Research metadata.',
        sourceType: input.netid ? 'Yale profile metadata' : 'Research metadata',
        confidence: input.netid ? 'high' : 'unresolved',
      },
    ];

    return {
      id: input.id,
      name: input.name,
      title: input.title,
      departments: input.departments || [],
      affiliations: input.affiliations || [],
      netid: input.netid,
      labName: input.labName,
      labSlug: input.labSlug,
      profileUrl: input.profileUrl,
      orcidUrl: input.orcidUrl,
      sourceCount: input.sourceCount ?? Math.max(1, evidence.length),
      identityLabel: input.netid ? 'Identity: Yale-confirmed' : 'Identity: unresolved',
      matchLabel: input.matchLabel,
      ambiguityLabel: hasMeaningfulAmbiguity ? 'Possible same-name ambiguity' : undefined,
      sourceContext: input.sourceContext,
      evidence,
    };
  });
}

const identitiesFromResearchEntities = (
  researchEntities: ResearchEntity[],
): ResearchIdentityConfidence[] =>
  buildIdentityConfidenceRecords(
    researchEntities
      .filter((entity) => {
        const hasName = (entity.contactName || '').trim().length > 0;
        return hasName && hasPersonContextForDiscovery(entity);
      })
      .map((entity) => {
        const netid = parseProfileNetidFromEmail(entity.contactEmail);
        return {
          id: `${entity._id || entity.slug}-${entity.contactName}`,
          name: entity.contactName,
          title: entity.contactRole || undefined,
          departments: entity.departments || [],
          affiliations: uniq([entity.school, kindLabel(entity.kind)]),
          netid,
          profileUrl: netid ? `/profile/${netid}` : undefined,
          labName: entityDisplayName(entity),
          labSlug: entity.slug,
          sourceCount:
            (entity.sourceUrls || []).length ||
            entity.accessSummary?.evidence?.length ||
            1,
          matchLabel: 'Research profile match: metadata',
          sourceContext: entityDisplayName(entity),
          evidence: [
            {
              claim: `${entity.contactName} is listed as the contact for ${entityDisplayName(entity)}.`,
              sourceType: 'Research profile metadata',
              url: entity.sourceUrls?.[0],
              confidence: 'unresolved identity',
            },
          ],
        };
      }),
  );

export function parseQueryInterpretationChips(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return ['Query: all Yale research'];
  const terms = trimmed
    .split(/[^A-Za-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !STOPWORDS.has(term.toLowerCase()))
    .slice(0, 4);

  return [`Query: ${trimmed}`, ...terms.map((term) => `Topic term: ${term}`)];
}

export function buildGroupedSearchResults({
  query,
  researchEntities,
  pathways,
  papers = [],
}: {
  query: string;
  researchEntities: ResearchEntity[];
  pathways: PathwaySearchHit[];
  papers?: LabPaper[];
}): GroupedResearchResults {
  const relevantPathways = pathways.filter(isPathwayResultRelevant);
  const people = identitiesFromResearchEntities(researchEntities);

  return {
    clusters: buildMetadataClusters(researchEntities, { pathways: relevantPathways, papers }),
    papers,
    people: people.filter((person) =>
      person.identityLabel === 'Identity: Yale-confirmed' || person.sourceCount > 1 || person.departments.length > 0,
    ),
    pathways: relevantPathways,
    interpretationChips: parseQueryInterpretationChips(query),
  };
}
