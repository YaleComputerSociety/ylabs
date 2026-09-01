import { describe, it, expect, vi, afterEach } from 'vitest';
import { Observation } from '../../models/observation';
import {
  appendObservations,
  buildObservationFingerprint,
  collapseLatestWins,
  isRegressiveProseRefresh,
  isWeakerProseRefresh,
  observationEntityIdentityFilter,
  prosePreferenceScore,
  retireObservations,
  selfDefeatingCardRestatesFullDescription,
} from '../observationStore';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';

const USEFUL_DESCRIPTION =
  'The reachable lab studies cellular signaling, immune response, translational biomarkers, and computational modeling for patient care.';
const DEGRADED_DESCRIPTION = 'Our lab studies things.';
const USEFUL_SHORT_DESCRIPTION =
  'Studies cellular signaling and translational biomarkers to improve immune-related patient care.';
const DEGRADED_SHORT_DESCRIPTION = 'Our lab studies things.';

const MISSION =
  'Our Mission Create and communicate high-quality and creative science on the cellular and molecular mechanisms that control tissue biology: development, homeostasis, regeneration, and disease. Our research uses multiple epithelial tissues to explore these scientific interests. To foster personal and scientific growth and excellence.';
const RESEARCH =
  'We are studying the dynamic interactions between non-epithelial cells in tissues that interface with the environment. Using multi pronged approaches including mouse genetics, cell culture models, genomics and microscopy, we tackle complex biological processes focusing on the contribution of cell-intrinsic and cell-extrinsic factors that contribute to regenerative processes.';
const OTHER_RESEARCH =
  'The lab investigates chromatin regulation of genome stability in multicellular eukaryotes, using histone variants and post-translational modifications to map repair pathways across tissues.';
const PERSON_VOICED_RESEARCH =
  "Dr. Sauler's research investigates mechanisms of lung injury and repair, using single-cell genomics of human lung tissue to define the cellular drivers of emphysema.";

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

  it('uses shortDescription fixtures whose usefulness matches the shared quality gate', () => {
    expect(shortDescriptionQuality(USEFUL_SHORT_DESCRIPTION, USEFUL_DESCRIPTION).isUseful).toBe(
      true,
    );
    expect(shortDescriptionQuality(DEGRADED_SHORT_DESCRIPTION, USEFUL_DESCRIPTION).isUseful).toBe(
      false,
    );
  });

  it('drops a degraded short refresh once the existing short is judged with its paired full', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'shortDescription',
        incomingValue: DEGRADED_SHORT_DESCRIPTION,
        existingValue: USEFUL_SHORT_DESCRIPTION,
        incomingContext: { fullContext: USEFUL_DESCRIPTION },
        existingContext: { fullContext: USEFUL_DESCRIPTION },
      }),
    ).toBe(true);
  });

  it('allows a clean-to-clean short refresh', () => {
    expect(
      isRegressiveProseRefresh({
        field: 'shortDescription',
        incomingValue: USEFUL_SHORT_DESCRIPTION,
        existingValue: USEFUL_SHORT_DESCRIPTION,
        incomingContext: { fullContext: USEFUL_DESCRIPTION },
        existingContext: { fullContext: USEFUL_DESCRIPTION },
      }),
    ).toBe(false);
  });

  it('flags a research-area-echo full only when researchAreas context is supplied', () => {
    const areaEcho =
      'The Chen Lab studies machine learning, robotics, and computer vision to advance autonomous systems research.';
    const researchAreas = ['machine learning', 'robotics', 'computer vision'];
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: areaEcho,
        existingValue: USEFUL_DESCRIPTION,
      }),
    ).toBe(false);
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: areaEcho,
        existingValue: USEFUL_DESCRIPTION,
        incomingContext: { researchAreas, entityType: 'researchEntity' },
      }),
    ).toBe(true);
  });
});

