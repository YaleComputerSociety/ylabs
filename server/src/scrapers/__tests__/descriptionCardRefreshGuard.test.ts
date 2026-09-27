import { afterEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import {
  isCardLosingDescriptionRefresh,
  type DescriptionCardJudge,
} from '../descriptionCardRefreshGuard';
import { appendObservations } from '../observationStore';

const GOOD =
  'The Example Lab studies how cells sense and respond to mechanical force in tissue repair.';
const WORSE =
  'Research Interests Mechanotransduction; Tissue Repair; Cell Biology; Wound Healing; Fibrosis.';
const subject = { entityType: 'researchEntity' as const, entityKey: 'example-lab' };
const judgeByText =
  (withCard: ReadonlySet<unknown>): DescriptionCardJudge =>
  async (_subject, pair) =>
    withCard.has(pair.fullDescription);

describe('isCardLosingDescriptionRefresh', () => {
  it('refuses a refresh that would lose the card', async () => {
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: GOOD },
        incoming: { fullDescription: WORSE },
        judge: judgeByText(new Set([GOOD])),
      }),
    ).toBe(true);
  });

  it('allows a refresh that gains or keeps a card', async () => {
    const judge = judgeByText(new Set([GOOD, WORSE]));
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: WORSE },
        incoming: { fullDescription: GOOD },
        judge,
      }),
    ).toBe(false);
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: GOOD },
        incoming: { fullDescription: WORSE },
        judge,
      }),
    ).toBe(false);
  });

  it('never objects when there is no current description or the judge cannot tell', async () => {
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: {},
        incoming: { fullDescription: WORSE },
        judge: judgeByText(new Set()),
      }),
    ).toBe(false);
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: GOOD },
        incoming: { fullDescription: WORSE },
        judge: async () => undefined,
      }),
    ).toBe(false);
  });
});

describe('appendObservations card refresh guard', () => {
  afterEach(() => vi.restoreAllMocks());

  const ctx = {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'lab-microsite-description-llm',
    sourceWeight: 0.9,
    dryRun: false,
  };

  it('keeps the current description pair when the refresh would lose its card', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);
    const result = await appendObservations(
      [
        { ...subject, field: 'fullDescription', value: WORSE },
        { ...subject, field: 'shortDescription', value: WORSE },
        { ...subject, field: 'methods', value: ['imaging'] },
      ],
      ctx,
      {
        loadActiveProse: async (query) => (query.field === 'fullDescription' ? GOOD : undefined),
        judgeDescriptionCard: judgeByText(new Set([GOOD])),
      },
    );
    const inserted = (insertMany.mock.calls[0]?.[0] ?? []) as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field)).toEqual(['methods']);
    expect(result.skipped).toBe(2);
  });

  it('lets a refresh through when the incoming pair also gives a card', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);
    const other =
      'The Example Lab studies how tissues rebuild their structure after injury in adults.';
    await appendObservations([{ ...subject, field: 'fullDescription', value: other }], ctx, {
      loadActiveProse: async (query) => (query.field === 'fullDescription' ? GOOD : undefined),
      judgeDescriptionCard: judgeByText(new Set([GOOD, other])),
    });
    const inserted = (insertMany.mock.calls[0]?.[0] ?? []) as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field)).toEqual(['fullDescription']);
  });
});
