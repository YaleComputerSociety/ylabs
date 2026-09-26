/**
 * Read-only: how many served rows carry a description whose cited page is not about
 * that row.
 *
 * `research-entity:recheck-description-grounding` already answers a neighbouring
 * question, whether the text still appears on the page it cites, and a borrowed
 * description passes it: a school's research landing page genuinely does carry the
 * prose attributed to one of its faculty. The unasked question is ownership, and this
 * audit asks it with the two predicates `labMicrositeDescriptionLLMExtractor` refuses
 * on at write time (#3162), so no new judgement is invented here.
 *
 * Needs no network. Both predicate inputs are derived from the corpus: a URL is shared
 * when more than one row cites it, and a host is institutional when at least 25 rows do.
 *
 *   yarn --cwd server research-entity:audit-description-source-ownership
 *   yarn --cwd server research-entity:audit-description-source-ownership --output ./tmp/ownership.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import {
  evidenceUrlsOf,
  institutionalEvidenceHosts,
  sharedEvidenceUrls,
} from '../scrapers/utils/sharedEvidenceUrls';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildDescriptionSourceOwnershipReport,
  classifyDescriptionSourceOwnership,
  type DescriptionSourceOwnershipFinding,
} from './auditDescriptionSourceOwnershipCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SERVED_TIER = 'student_ready';

const parseFlag = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const requested = parseFlag(argv, '--output');
  const output = requested ? resolveSafeJsonReportOutputPath(requested) : undefined;

  const url = String(process.env.MONGODBURL || '').trim();
  if (!url) throw new Error('MONGODBURL is required');
  console.log(`Reading ${summarizeMongoUrl(url)}`);

  mongoose.set('autoIndex', false);
  await mongoose.connect(url);
  try {
    // The shared-URL and institutional-host sets are properties of the whole corpus,
    // so they are derived from every live row rather than from the served slice. A set
    // built from the served slice alone would call a page unshared because its other
    // citer happens to be withheld.
    const citingRows = (await ResearchEntity.find({ archived: { $ne: true } })
      .select('websiteUrl website sourceUrls')
      .lean()) as any[];
    const sharedUrls = sharedEvidenceUrls(citingRows);
    const institutionalHosts = institutionalEvidenceHosts(citingRows);
    const citersByUrl = new Map<string, number>();
    for (const row of citingRows) {
      for (const url of evidenceUrlsOf(row)) citersByUrl.set(url, (citersByUrl.get(url) || 0) + 1);
    }
    console.log(
      `corpus: ${citingRows.length} live rows, ${sharedUrls.size} shared URLs, ${institutionalHosts.size} institutional hosts`,
    );

    const servedRows = (await ResearchEntity.find({
      studentVisibilityTier: SERVED_TIER,
      archived: { $ne: true },
    })
      .select('slug entityType fullDescription shortDescription fieldProvenance')
      .lean()) as any[];

    const findings: DescriptionSourceOwnershipFinding[] = servedRows.map((row) =>
      classifyDescriptionSourceOwnership(row, sharedUrls, institutionalHosts, citersByUrl),
    );
    const report = buildDescriptionSourceOwnershipReport(findings);

    console.log(`\nserved rows: ${report.rows}`);
    console.log('by verdict:');
    for (const [verdict, count] of Object.entries(report.byVerdict).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${verdict.padEnd(30)} ${count}`);
    }
    const unowned =
      (report.byVerdict.shared_evidence_page || 0) +
      (report.byVerdict.institution_section_landing || 0);
    console.log(`\nnot owned by the row serving it: ${unowned}`);
    console.log(`  asserted before the #3162 guard: ${report.unownedBeforeGuard}`);
    console.log(`  asserted after it:               ${report.unownedAfterGuard}`);
    console.log('\nby writing lane:');
    for (const [lane, count] of Object.entries(report.byLane).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${lane}`);
    }
    const pairs = findings.filter(
      (f) =>
        (f.verdict === 'shared_evidence_page' || f.verdict === 'institution_section_landing') &&
        f.citedPageRowCount === 2,
    );
    console.log(
      `\nof those, cited by exactly 2 rows (usually one subject stored twice, a duplicate-row defect): ${pairs.length}`,
    );
    console.log('\nmost reused cited pages:');
    for (const entry of report.reusedCitedUrls.slice(0, 10)) {
      console.log(`  ${String(entry.rows).padStart(4)}  ${entry.url.slice(0, 84)}`);
    }

    if (output) {
      fs.writeFileSync(output, JSON.stringify({ report, findings }, null, 1));
      console.log(`\nreport written to ${output}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
