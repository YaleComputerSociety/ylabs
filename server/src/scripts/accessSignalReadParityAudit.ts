import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import {
  canonicalAcceptanceLevelFromSignals,
  legacyAcceptanceLevelFromEntity,
  type AccessAcceptanceLevel,
} from './accessSignalReadParityCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EXPECTED_DEV_DB_NAMES = new Set(['Development', 'development']);
const MAX_EXAMPLES_PER_CELL = 8;

interface ParityRow {
  entityId: string;
  slug: string;
  name: string;
  legacy: AccessAcceptanceLevel;
  canonical: AccessAcceptanceLevel;
  acceptingUndergrads?: boolean;
  acceptanceConfidence?: number;
  offersIndependentStudy?: boolean;
  currentUndergradCount?: number;
  openness?: string;
  positiveSignalTypes: string[];
}

const LEVELS: AccessAcceptanceLevel[] = ['verified', 'likely', 'none'];

function assertDevelopmentTarget(): void {
  const dbName = mongoose.connection.name;
  if (!dbName || !EXPECTED_DEV_DB_NAMES.has(dbName)) {
    throw new Error(
      `Refusing to run parity audit against database "${dbName}". ` +
        'This read-only audit only runs against Development.',
    );
  }
}

async function loadAccessSignalTypesByEntity(): Promise<Map<string, string[]>> {
  const byEntity = new Map<string, string[]>();
  const cursor = Signal.find({
    type: { $in: accessSignalTypes },
    archived: { $ne: true },
  })
    .select('researchEntityId type confidence confidenceScore')
    .lean()
    .cursor();

  for await (const signal of cursor as any) {
    const key = String(signal.researchEntityId);
    const existing = byEntity.get(key) || [];
    existing.push(
      JSON.stringify({
        type: signal.type,
        confidence: signal.confidence,
        confidenceScore: signal.confidenceScore,
      }),
    );
    byEntity.set(key, existing);
  }

  return byEntity;
}

async function run(): Promise<void> {
  await initializeConnections();
  assertDevelopmentTarget();

  const signalsByEntity = await loadAccessSignalTypesByEntity();

  const rows: ParityRow[] = [];
  const cursor = ResearchEntity.find({ archived: { $ne: true } })
    .select(
      '_id slug name acceptingUndergrads acceptanceConfidence offersIndependentStudy ' +
        'currentUndergradCount openness',
    )
    .lean()
    .cursor();

  for await (const entity of cursor as any) {
    const key = String(entity._id);
    const rawSignals = (signalsByEntity.get(key) || []).map((s) => JSON.parse(s));
    const canonical = canonicalAcceptanceLevelFromSignals(rawSignals);
    const legacy = legacyAcceptanceLevelFromEntity(entity);
    rows.push({
      entityId: key,
      slug: String(entity.slug || ''),
      name: String(entity.name || ''),
      legacy,
      canonical,
      acceptingUndergrads: entity.acceptingUndergrads,
      acceptanceConfidence: entity.acceptanceConfidence,
      offersIndependentStudy: entity.offersIndependentStudy,
      currentUndergradCount: entity.currentUndergradCount,
      openness: entity.openness,
      positiveSignalTypes: rawSignals
        .filter((s: any) => s.type !== 'NOT_CURRENTLY_AVAILABLE' && s.type !== 'NO_EVIDENCE')
        .map((s: any) => s.type),
    });
  }

  reportParity(rows);

  await mongoose.disconnect();
}

