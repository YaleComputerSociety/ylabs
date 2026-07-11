import { describe, expect, it } from 'vitest';
import { profileSaveMatches } from '../ProfileEditor';

const submitted = {
  bio: 'A bio',
  primaryDepartment: 'Computer Science',
  secondaryDepartments: ['Statistics and Data Science'],
  researchInterests: ['Security'],
  imageUrl: 'https://faculty.yale.edu/profile.jpg',
};

describe('ProfileEditor save contract', () => {
  it('accepts a round trip containing all five editable fields', () => {
    expect(
      profileSaveMatches(submitted, {
        bio: 'A bio',
        primary_department: 'Computer Science',
        secondary_departments: ['Statistics and Data Science'],
        research_interests: ['Security'],
        image_url: 'https://faculty.yale.edu/profile.jpg',
      }),
    ).toBe(true);
  });

  it('rejects a response that silently drops or changes any submitted field', () => {
    expect(profileSaveMatches(submitted, { ...submitted, researchInterests: [] })).toBe(false);
  });
});
