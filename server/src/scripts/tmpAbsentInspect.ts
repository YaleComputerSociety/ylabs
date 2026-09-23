import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { htmlToText } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { isDescriptionGroundedInSource } from '../utils/officialResearchDescription';
import { descriptionGroundingTargets } from './recheckDescriptionGroundingCore';

dotenv.config();
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function main(): Promise<void> {
  mongoose.set('autoIndex', false);
  await initializeConnections();
  const rows = (await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug fullDescription shortDescription fieldProvenance')
    .lean()) as any[];

  const pairs: Array<{ row: any; target: any }> = [];
  for (const row of rows) {
    for (const target of descriptionGroundingTargets(row)) pairs.push({ row, target });
    if (pairs.length >= 40) break;
  }

  const lengths: { grounded: number[]; absent: number[] } = { grounded: [], absent: [] };
  let shown = 0;
  for (const { row, target } of pairs) {
    let pageText = '';
    try {
      const page = await fetchPageWithPolicy(target.url, {
        headers: { 'User-Agent': UA },
        timeoutMs: 15000,
      });
      pageText = htmlToText(page.html);
    } catch {
      continue;
    }
    const observations = (await Observation.find({
      entityType: 'researchEntity',
      entityId: row._id,
      field: target.field,
      sourceName: 'lab-microsite-description-llm',
      superseded: { $ne: true },
    })
      .select('value')
      .lean()) as any[];
    const candidates = [
      target.storedDescription,
      ...observations.map((o) => o.value).filter((v) => typeof v === 'string'),
    ];
    const grounded = candidates.some((c) => isDescriptionGroundedInSource(c, pageText));
    (grounded ? lengths.grounded : lengths.absent).push(pageText.length);
    if (!grounded && shown < 3) {
      shown += 1;
      console.log('--- ABSENT case, pageTextLen=', pageText.length, 'field=', target.field);
      console.log('  candidates:', candidates.length);
      for (const c of candidates) console.log('   cand:', JSON.stringify(String(c).slice(0, 200)));
      console.log('  pageText:', JSON.stringify(pageText.slice(0, 600)));
    }
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      n: sorted.length,
      min: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      max: sorted[sorted.length - 1],
      under500: sorted.filter((v) => v < 500).length,
    };
  };
  console.log('grounded pageText lengths', JSON.stringify(stats(lengths.grounded)));
  console.log('absent   pageText lengths', JSON.stringify(stats(lengths.absent)));
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
