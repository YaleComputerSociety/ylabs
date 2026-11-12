import { describe, expect, it } from 'vitest';
import {
  buildNameAgreedSharedPersonResearchEntityDedupePlan,
  groupConflatesDistinctPersonProfiles,
  namesStateConflictingMiddleInitials,
  personProfileIdentityFromUrl,
  type ResearchEntityPiDedupeRow,
} from '../researchEntityPiDedupeCore';

const NURSING = 'https://nursing.yale.edu/faculty-research/faculty-directory';

describe('nursing credentials do not split one person into two profiles (#5969)', () => {
  it.each([
    `${NURSING}/ada-alpha-phd-mph-bsn`,
    `${NURSING}/ada-alpha-phd-aprn-fnp-c-achpn-fpcn-faha-faan`,
    `${NURSING}/ada-alpha-dnp-msn-rn`,
    `${NURSING}/ada-alpha-phd-pmhnp-bc`,
  ])('reads %s as the same person', (url) => {
    expect(personProfileIdentityFromUrl(url)).toBe(
      personProfileIdentityFromUrl(`${NURSING}/ada-alpha`),
    );
  });

  it('no longer quarantines one person cited by a plain and a credentialed profile', () => {
    expect(
      groupConflatesDistinctPersonProfiles({
        mergedSourceUrls: [
          `${NURSING}/ada-alpha-phd-mph-bsn`,
          'https://medicine.yale.edu/profile/ada-alpha/',
        ],
      }),
    ).toBe(false);
  });

  it('still tells two different people apart', () => {
    expect(
      groupConflatesDistinctPersonProfiles({
        mergedSourceUrls: [`${NURSING}/ada-alpha-phd-bsn`, `${NURSING}/bram-orlo-dnp`],
      }),
    ).toBe(true);
  });

  it('never strips a credential that would leave fewer than two name tokens', () => {
    expect(personProfileIdentityFromUrl(`${NURSING}/alpha-bsn`)).toBe(
      personProfileIdentityFromUrl(`${NURSING}/alpha-bsn`),
    );
    expect(personProfileIdentityFromUrl(`${NURSING}/alpha-bsn`)).not.toBe('alpha');
  });
});

describe('namesakes under one lead are refused on a stated reason (#5969)', () => {
  const row = (entities: ResearchEntityPiDedupeRow['entities']): ResearchEntityPiDedupeRow => ({
    userId: 'researcher-1',
    normalizedName: 'same-pi:researcher-1',
    entities,
  });

  it('two names stating different middle initials are two people', () => {
    expect(
      namesStateConflictingMiddleInitials([
        'Ada Q. Alpha Faculty Research',
        'Ada R. Alpha Faculty Research',
      ]),
    ).toBe(true);
    expect(
      namesStateConflictingMiddleInitials([
        'Ada Q. Alpha Faculty Research',
        'Ada Alpha Faculty Research',
      ]),
    ).toBe(false);
    expect(
      namesStateConflictingMiddleInitials([
        'Ada Q. Alpha Faculty Research',
        'Ada Q Alpha Research',
      ]),
    ).toBe(false);
  });

  it('refuses the namesake pair even when one cited page is a department page and not a person', () => {
    const plan = buildNameAgreedSharedPersonResearchEntityDedupePlan([
      row([
        {
          id: 'medicine-row',
          slug: 'medicine-row',
          name: 'Ada Q. Alpha Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrls: ['https://medicine.yale.edu/profile/ada-alpha/'],
        },
        {
          id: 'management-row',
          slug: 'management-row',
          name: 'Ada R. Alpha Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrls: ['https://economics.yale.edu/people/economics'],
        },
      ]),
    ]);
    expect(plan).toEqual([]);
  });

  it('still groups a name with and without the same initial', () => {
    const plan = buildNameAgreedSharedPersonResearchEntityDedupePlan([
      row([
        {
          id: 'a',
          slug: 'a',
          name: 'Ada Q. Alpha Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
        },
        {
          id: 'b',
          slug: 'b',
          name: 'Ada Alpha Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
        },
      ]),
    ]);
    expect(plan).toHaveLength(1);
  });
});
