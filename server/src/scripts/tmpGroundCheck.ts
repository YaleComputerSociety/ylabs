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

  const sample: Array<{ row: any; target: any }> = [];
  for (const row of rows) {
    for (const target of descriptionGroundingTargets(row)) sample.push({ row, target });
    if (sample.length >= 24) break;
  }

  const counts = {
    storedGrounded: 0,
    observationGrounded: 0,
    eitherGrounded: 0,
    neitherGrounded: 0,
    noObservation: 0,
    fetchFailed: 0,
  };
  for (const { row, target } of sample) {
    let pageText = '';
    try {
      const page = await fetchPageWithPolicy(target.url, {
        headers: { 'User-Agent': UA },
        timeoutMs: 15000,
      });
      pageText = htmlToText(page.html);
    } catch {
      counts.fetchFailed += 1;
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
    if (observations.length === 0) counts.noObservation += 1;
    const storedGrounded = isDescriptionGroundedInSource(target.storedDescription, pageText);
    const observationGrounded = observations.some(
      (observation) =>
        typeof observation.value === 'string' &&
        isDescriptionGroundedInSource(observation.value, pageText),
    );
    if (storedGrounded) counts.storedGrounded += 1;
    if (observationGrounded) counts.observationGrounded += 1;
    if (storedGrounded || observationGrounded) counts.eitherGrounded += 1;
    else counts.neitherGrounded += 1;
    if (!storedGrounded && observationGrounded) {
      console.log(
        `DIVERGES field=${target.field} storedLen=${target.storedDescription.length} obsLen=${observations.find((o) => typeof o.value === 'string')?.value?.length}`,
      );
      console.log('  stored head:', JSON.stringify(target.storedDescription.slice(0, 120)));
      const obs = observations.find(
        (o) => typeof o.value === 'string' && isDescriptionGroundedInSource(o.value, pageText),
      );
      console.log('  obs    head:', JSON.stringify(String(obs?.value).slice(0, 120)));
    }
  }
  console.log(JSON.stringify(counts, null, 2));
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