describe('selfDefeatingCardRestatesFullDescription', () => {
  it('flags a card that byte-matches the full it arrives with', () => {
    expect(
      selfDefeatingCardRestatesFullDescription('shortDescription', USEFUL_DESCRIPTION, {
        fullContext: USEFUL_DESCRIPTION,
      }),
    ).toBe(true);
  });

  it('leaves a genuinely distinct card alone', () => {
    expect(
      selfDefeatingCardRestatesFullDescription('shortDescription', USEFUL_SHORT_DESCRIPTION, {
        fullContext: USEFUL_DESCRIPTION,
      }),
    ).toBe(false);
  });

  it('does not fire without a full to compare against, or on the full field itself', () => {
    expect(
      selfDefeatingCardRestatesFullDescription('shortDescription', USEFUL_DESCRIPTION, {}),
    ).toBe(false);
    expect(
      selfDefeatingCardRestatesFullDescription('fullDescription', USEFUL_DESCRIPTION, {
        fullContext: USEFUL_DESCRIPTION,
      }),
    ).toBe(false);
  });
});

describe('appendObservations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps only the full when a batch emits one value as both description fields', async () => {
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([{ _id: 'new-1', observationFingerprint: 'fp:full' }] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'fullDescription',
          value: USEFUL_DESCRIPTION,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'shortDescription',
          value: USEFUL_DESCRIPTION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-undergrad-llm',
        sourceWeight: 0.55,
        dryRun: false,
      },
      { loadActiveProse: async () => undefined },
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    const inserted = insertMany.mock.calls[0][0] as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field)).toEqual(['fullDescription']);
    expect(result).toEqual({ inserted: 1, skipped: 1, superseded: 0 });
  });

  it('drops a card that restates a full already active for the same source', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'shortDescription',
          value: USEFUL_DESCRIPTION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'ysm-atoz-index',
        sourceWeight: 0.92,
        dryRun: false,
      },
      {
        loadActiveProse: async (query) =>
          query.field === 'fullDescription' ? USEFUL_DESCRIPTION : undefined,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('still persists a distinct card emitted alongside its full', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:full' },
      { _id: 'new-2', observationFingerprint: 'fp:short' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'fullDescription',
          value: USEFUL_DESCRIPTION,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'shortDescription',
          value: USEFUL_SHORT_DESCRIPTION,
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
    const inserted = insertMany.mock.calls[0][0] as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field).sort()).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
    expect(result.inserted).toBe(2);
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

  it('does not persist a degraded short that would supersede a clean same-source one', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');
    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'smith-lab',
          field: 'shortDescription',
          value: DEGRADED_SHORT_DESCRIPTION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
      {
        loadActiveProse: async (query) =>
          query.field === 'fullDescription' ? USEFUL_DESCRIPTION : USEFUL_SHORT_DESCRIPTION,
      },
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('persists a degraded description when no clean same-source value exists', async () => {
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([{ _id: 'new-1', observationFingerprint: 'fp:desc' }] as any);
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
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([
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
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([
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
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([{ _id: 'new-1', observationFingerprint: 'fp:user:name' }] as any);
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
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([
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
          entityType: 'fellowship',
          entityKey: 'F1',
          field: 'title',
          value: 'Fellowship',
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

describe('observation entity identity (#2177)', () => {
  // `vi.spyOn` reuses an existing spy on the same method, so leaving this block's
  // `insertMany` mock installed leaks its recorded calls into later suites.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = {
    sourceName: 'lab-microsite-description-llm',
    entityType: 'researchEntity',
    field: 'fullDescription',
    value: USEFUL_DESCRIPTION,
  };

  it('gives a key-only run and a run that also resolved the id the same fingerprint', () => {
    const legacyRun = buildObservationFingerprint({ ...base, entityKey: 'dept-mcdb-horsley' });
    const resolvedRun = buildObservationFingerprint({
      ...base,
      entityKey: 'dept-mcdb-horsley',
      entityId: '6a0fa8959fc810ec168cdcfd',
    });

    expect(legacyRun).toBe(resolvedRun);
  });

  it('still fingerprints a row that only carries an entityId', () => {
    expect(
      buildObservationFingerprint({ ...base, entityId: '6a0fa8959fc810ec168cdcfd' }),
    ).toBeDefined();
  });

  it('keeps distinct entities distinct', () => {
    expect(buildObservationFingerprint({ ...base, entityKey: 'a-lab' })).not.toBe(
      buildObservationFingerprint({ ...base, entityKey: 'b-lab' }),
    );
  });

  it('matches either identity form so the prior row is found', () => {
    expect(observationEntityIdentityFilter({ entityKey: 'smith-lab', entityId: 'abc' })).toEqual({
      $or: [{ entityKey: 'smith-lab' }, { entityId: 'abc' }],
    });
    expect(observationEntityIdentityFilter({ entityKey: 'smith-lab' })).toEqual({
      entityKey: 'smith-lab',
    });
    expect(observationEntityIdentityFilter({ entityId: 'abc' })).toEqual({ entityId: 'abc' });
    expect(observationEntityIdentityFilter({})).toBeUndefined();
  });

  it('supersedes a legacy key-only row when the new run also carries an entityId', async () => {
    vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-row', observationFingerprint: 'fp' },
    ] as any);
    const bulkWrite = vi
      .spyOn(Observation, 'bulkWrite')
      .mockResolvedValue({ modifiedCount: 1 } as any);

    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-mcdb-horsley',
          entityId: '6a0fa8959fc810ec168cdcfd',
          field: 'fullDescription',
          value: USEFUL_DESCRIPTION,
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

    const filter = (bulkWrite.mock.calls[0][0] as any[])[0].updateMany.filter;
    expect(filter.$or).toEqual([
      { entityKey: 'dept-mcdb-horsley' },
      { entityId: '6a0fa8959fc810ec168cdcfd' },
    ]);
  });
});

describe('isWeakerProseRefresh (#2232)', () => {
  // The observation log only ever carries an ObservedEntityType, never the
  // product entityType, so this is the context the real write path supplies.
  const ctx = { entityType: 'researchEntity' };
  const refresh = (incomingValue: string, existingValue: string) =>
    isWeakerProseRefresh({
      field: 'fullDescription',
      incomingValue,
      existingValue,
      incomingContext: ctx,
      existingContext: ctx,
    });

  it('blocks a mission statement from displacing grounded research prose', () => {
    // Both pass the subtractive quality bar, which is why the pre-existing guard
    // cannot see this at all - it is the Horsley regression that served from May
    // to August.
    expect(fullDescriptionQuality(MISSION, [], 'researchEntity').isUseful).toBe(true);
    expect(fullDescriptionQuality(RESEARCH, [], 'researchEntity').isUseful).toBe(true);
    expect(
      isRegressiveProseRefresh({
        field: 'fullDescription',
        incomingValue: MISSION,
        existingValue: RESEARCH,
        incomingContext: ctx,
        existingContext: ctx,
      }),
    ).toBe(false);

    expect(refresh(MISSION, RESEARCH)).toBe(true);
  });

  it('still allows research prose to displace a mission incumbent, so recovery is possible', () => {
    expect(refresh(RESEARCH, MISSION)).toBe(false);
  });

  it('allows an equally clean refresh, so the corpus cannot freeze on its first capture', () => {
    expect(refresh(OTHER_RESEARCH, RESEARCH)).toBe(false);
    expect(refresh(RESEARCH, RESEARCH)).toBe(false);
  });

  it('does not fire when there is no incumbent to protect', () => {
    expect(refresh(MISSION, '')).toBe(false);
    expect(
      isWeakerProseRefresh({
        field: 'fullDescription',
        incomingValue: MISSION,
        existingValue: undefined,
        incomingContext: ctx,
        existingContext: ctx,
      }),
    ).toBe(false);
  });

  it('ignores fields outside the guarded prose set', () => {
    expect(
      isWeakerProseRefresh({
        field: 'name',
        incomingValue: MISSION,
        existingValue: RESEARCH,
        incomingContext: ctx,
        existingContext: ctx,
      }),
    ).toBe(false);
  });

  it('scores mission and recruitment prose below research prose', () => {
    expect(prosePreferenceScore(RESEARCH)).toBeGreaterThan(prosePreferenceScore(MISSION));
    const recruiting =
      'Hiring! Our group has open positions for a postdoc and a graduate student. We study quantum many-body systems out of equilibrium using ultracold atomic gases as a platform for these experiments.';
    expect(prosePreferenceScore(RESEARCH)).toBeGreaterThan(prosePreferenceScore(recruiting));
  });

  it('lets person-voiced faculty research prose displace a mission incumbent', () => {
    // A faculty research home reads in the researcher's voice by design, and the
    // observation log cannot tell one from a lab. Scoring the person-centric term
    // here would charge this -100 against the mission statement's -20 and freeze
    // the mission in place - the inverse of the guard's purpose.
    expect(fullDescriptionQuality(PERSON_VOICED_RESEARCH, [], 'researchEntity').flags).toEqual([]);
    expect(prosePreferenceScore(PERSON_VOICED_RESEARCH)).toBeGreaterThan(
      prosePreferenceScore(MISSION),
    );
    expect(refresh(PERSON_VOICED_RESEARCH, MISSION)).toBe(false);
  });

  it('still blocks a mission statement from displacing person-voiced research prose', () => {
    expect(refresh(MISSION, PERSON_VOICED_RESEARCH)).toBe(true);
  });
});

describe('appendObservations weaker-prose write path (#2232)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const append = (value: string, incumbent: string | undefined, field = 'fullDescription') =>
    appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field,
          value,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
      { loadActiveProse: async (query) => (query.field === field ? incumbent : undefined) },
    );

  it('drops a useful mission statement that would displace a clean research incumbent', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany');

    const result = await append(MISSION, RESEARCH);

    expect(insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
  });

  it('persists research prose over a mission incumbent, so the home can recover', async () => {
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([{ _id: 'new-1', observationFingerprint: 'fp:full' }] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await append(RESEARCH, MISSION);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(result.inserted).toBe(1);
  });

  it('persists person-voiced faculty research prose over a mission incumbent', async () => {
    const insertMany = vi
      .spyOn(Observation, 'insertMany')
      .mockResolvedValue([{ _id: 'new-1', observationFingerprint: 'fp:full' }] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);

    const result = await append(PERSON_VOICED_RESEARCH, MISSION);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(result.inserted).toBe(1);
  });

  it('does not protect an incumbent that fails the quality bar under the batch context', async () => {
    // The incumbent is judged with the same researchAreas as the incoming value,
    // so a research-area echo cannot block a refresh by being evaluated against
    // an emptier context than the value it is blocking.
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:areas' },
      { _id: 'new-2', observationFingerprint: 'fp:full' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);
    const researchAreas = [
      'cancer biology',
      'immunology',
      'genomics',
      'proteomics',
      'metabolomics',
    ];
    const areaEchoIncumbent =
      'The lab studies cancer biology, immunology, genomics, proteomics, and metabolomics in human tissue samples.';
    expect(fullDescriptionQuality(areaEchoIncumbent, undefined, 'researchEntity').isUseful).toBe(
      true,
    );
    expect(
      fullDescriptionQuality(areaEchoIncumbent, researchAreas, 'researchEntity').isUseful,
    ).toBe(false);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field: 'researchAreas',
          value: researchAreas,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field: 'fullDescription',
          value: MISSION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
      {
        loadActiveProse: async (query) =>
          query.field === 'fullDescription' ? areaEchoIncumbent : undefined,
      },
    );

    const inserted = insertMany.mock.calls[0][0] as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field)).toContain('fullDescription');
    expect(result.inserted).toBe(2);
  });

  it('resolves each incumbent lookup once per entity and field across a batch', async () => {
    vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:full' },
      { _id: 'new-2', observationFingerprint: 'fp:short' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);
    const loadActiveProse = vi.fn(async () => undefined);

    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field: 'fullDescription',
          value: RESEARCH,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field: 'shortDescription',
          value: USEFUL_SHORT_DESCRIPTION,
        },
      ],
      {
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
      { loadActiveProse },
    );

    expect(loadActiveProse.mock.calls.map(([query]: any) => query.field).sort()).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
  });

  it('keeps a card that passes the card quality bar against the full it arrives with', async () => {
    // `isFullDescriptionRestatementOfShortDescription` is broader than the
    // `same-as-full`/`copied-first-sentence` flags: it also fires on a token
    // overlap this pair trips. Widening the self-defeating-card drop to values the
    // card quality bar accepts would silently change card prose well outside
    // #2232, so that drop stays scoped to cards that already failed the bar.
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([
      { _id: 'new-1', observationFingerprint: 'fp:full' },
      { _id: 'new-2', observationFingerprint: 'fp:short' },
    ] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);
    const fullParaphrase =
      'Studies cellular signaling and translational biomarkers to improve immune-related patient care across a range of inflammatory diseases.';
    expect(
      shortDescriptionQuality(USEFUL_SHORT_DESCRIPTION, fullParaphrase, undefined, {
        entityType: 'researchEntity',
      }).isUseful,
    ).toBe(true);
    expect(
      selfDefeatingCardRestatesFullDescription('shortDescription', USEFUL_SHORT_DESCRIPTION, {
        fullContext: fullParaphrase,
      }),
    ).toBe(true);

    const result = await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field: 'fullDescription',
          value: fullParaphrase,
        },
        {
          entityType: 'researchEntity',
          entityKey: 'horsley-lab',
          field: 'shortDescription',
          value: USEFUL_SHORT_DESCRIPTION,
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

    const inserted = insertMany.mock.calls[0][0] as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field).sort()).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
    expect(result.inserted).toBe(2);
  });
});

