import type { LabPaper } from '../types/labDetail';
import type { PathwayBestNextStepCategory, PathwaySearchHit } from '../types/pathway';
import type { ResearchEntity } from '../types/researchEntity';
import {
  isGenericResearchHomeDescription,
  normalizeResearchInlineText,
  normalizeResearchMetadataLabels,
} from './researchTextNormalization';

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
  email?: string;
  labName?: string;
  labSlug?: string;
  profileUrl?: string;
  orcidUrl?: string;
  sourceCount?: number;
  matchLabel?: string;
  sourceContext?: string;
  evidence?: EvidenceSourceRowData[];
}

export type ResearchHomeContextState = 'complete' | 'sparse';
export type ResearchHomeEvidenceState = 'official' | 'limited' | 'review' | 'publications';

export interface ResearchHomeContextInput {
  shortDescription?: string | null;
  description?: string | null;
  fullDescription?: string | null;
  profileSynthesisDescription?: string | null;
  researchAreas?: Array<string | undefined | null>;
  departments?: Array<string | undefined | null>;
  sourceUrls?: Array<string | undefined | null>;
  school?: string | null;
}

export interface ResearchHomeContextSummary {
  text: string;
  state: ResearchHomeContextState;
  label: string;
}

export interface ResearchHomeEvidenceStatus {
  label: 'Official Yale source found' | 'Evidence limited' | 'Needs review' | 'Publications found';
  state: ResearchHomeEvidenceState;
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
  contextState?: ResearchHomeContextState;
  contextLabel?: string;
  contextLine?: string;
  evidenceStatus: ResearchHomeEvidenceStatus;
  matchReason: string;
  entityCount: number;
  paperCount: number;
  pathwayCount: number;
  peopleCount: number;
  labels: string[];
  metadataTags: string[];
  wayInBadges?: string[];
  activePostedOpportunity?: PathwaySearchHit['activePostedOpportunity'];
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
}

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
      return 'Apply';
    case 'contact-program':
      return 'Contact program';
    case 'plan-outreach':
      return 'Plan targeted outreach';
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
  const studentFacingLabel = getStudentFacingPathwayLabel(value);
  if (studentFacingLabel !== 'Pathway') return studentFacingLabel;
  return titleizeValue(value) || 'Pathway';
};

export const getStudentFacingPathwayLabel = (value?: string): string => {
  switch (value) {
    case 'POSTED_ROLE':
      return 'Posted opening';
    case 'EXPLORATORY_CONTACT':
    case 'REACH_OUT_PLAUSIBLE':
      return 'Exploratory outreach';
    case 'VOLUNTEER_OUTREACH':
      return 'Volunteer outreach';
    case 'WORK_STUDY':
      return 'Work-study';
    case 'CENTER_INTERNSHIP':
      return 'Center internship';
    case 'RECURRING_PROGRAM':
      return 'Recurring route';
    case 'STRUCTURED_PROGRAM':
      return 'Structured program';
    case 'FACULTY_SUPERVISION':
      return 'Faculty supervision';
    case 'INTERNSHIP':
      return 'Internship';
    default:
      return 'Pathway';
  }
};

