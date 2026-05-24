import { describe, expect, it } from 'vitest';
import {
  applyOrcidCrosswalkCsv,
  applyScholarAcceptedCsv,
  buildScholarCandidateRows,
  exportFellowshipAcceptedCsv,
  normalizeOrcid,
  resolveOrcidCrosswalk,
  validateArxivOrcidList,
  validateFellowshipAcceptedCsv,
  validateScholarAcceptedCsv,
  type AcceptedInputUser,
} from '../acceptedInputsCore';

const advisorOne: AcceptedInputUser = {
  _id: 'u-advisor-one',
  netid: 'fixture1',
  email: 'fixture.advisor.one@yale.edu',
  fname: 'Fixture',
  lname: 'Advisor One',
  userType: 'faculty',
  orcid: '0000-0000-0000-001X',
  primaryDepartment: 'Mathematics',
  profileVerified: true,
  profileUrls: {
    yale: 'https://math.yale.edu/people/fixture-advisor-one',
  },
  scholarCandidateProfileUrls: ['https://scholar.google.com/citations?user=fixtureCandidateOne'],
};

const advisorTwo: AcceptedInputUser = {
  _id: 'u-advisor-two',
  netid: 'fixture2',
  email: 'fixture.advisor.two@yale.edu',
  fname: 'Fixture',
  lname: 'Advisor Two',
  userType: 'professor',
  primaryDepartment: 'Computer Science',
  profileVerified: true,
  profileUrls: {
    yale: 'https://cpsc.yale.edu/people/fixture-advisor-two',
  },
};

const noYaleEvidence: AcceptedInputUser = {
  _id: 'u-outside',
  email: 'outside@example.edu',
  fname: 'External',
  lname: 'Fixture',
  userType: 'faculty',
};

describe('normalizeOrcid', () => {
  it('normalizes ORCID URLs and compact strings', () => {
    expect(normalizeOrcid('https://orcid.org/0000-0000-0000-001X')).toBe(
      '0000-0000-0000-001X',
    );
    expect(normalizeOrcid('000000000000001X')).toBe('0000-0000-0000-001X');
  });

  it('rejects invalid checksum values', () => {
    expect(normalizeOrcid('0000-0000-0000-0010')).toBeNull();
  });

  it('supports X check digits', () => {
    expect(normalizeOrcid('0000-0000-0000-001X')).toBe('0000-0000-0000-001X');
  });
});

describe('resolveOrcidCrosswalk', () => {
  it('matches an ORCID already attached to one Yale-confirmed user', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-001X', [advisorOne]);
    expect(result.status).toBe('matched-existing');
    expect(result.userSummary?.name).toBe('Fixture Advisor One');
    expect(result.canPersist).toBe(false);
  });

  it('reports ambiguous ORCID matches', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-001X', [
      advisorOne,
      { ...advisorOne, _id: 'u-advisor-one-duplicate', netid: 'fixture1b' },
    ]);
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('reports missing crosswalks without creating users', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0028', [advisorOne]);
    expect(result.status).toBe('unresolved');
    expect(result.user).toBeUndefined();
  });

  it('finds a newly persistable ORCID through Yale-backed email evidence', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0028', [advisorTwo], {
      email: 'fixture.advisor.two@yale.edu',
      sourceUrl: 'https://directory.yale.edu/people/fixture-advisor-two',
      reviewNote: 'ORCID listed on official profile evidence',
    });
    expect(result.status).toBe('matched-new');
    expect(result.canPersist).toBe(true);
    expect(result.userSummary?.diagnosticNetid).toBe('fixture2');
  });

  it('does not persist ORCID to non-Yale identities', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0028', [noYaleEvidence], {
      email: 'outside@example.edu',
      sourceUrl: 'https://example.edu/people/outside',
    });
    expect(result.status).toBe('unresolved');
    expect(result.canPersist).toBe(false);
  });
});

describe('fellowship accepted CSV validation', () => {
  it('accepts advisorOrcid rows that resolve to Yale users', () => {
    const csv = [
      'advisorOrcid,year,studentName,projectTitle',
      'https://orcid.org/0000-0000-0000-001X,2024,Fixture Student Three,Riboswitch dynamics',
    ].join('\n');
    const result = validateFellowshipAcceptedCsv('stars-ii', csv, [advisorOne]);
    expect(result.status).toBe('ready');
    expect(result.readyRows).toBe(1);
  });

  it('accepts source-backed manual fallback rows without ORCID', () => {
    const csv = [
      'advisorName,sourceUrl,reviewNote,awardYear',
      'Fixture Advisor Two,https://science.yale.edu/fellowship.pdf,official PDF row,2024',
    ].join('\n');
    const result = validateFellowshipAcceptedCsv('stars-summer', csv, []);
    expect(result.status).toBe('ready');
    expect(result.readyRows).toBe(1);
  });

  it('blocks rows without ORCID or source-backed review provenance', () => {
    const csv = ['advisorName,awardYear', 'Fixture Advisor Two,2024'].join('\n');
    const result = validateFellowshipAcceptedCsv('stars-summer', csv, []);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].message).toMatch(/advisorName, sourceUrl, and reviewNote/);
  });

  it('exports scraper-compatible rows and fills advisorName from resolved ORCID', () => {
    const csv = [
      'advisorOrcid,year,studentName',
      '0000-0000-0000-001X,2024,Fixture Student Three',
    ].join('\n');
    const result = exportFellowshipAcceptedCsv('stars-ii', csv, [advisorOne]);
    expect(result.exportedRows).toBe(1);
    expect(result.csv).toContain('Fixture Advisor One,0000-0000-0000-001X,2024');
  });
});

