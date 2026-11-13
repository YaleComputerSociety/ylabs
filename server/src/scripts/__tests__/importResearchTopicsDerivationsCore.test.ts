import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RESEARCH_PAGE_TOPICS_PROMPT,
  RESEARCH_PAGE_TOPICS_PROMPT_HASH,
} from '../../scrapers/prompts';
import {
  CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
  researchPageTextHash,
} from '../../scrapers/researchPageTopicsDerivation';
import {
  deriveResearchTopicsForRows,
  researchTopicsUserMessage,
  type ResearchTopicsDerivationRecord,
} from '../deriveResearchTopicsCore';
import { currentPageTextRowsBySlug } from '../deriveResearchTopics';
import { resolveImportArtifactPath, writePrivateJson } from '../importResearchTopicsDerivations';
import { parsePageQuotedTopicExtraction } from '../../scrapers/utils/pageQuotedResearchTopics';
import {
  assertImportResearchTopicsApplyAllowed,
  buildResearchTopicsExport,
  chunkOutputPath,
  chunkResearchTopicsExport,
  gradingSampleOf,
  importedTopicsWriterId,
  importResearchTopicReadings,
  mergeImportedTopicReadings,
  IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG,
  IMPORT_RESEARCH_TOPICS_USAGE,
  parseImportedTopicReadings,
  parseImportResearchTopicsArgs,
  type ImportedTopicsStore,
} from '../importResearchTopicsDerivationsCore';

const SLUG = 'tidepool-lab-fixture';
const HOME = 'https://tidepool-lab.example.org/';
const pages = [
  { url: HOME, text: 'We study how coastal kelp forests recover after marine heatwaves.' },
];
const rows = [{ slug: SLUG, value: pages }];
const exportedHash = () => buildResearchTopicsExport(rows, [SLUG]).rows[0].inputHash;
const WRITER = importedTopicsWriterId(RESEARCH_PAGE_TOPICS_PROMPT_HASH);

