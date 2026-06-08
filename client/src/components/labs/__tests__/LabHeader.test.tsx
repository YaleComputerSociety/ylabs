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
  openness: 'open',
  acceptingUndergrads: true,
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
    const { container } = render(
      <LabHeader group={{ ...baseGroup, websiteUrl: '' }} />,
    );
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

describe('LabHeader trust-gradient pill', () => {
  it('shows "Evidence unknown" when there are no positive signals', () => {
    const { container } = render(<LabHeader group={baseGroup} />);
    const pill = container.querySelector('[data-verdict]');
    expect(pill?.getAttribute('data-verdict')).toBe('unknown');
    expect(pill?.textContent).toBe('Evidence unknown');
  });

  it('shows "Strong evidence" when the PI manually confirmed', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          manuallyLockedFields: ['acceptingUndergrads'],
          acceptingUndergrads: true,
        }}
      />,
    );
    const pill = container.querySelector('[data-verdict]');
    expect(pill?.getAttribute('data-verdict')).toBe('verified-accepting');
    expect(pill?.textContent).toBe('Strong evidence');
  });

  it('shows "Some evidence" with a single strong signal (past advisees)', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          pastUndergradAdvisees: [{ year: 2024, programName: 'STARS', count: 1 }],
        }}
      />,
    );
    const pill = container.querySelector('[data-verdict]');
    expect(pill?.getAttribute('data-verdict')).toBe('likely-accepting');
    expect(pill?.textContent).toBe('Some evidence');
  });

  it('shows "Strong evidence" when there are 2+ strong signals', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          pastUndergradAdvisees: [{ year: 2024, programName: 'STARS', count: 2 }],
          currentUndergradCount: 3,
        }}
        hasActivePostedOpportunity={false}
      />,
    );
    const pill = container.querySelector('[data-verdict]');
    expect(pill?.getAttribute('data-verdict')).toBe('verified-accepting');
  });

  it('shows "Not currently available" when acceptingUndergrads=false', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          acceptingUndergrads: false,
          manuallyLockedFields: ['acceptingUndergrads'],
        }}
      />,
    );
    const pill = container.querySelector('[data-verdict]');
    expect(pill?.getAttribute('data-verdict')).toBe('not-accepting');
    expect(pill?.textContent).toBe('Not currently available');
  });

  it('honors hasActivePostedOpportunity prop as a strong signal', () => {
    const { container } = render(
      <LabHeader group={baseGroup} hasActivePostedOpportunity={true} />,
    );
    const pill = container.querySelector('[data-verdict]');
    // 1 strong signal → likely-accepting
    expect(pill?.getAttribute('data-verdict')).toBe('likely-accepting');
  });
});
