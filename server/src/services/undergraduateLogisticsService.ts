import { UndergraduateLogisticsClaim } from '../models/undergraduateLogisticsClaim';
import {
  undergraduateLogisticsClaimTypes,
  type UndergraduateLogisticsClaimType,
} from '../models/undergraduateLogisticsClaim';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';

export type PublicUndergraduateLogisticsClaimState =
  | 'known'
  | 'unknown'
  | 'stale_under_review'
  | 'conflicting_withheld';

export interface PublicUndergraduateLogisticsClaim {
  claimType: UndergraduateLogisticsClaimType;
  state: PublicUndergraduateLogisticsClaimState;
  value?: Record<string, unknown>;
  evidence?: {
    sourceUrl: string;
    excerpt: string;
    observedAt: string;
    expiresAt: string;
  };
}

export interface PublicUndergraduateLogistics {
  status: 'ready' | 'unavailable';
  claims: PublicUndergraduateLogisticsClaim[];
}

interface UndergraduateLogisticsClaimLike {
  claimType?: unknown;
  status?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  evidenceExcerpt?: unknown;
  observedAt?: unknown;
  expiresAt?: unknown;
  archived?: unknown;
}

const CLAIM_TYPE_SET = new Set<string>(undergraduateLogisticsClaimTypes);
const STUDENT_LEVEL_SET = new Set(['FIRST_YEAR', 'SOPHOMORE', 'JUNIOR', 'SENIOR']);
const COMPENSATION_SET = new Set([
  'PAID',
  'STIPEND',
  'COURSE_CREDIT',
  'VOLUNTEER',
  'WORK_STUDY',
  'FELLOWSHIP',
]);
const MODALITY_SET = new Set(['IN_PERSON', 'HYBRID', 'REMOTE']);
const AVAILABILITY_SET = new Set(['OPEN', 'ROLLING', 'NOT_CURRENTLY_AVAILABLE']);

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const enumValues = (value: unknown, allowed: Set<string>): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.size) return undefined;
  const values = Array.from(new Set(value.map(String))).filter((item) => allowed.has(item));
  return values.length === value.length ? values : undefined;
};

function publicClaimValue(
  claimType: UndergraduateLogisticsClaimType,
  value: unknown,
): Record<string, unknown> | undefined {
  const record = objectValue(value);
  if (!record) return undefined;
  if (claimType === 'STUDENT_LEVEL') {
    const levels = enumValues(record.levels, STUDENT_LEVEL_SET);
    return levels ? { levels } : undefined;
  }
  if (claimType === 'COMPENSATION') {
    const modes = enumValues(record.modes, COMPENSATION_SET);
    return modes ? { modes } : undefined;
  }
  if (claimType === 'MODALITY') {
    const modes = enumValues(record.modes, MODALITY_SET);
    return modes ? { modes } : undefined;
  }
  if (claimType === 'CURRENT_AVAILABILITY') {
    const status = String(record.status || '');
    return AVAILABILITY_SET.has(status) ? { status } : undefined;
  }

  const minHours =
    typeof record.minHours === 'number' && record.minHours > 0 && record.minHours <= 80
      ? record.minHours
      : undefined;
  const maxHours =
    typeof record.maxHours === 'number' && record.maxHours > 0 && record.maxHours <= 80
      ? record.maxHours
      : undefined;
  if (record.period !== 'WEEK' || (!minHours && !maxHours)) return undefined;
  return {
    ...(minHours ? { minHours } : {}),
    ...(maxHours ? { maxHours } : {}),
    period: 'WEEK',
  };
}

const validDate = (value: unknown): Date | undefined => {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

const safeSourceUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    return isPublicHttpUrl(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export function toPublicUndergraduateLogistics(
  rows: UndergraduateLogisticsClaimLike[],
  now: Date = new Date(),
): PublicUndergraduateLogistics {
  const byType = new Map<UndergraduateLogisticsClaimType, UndergraduateLogisticsClaimLike>();
  for (const row of rows) {
    const claimType = typeof row.claimType === 'string' ? row.claimType : '';
    if (row.archived === true || !CLAIM_TYPE_SET.has(claimType)) continue;
    byType.set(claimType as UndergraduateLogisticsClaimType, row);
  }

  return {
    status: 'ready',
    claims: undergraduateLogisticsClaimTypes.map((claimType) => {
      const row = byType.get(claimType);
      if (!row) return { claimType, state: 'unknown' };
      if (row.status === 'CONFLICTING_WITHHELD') {
        return { claimType, state: 'conflicting_withheld' };
      }
      const expiresAt = validDate(row.expiresAt);
      if (row.status === 'STALE_UNDER_REVIEW' || !expiresAt || expiresAt <= now) {
        return { claimType, state: 'stale_under_review' };
      }
      const value = publicClaimValue(claimType, row.value);
      const sourceUrl = safeSourceUrl(row.sourceUrl);
      const observedAt = validDate(row.observedAt);
      const excerpt =
        typeof row.evidenceExcerpt === 'string'
          ? redactDirectContactInfo(row.evidenceExcerpt).slice(0, 500).trim()
          : '';
      if (!value || !sourceUrl || !observedAt || !excerpt) {
        return { claimType, state: 'unknown' };
      }
      return {
        claimType,
        state: 'known',
        value,
        evidence: {
          sourceUrl,
          excerpt,
          observedAt: observedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      };
    }),
  };
}

export async function getPublicUndergraduateLogistics(
  researchEntityId: unknown,
  now: Date = new Date(),
): Promise<PublicUndergraduateLogistics> {
  const rows = await UndergraduateLogisticsClaim.find({
    researchEntityId,
    archived: { $ne: true },
  })
    .select('claimType status value sourceUrl evidenceExcerpt observedAt expiresAt archived')
    .lean();
  return toPublicUndergraduateLogistics(rows, now);
}

export const unavailablePublicUndergraduateLogistics = (): PublicUndergraduateLogistics => ({
  status: 'unavailable',
  claims: undergraduateLogisticsClaimTypes.map((claimType) => ({
    claimType,
    state: 'unknown',
  })),
});
