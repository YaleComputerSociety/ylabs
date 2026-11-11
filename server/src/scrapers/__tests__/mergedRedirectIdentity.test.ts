import { describe, expect, it } from 'vitest';
import {
  leadsTheRowIsNamedAfter,
  mergedRedirectAdmission,
  type MergedRedirectLead,
} from '../mergedRedirectIdentity';
import { listedPersonIsTheNamedLead } from '../utils/personNameAgreement';

const personRow = (name: string) => ({ name, entityType: 'FACULTY_RESEARCH_AREA' });
const lead = (displayName: string, netid = '', pages: string[] = []): MergedRedirectLead => ({
  displayName,
  netid,
  profileDestinations: pages,
});
const listing = (name: string, netids: string[] = [], pages: string[] = []) => ({
  ...personRow(`${name} Faculty Research`),
  slug: 'listing',
  netids,
  pageDestinations: pages,
});

describe('listedPersonIsTheNamedLead', () => {
  it.each([
    ['Ada Example', 'Ada Example'],
    ['A. Example', 'Ada Example'],
    ['Kate Example', 'Katherine Example'],
    ['Lee Ada Example', 'Ada Example'],
    ['Example Ada', 'Ada Example'],
    ['Annemarie Example', 'Anne Marie Example'],
    ['Ada Sampleexample', 'Ada Sample Example'],
  ])('agrees on %s and %s', (listed, named) => {
    expect(listedPersonIsTheNamedLead(listed, named)).toBe(true);
  });

  it.each([
    ['Adaline Example', 'Ada Example'],
    ['Al Example', 'Alan Example'],
    ['Ada Sample', 'Ada Example'],
    ['Mia Example', 'Ada Example'],
  ])('refuses %s for %s', (listed, named) => {
    expect(listedPersonIsTheNamedLead(listed, named)).toBe(false);
  });
});

describe('mergedRedirectAdmission', () => {
  const survivor = personRow('Ada Example Faculty Research');

  it('refuses a prefix pair with no witness', () => {
    expect(
      mergedRedirectAdmission(survivor, [lead('Ada Example', 'ae11')], listing('Adaline Example')),
    ).toBe('refused');
  });

  it('admits a prefix pair whose netid or page is the named lead', () => {
    const named = [lead('Ada Example', 'ae11', ['dept.yale.edu/people/ada-example'])];
    expect(mergedRedirectAdmission(survivor, named, listing('Adaline Example', ['AE11']))).toBe(
      'netid-witness',
    );
    expect(
      mergedRedirectAdmission(
        survivor,
        named,
        listing('Adaline Example', [], ['dept.yale.edu/people/ada-example']),
      ),
    ).toBe('page-witness');
  });

  it('never lets another lead on the row witness the listing', () => {
    const leads = [lead('Ada Example', 'ae11'), lead('Mia Sample', 'ms22', ['mia-page'])];
    const named = leadsTheRowIsNamedAfter(survivor, leads);
    expect(named.map((each) => each.displayName)).toEqual(['Ada Example']);
    expect(
      mergedRedirectAdmission(survivor, named, listing('Mia Sample', ['ms22'], ['mia-page'])),
    ).toBe('refused');
  });

  it('takes the one lead of a row titled after its lab as the lead it is named after', () => {
    const labTitled = personRow('Example Lab');
    expect(leadsTheRowIsNamedAfter(labTitled, [lead('Ada Example')])).toHaveLength(1);
    expect(leadsTheRowIsNamedAfter(labTitled, [lead('Ada Example'), lead('Mia Sample')])).toEqual(
      [],
    );
  });

  it('leaves a lab row and a lab listing to the merge', () => {
    expect(
      mergedRedirectAdmission(
        { name: 'Example Lab', entityType: 'LAB' },
        [],
        listing('Mia Sample'),
      ),
    ).toBe('not-a-person-redirect');
    expect(
      mergedRedirectAdmission(survivor, [], {
        ...listing('Mia Sample'),
        entityType: 'LAB',
      }),
    ).toBe('not-a-person-redirect');
  });
});
