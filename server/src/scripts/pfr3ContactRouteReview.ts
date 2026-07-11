import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { ContactRoute } from '../models/contactRoute';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { buildContactRouteReviewQueue } from './pfr3RolloutCore';

async function main() {
  await initializeConnections();
  const candidates = await ContactRoute.find({
    archived: { $ne: true },
    'review.status': { $ne: 'approved' },
  })
    .select(
      'routeType url sourceUrl contactPolicy sourceEvidenceId sourceEvidenceIds priority review.status archived',
    )
    .lean();
  const queue = buildContactRouteReviewQueue(candidates);
  console.log(
    JSON.stringify(
      { generatedAt: new Date().toISOString(), candidateCount: queue.length, candidates: queue },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .catch((error) => {
      console.error('Failed to build PFR-3 contact-route review queue:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
