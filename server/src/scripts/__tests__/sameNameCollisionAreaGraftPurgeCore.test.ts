import { describe, expect, it } from 'vitest';
import {
  normalizeGraftToken,
  planAreaGraftRemoval,
  planGrantGraftRemoval,
  planWebsiteClear,
  descriptionEchoesGraftedAreas,
  planPoisonedDescriptionClear,
} from '../sameNameCollisionAreaGraftPurgeCore';
import { parseArgs } from '../purgeSameNameCollisionAreaGrafts';

describe('planAreaGraftRemoval', () => {
  it('removes the verified graft strings and preserves the real discipline area', () => {
    const result = planAreaGraftRemoval({
      current: [
        'Veterinary Oncology Research',
        'Virus-based gene therapy research',
        'Parasitic infections in humans and animals',
        'Veterinary Medicine and Surgery',
        'Urological Disorders and Treatments',
        'History',
      ],
      removeAreas: [
        'Veterinary Oncology Research',
        'Virus-based gene therapy research',
        'Parasitic infections in humans and animals',
        'Veterinary Medicine and Surgery',
        'Urological Disorders and Treatments',
      ],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['History']);
    expect(result.removed).toHaveLength(5);
  });

  it('matches case- and whitespace-insensitively', () => {
    const result = planAreaGraftRemoval({
      current: ['  Diabetes   Research ', 'Political Science'],
      removeAreas: ['diabetes research'],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['Political Science']);
  });

  it('is a no-op when no graft string is present (fail closed)', () => {
    const result = planAreaGraftRemoval({
      current: ['Economics', 'Game Theory'],
      removeAreas: ['Liver Disease and Transplantation'],
    });
    expect(result.changed).toBe(false);
    expect(result.cleaned).toEqual(['Economics', 'Game Theory']);
    expect(result.removed).toEqual([]);
  });

  it('never removes a legitimate area that is not on the graft list', () => {
    const result = planAreaGraftRemoval({
      current: ['Women’s health', 'Infertility', 'Anthropology'],
      removeAreas: ['Health Care Economics'],
    });
    expect(result.cleaned).toEqual(['Women’s health', 'Infertility', 'Anthropology']);
    expect(result.changed).toBe(false);
  });

  it('can empty an all-grafted area list', () => {
    const result = planAreaGraftRemoval({
      current: ['Diabetes Management and Education', 'Primary Care and Health Outcomes'],
      removeAreas: ['Diabetes Management and Education', 'Primary Care and Health Outcomes'],
    });
    expect(result.cleaned).toEqual([]);
    expect(result.changed).toBe(true);
  });
});

describe('planWebsiteClear', () => {
  it('clears a websiteUrl that matches the flagged wrong-person profile', () => {
    const result = planWebsiteClear({
      current: 'https://medicine.yale.edu/profile/maurice-samuels/',
      clearIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
    });
    expect(result.cleared).toBe(true);
    expect(result.from).toBe('https://medicine.yale.edu/profile/maurice-samuels/');
  });

  it('leaves an unrelated websiteUrl untouched', () => {
    const result = planWebsiteClear({
      current: 'https://french.yale.edu/people/maurice-samuels',
      clearIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
    });
    expect(result.cleared).toBe(false);
  });

  it('does not clear a missing websiteUrl', () => {
    const result = planWebsiteClear({
      current: null,
      clearIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
    });
    expect(result.cleared).toBe(false);
  });
});

describe('planGrantGraftRemoval', () => {
  it('removes only the same-surname PI grants and keeps the rest', () => {
    const result = planGrantGraftRemoval({
      current: [
        { id: 'grant-a', agency: 'NIGMS' },
        { id: 'grant-b', agency: 'NIH' },
      ],
      removeGrantIds: ['grant-a'],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual([{ id: 'grant-b', agency: 'NIH' }]);
    expect(result.removed).toEqual([{ id: 'grant-a', agency: 'NIGMS' }]);
    expect(result.fundingAgencies).toEqual(['NIH']);
  });

  it('is a no-op when no grant id is on the removal list (fail closed)', () => {
    const result = planGrantGraftRemoval({
      current: [{ id: 'grant-a', agency: 'NIH' }],
      removeGrantIds: ['grant-z'],
    });
    expect(result.changed).toBe(false);
    expect(result.cleaned).toEqual([{ id: 'grant-a', agency: 'NIH' }]);
  });

  it('empties fundingAgencies when every grant is removed', () => {
    const result = planGrantGraftRemoval({
      current: [{ id: 'grant-a', agency: 'NIH' }],
      removeGrantIds: ['grant-a'],
    });
    expect(result.cleaned).toEqual([]);
    expect(result.fundingAgencies).toEqual([]);
    expect(result.changed).toBe(true);
  });
});

describe('normalizeGraftToken', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeGraftToken('  Heart Rate   Variability ')).toBe('heart rate variability');
  });
});

