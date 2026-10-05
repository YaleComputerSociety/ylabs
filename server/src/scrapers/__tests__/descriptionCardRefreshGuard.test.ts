import mongoose from 'mongoose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LEAD_ROLE_LEGACY_LABELS } from '../../models/canonicalRoleMapping';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { getResearchEntityRosterByEntityId } from '../../services/researchEntityMembershipAccessor';
import {
  createDescriptionCardJudge,
  isCardLosingDescriptionRefresh,
  type DescriptionCardJudge,
} from '../descriptionCardRefreshGuard';
import { appendObservations } from '../observationStore';

vi.mock('../../services/researchEntityMembershipAccessor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/researchEntityMembershipAccessor')>()),
  getResearchEntityRosterByEntityId: vi.fn(),
}));

const GOOD =
  'The Example Lab studies how cells sense and respond to mechanical force in tissue repair.';
const WORSE =
  'Research Interests Mechanotransduction; Tissue Repair; Cell Biology; Wound Healing; Fibrosis.';
const subject = { entityType: 'researchEntity' as const, entityKey: 'example-lab' };
const judgeByText =
  (withCard: ReadonlySet<unknown>): DescriptionCardJudge =>
  async (_subject, pair) =>
    withCard.has(pair.fullDescription) &&
    (pair.shortDescription === undefined || withCard.has(pair.shortDescription));

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

  it('takes only the incoming card when it still gives a card under the current body', async () => {
    const insertMany = vi.spyOn(Observation, 'insertMany').mockResolvedValue([] as any);
    vi.spyOn(Observation, 'bulkWrite').mockResolvedValue({ modifiedCount: 0 } as any);
    const card = 'Studies how cells sense mechanical force during tissue repair.';
    const cardless =
      'The Example Lab studies how tissues rebuild their structure after injury in adults.';
    await appendObservations(
      [
        { ...subject, field: 'fullDescription', value: cardless },
        { ...subject, field: 'shortDescription', value: card },
      ],
      ctx,
      {
        loadActiveProse: async (query) => (query.field === 'fullDescription' ? GOOD : undefined),
        judgeDescriptionCard: judgeByText(new Set([GOOD, card])),
      },
    );
    const inserted = (insertMany.mock.calls[0]?.[0] ?? []) as Array<{ field: string }>;
    expect(inserted.map((doc) => doc.field)).toEqual(['shortDescription']);
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

describe('createDescriptionCardJudge', () => {
  beforeAll(async () => {
    await import('../../services/studentVisibilityGateService');
    await import('../../services/researchEntityPublicDescription');
  });
  afterEach(() => vi.restoreAllMocks());

  const rowId = new mongoose.Types.ObjectId();
  const WRONG_SUBJECT =
    "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling across complex biological systems.";
  const RIGHT_SUBJECT =
    "Correct Person's research examines molecular dynamics and cellular signaling across complex biological systems.";

  it("judges the pair against the row's own leads, as the gate does", async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      select: () => ({
        lean: async () => ({
          _id: rowId,
          slug: 'correct-person-research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrls: ['https://example.yale.edu/profile/correct-person'],
        }),
      }),
    } as any);
    vi.mocked(getResearchEntityRosterByEntityId).mockResolvedValue(
      new Map([
        [
          String(rowId),
          [
            {
              researchEntityId: rowId,
              personId: new mongoose.Types.ObjectId(),
              role: [...LEAD_ROLE_LEGACY_LABELS][0],
              state: 'CURRENT',
              name: 'Correct Person',
            } as any,
          ],
        ],
      ]),
    );
    const judge = createDescriptionCardJudge();
    const judgedSubject = { entityType: 'researchEntity' as const, entityId: String(rowId) };

    expect(await judge(judgedSubject, { fullDescription: RIGHT_SUBJECT }, {})).toBe(true);
    expect(await judge(judgedSubject, { fullDescription: WRONG_SUBJECT }, {})).toBe(false);
  });

  it('cannot judge without a connected database', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);
    const findOne = vi.spyOn(ResearchEntity, 'findOne');
    expect(
      await createDescriptionCardJudge()(subject, { fullDescription: GOOD }, {}),
    ).toBeUndefined();
    expect(findOne).not.toHaveBeenCalled();
  });
});
