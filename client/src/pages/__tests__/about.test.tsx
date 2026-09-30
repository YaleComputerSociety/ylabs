import { statSync } from 'fs';
import { join } from 'path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import About from '../about';

afterEach(() => {
  cleanup();
});

describe('About', () => {
  it('uses current y/labs naming for project history and links', () => {
    render(<About />);

    expect(screen.getByText(/y\/labs is a/)).toBeTruthy();
    expect(
      screen.getByText(/project that puts research at Yale in one searchable place/),
    ).toBeTruthy();
    expect(screen.queryByText(/collaboration between/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'y/labs alumni' })).toBeTruthy();
    expect(screen.getByText('Founder')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'y/labs GitHub' })).toBeTruthy();
    expect(screen.queryByText(/RDB/)).toBeNull();
  });

  it('labels organization logo links with full names', () => {
    render(<About />);

    expect(screen.getAllByRole('link', { name: 'Yale Computer Society website' }).length).toBe(1);
    expect(
      screen.queryByRole('link', { name: 'Yale Undergraduate Research Association website' }),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'y/cs Website' })).toBeNull();
  });

  it('keeps the feedback prompt current and below the main page heading', () => {
    render(<About />);

    expect(screen.getByRole('heading', { level: 2, name: 'Help improve y/labs' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: /first release/i })).toBeNull();
  });

  it('loads only card-sized team headshots and defers them until they scroll into view', () => {
    const maxHeadshotBytes = 450_000;
    const publicDir = join(__dirname, '../../../public');
    const { container } = render(<About />);

    const headshots = Array.from(container.querySelectorAll('img')).filter((image) =>
      (image.getAttribute('src') ?? '').startsWith('/assets/developers/'),
    );

    expect(headshots.length).toBeGreaterThan(0);
    for (const image of headshots) {
      const src = image.getAttribute('src') ?? '';
      expect(statSync(join(publicDir, decodeURI(src))).size).toBeLessThanOrEqual(maxHeadshotBytes);
      expect(image.getAttribute('loading')).toBe('lazy');
      expect(image.getAttribute('decoding')).toBe('async');
    }
  });
});
