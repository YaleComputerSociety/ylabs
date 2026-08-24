import { describe, expect, it } from 'vitest';

import {
  planProgramStudiesVoiceRepairRow,
  summarizeProgramStudiesVoiceRepair,
} from '../repair1555ProgramStudiesVoiceShortDescriptionsCore';

describe('planProgramStudiesVoiceRepairRow', () => {
  it('replaces a mis-framed researcher-voice short with the program-appropriate offer sentence', () => {
    const row = planProgramStudiesVoiceRepairRow({
      id: '6a8bc3393bf820baddf79235',
      shortDescription:
        'Studies Yale-linked project funds for work increasing understanding of Jewish history, culture, or religious thought.',
      fullDescription:
        'Yale-linked project funds for work increasing understanding of Jewish history, culture, or religious thought.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'Yale-linked project funds for work increasing understanding of Jewish history, culture, or religious thought.',
    );
  });

  it('blanks a mis-framed short when no program-appropriate sentence can be derived', () => {
    const row = planProgramStudiesVoiceRepairRow({
      id: '6a8bc3423bf820baddf79325',
      shortDescription: 'Studies the social, political, economic and biological determinants of health.',
      fullDescription: 'Determinants of health. Funds research now. Health equity work.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe('');
  });

  it('leaves an untargeted entity untouched even if it opens with a research verb', () => {
    const row = planProgramStudiesVoiceRepairRow({
      id: 'not-in-the-target-list',
      shortDescription: 'Explores the neurobiological basis of addiction using PET and MRI.',
      fullDescription: 'Our research explores the neurobiological basis of addiction.',
    });
    expect(row.changed).toBe(false);
    expect(row.skipReason).toBe('not-targeted');
    expect(row.after).toBe('Explores the neurobiological basis of addiction using PET and MRI.');
  });

  it('fails closed when the targeted entity no longer matches the audited text', () => {
    const row = planProgramStudiesVoiceRepairRow({
      id: '6a226455f5629b1480397ccb',
      shortDescription: 'Someone already edited this short description.',
      fullDescription: 'The history major is for students who understand the past.',
    });
    expect(row.changed).toBe(false);
    expect(row.skipReason).toBe('stale-mismatch');
  });
});

describe('summarizeProgramStudiesVoiceRepair', () => {
  it('counts considered, targeted, changed, and stale-mismatch rows', () => {
    const rows = [
      planProgramStudiesVoiceRepairRow({
        id: '6a226455f5629b1480397ccb',
        shortDescription:
          'Studies history is excellent preparation for careers in many fields, including law, journalism, business and finance, education, politics and public policy, social activism, and the arts.',
        fullDescription:
          'The history major is for students who understand that shaping the future requires knowing the past. Studying history is excellent preparation for careers in many fields, including law, journalism, business and finance, education, politics and public policy, social activism, and the arts.',
      }),
      planProgramStudiesVoiceRepairRow({
        id: 'not-in-the-target-list',
        shortDescription: 'Examines language contact and change through reading groups.',
        fullDescription: 'Reading groups examine language contact and change.',
      }),
      planProgramStudiesVoiceRepairRow({
        id: '6a6470b3b65d4cb51393aa4a',
        shortDescription: 'This is not the audited text anymore.',
        fullDescription: 'The research team studies impulsivity.',
      }),
    ];
    expect(summarizeProgramStudiesVoiceRepair(rows)).toEqual({
      considered: 3,
      targeted: 2,
      changed: 1,
      staleMismatch: 1,
    });
  });
});
