import { describe, expect, it } from 'vitest';
import { planFellowshipClassification } from '../fellowshipClassificationDerivation';

describe('planFellowshipClassification program role (#3904)', () => {
  const stored = {
    title: 'Fixture Research Grant',
    description: 'Supports independent summer research projects.',
    programKind: 'STRUCTURED_PROGRAM',
    programRole: 'FUNDS_RESEARCH',
  };

  it('derives the role from the locked kind the row keeps', () => {
    const plan = planFellowshipClassification({ stored, lockedFields: ['programKind'] });
    expect(plan.set.programKind).toBeUndefined();
    expect(plan.set.programRole).toBe('STARTS_RESEARCH');
  });

  it('derives the role from the classifier kind when the kind is not locked', () => {
    const plan = planFellowshipClassification({ stored });
    expect(plan.set.programKind).toBe('FELLOWSHIP_FUNDING');
    expect(plan.classification.programRole).toBe('FUNDS_RESEARCH');
  });
});
