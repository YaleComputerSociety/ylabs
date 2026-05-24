import { describe, expect, it } from 'vitest';
import {
  buildPostMaterializationIntegritySummary,
  buildSamePiNameDuplicateGroupsFromDedupeRows,
} from '../integrityGate';

describe('post-materialization integrity gate', () => {
  it('flags same-PI compatible lab and research-profile entity names', () => {
    const groups = buildSamePiNameDuplicateGroupsFromDedupeRows([
      {
        userId: 'user-jordan-vale',
        normalizedName: 'same-pi:user-jordan-vale',
        piFirstName: 'Jordan',
        piLastName: 'Vale',
        entities: [
          {
            id: 'canonical-lab',
            slug: 'dept-psych-jordan-vale',
            name: 'Jordan Vale Lab',
            websiteUrl: 'https://vale-lab.example.edu/',
            sourceUrls: ['https://psychology.yale.edu/people/jordan-vale'],
            departments: ['Psychology'],
          },
          {
            id: 'profile-shell',
            slug: 'vale-jv99',
            name: 'Jordan Vale Research',
            departments: ['PSYC - Psychology'],
          },
        ],
      },
    ]);

    expect(groups).toEqual([
      {
        userId: 'user-jordan-vale',
        normalizedName: 'same-pi:user-jordan-vale',
        entityIds: ['canonical-lab', 'profile-shell'],
      },
    ]);
  });

  it('fails on same-PI same-name active ResearchEntity duplicates', () => {
    const summary = buildPostMaterializationIntegritySummary({
      samePiNameDuplicateGroups: [
        {
          userId: 'user-1',
          normalizedName: 'smith lab',
          entityIds: ['entity-1', 'entity-2'],
        },
      ],
      limit: 5,
    });

    expect(summary.status).toBe('failure');
    expect(summary.failureNames).toContain('samePiSameNameResearchEntities');
    expect(summary.counts.samePiSameNameResearchEntities).toBe(1);
    expect(summary.samples.samePiSameNameResearchEntities[0]).toMatchObject({
      userId: 'user-1',
      normalizedName: 'smith lab',
      entityIds: ['entity-1', 'entity-2'],
    });
    expect(summary.recommendedCommands).toContain(
      'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply',
    );
  });

  it('fails on active ResearchEntity duplicates sharing the same official lab URL', () => {
    const summary = buildPostMaterializationIntegritySummary({
      officialLabUrlDuplicateGroups: [
        {
          officialLabUrl: 'https://medicine.yale.edu/lab/synthetic-atlas/',
          entityIds: ['dept-mcdb-fixture-atlas', 'ysm-atlas'],
        },
      ],
      limit: 5,
    });

    expect(summary.status).toBe('failure');
    expect(summary.failureNames).toContain('officialLabUrlResearchEntities');
    expect(summary.counts.officialLabUrlResearchEntities).toBe(1);
    expect(summary.samples.officialLabUrlResearchEntities[0]).toMatchObject({
      officialLabUrl: 'https://medicine.yale.edu/lab/synthetic-atlas/',
      entityIds: ['dept-mcdb-fixture-atlas', 'ysm-atlas'],
    });
    expect(summary.recommendedCommands).toContain(
      'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --official-lab-url-only --apply',
    );
  });

  it('fails on duplicate current member rows and current members on archived entities', () => {
    const summary = buildPostMaterializationIntegritySummary({
      duplicateCurrentMemberGroups: [
        {
          researchEntityId: 'entity-1',
          userId: 'user-1',
          role: 'pi',
          memberIds: ['member-1', 'member-2'],
        },
      ],
      currentMembersOnArchivedEntities: [
        {
          researchEntityId: 'archived-entity',
          memberId: 'member-3',
          userId: 'user-2',
          role: 'staff',
          canonicalGroupId: 'canonical-entity',
        },
      ],
      limit: 5,
    });

    expect(summary.status).toBe('failure');
    expect(summary.failureNames).toEqual([
      'duplicateCurrentMembers',
      'currentMembersOnArchivedEntities',
    ]);
    expect(summary.counts.duplicateCurrentMembers).toBe(1);
    expect(summary.counts.currentMembersOnArchivedEntities).toBe(1);
  });

  it('fails on duplicate people, papers, and access signals by strong identity keys', () => {
    const summary = buildPostMaterializationIntegritySummary({
      duplicatePersonGroups: [
        {
          identityField: 'email',
          identityValue: 'casey.researcher@yale.edu',
          userIds: ['user-1', 'user-2'],
        },
      ],
      duplicateResearchPaperGroups: [
        {
          identityField: 'doi',
          identityValue: '10.1000/example',
          paperIds: ['paper-1', 'paper-2'],
        },
      ],
      duplicateAccessSignalGroups: [
        {
          researchEntityId: 'entity-1',
          signalType: 'REACH_OUT_PLAUSIBLE',
          identityField: 'sourceEvidenceId',
          identityValue: 'observation-1',
          signalIds: ['signal-1', 'signal-2'],
        },
      ],
      limit: 5,
    });

    expect(summary.status).toBe('failure');
    expect(summary.failureNames).toEqual([
      'duplicatePeople',
      'duplicateResearchPapers',
      'duplicateAccessSignals',
    ]);
    expect(summary.counts.duplicatePeople).toBe(1);
    expect(summary.counts.duplicateResearchPapers).toBe(1);
    expect(summary.counts.duplicateAccessSignals).toBe(1);
    expect(summary.samples.duplicatePeople[0]).toMatchObject({
      identityField: 'email',
      userIds: ['user-1', 'user-2'],
    });
    expect(summary.recommendedCommands).toContain(
      'yarn --cwd server users:dedupe-by-identity --limit=1000 --apply',
    );
  });

  it('fails on duplicate exploratory pathways and active child artifacts on archived entities', () => {
    const summary = buildPostMaterializationIntegritySummary({
      duplicateExploratoryContactPathwayGroups: [
        {
          researchEntityId: 'entity-1',
          pathwayIds: ['pathway-1', 'pathway-2'],
          derivationKeys: ['access-materializer:exploratory-contact', 'legacy-key'],
        },
      ],
      activeArtifactsOnArchivedEntities: [
        {
          artifactType: 'EntryPathway',
          artifactId: 'pathway-3',
          researchEntityId: 'archived-entity',
          canonicalGroupId: 'canonical-entity',
        },
      ],
      limit: 5,
    });

    expect(summary.status).toBe('failure');
    expect(summary.failureNames).toEqual([
      'duplicateExploratoryContactPathways',
      'activeArtifactsOnArchivedEntities',
    ]);
    expect(summary.recommendedCommands).toContain(
      'yarn --cwd server pathways:dedupe-exploratory --limit=1000 --apply',
    );
  });

  it('allows ambiguous same-name labs when PI identity evidence differs or is absent', () => {
    const summary = buildPostMaterializationIntegritySummary({
      samePiNameDuplicateGroups: [],
      duplicateCurrentMemberGroups: [],
      currentMembersOnArchivedEntities: [],
      duplicateExploratoryContactPathwayGroups: [],
      activeArtifactsOnArchivedEntities: [],
      warnings: [
        {
          name: 'ambiguousSameNameResearchEntities',
          count: 2,
          message: 'Same-name groups without shared PI identity require manual review.',
        },
      ],
      limit: 5,
    });

    expect(summary.status).toBe('pass');
    expect(summary.failureNames).toEqual([]);
    expect(summary.warnings).toEqual([
      {
        name: 'ambiguousSameNameResearchEntities',
        count: 2,
        message: 'Same-name groups without shared PI identity require manual review.',
      },
    ]);
  });
});
