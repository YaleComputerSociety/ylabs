import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LabScholarlyActivitySection from '../LabScholarlyActivitySection';
import type { LabMember, LabScholarlyLink } from '../../../types/labDetail';

const entityLink: LabScholarlyLink = {
  _id: 'entity-link-1',
  title: 'Entity-level scholarly work',
  url: 'https://example.edu/entity-paper',
  destinationKind: 'DOI',
  displaySource: 'Publisher',
  discoveredVia: 'OFFICIAL_PROFILE',
};

const member: LabMember = {
  role: 'pi',
  user: {
    publicKey: 'fixture-pi',
    fname: 'First',
    lname: 'Investigator',
    displayName: 'First Investigator',
  },
};

const memberLink: LabScholarlyLink = {
  _id: 'member-link-1',
  memberKey: 'fixture-pi',
  title: 'Member-attributed scholarly work',
  url: 'https://example.edu/member-paper',
  destinationKind: 'ORCID',
  displaySource: 'ORCID',
  discoveredVia: 'ORCID',
};

describe('LabScholarlyActivitySection', () => {
  it('renders nothing when both link sources are empty', () => {
    const { container } = render(
      <LabScholarlyActivitySection scholarlyLinks={[]} memberScholarlyLinks={[]} members={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders entity-level scholarly links', () => {
    render(
      <LabScholarlyActivitySection
        scholarlyLinks={[entityLink]}
        memberScholarlyLinks={[]}
        members={[]}
      />,
    );

    expect(screen.getByText('Entity-level scholarly work')).toBeTruthy();
  });

  it('renders member-level scholarly links attributed to the matching roster member', () => {
    render(
      <LabScholarlyActivitySection
        scholarlyLinks={[]}
        memberScholarlyLinks={[memberLink]}
        members={[member]}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'First Investigator' });
    const group = heading.closest('div');
    expect(group).toBeTruthy();
    expect(within(group as HTMLElement).getByText('Member-attributed scholarly work')).toBeTruthy();
  });

  it('drops a member-level link with no matching current roster member', () => {
    const { container } = render(
      <LabScholarlyActivitySection
        scholarlyLinks={[]}
        memberScholarlyLinks={[memberLink]}
        members={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Member-attributed scholarly work')).toBeNull();
  });
});
