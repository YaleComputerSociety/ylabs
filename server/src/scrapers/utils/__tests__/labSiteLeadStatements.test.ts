import { describe, expect, it } from 'vitest';
import {
  personNameFromLine,
  readListingTitle,
  rowLeadEvidence,
  rowNameAliases,
  statementCouldBeLead,
  statementNamesLead,
  subjectStatements,
} from '../labSiteLeadStatements';
import { LAB_SITE_LEAD_STATEMENT_FIXTURES } from './fixtures/labSiteLeadStatementPages';

describe('rowNameAliases', () => {
  it('reads the full name, a parenthesised acronym and an acronym head', () => {
    expect(rowNameAliases('Developmental Signals Lab (DSL)')).toEqual([
      'developmental signals lab',
      'dsl',
    ]);
    expect(rowNameAliases('TIDE Lab')).toEqual(['tide lab', 'tide']);
  });

  it('anchors nothing on a name made only of generic words', () => {
    expect(rowNameAliases('The Lab')).toEqual([]);
    expect(rowNameAliases('')).toEqual([]);
  });
});

describe('personNameFromLine', () => {
  it('drops an honorific and the credentials after a comma', () => {
    expect(personNameFromLine('Dr. Robin Quill, PhD, Associate Professor')).toEqual({
      name: 'Robin Quill',
      rest: 'Associate Professor',
    });
  });

  it('reads no name from a role or navigation line', () => {
    for (const line of [
      'Principal Investigator',
      'Lab Members',
      'Read More',
      'Robin',
      'Senior Lecturer',
      'Like Loading',
      'Open Positions',
    ]) {
      expect(personNameFromLine(line), line).toBeNull();
    }
  });
});

describe('readListingTitle', () => {
  const aliases = rowNameAliases('Center for Tidal Studies');

  it('reads a bare lead title and a lead title qualified by the row', () => {
    expect(readListingTitle('Faculty Director', aliases).lead).toBe('BARE');
    expect(readListingTitle('Director, Center for Tidal Studies', aliases).lead).toBe('ROW');
  });

  it('reads a lead title qualified by another unit as about that unit', () => {
    expect(readListingTitle('Director of Engagement and Operations', aliases)).toEqual({
      lead: 'OTHER',
      nonLead: false,
      leadTitled: true,
    });
  });

  it('never reads an associate, assistant or medical director as a lead title', () => {
    for (const title of ['Associate Director', 'Assistant Director', 'Medical Director']) {
      expect(readListingTitle(title, aliases).lead, title).toBeNull();
    }
  });

  it('reads trainee and staff ranks as non-lead, and a faculty contact as neither', () => {
    expect(readListingTitle('Postdoctoral Associate', aliases).nonLead).toBe(true);
    expect(readListingTitle('Lab Manager', aliases).nonLead).toBe(true);
    expect(readListingTitle('Faculty Contact', aliases)).toEqual({
      lead: null,
      nonLead: false,
      leadTitled: false,
    });
    expect(readListingTitle('Associate Professor', aliases).nonLead).toBe(false);
  });
});

describe('subjectStatements', () => {
  const aliases = rowNameAliases('Tidal Imaging Lab (TIL)');
  const names = (line: string, ownPage = true) =>
    subjectStatements(line, aliases, ownPage, 'https://example.org/').map((one) => one.personName);

  it('reads every person a row-subject sentence names as its leads', () => {
    expect(names('The TIL is co-led by Robin Quill and Ada Brook.')).toEqual([
      'Robin Quill',
      'Ada Brook',
    ]);
  });

  it('reads a fronted subject after the name', () => {
    expect(names('Under the direction of Prof. Robin Quill, the TIL studies tides.')).toEqual([
      'Robin Quill',
    ]);
  });

  it('reads an active statement whose object is the row', () => {
    expect(names('Robin Quill directs the Tidal Imaging Lab at the school.')).toEqual([
      'Robin Quill',
    ]);
  });

  it('ignores a sentence whose subject is another unit', () => {
    expect(names('The Reef Core, led by Ada Brook, sequences samples.')).toEqual([]);
    expect(names('The section includes labs led by Ada Brook.')).toEqual([]);
  });

  it('reads a self-reference only on the row own page', () => {
    expect(names('Our lab is led by Robin Quill.', true)).toEqual(['Robin Quill']);
    expect(names('Our lab is led by Robin Quill.', false)).toEqual([]);
  });
});

describe('statementNamesLead and statementCouldBeLead', () => {
  const lead = { displayName: 'Robin Quill', officialProfileUrls: [] };

  it('names the lead by surname and a compatible given name', () => {
    expect(statementNamesLead('Robin A. Quill', lead)).toBe(true);
    expect(statementNamesLead('Ada Quill', lead)).toBe(false);
  });

  it('names a given-name-only lead through their own profile slug', () => {
    const givenOnly = {
      displayName: 'Robin',
      officialProfileUrls: ['https://medicine.yale.edu/profile/robin-quill/'],
    };
    expect(statementNamesLead('Robin Quill', givenOnly)).toBe(true);
  });

  it('lets a shared surname block a contradiction it cannot confirm', () => {
    expect(statementCouldBeLead('Ada Quill', lead)).toBe(true);
    expect(statementCouldBeLead('Ada Brook', lead)).toBe(false);
  });
});

describe('rowLeadEvidence', () => {
  it('reads the same evidence from the same pages twice', () => {
    for (const fixture of LAB_SITE_LEAD_STATEMENT_FIXTURES) {
      expect(rowLeadEvidence(fixture.pages, fixture.rowName), fixture.name).toEqual(
        rowLeadEvidence(fixture.pages, fixture.rowName),
      );
    }
  });

  it('reads nothing without a row name or a page', () => {
    const [first] = LAB_SITE_LEAD_STATEMENT_FIXTURES;
    const empty = { statements: [], nonLeadListings: [], leadTitledNames: [] };
    expect(rowLeadEvidence(first.pages, '')).toEqual(empty);
    expect(rowLeadEvidence([], first.rowName)).toEqual(empty);
  });
});
