import { describe, it, expect } from 'vitest';
import {
  comparePersonIdentity,
  decideStrandedKey,
  summarizeStrandedKeyDecisions,
  wouldDowngradeEntityType,
  wouldReplaceStatedNameWithTemplate,
  type StrandedFieldComparison,
  type StrandedKeyTarget,
} from '../strandedKeyRedirectDecisionCore';

const personTarget: StrandedKeyTarget = {
  slug: 'dept-mcdb-jacob-musser',
  name: 'Jacob Musser Lab',
  entityType: 'LAB',
  kind: 'lab',
  leadName: 'Jacob Musser',
  studentVisibilityTier: 'student_ready',
};

const agreeing: StrandedFieldComparison[] = [
  {
    field: 'name',
    verdict: 'AGREES',
    strandedValue: 'Jacob Musser Lab',
    targetValue: 'Jacob Musser Lab',
  },
  { field: 'kind', verdict: 'AGREES', strandedValue: 'lab', targetValue: 'lab' },
];

const base = {
  entityKey: 'nsf-pi-jacob-musser',
  keyPersonName: 'Jacob Musser',
  strandedName: 'Jacob Musser Lab',
  strandedEntityType: 'LAB',
  targets: [personTarget],
  fieldComparisons: agreeing,
};

describe('comparePersonIdentity', () => {
  it('matches a hyphenated given name against its compressed spelling', () => {
    expect(comparePersonIdentity('Shi-Yi Wang', 'shi yi wang')).toBe('SAME');
    expect(comparePersonIdentity('Raul U. Hernandez-Ramirez', 'raul u hernandez ramirez')).toBe(
      'SAME',
    );
  });

  it('matches across a dropped middle initial', () => {
    expect(comparePersonIdentity('Emma Zang', 'emma x zang')).toBe('SAME');
  });

  it('calls a familiar form UNCERTAIN rather than deciding it', () => {
    expect(comparePersonIdentity('Candie Paulsen', 'candice paulsen')).toBe('UNCERTAIN');
    expect(comparePersonIdentity('Theodore Cohen', 'ted cohen')).toBe('UNCERTAIN');
  });

  it('calls two different surnames DIFFERENT', () => {
    expect(comparePersonIdentity('Robin de Graaf', 'henk de feyter')).toBe('DIFFERENT');
  });

  it('will not call two different people DIFFERENT while they share a surname', () => {
    // Themis Kyriakides and Tassos C. Kyriakides are distinct Yale researchers, but a
    // shared surname with no overlapping given name is exactly the case a name cannot
    // settle, so this reports UNCERTAIN rather than claiming a mismatch it has not shown.
    expect(comparePersonIdentity('Themis Kyriakides', 'tassos c kyriakides')).toBe('UNCERTAIN');
  });

  it('is UNCERTAIN when either side is unusable', () => {
    expect(comparePersonIdentity('', 'jacob musser')).toBe('UNCERTAIN');
  });
});

describe('wouldDowngradeEntityType', () => {
  it('flags a person row aimed at a live LAB', () => {
    expect(wouldDowngradeEntityType('FACULTY_RESEARCH_AREA', personTarget)).toBe(true);
  });

  it('does not flag equal or stronger', () => {
    expect(wouldDowngradeEntityType('LAB', personTarget)).toBe(false);
    expect(
      wouldDowngradeEntityType('LAB', { ...personTarget, entityType: 'FACULTY_RESEARCH_AREA' }),
    ).toBe(false);
  });

  it('does not flag a scope it cannot rank', () => {
    expect(
      wouldDowngradeEntityType('FACULTY_RESEARCH_AREA', { ...personTarget, entityType: 'CENTER' }),
    ).toBe(false);
  });
});

describe('wouldReplaceStatedNameWithTemplate', () => {
  it('flags a template aimed at a stated branded name', () => {
    expect(
      wouldReplaceStatedNameWithTemplate('Brian Scassellati Lab', {
        ...personTarget,
        name: 'Social Robotics Lab',
        leadName: 'Brian Scassellati',
      }),
    ).toBe(true);
  });

  it('leaves two templates alone', () => {
    expect(wouldReplaceStatedNameWithTemplate('Jacob Musser Lab', personTarget)).toBe(false);
  });
});

