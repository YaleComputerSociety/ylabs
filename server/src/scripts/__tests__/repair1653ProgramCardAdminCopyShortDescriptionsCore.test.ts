import { describe, expect, it } from 'vitest';

import {
  planProgramCardAdminCopyRepairRow,
  summarizeProgramCardAdminCopyRepair,
} from '../repair1653ProgramCardAdminCopyShortDescriptionsCore';

describe('planProgramCardAdminCopyRepairRow', () => {
  it('falls through past a self-referential "is listed by" lead (European Studies Council)', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc3333bf820baddf7918d',
      shortDescription:
        'The European Studies Council travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students.',
      fullDescription:
        'The European Studies Council travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students. It helps defray short-term research or conference travel costs related to Europe, Russia, or Eurasia during the academic year.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'It helps defray short-term research or conference travel costs related to Europe, Russia, or Eurasia during the academic year.',
    );
  });

  it('falls through past a bare "invites applications" announcement (Strong Family)', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc3383bf820baddf7921d',
      shortDescription:
        'The Whitney and Betty MacMillan Center for International and Area Studies invites applications to the Strong Family Travel Fellowship for Peace and Development.',
      fullDescription:
        'The Whitney and Betty MacMillan Center for International and Area Studies invites applications to the Strong Family Travel Fellowship for Peace and Development. Grants of up to $1000 will be awarded to current students in Yale College to pursue independent research, as well as academic programs, internships related to study peace-building initiatives and/or economic development either during the summer or the academic year.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'Grants of up to $1000 will be awarded to current students in Yale College to pursue independent research, as well as academic programs, internships related to study peace-building initiatives and/or economic development either during the summer or the academic year.',
    );
  });

  it('strips a stray scraped footnote asterisk (Council on Southeast Asia Studies)', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc3473bf820baddf793b5',
      shortDescription:
        'Appropriate purposes for support include (but are not limited to) language training*, masters thesis summer research, pre-dissertation research field work, and funding supplements required to bring a research project to fruition.',
      fullDescription:
        'An endowment from the Ford Foundation allows CSEAS to provide limited support for the research-related purposes of Yale University graduate (up to $5,000) and undergraduate students (up to $3,000) with a demonstrated commitment to the field of Southeast Asian studies (Burma/Myanmar, Cambodia, Indonesia, East Timor, Laos, Malaysia, Philippines, Singapore, Thailand, and Vietnam). Appropriate purposes for support include (but are not limited to) language training*, masters thesis summer research, pre-dissertation research field work, and funding supplements required to bring a research project to fruition. We do not fund long-term, basic dissertation research, nor do we consider applications for funding of activities connected with dissertation write-up.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'Appropriate purposes for support include (but are not limited to) language training, masters thesis summer research, pre-dissertation research field work, and funding supplements required to bring a research project to fruition.',
    );
  });

  it('fixes a mid-name truncation at a "St." (Saint) abbreviation (Class of 1960/86)', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc35f3bf820baddf7960d',
      shortDescription:
        "The Class of 1960/86 has established several Class of 1960 Travel/Study Fellowships in Branford College, one of which is in memory of Albert St.",
      fullDescription:
        "The Class of 1960/86 has established several Class of 1960 Travel/Study Fellowships in Branford College, one of which is in memory of Albert St. Pergam '60, father of Lizzie BR '93 and Ilana BR '90. Competition for these Fellowships is open to all Sophomores and Juniors in Branford College who give evidence that their intellectual or personal development would be significantly and usefully enhanced by study or travel.",
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      "The Class of 1960/86 has established several Class of 1960 Travel/Study Fellowships in Branford College, one of which is in memory of Albert St. Pergam '60, father of Lizzie BR '93 and Ilana BR '90.",
    );
  });

  it('relativizes a stale absolute-year season phrase (Department of Classics)', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc35f3bf820baddf79625',
      shortDescription:
        'The Department of Classics will make available a limited number of summer research and/or travel awards (for up to a maximum of 5 worthy projects) for trips to various research and study venues in the summer of 2017.',
      fullDescription:
        'The Department of Classics will make available a limited number of summer research and/or travel awards (for up to a maximum of 5 worthy projects) for trips to various research and study venues in the summer of 2017. This application is intended to serve as a common application in the sense that students submit one application, which is reviewed in consideration for one of the five awards that are available.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'The Department of Classics will make available a limited number of summer research and/or travel awards (for up to a maximum of 5 worthy projects) for trips to various research and study venues each summer.',
    );
  });

  it('falls closed to a blank short when no sentence in the description clears the card bar (Ganzfried)', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc3573bf820baddf7954d',
      shortDescription:
        'The Council on Middle East Studies invites applications to the Ganzfried Family Travel Fellowship competition.',
      fullDescription:
        'The Council on Middle East Studies invites applications to the Ganzfried Family Travel Fellowship competition. This fellowship provides support for undergraduate and graduate students on all subjects related to communal and religious tolerance and understanding, security and cooperation, natural and economic resources, environmental, scientific and technological collaboration and development, communication, culture, gender, and family in Israel or for academic work elsewhere in the field of Jewish Studies.',
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe('');
  });

  it('leaves an untargeted entity untouched', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: 'not-in-the-target-list',
      shortDescription: 'Funds independent study and research by Berkeley College students.',
      fullDescription: 'Funds independent study and research by Berkeley College students.',
    });
    expect(row.changed).toBe(false);
    expect(row.skipReason).toBe('not-targeted');
  });

  it('fails closed when the targeted entity no longer matches the audited text', () => {
    const row = planProgramCardAdminCopyRepairRow({
      id: '6a8bc3333bf820baddf7918d',
      shortDescription: 'Someone already edited this short description.',
      fullDescription: 'The European Studies Council travel/conference award helps defray research costs.',
    });
    expect(row.changed).toBe(false);
    expect(row.skipReason).toBe('stale-mismatch');
  });
});

describe('summarizeProgramCardAdminCopyRepair', () => {
  it('counts considered, targeted, changed, and stale-mismatch rows', () => {
    const rows = [
      planProgramCardAdminCopyRepairRow({
        id: '6a8bc3333bf820baddf7918d',
        shortDescription:
          'The European Studies Council travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students.',
        fullDescription:
          'The European Studies Council travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students. It helps defray short-term research or conference travel costs related to Europe, Russia, or Eurasia during the academic year.',
      }),
      planProgramCardAdminCopyRepairRow({
        id: 'not-in-the-target-list',
        shortDescription: 'Funds independent study and research by Berkeley College students.',
        fullDescription: 'Funds independent study and research by Berkeley College students.',
      }),
      planProgramCardAdminCopyRepairRow({
        id: '6a8bc3573bf820baddf7954d',
        shortDescription: 'This is not the audited text anymore.',
        fullDescription: 'The Council on Middle East Studies invites applications.',
      }),
    ];
    expect(summarizeProgramCardAdminCopyRepair(rows)).toEqual({
      considered: 3,
      targeted: 2,
      changed: 1,
      staleMismatch: 1,
    });
  });
});
