import { describe, expect, it } from 'vitest';
import {
  firstUsableResearchWebsiteUrl,
  isDepartmentFacultyListUrl,
  isGenericResearchWebsiteIndexUrl,
  isUsableResearchWebsiteUrl,
} from '../researchWebsiteUrl';

describe('researchWebsiteUrl', () => {
  it('detects department faculty-list pages as generic index pages', () => {
    const url =
      'https://www.engineering.yale.edu/academic-study/departments/example/faculty/load_faculty/';

    expect(isDepartmentFacultyListUrl(url)).toBe(true);
    expect(isGenericResearchWebsiteIndexUrl(url)).toBe(true);
    expect(isUsableResearchWebsiteUrl(url)).toBe(false);
  });

  it('does not treat lookalike non-Yale domains as department faculty-list pages', () => {
    const url = 'https://notyale.edu/people/faculty/example-person';

    expect(isDepartmentFacultyListUrl(url)).toBe(false);
    expect(isGenericResearchWebsiteIndexUrl(url)).toBe(false);
    expect(isUsableResearchWebsiteUrl(url)).toBe(true);
  });

  it('prefers a lab website over a faculty profile within the same candidate set', () => {
    expect(
      firstUsableResearchWebsiteUrl([
        ['https://medicine.yale.edu/profile/example-person/', ' https://examplelab.yale.edu/ '],
      ]),
    ).toBe('https://examplelab.yale.edu/');
  });
});
