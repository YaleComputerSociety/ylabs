/**
 * Correct the Glahn Lab entity contamination and clean contaminated source evidence.
 *
 * Dry-run by default. APPLY requires:
 * --apply --limit=N --confirm-v4-migration
 *
 * Run from data-migration/:
 * npx tsx FixGlahnLabDescriptionContamination.ts
 * (add --apply --limit=1 --confirm-v4-migration to write)
 */
import mongoose from '../server/node_modules/mongoose';
import { Observation } from '../server/src/models/observation';
import { ResearchEntity } from '../server/src/models/researchEntity';
import {
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';
import fs from 'fs';

const TITLE = 'Fix Glahn lab description contamination';
const ENTITY_SLUG = 'glahn-lab-dcg32';
const CORRECT_URL = 'https://psychology.yale.edu/people/david-glahn';
const WRONG_URL_NEEDLE = 'david-lang';
const CANONICAL_DESCRIPTION =
  'The research focus of my laboratory is on the genetics of brain structure and function. Our goals include elucidation of the neurobiological roots of major mental illnesses through the integration of cognitive neuropsychological, functional and structural neuroimaging, and behavioral and molecular genetic approaches. The ultimate goals of this research is the identification of genes involved in affective and psychotic illnesses as well as genes that influence non-pathological brain structure and function. Localization of genes involved in mental illness should significantly contribute to an understanding of the underlying biology of these complex diseases, which in turn should improve future treatments and create the potential for prevention strategies.';
const LOCK_FIELDS = ['sourceUrls', 'websiteUrl', 'fullDescription', 'shortDescription', 'description', 'researchAreas', 'methods'];

type GlahnEntity = {
  _id: mongoose.Types.ObjectId;
  slug: string;
  sourceUrls?: string[];
  fullDescription?: string;
  manuallyLockedFields?: string[];
};

type ManualProvenance = {
  sourceName: string;
  sourceUrl: string;
  observedAt: Date;
  confidence: number;
};

async function run(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2));
  await connectForMigration(TITLE, options);

  const entity = (await ResearchEntity.findOne({ slug: ENTITY_SLUG }).lean<GlahnEntity | null>()) as
    | GlahnEntity
    | null;

  if (!entity) throw new Error(`ResearchEntity not found: ${ENTITY_SLUG}`);

  const observationFilter = {
    $and: [{ $or: [{ entityKey: ENTITY_SLUG }, { entityId: entity._id }] }, { sourceUrl: { $regex: WRONG_URL_NEEDLE } }],
  };

  const observationCount = await Observation.countDocuments(observationFilter);

  const contaminated =
    (Array.isArray(entity.sourceUrls) &&
      entity.sourceUrls.some((sourceUrl) => sourceUrl.includes(WRONG_URL_NEEDLE))) ||
    observationCount > 0 ||
    (typeof entity.fullDescription === 'string' && entity.fullDescription.includes('Bang on a Can'));

  const manualLockedFields = Array.from(
    new Set([...(entity.manuallyLockedFields ?? []), ...LOCK_FIELDS]),
  );

  const manualProvenance: ManualProvenance = {
    sourceName: 'manual-data-correction',
    sourceUrl: CORRECT_URL,
    observedAt: new Date(),
    confidence: 1,
  };

  const entitySet: Record<string, unknown> = {
    sourceUrls: [CORRECT_URL],
    websiteUrl: CORRECT_URL,
    description: CANONICAL_DESCRIPTION,
    fullDescription: CANONICAL_DESCRIPTION,
    shortDescription: CANONICAL_DESCRIPTION,
    researchAreas: [],
    methods: [],
    manuallyLockedFields: manualLockedFields,
    'fieldProvenance.fullDescription': manualProvenance,
    'fieldProvenance.shortDescription': manualProvenance,
    'fieldProvenance.description': manualProvenance,
    'fieldProvenance.sourceUrls': manualProvenance,
    'fieldProvenance.websiteUrl': manualProvenance,
  };

  const entityUnset = {
    'fieldProvenance.researchAreas': 1,
    'fieldProvenance.methods': 1,
    'fieldProvenance.acceptingUndergrads': 1,
    'fieldProvenance.studentDecisionExplanation': 1,
    'confidenceByField.researchAreas': 1,
    'confidenceByField.methods': 1,
    'confidenceByField.studentDecisionExplanation': 1,
  };

  let observationsDeleted = 0;

  if (options.apply && contaminated) {
    await ResearchEntity.updateOne({ _id: entity._id }, { $set: entitySet, $unset: entityUnset });
    const deleteResult = await Observation.deleteMany(observationFilter);
    observationsDeleted = deleteResult.deletedCount ?? 0;
  }

  const noop = !contaminated && observationCount === 0;

  const result = {
    slug: ENTITY_SLUG,
    applied: options.apply,
    contaminated,
    noop,
    entity: {
      _idBefore: String(entity._id),
      sourceUrlsBefore: entity.sourceUrls,
      sourceUrlsAfter: [CORRECT_URL],
      descriptionPreviewBefore: (entity.fullDescription || '').slice(0, 120),
      descriptionPreviewAfter: CANONICAL_DESCRIPTION.slice(0, 120),
      lockedFieldsAfter: manualLockedFields,
    },
    observations: {
      matched: observationCount,
      deleted: observationsDeleted,
    },
  };

  const output = buildV4MigrationOutput(result, {
    db: mongoose.connection.name,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  if (options.output) fs.writeFileSync(options.output, JSON.stringify(output, null, 2));

  await disconnectForMigration();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectForMigration().catch(() => undefined);
  process.exit(1);
});
