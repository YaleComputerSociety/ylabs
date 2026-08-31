/**
 * Unit tests for NehGrantScraper.
 *
 * No network, no Mongo - the NEH open-data fetch and the User finder are both
 * injected via the scraper constructor, so the tests exercise the full run()
 * path (fetch, schema check, Yale filtering, PI grouping, matching, observation
 * emission, fail-closed behavior) deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  NehGrantScraper,
  decadeFilesForLookback,
  grantToRecord,
  groupGrantsByLeadPi,
  hasRequiredNehHeaders,
  isYaleAwardee,
  leadParticipant,
  maxStartDate,
  nehGrantUrl,
  parseCsvRows,
  parseNehAmount,
  parseNehCsv,
  parseNehDate,
  parseParticipants,
  parseYear,
  piGroupKey,
  piSlug,
  recordToNehGrant,
  sortGrantsByRecency,
} from '../sources/nehGrantScraper';
import type { ObservationInput, ScraperContext } from '../types';

const HEADER =
  'AppNumber,Institution,InstState,YearAwarded,ProjectTitle,Program,Division,AwardOutright,OriginalAmount,BeginGrant,EndGrant,ProjectDesc,ToSupport,PrimaryDiscipline,Disciplines,Participants';

function csvRow(fields: Record<string, string>): string {
  const order = [
    'AppNumber',
    'Institution',
    'InstState',
    'YearAwarded',
    'ProjectTitle',
    'Program',
    'Division',
    'AwardOutright',
    'OriginalAmount',
    'BeginGrant',
    'EndGrant',
    'ProjectDesc',
    'ToSupport',
    'PrimaryDiscipline',
    'Disciplines',
    'Participants',
  ];
  return order
    .map((key) => {
      const value = fields[key] ?? '';
      return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    })
    .join(',');
}

const YALE_FELLOWSHIP = {
  AppNumber: 'FEL-268066-20',
  Institution: 'Yale University',
  InstState: 'CT',
  YearAwarded: '2022',
  ProjectTitle: 'Russian Filmmaker Evgenii Bauer: Cinema and Genealogies',
  Program: 'Fellowships',
  Division: 'Research Programs',
  AwardOutright: '60000.0000',
  OriginalAmount: '60000.0000',
  BeginGrant: '7/1/2022 12:00:00 AM',
  EndGrant: '6/30/2023 12:00:00 AM',
  ProjectDesc: 'Research and writing, leading to a book\nabout early Russian cinema.',
  ToSupport: 'Research and writing leading to a book.',
  PrimaryDiscipline: 'Film History and Criticism',
  Disciplines: 'Arts, General; Film History and Criticism',
  Participants: 'Oksana Director [Project Director]',
};

const YALE_COLLAB = {
  AppNumber: 'RZ-279836-22',
  Institution: 'Yale University',
  InstState: 'CT',
  YearAwarded: '2021',
  ProjectTitle: 'Recovering Black Performance in Early Modern Iberia',
  Program: 'Collaborative Research',
  Division: 'Research Programs',
  AwardOutright: '46817.3500',
  OriginalAmount: '46817.3500',
  BeginGrant: '10/1/2021 12:00:00 AM',
  EndGrant: '6/30/2024 12:00:00 AM',
  ProjectDesc: 'Planning and holding a conference on Black performance.',
  ToSupport: 'A conference and edited volume.',
  PrimaryDiscipline: 'Theater History and Criticism',
  Disciplines: 'Renaissance Studies; Theater History and Criticism',
  Participants: 'Nicholas Lead [Project Director]; Elizabeth Second [Co Project Director]',
};

const NON_YALE = {
  ...YALE_FELLOWSHIP,
  AppNumber: 'FEL-999999-20',
  Institution: 'Harvard University',
  InstState: 'MA',
  Participants: 'Someone Else [Project Director]',
};

const YALE_OUT_OF_STATE = {
  ...YALE_FELLOWSHIP,
  AppNumber: 'FEL-888888-20',
  Institution: 'Yale-NUS College',
  InstState: 'SG',
  Participants: 'Overseas Person [Project Director]',
};

function buildCsv(rows: Array<Record<string, string>>): string {
  return [HEADER, ...rows.map(csvRow)].join('\n') + '\n';
}

describe('parseCsvRows', () => {
  it('handles quoted fields with embedded commas and newlines', () => {
    const rows = parseCsvRows('a,b\n"x,y","line1\nline2"\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['x,y', 'line1\nline2']);
  });
  it('unescapes doubled quotes', () => {
    const rows = parseCsvRows('h\n"say ""hi"""\n');
    expect(rows[1]).toEqual(['say "hi"']);
  });
});

describe('parseNehCsv + hasRequiredNehHeaders', () => {
  it('parses a Yale row into a normalized record', () => {
    const { records, headers } = parseNehCsv(buildCsv([YALE_FELLOWSHIP]));
    expect(hasRequiredNehHeaders(headers)).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].appnumber).toBe('FEL-268066-20');
    expect(records[0].projectdesc).toContain('early Russian cinema');
  });
  it('flags schema drift when a required column is absent', () => {
    const drifted = buildCsv([YALE_FELLOWSHIP]).replace('Participants', 'Contributors');
    const { headers } = parseNehCsv(drifted);
    expect(hasRequiredNehHeaders(headers)).toBe(false);
  });
});

describe('parseNehDate', () => {
  it('parses NEH datetime and plain m/d/yyyy', () => {
    expect(parseNehDate('7/1/2022 12:00:00 AM')?.toISOString().slice(0, 10)).toBe('2022-07-01');
    expect(parseNehDate('10/1/2021')?.toISOString().slice(0, 10)).toBe('2021-10-01');
  });
  it('returns undefined for blank or malformed', () => {
    expect(parseNehDate('')).toBeUndefined();
    expect(parseNehDate(null)).toBeUndefined();
    expect(parseNehDate('2021-10-01')).toBeUndefined();
  });
});

describe('parseNehAmount', () => {
  it('parses fixed-point dollar strings', () => {
    expect(parseNehAmount('60000.0000')).toBe(60000);
    expect(parseNehAmount('46817.3500')).toBeCloseTo(46817.35);
  });
  it('returns undefined for blank or zero', () => {
    expect(parseNehAmount('')).toBeUndefined();
    expect(parseNehAmount('0.0000')).toBeUndefined();
    expect(parseNehAmount(null)).toBeUndefined();
  });
});

describe('parseYear', () => {
  it('extracts a 4-digit year', () => {
    expect(parseYear('2022')).toBe(2022);
  });
  it('returns undefined when no year present', () => {
    expect(parseYear('n/a')).toBeUndefined();
    expect(parseYear(undefined)).toBeUndefined();
  });
});

describe('parseParticipants', () => {
  it('parses a single Project Director', () => {
    expect(parseParticipants('Oksana Director [Project Director]')).toEqual([
      { fullName: 'Oksana Director', role: 'Project Director', isLead: true, isCoLead: false },
    ]);
  });
  it('parses lead + co-lead', () => {
    const parsed = parseParticipants(
      'Nicholas Lead [Project Director]; Elizabeth Second [Co Project Director]',
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].isLead).toBe(true);
    expect(parsed[1].isCoLead).toBe(true);
  });
  it('treats an unlabeled participant as a non-lead name', () => {
    const parsed = parseParticipants('Just Name');
    expect(parsed[0]).toEqual({ fullName: 'Just Name', role: '', isLead: false, isCoLead: false });
  });
  it('returns [] for blank', () => {
    expect(parseParticipants('')).toEqual([]);
    expect(parseParticipants(null)).toEqual([]);
  });
});

describe('leadParticipant', () => {
  it('prefers the labeled Project Director', () => {
    const parts = parseParticipants('A Co [Co Project Director]; B Lead [Project Director]');
    expect(leadParticipant(parts)?.fullName).toBe('B Lead');
  });
  it('falls back to the first participant when none is labeled lead', () => {
    const parts = parseParticipants('A First [Consultant]; B Second [Consultant]');
    expect(leadParticipant(parts)?.fullName).toBe('A First');
  });
});

describe('isYaleAwardee', () => {
  it('accepts Yale University in CT', () => {
    expect(isYaleAwardee({ institution: 'Yale University', inststate: 'CT' })).toBe(true);
  });
  it('rejects a non-Yale institution', () => {
    expect(isYaleAwardee({ institution: 'Harvard University', inststate: 'MA' })).toBe(false);
  });
  it('rejects a Yale-named org outside CT', () => {
    expect(isYaleAwardee({ institution: 'Yale-NUS College', inststate: 'SG' })).toBe(false);
  });
});

describe('recordToNehGrant', () => {
  it('maps a record into a typed grant', () => {
    const { records } = parseNehCsv(buildCsv([YALE_COLLAB]));
    const grant = recordToNehGrant(records[0])!;
    expect(grant.appNumber).toBe('RZ-279836-22');
    expect(grant.yearAwarded).toBe(2021);
    expect(grant.awardOutright).toBeCloseTo(46817.35);
    expect(grant.disciplines).toEqual(['Renaissance Studies', 'Theater History and Criticism']);
    expect(grant.participants).toHaveLength(2);
  });
  it('returns null with no app number, title, or participants', () => {
    expect(
      recordToNehGrant({ appnumber: '', projecttitle: 'x', participants: 'A [Project Director]' }),
    ).toBeNull();
    expect(
      recordToNehGrant({ appnumber: 'x', projecttitle: '', participants: 'A [Project Director]' }),
    ).toBeNull();
    expect(recordToNehGrant({ appnumber: 'x', projecttitle: 'y', participants: '' })).toBeNull();
  });
});

describe('groupGrantsByLeadPi', () => {
  it('groups awards by their lead Project Director', () => {
    const g1 = recordToNehGrant(parseNehCsv(buildCsv([YALE_FELLOWSHIP])).records[0])!;
    const g2 = recordToNehGrant(
      parseNehCsv(buildCsv([{ ...YALE_FELLOWSHIP, AppNumber: 'FEL-2' }])).records[0],
    )!;
    const g3 = recordToNehGrant(parseNehCsv(buildCsv([YALE_COLLAB])).records[0])!;
    const groups = groupGrantsByLeadPi([g1, g2, g3]);
    expect(groups).toHaveLength(2);
    const oksana = groups.find((g) => g.piLastName === 'Director');
    expect(oksana!.awards).toHaveLength(2);
  });
});

describe('grantToRecord', () => {
  it('normalizes a grant into a recentGrants subdocument', () => {
    const grant = recordToNehGrant(parseNehCsv(buildCsv([YALE_FELLOWSHIP])).records[0])!;
    const rec = grantToRecord(grant);
    expect(rec.agency).toBe('NEH');
    expect(rec.id).toBe('FEL-268066-20');
    expect(rec.dollarAmount).toBe(60000);
    expect(rec.url).toBe(nehGrantUrl('FEL-268066-20'));
    expect(rec.startDate?.toISOString().slice(0, 10)).toBe('2022-07-01');
  });
  it('falls back to ToSupport when ProjectDesc is empty', () => {
    const grant = recordToNehGrant(
      parseNehCsv(buildCsv([{ ...YALE_FELLOWSHIP, ProjectDesc: '' }])).records[0],
    )!;
    expect(grantToRecord(grant).abstract).toBe('Research and writing leading to a book.');
  });
});

describe('sortGrantsByRecency / maxStartDate', () => {
  it('sorts most-recent-first and finds the latest start', () => {
    const early = recordToNehGrant(
      parseNehCsv(buildCsv([{ ...YALE_FELLOWSHIP, AppNumber: 'E', BeginGrant: '1/1/2020' }]))
        .records[0],
    )!;
    const late = recordToNehGrant(
      parseNehCsv(buildCsv([{ ...YALE_FELLOWSHIP, AppNumber: 'L', BeginGrant: '1/1/2024' }]))
        .records[0],
    )!;
    const sorted = sortGrantsByRecency([early, late].map((g) => grantToRecord(g)));
    expect(sorted.map((r) => r.id)).toEqual(['L', 'E']);
    expect(maxStartDate([early, late])?.getFullYear()).toBe(2024);
  });
});

describe('decadeFilesForLookback', () => {
  it('returns the single current-decade file for an in-decade window', () => {
    expect(decadeFilesForLookback(2026, 6)).toEqual(['NEH_Grants2020s.csv']);
  });
  it('includes the prior decade when the window straddles a boundary', () => {
    expect(decadeFilesForLookback(2023, 6)).toEqual(['NEH_Grants2010s.csv', 'NEH_Grants2020s.csv']);
  });
});

describe('piSlug / piGroupKey', () => {
  it('uses the user id when matched', () => {
    expect(piSlug('507f1f77bcf86cd799439011', 'A', 'B')).toBe('neh-pi-507f1f77bcf86cd799439011');
  });
  it('falls back to a name-based slug when unmatched', () => {
    expect(piSlug(null, 'Oksana', 'Director')).toBe('neh-pi-oksana-director');
  });
  it('normalizes the group key', () => {
    expect(piGroupKey('OKSANA', 'Director')).toBe('oksana director');
  });
});

function buildContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'neh-funded-projects',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false, ...overrides },
    emit: async (input) => {
      const arr = Array.isArray(input) ? input : [input];
      for (const o of arr) emitted.push(o);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

describe('NehGrantScraper.run', () => {
  it('filters non-Yale and out-of-state rows before grouping', async () => {
    const fetchDecadeCsv = vi.fn(async () =>
      buildCsv([YALE_FELLOWSHIP, NON_YALE, YALE_OUT_OF_STATE]),
    );
    const resolveResearcherId = async () => ({ status: 'absent' as const });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(1);
    const names = emitted.filter((o) => o.field === 'name').map((o) => o.value);
    expect(names).toEqual(['Oksana Director Research']);
  });

  it('mints a humanities FACULTY_PROJECT shell for an unmatched PI (never a STEM LAB)', async () => {
    const fetchDecadeCsv = vi.fn(async () => buildCsv([YALE_FELLOWSHIP]));
    const resolveResearcherId = async () => ({ status: 'absent' as const });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const rg = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(rg.find((o) => o.field === 'entityType')?.value).toBe('FACULTY_PROJECT');
    expect(rg.find((o) => o.field === 'kind')?.value).toBe('individual');
    const nameObs = rg.find((o) => o.field === 'name');
    expect(String(nameObs?.value)).toMatch(/ Research$/);
    expect(nameObs?.confidenceOverride).toBe(0.3);
    expect(rg.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['NEH']);
    expect(rg.find((o) => o.field === 'recentGrantCount')?.value).toBe(1);
    const emittedFields = new Set(emitted.map((o) => o.field.toLowerCase()));
    for (const forbidden of ['signal', 'pathway', 'opportunity', 'accesssignal', 'contactroute']) {
      expect([...emittedFields].some((f) => f.includes(forbidden))).toBe(false);
    }
  });

  it('self-attaches a matched PI to a canonical home without minting identity fields', async () => {
    const fetchDecadeCsv = vi.fn(async () => buildCsv([YALE_FELLOWSHIP]));
    const researchHomeResolver = vi
      .fn()
      .mockResolvedValue({ status: 'canonical', slug: 'dept-film-oksana-director' });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId: async () => ({
        status: 'matched' as const,
        researcherId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      }),
      researchHomeResolver,
      currentYear: 2026,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const rg = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(researchHomeResolver).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(rg.every((o) => o.entityKey === 'dept-film-oksana-director')).toBe(true);
    expect(rg.find((o) => o.field === 'slug')).toBeUndefined();
    expect(rg.find((o) => o.field === 'name')).toBeUndefined();
    expect(rg.find((o) => o.field === 'kind')).toBeUndefined();
    expect(rg.find((o) => o.field === 'entityType')).toBeUndefined();
    expect(rg.find((o) => o.field === 'recentGrants')).toBeDefined();
    expect(rg.find((o) => o.field === 'inferredPiUserId')?.value).toBe('507f1f77bcf86cd799439011');
  });

  it('emits co-PI members only for Yale-resolvable Co Project Directors', async () => {
    const fetchDecadeCsv = vi.fn(async () => buildCsv([YALE_COLLAB]));
    const eliz = new mongoose.Types.ObjectId();
    const resolveResearcherId = async (name: string) =>
      /second/i.test(name)
        ? { status: 'matched' as const, researcherId: eliz }
        : { status: 'absent' as const };
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const members = emitted.filter((o) => o.entityType === 'researchGroupMember');
    expect(members.filter((o) => o.field === 'userId').map((o) => o.value)).toEqual([
      eliz.toString(),
    ]);
    expect(members.filter((o) => o.field === 'role').every((o) => o.value === 'co-pi')).toBe(true);
  });

  it('drops awards older than the lookback cutoff', async () => {
    const stale = { ...YALE_FELLOWSHIP, AppNumber: 'OLD', YearAwarded: '2005' };
    const fetchDecadeCsv = vi.fn(async () => buildCsv([stale]));
    const resolveResearcherId = async () => ({ status: 'absent' as const });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
      lookbackYears: 6,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it('fails closed with no writes when no file is reachable', async () => {
    const fetchDecadeCsv = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const resolveResearcherId = async () => ({ status: 'absent' as const });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(logs.some((l) => /unreachable|fail closed/i.test(l))).toBe(true);
  });

  it('fails closed with no writes on schema drift', async () => {
    const drifted = buildCsv([YALE_FELLOWSHIP]).replace('Participants', 'Contributors');
    const fetchDecadeCsv = vi.fn(async () => drifted);
    const resolveResearcherId = async () => ({ status: 'absent' as const });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(logs.some((l) => /schema drift|fail closed/i.test(l))).toBe(true);
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchDecadeCsv = vi.fn(async () => buildCsv([YALE_FELLOWSHIP]));
    const scraper = new NehGrantScraper({ fetchDecadeCsv: fetchDecadeCsv as any });
    const { ctx } = buildContext({ limit: 9007199254740992 } as any);
    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchDecadeCsv).not.toHaveBeenCalled();
  });

  it('honors --limit by capping PIs processed', async () => {
    const rows = Array.from({ length: 5 }, (_v, i) => ({
      ...YALE_FELLOWSHIP,
      AppNumber: `A-${i}`,
      Participants: `First${i} Last${i} [Project Director]`,
    }));
    const fetchDecadeCsv = vi.fn(async () => buildCsv(rows));
    const resolveResearcherId = async () => ({ status: 'absent' as const });
    const scraper = new NehGrantScraper({
      fetchDecadeCsv: fetchDecadeCsv as any,
      resolveResearcherId,
      currentYear: 2026,
    });
    const { ctx } = buildContext({ limit: 2 });
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(2);
  });
});
