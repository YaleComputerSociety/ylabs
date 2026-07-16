import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { isPublicHttpUrl } from '../utils/urlSafety';

export type AccessSummaryStatus =
  | 'posted-opening'
  | 'evidence-backed'
  | 'reach-out-plausible'
  | 'not-currently-available'
  | 'unknown';

export interface AccessSummary {
  status: AccessSummaryStatus;
  confidence: number;
  evidence: Array<{
    signalType: string;
    confidence: string;
    excerpt?: string;
    sourceUrl?: string;
  }>;
  signalTypes: string[];
  entryPathwayTypes: string[];
  hasActivePostedOpportunity: boolean;
  bestNextStep: string;
}

const EMPTY_SUMMARY: AccessSummary = {
  status: 'unknown',
  confidence: 0,
  evidence: [],
  signalTypes: [],
  entryPathwayTypes: [],
  hasActivePostedOpportunity: false,
  bestNextStep: 'Check back later',
};

const ACCESS_SUMMARY_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const FORMALIZATION_ONLY_PATHWAY_TYPES = new Set([
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
]);

const MAX_ACCESS_SUMMARY_ENTITY_IDS = 100;
const MAX_ACCESS_SUMMARY_TEXT_LENGTH = 2000;
const MAX_ACCESS_SUMMARY_TYPE_LENGTH = 120;
const MAX_ACCESS_SUMMARY_URL_LENGTH = 2048;

const boundedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.slice(0, maxLength).trim();
  return text || undefined;
};

const publicText = (value: unknown): string | undefined => {
  const text = boundedString(value, MAX_ACCESS_SUMMARY_TEXT_LENGTH);
  return text ? redactDirectContactInfo(text) : undefined;
};

