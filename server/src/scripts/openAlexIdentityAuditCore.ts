export type OpenAlexIdentityStatus =
  | 'ok'
  | 'missing-openalex-id'
  | 'mismatch'
  | 'orcid-unresolved'
  | 'locked';

export type OpenAlexIdentityRecommendedAction =
  | 'none'
  | 'set-openalex-id'
  | 'replace-openalex-id-clear-legacy-publications'
  | 'review-orcid'
  | 'manual-review-locked-fields';

export interface OpenAlexIdentityAuditArgs {
  apply: boolean;
  limit: number;
  refreshTopics: boolean;
  format: 'table' | 'json';
  netid?: string;
}

export interface OpenAlexIdentityWorkSample {
  title: string;
  year?: number;
  venue?: string;
}

export interface OpenAlexIdentityAuditUser {
  id: string;
  netid?: string;
  fname?: string;
  lname?: string;
  orcid?: string;
  openAlexId?: string;
  topics?: string[];
  publications?: OpenAlexIdentityWorkSample[];
  manuallyLockedFields?: string[];
  hIndex?: number;
  officialTopics?: string[];
}

export interface OpenAlexIdentityLookup {
  authorId: string | null;
  displayName?: string;
  topics?: string[];
  sampleWorks?: OpenAlexIdentityWorkSample[];
  hIndex?: number;
}

export interface OpenAlexIdentityAuditDeps {
  resolveByOrcid: (orcid: string, user: OpenAlexIdentityAuditUser) => Promise<OpenAlexIdentityLookup>;
  loadStoredAuthorWorks?: (
    storedOpenAlexId: string,
    user: OpenAlexIdentityAuditUser,
  ) => Promise<OpenAlexIdentityWorkSample[]>;
}

export interface OpenAlexIdentityAuditRow {
  userId: string;
  netid?: string;
  name: string;
  orcid: string;
  storedOpenAlexId: string | null;
  orcidResolvedOpenAlexId: string | null;
  status: OpenAlexIdentityStatus;
  recommendedAction: OpenAlexIdentityRecommendedAction;
  badTopics: string[];
  sampleBadWorks: OpenAlexIdentityWorkSample[];
  resolvedTopics: string[];
  resolvedHIndex?: number;
  lockedFields: string[];
}

export interface OpenAlexIdentityRepairOptions {
  refreshTopics?: boolean;
}

export interface OpenAlexIdentityRepairUpdate {
  $set?: Record<string, unknown>;
  $unset?: Record<string, ''>;
}

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

export function parseOpenAlexIdentityAuditArgs(argv: string[]): OpenAlexIdentityAuditArgs {
  let apply = false;
  let limit = 100;
  let refreshTopics = false;
  let format: OpenAlexIdentityAuditArgs['format'] = 'table';
  let netid: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    if (arg === '--refresh-topics') {
      refreshTopics = true;
      continue;
    }
    if (arg === '--json') {
      format = 'json';
      continue;
    }

    const netidValue = valueAfterEquals(arg, '--netid') || (arg === '--netid' ? argv[++index] : '');
    if (netidValue) {
      netid = netidValue.trim().toLowerCase();
      continue;
    }

    const limitValue = valueAfterEquals(arg, '--limit') || (arg === '--limit' ? argv[++index] : '');
    if (limitValue) {
      const parsed = Number(limitValue);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return netid ? { apply, limit, refreshTopics, format, netid } : { apply, limit, refreshTopics, format };
}

export function normalizeOrcid(value?: string | null): string {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/(\d{4}-\d{4}-\d{4}-[\dX]{4})/i);
  return match ? match[1].toUpperCase() : '';
}

export function normalizeOpenAlexAuthorId(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/A\d+/i);
  if (!match) return null;
  return `https://openalex.org/${match[0].toUpperCase()}`;
}

function compactStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function sampleWorksFromPublications(user: OpenAlexIdentityAuditUser): OpenAlexIdentityWorkSample[] {
  return (user.publications || [])
    .map((publication) => ({
      title: String(publication.title || '').trim(),
      year: publication.year,
      venue: publication.venue,
    }))
    .filter((publication) => publication.title)
    .slice(0, 5);
}

