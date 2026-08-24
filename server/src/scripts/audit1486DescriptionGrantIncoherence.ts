/**
 * Per-row screen for #1486 (researchArea grafts laundered into fluent
 * fullDescription prose). A cross-entity "same chip on N unrelated
 * departments" frequency signal was tried first and rejected: on a live
 * Development sweep it flagged 131 chip clusters, almost all of which were
 * legitimate topic overlap between adjacent medical sub-specialties (e.g.
 * "Substance Abuse Treatment and Outcomes" shared by Psychiatry/Emergency
 * Medicine/Internal Medicine). This screen instead compares each entity's own
 * `recentGrants` title+abstract vocabulary against its served
 * researchAreas+fullDescription vocabulary; zero shared significant words is
 * the actual graft signal.
 *
 * Every flagged row still needs a manual read against the entity's own
 * sourceUrls/profile before touching it: a narrow single scraped grant can
 * legitimately share no vocabulary with a correct description grounded in a
 * richer source (faculty bio, other publications). Two of the four `nih-pi-*`
 * candidates in the original run were exactly this false-positive shape
 * (Derrick Gordon, Joseph Contessa) and were left untouched after verifying
 * their real Yale profiles.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TEMPLATE_PATTERNS = [/\bfocuses on\b/i, /\bfocuses on the intersection of\b/i];

const STOPWORDS = new Set(
  `the a an of and or for to in on with by from at as is are was were be been being this that these those
   research studies study treatment treatments disease diseases health clinical care patient patients
   using use uses used investigate investigates investigating explore explores exploring understand
   understands understanding development developing developed novel new potential role roles related
   associated impact effects effect approach approaches mechanism mechanisms mechanistic analysis analyses
   into intervention interventions outcome outcomes management their its lab laboratory focuses focus
   including include includes among between across various different specific particular current
   project summary aim aims aim1 aim2 aim3 abstract overall long term`.split(/\s+/),
);

function significantWords(text: string): Set<string> {
  const words = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  return new Set(words);
}

function grantVocabulary(grants: any[]): Set<string> {
  const vocab = new Set<string>();
  for (const g of grants || []) {
    const title = typeof g === 'string' ? g : g?.title || '';
    const abstract = typeof g === 'string' ? '' : g?.abstract || '';
    for (const w of significantWords(`${title} ${abstract}`)) vocab.add(w);
  }
  return vocab;
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

  const rows = await entities
    .find({
      archived: { $ne: true },
      studentVisibilityTier: 'student_ready',
    })
    .project({
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      departments: 1,
      researchAreas: 1,
      fullDescription: 1,
      recentGrants: 1,
    })
    .toArray();

  const templateMatches = (rows as any[]).filter((e) =>
    TEMPLATE_PATTERNS.some((re) => re.test(String(e.fullDescription || ''))),
  );
  console.log(`\nstudent_ready total: ${rows.length}`);
  console.log(`template-phrase-matching descriptions: ${templateMatches.length}`);

  const withGrants = templateMatches.filter((e) => Array.isArray(e.recentGrants) && e.recentGrants.length > 0);
  console.log(`...of those, with at least one recentGrants entry (judgeable): ${withGrants.length}`);

  const incoherent: any[] = [];
  for (const e of withGrants) {
    const gVocab = grantVocabulary(e.recentGrants);
    if (gVocab.size === 0) continue;
    const descVocab = significantWords(e.fullDescription);
    const areasVocab = significantWords((e.researchAreas || []).join(' '));
    const combinedServedVocab = new Set([...descVocab, ...areasVocab]);
    let overlap = 0;
    for (const w of combinedServedVocab) if (gVocab.has(w)) overlap++;
    if (overlap === 0 && combinedServedVocab.size > 0) {
      incoherent.push({ e, gVocab: [...gVocab], servedVocab: [...combinedServedVocab] });
    }
  }

  console.log(`\nzero-vocabulary-overlap candidates (own recentGrants share NOT ONE significant word with served areas+description): ${incoherent.length}`);
  for (const { e, gVocab, servedVocab } of incoherent) {
    console.log(`\n--- ${e.slug} (${e.name || e.displayName}) depts=[${(e.departments || []).join(', ')}] ---`);
    console.log(`grant titles: ${JSON.stringify((e.recentGrants || []).map((g: any) => (typeof g === 'string' ? g : g.title)))}`);
    console.log(`areas: ${JSON.stringify(e.researchAreas)}`);
    console.log(`desc: ${String(e.fullDescription || '').slice(0, 260)}`);
    console.log(`grant vocab sample: ${gVocab.slice(0, 12).join(', ')}`);
    console.log(`served vocab sample: ${servedVocab.slice(0, 12).join(', ')}`);
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