const rawOutput = {
  topics: [
    { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
    { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
  ],
  field: { topic: 'Marine ecology', quote: 'We study how coastal kelp', url: HOME },
};

const readingRow = (overrides: Record<string, unknown> = {}) => ({
  slug: SLUG,
  inputHash: exportedHash(),
  rawOutput,
  ...overrides,
});

const readingsFile = (
  fileRows: unknown[] = [readingRow()],
  overrides: Record<string, unknown> = {},
) => ({
  writer: WRITER,
  promptHash: RESEARCH_PAGE_TOPICS_PROMPT_HASH,
  rows: fileRows,
  ...overrides,
});

function memoryStore(existing: ResearchTopicsDerivationRecord[] = []) {
  const records = new Map(existing.map((record) => [record.inputHash, record]));
  const store: ImportedTopicsStore = {
    has: vi.fn(async (inputHash: string) => records.has(inputHash)),
    insertIfAbsent: vi.fn(async (record: ResearchTopicsDerivationRecord) => {
      if (records.has(record.inputHash)) return false;
      records.set(record.inputHash, record);
      return true;
    }),
  };
  return { store, records };
}

const importOnce = (
  readings: unknown,
  store: ImportedTopicsStore | null,
  options: { apply?: boolean; mode?: 'import' | 'validate-only'; rowsOverride?: typeof rows } = {},
) =>
  importResearchTopicReadings({
    mode: options.mode ?? 'import',
    apply: options.apply ?? true,
    readings: parseImportedTopicReadings(readings),
    rows: options.rowsOverride ?? rows,
    store,
  });

describe('parseImportedTopicReadings', () => {
  it('rejects a readings file credited to an openai writer', () => {
    expect(() =>
      parseImportedTopicReadings(readingsFile(undefined, { writer: 'openai:gpt-5-mini' })),
    ).toThrow(/openai writer/);
    expect(() =>
      parseImportedTopicReadings(readingsFile(undefined, { writer: 'OpenAI:gpt-5-mini' })),
    ).toThrow(/openai writer/);
    expect(parseImportedTopicReadings(readingsFile())[0].writer).toBe(WRITER);
    expect(WRITER).toBe(`claude-agent:topics-${RESEARCH_PAGE_TOPICS_PROMPT_HASH.slice(0, 8)}`);
  });

  it('accepts only the agent writer named for the current prompt', () => {
    const otherPromptWriter = `claude-agent:topics-${'0'.repeat(8)}`;
    expect(WRITER).not.toBe(otherPromptWriter);
    for (const writer of [
      'openai/gpt-5-mini',
      'gpt-5-mini',
      'openai-agent',
      'claude-agent:1',
      otherPromptWriter,
    ]) {
      expect(() => parseImportedTopicReadings(readingsFile(undefined, { writer }))).toThrow(
        /must name the writer claude-agent:topics-/,
      );
    }
  });

  it('refuses readings that answer a different prompt', () => {
    expect(() =>
      parseImportedTopicReadings(readingsFile(undefined, { promptHash: 'an-earlier-prompt' })),
    ).toThrow(/promptHash mismatch/);
    expect(() =>
      parseImportedTopicReadings(readingsFile(undefined, { promptHash: undefined })),
    ).toThrow(/promptHash mismatch/);
  });

  it('runs the lane parser on the raw model answer, given as an object or as its JSON text', () => {
    const [fromObject] = parseImportedTopicReadings(readingsFile());
    const [fromText] = parseImportedTopicReadings(
      readingsFile([readingRow({ rawOutput: JSON.stringify(rawOutput) })]),
    );
    expect(fromObject.extraction).toEqual(parsePageQuotedTopicExtraction(rawOutput));
    expect(fromText.extraction).toEqual(fromObject.extraction);
    expect(() =>
      parseImportedTopicReadings(readingsFile([readingRow({ rawOutput: 'not json' })])),
    ).toThrow(/rawOutput/);
    expect(() =>
      parseImportedTopicReadings(readingsFile([readingRow({ rawOutput: undefined })])),
    ).toThrow(/rawOutput/);
  });

  it('needs a writer, the exported key, and each slug once', () => {
    expect(() => parseImportedTopicReadings(readingsFile([readingRow({ inputHash: '' })]))).toThrow(
      /inputHash/,
    );
    expect(() => parseImportedTopicReadings(readingsFile(undefined, { writer: '' }))).toThrow(
      /writer/,
    );
    expect(() => parseImportedTopicReadings(readingsFile([readingRow(), readingRow()]))).toThrow(
      /repeats a slug/,
    );
    expect(() => parseImportedTopicReadings([readingRow()])).toThrow(/"rows"/);
    expect(() =>
      mergeImportedTopicReadings([
        parseImportedTopicReadings(readingsFile()),
        parseImportedTopicReadings(readingsFile()),
      ]),
    ).toThrow(/same slug/);
  });
});

describe('importResearchTopicReadings', () => {
  it('refuses an entry exported from text the row no longer carries', async () => {
    const { store, records } = memoryStore();
    const changed = [
      {
        slug: SLUG,
        value: [{ url: HOME, text: 'We now study seagrass meadows and blue carbon.' }],
      },
    ];
    const report = await importOnce(readingsFile(), store, { rowsOverride: changed });
    expect(report.staleInput).toBe(1);
    expect(report.stored).toBe(0);
    expect(report.rows[0].outcome).toBe('stale-input');
    expect(store.insertIfAbsent).not.toHaveBeenCalled();
    expect(records.size).toBe(0);
  });

  it('never overwrites a reading already cached under the key', async () => {
    const original: ResearchTopicsDerivationRecord = {
      inputHash: exportedHash(),
      ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
      extractedTopics: [{ topic: 'Original topic', quote: 'coastal kelp forests', url: HOME }],
      derivedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { store, records } = memoryStore([original]);
    const report = await importOnce(readingsFile(), store);
    expect(report.alreadyCached).toBe(1);
    expect(report.stored).toBe(0);
    expect(store.insertIfAbsent).not.toHaveBeenCalled();
    expect(records.get(original.inputHash)).toBe(original);
  });

  it('stores under the same key research-topics:derive computes for the same input', async () => {
    const derived = new Map<string, ResearchTopicsDerivationRecord>();
    await deriveResearchTopicsForRows({
      rows: [{ entityKey: SLUG, value: pages }],
      callModel: async () => ({ topics: [], field: null }),
      store: {
        has: async () => false,
        save: async (record) => {
          derived.set(record.inputHash, record);
        },
      },
    });
    const [deriveKey] = [...derived.keys()];

    const { store, records } = memoryStore();
    const report = await importOnce(readingsFile(), store);
    const [importKey] = [...records.keys()];

    expect(exportedHash()).toBe(deriveKey);
    expect(importKey).toBe(deriveKey);
    expect(report.stored).toBe(1);
    expect(records.get(importKey)).toMatchObject({
      promptHash: RESEARCH_PAGE_TOPICS_PROMPT_HASH,
      model: CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS.model,
      writer: WRITER,
    });
  });

  it('plans but stores nothing on a dry run, and reports the filtered preview with no model call', async () => {
    const { store, records } = memoryStore();
    const report = await importOnce(
      readingsFile([
        readingRow({
          rawOutput: {
            ...rawOutput,
            topics: [
              { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
              { topic: 'Coastal kelp', quote: 'coastal kelp nurseries on deep reefs', url: HOME },
            ],
          },
        }),
      ]),
      store,
      { apply: false },
    );
    expect(report).toMatchObject({
      stored: 0,
      plannedStores: 1,
      rowsWithTopicsAfterFilters: 1,
      modelCalls: 0,
    });
    expect(report.rows[0].topics).toEqual(['Kelp forests', 'Marine ecology']);
    expect(report.rows[0].refusals).toEqual([{ reason: 'quote-not-on-page', count: 1 }]);
    expect(records.size).toBe(0);
  });

  it('validates as accepted or refused without reading or writing the cache', async () => {
    const accepted = await importOnce(readingsFile(), null, {
      mode: 'validate-only',
      apply: false,
    });
    expect(accepted.rows[0].outcome).toBe('accepted');
    expect(accepted.rowsWithTopicsAfterFilters).toBe(1);
    expect(accepted.plannedStores).toBe(0);

    const refused = await importOnce(
      readingsFile([readingRow({ rawOutput: { topics: [], field: null } })]),
      null,
      { mode: 'validate-only', apply: false },
    );
    expect(refused.rows[0].outcome).toBe('refused');
  });

  it('stores nothing for a reading the filters leave with no topics, so a later reading can fill the key', async () => {
    const { store, records } = memoryStore();
    for (const apply of [false, true]) {
      const empty = await importOnce(
        readingsFile([readingRow({ rawOutput: { topics: [], field: null } })]),
        store,
        { apply },
      );
      expect(empty.rows[0].outcome).toBe('refused');
      expect(empty).toMatchObject({ stored: 0, plannedStores: 0, rowsWithTopicsAfterFilters: 0 });
    }
    const offPage = await importOnce(
      readingsFile([
        readingRow({
          rawOutput: {
            topics: [
              { topic: 'Coastal kelp', quote: 'coastal kelp nurseries on deep reefs', url: HOME },
            ],
            field: null,
          },
        }),
      ]),
      store,
    );
    expect(offPage.rows[0].outcome).toBe('refused');
    expect(records.size).toBe(0);
    expect(store.has).not.toHaveBeenCalled();

    const later = await importOnce(readingsFile(), store);
    expect(later.rows[0].outcome).toBe('stored');
    expect(records.size).toBe(1);
  });

  it('counts a row with no current page text', async () => {
    const report = await importOnce(readingsFile(), memoryStore().store, { rowsOverride: [] });
    expect(report.noText).toBe(1);
  });
});

describe('buildResearchTopicsExport', () => {
  it('hands the reader exactly the lane input, frozen at its capture time', () => {
    const capturedAt = new Date('2026-11-13T00:00:00Z');
    const exported = buildResearchTopicsExport(rows, [SLUG, 'row-without-text'], { capturedAt });
    expect(exported.capturedAt).toBe('2026-11-13T00:00:00.000Z');
    expect(exported.systemPrompt).toBe(RESEARCH_PAGE_TOPICS_PROMPT);
    expect(exported.promptHash).toBe(RESEARCH_PAGE_TOPICS_PROMPT_HASH);
    expect(exported.model).toBe(CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS.model);
    expect(exported.outputSchema.required).toEqual(['topics', 'field']);
    expect(exported.rows).toEqual([
      {
        slug: SLUG,
        inputHash: exportedHash(),
        textHash: researchPageTextHash(pages),
        userMessage: researchTopicsUserMessage(pages),
      },
    ]);
    expect(exported.noText).toEqual(['row-without-text']);
    expect(exported.gradingGate).toMatch(/0 topics unsupported/);
    expect(JSON.stringify(buildResearchTopicsExport(rows, [SLUG], { capturedAt }))).toBe(
      JSON.stringify(buildResearchTopicsExport(rows, [SLUG], { capturedAt })),
    );
  });

  it('splits into chunk files only when asked', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      slug: `row-${index}`,
      value: [{ url: HOME, text: `We study kelp forest number ${index} after heatwaves.` }],
    }));
    const exported = buildResearchTopicsExport(
      many,
      many.map((row) => row.slug),
    );
    expect(chunkResearchTopicsExport(exported, undefined)).toHaveLength(1);
    const chunks = chunkResearchTopicsExport(exported, 2);
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([2, 2, 1]);
    expect(new Set(chunks.map((chunk) => chunk.capturedAt)).size).toBe(1);
    expect(chunkOutputPath('/tmp/topics.json', 0, 1)).toBe('/tmp/topics.json');
    expect(chunkOutputPath('/tmp/topics.json', 1, 3)).toBe('/tmp/topics.part-002.json');
  });
});

