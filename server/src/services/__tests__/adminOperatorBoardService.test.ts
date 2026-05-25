import { describe, expect, it } from 'vitest';
import {
  buildDuplicatePersonGatePosture,
  classifyOperatorQueueReason,
} from '../adminOperatorBoardService';

describe('adminOperatorBoardService', () => {
  it('separates blocking repair reasons from positive evidence signals', () => {
    expect(classifyOperatorQueueReason('missing_action_evidence')).toBe('blocking');
    expect(classifyOperatorQueueReason('profile_fallback_only')).toBe('blocking');
    expect(classifyOperatorQueueReason('thin_description')).toBe('blocking');
    expect(classifyOperatorQueueReason('not_undergraduate_relevant')).toBe('blocking');
    expect(classifyOperatorQueueReason('missing_application_route')).toBe('blocking');
    expect(classifyOperatorQueueReason('inactive_at_yale')).toBe('blocking');

    expect(classifyOperatorQueueReason('concrete_next_step')).toBe('evidence');
    expect(classifyOperatorQueueReason('source_backed_description')).toBe('evidence');
    expect(classifyOperatorQueueReason('official_source')).toBe('evidence');
    expect(classifyOperatorQueueReason('application_route')).toBe('evidence');
    expect(classifyOperatorQueueReason('undergraduate_relevant')).toBe('evidence');

    expect(classifyOperatorQueueReason('operator_override')).toBe('review');
  });

  it('summarizes duplicate-person hard gate posture from the latest integrity summary', () => {
    const posture = buildDuplicatePersonGatePosture({
      postMaterializationIntegrity: {
        status: 'failure',
        counts: {
          duplicatePeople: 2,
        },
        samples: {
          duplicatePeople: [
            {
              identityField: 'email',
              identityValue: 'person@example.test',
              userIds: ['fixture-user-a', 'fixture-user-b'],
            },
          ],
        },
        warnings: [
          {
            name: 'duplicatePersonIdentityConflicts',
            count: 1,
            message:
              'Some user identity values are shared by different names; review before merging.',
          },
          {
            name: 'otherWarning',
            count: 3,
            message: 'Unrelated warning.',
          },
        ],
      },
    });

    expect(posture).toEqual({
      status: 'failure',
      count: 2,
      warningCount: 1,
      samples: [
        {
          identityField: 'email',
          identityValue: 'person@example.test',
          userIds: ['fixture-user-a', 'fixture-user-b'],
        },
      ],
      nextRepairCommand: 'yarn --cwd server users:dedupe-by-identity --limit=1000 --apply',
    });
  });
});
