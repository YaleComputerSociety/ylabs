import { describe, expect, it } from 'vitest';
import {
  WRITER_CONTRACT_VERSION,
  buildWriterEvidenceSnippets,
  eligibleWriterGrants,
  orderWriterEvidence,
  writerEvidenceRank,
} from '../coverageSynthesisCore';
import {
  coverageSynthesisDecision,
  isPastCareerClauseSentence,
  isTeaserAttributionSentence,
  type CoverageSynthesisLLMFn,
} from '../../scrapers/coverageSynthesis';
import { isModelTextSource } from '../../scrapers/sourceCoverageRegistry';
import { sourceCoverageRegistry } from '../../scrapers/sourceCoverageRegistry';

const NOW = new Date('2026-10-04T00:00:00Z');
const OWN_PROSE =
  'The laboratory studies how coastal salt marshes store carbon in sediment and how tidal flooding shapes the roots of marsh grasses, using field plots, sediment cores and remote sensing of marsh loss along the Atlantic coast.';
const MODEL_TEXT =
  'The laboratory studies how invasive reeds displace native marsh plants and alter nitrogen cycling in estuaries along the Atlantic coast.';
const PROFILE_PROSE =
  'Research examines how sea level rise drowns low marsh platforms and how restored marshes recover their soils over decades.';

const observation = (value: string, sourceName: string, sourceUrl: string, confidence = 0.6) => ({
  field: 'fullDescription',
  value,
  sourceName,
  sourceUrl,
  confidence,
});

const grant = (overrides: Record<string, unknown>) => ({
  title: 'Marsh carbon budgets under sea level rise',
  abstract: 'Measures carbon burial in salt marsh sediment across tidal gradients.',
  agency: 'NSF',
  role: 'pi',
  startDate: '2023-01-01',
  endDate: '2027-01-01',
  ...overrides,
});

describe('writer evidence is text on a fetched page (#4867)', () => {
  it('never cites a model-text lane without a stored page copy', () => {
    const snippets = buildWriterEvidenceSnippets(
      [observation(MODEL_TEXT, 'lab-microsite-description-llm', 'https://marsh.example.edu/')],
      [],
      { now: NOW },
    );
    expect(snippets).toEqual([]);
  });

  it('cites a model-text value found near-verbatim in the stored copy of its page', () => {
    const page = `Home People ${MODEL_TEXT} Contact`;
    const snippets = buildWriterEvidenceSnippets(
      [observation(MODEL_TEXT, 'lab-microsite-description-llm', 'https://marsh.example.edu/')],
      [],
      { now: NOW, storedPageText: () => page },
    );
    expect(snippets.map((snippet) => snippet.text)).toEqual([MODEL_TEXT]);
  });

  it('refuses a model-text value its stored page does not carry', () => {
    const page = 'The lab studies coral reefs.';
    const snippets = buildWriterEvidenceSnippets(
      [observation(MODEL_TEXT, 'fra-profile-research-synthesis', 'https://marsh.example.edu/')],
      [],
      { now: NOW, storedPageText: () => page },
    );
    expect(snippets).toEqual([]);
  });

  it('flags every registered model lane, so the set comes from registration metadata', () => {
    for (const name of Object.keys(sourceCoverageRegistry)) {
      if (/-llm$|synthesis/.test(name)) expect(isModelTextSource(name)).toBe(true);
    }
    expect(isModelTextSource('ysm-faculty-directory')).toBe(false);
    expect(isModelTextSource('lab-microsite-llm')).toBe(true);
  });

  it('re-judges every row under the new contract', () => {
    expect(WRITER_CONTRACT_VERSION).toBe('written-description-4867-v1');
  });
});

describe('writer evidence order (#4867)', () => {
  it('reads the row site, then the official profile, then other pages', () => {
    const site = observation(
      OWN_PROSE,
      'yale-research-official',
      'https://marsh.example.edu/about',
      0.3,
    );
    const profile = observation(
      PROFILE_PROSE,
      'ysm-faculty-directory',
      'https://medicine.yale.edu/profile/someone/',
      0.9,
    );
    const other = observation(
      MODEL_TEXT.replace('invasive', 'native'),
      'yale-research-official',
      'https://news.example.edu/story',
      0.95,
    );
    const ordered = orderWriterEvidence([other, profile, site], 'https://marsh.example.edu/');
    expect(ordered.map((obs) => obs.value)).toEqual([site.value, profile.value, other.value]);
    expect(writerEvidenceRank(site, 'https://marsh.example.edu/')).toBe(0);
    expect(writerEvidenceRank({ sourceName: 'nih-reporter', sourceUrl: '' })).toBe(3);
  });

  it('treats only pages under a shared-host site path as the row site', () => {
    const websiteUrl = 'https://medicine.yale.edu/lab/marsh/';
    const rank = (sourceUrl: string, sourceName = 'yale-research-official') =>
      writerEvidenceRank({ sourceName, sourceUrl }, websiteUrl);
    expect(rank('https://medicine.yale.edu/lab/marsh/research/')).toBe(0);
    expect(rank('https://medicine.yale.edu/lab/marsh')).toBe(0);
    expect(rank('https://medicine.yale.edu/lab/marshland/')).toBe(2);
    expect(rank('https://medicine.yale.edu/lab/reef/')).toBe(2);
    expect(rank('https://medicine.yale.edu/news/story/')).toBe(2);
    expect(rank('https://medicine.yale.edu/profile/someone/')).toBe(1);
  });

  it('does not rank a page as the row site because its lane reads lab sites', () => {
    expect(
      writerEvidenceRank(
        { sourceName: 'yse-centers-index', sourceUrl: 'https://center.example.edu/' },
        'https://marsh.example.edu/',
      ),
    ).toBe(2);
  });
});

