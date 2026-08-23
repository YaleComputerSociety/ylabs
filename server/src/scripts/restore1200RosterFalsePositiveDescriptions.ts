import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { resolveField, ResolverObservation } from '../scrapers/confidenceResolver';
import {
  materializedFieldValue,
  resolveMaterializedShortDescription,
  shouldIgnoreObservationForEntityMaterialization,
} from '../scrapers/entityMaterializer';
import { syncEntity } from '../services/meiliSyncService';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
} from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TARGET_ENTITY_IDS = [
  '6a0d178c3fa399fefb6e5763', // faculty-research-area-edward-l-snyder
  '6a0567927c6d4fba869fbf11', // ysm-harpazrotem
  '6a057df713fc60d57ec2a4f2', // nih-pi-ilan-harpaz-rotem
  '6a0d17a33fa399fefb6e59f3', // faculty-research-area-ilan-harpaz-rotem
  '6a058cdcba66f3c14bd84edb', // stout-stout
  '6a058ce9ba66f3c14bd84fcd', // rokhlin-lab-vr7
  '6a058cfeba66f3c14bd851d1', // agnew-jagnew
  '6a058d3bba66f3c14bd855fd', // carlisle-jc692
];

function assertDevelopmentTarget(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is not set');
  const parsed = new URL(mongoUrl);
  if (parsed.pathname !== '/Development') {
    throw new Error(
      `Refusing to run: MONGODBURL pathname is "${parsed.pathname}", expected "/Development"`,
    );
  }
}

interface EntityOutcome {
  slug: string;
  entityId: string;
  fullDescription: { before: string; after: string; changed: boolean };
  shortDescription: { before: string; after: string; changed: boolean };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  assertDevelopmentTarget(process.env.MONGODBURL);
  await initializeConnections();
  const connectedDb = mongoose.connection.db?.databaseName;
  if (connectedDb !== 'Development') {
    throw new Error(`Refusing to run: connected database is "${connectedDb}", expected "Development"`);
  }

  const outcomes: EntityOutcome[] = [];

  for (const entityId of TARGET_ENTITY_IDS) {
    const entityDoc = await ResearchEntity.findById(entityId).lean();
    if (!entityDoc) {
      console.log(`skip ${entityId}: entity not found`);
      continue;
    }

    const observations = await Observation.find({
      entityType: 'researchEntity',
      entityId,
      superseded: false,
    }).lean();

    const materializationObs = observations.filter(
      (o: any) => !shouldIgnoreObservationForEntityMaterialization('researchEntity', o),
    );
    const resolverObs: ResolverObservation[] = materializationObs.map((o: any) => ({
      field: o.field,
      value: o.value,
      sourceName: o.sourceName,
      confidence: o.confidence,
      observedAt: o.observedAt,
    }));

    const resolvedFull = resolveField('fullDescription', resolverObs);
    const currentFullDescription = String((entityDoc as any).fullDescription || '');
    const nextFullDescription = resolvedFull
      ? String(
          materializedFieldValue(
            'researchEntity',
            'fullDescription',
            resolvedFull.value,
            currentFullDescription,
          ) || '',
        )
      : currentFullDescription;

    const currentShortDescription = String((entityDoc as any).shortDescription || '');
    const groundedShort = await resolveMaterializedShortDescription({
      fullDescription: nextFullDescription,
      currentShortDescription,
      researchAreas: (entityDoc as any).researchAreas,
      manuallyLocked: ((entityDoc as any).manuallyLockedFields || []).includes('shortDescription'),
      synthesize: async () => '',
    });
    const nextShortDescription = groundedShort || currentShortDescription;

    const fullChanged = nextFullDescription !== currentFullDescription;
    const shortChanged = nextShortDescription !== currentShortDescription;

    outcomes.push({
      slug: String((entityDoc as any).slug || ''),
      entityId,
      fullDescription: {
        before: currentFullDescription,
        after: nextFullDescription,
        changed: fullChanged,
      },
      shortDescription: {
        before: currentShortDescription,
        after: nextShortDescription,
        changed: shortChanged,
      },
    });

    if (apply && (fullChanged || shortChanged)) {
      const set: Record<string, unknown> = {};
      if (fullChanged) {
        set.fullDescription = nextFullDescription;
        if (resolvedFull) set['confidenceByField.fullDescription'] = resolvedFull.confidence;
      }
      if (shortChanged) set.shortDescription = nextShortDescription;
      await ResearchEntity.updateOne({ _id: entityId }, { $set: set });
      const freshDoc = await ResearchEntity.findById(entityId).lean();
      if (freshDoc) await syncEntity('researchEntity', freshDoc);
    }
  }

  console.log(JSON.stringify({ apply, outcomes }, null, 2));

  if (apply) {
    const changedIds = outcomes
      .filter((o) => o.fullDescription.changed || o.shortDescription.changed)
      .map((o) => o.entityId);
    if (changedIds.length > 0) {
      const plans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: changedIds,
      });
      await applyStudentVisibilityGatePlans(plans);
      console.log(
        JSON.stringify(
          {
            visibilityGatePlans: plans.map((p) => ({
              recordId: p.recordId,
              label: p.label,
              currentTier: p.currentTier,
              tier: p.tier,
            })),
          },
          null,
          2,
        ),
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
