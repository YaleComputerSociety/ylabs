import { createHash } from 'crypto';
import type { ValidatedDecision } from './pfr3PathwayEvidenceReviewCore';

export interface RecencyCandidate {
  recordId: string;
  researchEntityId?: string;
  sourceEvidenceIds: string[];
}

export interface ExistingEvidence {
  id: string;
  entityType: 'researchEntity' | 'researchGroup';
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  confidence: number;
}

export interface ApplyDependencies {
  findEvidence(ids: string[]): Promise<ExistingEvidence[]>;
  alreadyApplied(key: string): Promise<boolean>;
  appendEvidence(evidence: ExistingEvidence, sourceUrl: string): Promise<void>;
  materialize(researchEntityId: string): Promise<void>;
  writeAudit(row: {
    key: string;
    target: string;
    kind: string;
    restoreTokenHash: string;
  }): Promise<void>;
}

export interface ApplySummary {
  applied: number;
  idempotent: number;
  manualOnly: number;
  rejected: number;
}

const normalizedUrl = (value: string) => new URL(value).toString();

export async function applyValidatedPathwayDecisions(input: {
  decisions: ValidatedDecision[];
  candidates: Map<string, RecencyCandidate>;
  target: string;
  artifactHash: string;
  restoreToken: string;
  deps: ApplyDependencies;
}): Promise<ApplySummary> {
  const summary: ApplySummary = { applied: 0, idempotent: 0, manualOnly: 0, rejected: 0 };
  for (const decision of input.decisions) {
    if (decision.disposition === 'manual_only') {
      summary.manualOnly += 1;
      continue;
    }
    const candidate = input.candidates.get(decision.handle);
    if (!candidate?.researchEntityId || candidate.sourceEvidenceIds.length === 0) {
      summary.rejected += 1;
      continue;
    }
    const key = createHash('sha256')
      .update(`${input.target}:${input.artifactHash}:${decision.handle}:${decision.sourceUrl}`)
      .digest('hex');
    if (await input.deps.alreadyApplied(key)) {
      summary.idempotent += 1;
      continue;
    }
    const evidence = await input.deps.findEvidence(candidate.sourceEvidenceIds);
    const matching = evidence.find(
      (item) =>
        item.entityId === candidate.researchEntityId &&
        item.sourceUrl &&
        normalizedUrl(item.sourceUrl) === normalizedUrl(decision.sourceUrl),
    );
    if (!matching) {
      summary.rejected += 1;
      continue;
    }
    await input.deps.appendEvidence(matching, decision.sourceUrl);
    await input.deps.materialize(candidate.researchEntityId);
    await input.deps.writeAudit({
      key,
      target: input.target,
      kind: decision.kind,
      restoreTokenHash: createHash('sha256').update(input.restoreToken).digest('hex'),
    });
    summary.applied += 1;
  }
  return summary;
}
