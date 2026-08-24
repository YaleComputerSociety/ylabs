import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchAreaPivotChip from '../ResearchAreaPivotChip';
import ConfigContext, {
  defaultConfigContext,
  type ResearchAreaConfig,
} from '../../../contexts/ConfigContext';

const CANONICAL_AREAS: ResearchAreaConfig[] = [
  { name: 'Neuroscience', field: 'Life Sciences', colorKey: 'blue', isDefault: false },
  { name: 'Machine Learning', field: 'Engineering', colorKey: 'green', isDefault: false },
];

const areaByLowerName = new Map(CANONICAL_AREAS.map((area) => [area.name.toLowerCase(), area]));

const renderChip = (
  label: string,
  { initialPath = '/research' }: { initialPath?: string } = {},
) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConfigContext.Provider
        value={{
          ...defaultConfigContext,
          researchAreas: CANONICAL_AREAS,
          getResearchAreaByName: (name: string) => areaByLowerName.get(name.toLowerCase()),
        }}
      >
        <ResearchAreaPivotChip
          label={label}
          staticClassName="static-pill"
          interactiveClassName="interactive-pill"
        />
      </ConfigContext.Provider>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
});

describe('ResearchAreaPivotChip', () => {
  it('links a canonical research area to its pre-filtered browse URL', () => {
    renderChip('neuroscience');

    const link = screen.getByRole('link', { name: 'Browse Neuroscience research homes' });
    expect(link.getAttribute('href')).toBe('/research?researchAreas=Neuroscience');
    expect(link.className).toContain('interactive-pill');
  });

  it('renders a non-area label as an inert display pill', () => {
    renderChip('systems modeling');

    expect(screen.queryByRole('link')).toBeNull();
    const pill = screen.getByText('Systems Modeling');
    expect(pill.tagName).toBe('SPAN');
    expect(pill.className).toContain('static-pill');
  });

  it('appends to the current area selection while browsing a filtered area', () => {
    renderChip('machine learning', {
      initialPath: '/research?researchAreas=Neuroscience',
    });

    const link = screen.getByRole('link', { name: 'Browse Machine Learning research homes' });
    const params = new URLSearchParams(link.getAttribute('href')!.split('?')[1]);
    expect((params.get('researchAreas') || '').split(',')).toEqual([
      'Neuroscience',
      'Machine Learning',
    ]);
  });

  it('stops chip activation from bubbling to a clickable ancestor', () => {
    const onAncestorClick = vi.fn();
    render(
      <MemoryRouter initialEntries={['/research']}>
        <ConfigContext.Provider
          value={{
            ...defaultConfigContext,
            researchAreas: CANONICAL_AREAS,
            getResearchAreaByName: (name: string) => areaByLowerName.get(name.toLowerCase()),
          }}
        >
          <div onClick={onAncestorClick}>
            <ResearchAreaPivotChip
              label="Neuroscience"
              staticClassName="static-pill"
              interactiveClassName="interactive-pill"
            />
          </div>
        </ConfigContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Browse Neuroscience research homes' }));
    expect(onAncestorClick).not.toHaveBeenCalled();
  });
});
