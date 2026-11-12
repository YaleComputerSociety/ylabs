import { describe, expect, it } from 'vitest';
import {
  buildNameAgreedSharedPersonResearchEntityDedupePlan,
  distinctPersonProfileIdentities,
  groupConflatesDistinctPersonProfiles,
} from '../researchEntityPiDedupeCore';

const DIRECTORY = 'https://som.yale.edu/faculty-research/faculty-directory';

describe('a directory listing for the row’s own department is not a second person (#5969)', () => {
  it('reads a one-word page naming the row’s own department as that department’s listing', () => {
    expect(
      distinctPersonProfileIdentities([`${DIRECTORY}/ada-alpha`, `${DIRECTORY}/accounting`], {
        departments: ['Accounting'],
      }),
    ).toEqual(['ada-alpha']);
    expect(
      groupConflatesDistinctPersonProfiles({
        mergedSourceUrls: [`${DIRECTORY}/ada-alpha`, `${DIRECTORY}/operations-and-research`],
        mergedDepartments: ['Operations & Research'],
      }),
    ).toBe(false);
  });

  it('keeps a one-word page a person when it names none of the row’s departments', () => {
    expect(
      groupConflatesDistinctPersonProfiles({
        mergedSourceUrls: [`${DIRECTORY}/ada-alpha`, `${DIRECTORY}/accounting`],
        mergedDepartments: ['Finance'],
      }),
    ).toBe(true);
    expect(
      groupConflatesDistinctPersonProfiles({
        mergedSourceUrls: [
          'https://example.edu/profile/clark',
          'https://example.edu/profile/ada-lovelace',
        ],
      }),
    ).toBe(true);
  });

  it('never drops a full-name page even when it spells a department', () => {
    expect(
      distinctPersonProfileIdentities([`${DIRECTORY}/ada-alpha`, `${DIRECTORY}/bram-orlo`], {
        departments: ['Bram Orlo'],
      }),
    ).toEqual(['ada-alpha', 'bram-orlo']);
  });

  it('refuses namesakes cited with their department listing on their stated middle initials', () => {
    const plan = buildNameAgreedSharedPersonResearchEntityDedupePlan([
      {
        userId: 'researcher-1',
        normalizedName: 'same-pi:researcher-1',
        entities: [
          {
            id: 'medicine-row',
            slug: 'medicine-row',
            name: 'Ada Q. Alpha Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            departments: ['Laboratory Medicine'],
            sourceUrls: ['https://medicine.yale.edu/profile/ada-alpha/'],
          },
          {
            id: 'management-row',
            slug: 'management-row',
            name: 'Ada R. Alpha Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            departments: ['Economics'],
            sourceUrls: [`${DIRECTORY}/ada-alpha`, `${DIRECTORY}/economics`],
          },
        ],
      },
    ]);
    expect(plan).toEqual([]);
    expect(
      groupConflatesDistinctPersonProfiles({
        mergedSourceUrls: [
          'https://medicine.yale.edu/profile/ada-alpha/',
          `${DIRECTORY}/ada-alpha`,
          `${DIRECTORY}/economics`,
        ],
        mergedDepartments: ['Laboratory Medicine', 'Economics'],
      }),
    ).toBe(false);
  });
});
