import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import {
  EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY,
  LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS,
  mergeLegacyExploratoryContactPathwaysForEntity,
} from '../scrapers/accessMaterializer';
import {
  buildExploratoryPathwayDedupePlan,
  parseDedupeExploratoryPathwaysArgs,
  type ExploratoryPathwayDedupeRow,
} from './dedupeExploratoryPathwaysCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RELEVANT_DERIVATION_KEYS = [
  EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY,
  ...LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS,
];

async function loadCandidateRows(input: {
  limit: number;
  entityId?: string;
}): Promise<ExploratoryPathwayDedupeRow[]> {
  const match: Record<string, unknown> = {
    archived: { $ne: true },
    pathwayType: 'EXPLORATORY_CONTACT',
    $or: [
      { derivationKey: { $in: RELEVANT_DERIVATION_KEYS } },
      { derivationKey: /^pathway:EXPLORATORY_CONTACT:/ },
    ],
  };

  if (input.entityId) {
    if (!mongoose.Types.ObjectId.isValid(input.entityId)) {
      throw new Error('--entity-id must be a valid Mongo ObjectId');
    }
    match.researchEntityId = new mongoose.Types.ObjectId(input.entityId);
  }

  const groups = await EntryPathway.aggregate([
    { $match: match },
    { $sort: { researchEntityId: 1, derivationKey: 1, _id: 1 } },
    {
      $group: {
        _id: '$researchEntityId',
        rows: {
          $push: {
            _id: '$_id',
            researchEntityId: '$researchEntityId',
            derivationKey: '$derivationKey',
          },
        },
        legacyCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$derivationKey', EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY] },
                  {
                    $or: [
                      {
                        $in: [
                          '$derivationKey',
                          LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS,
                        ],
                      },
                      {
                        $regexMatch: {
                          input: '$derivationKey',
                          regex: /^pathway:EXPLORATORY_CONTACT:/,
                        },
                      },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $match: { legacyCount: { $gt: 0 } } },
    { $limit: input.limit },
  ]);

  return groups.flatMap((group: { rows?: ExploratoryPathwayDedupeRow[] }) => group.rows || []);
}

async function main() {
  const args = parseDedupeExploratoryPathwaysArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'pathways:dedupe-exploratory',
    mongoUrl,
  });

  await mongoose.connect(mongoUrl);

  const rows = await loadCandidateRows({ limit: args.limit, entityId: args.entityId });
  const plan = buildExploratoryPathwayDedupePlan(rows);
  const applied = args.apply
    ? await Promise.all(
        plan.plannedGroups.map(async (group) => {
          let promoted = false;
          if (group.promoteCanonical) {
            const result = await EntryPathway.updateOne(
              {
                _id: group.canonicalPathwayId,
                researchEntityId: group.researchEntityId,
                archived: { $ne: true },
              },
              {
                $set: {
                  derivationKey: EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY,
                  lastMaterializedAt: new Date(),
                },
              },
            );
            promoted = (result.modifiedCount || 0) > 0;
          }

          const mergeResult = await mergeLegacyExploratoryContactPathwaysForEntity(
            group.researchEntityId,
            group.canonicalPathwayId,
            group.legacyPathwayIds,
          );

          return {
            ...mergeResult,
            promotedCanonicalPathway: promoted,
          };
        }),
      )
    : [];

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        candidateGroups: plan.candidateGroups,
        plannedGroups: plan.plannedGroups.length,
        plannedLegacyPathways: plan.plannedLegacyPathways,
        skippedGroups: plan.skippedGroups.length,
        plan: plan.plannedGroups.slice(0, 25),
        skipped: plan.skippedGroups.slice(0, 25),
        applied,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