describe('parseArgs', () => {
  it('defaults to a guarded dry-run', () => {
    const options = parseArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirm).toBe(false);
  });

  it('requires the confirm flag when applying', () => {
    expect(() => parseArgs(['--apply'])).toThrow(/--confirm-same-name-area-graft-purge/);
  });

  it('accepts apply with confirm', () => {
    const options = parseArgs(['--apply', '--confirm-same-name-area-graft-purge']);
    expect(options.apply).toBe(true);
    expect(options.confirm).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('descriptionEchoesGraftedAreas', () => {
  const graftedAreas = [
    'Protein Structure and Dynamics',
    'Heart Rate Variability and Autonomic Control',
    'Pancreatic function and diabetes',
    'Erythrocyte Function and Pathophysiology',
    'Diabetes Research',
  ];

  it('fires while the stored card still echoes a grafted area', () => {
    expect(
      descriptionEchoesGraftedAreas({
        description: 'Research on diabetes and pancreatic function in adults.',
        graftedAreas,
      }),
    ).toBe(true);
  });

  it('refuses once the row has a correct card of its own', () => {
    expect(
      descriptionEchoesGraftedAreas({
        description:
          'Studies American political institutions and how intra- and inter-institutional dynamics impact societal inequality, focusing on elite behavior in the criminal legal system.',
        graftedAreas,
      }),
    ).toBe(false);
  });

  it('never fires on an empty card or an empty graft list', () => {
    expect(descriptionEchoesGraftedAreas({ description: '', graftedAreas })).toBe(false);
    expect(
      descriptionEchoesGraftedAreas({ description: 'Anything at all', graftedAreas: [] }),
    ).toBe(false);
  });

  it('does not fire on a generic word the two merely share', () => {
    expect(
      descriptionEchoesGraftedAreas({
        description: 'Research on the management and treatment of urban policy outcomes.',
        graftedAreas: ['Diabetes Management and Education', 'Primary Care and Health Outcomes'],
      }),
    ).toBe(false);
  });

  it('reads a fabricated body the same way it reads a card', () => {
    const fabricatedAreas = [
      'Explainable Artificial Intelligence (XAI)',
      'Polar Research and Ecology',
      'Data Analysis with R',
      'Machine Learning in Healthcare',
    ];
    expect(
      descriptionEchoesGraftedAreas({
        description:
          'Research focuses on explainable artificial intelligence (XAI) and its applications in healthcare, particularly through the lens of polar ecology, employing data analysis techniques using R and machine learning methodologies.',
        graftedAreas: fabricatedAreas,
      }),
    ).toBe(true);
    expect(
      descriptionEchoesGraftedAreas({
        description:
          'A historian of biomedical futures, writing about how people in the past imagined that science, technology and medicine would change their lives.',
        graftedAreas: fabricatedAreas,
      }),
    ).toBe(false);
  });
});

describe('planPoisonedDescriptionClear', () => {
  const graftedAreas = [
    'Explainable Artificial Intelligence (XAI)',
    'Polar Research and Ecology',
    'Data Analysis with R',
    'Machine Learning in Healthcare',
  ];
  const fabricatedBody =
    'Research focuses on explainable artificial intelligence (XAI) and its applications in healthcare, particularly through the lens of polar ecology, employing data analysis techniques using R and machine learning methodologies.';

  it('clears a body that restates the areas this run removes', () => {
    expect(
      planPoisonedDescriptionClear({
        requested: true,
        current: fabricatedBody,
        graftedAreas,
      }),
    ).toEqual({ cleared: true, from: fabricatedBody });
  });

  it('refuses a body the spec did not ask to clear', () => {
    expect(
      planPoisonedDescriptionClear({
        requested: undefined,
        current: fabricatedBody,
        graftedAreas,
      }).cleared,
    ).toBe(false);
  });

  it('refuses a body that no longer restates them, so a re-run cannot empty a repaired row', () => {
    const repairedBody =
      'A historian of biomedical futures, writing about how people in the past imagined that science, technology and medicine would change their lives.';
    expect(
      planPoisonedDescriptionClear({
        requested: true,
        current: repairedBody,
        graftedAreas,
      }),
    ).toEqual({ cleared: false, from: repairedBody });
  });

  it('refuses an empty body rather than reporting a clear that writes nothing', () => {
    expect(planPoisonedDescriptionClear({ requested: true, current: '', graftedAreas })).toEqual({
      cleared: false,
      from: '',
    });
  });
});
