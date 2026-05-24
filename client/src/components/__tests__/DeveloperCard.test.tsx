import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DeveloperCard from '../DeveloperCard';

afterEach(() => {
  cleanup();
});

describe('DeveloperCard', () => {
  it('labels GitHub and website profile links distinctly', () => {
    render(
      <DeveloperCard
        developer={{
          name: 'Avery Tester',
          position: 'Developer',
          location: 'New Haven, CT',
          website: 'https://example.com',
          github: 'https://github.com/example',
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Avery Tester Website' })).toBeTruthy();
    const github = screen.getByRole('link', { name: 'Avery Tester GitHub' });
    expect(github).toBeTruthy();
    expect(github.getAttribute('aria-label')).toBe('Avery Tester GitHub');
  });

  it('keeps icon-only profile links large enough for touch input', () => {
    render(
      <DeveloperCard
        developer={{
          name: 'Avery Tester',
          position: 'Developer',
          location: 'New Haven, CT',
          website: 'https://example.com',
          linkedin: 'https://www.linkedin.com/in/example',
          github: 'https://github.com/example',
        }}
      />,
    );

    for (const name of ['Avery Tester Website', 'Avery Tester LinkedIn', 'Avery Tester GitHub']) {
      const link = screen.getByRole('link', { name });

      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('min-w-[44px]');
    }
  });
});
