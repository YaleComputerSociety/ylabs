import assert from 'assert/strict';
import test from 'node:test';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../../server/src/scrapers/researchAreaCanonicalization';
import {
  buildApprovedTaxonomyTermSeedRows,
  buildCandidateTaxonomyTermSeedRows,
  simulateResearchAreaCollapse,
} from '../taxonomyTermSeedCore';
import {
  parseTaxonomyTermSeedArgs,
  assertTaxonomyTermSeedApplyAllowed,
} from '../seedTaxonomyTerms';

const groundTruth = [
  { name: 'Artificial Intelligence' },
  { name: 'Machine Learning' },
  { name: '  Machine Learning ' },
];
const aliasMap = { 'Artificial Intelligence': ['AI', 'ai', 'Artificial Intelligence'] };

test('buildApprovedTaxonomyTermSeedRows dedupes by normalized label and marks APPROVED', () => {
  const rows = buildApprovedTaxonomyTermSeedRows(groundTruth, aliasMap);
  assert.equal(rows.length, 2);
  const ai = rows.find((row) => row.normalizedLabel === 'artificial intelligence');
  assert.ok(ai);
  assert.equal(ai.kind, 'TOPIC');
  assert.equal(ai.reviewStatus, 'APPROVED');
  assert.equal(ai.status, 'ACTIVE');
  assert.equal(ai.archived, false);
  assert.equal(ai.schemaVersion, 1);
  assert.deepEqual(ai.aliases, ['AI']);
});

test('buildCandidateTaxonomyTermSeedRows marks UNREVIEWED and skips approved labels', () => {
  const rows = buildCandidateTaxonomyTermSeedRows(
    ['Basket Weaving', 'basket weaving', 'Machine Learning'],
    new Set(['machine learning']),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Basket Weaving');
  assert.equal(rows[0].reviewStatus, 'UNREVIEWED');
  assert.deepEqual(rows[0].aliases, []);
});

test('simulateResearchAreaCollapse reports the distinct collapse, leakage, and candidates', () => {
  const approved = buildApprovedTaxonomyTermSeedRows(groundTruth, aliasMap);
  const canonicalizer = createResearchAreaCanonicalizer(
    buildResearchAreaResolverIndex(approved.map((row) => ({ name: row.label, aliases: row.aliases }))),
  );
  const sim = simulateResearchAreaCollapse(canonicalizer, [
    ['AI', 'Research Areas:'],
    ['machine learning', 'Basket Weaving'],
    ['Theorist'],
  ]);
  assert.equal(sim.entitiesConsidered, 3);
  assert.equal(sim.entitiesWithAreas, 3);
  assert.equal(sim.distinctRawAreasBefore, 5);
  assert.equal(sim.distinctCanonicalAreasAfter, 3);
  assert.equal(sim.distinctFallThroughToRaw, 1);
  assert.equal(sim.distinctLeakageDropped, 2);
  assert.equal(sim.leakageDroppedOccurrences, 2);
  assert.equal(sim.entitiesWithCanonicalizedAreaChange, 3);
  assert.deepEqual(sim.candidateLabels, ['Basket Weaving']);
});

test('parseTaxonomyTermSeedArgs defaults to dry-run with candidates', () => {
  const options = parseTaxonomyTermSeedArgs([]);
  assert.equal(options.apply, false);
  assert.equal(options.includeCandidates, true);

  const applied = parseTaxonomyTermSeedArgs(['--apply', '--confirm-seed-apply', '--approved-only']);
  assert.equal(applied.apply, true);
  assert.equal(applied.confirmSeedApply, true);
  assert.equal(applied.includeCandidates, false);

  assert.throws(() => parseTaxonomyTermSeedArgs(['--nope']), /Unknown taxonomy-term seed argument/);
});

test('assertTaxonomyTermSeedApplyAllowed requires confirmation before an apply', () => {
  assert.throws(
    () => assertTaxonomyTermSeedApplyAllowed({ apply: true }),
    /--confirm-seed-apply is required/,
  );
});
