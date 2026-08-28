import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { resolveField, type ResolverObservation } from '../scrapers/confidenceResolver';

function serialize(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  return JSON.stringify(value);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const OLD_DECAY_SOURCE_ALIAS = 'manual-admin-edit__pre-fix-decay-simulated';

interface EntityFieldKey {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
}

function keyFor(k: EntityFieldKey): string {
  return `${k.entityType}::${k.entityId ?? ''}::${k.entityKey ?? ''}::${k.field}`;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const manualDocs = await Observation.find({ sourceName: 'manual-admin-edit', superseded: false })
    .select('entityType entityId entityKey field')
    .lean();

  const targets = new Map<string, EntityFieldKey>();
  for (const doc of manualDocs as any[]) {
    const k: EntityFieldKey = {
      entityType: doc.entityType,
      entityId: doc.entityId ? String(doc.entityId) : undefined,
      entityKey: doc.entityKey || undefined,
      field: doc.field,
    };
    targets.set(keyFor(k), k);
  }
  console.error(`manual-admin-edit observation targets (entity, field pairs): ${targets.size}`);

  const now = new Date();
  const flips: any[] = [];
  let alreadyManualWinner = 0;
  let noFlip = 0;

  for (const target of targets.values()) {
    const filter: any = { entityType: target.entityType, field: target.field, superseded: false };
    if (target.entityId) filter.entityId = new mongoose.Types.ObjectId(target.entityId);
    else filter.entityKey = target.entityKey;

    const obs = await Observation.find(filter)
      .select('field value sourceName confidence observedAt')
      .lean();

    const resolverObs: ResolverObservation[] = (obs as any[]).map((o) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
    }));

    const fixedResolution = resolveField(target.field, resolverObs, { now });
    const preFixResolution = resolveField(
      target.field,
      resolverObs.map((o) =>
        o.sourceName === 'manual-admin-edit' ? { ...o, sourceName: OLD_DECAY_SOURCE_ALIAS } : o,
      ),
      { now },
    );

    const fixedIsManual = !!fixedResolution?.contributingSources.includes('manual-admin-edit');
    const preFixIsManual = !!preFixResolution?.contributingSources.includes(OLD_DECAY_SOURCE_ALIAS);

    if (preFixIsManual) {
      alreadyManualWinner++;
      continue;
    }
    if (!fixedIsManual) {
      noFlip++;
      continue;
    }

    let liveValue: unknown;
    let liveMatchesManual: boolean | undefined;
    if (target.entityType === 'researchEntity' || target.entityType === 'researchGroup') {
      const entityFilter: any = target.entityId
        ? { _id: new mongoose.Types.ObjectId(target.entityId) }
        : { slug: target.entityKey };
      const entityDoc = await ResearchEntity.findOne(entityFilter).select(target.field).lean();
      liveValue = entityDoc ? (entityDoc as any)[target.field] : undefined;
      liveMatchesManual = serialize(liveValue) === serialize(fixedResolution?.value);
    }

    flips.push({
      entityType: target.entityType,
      entityId: target.entityId,
      entityKey: target.entityKey,
      field: target.field,
      preFixWinner: preFixResolution?.contributingSources,
      preFixValue: preFixResolution?.value,
      fixedValue: fixedResolution?.value,
      liveValue,
      liveAlreadyCorrect: liveMatchesManual,
    });
  }

  const liveAlreadyWrong = flips.filter((f) => f.liveAlreadyCorrect === false).length;

  console.error(`Already resolves to manual-admin-edit under old decay (no change from fix): ${alreadyManualWinner}`);
  console.error(`Manual-admin-edit does not win even with the fix (needs individual review, not a decay case): ${noFlip}`);
  console.error(`Decay-reversal instances the fix corrects (old decay picked a scraper source, fix restores the manual value): ${flips.length}`);
  console.error(`Of those, already live-wrong on the entity document today (not just at future risk): ${liveAlreadyWrong}`);
  console.log(JSON.stringify(flips, null, 2));
}

main()
  .catch((error) => {
    console.error('auditManualEditDecayReversal failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
