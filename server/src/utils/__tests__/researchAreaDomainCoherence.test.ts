import { describe, expect, it } from 'vitest';
import {
  dropDomainIncoherentUnsourcedResearchAreas,
  hasResearchAreaProvenance,
} from '../researchAreaDomainCoherence';

describe('hasResearchAreaProvenance', () => {
  it('is false when fieldProvenance is missing or has no researchAreas entry', () => {
    expect(hasResearchAreaProvenance(undefined)).toBe(false);
    expect(hasResearchAreaProvenance({})).toBe(false);
    expect(hasResearchAreaProvenance({ fullDescription: { sourceUrl: 'x' } })).toBe(false);
  });

  it('is true when a researchAreas provenance entry is recorded', () => {
    expect(
      hasResearchAreaProvenance({ researchAreas: { sourceUrl: 'https://x.yale.edu', confidence: 0.7 } }),
    ).toBe(true);
  });
});

describe('dropDomainIncoherentUnsourcedResearchAreas', () => {
  const wgssContext = {
    name: 'Joseph Fischel',
    departments: ["Women's, Gender, and Sexuality Studies"],
    fullDescription:
      'Joseph Fischel studies queer theory, political theory, and the politics of sexual consent.',
    shortDescription: 'Scholar of queer theory and political theory.',
  };

  it('drops every chip when the entity has no fieldProvenance and no chip shares vocabulary with its own text (full-graft signature)', () => {
    const areas = [
      'Parallel Computing and Optimization Techniques',
      'Distributed and Parallel Computing Systems',
      'Embedded Systems Design Techniques',
      'Algorithms and Data Compression',
      'VLSI and FPGA Design Techniques',
    ];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, wgssContext)).toEqual([]);
  });

  it('keeps a chip that overlaps the entity\'s own vocabulary and drops only the alien chips', () => {
    const campbellContext = {
      name: 'Jill Campbell',
      departments: ['English'],
      fullDescription:
        'Jill Campbell studies eighteenth-century British literature and the novel, with an emphasis on gender and fiction.',
    };
    const areas = ['Eighteenth-Century British Literature', 'Health Policy', 'Epidemiology'];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, campbellContext)).toEqual([
      'Eighteenth-Century British Literature',
    ]);
  });

  it('leaves chips untouched when fieldProvenance.researchAreas is recorded, regardless of overlap', () => {
    const areas = ['Parallel Computing and Optimization Techniques'];
    const provenance = { researchAreas: { sourceUrl: 'https://wgss.yale.edu/people/joseph-fischel' } };
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, provenance, wgssContext)).toBe(areas);
  });

  it('never drops a generic single-word canonical area name', () => {
    const areas = ['Law'];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, wgssContext)).toEqual(['Law']);
  });

  it('leaves areas untouched when the entity has too little of its own text to judge against', () => {
    const areas = ['Parallel Computing and Optimization Techniques'];
    const sparseContext = { name: 'X Y', departments: [] };
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, sparseContext)).toBe(areas);
  });

  it('returns the same array reference when nothing changes', () => {
    const areas = ['Queer Theory'];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, wgssContext)).toBe(areas);
  });

  it('drops a sole chip that duplicates the entity\'s own department name even though it self-corroborates (#1763)', () => {
    const langstonContext = {
      name: 'Langston Lab',
      departments: ['Pathology'],
      fullDescription:
        'The Langston Lab studies exercise-induced inflammation and muscle healthspan across the lifespan.',
    };
    expect(dropDomainIncoherentUnsourcedResearchAreas(['Pathology'], undefined, langstonContext)).toEqual(
      [],
    );
  });

  it('drops only the department-duplicate chip and keeps a genuine topic chip alongside it', () => {
    const context = {
      name: 'Example Lab',
      departments: ['Pathology'],
      fullDescription:
        'The Example Lab studies exercise-induced inflammation and muscle healthspan across the lifespan.',
    };
    const areas = ['Pathology', 'Muscle Healthspan'];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, context)).toEqual([
      'Muscle Healthspan',
    ]);
  });

  it('leaves a department-name chip untouched when fieldProvenance.researchAreas is recorded', () => {
    const context = { name: 'Langston Lab', departments: ['Pathology'], fullDescription: 'x'.repeat(50) };
    const areas = ['Pathology'];
    const provenance = { researchAreas: { sourceUrl: 'https://pathology.yale.edu/langston' } };
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, provenance, context)).toBe(areas);
  });

  it('does not let generic RCT-methodology boilerplate false-corroborate an unrelated chip via the fuzzy prefix', () => {
    const rideshareContext = {
      name: 'A Lab',
      departments: [],
      fullDescription:
        'The research focuses on the impacts of subsidized ridesharing on drunk driving and alcohol consumption. It employs a randomized controlled trial and will analyze variations in outcomes, aiming to provide evidence for effective interventions.',
      shortDescription: 'The lab studies the effects of subsidized ridesharing on drunk driving.',
    };
    const areas = [
      'Heart Rate Variability and Autonomic Control',
      'Long-Term Effects of COVID-19',
      'Employment and Welfare Studies',
    ];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, rideshareContext)).toEqual([]);
  });

  it('does not let a genuinely-sourced bio\'s "actively" false-corroborate an unrelated "Activities" chip via the fuzzy prefix (#1730 roberts-cer63)', () => {
    const historianContext = {
      name: 'Carolyn Roberts',
      departments: ['Black Studies'],
      fullDescription:
        'Dr. Carolyn Roberts is an historian of science and medicine at Yale University. She holds a joint appointment in the departments of History/History of Science and Medicine, and African American Studies. With scientific rigor and compassion, Dr. Roberts has been actively creating usable history for medical and nursing students.',
      shortDescription:
        'She holds a joint appointment in the departments of History/History of Science and Medicine, and African American Studies.',
    };
    const areas = [
      'Crime, Illicit Activities, and Governance',
      'Gun Ownership and Violence Research',
      'Substance Abuse Treatment and Outcomes',
    ];
    expect(dropDomainIncoherentUnsourcedResearchAreas(areas, undefined, historianContext)).toEqual([]);
  });
});
