/**
 * The refusal-versus-empty distinction that licenses `dept-faculty-roster` to assert
 * a `websiteUrl` absence (#3135).
 *
 * #2647 measured what happens without it: of 4 planned retractions, 2 were guard
 * refusals of lab links the page still carried, one on a `student_ready` row. A
 * scraper emits nothing for a field both when the page stopped stating it and when a
 * classifier declined a value the page still states, and the observation log cannot
 * separate those. So the RED arm is the point of this suite: a page that still
 * carries a value must never produce an empty-slot claim.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  entryToResearchEntityObservations,
  mcdbExtractor,
  profileEnrichmentFromHtml,
  psychExtractor,
} from '../sources/departmentRosterScraper';

const PROFILE_URL = 'https://mcdb.yale.edu/people/ada-fixture';

const profilePage = (body: string): string =>
  `<html><head><link rel="canonical" href="${PROFILE_URL}"></head><body><main>
     <h1 class="page-title">Ada Fixture</h1>
     <div class="person-title">Professor of Fixtures</div>
     ${body}
   </main></body></html>`;

const enrich = (body: string) => profileEnrichmentFromHtml(profilePage(body), PROFILE_URL);

describe('a profile page that still carries a research website', () => {
  it('adopts it and claims nothing about the slot', () => {
    const result = enrich('<p><a href="https://fixturelab.org/">Lab website</a></p>');

    expect(result.labUrl).toBe('https://fixturelab.org/');
    expect(result.labSlotAttestation).toBeUndefined();
  });
});

describe('a profile page whose only website-signal link is refused', () => {
  /**
   * Each of these carries a link a student could follow. The page did not drop
   * anything, so an absence claim here would retract a live link.
   */
  const refusalCases: Array<[string, string]> = [
    ['an institutional advancement page', 'https://medicine.yale.edu/giving/'],
    ['a directory path on the profile host', 'https://mcdb.yale.edu/people/ada-fixture-lab'],
    [
      'another institution&apos;s person profile',
      'https://example-university.edu/people/ada-fixture',
    ],
    [
      'the shared A-to-Z lab-website index',
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites',
    ],
  ];

  it.each(refusalCases)('reports refused rather than empty for %s', (_label, href) => {
    const result = enrich(`<p><a href="${href}">Lab website</a></p>`);

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('refused');
  });
});

describe('a profile page that offers no research-website candidate at all', () => {
  it('reports the slot empty', () => {
    const result = enrich(
      `<p><a href="mailto:ada@example.edu">Email</a>
         <a href="https://orcid.org/profile">ORCID</a>
         <a href="https://mcdb.yale.edu/publications">Publications</a></p>`,
    );

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('empty');
  });
});

describe('a roster listing that reads the slot itself', () => {
  const mcdbCard = (linkHtml: string): string =>
    `<div class="directory-listing-card">
       <a class="directory-listing-card__heading-link" href="/people/ada-fixture">Ada Fixture</a>
       ${linkHtml}
     </div>`;

  it('reports refused when it declines a link the card carries', () => {
    const [entry] = mcdbExtractor(
      mcdbCard(
        '<a class="directory-listing-card__link" href="https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites">Lab websites</a>',
      ),
      { pageUrl: 'https://mcdb.yale.edu/people/faculty' },
    );

    expect(entry.labUrl).toBeUndefined();
    expect(entry.labSlotAttestation).toBe('refused');
  });

  it('reports empty when the card carries no outbound link', () => {
    const [entry] = mcdbExtractor(
      mcdbCard('<a class="directory-listing-card__link" href="mailto:ada@example.edu">Email</a>'),
      { pageUrl: 'https://mcdb.yale.edu/people/faculty' },
    );

    expect(entry.labUrl).toBeUndefined();
    expect(entry.labSlotAttestation).toBe('empty');
  });

  it('claims nothing when it adopts the card&apos;s link', () => {
    const [entry] = mcdbExtractor(
      mcdbCard(
        '<a class="directory-listing-card__link" href="https://fixturelab.org/">Lab website</a>',
      ),
      { pageUrl: 'https://mcdb.yale.edu/people/faculty' },
    );

    expect(entry.labUrl).toBe('https://fixturelab.org/');
    expect(entry.labSlotAttestation).toBeUndefined();
  });

  it('reports refused from the views-table listing too', () => {
    const [entry] = psychExtractor(
      `<table class="views-table"><tbody><tr>
         <td class="views-field views-field-name">
           <a href="/people/ada-fixture" class="username">Ada Fixture</a>
         </td>
         <td class="views-field">
           <a href="https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites">Lab website</a>
         </td>
       </tr></tbody></table>`,
      { pageUrl: 'https://psychology.yale.edu/people/faculty' },
    );

    expect(entry.labUrl).toBeUndefined();
    expect(entry.labSlotAttestation).toBe('refused');
  });
});

