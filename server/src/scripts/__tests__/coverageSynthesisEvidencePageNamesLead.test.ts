import { describe, expect, it } from 'vitest';
import { buildWriterEvidenceSnippets } from '../coverageSynthesisCore';
import { parseWriterEvidenceFile, snippetsFromRowEvidence } from '../coverageSynthesisEvidence';

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

  it("refuses a page under the row's own Yale website that never names the lead (#6316)", () => {
    expect(
      texts([researchPage('https://estuary.yale.edu/research')], {
        ...PERSON_ROW,
        websiteUrl: 'https://estuary.yale.edu/',
      }),
    ).toEqual([]);
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

describe("a page is the person's own only by role, name or subject, never by presence (#6316)", () => {
  const SCHOOL_UNIT_HOME = 'https://publichealth.yale.edu/coastal-health/';

  it('refuses a school unit homepage stored as the row website that never names the person', () => {
    expect(
      texts([researchPage(SCHOOL_UNIT_HOME)], { ...PERSON_ROW, websiteUrl: SCHOOL_UNIT_HOME }),
    ).toEqual([]);
  });

  it('refuses the same homepage when it only lists the person by name', () => {
    const listing = `${RESEARCH} Faculty: Quillon Varnadore, Ines Okafor.`;
    expect(
      texts([researchPage(SCHOOL_UNIT_HOME, listing)], {
        ...PERSON_ROW,
        websiteUrl: SCHOOL_UNIT_HOME,
      }),
    ).toEqual([]);
  });

  it("admits a page whose address ends in the person's full name", () => {
    expect(texts([researchPage('https://law.yale.edu/quillon-varnadore')], PERSON_ROW)).toEqual([
      RESEARCH,
    ]);
  });

  it('admits an official profile whose slug carries a trailing digit', () => {
    expect(
      texts([researchPage('https://medicine.yale.edu/profile/quillon-varnadore2/')], PERSON_ROW),
    ).toEqual([RESEARCH]);
  });

  it("refuses the full-name address when another person in the corpus shares the lead's name", () => {
    expect(
      texts([researchPage('https://law.yale.edu/quillon-varnadore')], {
        ...PERSON_ROW,
        leadFullNameShared: true,
      }),
    ).toEqual([]);
  });

  it('refuses an address ending in the surname alone', () => {
    expect(texts([researchPage('https://law.yale.edu/varnadore')], PERSON_ROW)).toEqual([]);
  });

  it("admits the person's own name-domain site", () => {
    expect(texts([researchPage('https://quillonvarnadore.com/research')], PERSON_ROW)).toEqual([
      RESEARCH,
    ]);
  });

  it('carries the shared-name flag through a captured evidence file', () => {
    const row = {
      slug: 'estuary-fixture',
      entity: { slug: 'estuary-fixture', entityType: 'FACULTY_RESEARCH_AREA' },
      observations: [researchPage('https://law.yale.edu/quillon-varnadore')],
      mergedInObservations: [],
      leadNames: LEAD_NAMES,
    };
    const file = (rows: unknown[]) =>
      parseWriterEvidenceFile({ version: 1, capturedAt: '2026-11-11T00:00:00.000Z', rows });
    const now = new Date('2026-11-11T00:00:00.000Z');
    const [shared] = file([{ ...row, leadFullNameShared: true }]).rows;
    const [unique] = file([row]).rows;
    expect(snippetsFromRowEvidence(shared, now)).toEqual([]);
    expect(snippetsFromRowEvidence(unique, now).map((snippet) => snippet.text)).toEqual([RESEARCH]);
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

describe('the lead-naming read, two more shapes', () => {
  it('admits a non-Yale page whose address carries the lead surname when the page confirms the lead', () => {
    const page = 'https://varnadore-lab.example.org/research';
    expect(
      texts(
        [researchPage(page, `${RESEARCH} The lab is directed by Quillon Varnadore.`)],
        PERSON_ROW,
      ),
    ).toEqual([`${RESEARCH} The lab is directed by Quillon Varnadore.`]);
  });

  it('admits a Yale page whose stored text names the lead', () => {
    const page = 'https://geology.yale.edu/research/sediment-group';
    expect(
      texts(
        [researchPage(page, `${RESEARCH} Principal investigator: Quillon Varnadore.`)],
        PERSON_ROW,
      ),
    ).toEqual([`${RESEARCH} Principal investigator: Quillon Varnadore.`]);
  });
});
