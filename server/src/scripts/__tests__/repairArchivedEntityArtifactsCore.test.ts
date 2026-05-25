import { describe, expect, it } from 'vitest';
import {
  buildArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifact,
} from '../repairArchivedEntityArtifactsCore';

describe('buildArchivedEntityArtifactRepairPlan', () => {
  it('relinks archived-entity artifacts to the canonical entity when no canonical duplicate exists', () => {
    const artifacts: ArchivedEntityArtifact[] = [
      {
        artifactType: 'EntryPathway',
        id: 'pathway-duplicate',
        researchEntityId: 'archived-entity',
        canonicalResearchEntityId: 'canonical-entity',
        derivationKey: 'pathway:EXPLORATORY_CONTACT:OFFICIAL_PROFILE:user-1',
      },
    ];

    expect(buildArchivedEntityArtifactRepairPlan({ artifacts })).toEqual({
      relink: [
        {
          artifactType: 'EntryPathway',
          id: 'pathway-duplicate',
          canonicalResearchEntityId: 'canonical-entity',
        },
      ],
      mergeAndArchive: [],
      archiveWithoutCanonical: [],
      skipped: [],
    });
  });

  it('merges and archives archived-entity artifacts when a canonical artifact has the same identity', () => {
    const artifacts: ArchivedEntityArtifact[] = [
      {
        artifactType: 'ContactRoute',
        id: 'route-duplicate',
        researchEntityId: 'archived-entity',
        canonicalResearchEntityId: 'canonical-entity',
        derivationKey: 'route:FACULTY_PI:OFFICIAL_PROFILE:user-1',
      },
    ];
    const canonicalArtifacts: ArchivedEntityArtifact[] = [
      {
        artifactType: 'ContactRoute',
        id: 'route-canonical',
        researchEntityId: 'canonical-entity',
        canonicalResearchEntityId: 'canonical-entity',
        derivationKey: 'route:FACULTY_PI:OFFICIAL_PROFILE:user-1',
      },
    ];

    expect(buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts })).toEqual({
      relink: [],
      mergeAndArchive: [
        {
          artifactType: 'ContactRoute',
          duplicateId: 'route-duplicate',
          canonicalId: 'route-canonical',
        },
      ],
      archiveWithoutCanonical: [],
      skipped: [],
    });
  });

  it('uses signal type plus derivation key as the access-signal identity', () => {
    const artifacts: ArchivedEntityArtifact[] = [
      {
        artifactType: 'AccessSignal',
        id: 'signal-duplicate',
        researchEntityId: 'archived-entity',
        canonicalResearchEntityId: 'canonical-entity',
        signalType: 'REACH_OUT_PLAUSIBLE',
        derivationKey: 'signal:shared',
      },
    ];
    const canonicalArtifacts: ArchivedEntityArtifact[] = [
      {
        artifactType: 'AccessSignal',
        id: 'different-signal',
        researchEntityId: 'canonical-entity',
        canonicalResearchEntityId: 'canonical-entity',
        signalType: 'CURRENT_UNDERGRADS',
        derivationKey: 'signal:shared',
      },
    ];

    expect(buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts }).relink).toEqual([
      {
        artifactType: 'AccessSignal',
        id: 'signal-duplicate',
        canonicalResearchEntityId: 'canonical-entity',
      },
    ]);
  });

  it('archives active artifacts when their archived entity has no canonical target', () => {
    expect(
      buildArchivedEntityArtifactRepairPlan({
        artifacts: [
          {
            artifactType: 'EntryPathway',
            id: 'pathway-orphan',
            researchEntityId: 'archived-entity',
            canonicalResearchEntityId: '',
            derivationKey: 'pathway:orphan',
          },
        ],
      }),
    ).toMatchObject({
      archiveWithoutCanonical: [
        {
          artifactType: 'EntryPathway',
          id: 'pathway-orphan',
        },
      ],
      skipped: [],
    });
  });
});
