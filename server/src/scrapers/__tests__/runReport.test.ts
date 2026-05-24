import { describe, it, expect } from 'vitest';
import { buildScrapeRunReport, buildSourceEvidenceGapReview } from '../runReport';
import { getSourceCoverage } from '../sourceCoverageRegistry';

const observationCoverage = {
  priority: 7,
  tier: 'THIRD_PARTY_ENRICHMENT',
  artifactTypes: ['Observation'],
  evidenceCategories: ['PUBLICATIONS', 'TOPICS'],
  defaultConfidence: 'MEDIUM',
};

describe('buildScrapeRunReport', () => {
  it('summarizes observations and materialization counters', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-1',
        sourceName: 'openalex',
        status: 'success',
        triggeredBy: 'cli',
        startedAt: new Date('2026-05-01T10:00:00Z'),
        finishedAt: new Date('2026-05-01T10:01:30Z'),
        entitiesCreated: 2,
        entitiesUpdated: 3,
        entitiesArchived: 0,
        options: { useCache: true },
      },
      [
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'title',
          value: 'Paper One',
          sourceUrl: 'https://openalex.org/W1',
        },
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'citedByCount',
          value: 12,
          sourceUrl: 'https://openalex.org/W1',
        },
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'recentPaperCount',
          value: 1,
          sourceUrl: 'https://openalex.org/W1',
        },
      ],
      observationCoverage,
    );

    expect(report.run.id).toBe('run-1');
    expect(report.run.durationSeconds).toBe(90);
    expect(report.observations.total).toBe(3);
    expect(report.observations.active).toBe(3);
    expect(report.observations.superseded).toBe(0);
    expect(report.observations.duplicateRate).toBe(0);
    expect(report.observations.entitiesObserved).toBe(2);
    expect(report.observations.byEntityType).toEqual({ paper: 2, researchEntity: 1 });
    expect(report.observations.topFields[0]).toEqual({ field: 'citedByCount', count: 1 });
    expect(report.materialization).toEqual({
      created: 2,
      updated: 3,
      archived: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    });
    expect(report.warnings).toEqual([]);
  });

  it('includes post-materialization integrity failures separately from materialization errors', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-integrity',
        sourceName: 'openalex',
        status: 'success',
        materializationErrors: 0,
        postMaterializationIntegrity: {
          status: 'failure',
          counts: {
            samePiSameNameResearchEntities: 0,
            officialLabUrlResearchEntities: 0,
            duplicatePeople: 0,
            duplicateResearchPapers: 0,
            duplicateCurrentMembers: 1,
            currentMembersOnArchivedEntities: 0,
            duplicateExploratoryContactPathways: 0,
            duplicateAccessSignals: 0,
            activeArtifactsOnArchivedEntities: 0,
          },
          failureNames: ['duplicateCurrentMembers'],
          samples: {
            samePiSameNameResearchEntities: [],
            officialLabUrlResearchEntities: [],
            duplicatePeople: [],
            duplicateResearchPapers: [],
            duplicateCurrentMembers: [
              {
                researchEntityId: 'entity-1',
                userId: 'user-1',
                role: 'pi',
                memberIds: ['member-1', 'member-2'],
              },
            ],
            currentMembersOnArchivedEntities: [],
            duplicateExploratoryContactPathways: [],
            duplicateAccessSignals: [],
            activeArtifactsOnArchivedEntities: [],
          },
          warnings: [],
          recommendedCommands: [
            'yarn --cwd server research-entity:dedupe-by-pi --limit=1000 --apply',
          ],
        },
      },
      [],
      observationCoverage,
    );

    expect(report.materialization.errors).toBe(0);
    expect(report.postMaterializationIntegrity?.status).toBe('failure');
    expect(report.postMaterializationIntegrity?.failureNames).toEqual(['duplicateCurrentMembers']);
    expect(report.warnings).toContain(
      'Post-materialization integrity gate failed: duplicateCurrentMembers.',
    );
  });

  it('flags conflict candidates and malformed observations', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-2',
        sourceName: 'lab-microsite-undergrad-llm',
        status: 'partial',
        errors: [{ message: 'one page failed', at: '2026-05-01T12:00:00Z' }],
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'acceptingUndergrads',
          value: true,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'acceptingUndergrads',
          value: false,
          confidence: 0.2,
          superseded: true,
        },
        {
          entityType: 'researchEntity',
          field: 'name',
          value: 'Missing Key Lab',
        },
      ],
      {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['AccessSignal', 'ContactRoute', 'Observation'],
        evidenceCategories: ['LAB_WEBSITE', 'UNDERGRAD_ROLE_LANGUAGE'],
        defaultConfidence: 'MEDIUM',
      },
    );

    expect(report.quality.conflictCandidateCount).toBe(1);
    expect(report.quality.conflictCandidates[0]).toMatchObject({
      entityType: 'researchEntity',
      entity: 'smith-lab',
      field: 'acceptingUndergrads',
      distinctValues: 2,
    });
    expect(report.quality.missingEntityIdentifierCount).toBe(1);
    expect(report.quality.missingSourceUrlCount).toBe(3);
    expect(report.quality.lowConfidenceCount).toBe(1);
    expect(report.observations.superseded).toBe(1);
    expect(report.observations.duplicateRate).toBe(1 / 3);
    expect(report.errors).toEqual([
      { message: 'one page failed', at: '2026-05-01T12:00:00.000Z', context: undefined },
    ]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        'Run completed partially; inspect source-level logs/errors.',
        '1 observation(s) lack entityId/entityKey.',
        '1 entity-field conflict candidate(s) found within this run.',
        '1 duplicate observation(s) superseded in this run.',
      ]),
    );
  });

  it('does not flag repeatable inferred PI memberships as conflict candidates', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-repeatable-pi',
        sourceName: 'ysm-atoz-index',
        status: 'success',
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'ysm-digital',
          field: 'inferredPiUserId',
          value: '64f0000000000000000000bb',
          sourceUrl: 'https://medicine.yale.edu/lab/digital/',
        },
        {
          entityType: 'researchEntity',
          entityKey: 'ysm-digital',
          field: 'inferredPiUserId',
          value: '64f0000000000000000000cc',
          sourceUrl: 'https://medicine.yale.edu/lab/digital/',
        },
      ],
      observationCoverage,
    );

    expect(report.quality.conflictCandidateCount).toBe(0);
    expect(report.warnings).not.toContain(
      '1 entity-field conflict candidate(s) found within this run.',
    );
  });

  it('does not flag additive paper authorship evidence as a conflict candidate', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-paper-authorship',
        sourceName: 'europe-pmc',
        status: 'success',
      },
      [
        {
          entityType: 'paper',
          entityKey: 'doi:10.1234/shared',
          field: 'paperAuthorshipEvidence',
          value: {
            userId: '64f000000000000000000001',
            displayName: 'Fixture Author One',
            sourceName: 'europe-pmc',
            method: 'europepmc-orcid',
          },
          sourceUrl: 'https://europepmc.org/article/MED/1',
        },
        {
          entityType: 'paper',
          entityKey: 'doi:10.1234/shared',
          field: 'paperAuthorshipEvidence',
          value: {
            userId: '64f000000000000000000002',
            displayName: 'Fixture Author Two',
            sourceName: 'europe-pmc',
            method: 'europepmc-orcid',
          },
          sourceUrl: 'https://europepmc.org/article/MED/1',
        },
      ],
      observationCoverage,
    );

    expect(report.quality.conflictCandidateCount).toBe(0);
    expect(report.warnings).not.toContain(
      '1 entity-field conflict candidate(s) found within this run.',
    );
  });

  it('flags conflicting user profile URL maps as conflict candidates', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-profile-urls',
        sourceName: 'ysm-atoz-index',
        status: 'success',
      },
      [
        {
          entityType: 'user',
          entityKey: 'netid:fx101',
          field: 'profileUrls',
          value: {
            official: 'https://medicine.yale.edu/lab/digital/profile/fixture-alpha/',
          },
          sourceUrl: 'https://medicine.yale.edu/lab/digital/',
        },
        {
          entityType: 'user',
          entityKey: 'netid:fx101',
          field: 'profileUrls',
          value: {
            official: 'https://medicine.yale.edu/lab/habit/profile/fixture-alpha/',
          },
          sourceUrl: 'https://medicine.yale.edu/lab/habit/',
        },
      ],
      observationCoverage,
    );

    expect(report.quality.conflictCandidateCount).toBe(1);
    expect(report.quality.conflictCandidates[0]).toMatchObject({
      entityType: 'user',
      entity: 'netid:fx101',
      field: 'profileUrls',
      distinctValues: 2,
    });
    expect(report.warnings).toContain(
      '1 entity-field conflict candidate(s) found within this run.',
    );
  });

  it('warns on failed zero-observation runs and fills default counters', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-3',
        sourceName: 'nih-reporter',
        status: 'failure',
        startedAt: '2026-05-01T12:00:00Z',
        finishedAt: undefined,
        invalidated: true,
        errors: [
          {
            message: 'Fetch failed',
            context: { url: 'https://example.test/feed' },
            at: '2026-05-01T12:01:00Z',
          },
          {},
        ],
      },
      [],
      observationCoverage,
    );

    expect(report.run.durationSeconds).toBeUndefined();
    expect(report.run.invalidated).toBe(true);
    expect(report.observations.total).toBe(0);
    expect(report.observations.entitiesObserved).toBe(0);
    expect(report.materialization).toEqual({
      created: 0,
      updated: 0,
      archived: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    });
    expect(report.warnings).toEqual([
      'Run failed; do not materialize without inspecting errors.',
      'Run has been invalidated.',
      'Run produced zero observations.',
    ]);
    expect(report.errors).toEqual([
      {
        message: 'Fetch failed',
        at: '2026-05-01T12:01:00.000Z',
        context: { url: 'https://example.test/feed' },
      },
      { message: 'Unknown scrape error', at: undefined, context: undefined },
    ]);
  });

  it('summarizes dry-run emitted observations from run counters when observations are not persisted', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'dry-run-1',
        sourceName: 'yale-directory',
        status: 'success',
        observationCount: 157,
        entitiesObserved: 25,
        options: { dryRun: true, limit: 25 },
      },
      [],
      observationCoverage,
    );

    expect(report.observations.total).toBe(157);
    expect(report.observations.active).toBe(157);
    expect(report.observations.entitiesObserved).toBe(25);
    expect(report.coverage.observationsEmitted).toBe(157);
    expect(report.warnings).not.toContain('Run produced zero observations.');
    expect(report.warnings).not.toContain(
      'Source coverage metadata exists, but successful run emitted zero observations.',
    );
  });

  it('adds source-level coverage and fetch coverage metrics', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-4',
        sourceName: 'lab-microsite-undergrad-llm',
        status: 'success',
        entitiesCreated: 1,
        entitiesUpdated: 2,
        fetchMetrics: {
          attempts: [
            {
              target: 'https://lab.example.edu',
              success: true,
              latencyMs: 100,
              fetchMode: 'http',
              blocked: false,
              selectorBreakage: false,
            },
            {
              target: 'https://lab.example.edu/join',
              success: false,
              latencyMs: 200,
              fetchMode: 'rendered',
              blocked: true,
              blockedReason: '403',
              selectorBreakage: false,
              statusCode: 403,
            },
          ],
          summary: {
            total: 2,
            succeeded: 1,
            failed: 1,
            blocked: 1,
            selectorBreakages: 0,
            averageLatencyMs: 150,
            byMode: {
              http: {
                total: 1,
                succeeded: 1,
                blocked: 0,
                selectorBreakages: 0,
                averageLatencyMs: 100,
              },
              rendered: {
                total: 1,
                succeeded: 0,
                blocked: 1,
                selectorBreakages: 0,
                averageLatencyMs: 200,
              },
            },
          },
        },
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'undergradAccessEvidence',
          value: { verdict: 'yes' },
          sourceUrl: 'https://lab.example.edu',
        },
      ],
      {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
        evidenceCategories: [
          'LAB_WEBSITE',
          'JOIN_INSTRUCTIONS',
          'UNDERGRAD_ROLE_LANGUAGE',
        ],
        defaultConfidence: 'MEDIUM',
        notes: 'Preserve source URLs.',
      },
    );

    expect(report.coverage.source).toMatchObject({
      priority: 1,
      tier: 'PRIMARY_OFFICIAL',
      artifactTypes: {
        total: 4,
      },
      evidenceCategories: {
        total: 3,
      },
      defaultConfidence: 'MEDIUM',
      notes: 'Preserve source URLs.',
    });
    expect(report.coverage.source?.artifactTypes.values).toHaveLength(4);
    expect(report.coverage.source?.artifactTypes.values).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation']),
    );
    expect(report.coverage.source?.evidenceCategories.values).toHaveLength(3);
    expect(report.coverage.source?.evidenceCategories.values).toEqual(
      expect.arrayContaining(['LAB_WEBSITE', 'JOIN_INSTRUCTIONS', 'UNDERGRAD_ROLE_LANGUAGE']),
    );
    expect(report.coverage.fetch).toMatchObject({
      pagesVisited: 2,
      pagesFetched: 1,
      attempts: 2,
      succeeded: 1,
      failed: 1,
      blocked: 1,
      selectorBreakages: 0,
    });
    expect(report.coverage.fetch.byMode.rendered).toMatchObject({
      total: 1,
      succeeded: 0,
      blocked: 1,
    });
    expect(report.coverage.observationsEmitted).toBe(1);
    expect(report.coverage.materializationWrites).toBe(3);
    expect(report.warnings).toEqual([]);
  });

  it('exposes persisted WorkPlanner metrics in reports', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-workplanner',
        sourceName: 'lab-microsite-undergrad-llm',
        status: 'success',
        metrics: {
          workPlanner: {
            planned: 5,
            fetched: 2,
            skippedFresh: 2,
            skippedManualLock: 1,
            skippedNoIdentifier: 0,
          },
        },
      },
      [],
      {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
        evidenceCategories: ['LAB_WEBSITE', 'JOIN_INSTRUCTIONS'],
        defaultConfidence: 'MEDIUM',
      },
    );

    expect(report.metrics?.workPlanner).toEqual({
      planned: 5,
      fetched: 2,
      skippedFresh: 2,
      skippedManualLock: 1,
      skippedNoIdentifier: 0,
    });
    expect(report.coverage.workPlanner).toEqual(report.metrics?.workPlanner);
  });

  it('warns when fellowship catalog metrics need operator review', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-fellowships',
        sourceName: 'yale-college-fellowships-office',
        status: 'success',
        metrics: {
          fellowshipCatalog: {
            discovered: 5,
            emitted: 5,
            created: 1,
            updated: 2,
            unchanged: 2,
            reviewRequired: 1,
            missingPreviouslySeen: 2,
            deadlineParsed: 3,
            deadlineMissing: 2,
          },
        },
      },
      [
        {
          entityType: 'fellowship',
          entityKey: 'yale-college-fellowships-office:fort-family-research-fellowship',
          field: 'title',
          value: 'Fort Family Research Fellowship',
          sourceUrl: 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
        },
      ],
      getSourceCoverage('yale-college-fellowships-office'),
    );

    expect(report.metrics?.fellowshipCatalog).toMatchObject({
      discovered: 5,
      reviewRequired: 1,
      missingPreviouslySeen: 2,
    });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        '1 fellowship catalog row(s) require operator review.',
        '2 previously seen fellowship source row(s) were missing from this run; no rows were archived automatically.',
      ]),
    );
  });

  it('does not warn on zero-observation runs when WorkPlanner intentionally skipped all work', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-workplanner-skipped',
        sourceName: 'lab-microsite-undergrad-llm',
        status: 'success',
        metrics: {
          workPlanner: {
            planned: 10,
            fetched: 0,
            skippedFresh: 10,
            skippedManualLock: 0,
            skippedNoIdentifier: 0,
          },
        },
      },
      [],
      {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
        evidenceCategories: ['LAB_WEBSITE', 'JOIN_INSTRUCTIONS'],
        defaultConfidence: 'MEDIUM',
      },
    );

    expect(report.coverage.workPlanner).toEqual({
      planned: 10,
      fetched: 0,
      skippedFresh: 10,
      skippedManualLock: 0,
      skippedNoIdentifier: 0,
    });
    expect(report.warnings).toEqual([]);
  });

  it('warns when source coverage and run output diverge', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-5',
        sourceName: 'ylabs-listing',
        status: 'success',
        fetchMetrics: {
          attempts: [
            {
              target: 'https://example.test/listings',
              success: true,
              latencyMs: 50,
              fetchMode: 'api',
              blocked: false,
              selectorBreakage: false,
            },
          ],
          summary: {
            total: 1,
            succeeded: 1,
            failed: 0,
            blocked: 0,
            selectorBreakages: 0,
            averageLatencyMs: 50,
            byMode: {
              api: {
                total: 1,
                succeeded: 1,
                blocked: 0,
                selectorBreakages: 0,
                averageLatencyMs: 50,
              },
            },
          },
        },
      },
      [],
      {
        priority: 5,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'PostedOpportunity'],
        evidenceCategories: ['POSTED_OPENING', 'APPLICATION_LINK'],
        defaultConfidence: 'HIGH',
      },
    );

    expect(report.warnings).toEqual(
      expect.arrayContaining([
        'Run produced zero observations.',
        'Source coverage metadata exists, but successful run emitted zero observations.',
        '1 fetch(es) succeeded, but run emitted zero observations.',
      ]),
    );
  });

  it('warns when emitted observations are not represented in source coverage metadata', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-6',
        sourceName: 'ylabs-listing',
        status: 'success',
      },
      [
        {
          entityType: 'listing',
          entityKey: 'listing-1',
          field: 'title',
          value: 'Research role',
          sourceUrl: 'https://example.test/listings/1',
        },
      ],
      {
        priority: 5,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'PostedOpportunity'],
        evidenceCategories: ['POSTED_OPENING', 'APPLICATION_LINK'],
        defaultConfidence: 'HIGH',
      },
    );

    expect(report.warnings).toContain(
      'Source coverage metadata does not list Observation artifacts, but run emitted 1 observation(s).',
    );
  });

  it('reports post-materialization access artifact metrics for known sources', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-7',
        sourceName: 'lab-microsite-undergrad-llm',
        status: 'success',
        postMaterializationMetrics: {
          entryPathways: 2,
          accessSignals: 3,
          contactRoutes: 1,
          postedOpportunities: 0,
          guardedContactRoutes: 1,
          staleEvidenceSkipped: 2,
          conflicts: 0,
          errors: 0,
        },
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'undergradAccessEvidence',
          value: { openToUndergrads: 'yes' },
          sourceUrl: 'https://lab.example.edu/join',
        },
      ],
      {
        priority: 1,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
        evidenceCategories: ['LAB_WEBSITE', 'JOIN_INSTRUCTIONS'],
        defaultConfidence: 'MEDIUM',
      },
    );

    expect(report.coverage.postMaterialization).toMatchObject({
      entryPathways: 2,
      accessSignals: 3,
      contactRoutes: 1,
      postedOpportunities: 0,
      guardedContactRoutes: 1,
      staleEvidenceSkipped: 2,
      conflicts: 0,
      errors: 0,
      totalAccessArtifacts: 6,
      missingExpectedArtifactTypes: [],
    });
    expect(report.coverage.postMaterialization?.expectedArtifactTypes).toHaveLength(3);
    expect(report.coverage.postMaterialization?.expectedArtifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal', 'ContactRoute']),
    );
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        '1 contact route(s) were guarded from public exposure.',
        '2 stale evidence item(s) skipped during materialization.',
      ]),
    );
  });

  it('warns when expected access artifacts produce no post-materialization output', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-8',
        sourceName: 'department-research-pathways',
        status: 'success',
        postMaterializationMetrics: {
          entryPathways: 0,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 0,
        },
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'history',
          field: 'independentStudyCourses',
          value: [{ code: 'HIST 471', title: 'Independent Study' }],
          sourceUrl: 'https://courses.example.edu/history',
        },
      ],
      {
        priority: 3,
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['EntryPathway', 'AccessSignal', 'Observation'],
        evidenceCategories: ['COURSE_CREDIT'],
        defaultConfidence: 'HIGH',
      },
    );

    expect(report.coverage.postMaterialization?.missingExpectedArtifactTypes).toEqual([
      'EntryPathway',
      'AccessSignal',
    ]);
    expect(report.warnings).toContain(
      'Source coverage expects access artifacts (EntryPathway, AccessSignal), but post-materialization metrics report zero access artifacts.',
    );
  });

  it('does not warn on zero new access artifacts when the chunk emitted only profile context', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-8b',
        sourceName: 'dept-faculty-roster',
        status: 'success',
        postMaterializationMetrics: {
          entryPathways: 0,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 0,
        },
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-eeb-example',
          field: 'researchAreas',
          value: ['community ecology'],
          sourceUrl: 'https://eeb.yale.edu/people/faculty/example',
        },
      ],
      {
        priority: 2,
        tier: 'OFFICIAL_INDEX',
        artifactTypes: ['ResearchEntity', 'EntryPathway', 'ContactRoute', 'Observation'],
        evidenceCategories: ['ENTITY_IDENTITY', 'OFFICIAL_PROFILE', 'TOPICS'],
        defaultConfidence: 'HIGH',
      },
    );

    expect(report.coverage.postMaterialization?.missingExpectedArtifactTypes).toEqual([
      'EntryPathway',
      'ContactRoute',
    ]);
    expect(report.warnings).not.toContain(
      'Source coverage expects access artifacts (EntryPathway, ContactRoute), but post-materialization metrics report zero access artifacts.',
    );
    expect(report.warnings).not.toContain(
      'Post-materialization metrics are missing expected artifact type(s): EntryPathway, ContactRoute.',
    );
  });

  it('does not add access-artifact warnings for observation-only sources', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-9',
        sourceName: 'openalex',
        status: 'success',
        postMaterializationMetrics: {
          entryPathways: 0,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 0,
        },
      },
      [
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'title',
          value: 'Paper One',
          sourceUrl: 'https://openalex.org/W1',
        },
      ],
      observationCoverage,
    );

    expect(report.coverage.postMaterialization).toMatchObject({
      totalAccessArtifacts: 0,
      expectedArtifactTypes: [],
      missingExpectedArtifactTypes: [],
    });
    expect(report.warnings).toEqual([]);
  });

  it('warns when observation-only sources create access artifacts', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-9b',
        sourceName: 'nsf-award-search',
        status: 'success',
        postMaterializationMetrics: {
          entryPathways: 1,
          accessSignals: 1,
          contactRoutes: 1,
          postedOpportunities: 0,
        },
      },
      [
        {
          entityType: 'researchEntity',
          entityKey: 'nsf-ada-lovelace',
          field: 'recentGrants',
          value: [{ id: '123' }],
          sourceUrl: 'https://www.research.gov/awardsearch/showAward?AWD_ID=123',
        },
      ],
      {
        priority: 6,
        tier: 'THIRD_PARTY_ENRICHMENT',
        artifactTypes: ['ResearchEntity', 'Observation'],
        evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
        defaultConfidence: 'MEDIUM',
      },
    );

    expect(report.coverage.postMaterialization).toMatchObject({
      totalAccessArtifacts: 3,
      expectedArtifactTypes: [],
      missingExpectedArtifactTypes: [],
    });
    expect(report.warnings).toContain(
      'Source coverage does not expect access artifacts, but post-materialization created 3 access artifact(s).',
    );
  });

  it('builds a source evidence gap review for access, fellowship, and posted-role sources', () => {
    const review = buildSourceEvidenceGapReview([
      {
        sourceName: 'lab-microsite-undergrad-llm',
        sourceCoverage: getSourceCoverage('lab-microsite-undergrad-llm'),
        postMaterializationMetrics: {
          entryPathways: 2,
          accessSignals: 2,
          contactRoutes: 1,
          postedOpportunities: 0,
        },
      },
      {
        sourceName: 'undergrad-fellowships-recipients',
        sourceCoverage: getSourceCoverage('undergrad-fellowships-recipients'),
        postMaterializationMetrics: {
          entryPathways: 0,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 0,
        },
      },
      {
        sourceName: 'ylabs-listing',
        sourceCoverage: getSourceCoverage('ylabs-listing'),
        postMaterializationMetrics: {
          entryPathways: 1,
          accessSignals: 1,
          postedOpportunities: 1,
        },
      },
      {
        sourceName: 'unknown-source',
      },
    ]);

    expect(review).toHaveLength(4);
    expect(review).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'lab-microsite-undergrad-llm',
          actualArtifactCounts: expect.objectContaining({
            entryPathways: 2,
            accessSignals: 2,
            contactRoutes: 1,
            postedOpportunities: 0,
          }),
          missingExpectedArtifactTypes: [],
          totalAccessArtifacts: 5,
          hasGap: false,
          coverageKnown: true,
        }),
        expect.objectContaining({
          sourceName: 'undergrad-fellowships-recipients',
          actualArtifactCounts: expect.objectContaining({
            entryPathways: 0,
            accessSignals: 0,
            contactRoutes: 0,
            postedOpportunities: 0,
          }),
          totalAccessArtifacts: 0,
          hasGap: true,
          coverageKnown: true,
        }),
        expect.objectContaining({
          sourceName: 'ylabs-listing',
          actualArtifactCounts: expect.objectContaining({
            entryPathways: 1,
            accessSignals: 1,
            contactRoutes: 0,
            postedOpportunities: 1,
          }),
          missingExpectedArtifactTypes: [],
          totalAccessArtifacts: 3,
          hasGap: false,
          coverageKnown: true,
        }),
        expect.objectContaining({
          sourceName: 'unknown-source',
          expectedArtifactTypes: [],
          actualArtifactCounts: expect.objectContaining({
            entryPathways: 0,
            accessSignals: 0,
            contactRoutes: 0,
            postedOpportunities: 0,
          }),
          missingExpectedArtifactTypes: [],
          totalAccessArtifacts: 0,
          hasGap: false,
          coverageKnown: false,
        }),
      ]),
    );

    const reviewBySource = new Map(review.map((row) => [row.sourceName, row]));
    expect(reviewBySource.get('lab-microsite-undergrad-llm')?.expectedArtifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal', 'ContactRoute']),
    );
    expect(reviewBySource.get('lab-microsite-undergrad-llm')?.expectedArtifactTypes).toHaveLength(3);
    expect(reviewBySource.get('undergrad-fellowships-recipients')?.expectedArtifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal']),
    );
    expect(reviewBySource.get('undergrad-fellowships-recipients')?.expectedArtifactTypes).toHaveLength(2);
    expect(reviewBySource.get('undergrad-fellowships-recipients')?.missingExpectedArtifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal']),
    );
    expect(reviewBySource.get('undergrad-fellowships-recipients')?.missingExpectedArtifactTypes).toHaveLength(2);
    expect(reviewBySource.get('ylabs-listing')?.expectedArtifactTypes).toEqual(
      expect.arrayContaining(['EntryPathway', 'AccessSignal', 'PostedOpportunity']),
    );
    expect(reviewBySource.get('ylabs-listing')?.expectedArtifactTypes).toHaveLength(3);
  });
});