function fullName(user: OpenAlexIdentityAuditUser): string {
  return `${user.fname || ''} ${user.lname || ''}`.replace(/\s+/g, ' ').trim();
}

function hasLockedRepairField(user: OpenAlexIdentityAuditUser): boolean {
  const locks = new Set((user.manuallyLockedFields || []).map((field) => field.trim()));
  return ['openAlexId', 'topics', 'publications'].some((field) => locks.has(field));
}

function recommendedActionForStatus(
  status: OpenAlexIdentityStatus,
): OpenAlexIdentityRecommendedAction {
  if (status === 'missing-openalex-id') return 'set-openalex-id';
  if (status === 'mismatch') return 'replace-openalex-id-clear-legacy-publications';
  if (status === 'orcid-unresolved') return 'review-orcid';
  if (status === 'locked') return 'manual-review-locked-fields';
  return 'none';
}

export async function buildOpenAlexIdentityAuditRows(
  users: OpenAlexIdentityAuditUser[],
  deps: OpenAlexIdentityAuditDeps,
): Promise<OpenAlexIdentityAuditRow[]> {
  const rows: OpenAlexIdentityAuditRow[] = [];

  for (const user of users) {
    const orcid = normalizeOrcid(user.orcid);
    if (!orcid) continue;

    const storedOpenAlexId = normalizeOpenAlexAuthorId(user.openAlexId);
    const lookup = await deps.resolveByOrcid(orcid, user);
    const orcidResolvedOpenAlexId = normalizeOpenAlexAuthorId(lookup.authorId);

    let status: OpenAlexIdentityStatus;
    if (!orcidResolvedOpenAlexId) {
      status = 'orcid-unresolved';
    } else if (!storedOpenAlexId) {
      status = 'missing-openalex-id';
    } else if (storedOpenAlexId !== orcidResolvedOpenAlexId) {
      status = 'mismatch';
    } else {
      status = 'ok';
    }

    if ((status === 'mismatch' || status === 'missing-openalex-id') && hasLockedRepairField(user)) {
      status = 'locked';
    }

    const resolvedTopics = compactStrings(
      user.officialTopics && user.officialTopics.length > 0 ? user.officialTopics : lookup.topics || [],
    );
    const sampleBadWorks =
      status === 'mismatch' && storedOpenAlexId && deps.loadStoredAuthorWorks
        ? await deps.loadStoredAuthorWorks(storedOpenAlexId, user)
        : [];

    rows.push({
      userId: user.id,
      netid: user.netid,
      name: fullName(user),
      orcid,
      storedOpenAlexId,
      orcidResolvedOpenAlexId,
      status,
      recommendedAction: recommendedActionForStatus(status),
      badTopics: status === 'mismatch' ? compactStrings(user.topics || []) : [],
      sampleBadWorks: (sampleBadWorks.length ? sampleBadWorks : sampleWorksFromPublications(user)).slice(
        0,
        5,
      ),
      resolvedTopics,
      resolvedHIndex: lookup.hIndex,
      lockedFields: compactStrings(user.manuallyLockedFields || []),
    });
  }

  return rows;
}

export function buildOpenAlexIdentityRepairUpdate(
  row: OpenAlexIdentityAuditRow,
  options: OpenAlexIdentityRepairOptions = {},
): OpenAlexIdentityRepairUpdate | null {
  if (row.status !== 'mismatch' && row.status !== 'missing-openalex-id') return null;
  if (!row.orcidResolvedOpenAlexId) return null;

  const locked = new Set(row.lockedFields);
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};

  if (!locked.has('openAlexId')) {
    set.openAlexId = row.orcidResolvedOpenAlexId;
  }
  if (row.resolvedHIndex !== undefined && !locked.has('hIndex')) {
    set.hIndex = row.resolvedHIndex;
  }
  if (options.refreshTopics && row.resolvedTopics.length > 0 && !locked.has('topics')) {
    set.topics = row.resolvedTopics;
  }
  if (row.status === 'mismatch' && !locked.has('publications')) {
    unset.publications = '';
  }

  const update: OpenAlexIdentityRepairUpdate = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return Object.keys(update).length > 0 ? update : null;
}