const publicHttpUrl = (value: unknown): string | undefined => {
  const raw = boundedString(value, MAX_ACCESS_SUMMARY_URL_LENGTH);
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    return isPublicHttpUrl(raw) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const accessSummaryEntityId = (value: unknown): string | undefined => {
  const id = serializedDocumentId(value);
  return id && ACCESS_SUMMARY_OBJECT_ID_RE.test(id) ? id : undefined;
};

function confidenceScore(signal: any): number {
  if (typeof signal.confidenceScore === 'number') return signal.confidenceScore;
  if (signal.confidence === 'HIGH') return 0.9;
  if (signal.confidence === 'MEDIUM') return 0.6;
  if (signal.confidence === 'LOW') return 0.3;
  return 0;
}

function computeStatus(
  signalTypes: Set<string>,
  hasActivePostedOpportunity: boolean,
): AccessSummaryStatus {
  if (hasActivePostedOpportunity || signalTypes.has('POSTED_OPENING')) {
    return 'posted-opening';
  }
  if (signalTypes.has('NOT_CURRENTLY_AVAILABLE')) {
    return 'not-currently-available';
  }
  if (
    signalTypes.has('REACH_OUT_PLAUSIBLE') ||
    signalTypes.has('CURRENT_UNDERGRADS') ||
    signalTypes.has('PAST_UNDERGRADS')
  ) {
    return 'reach-out-plausible';
  }
  if (signalTypes.size > 0) return 'evidence-backed';
  return 'unknown';
}

function bestNextStepFor(
  status: AccessSummaryStatus,
  pathways: any[],
  signalTypes: Set<string>,
  hasActivePostedOpportunity: boolean,
): string {
  if (hasActivePostedOpportunity || status === 'posted-opening') return 'Apply';
  const exploratory = pathways.find((p) => p.pathwayType === 'EXPLORATORY_CONTACT');
  if (exploratory)
    return (
      boundedString(exploratory.bestNextStep, MAX_ACCESS_SUMMARY_TEXT_LENGTH) ||
      'Plan exploratory outreach'
    );
  if (status === 'not-currently-available') return 'Check back later';
  if (
    signalTypes.has('CREDIT_FORMALIZATION_POSSIBLE') ||
    signalTypes.has('COURSE_CREDIT_PATHWAY') ||
    signalTypes.has('FACULTY_SUPERVISES_STUDENT_PROJECTS')
  ) {
    return 'Ask about credit or thesis expectations after finding a mentor';
  }
  if (signalTypes.has('FELLOWSHIP_COMPATIBLE')) {
    return 'Ask about funding after finding a mentor';
  }
  return 'Save for later';
}

export async function listAccessSummariesForResearchEntities(
  researchEntityIds: Array<string | mongoose.Types.ObjectId>,
): Promise<Map<string, AccessSummary>> {
  const validIds = researchEntityIds.slice(0, MAX_ACCESS_SUMMARY_ENTITY_IDS).flatMap((id) => {
    const normalized = accessSummaryEntityId(id);
    return normalized ? [normalized] : [];
  });
  if (validIds.length === 0) return new Map();

  const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));
  const [signals, pathways, opportunities] = await Promise.all([
    AccessSignal.find({ researchEntityId: { $in: objectIds }, archived: false })
      .sort({ observedAt: -1 })
      .lean(),
    EntryPathway.find({
      researchEntityId: { $in: objectIds },
      archived: false,
      derivationKey: { $not: /^faculty-opportunity:/ },
    }).lean(),
    PostedOpportunity.find({
      researchEntityId: { $in: objectIds },
      archived: false,
      status: { $in: ['OPEN', 'ROLLING'] },
      'review.status': 'approved',
      $or: [
        { deadline: { $exists: false } },
        { deadline: null },
        { deadline: { $gte: new Date() } },
      ],
    }).lean(),
  ]);

  const signalsByEntity = new Map<string, any[]>();
  for (const signal of signals as any[]) {
    const key = accessSummaryEntityId(signal.researchEntityId);
    if (!key) continue;
    signalsByEntity.set(key, [...(signalsByEntity.get(key) || []), signal]);
  }

  const pathwaysByEntity = new Map<string, any[]>();
  for (const pathway of pathways as any[]) {
    const key = accessSummaryEntityId(pathway.researchEntityId);
    if (!key) continue;
    pathwaysByEntity.set(key, [...(pathwaysByEntity.get(key) || []), pathway]);
  }

  const activeOpportunityEntityIds = new Set(
    (opportunities as any[]).flatMap((opportunity) => {
      const id = accessSummaryEntityId(opportunity.researchEntityId);
      return id ? [id] : [];
    }),
  );

  const out = new Map<string, AccessSummary>();
  for (const id of validIds) {
    const entitySignals = signalsByEntity.get(id) || [];
    const entityPathways = (pathwaysByEntity.get(id) || []).filter((pathway) => {
      const pathwayType = boundedString(pathway.pathwayType, MAX_ACCESS_SUMMARY_TYPE_LENGTH);
      return pathwayType && !FORMALIZATION_ONLY_PATHWAY_TYPES.has(pathwayType);
    });
    const signalTypes = new Set(
      entitySignals.flatMap((signal) => {
        const signalType = boundedString(signal.signalType, MAX_ACCESS_SUMMARY_TYPE_LENGTH);
        return signalType ? [signalType] : [];
      }),
    );
    const entryPathwayTypes = new Set(
      entityPathways.flatMap((pathway) => {
        const pathwayType = boundedString(pathway.pathwayType, MAX_ACCESS_SUMMARY_TYPE_LENGTH);
        return pathwayType ? [pathwayType] : [];
      }),
    );
    const hasActivePostedOpportunity = activeOpportunityEntityIds.has(id);
    const status = computeStatus(signalTypes, hasActivePostedOpportunity);
    const confidence =
      entitySignals.length > 0 ? Math.max(...entitySignals.map(confidenceScore)) : 0;

    out.set(id, {
      status,
      confidence,
      evidence: entitySignals.slice(0, 5).map((signal) => ({
        signalType: boundedString(signal.signalType, MAX_ACCESS_SUMMARY_TYPE_LENGTH) || '',
        confidence: boundedString(signal.confidence, MAX_ACCESS_SUMMARY_TYPE_LENGTH) || '',
        excerpt: publicText(signal.excerpt),
        sourceUrl: publicHttpUrl(signal.sourceUrl),
      })),
      signalTypes: Array.from(signalTypes),
      entryPathwayTypes: Array.from(entryPathwayTypes),
      hasActivePostedOpportunity,
      bestNextStep:
        publicText(
          bestNextStepFor(status, entityPathways, signalTypes, hasActivePostedOpportunity),
        ) || EMPTY_SUMMARY.bestNextStep,
    });
  }

  return out;
}

export async function getAccessSummaryForResearchEntity(
  researchEntityId: string | mongoose.Types.ObjectId,
): Promise<AccessSummary> {
  const summaries = await listAccessSummariesForResearchEntities([researchEntityId]);
  const id = accessSummaryEntityId(researchEntityId);
  return (id ? summaries.get(id) : undefined) || EMPTY_SUMMARY;
}
