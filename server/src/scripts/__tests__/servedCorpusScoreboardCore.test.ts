import { describe, expect, it } from 'vitest';
import fs from 'fs';
import mongoose from 'mongoose';
import { researchEntityHasDeceasedLead } from '../../utils/researchEntityDeceasedLead';
import { researchEntityServesPublicDetail } from '../../services/researchEntityPublicDescription';
import {
  assertServedCorpusScoreboardConsistent,
  buildServedCorpusScoreboard,
  compareServedRowAgainstBaseline,
  formatServedCorpusScoreboardDetail,
  formatServedCorpusScoreboardTable,
  indexServedRowsBySlug,
  loadServedCorpusBaseline,
  parseServedCorpusScoreboardArgs,
  renderServedResearchEntity,
  SERVED_CORPUS_SCOREBOARD_ENVIRONMENTS,
  type ServedCorpusBaselineEntry,
  type ServedResearchEntityRow,
} from '../servedCorpusScoreboardCore';

const baselineEntry = (
  overrides: Partial<ServedCorpusBaselineEntry> = {},
): ServedCorpusBaselineEntry => ({
  slug: 'synthetic-lab-alpha',
  name: 'Synthetic Alpha Lab',
  shortDescription: 'Studies synthetic materials.',
  fullDescription: 'The Synthetic Alpha Lab studies synthetic materials.',
  websiteUrl: 'https://example.invalid/alpha',
  researchAreas: ['Materials', 'Synthesis'],
  ...overrides,
});

const servedRow = (overrides: Partial<ServedResearchEntityRow> = {}): ServedResearchEntityRow => ({
  slug: 'synthetic-lab-alpha',
  name: 'Synthetic Alpha Lab',
  shortDescription: 'Studies synthetic materials.',
  fullDescription: 'The Synthetic Alpha Lab studies synthetic materials.',
  websiteUrl: 'https://example.invalid/alpha',
  researchAreas: ['Materials', 'Synthesis'],
  tier: 'student_ready',
  archived: false,
  serveTimeHoldback: false,
  served: true,
  prePassDivergent: false,
  ...overrides,
});

describe('parseServedCorpusScoreboardArgs', () => {
  it('defaults to all three environments', () => {
    const options = parseServedCorpusScoreboardArgs(['--baseline', '/tmp/baseline.json']);
    expect(options.environments).toEqual([...SERVED_CORPUS_SCOREBOARD_ENVIRONMENTS]);
    expect(options.baselinePath).toBe('/tmp/baseline.json');
  });

  it('requires a baseline because the comparison is paired by slug', () => {
    expect(() => parseServedCorpusScoreboardArgs([])).toThrow(/--baseline is required/);
  });

  it('collects repeated environments once, in the order given', () => {
    const options = parseServedCorpusScoreboardArgs([
      '--baseline',
      '/tmp/baseline.json',
      '--environment',
      'beta',
      '--environment',
      'development',
      '--environment',
      'beta',
    ]);
    expect(options.environments).toEqual(['beta', 'development']);
  });

  it('refuses an operator environment this scoreboard cannot read', () => {
    expect(() =>
      parseServedCorpusScoreboardArgs([
        '--baseline',
        '/tmp/baseline.json',
        '--environment',
        'production-copy',
      ]),
    ).toThrow(/development, beta, or production/);
  });

  it('refuses an unknown argument rather than ignoring it', () => {
    expect(() =>
      parseServedCorpusScoreboardArgs(['--baseline', '/tmp/baseline.json', '--sample', '10']),
    ).toThrow(/Unknown argument "--sample"/);
  });

  it('refuses a non-numeric text limit', () => {
    expect(() =>
      parseServedCorpusScoreboardArgs(['--baseline', '/tmp/baseline.json', '--text-limit', 'all']),
    ).toThrow(/non-negative integer/);
  });
});

describe('loadServedCorpusBaseline', () => {
  it('reads a well-formed baseline', () => {
    const entries = loadServedCorpusBaseline(JSON.stringify([baselineEntry()]));
    expect(entries).toHaveLength(1);
    expect(entries[0].researchAreas).toEqual(['Materials', 'Synthesis']);
  });

  it('refuses a duplicate slug, which would double-count a paired comparison', () => {
    expect(() =>
      loadServedCorpusBaseline(JSON.stringify([baselineEntry(), baselineEntry()])),
    ).toThrow(/appears more than once/);
  });

  it('refuses a missing compared field rather than reading it as a change on every row', () => {
    const entry = baselineEntry() as unknown as Record<string, unknown>;
    delete entry.shortDescription;
    expect(() => loadServedCorpusBaseline(JSON.stringify([entry]))).toThrow(
      /missing string field "shortDescription"/,
    );
  });

  it('refuses an empty array and non-JSON input', () => {
    expect(() => loadServedCorpusBaseline('[]')).toThrow(/non-empty JSON array/);
    expect(() => loadServedCorpusBaseline('not json')).toThrow(/not valid JSON/);
  });
});

