import {
  buildScholarlyLinkFromPaper,
  MIGRATED_SCHOLARLY_LINK_LIMIT,
} from '../services/scholarlyLinkService';

export interface BackfillScholarlyLinksOptions {
  apply: boolean;
  limitPerEntity: number;
  limitPerUser: number;
  scope: 'all' | 'entities' | 'users';
  userIds: string[];
}

export interface ScholarlyLinkIdentityUser {
  _id: unknown;
  orcid?: string | null;
  openAlexId?: string | null;
}

export function parseBackfillScholarlyLinksArgs(argv: string[]): BackfillScholarlyLinksOptions {
  const options: BackfillScholarlyLinksOptions = {
    apply: argv.includes('--apply'),
    limitPerEntity: MIGRATED_SCHOLARLY_LINK_LIMIT,
    limitPerUser: 10,
    scope: 'all',
    userIds: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit-per-entity=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        options.limitPerEntity = Math.floor(value);
      }
    }
    if (arg.startsWith('--limit-per-user=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        options.limitPerUser = Math.floor(value);
      }
    }
    if (arg.startsWith('--scope=')) {
      const value = arg.split('=')[1];
      if (value === 'all' || value === 'entities' || value === 'users') {
        options.scope = value;
      }
    }
    if (arg.startsWith('--user-id=')) {
      const values = arg
        .split('=')[1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      options.userIds.push(...values);
    }
  }

  return options;
}

function normalizeOrcid(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .toUpperCase();
}

function normalizeOpenAlexId(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function addIdentity(
  identities: Map<string, Set<string>>,
  key: string,
  userId: string,
): void {
  if (!key) return;
  const ids = identities.get(key) || new Set<string>();
  ids.add(userId);
  identities.set(key, ids);
}

export function findAmbiguousExternalIdentityUserIds(
  users: ScholarlyLinkIdentityUser[],
): Set<string> {
  const identities = new Map<string, Set<string>>();

  for (const user of users) {
    const userId = String(user._id || '');
    if (!userId) continue;
    const orcid = normalizeOrcid(user.orcid);
    const openAlexId = normalizeOpenAlexId(user.openAlexId);
    addIdentity(identities, orcid ? `orcid:${orcid}` : '', userId);
    addIdentity(identities, openAlexId ? `openalex:${openAlexId}` : '', userId);
  }

  const ambiguous = new Set<string>();
  for (const ids of identities.values()) {
    if (ids.size <= 1) continue;
    for (const id of ids) ambiguous.add(id);
  }
  return ambiguous;
}

function sortableYear(candidate: Record<string, any>): number {
  return typeof candidate.year === 'number' ? candidate.year : 0;
}

export function selectScholarlyLinkCandidates(
  papers: Record<string, any>[],
  refs: { researchEntityId?: string; userId?: string },
  limitPerEntity = MIGRATED_SCHOLARLY_LINK_LIMIT,
): Record<string, any>[] {
  const built = papers
    .map((paper) => buildScholarlyLinkFromPaper(paper, refs))
    .filter((candidate): candidate is Record<string, any> => !!candidate)
    .sort((a, b) => {
      const yearDiff = sortableYear(b) - sortableYear(a);
      if (yearDiff !== 0) return yearDiff;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

  const byUrl = new Map<string, Record<string, any>>();
  for (const candidate of built) {
    const url = String(candidate.url || '').trim().toLowerCase();
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, candidate);
    if (byUrl.size >= limitPerEntity) break;
  }

  return Array.from(byUrl.values());
}
