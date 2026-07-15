/**
 * SEO helpers for public research pages.
 *
 * The app is still a client-rendered SPA. These helpers let the production
 * Express server replace the built index.html metadata for public research
 * share URLs; Vite-only/static hosts fall back to the client head updater.
 */

export type PublicResearchSeoEntity = {
  id?: string;
  name?: string;
  displayName?: string;
  shortDescription?: string;
  description?: string;
  fullDescription?: string;
  profileSynthesisDescription?: string;
  departments?: string[];
  researchAreas?: string[];
  profileResearchAreas?: string[];
  keywords?: string[];
};

export type SeoMetadata = {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  type: 'website' | 'article';
};

const SITE_NAME = 'Yale Research';
const DEFAULT_RESEARCH_TITLE = 'Yale Research';
const DEFAULT_RESEARCH_DESCRIPTION =
  'Find research pathways, labs, programs, and evidence-backed next steps at Yale University.';
const SEO_START = '<!--YL_SEO_META_START-->';
const SEO_END = '<!--YL_SEO_META_END-->';

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

const stripHtml = (value: string): string => compact(value.replace(/<[^>]*>/g, ' '));

const truncate = (value: string, maxLength: number): string => {
  const clean = compact(value);
  if (clean.length <= maxLength) return clean;
  const truncated = clean.slice(0, maxLength - 1).trimEnd();
  const lastSpace = truncated.lastIndexOf(' ');
  return `${(lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated).trimEnd()}...`;
};

const firstNonEmpty = (...values: Array<string | undefined>): string | undefined =>
  values.map((value) => (value ? stripHtml(value) : '')).find(Boolean);

const joinList = (values: unknown): string | undefined => {
  if (!Array.isArray(values)) return undefined;
  const clean = values.filter((value): value is string => typeof value === 'string').map(compact);
  return clean.filter(Boolean).slice(0, 3).join(', ') || undefined;
};

export const buildPublicResearchSeoMetadata = (params: {
  baseUrl: string;
  path: string;
  researchEntity?: PublicResearchSeoEntity | null;
}): SeoMetadata => {
  const baseUrl = params.baseUrl.replace(/\/+$/, '');
  const path = params.path.startsWith('/') ? params.path : `/${params.path}`;
  const canonicalUrl = `${baseUrl}${path}`;
  const imageUrl = `${baseUrl}/brand/apple-touch-icon.svg`;

  if (!params.researchEntity) {
    return {
      title: DEFAULT_RESEARCH_TITLE,
      description: DEFAULT_RESEARCH_DESCRIPTION,
      canonicalUrl,
      imageUrl,
      type: 'website',
    };
  }

  const researchEntity = params.researchEntity;
  const name = firstNonEmpty(researchEntity.name, researchEntity.displayName) || 'Research profile';
  const title = truncate(`${name} | ${SITE_NAME}`, 65);
  const topicalContext =
    joinList(researchEntity.researchAreas) ||
    joinList(researchEntity.profileResearchAreas) ||
    joinList(researchEntity.keywords) ||
    joinList(researchEntity.departments);
  const departmentContext = joinList(researchEntity.departments);
  const fallbackDescription = compact(
    [
      name,
      departmentContext ? `at ${departmentContext}` : undefined,
      topicalContext ? `Research areas include ${topicalContext}.` : undefined,
    ]
      .filter(Boolean)
      .join(' '),
  );

  return {
    title,
    description: truncate(
      firstNonEmpty(
        researchEntity.shortDescription,
        researchEntity.description,
        researchEntity.fullDescription,
        researchEntity.profileSynthesisDescription,
        fallbackDescription,
      ) || DEFAULT_RESEARCH_DESCRIPTION,
      160,
    ),
    canonicalUrl,
    imageUrl,
    type: 'article',
  };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const renderSeoTags = (metadata: SeoMetadata): string => {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const canonicalUrl = escapeHtml(metadata.canonicalUrl);
  const imageUrl = escapeHtml(metadata.imageUrl);

  return [
    SEO_START,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${metadata.type}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:image" content="${imageUrl}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${imageUrl}" />`,
    SEO_END,
  ].join('\n    ');
};

export const injectSeoMetadata = (html: string, metadata: SeoMetadata): string => {
  const withTitle = html.replace(
    /<title>.*?<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`,
  );
  const startIndex = withTitle.indexOf(SEO_START);
  const endIndex = withTitle.indexOf(SEO_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return withTitle.replace('</head>', `    ${renderSeoTags(metadata)}\n  </head>`);
  }

  return `${withTitle.slice(0, startIndex)}${renderSeoTags(metadata)}${withTitle.slice(
    endIndex + SEO_END.length,
  )}`;
};

export const resolvePublicBaseUrl = (req: {
  protocol: string;
  get(name: string): string | undefined;
}): string => {
  const host = req.get('host') || 'localhost:4000';
  return `${req.protocol}://${host}`;
};
