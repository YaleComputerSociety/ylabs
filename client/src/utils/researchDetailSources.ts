interface DetailSourceGroup {
  websiteUrl?: string;
  sourceUrls?: string[];
}

interface DetailSourcePathway {
  sourceUrls?: string[];
}

interface DetailSourceSignal {
  signalType?: string;
  sourceUrl?: string;
}

interface DetailSourceContactRoute {
  routeType?: string;
  label?: string;
  name?: string;
  url?: string;
  sourceUrl?: string;
}

interface DetailSourcePostedOpportunity {
  applicationUrl?: string;
  sourceUrls?: string[];
}

export interface BuildResearchDetailSourcesInput {
  group?: DetailSourceGroup | null;
  pathways?: DetailSourcePathway[];
  accessSignals?: DetailSourceSignal[];
  contactRoutes?: DetailSourceContactRoute[];
  postedOpportunities?: DetailSourcePostedOpportunity[];
}

export interface ResearchDetailSource {
  url: string;
  label: string;
  contexts: string[];
}

export const normalizeSourceUrl = (url?: string | null): string | null => {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
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
  pathways = [],
  accessSignals = [],
  contactRoutes = [],
  postedOpportunities = [],
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

  pathways.forEach((pathway) => {
    pathway.sourceUrls?.forEach((url) => addSource(url, 'Pathway source'));
  });

  accessSignals.forEach((signal) => {
    addSource(signal.sourceUrl, `${labelizeResearchDetailValue(signal.signalType)} evidence`);
  });

  contactRoutes.forEach((route) => {
    const label = route.label || route.name || labelizeResearchDetailValue(route.routeType);
    addSource(route.url, `${label} route`);
    addSource(route.sourceUrl, `${label} route`);
  });

  postedOpportunities.forEach((opportunity) => {
    addSource(opportunity.applicationUrl, 'Application route');
    opportunity.sourceUrls?.forEach((url) => addSource(url, 'Posted opportunity source'));
  });

  return Array.from(sources.values());
};
