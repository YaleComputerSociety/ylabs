import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ResearchHomeComparison from '../ResearchHomeComparison';
import { trackResearchEvent } from '../../../utils/researchAnalytics';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../../../utils/researchAnalytics', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  );
  return { ...actual, trackResearchEvent: vi.fn().mockResolvedValue(undefined) };
});

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };
const mockedTrack = trackResearchEvent as unknown as ReturnType<typeof vi.fn>;

const entityA = {
  _id: 'a',
  slug: 'lab-a',
  name: 'Lab A',
  school: 'School of Engineering',
  departments: ['Computer Science'],
  researchAreas: ['Robotics', 'Vision'],
  shortDescription: 'Studies autonomous robots.',
  websiteUrl: 'https://engineering.example.edu/lab-a',
  sourceUrls: [],
  currentUndergradCount: 3,
};

const entityB = {
  _id: 'b',
  slug: 'lab-b',
  name: 'Lab B',
  school: '',
  departments: [],
  researchAreas: [],
  shortDescription: '',
  websiteUrl: '',
  sourceUrls: [],
};

const mockDetailBySlug = (
  bySlug: Record<string, unknown>,
  accessSignalsBySlug: Record<string, unknown[]> = {},
) => {
  mockedAxios.get.mockImplementation((url: string) => {
    const slug = url.replace('/research/', '');
    const entity = bySlug[slug];
    if (!entity) return Promise.reject(new Error('not found'));
    return Promise.resolve({
      data: { researchEntity: entity, accessSignals: accessSignalsBySlug[slug] || [] },
    });
  });
};