describe('collapseLatestWins weaker-prose collapse (#2232)', () => {
  const row = (value: string, observedAt: string) => ({
    field: 'fullDescription',
    sourceName: 'lab-microsite-description-llm',
    observedAt: new Date(observedAt),
    value,
  });

  it('keeps the research incumbent whichever order the unsorted log delivers rows in', () => {
    // The materializer reads with `Observation.find(filter).lean()` and no sort,
    // and the covering index is descending on observedAt, so both orders are
    // reachable from the same data.
    const research = row(RESEARCH, '2026-05-01T00:00:00.000Z');
    const mission = row(MISSION, '2026-08-01T00:00:00.000Z');

    expect(collapseLatestWins([research, mission], 'researchEntity').map((o) => o.value)).toEqual([
      RESEARCH,
    ]);
    expect(collapseLatestWins([mission, research], 'researchEntity').map((o) => o.value)).toEqual([
      RESEARCH,
    ]);
  });

  it('still lets a newer research capture win in either order', () => {
    const mission = row(MISSION, '2026-05-01T00:00:00.000Z');
    const research = row(RESEARCH, '2026-08-01T00:00:00.000Z');

    expect(collapseLatestWins([mission, research], 'researchEntity').map((o) => o.value)).toEqual([
      RESEARCH,
    ]);
    expect(collapseLatestWins([research, mission], 'researchEntity').map((o) => o.value)).toEqual([
      RESEARCH,
    ]);
  });

  it('keeps plain newest-wins for a non-prose latest-wins field in either order', () => {
    const older = {
      field: 'researchAreas',
      sourceName: 'lab-microsite-description-llm',
      observedAt: new Date('2026-05-01T00:00:00.000Z'),
      value: ['older'],
    };
    const newer = {
      field: 'researchAreas',
      sourceName: 'lab-microsite-description-llm',
      observedAt: new Date('2026-08-01T00:00:00.000Z'),
      value: ['newer'],
    };

    expect(collapseLatestWins([older, newer], 'researchEntity').map((o) => o.value)).toEqual([
      ['newer'],
    ]);
    expect(collapseLatestWins([newer, older], 'researchEntity').map((o) => o.value)).toEqual([
      ['newer'],
    ]);
  });
});
