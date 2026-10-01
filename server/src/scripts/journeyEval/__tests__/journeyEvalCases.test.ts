import { describe, expect, it } from 'vitest';
import { journeyCases, type JourneyEvalContext } from '../journeyEvalCases';
import type { CorpusFingerprint } from '../journeyEvalMetrics';

const observedAt = '2026-09-30T12:00:00.000Z';
const steadyCorpus: CorpusFingerprint = { rowCount: 2, latestUpdatedAt: observedAt };
const meshProfileProvenance = {
  researchAreas: { sourceUrl: 'https://medicine.yale.edu/profile/synthetic-profile/' },
};

interface SyntheticRow {
  slug: string;
  storedAreas: string[];
  servedAreas: string[];
  fieldProvenance?: unknown;
}

const coherentRow = (row: SyntheticRow) => ({
  slug: row.slug,
  name: 'Synthetic Membrane Transport Laboratory',
  departments: ['Cellular and Molecular Physiology'],
  shortDescription: 'Studies membrane transport proteins and ion channel physiology.',
  fullDescription:
    'The laboratory studies membrane transport proteins, ion channel gating, and epithelial physiology using electrophysiology.',
  researchAreas: row.storedAreas,
  fieldProvenance: row.fieldProvenance,
  lastObservedAt: observedAt,
});

function syntheticContext(rows: SyntheticRow[]): JourneyEvalContext {
  const stored = new Map(rows.map((row) => [row.slug, coherentRow(row)]));
  return {
    browse: async () => ({
      researchEntities: rows.map((row) => ({
        slug: row.slug,
        researchAreas: row.servedAreas,
        lastObservedAt: observedAt,
      })),
    }),
    readStoredRows: async (keys) =>
      new Map(keys.flatMap((key) => (stored.has(key) ? [[key, stored.get(key)!]] : []))),
    readCorpusFingerprint: async () => steadyCorpus,
    readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
    topicQueryJudgements: null,
    window: rows.length,
    facetValuesChecked: 0,
    pagesChecked: 1,
  };
}

const topicDropCase = journeyCases.find((candidate) => candidate.id === 'topic-drop-attribution')!;

async function invariantStatuses(rows: SyntheticRow[]) {
  const outcome = await topicDropCase.run(syntheticContext(rows));
  return Object.fromEntries(outcome.invariants.map((invariant) => [invariant.id, invariant]));
}

describe('topic-drop-attribution case', () => {
  it('attributes a drop of only place names to the MeSH geographic guard', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-place-drop',
        storedAreas: ['Ion Channels', 'China', 'Membrane Transport Proteins', 'Connecticut'],
        servedAreas: ['Ion Channels', 'Membrane Transport Proteins'],
        fieldProvenance: meshProfileProvenance,
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'pass',
      detail: { dropped: 1, attributedToGuard: 1, unexplained: 0 },
    });
  });

  it('attributes a prose-length chip the served copy withholds to the prose-chip filter', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-prose-chip-drop',
        storedAreas: [
          'Ion Channels',
          'Synthetic Interdisciplinary Training Program in Membrane Transport Biology (SITPMTB)',
        ],
        servedAreas: ['Ion Channels'],
        fieldProvenance: {
          researchAreas: { sourceUrl: 'https://physiology.example.edu/research/' },
        },
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'pass',
      detail: {
        dropped: 1,
        attributedToGuard: 1,
        unexplained: 0,
        drops: [{ attributed: true, withheldBy: ['filterProseResearchAreaChips'] }],
      },
    });
  });

  it('attributes a card serving no topic when every stored topic is a place name', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-places-only',
        storedAreas: ['China', 'Connecticut'],
        servedAreas: [],
        fieldProvenance: meshProfileProvenance,
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable'].status).toBe('pass');
    expect(invariants['serving-no-topic-is-attributable']).toMatchObject({
      status: 'pass',
      detail: { servedNoneWhileStoringSome: 1, servedNoneUnexplained: 0 },
    });
  });

  it('still fails a drop no served topic guard accounts for', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-place-drop',
        storedAreas: ['Ion Channels', 'China', 'Membrane Transport Proteins'],
        servedAreas: ['Ion Channels', 'Membrane Transport Proteins'],
        fieldProvenance: meshProfileProvenance,
      },
      {
        slug: 'synthetic-unexplained-drop',
        storedAreas: ['Ion Channels', 'Membrane Transport Proteins'],
        servedAreas: ['Ion Channels'],
        fieldProvenance: meshProfileProvenance,
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'fail',
      detail: { dropped: 2, attributedToGuard: 1, unexplained: 1 },
    });
  });

  it('does not attribute a place-name drop when the topics were not read from a MeSH-indexed profile', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-area-studies-places',
        storedAreas: ['Ion Channels', 'China'],
        servedAreas: ['Ion Channels'],
        fieldProvenance: {
          researchAreas: { sourceUrl: 'https://area-studies.example.edu/people/' },
        },
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'fail',
      detail: { unexplained: 1 },
    });
  });
});
