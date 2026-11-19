import { describe, expect, it } from 'vitest';
import { officialProfilePageStatedFields } from '../../scrapers/sources/officialProfilePiBackfillScraper';
import {
  gluedAddressTwin,
  isGluedProfileTitle,
  isSkippedHost,
  planGluedProfileTextRetirement,
  readTargetPagesSequentially,
  selectGluedProfileTextTargets,
  type PageRead,
  type StoredProfileObservation,
} from '../retireGluedProfileTextCore';

const PAGE = 'https://eeb.example.edu/people/faculty/wren-halloway/';
const LOCKED_PAGE = 'https://medicine.example.edu/profile/wren-halloway/';

const user = (
  id: string,
  entityKey: string,
  field: string,
  value: unknown,
  sourceUrl = PAGE,
): StoredProfileObservation => ({ id, entityType: 'user', entityKey, field, value, sourceUrl });

const piKey = (id: string, value: string): StoredProfileObservation => ({
  id,
  entityType: 'researchEntity',
  entityKey: 'wren-halloway-lab',
  field: 'inferredPiUserKey',
  value,
  sourceUrl: PAGE,
});

const GLUED = 'biologywren.halloway1@yale.edu';
const CLEAN = 'wren.halloway1@yale.edu';

const laneObservations = (): StoredProfileObservation[] => [
  user('a1', 'netid:wh77', 'email', GLUED),
  user('a2', 'netid:wh77', 'title', 'Senior LecturerEcology and Evolutionary BiologyAddress'),
  user('p1', 'netid:biologywren.halloway1', 'email', GLUED),
  user('p2', 'netid:biologywren.halloway1', 'fname', 'Wren'),
  user('p3', 'netid:biologywren.halloway1', 'lname', 'Halloway'),
  user('p4', 'netid:biologywren.halloway1', 'netid', 'biologywren.halloway1'),
  user('p5', 'netid:biologywren.halloway1', 'profileUrls', { official: PAGE }),
  user('r1', 'netid:wh77', 'email', CLEAN),
  piKey('k1', 'biologywren.halloway1'),
  user('n1', 'netid:ab12', 'email', 'a.bystander1@yale.edu', 'https://other.example.edu/a/'),
  user('n2', 'netid:ab12', 'title', 'Professor of Geology', 'https://other.example.edu/a/'),
];

const targets = () =>
  selectGluedProfileTextTargets({
    laneObservations: laneObservations(),
    otherAddressesBySubject: new Map([['netid:wh77', new Set([CLEAN])]]),
    otherAddressesByPage: new Map([[PAGE, new Set([GLUED, CLEAN])]]),
  });

const FIXED_PAGE: PageRead = {
  status: 'read',
  reading: { email: CLEAN, title: 'Senior Lecturer' },
};

describe('glued profile text predicates (#5720)', () => {
  it('finds the address a department word was fused onto', () => {
    expect(gluedAddressTwin(GLUED, new Set([CLEAN]))).toBe(CLEAN);
    expect(gluedAddressTwin(CLEAN, new Set(['halloway1@yale.edu']))).toBe('');
    expect(gluedAddressTwin('wh.halloway1@yale.edu', new Set(['halloway1@yale.edu']))).toBe('');
  });

  it('flags a title that absorbed a neighbouring field and leaves a clean one', () => {
    expect(isGluedProfileTitle('Professor of BiologyAddress')).toBe(true);
    expect(isGluedProfileTitle('Lecturer wren@yale.edu')).toBe(true);
    expect(isGluedProfileTitle('Lecturer Office: 21 Sachem St')).toBe(true);
    expect(isGluedProfileTitle('Professor of Geology')).toBe(false);
    expect(isGluedProfileTitle('MPH, PhD, Assistant Professor')).toBe(false);
    expect(isGluedProfileTitle('McAllister Professor')).toBe(false);
  });

  it('selects the glued email, the glued title and the phantom subject, and nothing clean', () => {
    const [page, ...rest] = targets();
    expect(rest).toEqual([]);
    expect(page.emails.map((row) => row.id).sort()).toEqual(['a1', 'p1']);
    expect(page.titles.map((row) => row.id)).toEqual(['a2']);
    expect(page.phantoms).toEqual([
      {
        netid: 'biologywren.halloway1',
        userObservationIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
        piKeyObservationIds: ['k1'],
      },
    ]);
  });
});