describe('Scholar accepted CSV', () => {
  it('generates review candidates with official Yale and Scholar evidence columns', () => {
    const rows = buildScholarCandidateRows([advisorOne]);

    expect(rows[0]).toMatchObject({
      orcid: '0000-0000-0000-001X',
      name: 'Fixture Advisor One',
      primaryDepartment: 'Mathematics',
      yaleProfileUrl: 'https://math.yale.edu/people/fixture-advisor-one',
      officialScholarCandidateUrl: 'https://scholar.google.com/citations?user=fixtureCandidateOne',
      googleScholarId: '',
      profileUrl: '',
      reviewNote: '',
    });
  });

  it('validates Scholar accepted rows by ORCID', () => {
    const csv = [
      'orcid,googleScholarId,profileUrl,reviewNote',
      '0000-0000-0000-001X,fixtureScholar123,https://scholar.google.com/citations?user=fixtureScholar123,manual ORCID match',
    ].join('\n');
    const result = validateScholarAcceptedCsv(csv, [advisorOne]);
    expect(result.status).toBe('ready');
    expect(result.ready[0].googleScholarId).toBe('fixtureScholar123');
  });

  it('applies accepted Scholar IDs as manual locks', async () => {
    const csv = [
      'orcid,googleScholarId,profileUrl,reviewNote',
      '0000-0000-0000-001X,fixtureScholar123,https://scholar.google.com/citations?user=fixtureScholar123,manual ORCID match',
    ].join('\n');
    const updates: Array<{ userId: unknown; update: Record<string, unknown> }> = [];
    const result = await applyScholarAcceptedCsv(csv, [advisorOne], {
      dryRun: false,
      updateUser: async (userId, update) => {
        updates.push({ userId, update });
      },
    });
    const update = updates[0].update as {
      $set: Record<string, unknown>;
      $addToSet: Record<string, unknown>;
    };

    expect(result.appliedRows).toBe(1);
    expect(updates[0].userId).toBe('u-advisor-one');
    expect(update.$set.googleScholarId).toBe('fixtureScholar123');
    expect(update.$addToSet.manuallyLockedFields).toBe('googleScholarId');
  });
});

describe('ORCID crosswalk apply', () => {
  it('persists ORCID only when crosswalk evidence is unambiguous and Yale-backed', async () => {
    const csv = [
      'orcid,yaleEmail,sourceUrl,reviewNote',
      '0000-0000-0000-0028,fixture.advisor.two@yale.edu,https://directory.yale.edu/people/fixture-advisor-two,official profile match',
    ].join('\n');
    const updates: Array<{ userId: unknown; update: Record<string, unknown> }> = [];
    const result = await applyOrcidCrosswalkCsv(csv, [advisorTwo], {
      dryRun: false,
      updateUser: async (userId, update) => {
        updates.push({ userId, update });
      },
    });
    const update = updates[0].update as { $set: Record<string, unknown> };

    expect(result.appliedRows).toBe(1);
    expect(updates[0].userId).toBe('u-advisor-two');
    expect(update.$set.orcid).toBe('0000-0000-0000-0028');
  });
});

describe('arXiv accepted ORCID validation', () => {
  it('converts accepted ORCIDs to current scraper-compatible internal targets', () => {
    const advisorTwoWithOrcid: AcceptedInputUser = {
      ...advisorTwo,
      orcid: '0000-0000-0000-0028',
      primaryDepartment: 'Physics',
    };
    const result = validateArxivOrcidList(
      [
        '# comments allowed',
        '0000-0000-0000-001X # Fixture Advisor One',
        '0000-0000-0000-0028',
      ].join('\n'),
      [advisorOne, advisorTwoWithOrcid],
    );

    expect(result.status).toBe('ready');
    expect(result.readyRows).toBe(2);
    expect(result.scraperOnlyValues).toEqual(['fixture1', 'fixture2']);
  });

  it('blocks unresolved ORCIDs instead of creating users', () => {
    const result = validateArxivOrcidList('0000-0000-0000-0028', [advisorOne]);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].status).toBe('unresolved');
  });
});
