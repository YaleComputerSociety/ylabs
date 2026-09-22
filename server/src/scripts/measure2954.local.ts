import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';
import { isOrganizationalResearchEntity } from '../utils/researchEntityOrganizational';
import { resolveField } from '../scrapers/confidenceResolver';
import { materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import { FRA_PROFILE_SYNTHESIS_SOURCE_NAME } from './fraProfileSynthesisCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NEUTER = process.env.NEUTER === '1';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function coherent(entity: Record<string, any>): boolean {
  const publicDescription = buildResearchEntityPublicDescriptionRepresentation({ entity });
  const exempt = isProgramLikeResearchEntity(entity) || isOrganizationalResearchEntity(entity);
  const cardPresent = Boolean(textValue(publicDescription.entity.shortDescription));
  const hasCard = publicDescription.invariant.cardDescriptionUseful || (exempt && !cardPresent);
  if (NEUTER) return true;
  return publicDescription.invariant.pass && hasCard;
}

async function main(): Promise<void> {
  await initializeConnections();
  const rows = (await ResearchEntity.find({
    archived: { $ne: true },
    'fieldProvenance.fullDescription.sourceName': FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
  }).lean()) as Array<Record<string, any>>;

  let cannotServeNow = 0;
  let demoted = 0;
  const detail: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (coherent(row)) continue;
    cannotServeNow += 1;
    const observations = (await Observation.find({
      entityType: 'researchEntity',
      field: 'fullDescription',
      ...materializationReadScopeFilter(),
      $or: [{ entityKey: row.slug }, { entityId: row._id }],
    }).lean()) as Array<Record<string, any>>;
    const withoutLane = observations.filter(
      (observation) => observation.sourceName !== FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
    );
    const counterfactual = resolveField('fullDescription', withoutLane as any);
    const priorBody = textValue(counterfactual?.value);
    if (!priorBody) continue;
    const before = coherent({ ...row, fullDescription: priorBody });
    if (!before) continue;
    demoted += 1;
    detail.push({
      entityType: row.entityType,
      tier: row.studentVisibilityTier,
      descriptionReasons: (row.studentVisibilityReasons || []).filter((reason: string) =>
        [
          'missing_description',
          'thin_description',
          'missing_card_description',
          'public_description_invariant_failed',
          'blank_public_description',
        ].includes(reason),
      ),
      priorBodySource: counterfactual?.contributingSources,
      priorBodyChars: priorBody.length,
      laneBodyChars: textValue(row.fullDescription).length,
      storedShortChars: textValue(row.shortDescription).length,
      researchAreas: Array.isArray(row.researchAreas) ? row.researchAreas.length : 0,
    });
  }

  console.log(
    JSON.stringify(
      {
        neutered: NEUTER,
        laneProvenancedRows: rows.length,
        cannotServeNow,
        demotedByTheLaneWrite: demoted,
        detail,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
