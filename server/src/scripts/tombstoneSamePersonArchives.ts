import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { SAME_PERSON_ARCHIVE_TOMBSTONE_REASON } from '../models/entityArchival';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { resolveArchivedResearchEntityCanonicalSlug } from '../services/researchGroupService';
import {
  forceResyncCanonicalResearchEntities,
  recomputeCanonicalVisibility,
} from '../services/researchEntityEponymousMergeService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { planSamePersonArchiveTombstones } from './tombstoneSamePersonArchivesCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'research-entity:tombstone-same-person-archives';
const CONFIRM_FLAG = '--confirm-tombstone-same-person-archives';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const outputArg = argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg
    ? resolveSafeJsonReportOutputPath(outputArg.slice('--output='.length))
    : undefined;
  if (apply && !argv.includes(CONFIRM_FLAG)) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const rows = (await ResearchEntity.find({})
    .select('_id slug archived entityType canonicalGroupId archivedReason')
    .lean()) as any[];
  const slugById = new Map(rows.map((row) => [String(row._id), String(row.slug)]));
  const slugs = new Set(slugById.values());
  const leadKeys = (await Observation.find({
    entityType: 'researchEntity',
    field: 'inferredPiUserKey',
    superseded: false,
    $or: [
      { entityKey: { $in: [...slugs] } },
      { entityId: { $in: rows.map((row) => row._id) } },
    ],
  })
    .select('entityKey entityId value')
    .lean()) as any[];
  const leadKeysBySlug = new Map<string, string[]>();
  for (const observation of leadKeys) {
    const key = String(observation.value ?? '').trim();
    if (!key) continue;
    const slugsForObservation = new Set(
      [
        slugs.has(observation.entityKey) ? observation.entityKey : undefined,
        observation.entityId ? slugById.get(String(observation.entityId)) : undefined,
      ].filter((slug): slug is string => Boolean(slug)),
    );
    for (const slug of slugsForObservation) {
      const list = leadKeysBySlug.get(slug) ?? [];
      if (!list.includes(key)) list.push(key);
      leadKeysBySlug.set(slug, list);
    }
  }
  const plan = planSamePersonArchiveTombstones({
    rows: rows.map((row) => ({
      id: String(row._id),
      slug: String(row.slug),
      archived: row.archived === true,
      entityType: row.entityType,
      canonicalGroupId: row.canonicalGroupId ? String(row.canonicalGroupId) : null,
      archivedReason: row.archivedReason,
    })),
    leadKeysBySlug,
  });

  const applied = { pointed: 0, rematerialized: 0, regated: 0, redirectsResolving: 0 };
  if (apply) {
    for (const tombstone of plan.tombstones) {
      const result = await ResearchEntity.collection.updateOne(
        {
          _id: new mongoose.Types.ObjectId(tombstone.archivedId),
          archived: true,
          canonicalGroupId: null,
        },
        {
          $set: {
            canonicalGroupId: new mongoose.Types.ObjectId(tombstone.survivorId),
            archivedReason: SAME_PERSON_ARCHIVE_TOMBSTONE_REASON,
          },
        },
      );
      applied.pointed += result.modifiedCount;
    }
    const survivorIds = [...new Set(plan.tombstones.map((tombstone) => tombstone.survivorId))];
    for (const survivorId of survivorIds) {
      await materializeEntity('researchEntity', { entityId: survivorId }, {});
      applied.rematerialized += 1;
    }
    applied.regated = await recomputeCanonicalVisibility(survivorIds);
    await forceResyncCanonicalResearchEntities(survivorIds);
    for (const tombstone of plan.tombstones) {
      const redirect = await resolveArchivedResearchEntityCanonicalSlug(tombstone.archivedSlug);
      if (redirect === tombstone.survivorSlug) applied.redirectsResolving += 1;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    planned: plan.tombstones.length,
    heldByReason: plan.held.reduce<Record<string, number>>((counts, hold) => {
      counts[hold.reason] = (counts[hold.reason] ?? 0) + 1;
      return counts;
    }, {}),
    applied,
  };
  console.log(JSON.stringify(report, null, 2));
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify({ ...report, plan }, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