describe('the grant rule (#4867, owner direction)', () => {
  it('reads no grants when the row states its own research', () => {
    const snippets = buildWriterEvidenceSnippets(
      [observation(OWN_PROSE, 'yale-research-official', 'https://marsh.example.edu/')],
      [grant({}), grant({ title: 'Tidal flooding and cordgrass roots' })],
      { now: NOW },
    );
    expect(snippets.map((snippet) => snippet.text)).toEqual([OWN_PROSE]);
  });

  it('reads recent PI grants when the row has no prose of its own', () => {
    const snippets = buildWriterEvidenceSnippets(
      [],
      [grant({}), grant({ title: 'Tidal flooding and cordgrass roots' })],
      { now: NOW },
    );
    expect(snippets).toHaveLength(2);
  });

  it('never makes one funded project the whole evidence', () => {
    expect(buildWriterEvidenceSnippets([], [grant({})], { now: NOW })).toEqual([]);
  });

  it('reads no single grant beside thin page text', () => {
    const thin = observation(
      'Coastal marsh ecology and restoration',
      'yale-research-official',
      'https://marsh.example.edu/',
    );
    const snippets = buildWriterEvidenceSnippets([thin], [grant({})], { now: NOW });
    expect(snippets.map((snippet) => snippet.text)).toEqual([
      'Coastal marsh ecology and restoration',
    ]);
  });

  it('reads only grants the lead holds as PI that are active or ended within five years', () => {
    const kept = eligibleWriterGrants(
      [
        grant({ title: 'active' }),
        grant({ title: 'recent', endDate: '2022-06-01' }),
        grant({ title: 'old', endDate: '2019-06-01' }),
        grant({ title: 'copi', role: 'copi' }),
        grant({ title: 'undated', startDate: undefined, endDate: undefined }),
      ],
      NOW,
    ) as Array<{ title: string }>;
    expect(kept.map((entry) => entry.title)).toEqual(['active', 'recent']);
  });
});

describe('the writer refuses wrong attribution and past work (#4867)', () => {
  const SNIPPETS = [
    {
      text: 'The laboratory develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.',
      sourceUrl: 'https://example.edu/lab',
      sourceName: 'lab-page',
    },
  ];
  const GROUNDED =
    'Develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.';
  const decide = (fullDescription: string) =>
    coverageSynthesisDecision({
      snippets: SNIPPETS,
      entityName: 'Synthetic Lab',
      callLLM: (async () => ({
        fullDescription,
        usedSnippetIndexes: [0],
      })) as CoverageSynthesisLLMFn,
    });

  it('drops a sentence that presents training as current work', async () => {
    const decision = await decide(
      `${GROUNDED} Her postdoctoral work mapped immune cell differentiation in mice.`,
    );
    expect(decision.result?.description).toBe(GROUNDED);
  });

  it('drops a sentence attributing a featured item or a related unit', async () => {
    const decision = await decide(
      `${GROUNDED} Related centers study gene regulatory networks in immune cells.`,
    );
    expect(decision.result?.description).toBe(GROUNDED);
  });

  it('refuses a body that is only a featured item, naming that arm', async () => {
    const decision = await decide(
      'The featured issue of the journal covers gene regulatory networks controlling immune cell differentiation.',
    );
    expect(decision.refusal).toBe('teaser-attribution');
  });

  it('keeps research prose that uses the same words', () => {
    expect(isTeaserAttributionSentence('Studies related diseases of the immune system.')).toBe(
      false,
    );
    expect(isPastCareerClauseSentence('Trains graduate students in single-cell sequencing.')).toBe(
      false,
    );
    expect(isPastCareerClauseSentence('As a postdoctoral fellow she studied T cells.')).toBe(true);
    expect(
      isPastCareerClauseSentence(
        'Mentors students through their graduate research on immune cell fate.',
      ),
    ).toBe(false);
  });
});
