/**
 * Smoke render test for LabHeader.
 *
 * Uses only built-in vitest assertions (no `@testing-library/jest-dom`)
 * because the project's vitest config does not register setupFiles for
 * jest-dom matchers. We assert on text content / attributes directly.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import LabHeader from '../LabHeader';
import { ResearchGroup } from '../../../types/researchGroup';

const baseGroup: ResearchGroup = {
  _id: 'g1',
  slug: 'lovelace-lab',
  name: 'Lovelace Computational Lab',
  kind: 'lab',
  description: 'We study analytical engines.',
  websiteUrl: 'https://example.edu/lovelace',
  location: 'Watson Center, Room 200',
  departments: ['Computer Science', 'Mathematics'],
  researchAreas: ['Theoretical CS'],
  school: 'School of Engineering & Applied Science',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: 'ada@example.edu',
  contactName: 'Ada Lovelace',
  contactRole: 'PI',
  sourceUrls: [],
};

describe('LabHeader', () => {
  it('renders the lab name, school, and location', () => {
    const { container } = render(<LabHeader group={baseGroup} />);
    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toBe('Lovelace Computational Lab');
    expect(container.textContent).toContain('School of Engineering & Applied Science');
    expect(container.textContent).toContain('Watson Center, Room 200');
  });

  it('renders all departments and a website link with the correct href', () => {
    const { container } = render(<LabHeader group={baseGroup} />);
    expect(container.textContent).toContain('Computer Science');
    expect(container.textContent).toContain('Mathematics');
    const websiteLink = container.querySelector('a[href*="example.edu/lovelace"]');
    expect(websiteLink).not.toBeNull();
    expect(websiteLink?.getAttribute('target')).toBe('_blank');
    expect(websiteLink?.textContent).toContain('Visit lab website');
  });

  it('hides the website link when websiteUrl is empty', () => {
    const { container } = render(<LabHeader group={{ ...baseGroup, websiteUrl: '' }} />);
    expect(container.textContent).not.toContain('Visit lab website');
  });

  it('uses research website wording for faculty research profiles', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          name: 'Abraham Silberschatz Faculty Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          websiteUrl: 'https://codex.cs.yale.edu/avi/',
        }}
      />,
    );

    expect(container.textContent).toContain('Faculty Research');
    expect(container.textContent).toContain('Visit research website');
    expect(container.textContent).not.toContain('Visit lab website');
  });

  it('uses program wording for program profiles', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          name: 'Molecular Biophysics and Biochemistry Undergraduate Research',
          kind: 'program',
          entityType: 'PROGRAM',
          websiteUrl: 'https://mbb.yale.edu/introduction-undergraduate-program',
        }}
      />,
    );

    expect(container.textContent).toContain('Program');
    expect(container.textContent).toContain('Visit program website');
    expect(container.textContent).not.toContain('Visit lab website');
  });
});

describe('LabHeader signal-only header', () => {
  it('renders no verdict-tier badge', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          pastUndergradAdvisees: [{ year: 2024, programName: 'STARS', count: 2 }],
          currentUndergradCount: 3,
        }}
      />,
    );
    expect(container.querySelector('[data-verdict]')).toBeNull();
    expect(container.textContent).not.toContain('Strong evidence');
    expect(container.textContent).not.toContain('Some evidence');
    expect(container.textContent).not.toContain('Not currently available');
    expect(container.textContent).not.toContain('Evidence unknown');
  });
});
