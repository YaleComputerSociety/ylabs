import { describe, expect, it } from 'vitest';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import {
  hasLiveResearchAreaEvidence,
  isLiveResearchAreaStatement,
  researchAreaAdmissionForRow,
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

const canonicalizer = createResearchAreaCanonicalizer(
  buildResearchAreaResolverIndex([{ name: 'Neuroscience' }, { name: 'Psychology' }]),
);
const admitsAll = researchAreaAdmissionForRow(canonicalizer, {});

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
    expect(isLiveResearchAreaStatement(statement(), admitsAll)).toBe(true);
  });

  it('refuses a superseded, rolled-back, empty, or other-field observation', () => {
    expect(isLiveResearchAreaStatement(statement({ superseded: true }), admitsAll)).toBe(false);
    expect(
      isLiveResearchAreaStatement(statement({ rollback: { rolledBackAt: new Date() } }), admitsAll),
    ).toBe(false);
    expect(isLiveResearchAreaStatement(statement({ value: [] }), admitsAll)).toBe(false);
    expect(isLiveResearchAreaStatement(statement({ value: ['  '] }), admitsAll)).toBe(false);
    expect(isLiveResearchAreaStatement(statement({ field: 'methods' }), admitsAll)).toBe(false);
  });
});

describe('hasLiveResearchAreaEvidence', () => {
  it('is not backed by an observation citing a source the lane now refuses (#4030)', () => {
    const areaPage = 'https://example.edu/faculty-research/faculty-directory/finance';
    const observations = [statement({ entityId: ROW_ID, sourceUrl: areaPage })];
    expect(hasLiveResearchAreaEvidence(identity, observations, admitsAll)).toBe(true);
    expect(
      hasLiveResearchAreaEvidence(identity, observations, admitsAll, (url) => url === areaPage),
    ).toBe(false);
  });

  it('is backed by an observation carrying the row entityId', () => {
    expect(
      hasLiveResearchAreaEvidence(identity, [statement({ entityId: ROW_ID })], admitsAll),
    ).toBe(true);
  });

  it('is backed by an entityKey-only observation keyed to the row slug', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityKey: 'example-survivor-lab' })],
        admitsAll,
      ),
    ).toBe(true);
  });

  it('never lets a slug match borrow an observation anchored to another row id', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityId: OTHER_ROW_ID, entityKey: 'example-survivor-lab' })],
        admitsAll,
      ),
    ).toBe(false);
  });

  it('is backed by a merged-in loser observation, by id or by key', () => {
    expect(
      hasLiveResearchAreaEvidence(identity, [statement({ entityId: LOSER_ID })], admitsAll),
    ).toBe(true);
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityKey: 'example-merged-loser' })],
        admitsAll,
      ),
    ).toBe(true);
  });

  it('is not backed when every observation on the row is superseded or rolled back', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [
          statement({ entityId: ROW_ID, superseded: true }),
          statement({ entityKey: 'example-survivor-lab', rollback: { rolledBackAt: new Date() } }),
        ],
        admitsAll,
      ),
    ).toBe(false);
  });

  it('is not backed by another row observation', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityId: OTHER_ROW_ID }), statement({ entityKey: 'example-unrelated-lab' })],
        admitsAll,
      ),
    ).toBe(false);
  });
});

describe('an observation the row wholly rejects is no evidence (#3836)', () => {
  const psychologyRow = researchAreaAdmissionForRow(canonicalizer, {
    departments: ['Psychology'],
  });

  it('is not backed by an observation naming only the row own department', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityId: ROW_ID, value: ['Psychology'] })],
        psychologyRow,
      ),
    ).toBe(false);
  });

  it('is not backed by an observation naming only a division-level label', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityId: ROW_ID, value: ['Pediatrics'] })],
        psychologyRow,
      ),
    ).toBe(false);
  });

  it('is backed when one area survives beside the rejected department', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityId: ROW_ID, value: ['Psychology', 'Neuroscience'] })],
        psychologyRow,
      ),
    ).toBe(true);
  });

  it('is backed by another department name that is not this row own department', () => {
    expect(
      hasLiveResearchAreaEvidence(
        identity,
        [statement({ entityId: ROW_ID, value: ['Neuroscience'] })],
        psychologyRow,
      ),
    ).toBe(true);
  });
});

describe('researchAreasAreManuallyLocked', () => {
  it('reads the researchAreas lock and nothing else', () => {
    expect(researchAreasAreManuallyLocked({ manuallyLockedFields: ['researchAreas'] })).toBe(true);
    expect(researchAreasAreManuallyLocked({ manuallyLockedFields: ['websiteUrl'] })).toBe(false);
    expect(researchAreasAreManuallyLocked({})).toBe(false);
  });
});
