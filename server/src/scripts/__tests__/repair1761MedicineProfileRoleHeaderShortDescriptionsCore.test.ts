import { describe, expect, it } from 'vitest';

import {
  planRoleHeaderShortRepairRow,
  summarizeRoleHeaderShortRepair,
} from '../repair1761MedicineProfileRoleHeaderShortDescriptionsCore';

describe('planRoleHeaderShortRepairRow', () => {
  it('replaces a role-header short with the later research sentence (Krop)', async () => {
    const row = await planRoleHeaderShortRepairRow({
      id: '6a0d17a23fa399fefb6e60db',
      slug: 'faculty-research-area-ian-krop',
      shortDescription:
        'Among his leadership roles at Yale Cancer Center, Dr. Krop serves as Associate Cancer Center Director for Clinical Research, Director of the Yale Cancer Center Clinical Trials Office.',
      fullDescription:
        'Among his leadership roles at Yale Cancer Center, Dr. Krop serves as Associate Cancer Center Director for Clinical Research, Director of the Yale Cancer Center Clinical Trials Office. An international leader in breast cancer research, he studies novel antibody-drug conjugates for HER2-positive disease.',
    });
    expect(row.malformed).toBe(true);
    expect(row.changed).toBe(true);
    expect(row.after).not.toMatch(/serves as/i);
    expect(row.after).toMatch(/antibody-drug conjugates/i);
  });

  it('leaves a role-header short untouched when the full description has no research sentence (Xiao Wang)', async () => {
    const row = await planRoleHeaderShortRepairRow({
      id: '6a0d18143fa399fefb6e673b',
      slug: 'faculty-research-area-xiao-wang',
      shortDescription:
        'Dr. Xiao Wang is an Instructor of Medicine (Medical Oncology) at Yale School of Medicine and a member of the Center for Gastrointestinal Cancers at Yale Cancer Center.',
      fullDescription:
        'Dr. Xiao Wang is an Instructor of Medicine (Medical Oncology) at Yale School of Medicine and a member of the Center for Gastrointestinal Cancers at Yale Cancer Center.',
    });
    expect(row.malformed).toBe(true);
    expect(row.changed).toBe(false);
    expect(row.after).toBe(row.before);
  });

  it('leaves an already research-led short untouched', async () => {
    const row = await planRoleHeaderShortRepairRow({
      id: 'not-a-role-header',
      shortDescription: 'Studies quantum error correction using superconducting qubit devices.',
      fullDescription: 'Studies quantum error correction using superconducting qubit devices.',
    });
    expect(row.malformed).toBe(false);
    expect(row.changed).toBe(false);
    expect(row.after).toBe(row.before);
  });

  it('leaves a researchAreas-only candidate unchanged when the full description carries no research signal', async () => {
    const row = await planRoleHeaderShortRepairRow({
      id: 'role-header-with-areas',
      shortDescription:
        'Dr. Example is an Assistant Professor of Medicine at Yale School of Medicine and a member of the Center for Gastrointestinal Cancers.',
      fullDescription:
        'Dr. Example is an Assistant Professor of Medicine at Yale School of Medicine and a member of the Center for Gastrointestinal Cancers.',
      researchAreas: ['Gastrointestinal Oncology', 'Clinical Trials'],
    });
    expect(row.malformed).toBe(true);
    expect(row.changed).toBe(false);
    expect(row.after).toBe(row.before);
  });
});

describe('summarizeRoleHeaderShortRepair', () => {
  it('counts considered, malformed, changed, and unresolved rows', async () => {
    const rows = await Promise.all([
      planRoleHeaderShortRepairRow({
        id: '6a0d17a23fa399fefb6e60db',
        shortDescription:
          'Dr. Krop serves as Associate Cancer Center Director for Clinical Research at Yale Cancer Center.',
        fullDescription:
          'Dr. Krop serves as Associate Cancer Center Director for Clinical Research at Yale Cancer Center. An international leader in breast cancer research, he studies novel antibody-drug conjugates for HER2-positive disease.',
      }),
      planRoleHeaderShortRepairRow({
        id: '6a0d18143fa399fefb6e673b',
        shortDescription:
          'Dr. Xiao Wang is an Instructor of Medicine (Medical Oncology) at Yale School of Medicine and a member of the Center for Gastrointestinal Cancers at Yale Cancer Center.',
        fullDescription:
          'Dr. Xiao Wang is an Instructor of Medicine (Medical Oncology) at Yale School of Medicine and a member of the Center for Gastrointestinal Cancers at Yale Cancer Center.',
      }),
      planRoleHeaderShortRepairRow({
        id: 'not-a-role-header',
        shortDescription: 'Studies quantum error correction using superconducting qubit devices.',
        fullDescription: 'Studies quantum error correction using superconducting qubit devices.',
      }),
    ]);
    expect(summarizeRoleHeaderShortRepair(rows)).toEqual({
      considered: 3,
      malformed: 2,
      changed: 1,
      unresolved: 1,
    });
  });
});