describe('the observation the lane emits', () => {
  const dept = {
    deptKey: 'mcdb',
    deptName: 'Molecular, Cellular and Developmental Biology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    rosterUrl: 'https://mcdb.yale.edu/people/faculty',
  } as never;

  const observationsFor = (entry: Record<string, unknown>) =>
    entryToResearchEntityObservations(
      {
        name: 'Ada Fixture',
        profileUrl: PROFILE_URL,
        researchHomeDescription:
          'The group studies the assembly of cytoskeletal fixtures in dividing cells, using live imaging and targeted genetic perturbation.',
        researchHomeShortDescription: 'Studies cytoskeletal fixture assembly in dividing cells.',
        topics: ['Cell Biology'],
        ...entry,
      } as never,
      dept,
      'https://mcdb.yale.edu/people/faculty',
      'dept-mcdb-ada-fixture',
    );

  const absenceAssertions = (entry: Record<string, unknown>) =>
    observationsFor(entry)
      .filter((observation) => observation.assertsNoValueFor)
      .map((observation) => observation.assertsNoValueFor);

  it('asserts the absence only on a positively attested empty slot', () => {
    expect(absenceAssertions({ labSlotAttestation: 'empty' })).toEqual([['websiteUrl']]);
  });

  it('asserts nothing when a candidate was refused', () => {
    expect(absenceAssertions({ labSlotAttestation: 'refused' })).toEqual([]);
  });

  it('asserts nothing when no parse made a claim', () => {
    expect(absenceAssertions({})).toEqual([]);
  });

  it('asserts nothing when the slot holds a value', () => {
    expect(
      absenceAssertions({ labUrl: 'https://fixturelab.org/', labSlotAttestation: 'empty' }),
    ).toEqual([]);
  });
});

/**
 * The contract's soundness rests on absence of an attestation meaning "this parse
 * never looked for a lab URL", so a parse that DOES read one must state what it saw.
 * Scanning the file is the only way to hold that for parses added later.
 */
describe('every parse that reads a lab URL states what it saw', () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../sources/departmentRosterScraper.ts',
  );
  const source = fs.readFileSync(sourcePath, 'utf8');

  const parseBlocks = (): Array<{ name: string; body: string }> => {
    const starts = [...source.matchAll(/^(?:export )?(?:const|function) (\w+)/gm)];
    return starts.map((match, index) => ({
      name: match[1],
      body: source.slice(match.index ?? 0, starts[index + 1]?.index ?? source.length),
    }));
  };

  /**
   * Assigning or stripping `labUrl` is what can leave an entry without one while the
   * page still carries a link. Merely reading `entry.labUrl` cannot, so consumers are
   * out of scope and a scan that flagged them would be noise rather than a guard.
   */
  const DECIDES_THE_SLOT =
    /\blabUrl\s*=|\blabUrl: undefined|\bconst labUrl\b|\blabUrl: destinationUrl/;

  const decidingBlocks = () => parseBlocks().filter((block) => DECIDES_THE_SLOT.test(block.body));

  it('finds the parses, so a green result is not an empty scan', () => {
    const names = decidingBlocks().map((block) => block.name);

    expect(names.length).toBeGreaterThanOrEqual(7);
    expect(names).toContain('mcdbExtractor');
    expect(names).toContain('psychExtractor');
    expect(names).toContain('profileEnrichmentFromHtml');
    expect(names).toContain('withoutOffsiteInstitutionWebsite');
  });

  it('leaves no slot-deciding parse silent about the slot', () => {
    const silent = decidingBlocks()
      .filter((block) => !/labSlotAttestation|labUrlCandidateRefused/.test(block.body))
      .map((block) => block.name);

    expect(silent).toEqual([]);
  });
});
