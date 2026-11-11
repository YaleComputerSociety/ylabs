import { describe, expect, it, vi } from 'vitest';

const checkFix = vi.hoisted(() => ({ acceptsFirstPerson: false }));

vi.mock('../../scrapers/utils/writtenDescriptionChecks', async () => {
  const actual = await vi.importActual<
    typeof import('../../scrapers/utils/writtenDescriptionChecks')
  >('../../scrapers/utils/writtenDescriptionChecks');
  return {
    ...actual,
    hasFirstPerson: (description: string) =>
      checkFix.acceptsFirstPerson ? false : actual.hasFirstPerson(description),
  };
});

import type { CoverageSnippet } from '../../scrapers/coverageSynthesis';
import { runDerivationImport } from '../coverageSynthesisEvaluate';
import type { WriterRowEvidence } from '../coverageSynthesisEvidence';
import {
  resolveWrittenDescription,
  writerModelThroughCache,
  type StoredWrittenDescriptionDerivation,
  type WrittenDescriptionDerivationStore,
} from '../writtenDescriptionDerivationCore';

const PAGE_TEXT = [
  'Coral Reef Recovery',
  'We study how coral reefs recover after marine heatwaves and bleaching events.',
  'Our field surveys follow coral colonies and reef fish across the Caribbean.',
].join('\n');
const DRAFT =
  'We study how coral reefs recover after marine heatwaves and bleaching events, and field surveys follow coral colonies and reef fish across the Caribbean.';

const row: WriterRowEvidence = {
  slug: 'reef-lab-fixture',
  entity: { slug: 'reef-lab-fixture', name: 'Reef Lab', entityType: 'LAB' },
  observations: [
    {
      field: 'researchPageText',
      value: [{ url: 'https://reef.example.org/research', text: PAGE_TEXT }],
      sourceName: 'research-page-text',
      sourceUrl: 'https://reef.example.org/research',
      observedAt: new Date('2026-11-01T00:00:00Z'),
    },
  ],
  mergedInObservations: [],
};

function memoryStore() {
  const entries = new Map<string, StoredWrittenDescriptionDerivation>();
  const store: WrittenDescriptionDerivationStore = {
    find: async (inputHash) => entries.get(inputHash) ?? null,
    save: async (record) => {
      entries.set(record.inputHash, record);
    },
  };
  return { store, entries };
}

describe('a stored refused import is accepted by a later check fix with no call (#5537)', () => {
  it('serves the imported draft once the check that refused it changes', async () => {
    const { store, entries } = memoryStore();
    const now = new Date('2026-11-10T00:00:00Z');
    const report = await runDerivationImport({
      rows: [row],
      drafts: [
        {
          slug: row.slug,
          writer: 'claude-agent:1',
          fullDescription: DRAFT,
          usedSnippetIndexes: [0],
        },
      ],
      store,
      evidenceNow: now,
      validateOnly: false,
    });
    expect(report.rows[0]).toMatchObject({ outcome: 'refused', stored: true });
    expect(report.rows[0].refusalReasons).toEqual(['first-person']);
    expect(entries.size).toBe(1);

    checkFix.acceptsFirstPerson = true;
    const model = vi.fn();
    const snippets: CoverageSnippet[] = [
      {
        text: PAGE_TEXT,
        sourceName: 'research-page-text',
        sourceUrl: 'https://reef.example.org/research',
      },
    ];
    const resolution = await resolveWrittenDescription({
      snippets,
      entityName: 'Reef Lab',
      entityType: 'LAB',
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
    });
    checkFix.acceptsFirstPerson = false;
    expect(resolution.step).toBe('cache-hit');
    expect(resolution.writer).toBe('claude-agent:1');
    expect(resolution.decision?.result?.description).toBe(DRAFT);
    expect(model).not.toHaveBeenCalled();
  });

  it('stores nothing with validate-only', async () => {
    const { store, entries } = memoryStore();
    await runDerivationImport({
      rows: [row],
      drafts: [
        {
          slug: row.slug,
          writer: 'claude-agent:1',
          fullDescription: DRAFT,
          usedSnippetIndexes: [0],
        },
      ],
      store,
      evidenceNow: new Date('2026-11-10T00:00:00Z'),
      validateOnly: true,
    });
    expect(entries.size).toBe(0);
  });
});
