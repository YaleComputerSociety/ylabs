/**
 * Drain the individually verified #1413 (wrong-person description narrative)
 * and #1407 (wrong-person researchAreas) namesake-graft residuals still live
 * on `student_ready` (and two pending `operator_review`) entities.
 *
 * Every prior purge in this graft family (#1256, #1290, #604) was scoped to a
 * hand-verified set of exact strings still present on a named entity, because a
 * broad "off-topic" filter over-purges genuine interdisciplinary scholars; this
 * follows the same pattern (`purgeNamesakeGraftResidualsCore.ts`) rather than
 * introducing a new heuristic classifier. Each entity below was read fresh from
 * Development immediately before this list was written, so entries already
 * self-corrected (`glahn-lab-dcg32`, `nih-pi-sarah-taylor` no longer cite their
 * reported wrong-person sourceUrls) are intentionally omitted rather than
 * re-verified against stale audit-comment snapshots.
 *
 *   yarn --cwd server tsx src/scripts/purgeNamesakeGraftResiduals.ts               # dry-run
 *   yarn --cwd server tsx src/scripts/purgeNamesakeGraftResiduals.ts --apply \
 *     --confirm-namesake-graft-purge
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
  planNamesakeGraftCleanup,
  summarizeNamesakeGraftPlans,
  type NamesakeGraftDirective,
} from './purgeNamesakeGraftResidualsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VERIFIED_GRAFTS: NamesakeGraftDirective[] = [
  {
    entityId: '6a0d17e83fa399fefb6e625b',
    slug: 'faculty-research-area-rex-ying',
    removeAreas: ['Neuroscience', 'Psychology', 'Developmental Biology', 'Immunotherapy'],
    clearFullDescriptionIfEquals:
      "Rex Ying's research focuses on immunotherapy and immune responses, particularly in the context of vaccines and immunoinformatics approaches. He also explores digital imaging techniques to study blood diseases, aiming to enhance understanding and treatment of these conditions.",
    clearShortDescriptionIfEquals:
      'Rex Ying studies immunotherapy, vaccines, and digital imaging for blood diseases.',
    clearStudentDecisionExplanationIfExplanationEquals:
      'Consider reaching out to explore potential opportunities in immunotherapy and related fields.',
  },
  {
    entityId: '6a057e2913fc60d57ec2b06f',
    slug: 'nih-pi-pei-yu-chen',
    clearFullDescriptionIfEquals:
      'The Pei-Yu Chen Lab focuses on research in semiconductor lasers and optical devices, as well as photonic and optical devices. Additionally, the lab explores conducting polymers and their various applications.',
    clearShortDescriptionIfEquals:
      'The Pei-Yu Chen Lab investigates semiconductor lasers, optical devices, and conducting polymers.',
  },
  {
    entityId: '6a056c9014107ca43f8a7491',
    slug: 'dept-statistics-p-m-aronow',
    removeAreas: ['Electrical Engineering', 'Biochemistry', 'Biophysics', 'Forestry'],
  },
  {
    entityId: '6a057e3b13fc60d57ec2b4c2',
    slug: 'nih-pi-r-constable',
    removeAreas: [
      'Social Work Education and Practice',
      'Diverse Education Studies and Reforms',
      'Family and Disability Support Research',
      'Counseling, Therapy, and Family Dynamics',
      'Early Childhood Education and Development',
    ],
  },
  {
    entityId: '6a057dd713fc60d57ec29db4',
    slug: 'nih-pi-margaret-lind',
    removeAreas: [
      'Jewish and Middle Eastern Studies',
      'Memory, Trauma, and Commemoration',
      'Italian Fascism and Post-war Society',
      'Photography and Visual Culture',
      'European history and politics',
      'Middle Eastern Studies',
    ],
  },
  {
    entityId: '6a057df813fc60d57ec2a501',
    slug: 'nih-pi-deepak-d-souza',
    removeAreas: [
      'Semantic Web and Ontologies',
      'Data Quality and Management',
      'Scientific Computing and Data Management',
      'Paranormal Experiences and Beliefs',
    ],
  },
  {
    entityId: '6a057e4e13fc60d57ec2b956',
    slug: 'nih-pi-daniel-o-neil',
    removeAreas: ['Japanese History and Culture'],
  },
  {
    entityId: '6a057e4813fc60d57ec2b778',
    slug: 'nih-pi-hanah-georges',
    removeAreas: ['Animal Disease Management and Epidemiology', 'Vector-Borne Animal Diseases'],
  },
  {
    entityId: '6a64724818a92957f5bec930',
    slug: 'nsf-pi-67d8926f50621bcef4349def',
    removeAreas: ['Fuel Cells'],
    clearFullDescriptionIfEquals:
      'The Junliang Shen Lab focuses on membrane-based ion separation techniques and membrane separation technologies, exploring their applications in fuel cells and related materials. The research investigates the efficiency and effectiveness of these methods in various contexts.',
    clearShortDescriptionIfEquals:
      'The Junliang Shen Lab studies membrane-based ion separation techniques and their applications in fuel cells.',
  },
  {
    entityId: '6a058d55ba66f3c14bd857d5',
    slug: 'peters-jdp52',
    clearFullDescriptionIfEquals:
      'Dr. Peters studies disorders of the central nervous system, including Multiple Sclerosis, Neuromyelitis Optica, transverse myelitis, and autoimmune encephalitis. His research emphasizes patient-centered care and the development of individualized, comprehensive treatment plans for these conditions.',
    clearShortDescriptionIfEquals:
      'Dr. Peters studies central nervous system disorders and emphasizes patient-centered care.',
  },
  {
    entityId: '6a058d48ba66f3c14bd856e8',
    slug: 'lin-pl98',
    removeAreas: [
      'Hearing Loss and Rehabilitation',
      'Hearing, Cochlea, Tinnitus, Genetics',
      'Neuroscience and Neuropharmacology Research',
      'Stress Responses and Cortisol',
      'Neural dynamics and brain function',
    ],
  },
  {
    entityId: '6a057e3013fc60d57ec2b202',
    slug: 'nih-pi-carissa-chan',
    removeAreas: [
      'Artificial Intelligence in Healthcare and Education',
      'Gastrointestinal Bleeding Diagnosis and Treatment',
      'FinTech, Crowdfunding, Digital Finance',
      'Machine Learning in Healthcare',
      'Statistical Methods and Inference',
      'Artificial Intelligence',
    ],
  },
  {
    entityId: '6a058d1dba66f3c14bd853fa',
    slug: 'ramachandran-ar287',
    removeAreas: [
      'Neurobiology of Language and Bilingualism',
      'Pharmaceutical Practices and Patient Outcomes',
      'Interpreting and Communication in Healthcare',
    ],
  },
  {
    entityId: '6a54485ff3b13b89b5c532aa',
    slug: 'ysm-geibel-lab',
    removeAreas: ['Modernist Literature and Criticism'],
  },
  {
    entityId: '6a058d62ba66f3c14bd858d1',
    slug: 'geibel-lab-geibel',
    removeAreas: ['Modernist Literature and Criticism'],
  },
  {
    entityId: '6a058d08ba66f3c14bd85283',
    slug: 'foster-bfoster',
    removeAreas: [
      'Liver Disease and Transplantation',
      'Liver Disease Diagnosis and Treatment',
      'Pancreatitis Pathology and Treatment',
    ],
  },
  {
    entityId: '6a058e49ba66f3c14bd8725e',
    slug: 'fiss-omf2',
    removeAreas: ['Islamic Law and Civilization'],
    clearShortDescriptionIfEquals: 'Studies Islamic Law and Civilization.',
  },
  {
    // Grafted areas laundered into a fluent "The X Lab focuses on..."
    // description (soft-robotics PI served an Optics/Photonics/Semiconductor
    // Lasers narrative); the entity's own recentGrants (2024 Waterman Award,
    // granular metamaterials) are unambiguously soft robotics/materials science.
    entityId: '6a64722718a92957f5bec46d',
    slug: 'nsf-pi-67d8922b50621bcef4348f57',
    removeAreas: ['Optics', 'Photonics'],
    clearFullDescriptionIfEquals:
      'The Rebecca Kramer-Bottiglio Lab focuses on research in Optical Network Technologies, Photonic and Optical Devices, and Semiconductor Lasers and Optical Devices. The lab investigates the development and application of these technologies to advance the field of optics and photonics.',
    clearShortDescriptionIfEquals:
      'The lab studies Optical Network Technologies and Photonic Devices.',
  },
  {
    // Disease-ecology lab (Colin Carlson, VERENA host-virus network per its own
    // recentGrants/sourceUrls) carrying an unrelated geochemistry graft cluster.
    // fullDescription is already correct, so only the areas need stripping.
    entityId: '6a057f10fab31be25f983b2a',
    slug: 'nsf-pi-67d891de50621bcef4347f97',
    removeAreas: [
      'Geological and Geochemical Analysis',
      'Calibration and Measurement Techniques',
      'Geochemistry and Geologic Mapping',
    ],
  },
  {
    // Synthetic organic chemist (NIGMS C-H functionalization grants) fully
    // relabeled as a parasitic-disease/malaria lab in both areas and the
    // areas-derived "Research fields include..." description template.
    entityId: '6a057df113fc60d57ec2a3a3',
    slug: 'nih-pi-jonathan-ellman',
    removeAreas: [
      'Parasitic Diseases Research and Treatment',
      'Malaria Research and Control',
      'Parasites and Host Interactions',
    ],
    clearFullDescriptionIfEquals:
      'Research fields include Parasitic Diseases Research and Treatment, Malaria Research and Control, and Parasites and Host Interactions.',
    clearShortDescriptionIfEquals:
      'Research fields include Parasitic Diseases Research and Treatment, Malaria Research and Control, and Parasites and Host Interactions.',
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
    else if (arg === '--confirm-namesake-graft-purge') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-namesake-graft-purge is required when --apply is set.');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'purgeNamesakeGraftResiduals',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const ids = VERIFIED_GRAFTS.map((g) => new mongoose.Types.ObjectId(g.entityId));
  const entities = await ResearchEntity.find({ _id: { $in: ids } })
    .select({
      slug: 1,
      researchAreas: 1,
      fullDescription: 1,
      shortDescription: 1,
      studentDecisionExplanation: 1,
    })
    .lean();
  const entityById = new Map(entities.map((e) => [String(e._id), e]));

  const missing: string[] = [];
  const plans = VERIFIED_GRAFTS.map((directive) => {
    const entity = entityById.get(directive.entityId);
    if (!entity) {
      missing.push(directive.slug);
      return null;
    }
    return planNamesakeGraftCleanup(
      {
        researchAreas: entity.researchAreas,
        fullDescription: entity.fullDescription,
        shortDescription: entity.shortDescription,
        studentDecisionExplanation: entity.studentDecisionExplanation,
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
    ...summarizeNamesakeGraftPlans(plans),
    reindexed: 0,
  };

  if (options.apply && changedPlans.length > 0) {
    const operations = changedPlans.map((plan) => {
      const set: Record<string, unknown> = {};
      const unset: Record<string, unknown> = {};
      if (!plan.areasAfter.every((area, index) => area === plan.areasBefore[index]) ||
        plan.areasAfter.length !== plan.areasBefore.length) {
        set.researchAreas = plan.areasAfter;
      }
      if (plan.fullDescriptionCleared) set.fullDescription = '';
      if (plan.shortDescriptionCleared) set.shortDescription = '';
      if (plan.studentDecisionExplanationCleared) unset.studentDecisionExplanation = '';
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(unset).length > 0) update.$unset = unset;
      return {
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(plan.entityId) },
          update,
        },
      };
    });
    // `studentDecisionExplanation` is no longer declared on the ResearchEntity
    // Mongoose schema (retired #437/#440), so `ResearchEntity.bulkWrite` would
    // silently strip an $unset on it under strict-mode casting. Write through
    // the raw driver collection instead so the unset actually reaches Mongo.
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
      console.error('Failed to purge namesake graft residuals:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
