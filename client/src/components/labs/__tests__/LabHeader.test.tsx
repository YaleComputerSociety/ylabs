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
  slug: 'fixture-research-home',
  name: 'Fixture Research Home',
  kind: 'lab',
  description: 'We study fixture systems.',
  websiteUrl: 'https://fixture.example.test/research-home',
  location: 'Fixture Hall, Room 200',
  departments: ['Computer Science', 'Mathematics'],
  researchAreas: ['Theoretical CS'],
  school: 'Fixture School of Research',
  openness: 'open',
  acceptingUndergrads: true,
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: 'contact@example.test',
  contactName: 'Fixture Contact',
  contactRole: 'PI',
  sourceUrls: [],
};

describe('LabHeader', () => {
  it('renders the lab name as an h1 without repeating the description', () => {
    const { container } = render(<LabHeader group={baseGroup} />);
    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toBe('Fixture Research Home');
    expect(container.textContent).not.toContain('We study fixture systems.');
    expect(container.textContent).toContain('Fixture School of Research');
    expect(container.textContent).toContain('Fixture Hall, Room 200');
  });

  it('renders all departments and a lab website link with the correct href', () => {
    const { container } = render(<LabHeader group={baseGroup} />);
    expect(container.textContent).toContain('Computer Science');
    expect(container.textContent).toContain('Mathematics');
    const websiteLink = container.querySelector('a[href*="fixture.example.test/research-home"]');
    expect(websiteLink).not.toBeNull();
    expect(websiteLink?.getAttribute('target')).toBe('_blank');
    expect(websiteLink?.textContent).toContain('Visit lab website');
  });

  it('does not render research-area chips in the detail header', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          departments: ['Computer Science'],
          researchAreas: ['Computer Science', 'Algorithms'],
        }}
      />,
    );

    expect(container.textContent?.match(/Computer Science/g)).toHaveLength(1);
    expect(container.textContent).not.toContain('Algorithms');
  });

  it('hides profile fallback research-area chips', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          researchAreas: [],
          profileResearchAreas: ['Fixture Topic Alpha'],
          researchAreaSource: 'PI_PROFILE_FALLBACK',
        }}
      />,
    );

    expect(container.textContent).not.toContain('PI research interests');
    expect(container.textContent).not.toContain('Fixture Topic Alpha');
  });

  it('keeps the Lab badge for real lab entities with PI-profile synthesis fallback text', () => {
    const { container } = render(
      <LabHeader
        group={{
          ...baseGroup,
          description: '',
          shortDescription: '',
          fullDescription: '',
          descriptionSource: 'PI_PROFILE_SYNTHESIS',
          kind: 'lab',
          entityType: 'LAB',
        }}
      />,
    );

    expect(container.textContent).toContain('Lab');
    expect(container.textContent).not.toContain('Faculty Research');
  });

  it('hides the website link when websiteUrl is empty', () => {
    const { container } = render(
      <LabHeader group={{ ...baseGroup, websiteUrl: '' }} />,
    );
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
          pastUndergradAdvisees: [{ year: 2024, programName: 'Fixture Program', count: 1 }],
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
          pastUndergradAdvisees: [{ year: 2024, programName: 'Fixture Program', count: 2 }],
          currentUndergradCount: 3,
        }}
        hasActivePostedOpportunity={false}
      />,
    );
    const pill = container.querySelector('[data-verdict]');
    expect(pill?.getAttribute('data-verdict')).toBe('verified-accepting');
  });

  it('shows "Limited access evidence" when acceptingUndergrads=false', () => {
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
    expect(pill?.textContent).toBe('Limited access evidence');
  });

  it('honors active posted opportunities as a strong signal', () => {
    const { container } = render(
      <LabHeader group={baseGroup} hasActivePostedOpportunity={true} />,
    );
    const pill = container.querySelector('[data-verdict]');
    // 1 strong signal → likely-accepting
    expect(pill?.getAttribute('data-verdict')).toBe('likely-accepting');
  });
});
