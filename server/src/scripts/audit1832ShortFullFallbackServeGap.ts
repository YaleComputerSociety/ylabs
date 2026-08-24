import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { toPublicResearchEntityDto } from '../services/researchEntityDto';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { isNonSelfContainedShortDescription } from '../utils/descriptionHygiene';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EXAMPLE_IDS = [
  '6a058cccba66f3c14bd84750',
  '6a058d15ba66f3c14bd85367',
  '6a058d60ba66f3c14bd858ab',
  '6a058d1fba66f3c14bd8541f',
  '6a0f9d9fcf23c0b70f1ab835',
  '6a647130b65d4cb51393bd1f',
  '6a058cf6ba66f3c14bd85132',
  '6a058dcfba66f3c14bd8607a',
  '6a058e31ba66f3c14bd870b9',
  '6a058cd3ba66f3c14bd84e0b',
];

function servedShortBrowse(row: Record<string, any>): string {
  return String(toPublicResearchEntityDto(row, { forList: true }).shortDescription || '');
}

function servedShortDetail(row: Record<string, any>): string {
  const rep = buildResearchEntityPublicDescriptionRepresentation({ entity: row });
  return String(toPublicResearchEntityDto(rep.entity, {}).shortDescription || '');
}

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL as string;
  const parsed = new URL(uri);
  if (parsed.pathname !== '/Development') {
    console.error(`refusing to run: MONGODBURL pathname is ${parsed.pathname}, not /Development`);
    process.exit(1);
  }
  console.log(`connected pathname: ${parsed.pathname}`);
  await mongoose.connect(uri);
  const entities = mongoose.connection.db!.collection('research_entities');

  console.log('\n=== cited example rows ===');
  for (const idHex of EXAMPLE_IDS) {
    const row = await entities.findOne({ _id: new mongoose.Types.ObjectId(idHex) });
    if (!row) {
      console.log(`\n-- ${idHex} -- NOT FOUND`);
      continue;
    }
    const browse = servedShortBrowse(row);
    const detail = servedShortDetail(row);
    console.log(`\n-- ${idHex} (${row.slug}) tier=${row.studentVisibilityTier} --`);
    console.log('stored short :', JSON.stringify(String(row.shortDescription || '').slice(0, 160)));
    console.log('stored full  :', JSON.stringify(String(row.fullDescription || '').slice(0, 160)));
    console.log('served browse:', JSON.stringify(browse.slice(0, 200)));
    console.log('served detail:', JSON.stringify(detail.slice(0, 200)));
    console.log('browse non-self-contained?', isNonSelfContainedShortDescription(browse));
    console.log('detail non-self-contained?', isNonSelfContainedShortDescription(detail));
  }

  console.log('\n=== corpus scan: served non-self-contained shorts among student_ready ===');
  const rows = await entities
    .find({ archived: { $ne: true }, studentVisibilityTier: 'student_ready' })
    .project({ _id: 1, slug: 1, shortDescription: 1, fullDescription: 1, researchAreas: 1, kind: 1, entityType: 1 })
    .toArray();
  let browseBad = 0;
  let detailBad = 0;
  const sample: string[] = [];
  for (const row of rows) {
    const browse = servedShortBrowse(row);
    const detail = servedShortDetail(row);
    const browseNbad = Boolean(browse) && isNonSelfContainedShortDescription(browse);
    const detailNbad = Boolean(detail) && isNonSelfContainedShortDescription(detail);
    if (browseNbad) browseBad += 1;
    if (detailNbad) detailBad += 1;
    if ((browseNbad || detailNbad) && sample.length < 40) {
      sample.push(`${row._id} (${row.slug}) B=${browseNbad} D=${detailNbad} :: ${JSON.stringify((browseNbad ? browse : detail).slice(0, 120))}`);
    }
  }
  console.log(`student_ready scanned: ${rows.length}`);
  console.log(`served-short non-self-contained (browse path): ${browseBad}`);
  console.log(`served-short non-self-contained (detail path): ${detailBad}`);
  console.log('sample:');
  for (const s of sample) console.log('  ', s);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
