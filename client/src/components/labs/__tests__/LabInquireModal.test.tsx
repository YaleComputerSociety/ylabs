import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LabInquireModal from '../LabInquireModal';
import type { ResearchGroup } from '../../../types/researchGroup';

const baseGroup: ResearchGroup = {
  _id: 'group-1',
  slug: 'unsafe-mailto-lab',
  name: 'Unsafe Mailto Lab',
  kind: 'lab',
  description: 'Studies safe contact routes.',
  websiteUrl: 'https://lab.example.edu',
  location: '',
  departments: ['Computer Science'],
  researchAreas: ['Security'],
  school: 'Yale College',
  openness: 'unknown',
  acceptingUndergrads: false,
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: [],
};

describe('LabInquireModal', () => {
  it('does not build a mailto link when the outreach email contains injected headers', () => {
    const { container } = render(
      <LabInquireModal
        isOpen
        onClose={vi.fn()}
        group={{
          ...baseGroup,
          contactEmail: 'lab-contact@example.edu?bcc=attacker@example.test',
          contactName: 'Lab Contact',
        }}
        members={[]}
      />,
    );

    expect(screen.getByText('Inquire about Unsafe Mailto Lab')).toBeTruthy();
    expect(screen.queryByText('lab-contact@example.edu?bcc=attacker@example.test')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('offers an approved official route without rendering an email', () => {
    const onOfficialRouteOpen = vi.fn();
    render(
      <LabInquireModal
        isOpen
        onClose={vi.fn()}
        group={baseGroup}
        members={[]}
        contactRoutes={[
          {
            routeType: 'PROGRAM_MANAGER',
            label: 'Undergraduate research contact form',
            url: 'https://research.yale.edu/contact',
            sourceUrl: 'https://research.yale.edu/about',
            reviewStatus: 'approved',
            visibility: 'PUBLIC',
            contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          },
        ]}
        onOfficialRouteOpen={onOfficialRouteOpen}
      />,
    );

    const link = screen.getByRole('link', { name: 'Open approved route' });
    expect(link.getAttribute('href')).toBe('https://research.yale.edu/contact');
    link.click();
    expect(onOfficialRouteOpen).toHaveBeenCalledOnce();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
