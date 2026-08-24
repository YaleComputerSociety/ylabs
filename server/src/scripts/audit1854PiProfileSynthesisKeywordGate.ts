import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { sanitizeResearchEntityPublicDescriptionFields } from '../utils/researchEntityDescriptionText';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEARCH_HINT =
  /\b(?:research|lab|laboratory|study|studies|studying|investigate|investigates|investigated|explore|explores|focus|focuses|focusing|works?\s+on|conducts|uses|develops|examines|examining|analysis|method|methods|model|models|projects?|theory|algorithm|algorithms|approach|approaches|data|paper|papers?|publications?)\b/i;

const DESCRIPTION_FIELDS = [
  'shortDescription',
  'fullDescription',
  'profileSynthesisDescription',
] as const;

interface Row {
  slug: string;
  entityType?: string;
  tier?: string;
  field: string;
  storedLength: number;
  observationLength: number | null;
  firstHintOffsetInObservation: number | null;
  observationHasHint: boolean;
}

async function main(): Promise<void> {
  await initializeConnections();
  try {
    const docs = await ResearchEntity.find(
      { descriptionSource: 'PI_PROFILE_SYNTHESIS', archived: { $ne: true } },
      {
        _id: 1,
        slug: 1,
        entityType: 1,
        studentVisibilityTier: 1,
        descriptionSource: 1,
        shortDescription: 1,
        fullDescription: 1,
        profileSynthesisDescription: 1,
        name: 1,
        displayName: 1,
        kind: 1,
      },
    ).lean();

    console.log(`PI_PROFILE_SYNTHESIS non-archived entities: ${docs.length}`);

    const blankedRows: Row[] = [];
    const truncationVictims: Row[] = [];

    for (const doc of docs as any[]) {
      const served = sanitizeResearchEntityPublicDescriptionFields(doc, []);
      for (const field of DESCRIPTION_FIELDS) {
        const stored = typeof doc[field] === 'string' ? doc[field].trim() : '';
        const servedValue = typeof served[field] === 'string' ? served[field].trim() : '';
        if (!stored || servedValue) continue;
        if (RESEARCH_HINT.test(stored)) continue;

        const observations = await Observation.find(
          { entityKey: doc.slug, field },
          { value: 1, sourceKey: 1, observedAt: 1 },
        )
          .sort({ observedAt: -1 })
          .limit(20)
          .lean();
        const longest = (observations as any[])
          .map((observation) => (typeof observation.value === 'string' ? observation.value : ''))
          .reduce((best, value) => (value.length > best.length ? value : best), '');
        const hintMatch = longest ? longest.match(RESEARCH_HINT) : null;
        const row: Row = {
          slug: doc.slug,
          entityType: doc.entityType,
          tier: doc.studentVisibilityTier,
          field,
          storedLength: stored.length,
          observationLength: longest ? longest.length : null,
          firstHintOffsetInObservation: hintMatch ? (hintMatch.index ?? null) : null,
          observationHasHint: Boolean(hintMatch),
        };
        blankedRows.push(row);
        if (row.observationHasHint && (row.firstHintOffsetInObservation ?? 0) >= row.storedLength) {
          truncationVictims.push(row);
        }
      }
    }

    const describe = (row: Row) =>
      `  ${row.slug} [${row.entityType}/${row.tier}] ${row.field} stored=${row.storedLength} obs=${row.observationLength} hintAt=${row.firstHintOffsetInObservation}`;

    console.log(`\nblank-on-no-keyword served fields: ${blankedRows.length}`);
    for (const row of blankedRows) console.log(describe(row));

    console.log(`\ntruncation-past-keyword candidates: ${truncationVictims.length}`);
    for (const row of truncationVictims) console.log(describe(row));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
