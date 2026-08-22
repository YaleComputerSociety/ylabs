import { safeHttpUrl } from './url';

interface DetailSourceGroup {
  name?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}

interface DetailSourceSignal {
  _id?: string;
  signalType?: string;
  sourceUrl?: string;
}

interface DetailSourceUndergraduateLogistics {
  claims?: Array<{
    claimType?: string;
    state?: string;
    evidence?: { sourceUrl?: string };
  }>;
}

export interface BuildResearchDetailSourcesInput {
  group?: DetailSourceGroup | null;
  accessSignals?: DetailSourceSignal[];
  undergraduateLogistics?: DetailSourceUndergraduateLogistics;
}

export interface ResearchDetailSource {
  url: string;
  label: string;
  contexts: string[];
}

export const normalizeSourceUrl = (url?: string | null): string | null => {
  const safe = safeHttpUrl(url);
  if (!safe) return null;

  try {
    const parsed = new URL(safe);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

/**
 * Reduce a URL to a `host+path` destination key (scheme/www/query/hash/trailing
 * slash stripped) so two links that point at the same place compare equal. Used
 * to de-duplicate the professor/contact action links on the research detail page.
 */
export const normalizeActionDestination = (url?: string | null): string | null => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return normalized
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
};

export const labelizeResearchDetailValue = (value?: string): string =>
  (value || 'Unknown')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const isDepartmentRosterProvenanceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

    return (
      host.endsWith('yale.edu') &&
      (/^\/people\/faculty(?:-|\/|$)/.test(path) ||
        /^\/academic-study\/departments\/[^/]+\/faculty\/load_faculty(?:\/|$)/.test(path) ||
        (host === 'engineering.yale.edu' &&
          /^\/research-and-faculty\/faculty-directory\/[^/]+$/.test(path)))
    );
  } catch {
    return false;
  }
};

const titleFromPath = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  const rawLeaf = parts[parts.length - 1];
  const leaf = rawLeaf ? decodeURIComponent(rawLeaf) : '';
  if (!leaf) return 'Official source';
  if (/\.pdf$/i.test(leaf)) {
    return `${labelizeResearchDetailValue(leaf.replace(/\.pdf$/i, ''))} PDF`;
  }
  return `${labelizeResearchDetailValue(leaf)} page`;
};

export const sourceLabelForUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();

    if (host === 'wti.yale.edu' && path.includes('/initiatives/undergraduate')) {
      return 'Undergraduate initiatives page';
    }
    if (host.endsWith('yale.edu')) {
      return titleFromPath(parsed.pathname);
    }
    return `${host} source`;
  } catch {
    return 'Official source';
  }
};

export const buildResearchDetailSources = ({
  group,
  accessSignals = [],
  undergraduateLogistics,
}: BuildResearchDetailSourcesInput): ResearchDetailSource[] => {
  const sources = new Map<string, ResearchDetailSource>();

  const addSource = (url: string | undefined, context: string) => {
    const normalized = normalizeSourceUrl(url);
    if (!normalized) return;
    if (isDepartmentRosterProvenanceUrl(normalized)) return;

    const existing = sources.get(normalized);
    if (existing) {
      if (!existing.contexts.includes(context)) existing.contexts.push(context);
      return;
    }

    sources.set(normalized, {
      url: normalized,
      label: context === 'Profile website' ? 'Research website' : sourceLabelForUrl(normalized),
      contexts: [context],
    });
  };

  addSource(group?.websiteUrl, 'Profile website');
  group?.sourceUrls?.forEach((url) => addSource(url, 'Profile source'));

  accessSignals.forEach((signal) => {
    addSource(signal.sourceUrl, `${labelizeResearchDetailValue(signal.signalType)} evidence`);
  });

  undergraduateLogistics?.claims?.forEach((claim) => {
    if (claim.state !== 'known') return;
    addSource(
      claim.evidence?.sourceUrl,
      `${labelizeResearchDetailValue(claim.claimType)} logistics evidence`,
    );
  });

  return Array.from(sources.values());
};
