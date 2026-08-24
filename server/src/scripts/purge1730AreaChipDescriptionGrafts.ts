/**
 * Drain the individually verified #1730 unbacked-researchArea-chip grafts:
 * `researchAreas` chips with no `fieldProvenance` and zero grounding in the
 * entity's own sourced text, where the served description was itself
 * corrupted enough that #1407's domain-coherence guard
 * (`dropDomainIncoherentUnsourcedResearchAreas`) never trips - it corroborates
 * a chip against the entity's own stored description, and here the
 * description echoes the same wrong chips, so the overlap check is
 * self-confirming. Each entry was read fresh from Development, and each
 * replacement description was grounded against the entity's own live
 * `sourceUrls` page, immediately before this list was written.
 *
 *   yarn --cwd server tsx src/scripts/purge1730AreaChipDescriptionGrafts.ts               # dry-run
 *   yarn --cwd server tsx src/scripts/purge1730AreaChipDescriptionGrafts.ts --apply \
 *     --confirm-area-chip-description-graft-purge
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  planAreaChipDescriptionGraftCleanup,
  summarizeAreaChipDescriptionGraftPlans,
  type AreaChipDescriptionGraftDirective,
} from './purge1730AreaChipDescriptionGraftsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VERIFIED_GRAFTS: AreaChipDescriptionGraftDirective[] = [
  {
    // Sulayman Dib-Hajj (Neurology) studies voltage-gated sodium channel
    // (Nav1.6-Nav1.9) regulation and trafficking in dorsal root ganglion
    // neurons, targeting pain disorders - confirmed against his live Yale
    // Medicine profile (sourceUrls[0]). The three ocular-disease chips and the
    // description built from them are a foreign-domain graft with no
    // relation to his actual work; the three sodium-channel chips are kept.
    entityId: '6a058dd4ba66f3c14bd860d1',
    slug: 'dib-hajj-lab',
    removeAreas: [
      'Glaucoma and retinal disorders',
      'Ocular Surface and Contact Lens',
      'Intraocular Surgery and Lenses',
    ],
    replaceFullDescriptionIfEquals: {
      from:
        'Dib-Hajj Lab focuses on research related to glaucoma and retinal disorders, as well as the ocular surface and contact lens interactions. The lab investigates intraocular surgery and lenses, with a particular emphasis on the role of sodium channels in these conditions.',
      to:
        'The Dib-Hajj Lab studies how voltage-gated sodium channels, including Nav1.6-Nav1.9, are regulated by accessory proteins and phosphorylation in dorsal root ganglion sensory neurons. The lab investigates Nav1.7 mutations linked to inherited pain disorders and develops live-imaging methods to track sodium channel trafficking, aiming to identify new peripheral targets for pain therapeutics.',
    },
    replaceShortDescriptionIfEquals: {
      from: 'Dib-Hajj Lab studies glaucoma, retinal disorders, and the role of sodium channels in ocular health.',
      to: 'The Dib-Hajj Lab studies how voltage-gated sodium channels drive pain signaling in sensory neurons.',
    },
  },
  {
    // Robert Heimer (Yale School of Public Health) studies the health
    // consequences of injection drug use - opioid use disorder, HIV, syringe-
    // based prevention, and infectious disease epidemiology - confirmed
    // against his live YSPH profile (sourceUrls[0]). The two respiratory
    // chips (Asthma, Pulmonary Fibrosis) already get dropped at serve time by
    // the domain-coherence guard, but "Lung" alone survives that guard
    // because the stored fullDescription's trailing "...and lung health"
    // clause (itself a partial graft) falsely corroborates it - the same
    // description-self-confirms-the-graft shape as Dib-Hajj, just partial
    // instead of total. shortDescription has no such clause and needs no
    // change.
    entityId: '6a057e3a13fc60d57ec2b48c',
    slug: 'robert-heimer-lab',
    removeAreas: ['Lung', 'Asthma', 'Pulmonary Fibrosis'],
    replaceFullDescriptionIfEquals: {
      from:
        'The Robert Heimer Lab focuses on research related to substance abuse, particularly opioid use disorder, and its associated outcomes. The lab investigates the intersections of drug use, HIV, sexual risk behaviors, and lung health.',
      to:
        'The Robert Heimer Lab focuses on research related to substance abuse, particularly opioid use disorder, and its associated outcomes. The lab investigates the intersections of drug use, HIV, sexual risk behaviors, and infectious disease epidemiology, including syringe-based prevention and overdose response.',
    },
  },
];

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-area-chip-description-graft-purge') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-area-chip-description-graft-purge is required when --apply is set.');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'purge1730AreaChipDescriptionGrafts',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const ids = VERIFIED_GRAFTS.map((g) => new mongoose.Types.ObjectId(g.entityId));
  const entities = await ResearchEntity.find({ _id: { $in: ids } })
    .select({ slug: 1, researchAreas: 1, fullDescription: 1, shortDescription: 1 })
    .lean();
  const entityById = new Map(entities.map((e) => [String(e._id), e]));

  const missing: string[] = [];
  const plans = VERIFIED_GRAFTS.map((directive) => {
    const entity = entityById.get(directive.entityId);
    if (!entity) {
      missing.push(directive.slug);
      return null;
    }
    return planAreaChipDescriptionGraftCleanup(
      {
        researchAreas: entity.researchAreas,
        fullDescription: entity.fullDescription,
        shortDescription: entity.shortDescription,
      },
      directive,
    );
  }).filter((plan): plan is NonNullable<typeof plan> => plan !== null);

  const changedPlans = plans.filter((plan) => plan.changed);
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    verifiedGrafts: VERIFIED_GRAFTS.length,
    entitiesMissing: missing,
    ...summarizeAreaChipDescriptionGraftPlans(plans),
    reindexed: 0,
  };

  if (options.apply && changedPlans.length > 0) {
    const operations = changedPlans.map((plan) => {
      const set: Record<string, unknown> = {};
      if (
        plan.areasAfter.length !== plan.areasBefore.length ||
        plan.areasAfter.some((area, index) => area !== plan.areasBefore[index])
      ) {
        set.researchAreas = plan.areasAfter;
      }
      if (plan.fullDescriptionReplaced) set.fullDescription = plan.fullDescriptionAfter;
      if (plan.shortDescriptionReplaced) set.shortDescription = plan.shortDescriptionAfter;
      return {
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(plan.entityId) },
          update: { $set: set },
        },
      };
    });
    await ResearchEntity.collection.bulkWrite(operations, { ordered: false });

    const changedIds = changedPlans.map((plan) => new mongoose.Types.ObjectId(plan.entityId));
    const fresh = await ResearchEntity.find({ _id: { $in: changedIds } }).lean();
    await syncEntities('researchEntity', fresh);
    summary.reindexed = fresh.length;
  }

  const output = { summary, entries: plans };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to purge #1730 area-chip/description grafts:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