describe('planGluedProfileTextRetirement', () => {
  it('retires exactly the glued observations when the fixed page no longer yields them', () => {
    const plan = planGluedProfileTextRetirement(targets(), new Map([[PAGE, FIXED_PAGE]]));
    expect(plan.observationIdsToRetire).toEqual(['a1', 'a2', 'k1', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(plan.counts).toMatchObject({
      pagesFetched: 1,
      emailRetired: 2,
      titleRetired: 1,
      phantomSubjectObservationsRetired: 6,
      distinctObservationsToRetire: 8,
    });
  });

  it('keeps an observation the page still yields', () => {
    const plan = planGluedProfileTextRetirement(
      targets(),
      new Map<string, PageRead>([
        [
          PAGE,
          {
            status: 'read',
            reading: {
              email: GLUED,
              title: 'Senior LecturerEcology and Evolutionary BiologyAddress',
            },
          },
        ],
      ]),
    );
    expect(plan.observationIdsToRetire).toEqual([]);
    expect(plan.counts).toMatchObject({
      emailKept: 2,
      titleKept: 1,
      phantomSubjectObservationsKept: 6,
    });
  });

  it('retires nothing for a page whose read failed', () => {
    const plan = planGluedProfileTextRetirement(targets(), new Map([[PAGE, { status: 'failed' }]]));
    expect(plan.observationIdsToRetire).toEqual([]);
    expect(plan.counts.pagesFailed).toBe(1);
  });

  it('counts a host-locked page as deferred and retires nothing on it', () => {
    const plan = planGluedProfileTextRetirement(
      targets(),
      new Map([[PAGE, { status: 'deferred' }]]),
    );
    expect(plan.observationIdsToRetire).toEqual([]);
    expect(plan.counts).toMatchObject({
      pagesDeferred: 1,
      deferredEmail: 2,
      deferredTitle: 1,
      deferredPhantomSubjectObservations: 6,
    });
  });

  it('decides a phantom observation by the read of the page it cites', () => {
    const lockedTargets = selectGluedProfileTextTargets({
      laneObservations: [
        ...laneObservations(),
        user(
          'p6',
          'netid:biologywren.halloway1',
          'profileUrls',
          { official: LOCKED_PAGE },
          LOCKED_PAGE,
        ),
      ],
      otherAddressesBySubject: new Map([['netid:wh77', new Set([CLEAN])]]),
      otherAddressesByPage: new Map([[PAGE, new Set([GLUED, CLEAN])]]),
    });
    const plan = planGluedProfileTextRetirement(
      lockedTargets,
      new Map<string, PageRead>([
        [PAGE, FIXED_PAGE],
        [LOCKED_PAGE, { status: 'deferred' }],
      ]),
    );
    expect(plan.observationIdsToRetire).not.toContain('p6');
    expect(plan.counts).toMatchObject({
      phantomSubjectObservationCandidates: 7,
      phantomSubjectObservationsRetired: 6,
      deferredPhantomSubjectObservations: 1,
    });
  });

  it('reads the fixed lane extractor the way the planner compares it', () => {
    const html = `<html><body><main>
      <h1>Wren Halloway</h1>
      <div class="profile-title">Senior Lecturer</div>
      <div class="contact"><div>Ecology and Evolutionary Biology</div><div>${CLEAN}</div></div>
    </main></body></html>`;
    expect(officialProfilePageStatedFields(html).email).toBe(CLEAN);
  });
});

describe('readTargetPagesSequentially', () => {
  it('never requests a skipped host and reads the rest one at a time', async () => {
    const requested: string[] = [];
    let inFlight = 0;
    const locked = { sourceUrl: LOCKED_PAGE, emails: [], titles: [], phantoms: [] };
    const reads = await readTargetPagesSequentially([...targets(), locked], {
      fetchHtml: async (url) => {
        inFlight += 1;
        expect(inFlight).toBe(1);
        requested.push(url);
        await Promise.resolve();
        inFlight -= 1;
        return '<html><body>page</body></html>';
      },
      readFields: () => ({}),
      skipHosts: ['medicine.example.edu'],
      pauseMs: 5,
      sleep: async () => {},
    });
    expect(requested).toEqual([PAGE]);
    expect(reads.get(LOCKED_PAGE)).toEqual({ status: 'deferred' });
  });

  it('records a thrown or empty fetch as a failed read', async () => {
    const second = {
      sourceUrl: 'https://other.example.edu/b/',
      emails: [],
      titles: [],
      phantoms: [],
    };
    const reads = await readTargetPagesSequentially([...targets(), second], {
      fetchHtml: async (url) => {
        if (url === PAGE) throw new Error('503');
        return '   ';
      },
      readFields: () => ({}),
      skipHosts: [],
      pauseMs: 0,
    });
    expect(reads.get(PAGE)).toEqual({ status: 'failed' });
    expect(reads.get(second.sourceUrl)).toEqual({ status: 'failed' });
  });

  it('matches a skipped host and its subdomains only', () => {
    expect(isSkippedHost('https://medicine.example.edu/x', ['medicine.example.edu'])).toBe(true);
    expect(isSkippedHost('https://www.medicine.example.edu/x', ['medicine.example.edu'])).toBe(
      true,
    );
    expect(isSkippedHost('https://notmedicine.example.edu/x', ['medicine.example.edu'])).toBe(
      false,
    );
  });
});
