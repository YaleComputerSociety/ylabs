import { describe, expect, it } from 'vitest';

import {
  planProgramCardWrongSentenceRepairRow,
  summarizeProgramCardWrongSentenceRepair,
} from '../repair1596ProgramCardWrongSentenceShortDescriptionsCore';

describe('planProgramCardWrongSentenceRepairRow', () => {
  it('replaces a cross-program truncated-URL-lead short with the offer sentence (Tetelman)', () => {
    const row = planProgramCardWrongSentenceRepairRow({
      id: '6a8bc3983bf820baddf79c0d',
      shortDescription:
        'edu/ Collaborative Programs between Yale and International Institutions HKUST Summer UG Research Program Is an opportunity for undergraduate students to take up research placement for 10 weeks at HKUST.',
      fullDescription:
        'Alan S. Tetelman 1958 Fellowships for International Research in the Sciences AND the Robert C. Bates Summer Research Fellowship The Alan S. Tetelman 1958 Fellowships for Study Abroad, from the endowments of Jonathan Edwards College, provide support for original undergraduate research projects abroad in the natural and applied sciences. Currently enrolled sophomores and juniors are eligible to apply. edu/ Collaborative Programs between Yale and International Institutions HKUST Summer UG Research Program Is an opportunity for undergraduate students to take up research placement for 10 weeks at HKUST.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe('Currently enrolled sophomores and juniors are eligible to apply.');
  });

  it('replaces an exclusion-clause short with the offer sentence (Rosenfeld)', () => {
    const row = planProgramCardWrongSentenceRepairRow({
      id: '6a8bc39a3bf820baddf79c55',
      shortDescription: 'Clinical research projects will not be considered for funding.',
      fullDescription:
        'Both the Yale College Dean’s Research Fellowship and the Rosenfeld Science Scholars Program seek to promote the academic development of promising students through engagement in original scientific research and provide fellowship support for undergraduate STEM research projects. Clinical research projects will not be considered for funding.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'Both the Yale College Dean’s Research Fellowship and the Rosenfeld Science Scholars Program seek to promote the academic development of promising students through engagement in original scientific research and provide fellowship support for undergraduate STEM research projects.',
    );
  });

  it('replaces an admin-review-only short with the offer sentence (Conklin)', () => {
    const row = planProgramCardWrongSentenceRepairRow({
      id: '6a8bc3483bf820baddf793cd',
      shortDescription:
        'Fellowship applications will be reviewed and recipients selected by the Council on Southeast Asia Studies at the MacMillan Center.',
      fullDescription:
        "Thanks to the CuUnjieng Aboitiz family, this fellowship provides support of up to $3000 to a Yale graduate or undergraduate student conducting primary source or direct summer or academic year research in the Philippines proper. Fellowship applications will be reviewed and recipients selected by the Council on Southeast Asia Studies at the MacMillan Center.",
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'Thanks to the CuUnjieng Aboitiz family, this fellowship provides support of up to $3000 to a Yale graduate or undergraduate student conducting primary source or direct summer or academic year research in the Philippines proper.',
    );
  });

  it('leaves an untargeted entity untouched', () => {
    const row = planProgramCardWrongSentenceRepairRow({
      id: 'not-in-the-target-list',
      shortDescription: 'Funds independent study and research by Berkeley College students.',
      fullDescription: 'Funds independent study and research by Berkeley College students.',
    });
    expect(row.changed).toBe(false);
    expect(row.skipReason).toBe('not-targeted');
  });

  it('fails closed when the targeted entity no longer matches the audited text', () => {
    const row = planProgramCardWrongSentenceRepairRow({
      id: '6a8bc39a3bf820baddf79c55',
      shortDescription: 'Someone already edited this short description.',
      fullDescription: 'This program funds undergraduate STEM research projects.',
    });
    expect(row.changed).toBe(false);
    expect(row.skipReason).toBe('stale-mismatch');
  });
});

describe('summarizeProgramCardWrongSentenceRepair', () => {
  it('counts considered, targeted, changed, and stale-mismatch rows', () => {
    const rows = [
      planProgramCardWrongSentenceRepairRow({
        id: '6a8bc3483bf820baddf793cd',
        shortDescription:
          'Fellowship applications will be reviewed and recipients selected by the Council on Southeast Asia Studies at the MacMillan Center.',
        fullDescription:
          "Thanks to the CuUnjieng Aboitiz family, this fellowship provides support of up to $3000 to a Yale graduate or undergraduate student conducting primary source or direct summer or academic year research in the Philippines proper. Fellowship applications will be reviewed and recipients selected by the Council on Southeast Asia Studies at the MacMillan Center.",
      }),
      planProgramCardWrongSentenceRepairRow({
        id: 'not-in-the-target-list',
        shortDescription: 'Funds independent study and research by Berkeley College students.',
        fullDescription: 'Funds independent study and research by Berkeley College students.',
      }),
      planProgramCardWrongSentenceRepairRow({
        id: '6a8bc39a3bf820baddf79c55',
        shortDescription: 'This is not the audited text anymore.',
        fullDescription: 'This program funds undergraduate STEM research projects.',
      }),
    ];
    expect(summarizeProgramCardWrongSentenceRepair(rows)).toEqual({
      considered: 3,
      targeted: 2,
      changed: 1,
      staleMismatch: 1,
    });
  });
});
