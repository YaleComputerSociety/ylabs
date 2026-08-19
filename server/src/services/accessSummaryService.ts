import mongoose from 'mongoose';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
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
  bestNextStep: string;
}

const EMPTY_SUMMARY: AccessSummary = {
  status: 'unknown',
  confidence: 0,
  evidence: [],
  signalTypes: [],
  bestNextStep: 'Check back later',
};

const ACCESS_SUMMARY_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

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

function computeStatus(signalTypes: Set<string>): AccessSummaryStatus {
  if (signalTypes.has('POSTED_OPENING')) {
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

function bestNextStepFor(status: AccessSummaryStatus, signalTypes: Set<string>): string {
  if (status === 'posted-opening') return 'Apply';
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
  const signals = await Signal.find({
    researchEntityId: { $in: objectIds },
    type: { $in: accessSignalTypes },
    archived: false,
  })
    .sort({ observedAt: -1 })
    .lean();

  const signalsByEntity = new Map<string, any[]>();
  for (const signal of signals as any[]) {
    const key = accessSummaryEntityId(signal.researchEntityId);
    if (!key) continue;
    signalsByEntity.set(key, [...(signalsByEntity.get(key) || []), signal]);
  }

  const out = new Map<string, AccessSummary>();
  for (const id of validIds) {
    const entitySignals = signalsByEntity.get(id) || [];
    const signalTypes = new Set(
      entitySignals.flatMap((signal) => {
        const signalType = boundedString(signal.type, MAX_ACCESS_SUMMARY_TYPE_LENGTH);
        return signalType ? [signalType] : [];
      }),
    );
    const status = computeStatus(signalTypes);
    const confidence =
      entitySignals.length > 0 ? Math.max(...entitySignals.map(confidenceScore)) : 0;

    out.set(id, {
      status,
      confidence,
      evidence: entitySignals.slice(0, 5).map((signal) => ({
        signalType: boundedString(signal.type, MAX_ACCESS_SUMMARY_TYPE_LENGTH) || '',
        confidence: boundedString(signal.confidence, MAX_ACCESS_SUMMARY_TYPE_LENGTH) || '',
        excerpt: publicText(signal.source?.excerpt),
        sourceUrl: publicHttpUrl(signal.source?.url),
      })),
      signalTypes: Array.from(signalTypes),
      bestNextStep: publicText(bestNextStepFor(status, signalTypes)) || EMPTY_SUMMARY.bestNextStep,
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
