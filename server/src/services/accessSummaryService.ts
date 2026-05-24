import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';

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

const FORMALIZATION_ONLY_PATHWAY_TYPES = new Set([
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
]);

function isLegacyListingDerived(record: any): boolean {
  return (
    String(record?.derivationKey || '').startsWith('listing:') ||
    record?.sourceName === 'ylabs-listing'
  );
}

function isCanonicalPostedOpportunity(opportunity: any): boolean {
  return (
    !opportunity?.listingId &&
    !String(opportunity?.derivationKey || '').startsWith('listing:')
  );
}

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
  if (exploratory) return exploratory.bestNextStep || 'Plan exploratory outreach';
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
  const validIds = researchEntityIds
    .map((id) => String(id))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) return new Map();

  const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));
  const [signals, pathways, opportunities] = await Promise.all([
    AccessSignal.find({ researchEntityId: { $in: objectIds }, archived: false })
      .sort({ observedAt: -1 })
      .lean(),
    EntryPathway.find({ researchEntityId: { $in: objectIds }, archived: false }).lean(),
    PostedOpportunity.find({
      researchEntityId: { $in: objectIds },
      archived: false,
      status: { $in: ['OPEN', 'ROLLING'] },
      $or: [{ listingId: { $exists: false } }, { listingId: null }],
    }).lean(),
  ]);

  const signalsByEntity = new Map<string, any[]>();
  for (const signal of (signals as any[]).filter((item) => !isLegacyListingDerived(item))) {
    const key = String(signal.researchEntityId);
    signalsByEntity.set(key, [...(signalsByEntity.get(key) || []), signal]);
  }

  const pathwaysByEntity = new Map<string, any[]>();
  for (const pathway of (pathways as any[]).filter((item) => !isLegacyListingDerived(item))) {
    const key = String(pathway.researchEntityId);
    pathwaysByEntity.set(key, [...(pathwaysByEntity.get(key) || []), pathway]);
  }

  const activeOpportunityEntityIds = new Set(
    (opportunities as any[])
      .filter(isCanonicalPostedOpportunity)
      .map((opportunity) => String(opportunity.researchEntityId)),
  );

  const out = new Map<string, AccessSummary>();
  for (const id of validIds) {
    const entitySignals = signalsByEntity.get(id) || [];
    const entityPathways = (pathwaysByEntity.get(id) || []).filter(
      (pathway) => !FORMALIZATION_ONLY_PATHWAY_TYPES.has(String(pathway.pathwayType)),
    );
    const signalTypes = new Set(entitySignals.map((signal) => String(signal.signalType)));
    const entryPathwayTypes = new Set(entityPathways.map((pathway) => String(pathway.pathwayType)));
    const hasActivePostedOpportunity = activeOpportunityEntityIds.has(id);
    const status = computeStatus(signalTypes, hasActivePostedOpportunity);
    const confidence =
      entitySignals.length > 0 ? Math.max(...entitySignals.map(confidenceScore)) : 0;

    out.set(id, {
      status,
      confidence,
      evidence: entitySignals.slice(0, 5).map((signal) => ({
        signalType: signal.signalType,
        confidence: signal.confidence,
        excerpt: signal.excerpt || undefined,
        sourceUrl: signal.sourceUrl || undefined,
      })),
      signalTypes: Array.from(signalTypes),
      entryPathwayTypes: Array.from(entryPathwayTypes),
      hasActivePostedOpportunity,
      bestNextStep: bestNextStepFor(
        status,
        entityPathways,
        signalTypes,
        hasActivePostedOpportunity,
      ),
    });
  }

  return out;
}

export async function getAccessSummaryForResearchEntity(
  researchEntityId: string | mongoose.Types.ObjectId,
): Promise<AccessSummary> {
  const summaries = await listAccessSummariesForResearchEntities([researchEntityId]);
  return summaries.get(String(researchEntityId)) || EMPTY_SUMMARY;
}