export const formatSourceLabel = (url?: string): string => {
  if (!url) return 'Source';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
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
    case 'REACH_OUT_PLAUSIBLE':
      return 'Profile/contact evidence';
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

const normalizeContextText = (value?: string | null): string =>
  normalizeResearchInlineText(value);

const meaningfulMetadata = (values: Array<string | undefined | null>): string[] =>
  normalizeResearchMetadataLabels(values);

const formatReadableList = (values: string[]): string => {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const buildCompleteContextSummary = (
  description?: string | null,
  label: string = 'Research description',
): ResearchHomeContextSummary | undefined => {
  const text = normalizeContextText(description);
  if (!text || isGenericResearchHomeDescription(text)) return undefined;
  return {
    text,
    state: 'complete',
    label,
  };
};

const hasUsefulFullDescription = (input: ResearchHomeContextInput): boolean => {
  const fullText = normalizeContextText(input.fullDescription || input.description);
  return Boolean(fullText && !isGenericResearchHomeDescription(fullText));
};

const isWeakShortDescription = (value?: string | null): boolean => {
  const text = normalizeContextText(value);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return (
    wordCount < 10 &&
    (/^my lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(text) ||
      /^our lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(text))
  );
};

const selectResearchDescriptionSummary = (
  input: ResearchHomeContextInput,
): ResearchHomeContextSummary | undefined => {
  const fullIsUseful = hasUsefulFullDescription(input);
  if (fullIsUseful) {
    const shortSummary = isWeakShortDescription(input.shortDescription)
      ? undefined
      : buildCompleteContextSummary(input.shortDescription);
    if (shortSummary) return shortSummary;
    return buildCompleteContextSummary(input.fullDescription || input.description);
  }

  const summaries = [
    buildCompleteContextSummary(input.profileSynthesisDescription, 'Profile context'),
  ].filter((summary): summary is ResearchHomeContextSummary => Boolean(summary));

  return summaries[0];
};

export const buildResearchHomeContextSummary = (
  input: ResearchHomeContextInput = {},
): ResearchHomeContextSummary => {
  const descriptionSummary = selectResearchDescriptionSummary(input);

  if (descriptionSummary) return descriptionSummary;

  const homeMetadata = uniq([
    ...(input.departments || []),
    input.school,
  ]);
  const hasSourceLinks = (input.sourceUrls || []).some(Boolean);
  if (homeMetadata.length > 0) {
    return {
      text: hasSourceLinks
        ? `No plain-English summary is available yet. Use the source links and ${formatReadableList(homeMetadata)} context to decide whether this research home fits.`
        : `No plain-English summary is available yet. Use the ${formatReadableList(homeMetadata)} context while this profile awaits source review.`,
      state: 'sparse',
      label: 'Summary limited',
    };
  }

  return {
    text: hasSourceLinks
      ? 'No plain-English summary is available yet. Use the source links to decide whether this research home fits.'
      : 'No plain-English summary is available yet. This research home needs source review before fit can be assessed.',
    state: 'sparse',
    label: 'Summary limited',
  };
};

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

const hasCanonicalPostedOpportunity = (pathway: PathwaySearchHit): boolean =>
  Boolean(pathway.activePostedOpportunity) &&
  pathway.activePostedOpportunity?.provenance !== 'LISTING_BRIDGED';

const hasContactRoute = (pathway: PathwaySearchHit): boolean =>
  Boolean(pathway.contactRoute?.url || pathway.contactRoute?.routeType) ||
  ['contact-program', 'plan-outreach'].includes(pathway.bestNextStepCategory);

const pathwayEvidenceTypes = (pathways: PathwaySearchHit[]): string[] =>
  pathways.flatMap((pathway) => pathway.evidence || []).map((item) => item.signalType);

export const buildWayInBadges = (
  entity: ResearchEntity | undefined,
  pathways: PathwaySearchHit[],
): string[] => {
  const signalTypes = [
    ...(entity?.accessSummary?.signalTypes || []),
    ...pathwayEvidenceTypes(pathways),
  ];
  const badges: string[] = [];
  const addBadge = (label: string, condition: boolean) => {
    if (condition && !badges.includes(label)) badges.push(label);
  };

  addBadge('Posted route', pathways.some(hasCanonicalPostedOpportunity));
  addBadge('Contact route', pathways.some(hasContactRoute));
  addBadge(
    'Undergrad evidence',
    signalTypes.some((signal) =>
      ['CURRENT_UNDERGRADS', 'PAST_UNDERGRADS', 'FACULTY_SUPERVISION'].includes(signal),
    ),
  );
  addBadge('Student project evidence', signalTypes.includes('FACULTY_SUPERVISES_STUDENT_PROJECTS'));

  return badges.slice(0, 5);
};

export const buildResearchHomeContextLine = (entity: ResearchEntity | undefined): string => {
  if (!entity) return '';
  return uniq([...(entity.departments || []), entity.school]).slice(0, 3).join(' · ');
};

const hasOfficialYaleSource = (entity: ResearchEntity | undefined): boolean =>
  (entity?.sourceUrls || []).some((url) => {
    try {
      return new URL(url).hostname.endsWith('yale.edu');
    } catch {
      return /(^|\.)yale\.edu\//i.test(url);
    }
  });

export const buildResearchHomeEvidenceStatus = (
  entity: ResearchEntity | undefined,
  pathways: PathwaySearchHit[],
): ResearchHomeEvidenceStatus => {
  if ((entity?.recentPaperCount || 0) > 0) {
    return { label: 'Publications found', state: 'publications' };
  }
  if (hasOfficialYaleSource(entity)) {
    return { label: 'Official Yale source found', state: 'official' };
  }
  if (
    entity?.accessSummary?.status === 'not-currently-available' ||
    entity?.accessSummary?.signalTypes?.includes('NOT_CURRENTLY_AVAILABLE')
  ) {
    return { label: 'Needs review', state: 'review' };
  }
  if (
    (entity?.accessSummary?.evidence || []).length > 0 ||
    pathways.some((pathway) => (pathway.sourceUrls || []).length > 0 || (pathway.evidence || []).length > 0)
  ) {
    return { label: 'Evidence limited', state: 'limited' };
  }
  return { label: 'Evidence limited', state: 'limited' };
};

const normalizeDisplayKeyPart = (value?: string): string =>
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const pathwayDisplayKey = (pathway: PathwaySearchHit): string => {
  const entity = pathway.researchEntity;
  const hasPostedOpportunity = !!pathway.activePostedOpportunity;
  const entityKey =
    !hasPostedOpportunity && (entity?.displayName || entity?.name)
      ? entity.displayName || entity.name
      : entity?.slug ||
        entity?._id ||
        entity?.displayName ||
        entity?.name ||
        'unknown-entity';
  const sourceKey =
    pathway.contactRoute?.url ||
    pathway.sourceUrls?.[0] ||
    pathway.evidence?.find((entry) => entry.sourceUrl)?.sourceUrl;
  const opportunityKey =
    pathway.activePostedOpportunity?._id ||
    pathway.activePostedOpportunity?.title ||
    sourceKey ||
    pathway.bestNextStepCategory ||
    pathway.bestNextStep ||
    pathway.studentFacingLabel ||
    pathway._id;

  return [
    entityKey,
    pathway.pathwayType || 'pathway',
    opportunityKey,
  ]
    .map(normalizeDisplayKeyPart)
    .join('|');
};

export const dedupePathwayDisplayHits = (
  pathways: PathwaySearchHit[],
): PathwaySearchHit[] => {
  const seen = new Set<string>();
  const displayHits: PathwaySearchHit[] = [];

  for (const pathway of pathways) {
    const key = pathwayDisplayKey(pathway);
    if (seen.has(key)) continue;
    seen.add(key);
    displayHits.push(pathway);
  }

  return displayHits;
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

const buildProfileDiscoveryClusters = (
  entities: ResearchEntity[],
  options: ClusterOptions = {},
): ResearchCluster[] =>
  entities.map((entity) => {
    const displayName = entityDisplayName(entity);
    const contextSummary = buildResearchHomeContextSummary({
      shortDescription: entity.shortDescription,
      description: entity.description,
      fullDescription: entity.fullDescription,
      profileSynthesisDescription: entity.profileSynthesisDescription,
      researchAreas: entity.researchAreas,
      departments: entity.departments,
      sourceUrls: entity.sourceUrls,
      school: entity.school,
    });
    const matchReason = entity.searchMatch?.reason || 'Yale research profile source.';
    const methodLabels = meaningfulMetadata(entity.searchMatch?.methods || []);
    const researchAreaLabels = meaningfulMetadata(entity.researchAreas || []);
    const conceptTags = meaningfulMetadata(entity.searchMatch?.concepts || []);
    const pathways = pathwaysForEntities(options.pathways || [], [entity]);
    const activePostedOpportunity = pathways.find(hasCanonicalPostedOpportunity)?.activePostedOpportunity;
    const evidenceStatus = buildResearchHomeEvidenceStatus(entity, pathways);

    return {
      id: entity.slug || entity.id || entity._id || slugify(displayName),
      label: displayName,
      description: contextSummary.text,
      contextState: contextSummary.state,
      contextLabel: contextSummary.label,
      contextLine: buildResearchHomeContextLine(entity),
      evidenceStatus,
      matchReason,
      entityCount: 1,
      paperCount: entity.recentPaperCount || 0,
      pathwayCount: pathways.length,
      peopleCount: hasPersonContextForDiscovery(entity) ? 1 : 0,
      labels: methodLabels.length > 0 ? methodLabels : researchAreaLabels,
      metadataTags: uniq([
        ...(entity.departments || []).slice(0, 2),
        ...conceptTags,
      ]).slice(0, 5),
      wayInBadges: buildWayInBadges(entity, pathways),
      activePostedOpportunity,
      entities: [entity],
      pathways,
      papers: [],
      evidence: [
        {
          claim: matchReason,
          sourceType: entity.sourceUrls?.length
            ? 'Yale research source'
            : 'Research search match',
          url: entity.sourceUrls?.[0],
          confidence: entity.searchMatch?.mode || 'indexed source',
        },
      ],
    };
  });

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
): ResearchIdentityConfidence[] => {
  const byPerson = new Map<string, ResearchIdentityInput>();

  const mergeIdentityInput = (input: ResearchIdentityInput) => {
    const key = input.netid
      ? `netid:${input.netid.toLowerCase()}`
      : input.email
        ? `email:${input.email.toLowerCase()}`
        : `input:${input.id}`;
    const existing = byPerson.get(key);
    if (!existing) {
      byPerson.set(key, input);
      return;
    }

    byPerson.set(key, {
      ...existing,
      title: existing.title || input.title,
      departments: uniq([...(existing.departments || []), ...(input.departments || [])]),
      affiliations: uniq([...(existing.affiliations || []), ...(input.affiliations || [])]),
      labName: existing.labName || input.labName,
      labSlug: existing.labSlug || input.labSlug,
      profileUrl: existing.profileUrl || input.profileUrl,
      orcidUrl: existing.orcidUrl || input.orcidUrl,
      sourceCount: Math.max(
        existing.sourceCount || 0,
        input.sourceCount || 0,
        (existing.evidence || []).length + (input.evidence || []).length,
      ),
      sourceContext: uniq([existing.sourceContext, input.sourceContext]).join(', '),
      evidence: [...(existing.evidence || []), ...(input.evidence || [])],
    });
  };

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
          email: entity.contactEmail || undefined,
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
      })
      .forEach(mergeIdentityInput);

  return buildIdentityConfidenceRecords(Array.from(byPerson.values()));
};

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
    clusters: buildProfileDiscoveryClusters(researchEntities, { pathways: relevantPathways, papers }),
    papers,
    people: people.filter((person) =>
      person.identityLabel === 'Identity: Yale-confirmed' || person.sourceCount > 1 || person.departments.length > 0,
    ),
    pathways: relevantPathways,
    interpretationChips: parseQueryInterpretationChips(query),
  };
}
