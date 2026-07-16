import { isPublicHttpUrl } from '../utils/urlSafety';

export const STUDENT_PATHWAY_MIN_CONFIDENCE = 0.7;
export const STUDENT_PATHWAY_STATUSES = ['ACTIVE', 'RECURRING'] as const;
export const STUDENT_PATHWAY_EVIDENCE_STRENGTHS = ['DIRECT', 'STRONG', 'MODERATE'] as const;

const hasPublicUrl = (values: unknown): boolean =>
  Array.isArray(values) &&
  values.some((value) => {
    try {
      return typeof value === 'string' && isPublicHttpUrl(value);
    } catch {
      return false;
    }
  });

const isFacultyOpportunityPathway = (pathway: Record<string, unknown>): boolean =>
  typeof pathway.derivationKey === 'string' &&
  pathway.derivationKey.startsWith('faculty-opportunity:');

export const isStudentPublishablePathway = (pathway: Record<string, unknown>): boolean =>
  (!isFacultyOpportunityPathway(pathway) ||
    (pathway.review as Record<string, unknown> | undefined)?.status === 'approved') &&
  STUDENT_PATHWAY_STATUSES.includes(pathway.status as any) &&
  STUDENT_PATHWAY_EVIDENCE_STRENGTHS.includes(pathway.evidenceStrength as any) &&
  typeof pathway.confidence === 'number' &&
  pathway.confidence >= STUDENT_PATHWAY_MIN_CONFIDENCE &&
  hasPublicUrl(pathway.sourceUrls);

export const studentPathwayMongoMatch = (): Record<string, unknown> => ({
  derivationKey: { $not: /^faculty-opportunity:/ },
  status: { $in: [...STUDENT_PATHWAY_STATUSES] },
  evidenceStrength: { $in: [...STUDENT_PATHWAY_EVIDENCE_STRENGTHS] },
  confidence: { $gte: STUDENT_PATHWAY_MIN_CONFIDENCE },
  sourceUrls: { $elemMatch: { $type: 'string', $regex: '^https?://' } },
});

export const isApprovedPublicContactRoute = (route: Record<string, any>): boolean => {
  if (
    route.visibility !== 'PUBLIC' ||
    route.review?.status !== 'approved' ||
    route.contactPolicy === 'NO_DIRECT_CONTACT' ||
    route.contactPolicy === 'UNKNOWN'
  ) {
    return false;
  }
  try {
    return Boolean(
      typeof route.url === 'string' &&
      isPublicHttpUrl(route.url) &&
      typeof route.sourceUrl === 'string' &&
      isPublicHttpUrl(route.sourceUrl),
    );
  } catch {
    return false;
  }
};
