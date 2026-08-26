import { describe, it, expect, vi, afterEach } from 'vitest';
import { Observation } from '../../models/observation';
import {
  appendObservations,
  buildObservationFingerprint,
  isRegressiveProseRefresh,
  retireObservations,
} from '../observationStore';
import { fullDescriptionQuality } from '../../utils/researchEntityDescriptionQuality';

const USEFUL_DESCRIPTION =
  'The reachable lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.';
const DEGRADED_DESCRIPTION = 'Our lab studies things.';

describe('buildObservationFingerprint', () => {
  it('makes logistics updates latest-wins within a source but distinct across sources', () => {
    const base = {
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
    };
    const logisticsFields = [
      'undergraduateLogisticsStudentLevel',
      'undergraduateLogisticsCompensation',
      'undergraduateLogisticsTimeCommitment',
      'undergraduateLogisticsModality',
      'undergraduateLogisticsCurrentAvailability',
    ];

    for (const field of logisticsFields) {
      const oldValue = buildObservationFingerprint({
        ...base,
        field,
        sourceName: 'lab-microsite-undergrad-llm',
        value: { revision: 1 },
      });
      const newValue = buildObservationFingerprint({
        ...base,
        field,
        sourceName: 'lab-microsite-undergrad-llm',
        value: { revision: 2 },
      });

      expect(oldValue).toBe(newValue);
    }

    const otherSource = buildObservationFingerprint({
      ...base,
      field: 'undergraduateLogisticsCurrentAvailability',
      sourceName: 'manual-admin-edit',
      value: { status: 'NOT_CURRENTLY_AVAILABLE' },
    });
    const extractorSource = buildObservationFingerprint({
      ...base,
      field: 'undergraduateLogisticsCurrentAvailability',
      sourceName: 'lab-microsite-undergrad-llm',
      value: { status: 'NOT_CURRENTLY_AVAILABLE' },
    });

    expect(otherSource).not.toBe(extractorSource);
  });

  it('makes sourceContentHash latest-wins so each run supersedes the prior hash', () => {
    const base = {
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      sourceName: 'lab-microsite-description-llm',
      field: 'sourceContentHash',
    };
    expect(buildObservationFingerprint({ ...base, value: 'hash-a' })).toBe(
      buildObservationFingerprint({ ...base, value: 'hash-b' }),
    );
  });

  it('is stable for same-source equivalent observations', () => {
    const a = buildObservationFingerprint({
      sourceName: 'openalex',
      entityType: 'paper',
      entityKey: 'W1',
      field: 'topics',
      value: [{ b: 2, a: 1 }, 'Quantum'],
    });
    const b = buildObservationFingerprint({
      sourceName: 'openalex',
      entityType: 'paper',
      entityKey: 'W1',
      field: 'topics',
      value: ['quantum', { a: 1, b: 2 }],
    });

    expect(a).toBe(b);
  });

  it('keeps same facts from different sources distinct', () => {
    const base = {
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      field: 'acceptingUndergrads',
      value: true,
    };

    expect(buildObservationFingerprint({ ...base, sourceName: 'openalex' })).not.toBe(
      buildObservationFingerprint({ ...base, sourceName: 'lab-microsite-undergrad-llm' }),
    );
  });

  it('ignores value drift for latest-wins fields so new observations supersede the prior one', () => {
    const base = {
      sourceName: 'lab-microsite-description-llm',
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
    };
    for (const field of [
      'fullDescription',
      'shortDescription',
      'researchAreas',
      'methods',
      'recentGrants',
      'recentGrantCount',
      'fundingAgencies',
    ]) {
      const v1 = buildObservationFingerprint({ ...base, field, value: 'The Smith Lab studies X.' });
      const v2 = buildObservationFingerprint({
        ...base,
        field,
        value: 'The Smith Lab investigates X and Y.',
      });
      expect(v1).toBe(v2);
    }
  });

  it('makes currentUndergradCount latest-wins so a corrected re-scrape supersedes a stale count', () => {
    const base = {
      sourceName: 'lab-microsite-undergrad-llm',
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      field: 'currentUndergradCount',
    };
    const contaminated = buildObservationFingerprint({ ...base, value: 40 });
    const corrected = buildObservationFingerprint({ ...base, value: 28 });
    expect(contaminated).toBe(corrected);
  });

  it('makes undergradEvidenceQuote latest-wins so a corrected quote supersedes a stale historical one', () => {
    const base = {
      sourceName: 'lab-microsite-undergrad-llm',
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      field: 'undergradEvidenceQuote',
    };
    const historical = buildObservationFingerprint({
      ...base,
      value: 'Matthew Barber (Physics, Yale College, 2009); Associate at Flexpoint Ford',
    });
    const corrected = buildObservationFingerprint({
      ...base,
      value: 'Jane Doe is a junior at Yale College majoring in Physics.',
    });
    expect(historical).toBe(corrected);
  });

  it('makes every source-owned fellowship snapshot field latest-wins', () => {
    const base = {
      sourceName: 'yale-college-fellowships-office',
      entityType: 'fellowship',
      entityKey: 'yale-college-fellowships-office:fixture',
    };

    for (const field of [
      'applicationInformation',
      'applicationMaterials',
      'researchFocused',
      'sourceFingerprint',
      'purpose',
      'links',
      'sourceUrl',
      'programCategory',
      'reviewRequired',
    ]) {
      const populated = buildObservationFingerprint({
        ...base,
        field,
        value: field === 'researchFocused' ? true : ['Transcript'],
      });
      const cleared = buildObservationFingerprint({
        ...base,
        field,
        value: field === 'researchFocused' ? false : [],
      });
      expect(populated).toBe(cleared);
    }

    expect(
      buildObservationFingerprint({
        ...base,
        field: 'sourceUrl',
        value: 'https://example.yale.edu/fixture',
      }),
    ).not.toBe(
      buildObservationFingerprint({
        ...base,
        sourceName: 'manual-fellowship-review',
        field: 'sourceUrl',
        value: 'https://example.yale.edu/fixture',
      }),
    );
  });

  it('still distinguishes values for non-latest-wins fields', () => {
    const base = {
      sourceName: 'centers-institutes-index',
      entityType: 'researchEntity',
      entityKey: 'smith-lab',
      field: 'websiteUrl',
    };
    expect(buildObservationFingerprint({ ...base, value: 'https://a.yale.edu' })).not.toBe(
      buildObservationFingerprint({ ...base, value: 'https://b.yale.edu' }),
    );
  });
});

