import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LabInquireCard from '../LabInquireCard';
import type { ResearchGroup } from '../../../types/researchGroup';

const baseGroup: ResearchGroup = {
  _id: 'group-1',
  slug: 'unsafe-mailto-card-lab',
  name: 'Unsafe Mailto Card Lab',
  kind: 'lab',
  description: 'Studies safe contact routes.',
  websiteUrl: 'https://lab.example.edu',
  location: '',
  departments: ['Computer Science'],
  researchAreas: ['Security'],
  school: 'Yale College',
  openness: 'unknown',
  acceptingUndergrads: true,
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: [],
};

describe('LabInquireCard', () => {
  it('does not offer an inline outreach draft when the listed contact email is unsafe', () => {
    const { container } = render(
      <LabInquireCard
        group={{
          ...baseGroup,
          contactEmail: 'lab-contact@example.edu?bcc=attacker@example.test',
          contactName: 'Lab Contact',
        }}
        members={[]}
        onInquire={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Draft outreach email' })).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).toContain('No contact information available yet.');
  });
});
