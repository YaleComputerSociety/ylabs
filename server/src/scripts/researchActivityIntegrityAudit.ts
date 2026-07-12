import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import {
  evaluateResearchActivityIntegrity,
  researchActivityIntegrityCounts,
  type ResearchActivityCandidate,
} from '../services/researchActivityIntegrity';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const id = (value: unknown) => serializedDocumentId(value) || '';

export interface ResearchActivityIntegrityAuditReport {
  generatedAt: string;
  mode: 'read-only';
  counts: ReturnType<typeof researchActivityIntegrityCounts>;
  entitiesEvaluated: number;
  entitiesWithExcludedConflicts: number;
  entitiesWithDuplicates: number;
  entitiesWithEarlierWork: number;
}

export const buildResearchActivityIntegrityAuditReport = (
  decisionsByEntity: Map<string, ReturnType<typeof evaluateResearchActivityIntegrity>>,
  generatedAt = new Date(),
): ResearchActivityIntegrityAuditReport => {
  const decisions = [...decisionsByEntity.values()].flat();
  return {
    generatedAt: generatedAt.toISOString(),
    mode: 'read-only',
    counts: researchActivityIntegrityCounts(decisions),
    entitiesEvaluated: decisionsByEntity.size,
    entitiesWithExcludedConflicts: [...decisionsByEntity.values()].filter((rows) =>
      rows.some((row) => row.disposition === 'identity_conflict'),
    ).length,
    entitiesWithDuplicates: [...decisionsByEntity.values()].filter((rows) =>
      rows.some((row) => row.disposition === 'duplicate'),
    ).length,
    entitiesWithEarlierWork: [...decisionsByEntity.values()].filter((rows) =>
      rows.some((row) => row.disposition === 'earlier'),
    ).length,
  };
};

async function main() {
  assertScriptApplyAllowed({
    apply: false,
    scriptName: 'researchActivityIntegrityAudit',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const [attributions, links, members, entities] = await Promise.all([
    ResearchScholarlyAttribution.find({ archived: { $ne: true } })
      .select(
        'scholarlyLinkId targetUserId relationshipBasis evidenceLabel confidence observedAt sourceName sourceUrl',
      )
      .lean(),
    ResearchScholarlyLink.find({ archived: { $ne: true } })
      .select('_id title url year venue externalIds discoveredVia destinationKind')
      .lean(),
    ResearchGroupMember.find({ archived: { $ne: true }, endedAt: { $exists: false } })
      .select('researchEntityId researchGroupId userId startedAt endedAt')
      .lean(),
    ResearchEntity.find({ archived: { $ne: true } })
      .select('_id name researchAreas methods shortDescription fullDescription')
      .lean(),
  ]);

  const linksById = new Map(links.map((link: any) => [id(link._id), link]));
  const entitiesById = new Map(entities.map((entity: any) => [id(entity._id), entity]));
  const membershipsByUser = new Map<string, any[]>();
  for (const member of members as any[]) {
    const userId = id(member.userId);
    if (!userId) continue;
    membershipsByUser.set(userId, [...(membershipsByUser.get(userId) || []), member]);
  }

  const candidatesByEntity = new Map<string, ResearchActivityCandidate[]>();
  for (const attribution of attributions as any[]) {
    const link = linksById.get(id(attribution.scholarlyLinkId));
    if (!link) continue;
    for (const member of membershipsByUser.get(id(attribution.targetUserId)) || []) {
      const entityId = id(member.researchEntityId || member.researchGroupId);
      if (!entityId || !entitiesById.has(entityId)) continue;
      const candidate: ResearchActivityCandidate = {
        link,
        relationshipBasis: attribution.relationshipBasis,
        evidenceLabel: attribution.evidenceLabel,
        confidence: attribution.confidence,
        observedAt: attribution.observedAt,
        sourceName: attribution.sourceName,
        sourceUrl: attribution.sourceUrl,
        appointmentStartedAt: member.startedAt,
        appointmentEndedAt: member.endedAt,
      };
      candidatesByEntity.set(entityId, [...(candidatesByEntity.get(entityId) || []), candidate]);
    }
  }

  const decisionsByEntity = new Map(
    [...candidatesByEntity.entries()].map(([entityId, candidates]) => {
      const entity: any = entitiesById.get(entityId);
      return [
        entityId,
        evaluateResearchActivityIntegrity(candidates, [
          entity?.name,
          entity?.researchAreas,
          entity?.methods,
          entity?.shortDescription,
          entity?.fullDescription,
        ]),
      ];
    }),
  );

  console.log(
    JSON.stringify(buildResearchActivityIntegrityAuditReport(decisionsByEntity), null, 2),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run research activity integrity audit:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
