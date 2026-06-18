import { describe, expect, it, vi } from 'vitest';

import {
  buildLaunchAcquisitionReport,
  type LaunchAcquisitionReportQueueItem,
} from '../launchAcquisitionReportService';

const item = (
  overrides: Partial<LaunchAcquisitionReportQueueItem> = {},
): LaunchAcquisitionReportQueueItem => ({
  _id: 'queue-1',
  collection: 'research',
  recordId: 'entity-1',
  label: 'Example Lab',
  repairStage: 'pi_identity',
  blockerReasons: ['missing_lead'],
  sourceNames: ['ysm-atoz-index'],
  ...overrides,
});

describe('launchAcquisitionReportService', () => {
  it('groups PI identity blockers by source evidence and match posture without writing', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([
        item({
          _id: 'missing-profile',
          recordId: 'entity-1',
          label: 'Missing Profile Lab',
          sourceNames: ['dept-faculty-roster'],
        }),
        item({
          _id: 'exact-profile',
          recordId: 'entity-2',
          label: 'Ada Lovelace Lab',
          sourceNames: ['ysm-atoz-index'],
        }),
        item({
          _id: 'not-required',
          recordId: 'entity-3',
          label: 'Archive Collection',
          sourceNames: ['archives-index'],
        }),
      ]),
      findResearchEntity: vi.fn(async (id: string) => {
        if (id === 'entity-1') {
          return {
            _id: id,
            name: 'Missing Profile Lab',
            type: 'LAB',
            slug: 'missing-profile-lab',
            sourceUrls: ['https://medicine.yale.edu/example/lab'],
          };
        }
        if (id === 'entity-2') {
          return {
            _id: id,
            name: 'Ada Lovelace Lab',
            type: 'LAB',
            slug: 'ada-lovelace-lab',
            websiteUrl: 'https://medicine.yale.edu/profile/ada-lovelace/',
            sourceUrls: ['https://medicine.yale.edu/profile/ada-lovelace/'],
          };
        }
        return {
          _id: id,
          name: 'Archive Collection',
          type: 'COLLECTION',
          slug: 'archive-collection',
          sourceUrls: ['https://library.yale.edu/archive'],
        };
      }),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      countSourceObservations: vi.fn(async (entity: Record<string, unknown>) =>
        entity._id === 'entity-1' ? 2 : 0,
      ),
      findUsersByUrls: vi.fn(async (urls: string[]) =>
        urls.some((url) => url.includes('/profile/ada-lovelace/'))
          ? [{ _id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' }]
          : [],
      ),
      countUndergraduateAccessObservations: vi.fn().mockResolvedValue(0),
      countAccessRecords: vi.fn().mockResolvedValue({ accessSignals: 0, entryPathways: 0, contactRoutes: 0 }),
    };

    const report = await buildLaunchAcquisitionReport(
      { stages: ['pi_identity'], limit: 10, sampleLimit: 5 },
      deps,
    );

    expect(report.mode).toBe('read-only');
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deps.findUsersByUrls).toHaveBeenCalled();
    expect(report.piIdentity?.total).toBe(3);
    expect(report.piIdentity?.groups.missingOfficialProfileUrl.count).toBe(2);
    expect(report.piIdentity?.groups.sourceObservationsPresent.count).toBe(1);
    expect(report.piIdentity?.groups.exactSingleUserMatch.count).toBe(1);
    expect(report.piIdentity?.groups.leadNotRequiredByEntityType.count).toBe(1);
    expect(report.bySource['ysm-atoz-index'].piIdentity).toBe(1);
    expect(report.bySource['dept-faculty-roster'].piIdentity).toBe(1);
  });

  it('groups action-evidence blockers by source and materialization posture', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([
        item({
          _id: 'none',
          recordId: 'entity-1',
          label: 'No Source Lab',
          repairStage: 'action_evidence',
          blockerReasons: ['missing_action_evidence'],
          sourceNames: [],
        }),
        item({
          _id: 'access-observation',
          recordId: 'entity-2',
          label: 'Observed Undergrad Lab',
          repairStage: 'action_evidence',
          blockerReasons: ['missing_action_evidence'],
          sourceNames: ['department-undergrad-research'],
        }),
        item({
          _id: 'untrusted',
          recordId: 'entity-3',
          label: 'External Route Lab',
          repairStage: 'action_evidence',
          blockerReasons: ['missing_action_evidence'],
          sourceNames: ['external-index'],
        }),
        item({
          _id: 'materialized',
          recordId: 'entity-4',
          label: 'Materialized Route Lab',
          repairStage: 'action_evidence',
          blockerReasons: ['missing_action_evidence'],
          sourceNames: ['ysm-atoz-index'],
        }),
      ]),
      findResearchEntity: vi.fn(async (id: string) => ({
        _id: id,
        name: id,
        type: 'LAB',
        slug: id,
        sourceUrls: id === 'entity-3' ? ['https://example.com/apply'] : ['https://yale.edu/lab'],
      })),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      countSourceObservations: vi.fn(async (entity: Record<string, unknown>) =>
        entity._id === 'entity-1' ? 0 : 1,
      ),
      findUsersByUrls: vi.fn().mockResolvedValue([]),
      countUndergraduateAccessObservations: vi.fn(async (entity: Record<string, unknown>) =>
        entity._id === 'entity-2' ? 3 : 0,
      ),
      countAccessRecords: vi.fn(async (id: string) =>
        id === 'entity-4'
          ? { accessSignals: 1, entryPathways: 1, contactRoutes: 1 }
          : { accessSignals: 0, entryPathways: 0, contactRoutes: 0 },
      ),
    };

    const report = await buildLaunchAcquisitionReport(
      { stages: ['action_evidence'], limit: 10, sampleLimit: 5 },
      deps,
    );

    expect(report.actionEvidence?.total).toBe(4);
    expect(report.actionEvidence?.groups.noSourceObservations.count).toBe(1);
    expect(report.actionEvidence?.groups.sourceObservationsWithoutUndergradAccess.count).toBe(1);
    expect(report.actionEvidence?.groups.untrustedExternalRouteEvidence.count).toBe(1);
    expect(report.actionEvidence?.groups.sourceBackedRouteNotLaunchMaterialized.count).toBe(1);
    expect(report.bySource['department-undergrad-research'].actionEvidence).toBe(1);
    expect(report.bySource['unattributed'].actionEvidence).toBe(1);
  });

  it('groups source-description blockers by source URL posture', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([
        item({
          _id: 'missing-url',
          recordId: 'entity-1',
          label: 'Missing URL Research',
          repairStage: 'source_description',
          blockerReasons: ['missing_description', 'missing_source_url'],
          sourceNames: [],
        }),
        item({
          _id: 'grant-only',
          recordId: 'entity-2',
          label: 'Grant Only Lab',
          repairStage: 'source_description',
          blockerReasons: ['profile_fallback_only'],
          sourceNames: ['nih-reporter'],
        }),
        item({
          _id: 'thin-profile',
          recordId: 'entity-3',
          label: 'Thin Profile Lab',
          repairStage: 'source_description',
          blockerReasons: ['thin_description'],
          sourceNames: ['official-profile-enrichment'],
        }),
        item({
          _id: 'card',
          recordId: 'entity-4',
          label: 'Card Description Lab',
          repairStage: 'source_description',
          blockerReasons: ['missing_card_description'],
          sourceNames: ['ysm-atoz-index'],
        }),
      ]),
      findResearchEntity: vi.fn(async (id: string) => {
        if (id === 'entity-1') {
          return { _id: id, name: 'Missing URL Research', slug: id, sourceUrls: [] };
        }
        if (id === 'entity-2') {
          return {
            _id: id,
            name: 'Grant Only Lab',
            slug: id,
            sourceUrls: ['https://reporter.nih.gov/project-details/123'],
          };
        }
        if (id === 'entity-3') {
          return {
            _id: id,
            name: 'Thin Profile Lab',
            slug: id,
            websiteUrl: 'https://medicine.yale.edu/profile/thin-profile/',
            sourceUrls: ['https://medicine.yale.edu/profile/thin-profile/'],
            fullDescription: 'Studies cancer.',
          };
        }
        return {
          _id: id,
          name: 'Card Description Lab',
          slug: id,
          websiteUrl: 'https://medicine.yale.edu/lab/card/',
          sourceUrls: ['https://medicine.yale.edu/lab/card/'],
          fullDescription:
            'The lab studies immune mechanisms, tumor biology, translational biomarkers, and computational methods for understanding treatment response.',
        };
      }),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      countSourceObservations: vi.fn().mockResolvedValue(0),
      findUsersByUrls: vi.fn().mockResolvedValue([]),
      countUndergraduateAccessObservations: vi.fn().mockResolvedValue(0),
      countAccessRecords: vi.fn().mockResolvedValue({ accessSignals: 0, entryPathways: 0, contactRoutes: 0 }),
    };

    const report = await buildLaunchAcquisitionReport(
      { stages: ['source_description'], limit: 10, sampleLimit: 5 },
      deps,
    );

    expect(report.sourceDescription?.total).toBe(4);
    expect(report.sourceDescription?.groups.missingSourceUrl.count).toBe(1);
    expect(report.sourceDescription?.groups.rejectedSourceHost.count).toBe(1);
    expect(report.sourceDescription?.groups.yaleProfileThinText.count).toBe(1);
    expect(report.sourceDescription?.groups.cardDescriptionDerivable.count).toBe(1);
    expect(report.bySource['nih-reporter'].sourceDescription).toBe(1);
    expect(report.bySource['unattributed'].sourceDescription).toBe(1);
  });

  it('emits decision-ready manifest rows with root cause and next command guidance', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([
        item({
          _id: 'missing-url',
          recordId: 'entity-1',
          label: 'Missing URL Research',
          repairStage: 'source_description',
          blockerReasons: ['missing_description', 'missing_source_url'],
          sourceNames: [],
        }),
        item({
          _id: 'grant-action',
          recordId: 'entity-2',
          label: 'Grant Only Action Lab',
          repairStage: 'action_evidence',
          blockerReasons: ['missing_action_evidence'],
          sourceNames: ['nih-reporter'],
        }),
        item({
          _id: 'ambiguous-pi',
          recordId: 'entity-3',
          label: 'Ambiguous PI Lab',
          repairStage: 'pi_identity',
          blockerReasons: ['missing_lead'],
          sourceNames: ['official-profile-pi-backfill'],
        }),
      ]),
      findResearchEntity: vi.fn(async (id: string) => {
        if (id === 'entity-1') {
          return { _id: id, name: 'Missing URL Research', slug: id, sourceUrls: [] };
        }
        if (id === 'entity-2') {
          return {
            _id: id,
            name: 'Grant Only Action Lab',
            slug: id,
            sourceUrls: ['https://reporter.nih.gov/project-details/123'],
          };
        }
        return {
          _id: id,
          name: 'Ambiguous PI Lab',
          slug: id,
          websiteUrl: 'https://medicine.yale.edu/profile/ambiguous-pi/',
          sourceUrls: ['https://medicine.yale.edu/profile/ambiguous-pi/'],
        };
      }),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      countSourceObservations: vi.fn().mockResolvedValue(1),
      findUsersByUrls: vi.fn(async (urls: string[]) =>
        urls.some((url) => url.includes('/profile/ambiguous-pi/'))
          ? [
              { _id: 'user-1', fname: 'Ada', lname: 'Lovelace' },
              { _id: 'user-2', fname: 'Grace', lname: 'Hopper' },
            ]
          : [],
      ),
      countUndergraduateAccessObservations: vi.fn().mockResolvedValue(0),
      countAccessRecords: vi.fn().mockResolvedValue({ accessSignals: 0, entryPathways: 0, contactRoutes: 0 }),
    };

    const report = await buildLaunchAcquisitionReport(
      { stages: ['source_description', 'action_evidence', 'pi_identity'], limit: 10, sampleLimit: 5 },
      deps,
    );

    expect(report.manifest).toEqual([
      expect.objectContaining({
        recordId: 'entity-1',
        label: 'Missing URL Research',
        stage: 'source_description',
        rootCauseCategory: 'missing_official_url',
        currentSourceUrl: '',
        candidateSourceUrls: [],
        requiredFact: 'Current official Yale or lab page with research-specific prose.',
        safeNextCommand:
          'SCRAPER_ENV=beta yarn --cwd server research-homes:backfill-official-urls --dry-run --limit=100 --output /tmp/ylabs-research-home-url-backfill.json',
      }),
      expect.objectContaining({
        recordId: 'entity-2',
        label: 'Grant Only Action Lab',
        stage: 'action_evidence',
        rootCauseCategory: 'grant_not_action_evidence',
        currentSourceUrl: 'https://reporter.nih.gov/project-details/123',
        requiredFact: 'Official Yale page with undergraduate access, application, contact, or outreach instructions.',
      }),
      expect.objectContaining({
        recordId: 'entity-3',
        label: 'Ambiguous PI Lab',
        stage: 'pi_identity',
        rootCauseCategory: 'missing_or_ambiguous_lead',
        currentSourceUrl: 'https://medicine.yale.edu/profile/ambiguous-pi/',
        requiredFact: 'Official PI/director identity with a unique Yale user, profile URL, or person-specific Yale email.',
      }),
    ]);
  });

  it('rejects unsafe report limits before loading queue items', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([]),
      findResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn(),
      countSourceObservations: vi.fn(),
      findUsersByUrls: vi.fn(),
      countUndergraduateAccessObservations: vi.fn(),
      countAccessRecords: vi.fn(),
    };

    await expect(
      buildLaunchAcquisitionReport({ limit: 9007199254740992 }, deps),
    ).rejects.toThrow('--limit must be a safe positive integer');

    expect(deps.findQueueItems).not.toHaveBeenCalled();
  });

  it('rejects unsafe report sample limits before loading queue items', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([]),
      findResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn(),
      countSourceObservations: vi.fn(),
      findUsersByUrls: vi.fn(),
      countUndergraduateAccessObservations: vi.fn(),
      countAccessRecords: vi.fn(),
    };

    await expect(
      buildLaunchAcquisitionReport({ sampleLimit: 9007199254740992 }, deps),
    ).rejects.toThrow('--sample-limit must be a safe positive integer');

    expect(deps.findQueueItems).not.toHaveBeenCalled();
  });
});
