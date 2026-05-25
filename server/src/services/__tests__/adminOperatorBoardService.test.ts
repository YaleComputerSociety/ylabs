import { describe, expect, it } from 'vitest';
import { classifyOperatorQueueReason } from '../adminOperatorBoardService';

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
});
