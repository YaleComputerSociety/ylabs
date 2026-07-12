const DOI_PREFIX_RE = /^https?:\/\/(?:dx\.)?doi\.org\//i;
const ARXIV_PREFIX_RE = /^(?:https?:\/\/arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)/i;

const normalizeIdentifier = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
    : '';

export const canonicalScholarlyWorkKey = (link: Record<string, any>): string => {
  const doiValue =
    link.externalIds?.doi ||
    link.externalIds?.DOI ||
    link.doi ||
    (DOI_PREFIX_RE.test(String(link.url || '')) ? link.url : undefined);
  const doi = normalizeIdentifier(doiValue).replace(DOI_PREFIX_RE, '');
  if (doi) return `doi:${doi}`;

  const arxiv = normalizeIdentifier(
    link.externalIds?.arxivId ||
      link.externalIds?.arxiv ||
      link.externalIds?.ARXIV ||
      link.arxivId ||
      link.url,
  )
    .replace(ARXIV_PREFIX_RE, '')
    .replace(/v\d+$/, '')
    .replace(/\.pdf$/, '');
  if (/^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})$/i.test(arxiv)) return `arxiv:${arxiv}`;

  for (const [prefix, value] of [
    ['openalex', link.externalIds?.openAlexId],
    ['pmid', link.externalIds?.pmid],
    ['pmcid', link.externalIds?.pmcid],
  ] as const) {
    const normalized = normalizeIdentifier(value);
    if (normalized) return `${prefix}:${normalized}`;
  }

  const url = normalizeIdentifier(link.url);
  if (url) return `url:${url}`;
  return `title:${normalizeIdentifier(link.title)}|year:${Number(link.year) || ''}`;
};

const TOPIC_FAMILIES: Record<string, readonly RegExp[]> = {
  biomedical: [
    /\b(?:immun(?:e|ity|ology)|cell|molecular|genom|protein|cancer|disease|pathogen|microbi|antibod|cytokine|t\s*cell)\w*\b/i,
  ],
  militarySocialPolicy: [
    /\b(?:military|veteran|armed forces|homelessness|lgbtq?|sexual minorit|housing insecurity)\w*\b/i,
  ],
};

const topicFamilies = (value: unknown): Set<string> => {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '');
  return new Set(
    Object.entries(TOPIC_FAMILIES)
      .filter(([, patterns]) => patterns.some((pattern) => pattern.test(text)))
      .map(([family]) => family),
  );
};

const hasPersistentAuthorEvidence = (pair: ResearchActivityCandidate): boolean => {
  const ids = pair.link.externalIds || {};
  return Boolean(
    ids.authorOrcids?.length ||
    ids.authorOrcid ||
    ids.orcid ||
    pair.relationshipBasis?.toLowerCase().includes('orcid') ||
    pair.relationshipBasis?.toLowerCase().includes('manual'),
  );
};

export interface ResearchActivityCandidate {
  link: Record<string, any>;
  memberDisplayId?: unknown;
  relationshipBasis?: string;
  evidenceLabel?: string;
  confidence?: number;
  observedAt?: unknown;
  sourceName?: string;
  sourceUrl?: string;
  appointmentStartedAt?: unknown;
  appointmentEndedAt?: unknown;
}

export type ResearchActivityIntegrityDisposition =
  | 'current'
  | 'earlier'
  | 'identity_conflict'
  | 'duplicate';

export interface ResearchActivityIntegrityDecision {
  candidate: ResearchActivityCandidate;
  disposition: ResearchActivityIntegrityDisposition;
  reason?: string;
  canonicalKey: string;
}

const validYear = (value: unknown): number | undefined => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : undefined;
};

const dateYear = (value: unknown): number | undefined => {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.getUTCFullYear();
};

export function evaluateResearchActivityIntegrity(
  candidates: ResearchActivityCandidate[],
  entityTopicEvidence: unknown,
): ResearchActivityIntegrityDecision[] {
  const entityFamilies = topicFamilies(entityTopicEvidence);
  const seen = new Set<string>();

  return candidates.map((candidate) => {
    const canonicalKey = canonicalScholarlyWorkKey(candidate.link);
    if (seen.has(canonicalKey)) {
      return {
        candidate,
        disposition: 'duplicate',
        reason: 'Same canonical work already shown',
        canonicalKey,
      };
    }
    seen.add(canonicalKey);

    const paperFamilies = topicFamilies(
      [candidate.link.title, candidate.link.venue, candidate.link.abstract].filter(Boolean),
    );
    // This is intentionally a conflict flag, not a relevance classifier. The
    // audited collision is unusually specific; broader cross-field mismatch
    // rules would hide legitimate interdisciplinary scholarship.
    const topicConflict =
      (entityFamilies.has('biomedical') && paperFamilies.has('militarySocialPolicy')) ||
      (entityFamilies.has('militarySocialPolicy') && paperFamilies.has('biomedical'));
    if (topicConflict && !hasPersistentAuthorEvidence(candidate)) {
      return {
        candidate,
        disposition: 'identity_conflict',
        reason: 'Topic conflict without persistent-author evidence',
        canonicalKey,
      };
    }

    const workYear = validYear(candidate.link.year);
    const appointmentStartYear = dateYear(candidate.appointmentStartedAt);
    if (workYear && appointmentStartYear && workYear < appointmentStartYear) {
      return {
        candidate,
        disposition: 'earlier',
        reason: 'Published before the documented current appointment',
        canonicalKey,
      };
    }

    return { candidate, disposition: 'current', canonicalKey };
  });
}

export const researchActivityIntegrityCounts = (decisions: ResearchActivityIntegrityDecision[]) =>
  decisions.reduce(
    (counts, decision) => {
      counts[decision.disposition] += 1;
      return counts;
    },
    { current: 0, earlier: 0, identity_conflict: 0, duplicate: 0 },
  );
