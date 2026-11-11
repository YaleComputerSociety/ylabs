import { describe, expect, it } from 'vitest';
import { buildWriterEvidenceSnippets } from '../coverageSynthesisCore';
import { parseWriterEvidenceFile, snippetsFromRowEvidence } from '../coverageSynthesisEvidence';

const RESEARCH =
  'The research examines how estuarine sediment moves during storm surges, combining field cores from tidal marshes with numerical models of channel erosion and deposition.';
const LEAD_NAMES = ['Quillon Varnadore'];

const micrositeDescription = (sourceUrl: string, value = RESEARCH) => ({
  field: 'fullDescription',
  value,
  sourceName: 'lab-microsite-description-llm',
  sourceUrl,
  ingestVerifiedAgainstPage: true,
});

const texts = (
  observations: Parameters<typeof buildWriterEvidenceSnippets>[0],
  options: Parameters<typeof buildWriterEvidenceSnippets>[2],
) => buildWriterEvidenceSnippets(observations, undefined, options).map((snippet) => snippet.text);

const PERSON_ROW = { entityType: 'FACULTY_RESEARCH_AREA', leadNames: LEAD_NAMES };

describe('writer evidence screens non-Yale microsite descriptions by lead ownership (#5777)', () => {
  it('drops a person row description from a non-Yale page that does not confirm the lead', () => {
    expect(
      texts([micrositeDescription('https://coastal-foundation.example.org/about')], PERSON_ROW),
    ).toEqual([]);
  });

  it('keeps a description whose non-Yale page carries the lead surname in its address', () => {
    expect(
      texts([micrositeDescription('https://varnadorelab.example.org/research')], PERSON_ROW),
    ).toEqual([RESEARCH]);
  });

  it('keeps a description whose stored page text names the lead', () => {
    const pageUrl = 'https://tidewater-collaborative.example.org/team/';
    expect(
      texts(
        [
          micrositeDescription('https://tidewater-collaborative.example.org/team'),
          {
            field: 'researchPageText',
            value: [{ url: pageUrl, text: 'Principal investigator: Quillon Varnadore.' }],
            sourceName: 'research-page-text',
            sourceUrl: pageUrl,
          },
        ],
        PERSON_ROW,
      ),
    ).toContain(RESEARCH);
  });

  it('keeps a description from a Yale-hosted page', () => {
    expect(
      texts([micrositeDescription('https://medicine.yale.edu/lab/estuary/')], PERSON_ROW),
    ).toEqual([RESEARCH]);
  });

  it('leaves a lab row unaffected', () => {
    expect(
      texts([micrositeDescription('https://coastal-foundation.example.org/about')], {
        entityType: 'LAB',
        leadNames: LEAD_NAMES,
      }),
    ).toEqual([RESEARCH]);
  });

  it('keeps the description when the row has no lead name to check', () => {
    expect(
      texts([micrositeDescription('https://coastal-foundation.example.org/about')], {
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual([RESEARCH]);
  });

  it('reads the lead names a captured evidence file carries, and none when it carries none', () => {
    const row = {
      slug: 'estuary-fixture',
      entity: { slug: 'estuary-fixture', entityType: 'FACULTY_RESEARCH_AREA' },
      observations: [micrositeDescription('https://coastal-foundation.example.org/about')],
      mergedInObservations: [],
    };
    const file = (rows: unknown[]) =>
      parseWriterEvidenceFile({ version: 1, capturedAt: '2026-11-11T00:00:00.000Z', rows });
    const now = new Date('2026-11-11T00:00:00.000Z');
    const [withLead] = file([{ ...row, leadNames: LEAD_NAMES }]).rows;
    const [withoutLead] = file([row]).rows;
    expect(snippetsFromRowEvidence(withLead, now)).toEqual([]);
    expect(snippetsFromRowEvidence(withoutLead, now).map((snippet) => snippet.text)).toEqual([
      RESEARCH,
    ]);
  });
});
