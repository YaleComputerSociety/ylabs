/**
 * Dedupe visible program/fellowship records that share the same title and source URL.
 *
 * A re-scrape can create a second record for the same program that only differs by a
 * weaker, generic application link (e.g. a CommunityForce `Search.aspx` landing instead
 * of the specific `FundDetails.aspx` deep link), which renders as a duplicate card.
 *
 * For each title+sourceUrl group this keeps the record with the most specific application
 * link and archives the rest (the codebase soft-delete), so no data is destroyed.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/dedupeProgramDuplicates.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/dedupeProgramDuplicates.ts --apply --confirm-dedupe
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'dedupeProgramDuplicates';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

const parseArgs = (argv: string[]): CliOptions => ({
  apply: argv.includes('--apply'),
  confirm: argv.includes('--confirm-dedupe'),
});

const normalizeKey = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const isGenericSearchLanding = (applicationLink: string): boolean =>
  /\/search\.aspx(?:$|[?#])/i.test(applicationLink) || /\/search\/?$/i.test(applicationLink);

const applicationLinkSpecificity = (applicationLink: string): number => {
  const link = (applicationLink || '').trim();
  if (!link) return 0;
  if (isGenericSearchLanding(link)) return 1;
  let score = 2;
  if (link.includes('?')) score += 1;
  return score;
};

const rankForKeep = (doc: any): number[] => [
  applicationLinkSpecificity(doc.applicationLink),
  doc.applicationLink ? String(doc.applicationLink).length : 0,
];

const isBetterKeep = (candidate: any, current: any): boolean => {
  const candidateRank = rankForKeep(candidate);
  const currentRank = rankForKeep(current);
  for (let i = 0; i < candidateRank.length; i += 1) {
    if (candidateRank[i] !== currentRank[i]) return candidateRank[i] > currentRank[i];
  }
  const candidateCreated = candidate.createdAt ? new Date(candidate.createdAt).getTime() : Infinity;
  const currentCreated = current.createdAt ? new Date(current.createdAt).getTime() : Infinity;
  return candidateCreated < currentCreated;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Target: ${guard.dbLabel} (env=${guard.environment})`);

  const docs = await Fellowship.find({
    archived: false,
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();

  const groups = new Map<string, any[]>();
  for (const doc of docs) {
    const key = `${normalizeKey(doc.title)}||${normalizeKey(doc.sourceUrl)}`;
    if (!doc.sourceUrl) continue;
    const arr = groups.get(key) || [];
    arr.push(doc);
    groups.set(key, arr);
  }

  const archiveIds: string[] = [];
  let groupCount = 0;
  for (const [, arr] of groups) {
    if (arr.length < 2) continue;
    groupCount += 1;
    let keep = arr[0];
    for (const doc of arr.slice(1)) {
      if (isBetterKeep(doc, keep)) keep = doc;
    }
    const keepId = serializedDocumentId(keep._id);
    console.log(`\nGroup "${keep.title}" (${arr.length} records) source=${keep.sourceUrl}`);
    console.log(`  KEEP    id=${keepId} applicationLink=${keep.applicationLink || '(none)'}`);
    for (const doc of arr) {
      const docId = serializedDocumentId(doc._id);
      if (docId === keepId) continue;
      console.log(`  ARCHIVE id=${docId} applicationLink=${doc.applicationLink || '(none)'}`);
      if (docId) archiveIds.push(docId);
    }
  }

  console.log(
    `\nDuplicate groups: ${groupCount}. Records to archive: ${archiveIds.length}. Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}.`,
  );

  if (options.apply) {
    if (!options.confirm) {
      throw new Error(`${SCRIPT_NAME}: --apply requires --confirm-dedupe.`);
    }
    if (archiveIds.length > 0) {
      const result = await Fellowship.updateMany(
        { _id: { $in: archiveIds } },
        { $set: { archived: true } },
      );
      console.log(`Archived ${result.modifiedCount} duplicate records.`);
    }
  } else if (archiveIds.length > 0) {
    console.log('Dry-run only. Re-run with --apply --confirm-dedupe to archive the duplicates.');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${SCRIPT_NAME} failed:`, error);
  await mongoose.disconnect();
  process.exit(1);
});
