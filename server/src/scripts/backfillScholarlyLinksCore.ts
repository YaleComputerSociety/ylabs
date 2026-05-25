import {
  buildScholarlyLinkFromPaper,
  MIGRATED_SCHOLARLY_LINK_LIMIT,
  normalizeScholarlyLinkTitle,
} from '../services/scholarlyLinkService';

export interface BackfillScholarlyLinksOptions {
  apply: boolean;
  limit: number;
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
    limit: 1000,
    limitPerEntity: MIGRATED_SCHOLARLY_LINK_LIMIT,
    limitPerUser: 10,
    scope: 'all',
    userIds: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        options.limit = Math.floor(value);
      }
    }
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

function trimmed(value: unknown): string {
  return String(value || '').trim();
}

function openAlexUrlForPaper(paper: Record<string, any>): string {
  const values = [paper.openAlexId, paper.url, paper.sourceUrl]
    .map(trimmed)
    .filter(Boolean);
  const openAlex = values.find((value) => /openalex\.org\/w/i.test(value));
  if (!openAlex) return '';
  return /^https?:\/\//i.test(openAlex) ? openAlex : `https://openalex.org/${openAlex}`;
}

function buildAnchorOnlyOpenAlexLinkFromPaper(
  paper: Record<string, any>,
  refs: { researchEntityId?: string; userId?: string },
): Record<string, unknown> | null {
  const title = normalizeScholarlyLinkTitle(paper.title);
  const url = openAlexUrlForPaper(paper);
  if (!title || !url) return null;

  return {
    ...refs,
    sourcePaperId: paper._id ? String(paper._id) : undefined,
    title,
    url,
    destinationKind: 'OPENALEX',
    displaySource: 'OpenAlex record',
    freeFullTextUrl: '',
    freeFullTextLabel: '',
    year: typeof paper.year === 'number' && Number.isFinite(paper.year) ? paper.year : undefined,
    venue: trimmed(paper.venue),
    discoveredVia: 'OPENALEX',
    externalIds: { openAlexId: url },
    confidence: 0.55,
    observedAt: new Date(),
    sourceUrl: trimmed(paper.sourceUrl || paper.url || paper.openAlexId),
  };
}

function buildAnchorOnlyLegacyLinkFromPaper(
  paper: Record<string, any>,
  refs: { researchEntityId?: string; userId?: string },
): Record<string, unknown> | null {
  const title = normalizeScholarlyLinkTitle(paper.title);
  const sourcePaperId = paperIdFor(paper);
  if (!title || !sourcePaperId) return null;

  return {
    ...refs,
    sourcePaperId,
    title,
    url: `legacy-paper:${sourcePaperId}`,
    destinationKind: 'OTHER',
    displaySource: 'Legacy paper record',
    freeFullTextUrl: '',
    freeFullTextLabel: '',
    year: typeof paper.year === 'number' && Number.isFinite(paper.year) ? paper.year : undefined,
    venue: trimmed(paper.venue),
    discoveredVia: 'LEGACY',
    externalIds: {},
    confidence: 0.1,
    observedAt: new Date(),
    sourceUrl: trimmed(paper.sourceUrl || paper.url || paper.openAlexId),
  };
}

