import { describe, expect, it, vi } from 'vitest';
import {
  attemptVisibilityRepair,
  buildVisibilityRepairPlan,
  type RepairDeps,
} from '../visibilityRepairQueueService';

const PROFILE = 'https://medicine.yale.edu/profile/ada-quill/';

const baseDeps = () => ({
  findOpenQueueItems: vi.fn(),
  updateQueueItem: vi.fn(),
  findResearchEntity: vi.fn().mockResolvedValue({
    _id: '507f1f77bcf86cd799439011',
    sourceUrls: [PROFILE],
  }),
  findUserByProfileUrl: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439012' }),
  upsertResearchEntityMember: vi.fn(),
  updateResearchEntity: vi.fn(),
  findProgram: vi.fn(),
  updateProgram: vi.fn(),
  runGate: vi.fn(),
  findLeadCandidateEntry: vi.fn().mockResolvedValue({
    holdsLiveLeadEdge: false,
    entry: {
      role: 'pi',
      state: 'UNKNOWN',
      personId: 'p',
      name: 'Faculty Lead',
      title: 'Professor',
    },
  }),
});

const plan = buildVisibilityRepairPlan({
  _id: 'queue-1',
  collection: 'research',
  recordId: '507f1f77bcf86cd799439011',
  label: 'Queued Row',
  blockerReasons: ['missing_lead'],
  sourceNames: ['ysm-faculty-directory'],
});

describe('the repair dependencies a PI identity repair cannot run without (#5979)', () => {
  it('requires the refusal-edge lookup, so no caller can skip it', () => {
    // @ts-expect-error findProtectedLeadEdge is required
    const missing: RepairDeps = baseDeps();
    expect(missing).toBeDefined();
  });

  it('blocks on the refusal edge the lookup reports, writing nothing', async () => {
    const deps = {
      ...baseDeps(),
      findProtectedLeadEdge: vi.fn().mockResolvedValue('operator-ended'),
    };
    const attempt = await attemptVisibilityRepair(plan, 'apply', deps);

    expect(attempt).toMatchObject({ applied: false, status: 'blocked' });
    expect(attempt.remainingBlockers).toEqual(
      expect.arrayContaining(['missing_lead', 'lead_edge_operator_ended']),
    );
    expect(deps.upsertResearchEntityMember).not.toHaveBeenCalled();
    expect(deps.findLeadCandidateEntry).not.toHaveBeenCalled();
  });
});
