import mongoose from 'mongoose';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { User } from '../models/user';
import { parseNormalizedHttpUrl } from '../utils/urlNormalization';

export type ScholarlyLinkDestinationKind =
  | 'DOI'
  | 'PUBLISHER'
  | 'PUBMED'
  | 'PMC'
  | 'ARXIV'
  | 'ORCID'
  | 'OPENALEX'
  | 'OFFICIAL_PROFILE'
  | 'OTHER';

export type ScholarlyLinkDiscoverySource = 'OPENALEX' | 'ORCID' | 'OFFICIAL_PROFILE' | 'MANUAL';
export type ScholarlyAttributionBasis =
  | 'identity_authorship'
  | 'explicit_entity_link'
  | 'official_profile_publication'
  | 'manual';

export interface PublicScholarlyLink {
  _id: string;
  researchEntityId?: string;
  userId?: string;
  title: string;
  url: string;
  destinationKind: ScholarlyLinkDestinationKind;
  displaySource: string;
  freeFullTextUrl?: string;
  freeFullTextLabel?: string;
  discoveredVia: ScholarlyLinkDiscoverySource;
  year?: number;
  venue?: string;
  confidence?: number;
  observedAt?: string;
  externalIds?: {
    doi?: string;
    openAlexId?: string;
    arxivId?: string;
    pmid?: string;
    pmcid?: string;
  };
}

export type ResearchActivityRelationshipBasis =
  | 'explicit_entity_link'
  | 'entity_source'
  | 'member_authorship'
  | 'manual';

export interface PublicResearchActivityLink extends PublicScholarlyLink {
  relationshipBasis: ResearchActivityRelationshipBasis;
  evidenceLabel: string;
}

export function withResearchActivityRelationship(
  link: PublicScholarlyLink,
  relationship: {
    relationshipBasis: ResearchActivityRelationshipBasis;
    evidenceLabel: string;
    researchEntityId?: string;
    userId?: string;
  },
): PublicResearchActivityLink {
  return {
    ...link,
    ...(relationship.researchEntityId ? { researchEntityId: relationship.researchEntityId } : {}),
    ...(relationship.userId ? { userId: relationship.userId } : {}),
    relationshipBasis: relationship.relationshipBasis,
    evidenceLabel: relationship.evidenceLabel,
  };
}

interface PaperLike {
  [key: string]: unknown;
  _id?: unknown;
  title?: string;
  doi?: string;
  openAlexId?: string;
  arxivId?: string;
  year?: number;
  venue?: string;
  publishedAt?: string | Date;
  postedAt?: string | Date;
  versionDate?: string | Date;
  url?: string;
  landingPageUrl?: string;
  openAccessUrl?: string;
  pdfUrl?: string;
  externalIds?: Record<string, unknown>;
  sources?: string[];
  sourceUrl?: string;
  publicationTypes?: string[];
  type?: string;
}

export interface ScholarlyDestination {
  url: string;
  destinationKind: ScholarlyLinkDestinationKind;
  displaySource: string;
}

export const PUBLIC_SCHOLARLY_LINK_LIMIT = 10;
export const MIGRATED_SCHOLARLY_LINK_LIMIT = 20;

const toTrimmedString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function mathMarkupToText(value: string): string {
  return value.replace(
    /<(?:(?:[\w-]+:)?math)\b[^>]*>([\s\S]*?)<\/(?:(?:[\w-]+:)?math)>/gi,
    (_match, inner) => {
      const text = String(inner || '').replace(/<[^>]+>/g, '');
      return ` ${decodeBasicHtmlEntities(text)} `;
    },
  );
}