function reportParity(rows: ParityRow[]): void {
  const total = rows.length;
  const matrix = new Map<string, ParityRow[]>();
  for (const legacy of LEVELS) {
    for (const canonical of LEVELS) {
      matrix.set(`${legacy}|${canonical}`, []);
    }
  }
  for (const row of rows) {
    matrix.get(`${row.legacy}|${row.canonical}`)!.push(row);
  }

  const cell = (legacy: AccessAcceptanceLevel, canonical: AccessAcceptanceLevel): number =>
    matrix.get(`${legacy}|${canonical}`)!.length;

  const agree = LEVELS.reduce((sum, level) => sum + cell(level, level), 0);
  const disagree = total - agree;

  console.log('='.repeat(72));
  console.log('ACCESS READ PARITY AUDIT: legacy stored fields vs canonical Signal');
  console.log(`Database: ${mongoose.connection.name}`);
  console.log(`Non-archived research entities: ${total}`);
  console.log('='.repeat(72));

  console.log('\nConfusion matrix (rows = legacy, cols = canonical):');
  console.log(['legacy\\canon'.padEnd(14), ...LEVELS.map((l) => l.padStart(10))].join(''));
  for (const legacy of LEVELS) {
    const cells = LEVELS.map((canonical) => String(cell(legacy, canonical)).padStart(10));
    console.log([legacy.padEnd(14), ...cells].join(''));
  }

  console.log('\nLevel distribution:');
  for (const level of LEVELS) {
    const legacyCount = LEVELS.reduce((sum, c) => sum + cell(level, c), 0);
    const canonCount = LEVELS.reduce((sum, l) => sum + cell(l, level), 0);
    console.log(`  ${level.padEnd(8)} legacy=${legacyCount}  canonical=${canonCount}`);
  }

  const anyLegacyFieldSet = rows.filter(
    (row) =>
      typeof row.acceptingUndergrads === 'boolean' ||
      (row.acceptanceConfidence ?? 0) > 0 ||
      row.offersIndependentStudy === true ||
      (row.currentUndergradCount ?? 0) > 0,
  ).length;
  const anyPositiveSignal = rows.filter((row) => row.positiveSignalTypes.length > 0).length;
  console.log('\nCorpus coverage:');
  console.log(`  entities with any legacy access field set: ${anyLegacyFieldSet}`);
  console.log(`  entities with any positive canonical Signal: ${anyPositiveSignal}`);

  const legacyLikelyOrVerified = LEVELS.filter((l) => l !== 'none').reduce(
    (sum, legacy) => sum + LEVELS.reduce((s, c) => s + cell(legacy, c), 0),
    0,
  );
  const canonLikelyOrVerified = LEVELS.filter((l) => l !== 'none').reduce(
    (sum, canonical) => sum + LEVELS.reduce((s, l) => s + cell(l, canonical), 0),
    0,
  );
  console.log('\nTrust-filter set membership (what verified-or-likely returns):');
  console.log(`  legacy verified-or-likely: ${legacyLikelyOrVerified}`);
  console.log(`  canonical verified-or-likely: ${canonLikelyOrVerified}`);

  const agreementPct = total === 0 ? 100 : (agree / total) * 100;
  console.log(
    `\nAgreement: ${agree}/${total} (${agreementPct.toFixed(2)}%)  Disagreements: ${disagree}`,
  );
  console.log(`PARITY: ${disagree === 0 ? 'CLEAN' : 'NOT CLEAN'}`);

  if (disagree === 0) return;

  console.log(
    '\nDisagreement examples (up to ' + MAX_EXAMPLES_PER_CELL + ' per off-diagonal cell):',
  );
  for (const legacy of LEVELS) {
    for (const canonical of LEVELS) {
      if (legacy === canonical) continue;
      const examples = matrix.get(`${legacy}|${canonical}`)!;
      if (examples.length === 0) continue;
      console.log(`\n  legacy=${legacy} -> canonical=${canonical}  (${examples.length} entities)`);
      for (const row of examples.slice(0, MAX_EXAMPLES_PER_CELL)) {
        console.log(
          `    - ${row.slug || row.entityId} | ` +
            `acceptingUndergrads=${row.acceptingUndergrads} ` +
            `acceptanceConfidence=${row.acceptanceConfidence} ` +
            `offersIndependentStudy=${row.offersIndependentStudy} ` +
            `currentUndergradCount=${row.currentUndergradCount} ` +
            `openness=${row.openness} | ` +
            `positiveSignals=[${row.positiveSignalTypes.join(',')}]`,
        );
      }
    }
  }
}

run().catch((error) => {
  console.error('access:read-parity-audit failed:', error);
  process.exitCode = 1;
  void mongoose.disconnect();
});