describe('isRegressiveProseRefresh', () => {
  it('uses fixtures whose usefulness matches the shared quality gate', () => {
    expect(fullDescriptionQuality(USEFUL_DESCRIPTION).isUseful).toBe(true);
    expect(fullDescriptionQuality(DEGRADED_DESCRIPTION).isUseful).toBe(false);
  });

  it('drops a degraded refresh that would supersede a clean same-source value', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: DEGRADED_DESCRIPTION,
        existingValue: USEFUL_DESCRIPTION,
      }),
    ).toBe(true);
  });

  it('allows a clean-to-clean refresh (latest-wins preserved)', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: USEFUL_DESCRIPTION,
        existingValue: USEFUL_DESCRIPTION,
      }),
    ).toBe(false);
  });

  it('does not guard when the existing value is itself not useful', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: DEGRADED_DESCRIPTION,
        existingValue: DEGRADED_DESCRIPTION,
      }),
    ).toBe(false);
  });

  it('does not guard when there is no existing value', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: DEGRADED_DESCRIPTION,
        existingValue: undefined,
      }),
    ).toBe(false);
  });

  it('does not guard non-prose fields', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'name',
        incomingValue: '',
        existingValue: USEFUL_DESCRIPTION,
      }),
    ).toBe(false);
  });
});