export function normalizeScholarlyLinkTitle(value: unknown): string {
  return decodeBasicHtmlEntities(mathMarkupToText(toTrimmedString(value)).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const NON_RESEARCH_ACTIVITY_TITLE_RE =
  /^(?:erratum|corrigendum|correction|retraction|expression\s+of\s+concern)\b|^table\s+of\s+contents\b|table\s+of\s+contents/i;

const NON_RESEARCH_ACTIVITY_TYPES = new Set([
  'erratum',
  'corrigendum',
  'correction',
  'retraction',
  'paratext',
]);

const normalizeDoi = (value: unknown): string => {
  const raw = toTrimmedString(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '');
  return raw;
};

const externalId = (paper: PaperLike, keys: string[]): string => {
  const externalIds = paper.externalIds || {};
  for (const key of keys) {
    const direct = toTrimmedString((externalIds as Record<string, unknown>)[key]);
    if (direct) return direct;
  }
  return '';
};

const destinationFromUrl = (
  rawUrl: unknown,
  options: { openAccess?: boolean } = {},
): ScholarlyDestination | null => {
  const url = toTrimmedString(rawUrl);
  const parsed = parseNormalizedHttpUrl(url);
  if (!parsed) return null;

  if (parsed.host === 'doi.org' || parsed.host === 'dx.doi.org') {
    return { url, destinationKind: 'DOI', displaySource: 'DOI' };
  }
  if (parsed.host.includes('pubmed.ncbi.nlm.nih.gov')) {
    return { url, destinationKind: 'PUBMED', displaySource: 'PubMed' };
  }
  if (parsed.host.includes('ncbi.nlm.nih.gov') && parsed.path.includes('/pmc/')) {
    return { url, destinationKind: 'PMC', displaySource: 'PMC' };
  }
  if (parsed.host.includes('arxiv.org')) {
    return { url, destinationKind: 'ARXIV', displaySource: 'arXiv' };
  }
  if (parsed.host.includes('orcid.org')) {
    return { url, destinationKind: 'ORCID', displaySource: 'ORCID' };
  }
  if (parsed.host.includes('openalex.org')) {
    return { url, destinationKind: 'OPENALEX', displaySource: 'OpenAlex record' };
  }
  return {
    url,
    destinationKind: 'PUBLISHER',
    displaySource: options.openAccess ? 'Open access full text' : 'Publisher page',
  };
};

const readableOpenAccessDestination = (paper: PaperLike): ScholarlyDestination | null => {
  const destinations = [paper.openAccessUrl, paper.pdfUrl]
    .map((url) => destinationFromUrl(url, { openAccess: true }))
    .filter((destination): destination is ScholarlyDestination => destination !== null);

  return (
    destinations.find(
      (destination) =>
        destination.destinationKind !== 'DOI' && destination.destinationKind !== 'OPENALEX',
    ) || null
  );
};

const freeFullTextLabelForDestination = (destination: ScholarlyDestination): string =>
  destination.url.toLowerCase().includes('.pdf') ||
  destination.url.toLowerCase().includes('/pdf') ||
  destination.url.toLowerCase().includes('pdf=')
    ? 'Free PDF'
    : 'Free full text';

export function isDisplayableResearchActivityLink(
  link: Pick<PublicScholarlyLink, 'title' | 'venue'> & {
    destinationKind?: ScholarlyLinkDestinationKind;
    confidence?: number;
    publicationTypes?: string[];
    type?: string;
  },
): boolean {
  const title = normalizeScholarlyLinkTitle(link.title);
  if (!title) return false;
  if (NON_RESEARCH_ACTIVITY_TITLE_RE.test(title)) return false;
  if (link.destinationKind === 'OPENALEX') return false;
  if (typeof link.confidence === 'number' && link.confidence < 0.7) return false;

  const typeValues = [
    toTrimmedString(link.type),
    ...(link.publicationTypes || []).map((value) => toTrimmedString(value)),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  return !typeValues.some((value) => NON_RESEARCH_ACTIVITY_TYPES.has(value));
}

export function chooseBestScholarlyDestination(paper: PaperLike): ScholarlyDestination | null {
  const doi = normalizeDoi(paper.doi || externalId(paper, ['doi', 'DOI']));
  if (doi) {
    return {
      url: `https://doi.org/${doi}`,
      destinationKind: 'DOI',
      displaySource: 'DOI',
    };
  }

  const landing = destinationFromUrl(paper.landingPageUrl);
  if (landing) return landing;

  const pmid = externalId(paper, ['pmid', 'PMID']).replace(
    /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i,
    '',
  );
  if (pmid) {
    return {
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid.replace(/\/$/, '')}/`,
      destinationKind: 'PUBMED',
      displaySource: 'PubMed',
    };
  }

  const pmcid = externalId(paper, ['pmcid', 'PMCID']);
  if (pmcid) {
    const normalized = pmcid.toUpperCase().startsWith('PMC') ? pmcid : `PMC${pmcid}`;
    return {
      url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${normalized}/`,
      destinationKind: 'PMC',
      displaySource: 'PMC',
    };
  }

  const arxivId = toTrimmedString(paper.arxivId || externalId(paper, ['arxiv', 'arxivId']));
  if (arxivId) {
    return {
      url: `https://arxiv.org/abs/${arxivId.replace(/^arxiv:/i, '')}`,
      destinationKind: 'ARXIV',
      displaySource: 'arXiv',
    };
  }

  return (
    destinationFromUrl(paper.openAccessUrl) ||
    destinationFromUrl(paper.pdfUrl) ||
    destinationFromUrl(paper.url)
  );
}

function inferDiscoverySource(paper: PaperLike): ScholarlyLinkDiscoverySource {
  const sources = (paper.sources || []).map((source) => source.toLowerCase());
  if (sources.includes('orcid')) return 'ORCID';
  if (sources.includes('openalex')) return 'OPENALEX';
  const url = toTrimmedString(paper.url || paper.sourceUrl).toLowerCase();
  if (url.includes('orcid.org')) return 'ORCID';
  if (url.includes('openalex.org')) return 'OPENALEX';
  return 'MANUAL';
}

function yearFromPaper(paper: PaperLike): number | undefined {
  if (typeof paper.year === 'number' && Number.isFinite(paper.year)) return paper.year;
  const date = paper.publishedAt || paper.postedAt || paper.versionDate;
  if (!date) return undefined;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.getFullYear();
}

function buildExternalIds(paper: PaperLike): PublicScholarlyLink['externalIds'] {
  const doi = normalizeDoi(paper.doi || externalId(paper, ['doi', 'DOI'])) || undefined;
  const openAlexId =
    toTrimmedString(
      paper.openAlexId || externalId(paper, ['openalex', 'openAlex', 'openAlexId']),
    ) || undefined;
  const arxivId =
    toTrimmedString(paper.arxivId || externalId(paper, ['arxiv', 'arxivId'])) || undefined;
  const pmid = externalId(paper, ['pmid', 'PMID']) || undefined;
  const pmcid = externalId(paper, ['pmcid', 'PMCID']) || undefined;
  return { doi, openAlexId, arxivId, pmid, pmcid };
}

export function buildScholarlyLinkFromPaper(
  paper: PaperLike,
  refs: { researchEntityId?: string; userId?: string } = {},
): Record<string, unknown> | null {
  const title = normalizeScholarlyLinkTitle(paper.title);
  if (!isDisplayableResearchActivityLink(paper as any)) return null;
  const destination = chooseBestScholarlyDestination(paper);
  if (!title || !destination) return null;
  if (
    !isDisplayableResearchActivityLink({
      ...paper,
      title,
      destinationKind: destination.destinationKind,
    })
  ) {
    return null;
  }
  const freeFullTextDestination = readableOpenAccessDestination(paper);

  return {
    ...refs,
    sourcePaperId: paper._id ? String(paper._id) : undefined,
    title,
    url: destination.url,
    destinationKind: destination.destinationKind,
    displaySource: destination.displaySource,
    freeFullTextUrl: freeFullTextDestination?.url,
    freeFullTextLabel: freeFullTextDestination
      ? freeFullTextLabelForDestination(freeFullTextDestination)
      : undefined,
    year: yearFromPaper(paper),
    venue: toTrimmedString(paper.venue),
    discoveredVia: inferDiscoverySource(paper),
    externalIds: buildExternalIds(paper),
    confidence: destination.destinationKind === 'OPENALEX' ? 0.55 : 0.8,
    observedAt: new Date(),
    sourceUrl: toTrimmedString(paper.sourceUrl || paper.url),
  };
}

export function toPublicScholarlyLink(link: Record<string, any>): PublicScholarlyLink {
  const observedAt = link.observedAt ? new Date(link.observedAt) : undefined;
  const externalIds = link.externalIds || undefined;
  return {
    _id: toTrimmedString(link._id),
    ...(toTrimmedString(link.researchEntityId)
      ? { researchEntityId: toTrimmedString(link.researchEntityId) }
      : {}),
    ...(toTrimmedString(link.userId) ? { userId: toTrimmedString(link.userId) } : {}),
    title: normalizeScholarlyLinkTitle(link.title),
    url: toTrimmedString(link.url),
    destinationKind: link.destinationKind,
    displaySource: toTrimmedString(link.displaySource),
    ...(toTrimmedString(link.freeFullTextUrl)
      ? {
          freeFullTextUrl: toTrimmedString(link.freeFullTextUrl),
          freeFullTextLabel: toTrimmedString(link.freeFullTextLabel) || 'Free full text',
        }
      : {}),
    discoveredVia: link.discoveredVia,
    ...(typeof link.year === 'number' ? { year: link.year } : {}),
    ...(toTrimmedString(link.venue) ? { venue: toTrimmedString(link.venue) } : {}),
    ...(typeof link.confidence === 'number' ? { confidence: link.confidence } : {}),
    ...(observedAt && !Number.isNaN(observedAt.getTime())
      ? { observedAt: observedAt.toISOString() }
      : {}),
    ...(externalIds ? { externalIds } : {}),
  };
}

export function buildPublicScholarlyLinksFromPapers(
  papers: Record<string, any>[],
  refs: { researchEntityId?: string; userId?: string } = {},
  limit = PUBLIC_SCHOLARLY_LINK_LIMIT,
): PublicScholarlyLink[] {
  const candidates = papers
    .map((paper) => legacyPaperToPublicLink(paper, refs))
    .filter((link): link is PublicScholarlyLink => link !== null)
    .sort((a, b) => (b.year || 0) - (a.year || 0));

  return mergePublicLinks(candidates, [], limit);
}

function toObjectId(value: unknown): mongoose.Types.ObjectId | null {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
}

function toObjectIds(values: unknown[]): mongoose.Types.ObjectId[] {
  return values
    .map((value) => toObjectId(value))
    .filter((value): value is mongoose.Types.ObjectId => value !== null);
}

function legacyPaperToPublicLink(
  paper: Record<string, any>,
  refs: { researchEntityId?: string; userId?: string },
): PublicScholarlyLink | null {
  const link = buildScholarlyLinkFromPaper(paper, refs);
  if (!link) return null;

  return toPublicScholarlyLink({
    _id: toTrimmedString(link.sourcePaperId) || toTrimmedString(link.url),
    ...link,
  });
}

function mergePublicLinks(
  primaryLinks: PublicScholarlyLink[],
  fallbackLinks: PublicScholarlyLink[],
  limit: number,
): PublicScholarlyLink[] {
  const seen = new Set<string>();
  const merged: PublicScholarlyLink[] = [];

  for (const link of [...primaryLinks, ...fallbackLinks]) {
    const normalizedTitle = link.title.replace(/\s+/g, ' ').trim().toLowerCase();
    const keys = [
      link.url.trim().toLowerCase(),
      normalizedTitle.length >= 20 ? normalizedTitle : '',
      link._id,
    ].filter(Boolean);
    if (keys.length === 0 || keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    merged.push(link);
    if (merged.length >= limit) break;
  }

  return merged;
}

function hasOrcidIdentityAnchor(user: Record<string, any> | null | undefined): boolean {
  if (!user) return false;
  return Boolean(toTrimmedString(user.orcid));
}

function filterIdentitySourcedLinksByOrcidAnchor(
  links: PublicScholarlyLink[],
  orcidAnchoredUserIds: Set<string>,
): PublicScholarlyLink[] {
  return links.filter((link) => {
    if (link.discoveredVia !== 'OPENALEX' && link.discoveredVia !== 'ORCID') return true;
    return Boolean(link.userId && orcidAnchoredUserIds.has(link.userId));
  });
}

async function orcidAnchoredUserIds(userObjectIds: mongoose.Types.ObjectId[]) {
  if (userObjectIds.length === 0) return new Set<string>();
  const users = await User.find({ _id: { $in: userObjectIds } })
    .select('_id orcid')
    .lean();
  return new Set(
    users.filter((user: any) => hasOrcidIdentityAnchor(user)).map((user: any) => String(user._id)),
  );
}

function idString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function uniqueObjectIds(values: unknown[]): mongoose.Types.ObjectId[] {
  const seen = new Set<string>();
  const ids: mongoose.Types.ObjectId[] = [];
  for (const value of values) {
    const objectId = toObjectId(value);
    if (!objectId) continue;
    const key = String(objectId);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(objectId);
  }
  return ids;
}

function attributionByLinkId(attributions: Record<string, any>[]) {
  const byLinkId = new Map<string, Record<string, any>>();
  for (const attribution of attributions) {
    const key = idString(attribution.scholarlyLinkId);
    if (key && !byLinkId.has(key)) byLinkId.set(key, attribution);
  }
  return byLinkId;
}

async function listAttributionBackedLinks(
  filter: Record<string, unknown>,
  applyAttributionTarget: (doc: Record<string, any>, attribution: Record<string, any>) => Record<string, any>,
  limit: number,
): Promise<PublicScholarlyLink[]> {
  const attributions = (await ResearchScholarlyAttribution.find({
    archived: { $ne: true },
    ...filter,
  })
    .sort({ relationshipBasis: 1, observedAt: -1, updatedAt: -1 })
    .limit(Math.max(limit * 4, 40))
    .lean()) as Record<string, any>[];

  const linkIds = uniqueObjectIds(attributions.map((attribution) => attribution.scholarlyLinkId));
  if (linkIds.length === 0) return [];

  const docs = (await ResearchScholarlyLink.find({
    archived: { $ne: true },
    _id: { $in: linkIds },
  })
    .sort({ discoveredVia: 1, year: -1, observedAt: -1, createdAt: -1 })
    .limit(Math.max(limit * 4, 40))
    .lean()) as Record<string, any>[];

  const byLinkId = attributionByLinkId(attributions);
  return docs
    .map((doc) => {
      const attribution = byLinkId.get(idString(doc._id));
      return attribution ? toPublicScholarlyLink(applyAttributionTarget(doc, attribution)) : null;
    })
    .filter((link): link is PublicScholarlyLink => link !== null)
    .filter(isDisplayableResearchActivityLink);
}

export async function listPublicMemberScholarlyLinks(
  userIds: unknown[],
  limit = PUBLIC_SCHOLARLY_LINK_LIMIT,
): Promise<PublicScholarlyLink[]> {
  const userObjectIds = toObjectIds(userIds);
  if (userObjectIds.length === 0) return [];

  let storedLinks = await listAttributionBackedLinks(
    { targetUserId: { $in: userObjectIds } },
    (doc, attribution) => ({ ...doc, userId: attribution.targetUserId }),
    limit,
  );

  if (storedLinks.length === 0) {
    const storedDocs = await ResearchScholarlyLink.find({
      archived: { $ne: true },
      userId: { $in: userObjectIds },
    })
      .sort({ discoveredVia: 1, year: -1, observedAt: -1, createdAt: -1 })
      .limit(Math.max(limit * 4, 40))
      .lean();
    storedLinks = (storedDocs as Record<string, any>[])
      .map((doc) => toPublicScholarlyLink(doc))
      .filter(isDisplayableResearchActivityLink);
  }

  const durableUserIds = await orcidAnchoredUserIds(userObjectIds);
  return mergePublicLinks(
    filterIdentitySourcedLinksByOrcidAnchor(storedLinks, durableUserIds),
    [],
    limit,
  );
}

export async function listPublicScholarlyLinksForUser(
  userId: unknown,
  limit = PUBLIC_SCHOLARLY_LINK_LIMIT,
): Promise<PublicScholarlyLink[]> {
  const userObjectId = toObjectId(userId);
  if (!userObjectId) return [];

  let storedLinks = await listAttributionBackedLinks(
    { targetUserId: userObjectId },
    (doc, attribution) => ({ ...doc, userId: attribution.targetUserId }),
    limit,
  );
  if (storedLinks.length === 0) {
    const docs = await ResearchScholarlyLink.find({
      archived: { $ne: true },
      userId: userObjectId,
    })
      .sort({ discoveredVia: 1, year: -1, observedAt: -1, createdAt: -1 })
      .limit(Math.max(limit * 4, 40))
      .lean();

    storedLinks = docs.map((doc) =>
      toPublicScholarlyLink({ userId: userObjectId, ...(doc as any) }),
    );
  }
  const displayableStoredLinks = storedLinks.filter(isDisplayableResearchActivityLink);
  const user = await User.findById(userObjectId).select('_id orcid').lean();
  const durableUserIds = hasOrcidIdentityAnchor(user as any)
    ? new Set([String(userObjectId)])
    : new Set<string>();
  return mergePublicLinks(
    filterIdentitySourcedLinksByOrcidAnchor(displayableStoredLinks, durableUserIds),
    [],
    limit,
  );
}

export async function listPublicScholarlyLinksForResearchEntity(
  researchEntityId: unknown,
  userIds: unknown[] = [],
  limit = PUBLIC_SCHOLARLY_LINK_LIMIT,
): Promise<PublicScholarlyLink[]> {
  const entityObjectId = toObjectId(researchEntityId);
  if (!entityObjectId) return [];

  let storedLinks = await listAttributionBackedLinks(
    { targetResearchEntityId: entityObjectId },
    (doc, attribution) => ({ ...doc, researchEntityId: attribution.targetResearchEntityId }),
    limit,
  );
  if (storedLinks.length === 0) {
    const docs = await ResearchScholarlyLink.find({
      archived: { $ne: true },
      researchEntityId: entityObjectId,
    })
      .sort({ discoveredVia: 1, year: -1, observedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    storedLinks = docs
      .map((doc) => toPublicScholarlyLink(doc as any))
      .filter(isDisplayableResearchActivityLink);
  }
  return mergePublicLinks(storedLinks, [], limit);
}
