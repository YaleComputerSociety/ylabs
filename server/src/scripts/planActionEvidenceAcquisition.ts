import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  ACTION_EVIDENCE_ACQUISITION_BATCH_SIZE,
  buildAcquisitionCommand,
  planAcquisitionBatches,
  selectActionEvidenceAcquisitionTargets,
  type ActionEvidenceLabRow,
} from './planActionEvidenceAcquisitionCore';

dotenv.config();

function usableWebsite(doc: Record<string, unknown>): string {
  const candidates = [
    doc.websiteUrl,
    doc.website,
    ...(Array.isArray(doc.sourceUrls) ? (doc.sourceUrls as unknown[]) : []),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) {
      return candidate.trim();
    }
  }
  return '';
}

async function main(): Promise<void> {
  await initializeConnections();
  const docs = await ResearchEntity.find(
    {
      entityType: 'LAB',
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['operator_review', 'limited_but_safe', 'suppressed'] },
      studentVisibilityReasons: 'missing_action_evidence',
    },
    {
      slug: 1,
      name: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      studentVisibilityReasons: 1,
      lastObservedAt: 1,
    },
  ).lean();

  const rows: ActionEvidenceLabRow[] = (docs as Record<string, any>[]).map((doc) => ({
    slug: String(doc.slug),
    name: String(doc.name ?? ''),
    website: usableWebsite(doc),
    reasons: Array.isArray(doc.studentVisibilityReasons) ? doc.studentVisibilityReasons : [],
    lastObservedAt: doc.lastObservedAt ? new Date(doc.lastObservedAt).toISOString() : null,
  }));

  const targets = selectActionEvidenceAcquisitionTargets(rows);
  const batches = planAcquisitionBatches(targets, ACTION_EVIDENCE_ACQUISITION_BATCH_SIZE);

  console.log(
    `Labs stranded solely on missing_action_evidence with an uncovered website: ${targets.length}`,
  );
  console.log(`Acquisition batches (<= ${ACTION_EVIDENCE_ACQUISITION_BATCH_SIZE} labs each): ${batches.length}`);
  batches.forEach((slugs, index) => {
    console.log(`\n# batch ${index + 1}/${batches.length} (${slugs.length} labs)`);
    for (const slug of slugs) {
      const target = targets.find((row) => row.slug === slug);
      console.log(`  ${slug}  ${sanitizeLogValue(target?.website ?? '')}`);
    }
    console.log(buildAcquisitionCommand(slugs));
  });

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]?.endsWith('planActionEvidenceAcquisition.ts');
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
