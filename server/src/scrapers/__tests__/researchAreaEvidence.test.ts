import { describe, expect, it } from 'vitest';
import {
  hasLiveResearchAreaEvidence,
  isLiveResearchAreaStatement,
  researchAreaEvidenceIdentity,
  researchAreasAreManuallyLocked,
  type ResearchAreaEvidenceObservation,
} from '../researchAreaEvidence';

const ROW_ID = '64b000000000000000000001';
const OTHER_ROW_ID = '64b000000000000000000002';
const LOSER_ID = '64b000000000000000000003';

const row = { _id: ROW_ID, slug: 'example-survivor-lab' };
const identity = researchAreaEvidenceIdentity(row, [
  { _id: LOSER_ID as never, slug: 'example-merged-loser' },
]);

const statement = (
  fields: Partial<ResearchAreaEvidenceObservation> = {},
): ResearchAreaEvidenceObservation => ({
  field: 'researchAreas',
  value: ['Neuroscience'],
  superseded: false,
  ...fields,
});

describe('isLiveResearchAreaStatement', () => {
  it('accepts a live researchAreas observation that names at least one area', () => {
    expect(isLiveResearchAreaStatement(statement())).toBe(true);
  });

  it('refuses a superseded, rolled-back, empty, or other-field observation', () => {
    expect(isLiveResearchAreaStatement(statement({ superseded: true }))).toBe(false);
    expect(isLiveResearchAreaStatement(statement({ rollback: { rolledBackAt: new Date() } }))).toBe(
      false,
    );
    expect(isLiveResearchAreaStatement(statement({ value: [] }))).toBe(false);
    expect(isLiveResearchAreaStatement(statement({ value: ['  '] }))).toBe(false);
    expect(isLiveResearchAreaStatement(statement({ field: 'methods' }))).toBe(false);
  });
});

describe('hasLiveResearchAreaEvidence', () => {
  it('is backed by an observation carrying the row entityId', () => {
    expect(hasLiveResearchAreaEvidence(identity, [statement({ entityId: ROW_ID })])).toBe(true);
  });

  it('is backed by an entityKey-only observation keyed to the row slug', () => {
    expect(
      hasLiveResearchAreaEvidence(identity, [statement({ entityKey: 'example-survivor-lab' })]),
    ).toBe(true);
  });

  it('never lets a slug match borrow an observation anchored to another row id', () => {
    expect(
      hasLiveResearchAreaEvidence(identity, [
        statement({ entityId: OTHER_ROW_ID, entityKey: 'example-survivor-lab' }),
      ]),
    ).toBe(false);
  });

  it('is backed by a merged-in loser observation, by id or by key', () => {
    expect(hasLiveResearchAreaEvidence(identity, [statement({ entityId: LOSER_ID })])).toBe(true);
    expect(
      hasLiveResearchAreaEvidence(identity, [statement({ entityKey: 'example-merged-loser' })]),
    ).toBe(true);
  });

  it('is not backed when every observation on the row is superseded or rolled back', () => {
    expect(
      hasLiveResearchAreaEvidence(identity, [
        statement({ entityId: ROW_ID, superseded: true }),
        statement({ entityKey: 'example-survivor-lab', rollback: { rolledBackAt: new Date() } }),
      ]),
    ).toBe(false);
  });

  it('is not backed by another row observation', () => {
    expect(
      hasLiveResearchAreaEvidence(identity, [
        statement({ entityId: OTHER_ROW_ID }),
        statement({ entityKey: 'example-unrelated-lab' }),
      ]),
    ).toBe(false);
  });
});

describe('researchAreasAreManuallyLocked', () => {
  it('reads the researchAreas lock and nothing else', () => {
    expect(researchAreasAreManuallyLocked({ manuallyLockedFields: ['researchAreas'] })).toBe(true);
    expect(researchAreasAreManuallyLocked({ manuallyLockedFields: ['websiteUrl'] })).toBe(false);
    expect(researchAreasAreManuallyLocked({})).toBe(false);
  });
});