describe('gradingSampleOf', () => {
  it('emits raw readings with the text each quote cites and no filter verdict', () => {
    const sample = gradingSampleOf(parseImportedTopicReadings(readingsFile()), rows, 20);
    expect(sample.readings).toHaveLength(1);
    expect(sample.readings[0].topics[0]).toEqual({
      topic: 'Kelp forests',
      quote: 'how coastal kelp forests recover',
      url: HOME,
      citedText: pages[0].text,
    });
    expect(JSON.stringify(sample)).not.toMatch(/refusal|keptByFilters/);
  });

  it('leaves out a stale reading', () => {
    const sample = gradingSampleOf(
      parseImportedTopicReadings(readingsFile([readingRow({ inputHash: 'an-older-key' })])),
      rows,
      20,
    );
    expect(sample.readings).toEqual([]);
  });
});

describe('parseImportResearchTopicsArgs and the apply guard', () => {
  const env = { DEV_WRITE_OWNER: 'test-session' } as NodeJS.ProcessEnv;

  it('needs the confirmation flag and a Development database to apply', () => {
    const args = parseImportResearchTopicsArgs(['--input=/tmp/readings.json', '--apply'], env);
    expect(() => assertImportResearchTopicsApplyAllowed(args, 'cluster/development')).toThrow(
      IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG,
    );
    const confirmed = parseImportResearchTopicsArgs(
      ['--input=/tmp/readings.json', '--apply', IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG],
      env,
    );
    expect(() => assertImportResearchTopicsApplyAllowed(confirmed, 'cluster/beta')).toThrow(
      /Development/,
    );
    expect(() =>
      assertImportResearchTopicsApplyAllowed(confirmed, 'cluster/development'),
    ).not.toThrow();
  });

  it('refuses an apply that does not name its owner', () => {
    expect(() =>
      parseImportResearchTopicsArgs(
        ['--input=/tmp/readings.json', '--apply', IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG],
        {} as NodeJS.ProcessEnv,
      ),
    ).toThrow(/DEV_WRITE_OWNER/);
  });

  it('keeps the modes apart', () => {
    expect(() => parseImportResearchTopicsArgs(['--export', '--output=/tmp/x.json'], env)).toThrow(
      /scope/,
    );
    expect(() =>
      parseImportResearchTopicsArgs(
        ['--export', '--slugs=a', '--output=/tmp/x.json', '--apply'],
        env,
      ),
    ).toThrow(/does not combine/);
    expect(() =>
      parseImportResearchTopicsArgs(['--input=/tmp/r.json', '--sample-for-grading=20'], env),
    ).toThrow(/validate-only/);
    expect(
      parseImportResearchTopicsArgs(
        [
          '--validate-only',
          '--input=/tmp/r.json',
          '--sample-for-grading=20',
          '--sample-output=/tmp/s.json',
        ],
        env,
      ),
    ).toMatchObject({ mode: 'validate-only', sampleForGrading: 20 });
    expect(() => parseImportResearchTopicsArgs(['--input=/tmp/r.json', '--force'], env)).toThrow(
      /Unknown/,
    );
  });

  it('states the owner grading gate in its help text', () => {
    expect(IMPORT_RESEARCH_TOPICS_USAGE).toMatch(/three blind graders/);
    expect(IMPORT_RESEARCH_TOPICS_USAGE).toMatch(/0 topics unsupported/);
  });
});

