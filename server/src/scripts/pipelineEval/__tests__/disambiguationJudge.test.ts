import { describe, expect, it } from 'vitest';
import {
  decideVerdict,
  evidenceReferencesPresentField,
  judgeReviewBand,
  parseJudgeVerdict,
  renderJudgeRecord,
  type JudgeEntity,
  type JudgeLLMFn,
  type JudgeVerdict,
} from '../disambiguationJudge';

const ruizA: JudgeEntity = {
  id: 'a',
  name: 'Ruiz Laboratory',
  surname: 'Ruiz',
  firstName: 'Maria',
  entityType: 'LAB',
  departments: ['Neuroscience'],
  websiteUrl: 'https://ruizlab.example.edu/lab',
};
const ruizB: JudgeEntity = {
  id: 'b',
  name: 'Ruiz Lab',
  surname: 'Ruiz',
  firstName: 'Maria',
  entityType: 'LAB',
  departments: ['Neuroscience'],
  websiteUrl: 'https://ruizlab.example.edu/lab',
};

const smithJohn: JudgeEntity = {
  id: 'sj',
  name: 'Smith Lab',
  surname: 'Smith',
  firstName: 'John',
  departments: ['Physics'],
};
const smithJane: JudgeEntity = {
  id: 'sk',
  name: 'Smith Lab',
  surname: 'Smith',
  firstName: 'Jane',
  departments: ['Chemistry'],
};

const stub =
  (verdict: JudgeVerdict | null): JudgeLLMFn =>
  async () =>
    verdict;

describe('decideVerdict asymmetric authority', () => {
  it('discards a SAME verdict when first names conflict, regardless of confidence', () => {
    const result = decideVerdict(smithJohn, smithJane, {
      verdict: 'SAME',
      confidence: 0.95,
      evidence: 'both are Smith Lab',
    });
    expect(result.verdict).toBe('DIFFERENT');
    expect(result.accepted).toBe(false);
    expect(result.discardedReason).toBe('first_name_conflict');
  });

  it('accepts SAME at high confidence with a grounded evidence field', () => {
    const result = decideVerdict(ruizA, ruizB, {
      verdict: 'SAME',
      confidence: 0.9,
      evidence: 'both records list the Neuroscience department',
    });
    expect(result.verdict).toBe('SAME');
    expect(result.accepted).toBe(true);
  });

  it('does not accept SAME below the confidence threshold', () => {
    const result = decideVerdict(ruizA, ruizB, {
      verdict: 'SAME',
      confidence: 0.6,
      evidence: 'both records list the Neuroscience department',
    });
    expect(result.accepted).toBe(false);
    expect(result.discardedReason).toBe('low_confidence');
  });

  it('accepts SAME whose evidence cites the matching first name', () => {
    const result = decideVerdict(ruizA, ruizB, {
      verdict: 'SAME',
      confidence: 0.95,
      evidence: 'both labs are led by Maria',
    });
    expect(result.verdict).toBe('SAME');
    expect(result.accepted).toBe(true);
  });

  it('does not accept SAME whose evidence cites an absent field', () => {
    const result = decideVerdict(ruizA, ruizB, {
      verdict: 'SAME',
      confidence: 0.95,
      evidence: 'they share an identical external identifier',
    });
    expect(result.accepted).toBe(false);
    expect(result.discardedReason).toBe('evidence_not_grounded');
  });

  it('always honors DIFFERENT and proposes no merge', () => {
    const result = decideVerdict(ruizA, ruizB, {
      verdict: 'DIFFERENT',
      confidence: 0.99,
      evidence: 'different departments',
    });
    expect(result.verdict).toBe('DIFFERENT');
    expect(result.accepted).toBe(false);
  });

  it('fails closed to DIFFERENT on a null/malformed verdict', () => {
    const result = decideVerdict(ruizA, ruizB, null);
    expect(result.verdict).toBe('DIFFERENT');
    expect(result.accepted).toBe(false);
    expect(result.discardedReason).toBe('malformed');
  });
});

describe('evidenceReferencesPresentField', () => {
  it('is true when the evidence quotes a present field token', () => {
    expect(evidenceReferencesPresentField('matching Neuroscience department', ruizA, ruizB)).toBe(
      true,
    );
  });
  it('is true when the evidence quotes a first-name token', () => {
    expect(evidenceReferencesPresentField('both led by Maria', ruizA, ruizB)).toBe(true);
  });
  it('is false when the evidence references nothing in the records', () => {
    expect(evidenceReferencesPresentField('same phone number', ruizA, ruizB)).toBe(false);
  });
});

describe('judgeReviewBand', () => {
  it('accepts a grounded high-confidence SAME and never throws on a failing LLM', async () => {
    const accepted = await judgeReviewBand([{ a: ruizA, b: ruizB }], {
      callLLM: stub({ verdict: 'SAME', confidence: 0.92, evidence: 'both in Neuroscience' }),
    });
    expect(accepted[0].accepted).toBe(true);

    const thrown = await judgeReviewBand([{ a: ruizA, b: ruizB }], {
      callLLM: async () => {
        throw new Error('network down');
      },
    });
    expect(thrown[0].verdict).toBe('DIFFERENT');
    expect(thrown[0].accepted).toBe(false);
  });
});

describe('renderJudgeRecord', () => {
  it('redacts contact info and omits unrendered fields', () => {
    const rendered = renderJudgeRecord({
      id: 'x',
      name: 'Ruiz Lab',
      departments: ['Neuroscience'],
      description: 'Contact maria@example.edu for details.',
    });
    expect(rendered).not.toContain('maria@example.edu');
    expect(rendered).toContain('name: Ruiz Lab');
    expect(rendered).toContain('departments: Neuroscience');
  });
  it('renders the first name so it is available to the model', () => {
    expect(renderJudgeRecord(ruizA)).toContain('firstName: Maria');
  });
});

describe('parseJudgeVerdict', () => {
  it('parses a valid verdict', () => {
    expect(parseJudgeVerdict('{"verdict":"SAME","confidence":0.9,"evidence":"x"}')).toEqual({
      verdict: 'SAME',
      confidence: 0.9,
      evidence: 'x',
    });
  });
  it('returns null on empty, non-JSON, empty object, and unknown verdict', () => {
    expect(parseJudgeVerdict('')).toBeNull();
    expect(parseJudgeVerdict('not json')).toBeNull();
    expect(parseJudgeVerdict('{}')).toBeNull();
    expect(parseJudgeVerdict('{"verdict":"MAYBE"}')).toBeNull();
  });
});
