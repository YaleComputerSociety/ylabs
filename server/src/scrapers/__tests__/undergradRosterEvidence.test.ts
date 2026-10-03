import { describe, expect, it } from 'vitest';
import {
  isLabRosterCitationUrl,
  isRecruitingOrContactPageUrl,
  pageListsPeople,
  rosterSnippetNamesAPerson,
} from '../undergradRosterEvidence';

describe('rosterSnippetNamesAPerson (#4430)', () => {
  it.each([
    'Riley Example',
    'Riley ExampleUndergraduate Student',
    'Undergraduate: Avery Sample',
    'Current: Avery Sample',
    'Undergrad Students Quinn Fixture Contact: [email redacted]',
    'Morgan is an undergraduate student at Yale majoring in Physics.',
    'Taylor Example (Computer Science BS Candidate)',
  ])('reads %s as naming a person', (snippet) => {
    expect(rosterSnippetNamesAPerson(snippet)).toBe(true);
  });

  it.each([
    'Undergraduate Students',
    'Undergraduate Research Assistants',
    'We welcome undergraduates interested in example systems.',
    'Undergraduates help with field work.',
    'Several Yale College students work in the lab.',
    '',
  ])('reads %s as naming no one', (snippet) => {
    expect(rosterSnippetNamesAPerson(snippet)).toBe(false);
  });
});

describe('pageListsPeople and isRecruitingOrContactPageUrl (#4430)', () => {
  it('accepts a roster page by its address or by a roster heading', () => {
    expect(pageListsPeople('https://examplelab.org/people', '')).toBe(true);
    expect(pageListsPeople('https://examplelab.org/LabMembers', '')).toBe(true);
    expect(pageListsPeople('https://examplelab.org/example-team-0', '')).toBe(true);
    expect(
      pageListsPeople('https://example.yale.edu/profile/example-pi', 'Undergraduate Students'),
    ).toBe(true);
  });

  it('refuses a join, opportunities or contact page whatever it says', () => {
    for (const url of [
      'https://examplelab.org/join-us',
      'https://examplelab.org/opportunities',
      'https://examplelab.org/contact-2/',
      'https://examplelab.org/open-positions.html',
    ]) {
      expect(isRecruitingOrContactPageUrl(url)).toBe(true);
      expect(pageListsPeople(url, 'Lab Members Riley Example')).toBe(false);
    }
  });

  it('refuses a home page with no roster heading', () => {
    expect(pageListsPeople('https://examplelab.org/', 'We study example systems.')).toBe(false);
  });
});

describe('isLabRosterCitationUrl (#4430)', () => {
  const lab = { websiteUrl: 'https://examplelab.org/', entityType: 'LAB', kind: 'lab' };
  const schoolLab = {
    websiteUrl: 'https://school.yale.edu/lab/example/',
    entityType: 'LAB',
    kind: 'lab',
  };

  it("accepts the lab's own people page", () => {
    expect(isLabRosterCitationUrl('https://examplelab.org/people', lab)).toBe(true);
    expect(isLabRosterCitationUrl('https://school.yale.edu/lab/example/people/', schoolLab)).toBe(
      true,
    );
  });

  it("refuses a shared school host's roster outside the row's own section", () => {
    expect(isLabRosterCitationUrl('https://school.yale.edu/people', schoolLab)).toBe(false);
  });

  it('refuses a page that is not a roster', () => {
    expect(isLabRosterCitationUrl('https://examplelab.org/join-us', lab)).toBe(false);
    expect(isLabRosterCitationUrl('https://examplelab.org/', lab)).toBe(false);
  });
});
