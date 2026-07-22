import { isPublicHttpUrl } from '../utils/urlSafety';

export const AUDITED_ROSTER_SOURCE = 'official-research-home-roster';
export const AUDITED_ROSTER_ROLES = new Set([
  'postdoc',
  'grad-student',
  'undergrad',
  'staff',
  'core-faculty',
  'affiliate',
]);

export interface RosterAuditMember {
  researchEntityId?: unknown;
  name?: unknown;
  title?: unknown;
  role?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  profileUrl?: unknown;
  identityKey?: unknown;
  membershipKey?: unknown;
  evidenceStatus?: unknown;
  isCurrentMember?: unknown;
  archived?: unknown;
  lastObservedAt?: unknown;
  freshnessExpiresAt?: unknown;
}

export interface RosterAuditSource {
  researchEntityKey: string;
  researchEntityId?: unknown;
  sourceUrl: string;
  enrichment?: {
    state?: unknown;
    sourceUrl?: unknown;
    observedAt?: unknown;
    freshnessExpiresAt?: unknown;
    memberKeys?: unknown;
  };
}

export interface RosterAuditReport {
  sourceName: string;
  generatedAt: string;
  counts: {
    totalRows: number;
    currentVerified: number;
    historical: number;
    staleCurrent: number;
    entitiesCovered: number;
    entitiesExpected: number;
    entitiesReady: number;
    entitiesBlocked: number;
    missingStableIdentity: number;
    identityCollisions: number;
    nameCollisions: number;
    unexpectedEntities: number;
    invalidRoles: number;
    unsafeUrls: number;
    directContactLeaks: number;
  };
  structuralPrecisionEligible: boolean;
  sampledPrecisionReviewed: boolean;
  sampledPrecisionReviewedBy?: string;
  broadEnablementReady: boolean;
  samples: Array<{
    researchEntityId: string;
    name: string;
    role: string;
    sourceUrl: string;
    profileUrl: string;
    lastObservedAt: string;
  }>;
  sources: Array<{
    researchEntityKey: string;
    researchEntityId: string;
    sourceUrl: string;
    state: string;
    ready: boolean;
    reason?: string;
  }>;
}

const text = (value: unknown): string => String(value || '').trim();
const entityId = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object' && '_id' in (value as Record<string, unknown>)
      ? text((value as Record<string, unknown>)._id)
      : text(value);
const normalizedName = (value: unknown): string =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const dateMs = (value: unknown): number => {
  const date = new Date(text(value));
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
};
const safeUrl = (value: unknown): boolean => {
  const url = text(value);
  if (!url) return false;
  try {
    return isPublicHttpUrl(url);
  } catch {
    return false;
  }
};
const hasDirectContact = (value: unknown): boolean =>
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/i.test(
    text(value),
  );