const SERVABLE_FULL_DESCRIPTION =
  'The Synthetic Alpha Lab studies synthetic materials and their mechanical properties, combining polymer chemistry with computational modelling to design coatings that resist wear. Undergraduates contribute to sample preparation, mechanical testing, and data analysis across several ongoing projects.';

const servableStoredDocument = (overrides: Record<string, any> = {}): Record<string, any> => ({
  slug: 'synthetic-lab-alpha',
  name: 'Synthetic Alpha Lab',
  kind: 'lab',
  entityType: 'LAB',
  shortDescription: 'Studies synthetic materials and their mechanical properties.',
  fullDescription: SERVABLE_FULL_DESCRIPTION,
  researchAreas: ['Materials'],
  sourceUrls: ['https://example.invalid/alpha'],
  websiteUrl: 'https://example.invalid/alpha',
  studentVisibilityTier: 'student_ready',
  archived: false,
  ...overrides,
});

describe('renderServedResearchEntity', () => {
  it('serves stored copy that the serve path keeps', () => {
    const row = renderServedResearchEntity(servableStoredDocument());

    expect(row.fullDescription).toBe(SERVABLE_FULL_DESCRIPTION);
    expect(row.researchAreas).toEqual(['Materials']);
    expect(row.serveTimeHoldback).toBe(false);
    expect(row.served).toBe(true);
    expect(row.tier).toBe('student_ready');
  });

  it('holds back a student_ready row whose served copy fails the public-description invariant', () => {
    const thin = servableStoredDocument({
      slug: 'synthetic-lab-zeta',
      shortDescription: 'Studies things.',
      fullDescription: 'A lab.',
    });
    const row = renderServedResearchEntity(thin);

    expect(researchEntityServesPublicDetail(thin)).toBe(false);
    expect(row.tier).toBe('student_ready');
    expect(row.archived).toBe(false);
    expect(row.serveTimeHoldback).toBe(true);
    expect(row.served).toBe(false);
  });

  it('measures what the serve path withholds, not what the document stores', () => {
    const stored = {
      slug: 'synthetic-lab-beta',
      name: 'Synthetic Beta Lab',
      kind: 'lab',
      shortDescription: 'Studies synthetic optics.',
      fullDescription: 'Reach the Synthetic Beta Lab at contact@example.invalid for details.',
      researchAreas: ['Optics'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    };
    const row = renderServedResearchEntity(stored);

    expect(stored.fullDescription).toContain('contact@example.invalid');
    expect(row.fullDescription).toBe('');
    expect(row.shortDescription).toBe('Studies synthetic optics.');
  });

  it('treats an archived or non-student_ready row as no longer served', () => {
    const archived = renderServedResearchEntity({
      slug: 'synthetic-lab-gamma',
      name: 'Synthetic Gamma Lab',
      studentVisibilityTier: 'student_ready',
      archived: true,
    });
    expect(archived.served).toBe(false);
    expect(archived.archived).toBe(true);

    const held = renderServedResearchEntity({
      slug: 'synthetic-lab-delta',
      name: 'Synthetic Delta Lab',
      studentVisibilityTier: 'operator_review',
    });
    expect(held.served).toBe(false);
    expect(held.tier).toBe('operator_review');
  });

  it('does not call a student_ready row served when the detail route holds it back', () => {
    const stored = servableStoredDocument({
      slug: 'synthetic-lab-epsilon',
      name: 'Synthetic Epsilon Lab',
      shortDescription: 'Studies synthetic polymers.',
      fullDescription: `Ada Synthetic (1930-2001) founded the lab. ${SERVABLE_FULL_DESCRIPTION}`,
      researchAreas: ['Polymers'],
    });
    const row = renderServedResearchEntity(stored);

    expect(researchEntityHasDeceasedLead(stored)).toBe(true);
    expect(row.serveTimeHoldback).toBe(true);
    expect(row.tier).toBe('student_ready');
    expect(row.archived).toBe(false);
    expect(row.served).toBe(false);
  });
});

describe('indexServedRowsBySlug', () => {
  it('refuses two documents serving one slug', () => {
    expect(() => indexServedRowsBySlug([servedRow(), servedRow()])).toThrow(
      /Two stored documents serve slug/,
    );
  });
});

describe('compareServedRowAgainstBaseline', () => {
  it('reports an absent slug without inventing a change', () => {
    const comparison = compareServedRowAgainstBaseline(baselineEntry(), undefined);
    expect(comparison).toEqual({
      slug: 'synthetic-lab-alpha',
      present: false,
      served: false,
      changes: [],
    });
  });

  it('reports no change when the served copy matches the baseline', () => {
    expect(compareServedRowAgainstBaseline(baselineEntry(), servedRow()).changes).toEqual([]);
  });

  it('names each changed field and carries both texts', () => {
    const comparison = compareServedRowAgainstBaseline(
      baselineEntry(),
      servedRow({ shortDescription: 'Studies synthetic ceramics.', websiteUrl: '' }),
    );
    expect(comparison.changes.map((change) => change.field)).toEqual([
      'shortDescription',
      'websiteUrl',
    ]);
    expect(comparison.changes[0].baseline).toBe('Studies synthetic materials.');
    expect(comparison.changes[0].served).toBe('Studies synthetic ceramics.');
    expect(comparison.changes[0].cosmeticOnly).toBe(false);
  });

  it('marks a whitespace-only difference cosmetic instead of counting it as progress', () => {
    const comparison = compareServedRowAgainstBaseline(
      baselineEntry(),
      servedRow({ shortDescription: '  Studies   synthetic materials.  ' }),
    );
    expect(comparison.changes).toHaveLength(1);
    expect(comparison.changes[0].cosmeticOnly).toBe(true);
  });

  it('marks a reordered research-area list cosmetic', () => {
    const comparison = compareServedRowAgainstBaseline(
      baselineEntry(),
      servedRow({ researchAreas: ['Synthesis', 'Materials'] }),
    );
    expect(comparison.changes).toHaveLength(1);
    expect(comparison.changes[0].field).toBe('researchAreas');
    expect(comparison.changes[0].cosmeticOnly).toBe(true);
  });
});

const scoreboardFixture = () =>
  buildServedCorpusScoreboard({
    environment: 'beta',
    databaseName: 'Beta',
    corpus: { researchEntities: 10, studentReadyNotArchived: 6 },
    baseline: [
      baselineEntry(),
      baselineEntry({ slug: 'synthetic-lab-beta' }),
      baselineEntry({ slug: 'synthetic-lab-gamma' }),
      baselineEntry({ slug: 'synthetic-lab-delta' }),
    ],
    rows: [
      servedRow({ shortDescription: 'Studies synthetic ceramics.' }),
      servedRow({ slug: 'synthetic-lab-beta' }),
      servedRow({
        slug: 'synthetic-lab-gamma',
        tier: 'operator_review',
        served: false,
        shortDescription: 'Studies something else entirely.',
      }),
    ],
  });

describe('buildServedCorpusScoreboard', () => {
  it('partitions the baseline into absent, no longer served, changed, and unchanged', () => {
    const scoreboard = scoreboardFixture();
    expect(scoreboard.baseline).toMatchObject({
      slugs: 4,
      present: 3,
      absent: 1,
      stillServed: 2,
      heldBackAtServeTime: 0,
      noLongerServed: 1,
      changed: 1,
      unchangedStillServed: 1,
    });
    expect(scoreboard.absentSlugs).toEqual(['synthetic-lab-delta']);
    expect(scoreboard.noLongerServedRows).toEqual([
      { slug: 'synthetic-lab-gamma', tier: 'operator_review', archived: false },
    ]);
  });

  it('counts a serve-time holdback separately from a tier or archived change', () => {
    const scoreboard = buildServedCorpusScoreboard({
      environment: 'beta',
      databaseName: 'Beta',
      corpus: { researchEntities: 4, studentReadyNotArchived: 3 },
      baseline: [baselineEntry(), baselineEntry({ slug: 'synthetic-lab-epsilon' })],
      rows: [
        servedRow(),
        servedRow({
          slug: 'synthetic-lab-epsilon',
          shortDescription: 'Studies synthetic polymers.',
          serveTimeHoldback: true,
          served: false,
        }),
      ],
    });

    expect(scoreboard.baseline).toMatchObject({
      present: 2,
      stillServed: 1,
      heldBackAtServeTime: 1,
      noLongerServed: 0,
      changed: 0,
    });
    expect(scoreboard.heldBackAtServeTimeSlugs).toEqual(['synthetic-lab-epsilon']);
    expect(scoreboard.noLongerServedRows).toEqual([]);
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).not.toThrow();
    expect(formatServedCorpusScoreboardTable([scoreboard])).toContain('held back at serve time');
    expect(formatServedCorpusScoreboardDetail(scoreboard, 0)).toContain(
      'held back at serve time, so the detail page 404s (1)',
    );
  });

  it('counts an archived row with a serve-time holdback once, as no longer served', () => {
    const scoreboard = buildServedCorpusScoreboard({
      environment: 'beta',
      databaseName: 'Beta',
      corpus: { researchEntities: 4, studentReadyNotArchived: 1 },
      baseline: [baselineEntry()],
      rows: [servedRow({ archived: true, serveTimeHoldback: true, served: false })],
    });

    expect(scoreboard.baseline).toMatchObject({
      present: 1,
      stillServed: 0,
      heldBackAtServeTime: 0,
      noLongerServed: 1,
    });
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).not.toThrow();
  });

  it('records the served rows the next baseline can be built from', () => {
    const scoreboard = scoreboardFixture();
    expect(scoreboard.servedRows.map((row) => row.slug)).toEqual([
      'synthetic-lab-alpha',
      'synthetic-lab-beta',
      'synthetic-lab-gamma',
    ]);
    const rolledForward = loadServedCorpusBaseline(JSON.stringify(scoreboard.servedRows));
    expect(rolledForward.map((entry) => entry.slug)).toEqual(
      scoreboard.servedRows.map((row) => row.slug),
    );
    expect(rolledForward[0].shortDescription).toBe('Studies synthetic ceramics.');
  });

  it('counts a change only for a row that is still served', () => {
    const scoreboard = scoreboardFixture();
    expect(scoreboard.baseline.changedByField.shortDescription).toBe(1);
    expect(scoreboard.changedRows.map((row) => row.slug)).toEqual(['synthetic-lab-alpha']);
  });

  it('names the rows where an extra sanitize pre-pass would change the answer', () => {
    const scoreboard = buildServedCorpusScoreboard({
      environment: 'beta',
      databaseName: 'Beta',
      corpus: { researchEntities: 2, studentReadyNotArchived: 2 },
      baseline: [baselineEntry()],
      rows: [servedRow({ prePassDivergent: true })],
    });
    expect(scoreboard.servePathPrePassDivergentRows).toBe(1);
    expect(scoreboard.servePathPrePassDivergentSlugs).toEqual(['synthetic-lab-alpha']);
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).not.toThrow();
    expect(formatServedCorpusScoreboardDetail(scoreboard, 0)).toContain(
      'rows where an extra sanitize pre-pass would change the served answer (1)',
    );
  });

  it('breaks changes out by field', () => {
    const scoreboard = buildServedCorpusScoreboard({
      environment: 'development',
      databaseName: 'Development',
      corpus: { researchEntities: 5, studentReadyNotArchived: 5 },
      baseline: [baselineEntry()],
      rows: [servedRow({ name: 'Synthetic Alpha Laboratory', websiteUrl: '' })],
    });
    expect(scoreboard.baseline.changedByField).toMatchObject({
      name: 1,
      websiteUrl: 1,
      shortDescription: 0,
      fullDescription: 0,
      researchAreas: 0,
    });
    expect(scoreboard.baseline.changed).toBe(1);
  });
});

