import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import {
  assertCompactScholarlyLinksExistForApply,
  buildLegacyPaperAuthorshipObservationRetirementFilter,
  buildLegacyPaperAuthorshipObservationRetirementUpdate,
  parseRetireLegacyPaperAuthorshipObservationsArgs,
  summarizeLegacyPaperAuthorshipObservationRetirement,
} from './retireLegacyPaperAuthorshipObservationsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const options = parseRetireLegacyPaperAuthorshipObservationsArgs(
    process.argv.slice(2),
  );

  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'scholarly-links:retire-legacy-observations',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();

  const now = new Date();
  const filter = buildLegacyPaperAuthorshipObservationRetirementFilter();
  const [compactScholarlyLinkCount, targetCount, samples] = await Promise.all([
    ResearchScholarlyLink.countDocuments({ archived: { $ne: true } }),
    Observation.countDocuments(filter),
    Observation.find(filter)
      .select('_id entityId entityKey field value sourceName sourceUrl observedAt')
      .sort({ observedAt: -1, _id: 1 })
      .limit(options.sampleSize)
      .lean(),
  ]);

  assertCompactScholarlyLinksExistForApply({
    apply: options.apply,
    compactScholarlyLinkCount,
  });

  const updateResult =
    options.apply && targetCount > 0
      ? await Observation.updateMany(
          filter,
          buildLegacyPaperAuthorshipObservationRetirementUpdate(now),
        )
      : undefined;

  console.log(
    JSON.stringify(
      summarizeLegacyPaperAuthorshipObservationRetirement({
        apply: options.apply,
        now,
        compactScholarlyLinkCount,
        targetCount,
        samples,
        modifiedCount: updateResult?.modifiedCount || 0,
      }),
      null,
      2,
    ),
  );
}

const executedPath = process.argv[1]
  ? fileURLToPath(new URL(`file://${process.argv[1]}`))
  : '';
if (executedPath === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(
        'Failed to retire legacy paper authorship observations:',
        error,
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