const selection = [
  { _id: 'a', slug: 'lab-a', name: 'Lab A' },
  { _id: 'b', slug: 'lab-b', name: 'Lab B' },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResearchHomeComparison', () => {
  it('renders one column per entity with claim-specific rows and neutral unknowns', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Lab A' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lab B' })).toBeTruthy();
    expect(await screen.findByText('School of Engineering')).toBeTruthy();
    expect(screen.getByText(/robotics/i)).toBeTruthy();
    expect(screen.getByText('Studies autonomous robots.')).toBeTruthy();

    await waitFor(() => expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0));
  });

  it('compares undergraduate evidence and how to get involved from the served detail', async () => {
    mockDetailBySlug(
      {
        'lab-a': {
          ...entityA,
          entityType: 'LAB',
          websiteUrl: 'https://lab-a.example.edu/',
          hasUndergradHostingEvidence: true,
          pastUndergradAdvisees: [{ year: 2023 }, { year: 2025, count: 2 }],
          undergradInvitation: {
            level: 'welcomes_undergrads',
            quote: 'Undergraduates join the lab each summer.',
            sourceUrl: 'https://lab-a.example.edu/team',
          },
        },
        'lab-b': entityB,
      },
      {
        'lab-a': [
          {
            signalType: 'APPLICATION_FORM_EXISTS',
            sourceUrl: 'https://lab-a.example.edu/join',
            confidence: 'HIGH',
            confidenceScore: 0.9,
          },
        ],
      },
    );

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Has hosted undergrads before')).toBeTruthy();
    expect(screen.getByText('Has advised undergrads (2023–2025)')).toBeTruthy();
    expect(screen.getByText('Welcomes undergrads')).toBeTruthy();
    expect(screen.getByText(/Undergraduates join the lab each summer/)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Quoted from lab-a.example.edu (opens in a new tab)' })
        .getAttribute('href'),
    ).toBe('https://lab-a.example.edu/team');
    expect(screen.getByRole('link', { name: 'Visit lab website' }).getAttribute('href')).toBe(
      'https://lab-a.example.edu/',
    );
    expect(screen.getByRole('link', { name: 'See how to join' }).getAttribute('href')).toBe(
      'https://lab-a.example.edu/join',
    );

    const undergradRow = screen.getByRole('rowheader', { name: 'Undergraduate evidence' })
      .parentElement as HTMLElement;
    expect(within(undergradRow).getByText('Unknown')).toBeTruthy();
    const involvementRow = screen.getByRole('rowheader', { name: 'How to get involved' })
      .parentElement as HTMLElement;
    expect(within(involvementRow).getByText('Unknown')).toBeTruthy();
  });

  it('offers the official page the detail page offers when no lead card links a profile', async () => {
    mockDetailBySlug({
      'lab-a': {
        ...entityA,
        entityType: 'LAB',
        websiteUrl: '',
        leadIdentityStatus: 'under_review',
        sourceUrls: [
          'https://engineering.example.edu/research/lab-a',
          'https://engineering.example.edu/groups/lab-a-overview',
        ],
      },
      'lab-b': entityB,
    });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    const involvementRow = (await screen.findByRole('rowheader', { name: 'How to get involved' }))
      .parentElement as HTMLElement;
    const officialPage = await within(involvementRow).findByRole('link', {
      name: 'Open the official page',
    });
    expect(officialPage.getAttribute('href')).toMatch(/^https:\/\/engineering\.example\.edu\//);
    expect(
      within(involvementRow).queryByRole('link', { name: 'Open official profile' }),
    ).toBeNull();
  });

  it('labels official links by role rather than by URL slug', async () => {
    mockDetailBySlug({
      'lab-a': {
        ...entityA,
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/lab/clinical-nlp/',
        sourceUrls: [
          'https://medicine.yale.edu/profile/person-a/',
          'https://medicine.yale.edu/lab/clinical-nlp/',
          'https://reporter.nih.gov/project-details/123',
        ],
      },
      'lab-b': {
        ...entityB,
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://research-site.example.io/',
      },
    });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    const website = await screen.findByRole('link', { name: 'Lab website' });
    expect(website.getAttribute('href')).toBe('https://medicine.yale.edu/lab/clinical-nlp/');
    expect(
      screen.getByRole('link', { name: 'School directory profile' }).getAttribute('href'),
    ).toBe('https://medicine.yale.edu/profile/person-a/');
    expect(screen.getByRole('link', { name: 'reporter.nih.gov' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Research website' })).toBeTruthy();
    expect(screen.queryByText(/ page$/)).toBeNull();
    expect(screen.queryByText(/ source$/)).toBeNull();
  });

  it('gives every official link in a cell a distinct accessible name', async () => {
    mockDetailBySlug({
      'lab-a': {
        ...entityA,
        websiteUrl: '',
        sourceUrls: [
          'https://news.example.edu/story-one',
          'https://news.example.edu/story-two',
          'https://other.example.org/page',
        ],
      },
      'lab-b': entityB,
    });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    const sameHost = await screen.findAllByRole('link', { name: 'news.example.edu' });
    expect(sameHost).toHaveLength(1);
    expect(sameHost[0].getAttribute('href')).toBe('https://news.example.edu/story-one');
    expect(screen.getByRole('link', { name: 'other.example.org' })).toBeTruthy();
  });

  it('links each column header to the canonical research profile and dedupes repeated entities', async () => {
    mockDetailBySlug({ 'lab-a': entityA });

    render(
      <MemoryRouter>
        <ResearchHomeComparison
          entities={[
            { _id: 'a', slug: 'lab-a', name: 'Lab A' },
            { _id: 'a', slug: 'lab-a', name: 'Lab A' },
          ]}
          notesByEntityId={{}}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    const links = await screen.findAllByRole('link', { name: 'Lab A' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/research/lab-a');
  });

  it('excludes private notes until the per-column opt-in is checked', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison
          entities={selection}
          notesByEntityId={{ a: 'Ask about summer rotations' }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    expect(screen.queryByText('Ask about summer rotations')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include my private note' }));
    expect(await screen.findByText('Ask about summer rotations')).toBeTruthy();
  });

  it('emits a single research_compare event with the count bucket on open', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedTrack).toHaveBeenCalledTimes(1));
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'research_compare',
        payload: { entityCountBucket: '2' },
      }),
    );
  });

  it('closes on the close control', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={onClose} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the served card and never substitutes the body when the card is withheld', async () => {
    mockDetailBySlug({
      'lab-a': entityA,
      'lab-b': {
        ...entityB,
        shortDescription: '',
        fullDescription: 'Bio: The group studies synthetic coastal sediment transport in detail.',
      },
    });

    const { container } = render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab B' });
    await waitFor(() => expect(screen.getByText('Studies autonomous robots.')).toBeTruthy());
    expect(container.textContent).not.toContain('coastal sediment');
  });

  it('casts every topic chip in one casing, as the other chip surfaces do (#4644)', async () => {
    mockDetailBySlug({
      'lab-a': {
        ...entityA,
        researchAreas: [
          'Mathematical Statistics',
          'computational algorithms',
          'Endothelium, Vascular',
        ],
      },
      'lab-b': entityB,
    });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await screen.findByText('Computational Algorithms');
    expect(screen.getByText('Mathematical Statistics')).toBeTruthy();
    expect(screen.getByText('Vascular Endothelium')).toBeTruthy();
    expect(screen.queryByText('computational algorithms')).toBeNull();
  });

  it('truncates an over-long description on a word boundary', async () => {
    const longDescription =
      'The laboratory investigates autonomous robotic perception, developing vision algorithms and probabilistic mapping methods for mobile platforms operating in unstructured outdoor environments, and it evaluates those methods on field trials with undergraduate researchers contributing to sensor calibration and dataset annotation workflows.';
    mockDetailBySlug({
      'lab-a': { ...entityA, shortDescription: longDescription },
      'lab-b': entityB,
    });

    const { container } = render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    await waitFor(() => expect(container.textContent).toContain('…'));
    expect(container.textContent).toContain('sensor calibration and dataset…');
    expect(container.textContent).not.toContain('dataset anno…');
  });
  it('gives every compared column the same declared width and a fixed layout', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    const { container } = render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    const table = container.querySelector('table') as HTMLTableElement;
    expect(table.style.tableLayout).toBe('fixed');
    const columnWidths = Array.from(container.querySelectorAll('col')).map(
      (col) => col.style.width,
    );
    expect(columnWidths).toHaveLength(3);
    const [labelWidth, ...comparedWidths] = columnWidths;
    expect(labelWidth).toBe('10rem');
    expect(new Set(comparedWidths).size).toBe(1);
    expect(comparedWidths[0]).toContain('100%');
    expect(comparedWidths[0]).not.toBe(labelWidth);
  });

  it('keeps the row labels in place while the compared columns scroll', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });

    render(
      <MemoryRouter>
        <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Lab A' });
    const labelCell = screen.getByRole('rowheader', { name: 'Type' });
    expect(labelCell.className).toContain('sticky');
    expect(labelCell.className).toContain('left-0');
    expect(labelCell.className).toContain('bg-[var(--yr-panel)]');
  });

  it('wraps a long unbreakable name inside its own column', async () => {
    const unbreakableName = 'Interdisciplinarycomputationalneurosciencelaboratory';
    mockDetailBySlug({ 'lab-a': { ...entityA, name: unbreakableName }, 'lab-b': entityB });

    const { container } = render(
      <MemoryRouter>
        <ResearchHomeComparison
          entities={[{ ...selection[0], name: unbreakableName }, selection[1]]}
          notesByEntityId={{}}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const nameLink = await screen.findByRole('link', { name: unbreakableName });
    const nameHeader = nameLink.closest('th') as HTMLTableCellElement;
    expect(nameHeader.getAttribute('scope')).toBe('col');
    expect(nameHeader.className).toContain('[overflow-wrap:anywhere]');
    const comparedCells = Array.from(container.querySelectorAll('tbody td'));
    expect(comparedCells.length).toBeGreaterThan(0);
    for (const cell of comparedCells) {
      expect(cell.className).toContain('[overflow-wrap:anywhere]');
    }
  });

  it('tells a student the columns continue past the edge when they do', async () => {
    mockDetailBySlug({ 'lab-a': entityA, 'lab-b': entityB });
    const scrollHint = 'Scroll sideways to read every column.';
    const widths = { scrollWidth: 900, clientWidth: 360 };
    const originalScrollWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollWidth',
    );
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => widths.scrollWidth,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => widths.clientWidth,
    });

    try {
      render(
        <MemoryRouter>
          <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
        </MemoryRouter>,
      );
      await screen.findByRole('link', { name: 'Lab A' });
      expect(screen.getByText(scrollHint)).toBeTruthy();

      const scrollRegion = screen.getByRole('table').parentElement as HTMLElement;
      Object.defineProperty(scrollRegion, 'scrollLeft', { configurable: true, value: 540 });
      fireEvent.scroll(scrollRegion);
      expect(screen.queryByText(scrollHint)).toBeNull();

      Object.defineProperty(scrollRegion, 'scrollLeft', { configurable: true, value: 0 });
      fireEvent.scroll(scrollRegion);
      expect(screen.getByText(scrollHint)).toBeTruthy();

      cleanup();
      widths.scrollWidth = 360;
      render(
        <MemoryRouter>
          <ResearchHomeComparison entities={selection} notesByEntityId={{}} onClose={vi.fn()} />
        </MemoryRouter>,
      );
      await screen.findByRole('link', { name: 'Lab A' });
      expect(screen.queryByText(scrollHint)).toBeNull();
    } finally {
      if (originalScrollWidth) {
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
      }
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      }
    }
  });
});
