import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import IdentityConfidenceCard from '../IdentityConfidenceCard';

describe('IdentityConfidenceCard', () => {
  it('renders literal identity labels and same-name ambiguity', () => {
    const { container } = render(
      <MemoryRouter>
        <IdentityConfidenceCard
          identity={{
            id: 'ada-cs',
            name: 'Ada Lovelace',
            departments: ['Computer Science'],
            affiliations: ['Yale College'],
            labName: 'Mechanism Design Group',
            labSlug: 'mechanism-design-group',
            profileUrl: '/profile/al123',
            sourceCount: 3,
            identityLabel: 'Identity: Yale-confirmed',
            matchLabel: 'Paper match: high',
            ambiguityLabel: 'Possible same-name ambiguity',
            evidence: [
              {
                claim: 'Matched through Yale profile and research metadata.',
                sourceType: 'Profile metadata',
                confidence: 'high',
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('Computer Science');
    expect(container.textContent).toContain('Yale College');
    expect(container.textContent).toContain('Lab: Mechanism Design Group');
    expect(container.textContent).toContain('Identity: Yale-confirmed');
    expect(container.textContent).toContain('Paper match: high');
    expect(container.textContent).toContain('Possible same-name ambiguity');
    expect(container.textContent).toContain('Source count: 3');
    expect(container.querySelector('a[href="/profile/al123"]')).not.toBeNull();
    expect(container.querySelector('a[href="/research/mechanism-design-group"]')).not.toBeNull();
  });
});
