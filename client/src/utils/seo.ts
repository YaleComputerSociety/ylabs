/**
 * Client-side SEO fallback for the SPA.
 *
 * Express injects crawler-visible metadata for built public research routes.
 * During Vite development or static-only hosting, this updater provides the
 * strongest practical fallback after React loads.
 */
import { Listing } from '../types/types';

export type SeoMetadata = {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  type: 'website' | 'article';
};

const SITE_NAME = 'YaleLabs';
const DEFAULT_SITE_TITLE = 'YaleLabs';
const DEFAULT_SITE_DESCRIPTION = 'Find research labs at Yale University';
const DEFAULT_RESEARCH_TITLE = 'YaleLabs Research';
const DEFAULT_RESEARCH_DESCRIPTION =
  'Discover confirmed Yale research labs and opportunities by topic, department, and faculty mentor.';

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

const professorName = (listing: Partial<Listing>): string | undefined => {
  const name = compact(`${listing.ownerFirstName || ''} ${listing.ownerLastName || ''}`);
  return name || undefined;
};

export const buildResearchSeoMetadata = (params: {
  origin: string;
  pathname: string;
  listing?: Partial<Listing> | null;
}): SeoMetadata => {
  const origin = params.origin.replace(/\/+$/, '');
  const canonicalUrl = `${origin}${params.pathname.startsWith('/') ? params.pathname : `/${params.pathname}`}`;
  const imageUrl = `${origin}/logo192.png`;

  if (!params.listing) {
    return {
      title: DEFAULT_RESEARCH_TITLE,
      description: DEFAULT_RESEARCH_DESCRIPTION,
      canonicalUrl,
      imageUrl,
      type: 'website',
    };
  }

  const listing = params.listing;
  const owner = professorName(listing);
  const title = truncate(`${listing.title || 'Research listing'} | ${SITE_NAME}`, 65);
  const topicalContext =
    joinList(listing.researchAreas) || joinList(listing.keywords) || joinList(listing.departments);
  const attribution = [owner, listing.ownerPrimaryDepartment || joinList(listing.departments)]
    .filter(Boolean)
    .join(', ');
  const fallbackDescription = compact(
    [
      listing.title || 'Yale research listing',
      attribution ? `with ${attribution}` : undefined,
      topicalContext ? `Research areas include ${topicalContext}.` : undefined,
    ]
      .filter(Boolean)
      .join(' '),
  );

  return {
    title,
    description: truncate(
      firstNonEmpty(listing.description, listing.applicantDescription, fallbackDescription) ||
        DEFAULT_RESEARCH_DESCRIPTION,
      160,
    ),
    canonicalUrl,
    imageUrl,
    type: 'article',
  };
};

export const buildDefaultSeoMetadata = (params: {
  origin: string;
  pathname: string;
}): SeoMetadata => {
  const origin = params.origin.replace(/\/+$/, '');
  const canonicalUrl = `${origin}${params.pathname.startsWith('/') ? params.pathname : `/${params.pathname}`}`;

  return {
    title: DEFAULT_SITE_TITLE,
    description: DEFAULT_SITE_DESCRIPTION,
    canonicalUrl,
    imageUrl: `${origin}/logo192.png`,
    type: 'website',
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
