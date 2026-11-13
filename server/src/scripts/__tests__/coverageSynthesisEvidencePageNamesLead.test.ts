import { describe, expect, it } from 'vitest';
import { buildWriterEvidenceSnippets } from '../coverageSynthesisCore';
import {
  parseWriterEvidenceFile,
  snippetsFromRowEvidence,
  websiteUrlIsStatedByYaleSource,
} from '../coverageSynthesisEvidence';

const RESEARCH =
  'The research examines how estuarine sediment moves during storm surges, combining field cores from tidal marshes with numerical models of channel erosion and deposition.';
const LEAD_NAMES = ['Quillon Varnadore'];

const profileDescription = (sourceUrl: string, value = RESEARCH) => ({
  field: 'fullDescription',
  value,
  sourceName: 'ysm-faculty-directory',
  sourceUrl,
});

const researchPage = (url: string, text = RESEARCH) => ({
  field: 'researchPageText',
  value: [{ url, text }],
  sourceName: 'research-page-text',
  sourceUrl: url,
});

const texts = (
  observations: Parameters<typeof buildWriterEvidenceSnippets>[0],
  options: Parameters<typeof buildWriterEvidenceSnippets>[2],
) => buildWriterEvidenceSnippets(observations, undefined, options).map((snippet) => snippet.text);

const PERSON_ROW = { entityType: 'FACULTY_RESEARCH_AREA', leadNames: LEAD_NAMES };

describe('writer evidence comes only from a page that names the row lead (#4873, #5961)', () => {
  it('refuses a Yale department page that never names the lead', () => {
    expect(
      texts([profileDescription('https://geology.yale.edu/research/overview')], PERSON_ROW),
    ).toEqual([]);
  });

  it('refuses stored page text from a page that never names the lead', () => {
    expect(texts([researchPage('https://geology.yale.edu/research/overview')], PERSON_ROW)).toEqual(
      [],
    );
  });

  it('refuses a non-Yale page that does not confirm the lead', () => {
    expect(
      texts([profileDescription('https://coastal-foundation.example.org/about')], PERSON_ROW),
    ).toEqual([]);
  });

  it('keeps a page whose address carries the lead surname', () => {
    expect(
      texts(
        [profileDescription('https://medicine.yale.edu/profile/quillon-varnadore/')],
        PERSON_ROW,
      ),
    ).toEqual([RESEARCH]);
  });

  it('keeps a page whose stored text names the lead', () => {
    const pageUrl = 'https://tidewater-collaborative.example.org/team/';
    expect(
      texts(
        [
          profileDescription('https://tidewater-collaborative.example.org/team'),
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

  it("keeps a page under the row's own Yale website", () => {
    expect(
      texts([researchPage('https://estuary.yale.edu/research')], {
        ...PERSON_ROW,
        websiteUrl: 'https://estuary.yale.edu/',
      }),
    ).toEqual([RESEARCH]);
  });

  it('leaves a lab named for its work unaffected', () => {
    expect(
      texts([profileDescription('https://geology.yale.edu/research/overview')], {
        entityType: 'LAB',
        identity: { name: 'Estuarine Dynamics Laboratory' },
        leadNames: LEAD_NAMES,
      }),
    ).toEqual([RESEARCH]);
  });

  it('screens a lab named for its lead', () => {
    expect(
      texts([profileDescription('https://geology.yale.edu/research/overview')], {
        entityType: 'LAB',
        identity: { name: 'Varnadore Lab' },
        leadNames: LEAD_NAMES,
      }),
    ).toEqual([]);
  });

  it('keeps the evidence when the row has no lead name to check', () => {
    expect(
      texts([profileDescription('https://geology.yale.edu/research/overview')], {
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual([RESEARCH]);
  });

  it('reads the lead names a captured evidence file carries, and none when it carries none', () => {
    const row = {
      slug: 'estuary-fixture',
      entity: { slug: 'estuary-fixture', entityType: 'FACULTY_RESEARCH_AREA' },
      observations: [profileDescription('https://coastal-foundation.example.org/about')],
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

describe("a non-Yale page under the row's own website, which a Yale source states", () => {
  const OWN_SITE = 'https://sites.example-host.com/view/estuary-sediment';
  const OWN_PAGE = 'https://sites.example-host.com/view/estuary-sediment/research';

  it('keeps the page for the writer read when a Yale-hosted source states the website', () => {
    expect(
      texts([researchPage(OWN_PAGE)], {
        ...PERSON_ROW,
        websiteUrl: OWN_SITE,
        websiteUrlStatedByYaleSource: true,
      }),
    ).toEqual([RESEARCH]);
  });

  it('refuses the same page when only the external page states the website (#5777)', () => {
    expect(texts([researchPage(OWN_PAGE)], { ...PERSON_ROW, websiteUrl: OWN_SITE })).toEqual([]);
  });

  it('refuses a page on the same host outside the stated website', () => {
    expect(
      texts([researchPage('https://sites.example-host.com/view/another-person/research')], {
        ...PERSON_ROW,
        websiteUrl: OWN_SITE,
        websiteUrlStatedByYaleSource: true,
      }),
    ).toEqual([]);
  });

  it('counts only a Yale-hosted observation stating the same website', () => {
    const yaleProfile = 'https://medicine.yale.edu/profile/quillon-varnadore/';
    expect(
      websiteUrlIsStatedByYaleSource(OWN_SITE, [{ value: `${OWN_SITE}/`, sourceUrl: yaleProfile }]),
    ).toBe(true);
    expect(
      websiteUrlIsStatedByYaleSource(OWN_SITE, [{ value: OWN_SITE, sourceUrl: OWN_PAGE }]),
    ).toBe(false);
    expect(
      websiteUrlIsStatedByYaleSource(OWN_SITE, [
        { value: 'https://sites.example-host.com/view/another-person', sourceUrl: yaleProfile },
      ]),
    ).toBe(false);
  });

  it('carries the statement through a captured evidence file', () => {
    const row = {
      slug: 'estuary-fixture',
      entity: {
        slug: 'estuary-fixture',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: OWN_SITE,
      },
      observations: [researchPage(OWN_PAGE)],
      mergedInObservations: [],
      leadNames: LEAD_NAMES,
    };
    const file = (rows: unknown[]) =>
      parseWriterEvidenceFile({ version: 1, capturedAt: '2026-11-11T00:00:00.000Z', rows });
    const now = new Date('2026-11-11T00:00:00.000Z');
    const [stated] = file([{ ...row, websiteUrlStatedByYaleSource: true }]).rows;
    const [unstated] = file([row]).rows;
    expect(snippetsFromRowEvidence(stated, now).map((snippet) => snippet.text)).toEqual([RESEARCH]);
    expect(snippetsFromRowEvidence(unstated, now)).toEqual([]);
  });
});

describe("a page that names any of the row's leads is writer evidence (#6127)", () => {
  it('admits a page that names the second lead and refuses one that names neither', () => {
    const coLeadPage = 'https://geology.yale.edu/research/coastal-group';
    const withCoLead = { ...PERSON_ROW, leadNames: ['Quillon Varnadore', 'Teodora Halvorsen'] };
    expect(
      texts([researchPage(coLeadPage, `${RESEARCH} Led by Teodora Halvorsen.`)], withCoLead),
    ).toEqual([`${RESEARCH} Led by Teodora Halvorsen.`]);
    expect(texts([researchPage(coLeadPage)], withCoLead)).toEqual([]);
  });
});