describe('appendObservations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not persist a degraded description that would supersede a clean same-source one', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'fullDescription',
          value: DEGRADED_DESCRIPTION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
      { loadActiveProse: async () => USEFUL_DESCRIPTION },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('persists a degraded description when no clean same-source value exists', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:desc' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'fullDescription',
          value: DEGRADED_DESCRIPTION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
      { loadActiveProse: async () => undefined },
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(result.inserted).toBe(1);
  });

  it('inserts new observations and supersedes older same-source duplicates', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      {
        _id: 'new-1',
        observationFingerprint: 'fp:user:name',
      },
      {
        _id: 'new-2',
        observationFingerprint: 'fp:user:title',
      },
    ] as any);
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({
      modifiedCount: 2,
    } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'name',
          value: 'Ada Lovelace',
        },
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'title',
          value: 'Professor',
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-directory',
        sourceWeight: 0.9,
        dryRun: false,
      },
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite.mock.calls[0][0][0]).toMatchObject({
      updateMany: {
        filter: {
          observationFingerprint: 'fp:user:name',
          superseded: false,
          _id: { $ne: 'new-1' },
        },
        update: {
          $set: { superseded: true, supersededBy: 'new-1' },
        },
      },
    });
    expect(result).toEqual({ inserted: 2, skipped: 0, superseded: 2 });
  });

  it('supersedes duplicate fingerprints with one bulk write per append batch', async () => {
    vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      {
        _id: 'new-1',
        observationFingerprint: 'fp:user:name',
      },
      {
        _id: 'new-2',
        observationFingerprint: 'fp:user:title',
      },
    ] as any);
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({
      modifiedCount: 2,
    } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'name',
          value: 'Ada Lovelace',
        },
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'title',
          value: 'Professor',
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-directory',
        sourceWeight: 0.9,
        dryRun: false,
      },
    );

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(2);
    expect(result).toEqual({ inserted: 2, skipped: 0, superseded: 2 });
  });

  it('supersedes legacy fellowship values by source, entity, and field', async () => {
    vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      {
        _id: 'new-fellowship-title',
        observationFingerprint: 'latest-wins-fellowship-title',
      },
    ] as any);
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({
      modifiedCount: 2,
    } as any);

    await appendObservations(
      [
        {
          entityType: 'fellowship',
          entityKey: 'yale-college-fellowships-office:fixture',
          field: 'title',
          value: 'Current Fixture Fellowship',
        },
      ],
      {
        scrapeRunId: 'run-2',
        sourceId: 'source-1',
        sourceName: 'yale-college-fellowships-office',
        sourceWeight: 0.95,
        dryRun: false,
      },
    );

    expect(bulkWrite.mock.calls[0][0][0]).toMatchObject({
      updateMany: {
        filter: {
          sourceName: 'yale-college-fellowships-office',
          entityType: 'fellowship',
          entityKey: 'yale-college-fellowships-office:fixture',
          field: 'title',
          superseded: false,
          _id: { $ne: 'new-fellowship-title' },
        },
      },
    });
  });

  it('rejects observations sourced from our own site so it never becomes provenance', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:researchEntity:name' },
    ] as any);
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({
      modifiedCount: 0,
    } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'qin-yan-lab',
          field: 'name',
          value: 'Qin Yan Lab',
          sourceUrl: 'https://medicine.yale.edu/lab/qin-yan/',
        },
        {
          entityType: 'researchEntity',
          entityKey: 'qin-yan-lab',
          field: 'displayName',
          value: 'Qin Yan Lab',
          sourceUrl: 'https://yalelabs.io/api/research',
        },
      ],
      {
        scrapeRunId: 'run-3',
        sourceId: 'source-1',
        sourceName: 'ysm-a-to-z',
        sourceWeight: 0.9,
        dryRun: false,
      },
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    const insertedDocs = insertMany.mock.calls[0][0] as any[];
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0]).toMatchObject({
      field: 'name',
      sourceUrl: 'https://medicine.yale.edu/lab/qin-yan/',
    });
    expect(result).toEqual({ inserted: 1, skipped: 1, superseded: 0 });
  });

  it('skips the whole batch when every observation is sourced from our own site', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite');

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'qin-yan-lab',
          field: 'name',
          value: 'Qin Yan Lab',
          sourceUrl: 'https://www.yalelabs.io/research/qin-yan-lab',
        },
      ],
      {
        scrapeRunId: 'run-4',
        sourceId: 'source-1',
        sourceName: 'ysm-a-to-z',
        sourceWeight: 0.9,
        dryRun: false,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('coerces a bare-string sourceUrls value into a single-element array before insert (#observation-array-integrity)', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:researchEntity:sourceUrls' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'sourceUrls',
          value: 'https://smith-lab.yale.edu',
        },
      ],
      {
        scrapeRunId: 'run-5',
        sourceId: 'source-1',
        sourceName: 'manual-admin-edit',
        sourceWeight: 1,
        dryRun: false,
      },
    );

    const insertedDocs = insertMany.mock.calls[0][0] as any[];
    expect(insertedDocs[0].value).toEqual(['https://smith-lab.yale.edu']);
    expect(result.inserted).toBe(1);
  });

  it('rejects a kind observation value outside the researchGroupKinds enum before insert (#observation-array-integrity)', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite');

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'kind',
          value: 'faculty_research',
        },
      ],
      {
        scrapeRunId: 'run-6',
        sourceId: 'source-1',
        sourceName: 'manual-admin-edit',
        sourceWeight: 1,
        dryRun: false,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('rejects an entityType observation value outside the researchEntityTypes enum before insert (#observation-array-integrity)', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite');

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'entityType',
          value: 'FACULTY_RESEARCH',
        },
      ],
      {
        scrapeRunId: 'run-7',
        sourceId: 'source-1',
        sourceName: 'manual-admin-edit',
        sourceWeight: 1,
        dryRun: false,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('rejects a furniture-shaped person title at ingest and stores the sanitized name (#1375)', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:user:name' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'name',
          value: 'Ada Lovelace',
        },
        {
          entityType: 'user',
          entityKey: 'abc123',
          field: 'title',
          value: 'HomeAboutPeopleContact',
        },
      ],
      {
        scrapeRunId: 'run-1375a',
        sourceId: 'source-1',
        sourceName: 'yale-directory',
        sourceWeight: 0.9,
        dryRun: false,
      },
    );

    const insertedDocs = insertMany.mock.calls[0][0] as any[];
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0]).toMatchObject({ field: 'name', value: 'Ada Lovelace' });
    expect(result).toEqual({ inserted: 1, skipped: 1, superseded: 0 });
  });

  it('stores a chrome-stripped, contact-redacted description at ingest (#1375)', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:researchEntity:fullDescription' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'fullDescription',
          value: 'Skip to main content The lab studies X. Email jdoe@example.edu.',
        },
      ],
      {
        scrapeRunId: 'run-1375b',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.8,
        dryRun: false,
      },
    );

    const insertedDocs = insertMany.mock.calls[0][0] as any[];
    const storedDescription = String(insertedDocs[0].value);
    expect(storedDescription).not.toContain('Skip to main content');
    expect(storedDescription).not.toContain('@');
    expect(storedDescription).toContain('studies X');
  });

  it('does not supersede anything during dry runs', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const bulkWrite = vi.spyOn(Observation, 'bulkWrite');

    const result = await appendObservations(
      [
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'title',
          value: 'Paper',
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'openalex',
        sourceWeight: 0.85,
        dryRun: true,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });
});

describe('retireObservations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks matching non-superseded observations superseded with a rollback reason', async () => {
    const updateMany = vi
      .spyOn(Observation, 'updateMany')
      .mockResolvedValue({ modifiedCount: 3 } as any);

    const result = await retireObservations(
      { entityType: 'researchEntity', entityId: 'abc', field: { $in: ['methods'] } },
      'orphaned-after-rename',
    );

    expect(result).toEqual({ retired: 3 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0] as [any, any];
    expect(filter).toMatchObject({
      entityType: 'researchEntity',
      entityId: 'abc',
      superseded: { $ne: true },
    });
    expect(update.$set.superseded).toBe(true);
    expect(update.$set.rollback.reason).toBe('orphaned-after-rename');
    expect(update.$set.rollback.rolledBackAt).toBeInstanceOf(Date);
  });

  it('reports zero retired when the driver returns no modifiedCount', async () => {
    vi.spyOn(Observation, 'updateMany').mockResolvedValue({} as any);

    const result = await retireObservations({ entityKey: 'smith-lab' }, 'test');

    expect(result).toEqual({ retired: 0 });
  });
});
