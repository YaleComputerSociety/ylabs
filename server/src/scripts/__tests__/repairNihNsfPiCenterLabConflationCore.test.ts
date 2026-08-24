import { describe, expect, it } from 'vitest';
import {
  isNihNsfPiCenterLabConflation,
  planNihNsfPiCenterLabConflationRepair,
  summarizeNihNsfPiCenterLabConflationRepair,
} from '../repairNihNsfPiCenterLabConflationCore';

const now = new Date('2026-08-24T00:00:00.000Z');

describe('isNihNsfPiCenterLabConflation', () => {
  it('flags a grant-derived PI shell whose kind is lab but entityType is an institutional type', () => {
    expect(
      isNihNsfPiCenterLabConflation({
        id: 'entity-1',
        slug: 'nih-pi-michael-nathanson',
        name: 'Michael Nathanson Lab',
        kind: 'lab',
        entityType: 'CENTER',
      }),
    ).toBe(true);
  });

  it('does not flag when entityType already agrees with kind', () => {
    expect(
      isNihNsfPiCenterLabConflation({
        id: 'entity-2',
        slug: 'nih-pi-someone',
        name: 'Someone Lab',
        kind: 'lab',
        entityType: 'LAB',
      }),
    ).toBe(false);
  });

  it('does not flag a non-grant-derived slug', () => {
    expect(
      isNihNsfPiCenterLabConflation({
        id: 'entity-3',
        slug: 'yale-liver-center',
        name: 'Yale Liver Center',
        kind: 'center',
        entityType: 'CENTER',
      }),
    ).toBe(false);
  });

  it('does not flag when kind itself is a genuine, coherent center', () => {
    expect(
      isNihNsfPiCenterLabConflation({
        id: 'entity-4',
        slug: 'nih-pi-diane-krause',
        name: 'Yale Stem Cell Center',
        kind: 'center',
        entityType: 'CENTER',
      }),
    ).toBe(false);
  });

  it('does not flag when the name is not a bare-person "<Name> Lab" shape', () => {
    expect(
      isNihNsfPiCenterLabConflation({
        id: 'entity-5',
        slug: 'nsf-pi-someone',
        name: 'Yale Liver Center',
        kind: 'lab',
        entityType: 'CENTER',
      }),
    ).toBe(false);
  });
});

describe('planNihNsfPiCenterLabConflationRepair', () => {
  it('reverts entityType to LAB and regrounds the description in the PI\'s own grant abstract', () => {
    const plan = planNihNsfPiCenterLabConflationRepair(
      {
        id: 'entity-1',
        slug: 'nih-pi-michael-nathanson',
        name: 'Michael Nathanson Lab',
        kind: 'lab',
        entityType: 'CENTER',
        websiteUrl: 'https://medicine.yale.edu/internal-medicine/livercenter/',
        fullDescription: 'The Yale Liver Center is one of 17 Digestive Diseases Research Core Centers.',
        shortDescription: 'The Yale Liver Center focuses on liver structure, function, and disease.',
        recentGrants: [
          {
            url: 'https://reporter.nih.gov/project-details/11129975',
            abstract:
              'PROJECT SUMMARY: Excessive alcohol intake causes hepatocellular calcium signaling defects that drive alcohol-associated hepatitis in patients.',
          },
        ],
      },
      now,
    );

    expect(plan).not.toBeNull();
    expect(plan?.set.entityType).toBe('LAB');
    expect(plan?.fullDescriptionAfter).toContain('Excessive alcohol intake');
    expect(plan?.set.fullDescription).toBe(plan?.fullDescriptionAfter);
    expect(plan?.unset).toMatchObject({ website: '', websiteUrl: '', displayName: '' });
    expect(plan?.unset.fullDescription).toBeUndefined();
    expect(plan?.supersedeObservationFilter).toMatchObject({
      entityId: 'entity-1',
      sourceName: 'official-profile-pi-backfill',
    });
    expect(plan?.supersedeDescriptionFilter).toMatchObject({
      entityId: 'entity-1',
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/internal-medicine/livercenter/',
    });
  });

  it('clears the description instead of inventing one when no grant abstract is available', () => {
    const plan = planNihNsfPiCenterLabConflationRepair(
      {
        id: 'entity-6',
        slug: 'nsf-pi-someone',
        name: 'Someone Lab',
        kind: 'lab',
        entityType: 'CENTER',
        websiteUrl: 'https://medicine.yale.edu/some-center/',
        fullDescription: 'Some Center does great things.',
        recentGrants: [{ url: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1', abstract: '' }],
      },
      now,
    );

    expect(plan?.fullDescriptionAfter).toBe('');
    expect(plan?.set.fullDescription).toBeUndefined();
    expect(plan?.unset).toMatchObject({ fullDescription: '', shortDescription: '' });
  });

  it('returns null for an entity that is not a conflation', () => {
    expect(
      planNihNsfPiCenterLabConflationRepair(
        { id: 'entity-2', slug: 'nih-pi-someone', name: 'Someone Lab', kind: 'lab', entityType: 'LAB' },
        now,
      ),
    ).toBeNull();
  });
});

describe('summarizeNihNsfPiCenterLabConflationRepair', () => {
  it('counts scanned, changed, and description outcomes', () => {
    const summary = summarizeNihNsfPiCenterLabConflationRepair([
      null,
      planNihNsfPiCenterLabConflationRepair(
        {
          id: 'entity-1',
          slug: 'nih-pi-a',
          name: 'A Lab',
          kind: 'lab',
          entityType: 'CENTER',
          recentGrants: [{ abstract: 'A real abstract about A research that is long enough.' }],
        },
        now,
      ),
      planNihNsfPiCenterLabConflationRepair(
        { id: 'entity-2', slug: 'nih-pi-b', name: 'B Lab', kind: 'lab', entityType: 'CENTER' },
        now,
      ),
    ]);

    expect(summary).toEqual({
      scanned: 3,
      changed: 2,
      descriptionRegrounded: 1,
      descriptionCleared: 1,
    });
  });
});
