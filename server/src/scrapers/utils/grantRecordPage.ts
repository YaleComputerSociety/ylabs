const LEAD_GRANT_ROLES: ReadonlySet<string> = new Set(['pi', 'copi']);

const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '');

const hostIs = (url: URL, registryHost: string): boolean => {
  const host = hostOf(url);
  return host === registryHost || host.endsWith(`.${registryHost}`);
};

type AwardRecordShape = (url: URL) => string | null;

const nihReporterProject: AwardRecordShape = (url) => {
  if (!hostIs(url, 'reporter.nih.gov')) return null;
  const project = /\/project-details\/(\d+)\/?$/i.exec(url.pathname)?.[1];
  return project ? `nih-reporter:${project}` : null;
};

const nsfAward: AwardRecordShape = (url) => {
  if (!hostIs(url, 'nsf.gov') || !/\/awardsearch\/show-?award/i.test(url.pathname)) return null;
  const award = url.searchParams.get('AWD_ID')?.trim();
  return award && /^\d+$/.test(award) ? `nsf:${award}` : null;
};

const nehAward: AwardRecordShape = (url) => {
  if (!hostIs(url, 'awardsearch.neh.gov') || !/\/awarddetail\.aspx$/i.test(url.pathname)) {
    return null;
  }
  const award = url.searchParams.get('gn')?.trim().toUpperCase();
  return award ? `neh:${award}` : null;
};

const ostiRecord: AwardRecordShape = (url) => {
  if (!hostIs(url, 'osti.gov')) return null;
  const record = /^\/biblio\/(\d+)\/?$/i.exec(url.pathname)?.[1];
  return record ? `osti:${record}` : null;
};

const AWARD_RECORD_SHAPES: readonly AwardRecordShape[] = [
  nihReporterProject,
  nsfAward,
  nehAward,
  ostiRecord,
];

export function grantAwardRecordKey(pageUrl: unknown): string | null {
  if (typeof pageUrl !== 'string' || !pageUrl.trim()) return null;
  let url: URL;
  try {
    url = new URL(pageUrl.trim());
  } catch {
    return null;
  }
  for (const shape of AWARD_RECORD_SHAPES) {
    const key = shape(url);
    if (key) return key;
  }
  return null;
}

export interface LeadGrantEntry {
  url?: unknown;
  role?: unknown;
}

export function leadGrantAwardRecordKeys(
  recentGrants: readonly unknown[] | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const grant of recentGrants ?? []) {
    if (!grant || typeof grant !== 'object') continue;
    const { url, role } = grant as LeadGrantEntry;
    if (typeof role !== 'string' || !LEAD_GRANT_ROLES.has(role)) continue;
    const key = grantAwardRecordKey(url);
    if (key) keys.add(key);
  }
  return keys;
}

export function isLeadGrantAwardRecordPage(
  pageUrl: unknown,
  leadGrantAwardKeys: ReadonlySet<string>,
): boolean {
  const key = grantAwardRecordKey(pageUrl);
  return key !== null && leadGrantAwardKeys.has(key);
}
