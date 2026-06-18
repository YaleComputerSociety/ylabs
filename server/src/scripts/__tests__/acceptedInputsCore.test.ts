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

const ada: AcceptedInputUser = {
  _id: 'u-ada',
  netid: 'ada1',
  email: 'ada@yale.edu',
  fname: 'Ada',
  lname: 'Lovelace',
  userType: 'faculty',
  orcid: '0000-0000-0000-0003',
  primaryDepartment: 'Mathematics',
  profileVerified: true,
  profileUrls: {
    yale: 'https://math.yale.edu/people/ada-lovelace',
  },
  scholarCandidateProfileUrls: ['https://scholar.google.com/citations?user=adaCandidate'],
};

const grace: AcceptedInputUser = {
  _id: 'u-grace',
  netid: 'grace1',
  email: 'grace@yale.edu',
  fname: 'Grace',
  lname: 'Hopper',
  userType: 'professor',
  primaryDepartment: 'Computer Science',
  profileVerified: true,
  profileUrls: {
    yale: 'https://cpsc.yale.edu/people/grace-hopper',
  },
};

const noYaleEvidence: AcceptedInputUser = {
  _id: 'u-outside',
  email: 'outside@example.edu',
  fname: 'Outside',
  lname: 'Researcher',
  userType: 'faculty',
};

describe('normalizeOrcid', () => {
  it('normalizes ORCID URLs and compact strings', () => {
    expect(normalizeOrcid('https://orcid.org/0000-0000-0000-0003')).toBe(
      '0000-0000-0000-0003',
    );
    expect(normalizeOrcid('0000000218250097')).toBe('0000-0000-0000-0003');
  });

  it('rejects invalid checksum values', () => {
    expect(normalizeOrcid('0000-0002-1825-0098')).toBeNull();
  });

  it('supports X check digits', () => {
    expect(normalizeOrcid('0000-0000-0000-001X')).toBe('0000-0000-0000-001X');
  });
});

describe('resolveOrcidCrosswalk', () => {
  it('matches an ORCID already attached to one Yale-confirmed user', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0003', [ada]);
    expect(result.status).toBe('matched-existing');
    expect(result.userSummary?.name).toBe('Ada Lovelace');
    expect(result.canPersist).toBe(false);
  });

  it('reports ambiguous ORCID matches', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0003', [
      ada,
      { ...ada, _id: 'u-ada-duplicate', netid: 'ada2' },
    ]);
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('reports missing crosswalks without creating users', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0004', [ada]);
    expect(result.status).toBe('unresolved');
    expect(result.user).toBeUndefined();
  });

  it('finds a newly persistable ORCID through Yale-backed email evidence', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0004', [grace], {
      email: 'grace@yale.edu',
      sourceUrl: 'https://directory.yale.edu/people/grace-hopper',
      reviewNote: 'ORCID listed on official profile evidence',
    });
    expect(result.status).toBe('matched-new');
    expect(result.canPersist).toBe(true);
    expect(result.userSummary?.diagnosticNetid).toBe('grace1');
  });

  it('does not persist ORCID to non-Yale identities', () => {
    const result = resolveOrcidCrosswalk('0000-0000-0000-0004', [noYaleEvidence], {
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
      'https://orcid.org/0000-0000-0000-0003,2024,Alice Liu,Riboswitch dynamics',
    ].join('\n');
    const result = validateFellowshipAcceptedCsv('stars-ii', csv, [ada]);
    expect(result.status).toBe('ready');
    expect(result.readyRows).toBe(1);
  });

  it('accepts source-backed manual fallback rows without ORCID', () => {
    const csv = [
      'advisorName,sourceUrl,reviewNote,awardYear',
      'Grace Hopper,https://science.yale.edu/fellowship.pdf,official PDF row,2024',
    ].join('\n');
    const result = validateFellowshipAcceptedCsv('stars-summer', csv, []);
    expect(result.status).toBe('ready');
    expect(result.readyRows).toBe(1);
  });

  it('blocks rows without ORCID or source-backed review provenance', () => {
    const csv = ['advisorName,awardYear', 'Grace Hopper,2024'].join('\n');
    const result = validateFellowshipAcceptedCsv('stars-summer', csv, []);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].message).toMatch(/advisorName, sourceUrl, and reviewNote/);
  });

  it('exports scraper-compatible rows and fills advisorName from resolved ORCID', () => {
    const csv = [
      'advisorOrcid,year,studentName',
      '0000-0000-0000-0003,2024,=Alice Liu',
    ].join('\n');
    const result = exportFellowshipAcceptedCsv('stars-ii', csv, [ada]);
    expect(result.exportedRows).toBe(1);
    expect(result.csv).toContain('Ada Lovelace,0000-0000-0000-0003,2024');
    expect(result.csv).toContain("'=Alice Liu");
  });
});

