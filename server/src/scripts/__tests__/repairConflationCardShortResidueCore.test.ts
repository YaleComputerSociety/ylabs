import { describe, expect, it } from 'vitest';
import {
  CARD_RESIDUE_REPAIR_SOURCE_NAME,
  planConflationCardShortResidueRepair,
  summarizeConflationCardShortResidueRepair,
} from '../repairConflationCardShortResidueCore';

const now = new Date('2026-08-24T00:00:00.000Z');
const abstract =
  'Although metabolic and bariatric surgery is the most effective treatment for severe obesity, weight outcomes are markedly variable.';

describe('planConflationCardShortResidueRepair', () => {
  it('re-derives a researchAreas-grounded card short for conflation-repair residue', () => {
    const plan = planConflationCardShortResidueRepair(
      {
        id: 'entity-1',
        slug: 'nih-pi-carlos-grilo',
        fullDescription: abstract,
        shortDescription: abstract,
        researchAreas: ['Binge eating', 'Pharmacology', 'Brain imaging'],
        shortDescriptionProvenanceSource: 'nih-nsf-pi-center-lab-conflation-repair',
      },
      now,
    );

    expect(plan).not.toBeNull();
    expect(plan?.shortAfter).toBe('Studies Binge eating, Pharmacology, and Brain imaging.');
    expect(plan?.shortAfter).not.toBe(plan?.shortBefore);
    expect(plan?.set.shortDescription).toBe(plan?.shortAfter);
    expect((plan?.set['fieldProvenance.shortDescription'] as any).sourceName).toBe(
      CARD_RESIDUE_REPAIR_SOURCE_NAME,
    );
  });

  it('skips entities whose short is not conflation-repair provenance', () => {
    expect(
      planConflationCardShortResidueRepair(
        {
          id: 'entity-2',
          slug: 'nih-pi-someone',
          fullDescription: abstract,
          shortDescription: abstract,
          researchAreas: ['Binge eating'],
          shortDescriptionProvenanceSource: 'manual-admin-edit',
        },
        now,
      ),
    ).toBeNull();
  });

  it('skips non grant-shell slugs', () => {
    expect(
      planConflationCardShortResidueRepair(
        {
          id: 'entity-3',
          slug: 'yale-liver-center',
          fullDescription: abstract,
          shortDescription: abstract,
          researchAreas: ['Hepatology'],
          shortDescriptionProvenanceSource: 'nih-nsf-pi-center-lab-conflation-repair',
        },
        now,
      ),
    ).toBeNull();
  });

  it('fails closed when no card can be grounded', () => {
    expect(
      planConflationCardShortResidueRepair(
        {
          id: 'entity-4',
          slug: 'nih-pi-no-areas',
          fullDescription: abstract,
          shortDescription: abstract,
          researchAreas: [],
          shortDescriptionProvenanceSource: 'nih-nsf-pi-center-lab-conflation-repair',
        },
        now,
      ),
    ).toBeNull();
  });

  it('skips when the short already equals the derived card', () => {
    expect(
      planConflationCardShortResidueRepair(
        {
          id: 'entity-5',
          slug: 'nih-pi-carlos-grilo',
          fullDescription: abstract,
          shortDescription: 'Studies Binge eating, Pharmacology, and Brain imaging.',
          researchAreas: ['Binge eating', 'Pharmacology', 'Brain imaging'],
          shortDescriptionProvenanceSource: 'nih-nsf-pi-center-lab-conflation-repair',
        },
        now,
      ),
    ).toBeNull();
  });

  it('summarizes scanned and changed counts', () => {
    const plans = [
      planConflationCardShortResidueRepair(
        {
          id: 'e1',
          slug: 'nih-pi-a',
          fullDescription: abstract,
          shortDescription: abstract,
          researchAreas: ['Binge eating', 'Pharmacology'],
          shortDescriptionProvenanceSource: 'nih-nsf-pi-center-lab-conflation-repair',
        },
        now,
      ),
      null,
    ];
    expect(summarizeConflationCardShortResidueRepair(plans)).toEqual({ scanned: 2, changed: 1 });
  });
});
