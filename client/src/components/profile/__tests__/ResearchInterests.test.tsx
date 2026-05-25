import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ResearchInterests from '../ResearchInterests';

afterEach(() => {
  cleanup();
});

describe('ResearchInterests', () => {
  it('merges topics and interests into one deduped research interests section', () => {
    render(
      <ResearchInterests
        topics={['Quantum materials', 'Condensed Matter']}
        interests={['quantum materials', 'Thin films']}
      />,
    );

    expect(screen.getByText('Research Interests')).toBeTruthy();
    expect(screen.queryByText('Research Topics')).toBeNull();
    expect(screen.getAllByText(/quantum materials/i)).toHaveLength(1);
    expect(screen.getByText('Condensed Matter')).toBeTruthy();
    expect(screen.getByText('Thin Films')).toBeTruthy();
  });

  it('title-cases lowercase research interest chips', () => {
    render(
      <ResearchInterests
        topics={[]}
        interests={['functional morphology', 'phylogenetics of mammals']}
      />,
    );

    expect(screen.getByText('Functional Morphology')).toBeTruthy();
    expect(screen.getByText('Phylogenetics Of Mammals')).toBeTruthy();
    expect(screen.queryByText('functional morphology')).toBeNull();
    expect(screen.queryByText('phylogenetics of mammals')).toBeNull();
  });

  it('splits concatenated title-case interests before deduping', () => {
    render(
      <ResearchInterests
        topics={[
          'Astrophysics & Cosmology',
          'Theorist & Experimentalist',
          'Hidden Supermassive Black Holes',
        ]}
        interests={[
          'Astrophysics & CosmologyTheorist & ExperimentalistHidden Supermassive Black Holes',
          'astrophysics & cosmology',
        ]}
      />,
    );

    expect(
      screen.queryByText(
        'Astrophysics & CosmologyTheorist & ExperimentalistHidden Supermassive Black Holes',
      ),
    ).toBeNull();
    expect(screen.getAllByText('Astrophysics & Cosmology')).toHaveLength(1);
    expect(screen.getAllByText('Theorist & Experimentalist')).toHaveLength(1);
    expect(screen.getAllByText('Hidden Supermassive Black Holes')).toHaveLength(1);

    const interestSection = screen.getByText('Research Interests').closest('section');
    expect(interestSection?.textContent).not.toContain(
      'Astrophysics & CosmologyTheorist & Experimentalist',
    );
    expect(interestSection?.textContent).toContain('Astrophysics & Cosmology, Theorist');
  });

  it('shows the empty state when no topics or interests are available', () => {
    render(<ResearchInterests topics={[]} interests={[]} />);

    expect(screen.getByText('No research interests available.')).toBeTruthy();
  });

  it('shows a prose research summary instead of the empty state when compact chips are unavailable', () => {
    render(
      <ResearchInterests
        topics={[]}
        interests={[]}
        summary="My research interests include the functional morphology and systematics of mammals."
      />,
    );

    expect(screen.getByText('Research Interests')).toBeTruthy();
    expect(
      screen.getByText(
        'My research interests include the functional morphology and systematics of mammals.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('No research interests available.')).toBeNull();
  });

  it('does not render YSM publication widget chrome as research interests', () => {
    render(
      <ResearchInterests
        topics={['View 2 Related Publications', 'Glioblastoma', '2', 'Publications', '4,310', 'Citations']}
        interests={[
          'Brain Neoplasms11 YSM ResearchersView 5 Related Publications',
          'Nanoparticles3 YSM ResearchersView 5 Related Publications',
          'Glioblastoma11 YSM ResearchersView 4 Related Publications',
          'View 4 Related Publications',
          'Genetic Therapy3 YSM ResearchersView 2 Related Publications',
          '1',
        ]}
      />,
    );

    expect(screen.getByText('Brain Neoplasms')).toBeTruthy();
    expect(screen.getByText('Nanoparticles')).toBeTruthy();
    expect(screen.getAllByText('Glioblastoma')).toHaveLength(1);
    expect(screen.getByText('Genetic Therapy')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.queryByText('Publications')).toBeNull();
    expect(screen.queryByText('4,310')).toBeNull();
    expect(screen.queryByText('Citations')).toBeNull();
    expect(screen.queryByText(/YSM Researchers/i)).toBeNull();
    expect(screen.queryByText(/Related Publications/i)).toBeNull();
  });
});