describe('currentPageTextRowsBySlug', () => {
  it('takes the newest reading across the id and key forms of one row', () => {
    const id = '0123456789abcdef01234567';
    const observation = (overrides: Record<string, unknown>) => ({
      field: 'researchPageText',
      sourceName: 'research-page-text',
      superseded: false,
      ...overrides,
    });
    const result = currentPageTextRowsBySlug(
      [
        observation({ entityKey: SLUG, value: 'older', observedAt: new Date('2026-01-01') }),
        observation({ entityId: id, value: 'newer', observedAt: new Date('2026-02-01') }),
        observation({ entityKey: 'not-requested', value: 'other' }),
      ],
      new Map([[id, SLUG]]),
      [SLUG],
    );
    expect(result).toEqual([{ slug: SLUG, entityId: id, value: 'newer' }]);
  });
});

describe('export artifact paths', () => {
  const experimentsRoot = path.join(os.homedir(), 'ylabs-experiments-root-fixture-never-created');

  it('accepts a json path under the experiments root or a temp root, and nothing else', () => {
    const inside = path.join(experimentsRoot, 'descriptions', 'batch-run', 'topics-export.json');
    expect(resolveImportArtifactPath(inside, '--output', experimentsRoot)).toBe(inside);
    expect(() =>
      resolveImportArtifactPath(path.join(experimentsRoot, 'x.txt'), '--output', experimentsRoot),
    ).toThrow(/--output/);
    expect(() =>
      resolveImportArtifactPath(
        path.join(os.homedir(), 'topics-export-outside-roots.json'),
        '--output',
        experimentsRoot,
      ),
    ).toThrow(/--output must write under/);
    expect(fs.existsSync(experimentsRoot)).toBe(false);
  });

  it('writes the file with owner-only permissions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topics-export-'));
    const target = path.join(dir, 'batch-run', 'topics-export.json');
    writePrivateJson(target, { ok: true });
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
