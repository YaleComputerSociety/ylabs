import { describe, expect, it } from 'vitest';
import { labNameAdmissibilityFor, siteTitlesFromHtml } from '../promoteFacultyResearchToLab';

const roster: ReadonlySet<string> = new Set(['fixturecolleague', 'quillfixture', 'lab']);
const admissible = labNameAdmissibilityFor(roster);
const candidate = (titles: string[]) => ({
  id: 'id-1',
  name: 'Jane Quillfixture Faculty Research',
  websiteUrl: 'https://www.fixturelaboratory.example.org/',
  websiteTitles: titles,
});

describe('site lab name admissibility', () => {
  it("refuses a site whose title names another known researcher", () => {
    expect(
      admissible(
        'The Laboratory for Fixturegenomics',
        candidate(['Ada Fixturecolleague, M.D. | The Laboratory for Fixturegenomics']),
      ),
    ).toBe(false);
  });

  it("does not read a lab name ending in Lab as a person's name", () => {
    expect(admissible('Quillfixture Lab', candidate(['Quillfixture Lab']))).toBe(true);
  });

  it('reads og:site_name, the title, and the first heading', () => {
    expect(
      siteTitlesFromHtml(
        '<html><head><meta property="og:site_name" content="Fixture Lab"><title>Home | Fixture Lab</title></head><body><h1>Fixture Lab</h1></body></html>',
      ),
    ).toEqual(['Fixture Lab', 'Home | Fixture Lab', 'Fixture Lab']);
  });
});