export function selectScholarlyLinkCandidates(
  papers: Record<string, any>[],
  refs: { researchEntityId?: string; userId?: string },
  limitPerEntity = MIGRATED_SCHOLARLY_LINK_LIMIT,
  options: { includeAnchorOnlyOpenAlex?: boolean } = {},
): Record<string, any>[] {
  const built = papers
    .map(
      (paper) =>
        buildScholarlyLinkFromPaper(paper, refs) ||
        (options.includeAnchorOnlyOpenAlex
          ? buildAnchorOnlyOpenAlexLinkFromPaper(paper, refs) ||
            buildAnchorOnlyLegacyLinkFromPaper(paper, refs)
          : null),
    )
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

export interface LegacyPaperBackfillRef {
  paperId?: unknown;
  userId?: unknown;
  researchEntityId?: unknown;
}

export interface ScholarlyLinkBackfillSummary {
  scannedPapers: number;
  plannedUserLinks: number;
  plannedEntityLinks: number;
  plannedCreates: number;
  plannedUpdates: number;
  skippedAmbiguousUserLinks: number;
  skippedInvalidCandidates: number;
  samples: ScholarlyLinkBackfillSample[];
}

export interface ScholarlyLinkBackfillSample {
  scope: 'user' | 'entity';
  targetId: string;
  title: string;
  url: string;
  action: 'create' | 'update';
}

export interface ScholarlyLinkBackfillPlanInput {
  options: BackfillScholarlyLinksOptions;
  papers: Record<string, any>[];
  paperAuthors?: LegacyPaperBackfillRef[];
  paperEntityLinks?: LegacyPaperBackfillRef[];
  ambiguousUserIds: Set<string>;
  existingLinks: Record<string, any>[];
}

function normalizeId(value: unknown): string {
  return String(value || '').trim();
}

function paperIdFor(paper: Record<string, any>): string {
  return normalizeId(paper._id || paper.id);
}

function addNormalizedId(target: Set<string>, value: unknown): void {
  const id = normalizeId(value);
  if (id) target.add(id);
}

function addNormalizedIds(target: Set<string>, values: unknown): void {
  if (!Array.isArray(values)) return;
  for (const value of values) addNormalizedId(target, value);
}

function buildLegacyRefMap(
  refs: LegacyPaperBackfillRef[] | undefined,
  targetField: 'userId' | 'researchEntityId',
): Map<string, Set<string>> {
  const byPaperId = new Map<string, Set<string>>();
  for (const ref of refs || []) {
    const paperId = normalizeId(ref.paperId);
    const targetId = normalizeId(ref[targetField]);
    if (!paperId || !targetId) continue;
    const ids = byPaperId.get(paperId) || new Set<string>();
    ids.add(targetId);
    byPaperId.set(paperId, ids);
  }
  return byPaperId;
}

function paperUserIds(
  paper: Record<string, any>,
  paperAuthorMap: Map<string, Set<string>>,
): string[] {
  const ids = new Set<string>();
  addNormalizedIds(ids, paper.yaleAuthorIds);
  addNormalizedIds(ids, paper.userIds);
  addNormalizedIds(ids, paper.authorUserIds);
  for (const id of paperAuthorMap.get(paperIdFor(paper)) || []) ids.add(id);
  return Array.from(ids);
}

function paperResearchEntityIds(
  paper: Record<string, any>,
  paperEntityMap: Map<string, Set<string>>,
): string[] {
  const ids = new Set<string>();
  addNormalizedIds(ids, paper.researchEntityIds);
  addNormalizedIds(ids, paper.researchGroupIds);
  addNormalizedId(ids, paper.researchEntityId);
  for (const id of paperEntityMap.get(paperIdFor(paper)) || []) ids.add(id);
  return Array.from(ids);
}

function scopedKey(scope: 'user' | 'entity', targetId: string, url: string): string {
  return `${scope}:${targetId}:${url.trim().toLowerCase()}`;
}

function existingLinkKeys(existingLinks: Record<string, any>[]): Set<string> {
  const keys = new Set<string>();
  for (const link of existingLinks) {
    const url = String(link.url || '').trim();
    if (!url) continue;
    const userId = normalizeId(link.userId);
    const researchEntityId = normalizeId(link.researchEntityId);
    if (userId) keys.add(scopedKey('user', userId, url));
    if (researchEntityId) keys.add(scopedKey('entity', researchEntityId, url));
  }
  return keys;
}

function compactLinkSet(candidate: Record<string, any>): Record<string, unknown> {
  const set: Record<string, unknown> = {
    sourcePaperId: candidate.sourcePaperId,
    title: String(candidate.title || '').trim(),
    url: String(candidate.url || '').trim(),
    destinationKind: candidate.destinationKind,
    displaySource: candidate.displaySource,
    discoveredVia: candidate.discoveredVia,
    externalIds: candidate.externalIds || {},
    confidence: candidate.confidence,
    observedAt: candidate.observedAt || new Date(),
    sourceUrl: String(candidate.sourceUrl || '').trim(),
  };

  for (const field of [
    'userId',
    'researchEntityId',
    'freeFullTextUrl',
    'freeFullTextLabel',
    'venue',
  ]) {
    const value = candidate[field];
    if (value !== undefined && value !== null && String(value).trim()) {
      set[field] = value;
    }
  }
  if (typeof candidate.year === 'number' && Number.isFinite(candidate.year)) {
    set.year = candidate.year;
  }
  return set;
}

function isValidCompactCandidate(candidate: Record<string, any>): boolean {
  return Boolean(
    String(candidate.title || '').trim() &&
      String(candidate.url || '').trim() &&
      String(candidate.destinationKind || '').trim() &&
      String(candidate.displaySource || '').trim() &&
      String(candidate.discoveredVia || '').trim(),
  );
}

function appendOpsForTarget(args: {
  scope: 'user' | 'entity';
  targetId: string;
  papers: Record<string, any>[];
  limit: number;
  existingKeys: Set<string>;
  summary: ScholarlyLinkBackfillSummary;
  ops: any[];
}): void {
  const refField = args.scope === 'user' ? 'userId' : 'researchEntityId';
  const candidates = selectScholarlyLinkCandidates(
    args.papers,
    { [refField]: args.targetId },
    args.limit,
    { includeAnchorOnlyOpenAlex: true },
  );

  for (const candidate of candidates) {
    if (!isValidCompactCandidate(candidate)) {
      args.summary.skippedInvalidCandidates++;
      continue;
    }

    const url = String(candidate.url || '').trim();
    const key = scopedKey(args.scope, args.targetId, url);
    const action = args.existingKeys.has(key) ? 'update' : 'create';
    if (action === 'update') args.summary.plannedUpdates++;
    else args.summary.plannedCreates++;

    if (args.scope === 'user') args.summary.plannedUserLinks++;
    else args.summary.plannedEntityLinks++;

    const filter = {
      [refField]: args.targetId,
      url,
      archived: { $ne: true },
    };
    args.ops.push({
      updateOne: {
        filter,
        update: {
          $set: compactLinkSet(candidate),
          $setOnInsert: { archived: false },
        },
        upsert: true,
      },
    });

    if (args.summary.samples.length < 10) {
      args.summary.samples.push({
        scope: args.scope,
        targetId: args.targetId,
        title: String(candidate.title || '').trim(),
        url,
        action,
      });
    }
  }
}

export function buildScholarlyLinkBackfillPlan(input: ScholarlyLinkBackfillPlanInput): {
  ops: any[];
  summary: ScholarlyLinkBackfillSummary;
} {
  const paperAuthorMap = buildLegacyRefMap(input.paperAuthors, 'userId');
  const paperEntityMap = buildLegacyRefMap(input.paperEntityLinks, 'researchEntityId');
  const userFilter = new Set(input.options.userIds.map(normalizeId).filter(Boolean));
  const userPapers = new Map<string, Record<string, any>[]>();
  const entityPapers = new Map<string, Record<string, any>[]>();
  const summary: ScholarlyLinkBackfillSummary = {
    scannedPapers: input.papers.length,
    plannedUserLinks: 0,
    plannedEntityLinks: 0,
    plannedCreates: 0,
    plannedUpdates: 0,
    skippedAmbiguousUserLinks: 0,
    skippedInvalidCandidates: 0,
    samples: [],
  };

  for (const paper of input.papers) {
    if (input.options.scope !== 'entities') {
      for (const userId of paperUserIds(paper, paperAuthorMap)) {
        if (userFilter.size > 0 && !userFilter.has(userId)) continue;
        if (input.ambiguousUserIds.has(userId)) {
          summary.skippedAmbiguousUserLinks++;
          continue;
        }
        const papers = userPapers.get(userId) || [];
        papers.push(paper);
        userPapers.set(userId, papers);
      }
    }

    if (input.options.scope !== 'users') {
      for (const researchEntityId of paperResearchEntityIds(paper, paperEntityMap)) {
        const papers = entityPapers.get(researchEntityId) || [];
        papers.push(paper);
        entityPapers.set(researchEntityId, papers);
      }
    }
  }

  const ops: any[] = [];
  const existingKeys = existingLinkKeys(input.existingLinks);

  for (const [userId, papers] of userPapers) {
    appendOpsForTarget({
      scope: 'user',
      targetId: userId,
      papers,
      limit: input.options.limitPerUser,
      existingKeys,
      summary,
      ops,
    });
  }
  for (const [researchEntityId, papers] of entityPapers) {
    appendOpsForTarget({
      scope: 'entity',
      targetId: researchEntityId,
      papers,
      limit: input.options.limitPerEntity,
      existingKeys,
      summary,
      ops,
    });
  }

  return { ops, summary };
}

export function summarizeScholarlyLinkBackfill(
  input: ScholarlyLinkBackfillSummary & {
    apply: boolean;
    totalEligible?: number;
    scope: BackfillScholarlyLinksOptions['scope'];
  },
) {
  return {
    mode: input.apply ? 'apply' : 'dry-run',
    scope: input.scope,
    totalEligible: input.totalEligible,
    scannedPapers: input.scannedPapers,
    planned: input.plannedUserLinks + input.plannedEntityLinks,
    written: input.apply ? input.plannedUserLinks + input.plannedEntityLinks : 0,
    plannedUserLinks: input.plannedUserLinks,
    plannedEntityLinks: input.plannedEntityLinks,
    plannedCreates: input.plannedCreates,
    plannedUpdates: input.plannedUpdates,
    skippedAmbiguousUserLinks: input.skippedAmbiguousUserLinks,
    skippedInvalidCandidates: input.skippedInvalidCandidates,
    samples: input.samples,
  };
}
