import { describe, expect, it } from 'vitest';
import {
  assertExecutionGuards,
  pathwayReviewHandle,
  resolveReviewCandidates,
  validateReviewDecisions,
} from '../pfr3PathwayEvidenceReviewCore';

const salt = 'a-sufficiently-long-private-salt';
const candidate = { id: '507f1f77bcf86cd799439011', status: 'PLAUSIBLE' };
const handle = pathwayReviewHandle(candidate.id, salt);
const valid = {
  handle,
  kind: 'source_repair',
  sourceUrl: 'https://www.yale.edu/research',
  evidence: 'Official page states the current route.',
  rationale: 'Repairs missing authoritative lineage.',
};

describe('PFR-3 pathway evidence review', () => {
  it('rejects handle mismatch', () =>
    expect(() => resolveReviewCandidates([candidate], ['pathway-wrong'], salt, 1)).toThrow(
      /do not match/,
    ));
  it('bounds max batch at 25', () =>
    expect(() => resolveReviewCandidates([candidate], [handle], salt, 26)).toThrow(/1 through 25/));
  it('rejects unsafe URLs', () =>
    expect(() =>
      validateReviewDecisions(
        [{ ...valid, sourceUrl: 'http://127.0.0.1/private' }],
        new Set([handle]),
      ),
    ).toThrow(/safe public/));
  it('requires evidence and rationale', () => {
    expect(() => validateReviewDecisions([{ ...valid, evidence: '' }], new Set([handle]))).toThrow(
      /evidence is required/,
    );
    expect(() => validateReviewDecisions([{ ...valid, rationale: '' }], new Set([handle]))).toThrow(
      /rationale is required/,
    );
  });
  it('defaults safely when execute is false', () =>
    expect(() => assertExecutionGuards({ target: 'beta', execute: false })).not.toThrow());
  it('rejects target mismatch', () =>
    expect(() =>
      assertExecutionGuards({ target: 'beta', runtimeTarget: 'prod', execute: false }),
    ).toThrow(/does not match/));
  it('routes recency through guarded application without direct promotion', () =>
    expect(
      validateReviewDecisions([{ ...valid, kind: 'recency' }], new Set([handle]))[0],
    ).toMatchObject({ disposition: 'apply_recency' }));
});