describe('Scholar accepted CSV', () => {
  it('generates review candidates with official Yale and Scholar evidence columns', () => {
    const rows = buildScholarCandidateRows([ada]);

    expect(rows[0]).toMatchObject({
      orcid: '0000-0000-0000-0003',
      name: 'Ada Lovelace',
      primaryDepartment: 'Mathematics',
      yaleProfileUrl: 'https://math.yale.edu/people/ada-lovelace',
      officialScholarCandidateUrl: 'https://scholar.google.com/citations?user=adaCandidate',
      googleScholarId: '',
      profileUrl: '',
      reviewNote: '',
    });
  });

  it('validates Scholar accepted rows by ORCID', () => {
    const csv = [
      'orcid,googleScholarId,profileUrl,reviewNote',
      '0000-0000-0000-0003,abc123,https://scholar.google.com/citations?user=abc123,manual ORCID match',
    ].join('\n');
    const result = validateScholarAcceptedCsv(csv, [ada]);
    expect(result.status).toBe('ready');
    expect(result.ready[0].googleScholarId).toBe('abc123');
  });

  it('applies accepted Scholar IDs as manual locks', async () => {
    const csv = [
      'orcid,googleScholarId,profileUrl,reviewNote',
      '0000-0000-0000-0003,abc123,https://scholar.google.com/citations?user=abc123,manual ORCID match',
    ].join('\n');
    const updates: Array<{ userId: unknown; update: Record<string, unknown> }> = [];
    const result = await applyScholarAcceptedCsv(csv, [ada], {
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
    expect(updates[0].userId).toBe('u-ada');
    expect(update.$set.googleScholarId).toBe('abc123');
    expect(update.$addToSet.manuallyLockedFields).toBe('googleScholarId');
  });
});

describe('ORCID crosswalk apply', () => {
  it('persists ORCID only when crosswalk evidence is unambiguous and Yale-backed', async () => {
    const csv = [
      'orcid,yaleEmail,sourceUrl,reviewNote',
      '0000-0000-0000-0004,grace@yale.edu,https://directory.yale.edu/people/grace-hopper,official profile match',
    ].join('\n');
    const updates: Array<{ userId: unknown; update: Record<string, unknown> }> = [];
    const result = await applyOrcidCrosswalkCsv(csv, [grace], {
      dryRun: false,
      updateUser: async (userId, update) => {
        updates.push({ userId, update });
      },
    });
    const update = updates[0].update as { $set: Record<string, unknown> };

    expect(result.appliedRows).toBe(1);
    expect(updates[0].userId).toBe('u-grace');
    expect(update.$set.orcid).toBe('0000-0000-0000-0004');
  });

  it('does not persist ORCID crosswalk rows backed only by credentialed URLs', async () => {
    const csv = [
      'orcid,name,sourceUrl,reviewNote',
      '0000-0000-0000-0004,Grace Hopper,https://user:pass@directory.yale.edu/people/grace-hopper,official profile match',
    ].join('\n');
    const updates: Array<{ userId: unknown; update: Record<string, unknown> }> = [];
    const result = await applyOrcidCrosswalkCsv(csv, [grace], {
      dryRun: false,
      updateUser: async (userId, update) => {
        updates.push({ userId, update });
      },
    });

    expect(result.appliedRows).toBe(0);
    expect(updates).toEqual([]);
  });
});

describe('arXiv accepted ORCID validation', () => {
  it('converts accepted ORCIDs to current scraper-compatible internal targets', () => {
    const graceWithOrcid: AcceptedInputUser = {
      ...grace,
      orcid: '0000-0000-0000-0004',
      primaryDepartment: 'Physics',
    };
    const result = validateArxivOrcidList(
      [
        '# comments allowed',
        '0000-0000-0000-0003 # Ada Lovelace',
        '0000-0000-0000-0004',
      ].join('\n'),
      [ada, graceWithOrcid],
    );

    expect(result.status).toBe('ready');
    expect(result.readyRows).toBe(2);
    expect(result.scraperOnlyValues).toEqual(['ada1', 'grace1']);
  });

  it('blocks unresolved ORCIDs instead of creating users', () => {
    const result = validateArxivOrcidList('0000-0000-0000-0004', [ada]);
    expect(result.status).toBe('blocked');
    expect(result.issues[0].status).toBe('unresolved');
  });
});
