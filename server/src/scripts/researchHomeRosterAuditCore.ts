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

export interface RosterAuditReport {
  sourceName: string;
  generatedAt: string;
  counts: {
    totalRows: number;
    currentVerified: number;
    historical: number;
    staleCurrent: number;
    entitiesCovered: number;
    missingStableIdentity: number;
    identityCollisions: number;
    nameCollisions: number;
    invalidRoles: number;
    unsafeUrls: number;
    directContactLeaks: number;
  };
  structuralPrecisionEligible: boolean;
  sampledPrecisionReviewed: boolean;
  broadEnablementReady: boolean;
  samples: Array<{
    researchEntityId: string;
    name: string;
    role: string;
    sourceUrl: string;
    profileUrl: string;
    lastObservedAt: string;
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
  text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
  } = {},
): RosterAuditReport {
  const now = options.now || new Date();
  const sourceRows = rows.filter((row) => row.sourceName === AUDITED_ROSTER_SOURCE);
  const currentRows = sourceRows.filter(
    (row) => row.archived !== true && row.isCurrentMember !== false,
  );
  const historicalRows = sourceRows.filter(
    (row) => row.archived === true || row.isCurrentMember === false || row.evidenceStatus === 'historical',
  );
  const currentVerified = currentRows.filter(
    (row) =>
      row.evidenceStatus === 'verified' && dateMs(row.freshnessExpiresAt) >= now.getTime(),
  );
  const staleCurrent = currentRows.filter(
    (row) => dateMs(row.freshnessExpiresAt) < now.getTime(),
  );
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
  const entitiesCovered = new Set(currentVerified.map((row) => entityId(row.researchEntityId))).size;
  const qualityIssueCount =
    staleCurrent.length +
    missingStableIdentity.length +
    identityCollisions +
    invalidRoles.length +
    unsafeUrls.length +
    directContactLeaks.length;
  const structuralPrecisionEligible = currentVerified.length > 0 && qualityIssueCount === 0;
  const sampledPrecisionReviewed = options.sampledPrecisionReviewed === true;
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
      missingStableIdentity: missingStableIdentity.length,
      identityCollisions,
      nameCollisions,
      invalidRoles: invalidRoles.length,
      unsafeUrls: unsafeUrls.length,
      directContactLeaks: directContactLeaks.length,
    },
    structuralPrecisionEligible,
    sampledPrecisionReviewed,
    broadEnablementReady: structuralPrecisionEligible && sampledPrecisionReviewed,
    samples: currentVerified.slice(0, sampleLimit).map((row) => ({
      researchEntityId: entityId(row.researchEntityId),
      name: text(row.name).slice(0, 160),
      role: text(row.role),
      sourceUrl: text(row.sourceUrl),
      profileUrl: text(row.profileUrl),
      lastObservedAt: text(row.lastObservedAt),
    })),
  };
}