describe('assertServedCorpusScoreboardConsistent', () => {
  it('passes on a scoreboard built from its own rows', () => {
    expect(() => assertServedCorpusScoreboardConsistent(scoreboardFixture())).not.toThrow();
  });

  it('refuses a served subset larger than the served population', () => {
    const scoreboard = scoreboardFixture();
    scoreboard.corpus.studentReadyNotArchived = 1;
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).toThrow(
      /still served \(2\) exceeds the served population \(1\)/,
    );
  });

  it('refuses a served population larger than the corpus', () => {
    const scoreboard = scoreboardFixture();
    scoreboard.corpus.researchEntities = 3;
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).toThrow(
      /student_ready and not archived \(6\) exceeds research_entities \(3\)/,
    );
  });

  it('refuses a partition whose parts do not sum to the whole', () => {
    const absent = scoreboardFixture();
    absent.baseline.absent = 0;
    expect(() => assertServedCorpusScoreboardConsistent(absent)).toThrow(
      /does not equal baseline slugs/,
    );

    const served = scoreboardFixture();
    served.baseline.noLongerServed = 5;
    expect(() => assertServedCorpusScoreboardConsistent(served)).toThrow(/does not equal present/);

    const changed = scoreboardFixture();
    changed.baseline.unchangedStillServed = 4;
    expect(() => assertServedCorpusScoreboardConsistent(changed)).toThrow(
      /does not equal still served/,
    );
  });

  it('refuses a per-field count larger than the changed-row count', () => {
    const scoreboard = scoreboardFixture();
    scoreboard.baseline.changedByField.fullDescription = 9;
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).toThrow(
      /fullDescription changed \(9\) exceeds changed rows \(1\)/,
    );
  });

  it('refuses a pre-pass divergence list that disagrees with its own count', () => {
    const scoreboard = scoreboardFixture();
    scoreboard.servePathPrePassDivergentRows = 2;
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).toThrow(
      /pre-pass divergent list \(0\) does not match its count \(2\)/,
    );
  });

  it('refuses a detail list that disagrees with its own count', () => {
    const scoreboard = scoreboardFixture();
    scoreboard.baseline.changed = 2;
    scoreboard.baseline.unchangedStillServed = 0;
    expect(() => assertServedCorpusScoreboardConsistent(scoreboard)).toThrow(
      /changed-row list \(1\) does not match the changed count \(2\)/,
    );
  });
});

