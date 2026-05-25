import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { classifyProgram } from '../services/programClassifier';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  apply: boolean;
  limit: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: Infinity,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillProgramClassifications',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const query = Fellowship.find({ archived: { $ne: true } }).sort({ title: 1 });
  if (Number.isFinite(options.limit)) query.limit(options.limit);
  const rows = await query.lean();
  const updates: Array<{ id: string; title: string; classification: ReturnType<typeof classifyProgram> }> = [];

  for (const row of rows) {
    const classification = classifyProgram({
      title: row.title,
      competitionType: row.competitionType,
      summary: row.summary,
      description: row.description,
      applicationInformation: row.applicationInformation,
      eligibility: row.eligibility,
      additionalInformation: row.additionalInformation,
      purpose: row.purpose,
      termOfAward: row.termOfAward,
      sourceUrl: row.sourceUrl,
    });
    updates.push({ id: String(row._id), title: row.title, classification });
    if (options.apply) {
      const unset = [
        'undergraduateOnly',
        'yaleCollegeOnly',
        'compensationSummary',
        'hoursPerWeek',
        'programDates',
      ].reduce<Record<string, ''>>((acc, field) => {
        if (!(field in classification)) acc[field] = '';
        return acc;
      }, {});
      await Fellowship.updateOne(
        { _id: row._id },
        {
          $set: classification,
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
      );
    }
  }

  const counts = updates.reduce<Record<string, number>>((acc, item) => {
    const key = item.classification.studentFacingCategory;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        environment: guard.environment,
        db: guard.dbLabel,
        scanned: rows.length,
        counts,
        sample: updates.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to backfill program classifications:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
