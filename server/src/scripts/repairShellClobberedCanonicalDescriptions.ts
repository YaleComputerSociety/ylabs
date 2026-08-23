import 'dotenv/config';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { syncEntities } from '../services/meiliSyncService';

interface RepairPlan {
  canonicalSlug: string;
  canonicalId: string;
  shellSlug: string;
  set: { fullDescription?: string; shortDescription?: string };
  skipped: string[];
  removeResearchAreas: string[];
  researchAreasAfter?: string[];
}

function looksTruncated(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return !/[.!?"”')\]]$/.test(trimmed);
}

async function buildPlans(): Promise<RepairPlan[]> {
  const shells = await ResearchEntity.find({
    archived: true,
    canonicalGroupId: { $ne: null },
    slug: { $regex: '^(nih-pi-|nsf-pi-)' },
  })
    .select('_id slug canonicalGroupId shortDescription fullDescription researchAreas')
    .lean();

  const shellsByCanonical = new Map<string, (typeof shells)[number][]>();
  for (const shell of shells) {
    const key = String(shell.canonicalGroupId);
    const list = shellsByCanonical.get(key) || [];
    list.push(shell);
    shellsByCanonical.set(key, list);
  }

  const canonicalIds = Array.from(shellsByCanonical.keys());
  const canonicals = await ResearchEntity.find({ _id: { $in: canonicalIds } })
    .select('_id slug shortDescription fullDescription researchAreas')
    .lean();
  const canonicalById = new Map(canonicals.map((entity) => [String(entity._id), entity]));

  const observations = await Observation.find({
    entityId: { $in: canonicalIds },
    field: { $in: ['fullDescription', 'shortDescription', 'researchAreas'] },
    superseded: { $ne: true },
  })
    .select('entityId field value')
    .lean();

  const ownFieldsByEntity = new Map<string, Record<string, string>>();
  for (const observation of observations) {
    const key = String(observation.entityId);
    const record = ownFieldsByEntity.get(key) || {};
    record[observation.field] = String(observation.value);
    ownFieldsByEntity.set(key, record);
  }

  const plans: RepairPlan[] = [];
  for (const canonicalId of canonicalIds) {
    const canonical = canonicalById.get(canonicalId);
    if (!canonical) continue;
    const ownFields = ownFieldsByEntity.get(canonicalId);
    if (!ownFields) continue;
    const shellsForCanonical = shellsByCanonical.get(canonicalId) || [];

    const liveFull = (canonical.fullDescription || '').trim();
    const liveShort = (canonical.shortDescription || '').trim();
    const ownFull = (ownFields.fullDescription || '').trim();
    const ownShort = (ownFields.shortDescription || '').trim();

    let fullClobberedBy: (typeof shells)[number] | null = null;
    let shortClobberedBy: (typeof shells)[number] | null = null;
    for (const shell of shellsForCanonical) {
      const shellFull = (shell.fullDescription || '').trim();
      const shellShort = (shell.shortDescription || '').trim();
      if (!fullClobberedBy && ownFull && shellFull && liveFull === shellFull && liveFull !== ownFull) {
        fullClobberedBy = shell;
      }
      if (
        !shortClobberedBy &&
        ownShort &&
        shellShort &&
        liveShort === shellShort &&
        liveShort !== ownShort
      ) {
        shortClobberedBy = shell;
      }
    }
    if (!fullClobberedBy && !shortClobberedBy) continue;

    const set: RepairPlan['set'] = {};
    const skipped: string[] = [];
    if (fullClobberedBy) {
      if (looksTruncated(ownFull)) skipped.push('fullDescription(own observation looks truncated)');
      else set.fullDescription = ownFull;
    }
    if (shortClobberedBy) {
      if (looksTruncated(ownShort)) skipped.push('shortDescription(own observation looks truncated)');
      else set.shortDescription = ownShort;
    }

    const contaminatingShell = fullClobberedBy || shortClobberedBy;
    if (!contaminatingShell) continue;
    const ownAreas = (ownFields.researchAreas || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const shellAreas: string[] = contaminatingShell.researchAreas || [];
    const liveAreas: string[] = canonical.researchAreas || [];
    const removeResearchAreas = liveAreas.filter(
      (area: string) =>
        shellAreas.some((shellArea) => shellArea.toLowerCase() === area.toLowerCase()) &&
        !ownAreas.some((ownArea) => ownArea.toLowerCase() === area.toLowerCase()),
    );

    plans.push({
      canonicalSlug: canonical.slug,
      canonicalId,
      shellSlug: contaminatingShell.slug,
      set,
      skipped,
      removeResearchAreas,
      researchAreasAfter:
        removeResearchAreas.length > 0
          ? liveAreas.filter((area: string) => !removeResearchAreas.includes(area))
          : undefined,
    });
  }

  return plans;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const slugsArg = process.argv.find((arg) => arg.startsWith('--slugs='));
  const allowedSlugs = slugsArg
    ? new Set(
        slugsArg
          .slice('--slugs='.length)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    : null;
  if (apply && (!allowedSlugs || allowedSlugs.size === 0)) {
    console.error('--apply requires --slugs=<comma-separated canonical slugs> to scope the write');
    process.exit(1);
  }

  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('MONGODBURL is not set');
    process.exit(1);
  }
  const pathname = new URL(url).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL points at ${pathname}, not /Development`);
    process.exit(1);
  }

  await mongoose.connect(url);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${pathname}`);

  const plans = await buildPlans();
  console.log(`\ncanonical entities clobbered by an archived nsf-pi-/nih-pi- shell merge: ${plans.length}`);
  for (const plan of plans) {
    console.log(`\n[${plan.canonicalSlug}] <- ${plan.shellSlug}`);
    console.log(`  set: ${JSON.stringify(plan.set)}`);
    if (plan.skipped.length > 0) console.log(`  skipped: ${JSON.stringify(plan.skipped)}`);
    if (plan.removeResearchAreas.length > 0) {
      console.log(`  removeResearchAreas: ${JSON.stringify(plan.removeResearchAreas)}`);
    }
  }

  if (apply) {
    const scopedPlans = plans.filter((plan) => allowedSlugs!.has(plan.canonicalSlug));
    console.log(`\napplying to ${scopedPlans.length} of ${plans.length} detected entities (scoped by --slugs)`);
    const collection = mongoose.connection.collection('research_entities');
    const updatedIds: mongoose.Types.ObjectId[] = [];
    for (const plan of scopedPlans) {
      const update: Record<string, unknown> = { ...plan.set };
      if (plan.researchAreasAfter) update.researchAreas = plan.researchAreasAfter;
      if (Object.keys(update).length === 0) continue;
      await collection.updateOne({ _id: new mongoose.Types.ObjectId(plan.canonicalId) }, { $set: update });
      updatedIds.push(new mongoose.Types.ObjectId(plan.canonicalId));
    }
    if (updatedIds.length > 0) {
      const updatedDocs = await collection.find({ _id: { $in: updatedIds } }).toArray();
      await syncEntities('researchEntity', updatedDocs);
    }
    console.log(`\nAPPLIED to ${updatedIds.length} entities and re-synced them to Meilisearch.`);
  } else {
    console.log('\ndry-run complete; re-run with --apply --slugs=<slug1,slug2> to write and re-sync a scoped subset.');
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
