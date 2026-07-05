/**
 * Client-side SEO fallback for the SPA.
 *
 * Express injects crawler-visible metadata for built public research routes.
 * During Vite development or static-only hosting, this updater provides the
 * strongest practical fallback after React loads.
 */
import type { ResearchEntity } from '../types/researchEntity';

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

export const buildResearchSeoMetadata = (params: {
  origin: string;
  pathname: string;
  researchEntity?: Partial<ResearchEntity> | null;
}): SeoMetadata => {
  const origin = params.origin.replace(/\/+$/, '');
  const canonicalUrl = `${origin}${params.pathname.startsWith('/') ? params.pathname : `/${params.pathname}`}`;
  const imageUrl = `${origin}/brand/apple-touch-icon.svg`;

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
      ) ||
        DEFAULT_RESEARCH_DESCRIPTION,
      160,
    ),
    canonicalUrl,
    imageUrl,
    type: 'article',
  };
};

const upsertMeta = (selector: string, attrs: Record<string, string>) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }

  Object.entries(attrs).forEach(([name, value]) => {
    element!.setAttribute(name, value);
  });
};

const upsertCanonical = (href: string) => {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
};

export const applySeoMetadata = (metadata: SeoMetadata) => {
  document.title = metadata.title;
  upsertCanonical(metadata.canonicalUrl);
  upsertMeta('meta[name="description"]', {
    name: 'description',
    content: metadata.description,
  });
  upsertMeta('meta[property="og:site_name"]', {
    property: 'og:site_name',
    content: SITE_NAME,
  });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: metadata.type });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: metadata.title });
  upsertMeta('meta[property="og:description"]', {
    property: 'og:description',
    content: metadata.description,
  });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: metadata.canonicalUrl });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: metadata.imageUrl });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: metadata.title });
  upsertMeta('meta[name="twitter:description"]', {
    name: 'twitter:description',
    content: metadata.description,
  });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: metadata.imageUrl });
};
