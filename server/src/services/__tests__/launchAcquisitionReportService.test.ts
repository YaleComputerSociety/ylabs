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
      observationStorePopulated: vi.fn().mockResolvedValue(true),
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
      observationStorePopulated: vi.fn().mockResolvedValue(true),
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
      observationStorePopulated: vi.fn().mockResolvedValue(true),
    };

    const report = await buildLaunchAcquisitionReport(
      {
        stages: ['source_description', 'pi_identity'],
        limit: 10,
        sampleLimit: 5,
      },
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
        recordId: 'entity-3',
        label: 'Ambiguous PI Lab',
        stage: 'pi_identity',
        rootCauseCategory: 'missing_or_ambiguous_lead',
        currentSourceUrl: 'https://medicine.yale.edu/profile/ambiguous-pi/',
        requiredFact:
          'Official PI/director identity with a unique Yale user, profile URL, or person-specific Yale email.',
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
      observationStorePopulated: vi.fn().mockResolvedValue(true),
    };

    await expect(buildLaunchAcquisitionReport({ limit: 9007199254740992 }, deps)).rejects.toThrow(
      '--limit must be a safe positive integer',
    );

    expect(deps.findQueueItems).not.toHaveBeenCalled();
  });

  it('rejects unsafe report sample limits before loading queue items', async () => {
    const deps = {
      findQueueItems: vi.fn().mockResolvedValue([]),
      findResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn(),
      countSourceObservations: vi.fn(),
      findUsersByUrls: vi.fn(),
      observationStorePopulated: vi.fn().mockResolvedValue(true),
    };

    await expect(
      buildLaunchAcquisitionReport({ sampleLimit: 9007199254740992 }, deps),
    ).rejects.toThrow('--sample-limit must be a safe positive integer');

    expect(deps.findQueueItems).not.toHaveBeenCalled();
  });

  it('reports no action-evidence stage, even over a stored queue item that still names it (#4581)', async () => {
    const deps = {
      findQueueItems: vi
        .fn()
        .mockResolvedValue([item({ recordId: 'entity-1', repairStage: 'action_evidence' })]),
      findResearchEntity: vi.fn(async (id: string) => ({ _id: id, name: 'Legacy Lab', slug: id })),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      countSourceObservations: vi.fn().mockResolvedValue(0),
      findUsersByUrls: vi.fn().mockResolvedValue([]),
      observationStorePopulated: vi.fn().mockResolvedValue(true),
    };

    const report = await buildLaunchAcquisitionReport(
      { stages: ['pi_identity', 'source_description'], limit: 10, sampleLimit: 5 },
      deps,
    );

    expect(report).not.toHaveProperty('actionEvidence');
    expect(report.manifest).toEqual([]);
    expect(Object.values(report.bySource).every((counts) => !('actionEvidence' in counts))).toBe(
      true,
    );
  });
});