export function buildResearchHomeRosterAudit(
  rows: RosterAuditMember[],
  options: {
    now?: Date;
    sampleLimit?: number;
    sampledPrecisionReviewed?: boolean;
    sampledPrecisionReviewedBy?: string;
    expectedSources?: RosterAuditSource[];
  } = {},
): RosterAuditReport {
  const now = options.now || new Date();
  const sourceRows = rows.filter((row) => row.sourceName === AUDITED_ROSTER_SOURCE);
  const currentRows = sourceRows.filter(
    (row) => row.archived !== true && row.isCurrentMember !== false,
  );
  const historicalRows = sourceRows.filter(
    (row) =>
      row.archived === true || row.isCurrentMember === false || row.evidenceStatus === 'historical',
  );
  const currentVerified = currentRows.filter(
    (row) => row.evidenceStatus === 'verified' && dateMs(row.freshnessExpiresAt) >= now.getTime(),
  );
  const staleCurrent = currentRows.filter((row) => dateMs(row.freshnessExpiresAt) < now.getTime());
  const missingStableIdentity = currentRows.filter(
    (row) => !text(row.identityKey) || !text(row.membershipKey),
  );
  const invalidRoles = currentRows.filter((row) => !AUDITED_ROSTER_ROLES.has(text(row.role)));
  const unsafeUrls = currentRows.filter(
    (row) => !safeUrl(row.sourceUrl) || !safeUrl(row.profileUrl),
  );
  const directContactLeaks = currentRows.filter((row) =>
    [row.name, row.title, row.sourceUrl, row.profileUrl].some(hasDirectContact),
  );

  const identityNames = new Map<string, Set<string>>();
  const nameIdentities = new Map<string, Set<string>>();
  for (const row of currentRows) {
    const entity = entityId(row.researchEntityId);
    const identity = text(row.identityKey);
    const name = normalizedName(row.name);
    if (entity && identity) {
      const key = `${entity}:${identity}`;
      identityNames.set(key, new Set([...(identityNames.get(key) || []), name].filter(Boolean)));
    }
    if (entity && name && identity) {
      const key = `${entity}:${name}`;
      nameIdentities.set(key, new Set([...(nameIdentities.get(key) || []), identity]));
    }
  }
  const identityCollisions = [...identityNames.values()].filter((values) => values.size > 1).length;
  const nameCollisions = [...nameIdentities.values()].filter((values) => values.size > 1).length;
  const entitiesCovered = new Set(currentVerified.map((row) => entityId(row.researchEntityId)))
    .size;
  const sources = (options.expectedSources || []).map((source) => {
    const id = entityId(source.researchEntityId);
    const state = text(source.enrichment?.state) || 'missing';
    const snapshotObservedAt = dateMs(source.enrichment?.observedAt);
    const expectedMemberKeys = Array.isArray(source.enrichment?.memberKeys)
      ? Array.from(new Set(source.enrichment.memberKeys.map(text).filter(Boolean)))
      : [];
    const entityCurrentRows = currentRows.filter((row) => entityId(row.researchEntityId) === id);
    const matchingRows = entityCurrentRows.filter(
      (row) =>
        row.evidenceStatus === 'verified' &&
        dateMs(row.freshnessExpiresAt) >= now.getTime() &&
        text(row.sourceUrl) === source.sourceUrl &&
        dateMs(row.lastObservedAt) >= snapshotObservedAt,
    );
    const matchingMemberKeys = matchingRows.map((row) => text(row.membershipKey)).filter(Boolean);
    const matchingMemberKeySet = new Set(matchingMemberKeys);
    let reason: string | undefined;
    if (!id || !source.enrichment) reason = 'missing';
    else if (!['current', 'partial'].includes(state)) reason = state;
    else if (text(source.enrichment.sourceUrl) !== source.sourceUrl) reason = 'source-mismatch';
    else if (!snapshotObservedAt) reason = 'missing-snapshot-observation';
    else if (dateMs(source.enrichment.freshnessExpiresAt) < now.getTime()) reason = 'stale';
    else if (expectedMemberKeys.length === 0) reason = 'no-snapshot-members';
    else if (expectedMemberKeys.some((key) => !matchingMemberKeySet.has(key))) {
      reason = 'incomplete-materialization';
    } else if (
      entityCurrentRows.length !== expectedMemberKeys.length ||
      matchingMemberKeys.length !== expectedMemberKeys.length ||
      matchingMemberKeySet.size !== expectedMemberKeys.length ||
      matchingMemberKeys.some((key) => !expectedMemberKeys.includes(key))
    ) {
      reason = 'unexpected-materialization';
    }
    return {
      researchEntityKey: source.researchEntityKey,
      researchEntityId: id,
      sourceUrl: source.sourceUrl,
      state,
      ready: !reason,
      ...(reason ? { reason } : {}),
    };
  });
  const entitiesReady = sources.filter((source) => source.ready).length;
  const entitiesBlocked = sources.length - entitiesReady;
  const expectedEntityIds = new Set(
    (options.expectedSources || [])
      .map((source) => entityId(source.researchEntityId))
      .filter(Boolean),
  );
  const unexpectedEntities = new Set(
    currentRows
      .map((row) => entityId(row.researchEntityId))
      .map((id) => id || 'missing-entity')
      .filter((id) => !expectedEntityIds.has(id)),
  ).size;
  const qualityIssueCount =
    staleCurrent.length +
    missingStableIdentity.length +
    identityCollisions +
    nameCollisions +
    unexpectedEntities +
    invalidRoles.length +
    unsafeUrls.length +
    directContactLeaks.length;
  const fullCoverageReady = sources.length > 0 && entitiesBlocked === 0;
  const structuralPrecisionEligible =
    currentVerified.length > 0 && qualityIssueCount === 0 && fullCoverageReady;
  const sampledPrecisionReviewedBy = text(options.sampledPrecisionReviewedBy);
  const sampledPrecisionReviewed =
    options.sampledPrecisionReviewed === true && Boolean(sampledPrecisionReviewedBy);
  const sampleLimit = Math.max(0, Math.min(100, options.sampleLimit ?? 25));

  return {
    sourceName: AUDITED_ROSTER_SOURCE,
    generatedAt: now.toISOString(),
    counts: {
      totalRows: sourceRows.length,
      currentVerified: currentVerified.length,
      historical: historicalRows.length,
      staleCurrent: staleCurrent.length,
      entitiesCovered,
      entitiesExpected: sources.length,
      entitiesReady,
      entitiesBlocked,
      missingStableIdentity: missingStableIdentity.length,
      identityCollisions,
      nameCollisions,
      unexpectedEntities,
      invalidRoles: invalidRoles.length,
      unsafeUrls: unsafeUrls.length,
      directContactLeaks: directContactLeaks.length,
    },
    structuralPrecisionEligible,
    sampledPrecisionReviewed,
    ...(sampledPrecisionReviewedBy ? { sampledPrecisionReviewedBy } : {}),
    broadEnablementReady: structuralPrecisionEligible && sampledPrecisionReviewed,
    samples: currentVerified.slice(0, sampleLimit).map((row) => ({
      researchEntityId: entityId(row.researchEntityId),
      name: text(row.name).slice(0, 160),
      role: text(row.role),
      sourceUrl: text(row.sourceUrl),
      profileUrl: text(row.profileUrl),
      lastObservedAt: text(row.lastObservedAt),
    })),
    sources,
  };
}
