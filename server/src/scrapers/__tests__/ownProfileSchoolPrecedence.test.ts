import { afterEach, describe, expect, it, vi } from 'vitest';
import * as orgUnitCanonicalization from '../orgUnitCanonicalization';
import {
  OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
  ownProfileSchoolPrecedenceAtResolve,
  ownProfileSchoolProvenanceFor,
  withOwnProfileSchoolPrecedence,
  withRetainedSecondarySchools,
} from '../ownProfileSchoolPrecedence';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';

const canonicalizeSchool = (raw: unknown) => ({ value: String(raw ?? '').trim() });

const OWN_PROFILE = 'https://ysph.yale.edu/profile/hollis-quintrell/';
const ROSTER = 'https://medicine.yale.edu/fixture-department/people/';
const observedAt = new Date('2026-10-01T00:00:00Z');

const reading = (field: string, value: unknown, sourceUrl: string, extra = {}) => ({
  field,
  value,
  sourceUrl,
  sourceName: 'fixture-lane',
  observedAt,
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withOwnProfileSchoolPrecedence (#6157)', () => {
  it('sets aside a roster school from another school site and derives the own profile school', () => {
    const roster = reading('school', 'School of Medicine', ROSTER);
    const result = withOwnProfileSchoolPrecedence([roster], OWN_PROFILE, canonicalizeSchool);

    expect(result.dropped).toEqual([roster]);
    expect(result.observations).toEqual([]);
    expect(result.candidate).toMatchObject({
      field: 'school',
      value: 'School of Public Health',
      sourceName: OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
      sourceUrl: OWN_PROFILE,
    });
  });

  it('keeps a joint appointment the own profile itself names', () => {
    const roster = reading('school', 'School of Medicine', ROSTER);
    const ownStatesBoth = reading('school', 'School of Medicine', OWN_PROFILE);
    const result = withOwnProfileSchoolPrecedence(
      [roster, ownStatesBoth],
      OWN_PROFILE,
      canonicalizeSchool,
    );

    expect(result.dropped).toEqual([]);
    expect(result.candidate).toBeUndefined();
    expect(result.observations).toEqual([roster, ownStatesBoth]);
  });

  it('changes nothing when another school reading shares the own profile host', () => {
    const sameHostRoster = reading(
      'school',
      'School of Public Health',
      'https://ysph.yale.edu/fixture-department/people/',
    );
    const crossRoster = reading('school', 'School of Medicine', ROSTER);
    const result = withOwnProfileSchoolPrecedence(
      [sameHostRoster, crossRoster],
      OWN_PROFILE,
      canonicalizeSchool,
    );

    expect(result.dropped).toEqual([]);
    expect(result.candidate).toBeUndefined();
  });

  it('drops only the school reading, never another field read off the same roster', () => {
    const rosterSchool = reading('school', 'School of Medicine', ROSTER);
    const rosterDepartments = reading('departments', ['Fixture Department'], ROSTER);
    const rosterAffiliation = reading('orgAffiliationLabels', ['Fixture Center'], ROSTER);
    const result = withOwnProfileSchoolPrecedence(
      [rosterSchool, rosterDepartments, rosterAffiliation],
      OWN_PROFILE,
      canonicalizeSchool,
    );

    expect(result.observations).toEqual([rosterDepartments, rosterAffiliation]);
  });

  it('changes nothing without an own profile on a school site', () => {
    const roster = reading('school', 'School of Medicine', ROSTER);
    for (const ownProfile of [undefined, 'https://history.yale.edu/people/fixture-person']) {
      const result = withOwnProfileSchoolPrecedence([roster], ownProfile, canonicalizeSchool);
      expect(result.dropped).toEqual([]);
      expect(result.candidate).toBeUndefined();
    }
  });

  it('pins the derived reading to its evidence, so an unchanged row re-derives it identically', () => {
    const roster = reading('school', 'School of Medicine', ROSTER);
    const first = withOwnProfileSchoolPrecedence([roster], OWN_PROFILE, canonicalizeSchool);
    const second = withOwnProfileSchoolPrecedence([roster], OWN_PROFILE, canonicalizeSchool);
    expect(first.candidate).toEqual(second.candidate);
    expect(first.candidate?.observedAt).toEqual(observedAt);
  });
});

describe('ownProfileSchoolProvenanceFor (#6157)', () => {
  const candidate = withOwnProfileSchoolPrecedence(
    [reading('school', 'School of Medicine', ROSTER)],
    OWN_PROFILE,
    canonicalizeSchool,
  ).candidate;

  it('credits the derived school only when it is what resolved', () => {
    expect(
      ownProfileSchoolProvenanceFor(
        'school',
        {
          value: 'School of Public Health',
          contributingSources: [OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME],
        },
        candidate,
      ),
    ).toMatchObject({ sourceName: OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME, sourceUrl: OWN_PROFILE });
    expect(
      ownProfileSchoolProvenanceFor(
        'school',
        { value: 'School of Nursing', contributingSources: ['fixture-lane'] },
        candidate,
      ),
    ).toBeNull();
    expect(
      ownProfileSchoolProvenanceFor(
        'departments',
        {
          value: 'School of Public Health',
          contributingSources: [OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME],
        },
        candidate,
      ),
    ).toBeNull();
  });
});

describe('ownProfileSchoolPrecedenceAtResolve (#6157)', () => {
  it('loads no catalog for a row with no school reading', async () => {
    const load = vi.spyOn(orgUnitCanonicalization, 'getOrgUnitCanonicalizer');
    const departments = reading('departments', ['Fixture Department'], ROSTER);
    const result = await ownProfileSchoolPrecedenceAtResolve([departments], OWN_PROFILE);
    expect(result.observations).toEqual([departments]);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('withRetainedSecondarySchools (#6157)', () => {
  const candidate = withOwnProfileSchoolPrecedence(
    [reading('school', 'School of Medicine', ROSTER)],
    OWN_PROFILE,
    canonicalizeSchool,
  ).candidate;

  it('keeps the set-aside roster school after the own profile school', () => {
    const set: Record<string, unknown> = {
      school: 'School of Public Health',
      schools: ['School of Public Health'],
    };
    withRetainedSecondarySchools(set, candidate, undefined);
    expect(set.schools).toEqual(['School of Public Health', 'School of Medicine']);
  });

  it('never retains a school the row refuses', () => {
    const refusals = planFieldValueRefusal(undefined, {
      field: 'school',
      value: 'School of Medicine',
      rule: 'operator_judgement',
      refusedBy: 'fixture',
      note: 'fixture refusal',
    })['fieldValueRefusals.school'];
    const set: Record<string, unknown> = {
      school: 'School of Public Health',
      schools: ['School of Public Health'],
    };
    withRetainedSecondarySchools(set, candidate, { school: refusals });
    expect(set.schools).toEqual(['School of Public Health']);
  });

  it('adds nothing when the derived school did not win', () => {
    const set: Record<string, unknown> = {
      school: 'School of Nursing',
      schools: ['School of Nursing'],
    };
    withRetainedSecondarySchools(set, candidate, undefined);
    expect(set.schools).toEqual(['School of Nursing']);
  });
});