describe('the report emits served text, not only counts', () => {
  it('prints the baseline and served copy of every changed field', () => {
    const detail = formatServedCorpusScoreboardDetail(scoreboardFixture(), 0);
    expect(detail).toContain('Studies synthetic materials.');
    expect(detail).toContain('Studies synthetic ceramics.');
    expect(detail).toContain('synthetic-lab-gamma [tier=operator_review, archived=false]');
    expect(detail).toContain('absent from this environment (1)');
  });

  it('marks truncated text and names where the full text is', () => {
    const scoreboard = buildServedCorpusScoreboard({
      environment: 'beta',
      databaseName: 'Beta',
      corpus: { researchEntities: 2, studentReadyNotArchived: 2 },
      baseline: [baselineEntry()],
      rows: [servedRow({ fullDescription: 'x'.repeat(80) })],
    });
    const detail = formatServedCorpusScoreboardDetail(scoreboard, 20);
    expect(detail).toContain('[+60 chars, full text in the --output artifact]');
  });

  it('puts every environment in one table', () => {
    const table = formatServedCorpusScoreboardTable([scoreboardFixture()]);
    expect(table).toContain('beta');
    expect(table).toContain('research_entities');
    expect(table).toContain('unchanged and still served');
  });
});

describe('the scoreboard never opens a Mongoose connection', () => {
  // Importing the serve path transitively registers the TaxonomyTerm model
  // (researchEntityDescriptionText -> researchAreaDomainCoherence ->
  // researchAreaCanonicalization -> models/taxonomyTerm), which cannot be
  // avoided without splitting that module. Registration alone is inert: it is
  // the Mongoose CONNECTION that builds indexes and so recreates a dropped
  // collection. Adding mongoose.connect here would recreate taxonomy_terms on
  // whichever environment the scoreboard reads, so both facts are pinned.
  it('registers a model but leaves the connection closed after import', async () => {
    await import('../servedCorpusScoreboard');
    expect(mongoose.modelNames()).toContain('TaxonomyTerm');
    expect(mongoose.connection.readyState).toBe(0);
  });

  // The check above only covers import time. A `mongoose.connect` added inside
  // `main()` would leave it green and still recreate taxonomy_terms on the
  // environment being read, so the import list is pinned too. Matched on import
  // statements rather than the whole file, so prose about Mongoose stays free.
  it('imports the raw driver and imports mongoose nowhere', () => {
    const source = fs.readFileSync(
      new URL('../servedCorpusScoreboard.ts', import.meta.url),
      'utf8',
    );
    const importedModules = [...source.matchAll(/^import[^;]*?from\s*'([^']+)';$/gm)].map(
      (match) => match[1],
    );
    expect(importedModules).toContain('mongodb');
    expect(importedModules).not.toContain('mongoose');
  });
});
