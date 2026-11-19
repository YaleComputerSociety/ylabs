import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyResearchEntityOrgUnitCanonicalization,
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  setOrgUnitCanonicalizerForTesting,
} from '../orgUnitCanonicalization';
import { withDerivedMaterializerFields } from '../entityMaterializer';
import { LATEST_WINS_FINGERPRINT_FIELDS_BY_SOURCE } from '../observationStore';

const PUBLIC_HEALTH = 'Fixture School of Public Health';
const MEDICINE = 'Fixture School of Medicine';

beforeEach(() => {
  setOrgUnitCanonicalizerForTesting(
    createOrgUnitCanonicalizer(
      buildOrgUnitResolverIndex([
        { slug: 'fixture-public-health', name: PUBLIC_HEALTH, kind: 'SCHOOL' },
        { slug: 'fixture-medicine', name: MEDICINE, kind: 'SCHOOL' },
        { slug: 'fixture-biostatistics', name: 'Fixture Biostatistics', kind: 'DEPARTMENT' },
        { slug: 'fixture-cardiology', name: 'Fixture Cardiology', kind: 'DEPARTMENT' },
      ]),
      new Map([
        ['Fixture Biostatistics', PUBLIC_HEALTH],
        ['Fixture Cardiology', MEDICINE],
      ]),
    ),
  );
});

afterEach(() => setOrgUnitCanonicalizerForTesting(null));

describe("a lead's stated non-Primary appointment school joins a row's schools only (#6529)", () => {
  it('adds the stated school to schools and never touches school or departments', async () => {
    const set: Record<string, unknown> = { statedAppointmentSchools: [MEDICINE] };

    await applyResearchEntityOrgUnitCanonicalization(set, {
      school: PUBLIC_HEALTH,
      departments: ['Fixture Biostatistics'],
    });

    expect(set.schools).toEqual([PUBLIC_HEALTH, MEDICINE]);
    expect(set).not.toHaveProperty('school');
    expect(set).not.toHaveProperty('departments');
  });

  it('keeps the stated school when the same pass also rewrites school and departments', async () => {
    const set: Record<string, unknown> = {
      school: PUBLIC_HEALTH,
      departments: ['Fixture Biostatistics'],
      statedAppointmentSchools: [MEDICINE],
    };

    await applyResearchEntityOrgUnitCanonicalization(set, null);

    expect(set.school).toBe(PUBLIC_HEALTH);
    expect(set.departments).toEqual(['Fixture Biostatistics']);
    expect(set.schools).toEqual([PUBLIC_HEALTH, MEDICINE]);
  });

  it('never fills an empty school from a stated non-Primary school', async () => {
    const set: Record<string, unknown> = { statedAppointmentSchools: [MEDICINE] };

    await applyResearchEntityOrgUnitCanonicalization(set, { school: '', departments: [] });

    expect(set).not.toHaveProperty('school');
    expect(set.schools).toEqual([MEDICINE]);
  });

  it('never clears a cross-school center school from a pass carrying only stated schools', async () => {
    const set: Record<string, unknown> = { statedAppointmentSchools: [MEDICINE] };

    const result = await applyResearchEntityOrgUnitCanonicalization(set, {
      entityType: 'CENTER',
      school: PUBLIC_HEALTH,
      departments: ['Fixture Biostatistics', 'Fixture Cardiology'],
    });

    expect(set).not.toHaveProperty('school');
    expect(result.unresolvablePrimarySchool).toBeFalsy();
    expect(set.schools).toEqual([PUBLIC_HEALTH, MEDICINE]);
  });

  it('lists a stated school once when the Primary school already names it', async () => {
    const set: Record<string, unknown> = { statedAppointmentSchools: [PUBLIC_HEALTH] };

    await applyResearchEntityOrgUnitCanonicalization(set, { school: PUBLIC_HEALTH });

    expect(set.schools).toEqual([PUBLIC_HEALTH]);
  });

  it('drops a stated school the catalog does not name', async () => {
    const set: Record<string, unknown> = { statedAppointmentSchools: ['Fixture Unknown School'] };

    await applyResearchEntityOrgUnitCanonicalization(set, { school: PUBLIC_HEALTH });

    expect(set.schools).toEqual([PUBLIC_HEALTH]);
  });

  it('co-derives the stated schools with school, schools and departments in a scoped run', () => {
    expect(withDerivedMaterializerFields(['statedAppointmentSchools'])).toEqual(
      expect.arrayContaining(['school', 'schools', 'departments', 'statedAppointmentSchools']),
    );
    expect(withDerivedMaterializerFields(['schools'])).toContain('statedAppointmentSchools');
  });

  it('keeps the lane reading latest-wins, so a newer card replaces a stale one', () => {
    expect(
      LATEST_WINS_FINGERPRINT_FIELDS_BY_SOURCE['official-profile-pi-backfill']?.has(
        'statedAppointmentSchools',
      ),
    ).toBe(true);
  });
});