describe('decideStrandedKey', () => {
  it('redirects when the values agree', () => {
    expect(decideStrandedKey(base)).toEqual({
      decision: 'BACKFILL_REDIRECT',
      reason: 'AGREES_WITH_TARGET',
      targetSlug: 'dept-mcdb-jacob-musser',
    });
  });

  it('refuses to pick between two live targets', () => {
    expect(
      decideStrandedKey({ ...base, targets: [personTarget, { ...personTarget, slug: 'other' }] }),
    ).toMatchObject({ decision: 'LEAVE_ALONE', reason: 'MULTIPLE_LIVE_TARGETS' });
  });

  it('reports an archived target rather than treating it as absent evidence', () => {
    expect(decideStrandedKey({ ...base, targets: [] })).toEqual({
      decision: 'LEAVE_ALONE',
      reason: 'TARGET_IS_ARCHIVED',
    });
  });

  it('never re-keys a person onto an organization it merely directs', () => {
    expect(
      decideStrandedKey({
        ...base,
        targets: [{ ...personTarget, entityType: 'CENTER', kind: 'center' }],
      }),
    ).toMatchObject({
      decision: 'LEAVE_ALONE',
      reason: 'TARGET_IS_AN_ORGANIZATION_NOT_A_PERSON_HOME',
    });
  });

  it('leaves an unresolved lead alone rather than trusting the slug match (#2384)', () => {
    expect(
      decideStrandedKey({ ...base, targets: [{ ...personTarget, leadName: '' }] }),
    ).toMatchObject({ decision: 'LEAVE_ALONE', reason: 'TARGET_LEAD_UNRESOLVED' });
  });

  it('holds a familiar-name match for confirmation instead of acting on it', () => {
    expect(
      decideStrandedKey({
        ...base,
        keyPersonName: 'candice paulsen',
        targets: [{ ...personTarget, leadName: 'Candie Paulsen' }],
      }),
    ).toMatchObject({ decision: 'LEAVE_ALONE', reason: 'TARGET_LEAD_MATCH_NEEDS_CONFIRMATION' });
  });

  it('leaves a thinner separate record of the same person alone, neither moved nor destroyed', () => {
    expect(
      decideStrandedKey({
        ...base,
        entityKey: 'dept-ysph-josephine-hoh',
        keyPersonName: 'Josephine Hoh',
        strandedName: 'Josephine Hoh Faculty Research',
        strandedEntityType: 'FACULTY_RESEARCH_AREA',
        targets: [{ ...personTarget, name: 'Hoh Lab', leadName: 'Josephine Hoh' }],
        fieldComparisons: [],
      }),
    ).toMatchObject({ decision: 'LEAVE_ALONE', reason: 'A_SEPARATE_RECORD_OF_THE_SAME_PERSON' });
  });

  it('retires a template name aimed at a stated one', () => {
    expect(
      decideStrandedKey({
        ...base,
        keyPersonName: 'Brian Scassellati',
        strandedName: 'Brian Scassellati Lab',
        targets: [{ ...personTarget, name: 'Social Robotics Lab', leadName: 'Brian Scassellati' }],
      }),
    ).toMatchObject({
      decision: 'RETIRE_OBSERVATIONS',
      reason: 'WOULD_REPLACE_A_STATED_NAME_WITH_A_TEMPLATE',
    });
  });

  it('retires a placeholder mint intent (#2367)', () => {
    expect(decideStrandedKey({ ...base, strandedName: 'n/a' })).toMatchObject({
      decision: 'RETIRE_OBSERVATIONS',
      reason: 'PLACEHOLDER_MINT_INTENT',
    });
  });

  it('lets a served-copy conflict outrank a gap it would also fill', () => {
    expect(
      decideStrandedKey({
        ...base,
        fieldComparisons: [
          {
            field: 'researchAreas',
            verdict: 'FILLS_GAP',
            strandedValue: ['Biophysics'],
            targetValue: [],
          },
          {
            field: 'fullDescription',
            verdict: 'DIFFERS',
            strandedValue: 'Google Scholar: Profile Conventional FIB-SEM',
            targetValue: 'Our primary research interest is transformative instrumentation',
          },
        ],
      }),
    ).toMatchObject({ decision: 'LEAVE_ALONE', reason: 'WOULD_OVERWRITE_SERVED_COPY' });
  });

  it('treats a facet field as served copy, since overwriting it moves the target between facets', () => {
    expect(
      decideStrandedKey({
        ...base,
        fieldComparisons: [
          {
            field: 'departments',
            verdict: 'DIFFERS',
            strandedValue: ['Yale School of Public Health'],
            targetValue: ['Epidemiology'],
          },
        ],
      }),
    ).toMatchObject({ decision: 'LEAVE_ALONE', reason: 'WOULD_OVERWRITE_SERVED_COPY' });
  });

  it('redirects when the only difference is a gap it fills', () => {
    expect(
      decideStrandedKey({
        ...base,
        fieldComparisons: [
          {
            field: 'researchAreas',
            verdict: 'FILLS_GAP',
            strandedValue: ['Biophysics'],
            targetValue: [],
          },
        ],
      }),
    ).toMatchObject({
      decision: 'BACKFILL_REDIRECT',
      reason: 'ADDS_EVIDENCE_THE_TARGET_LACKS',
    });
  });
});

describe('summarizeStrandedKeyDecisions', () => {
  it('buckets by decision and reason with observation counts', () => {
    expect(
      summarizeStrandedKeyDecisions([
        { decision: 'BACKFILL_REDIRECT', reason: 'AGREES_WITH_TARGET', liveObservationCount: 8 },
        { decision: 'BACKFILL_REDIRECT', reason: 'AGREES_WITH_TARGET', liveObservationCount: 4 },
        { decision: 'LEAVE_ALONE', reason: 'MULTIPLE_LIVE_TARGETS', liveObservationCount: 10 },
      ]),
    ).toEqual({
      'BACKFILL_REDIRECT:AGREES_WITH_TARGET': { keys: 2, liveObservations: 12 },
      'LEAVE_ALONE:MULTIPLE_LIVE_TARGETS': { keys: 1, liveObservations: 10 },
    });
  });
});
