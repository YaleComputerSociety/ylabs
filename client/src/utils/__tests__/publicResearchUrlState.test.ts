import { describe, expect, it } from 'vitest';
import {
  parsePublicResearchUrlState,
  serializePublicResearchUrlState,
} from '../publicResearchUrlState';

describe('public research URL state', () => {
  it('parses public-safe search criteria from the URL', () => {
    const state = parsePublicResearchUrlState(
      '?query=cell%20signaling&departments=Computer%20Science%7C%7CBiology&academicDisciplines=Life%20Sciences&researchAreas=Genomics,Artificial%20Intelligence&researchAreasMode=intersection&sortBy=updatedAt&sortOrder=-1&quickFilter=open',
    );

    expect(state).toMatchObject({
      queryString: 'cell signaling',
      selectedDepartments: ['Computer Science', 'Biology'],
      selectedResearchAreas: ['Life Sciences'],
      selectedListingResearchAreas: ['Genomics', 'Artificial Intelligence'],
      listingResearchAreasFilterMode: 'intersection',
      sortBy: 'updatedAt',
      sortOrder: -1,
      sortDirection: 'desc',
      quickFilter: 'open',
    });
  });

  it('drops private or unsupported URL fields while parsing', () => {
    const state = parsePublicResearchUrlState(
      '?ownerEmail=ada@yale.edu&sortBy=ownerEmail&sortOrder=-1&quickFilter=private&departmentsMode=all',
    );

    expect(state.sortBy).toBe('default');
    expect(state.quickFilter).toBeNull();
    expect(state.departmentsFilterMode).toBe('union');
  });

  it('serializes only meaningful public search criteria', () => {
    const search = serializePublicResearchUrlState({
      queryString: '  neuroscience  ',
      selectedDepartments: ['Computer Science', ''],
      selectedResearchAreas: ['Life Sciences'],
      selectedListingResearchAreas: ['Genomics', 'AI'],
      departmentsFilterMode: 'union',
      researchAreasFilterMode: 'intersection',
      listingResearchAreasFilterMode: 'intersection',
      sortBy: 'createdAt',
      sortOrder: -1,
      sortDirection: 'desc',
      quickFilter: 'recent',
    });

    expect(search).toBe(
      '?query=neuroscience&departments=Computer+Science&academicDisciplines=Life+Sciences&researchAreas=Genomics%2CAI&researchAreasMode=intersection&sortBy=createdAt&sortOrder=-1&quickFilter=recent',
    );
  });
});
