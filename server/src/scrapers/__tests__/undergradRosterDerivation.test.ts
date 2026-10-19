import { afterEach, describe, expect, it } from 'vitest';
import {
  createUndergradRosterDeriver,
  deriveUndergradRosterForCandidate,
  derivedRosterPageBelongsToRow,
  derivedRosterWithheldReason,
  sectionLabelCombinesGraduateLevels,
  DERIVED_ROSTER_MAX_UNDERGRADUATES,
  type DerivedRosterCandidate,
} from '../undergradRosterDerivation';
import {
  OfficialResearchHomeRosterScraper,
  type ExtractedOfficialRoster,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';
import {
  DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV,
  entityHasHostedUndergraduates,
  servableRosterSnapshot,
} from '../../services/hostedUndergraduates';
import { rosterEnrichmentWithRetainedSuccessfulSnapshot } from '../entityMaterializer';
import type { ObservationInput, ScraperContext } from '../types';

const observedAt = new Date('2026-10-18T12:00:00.000Z');

const rosterPage = (sections: Record<string, string[]>): string => `<html><body><main>
${Object.entries(sections)
  .map(
    ([label, lines]) =>
      `<h2>${label}</h2><ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>`,
  )
  .join('\n')}
</main></body></html>`;

const candidate = (overrides: Partial<DerivedRosterCandidate> = {}): DerivedRosterCandidate => ({
  researchEntityKey: 'example-lab',
  websiteUrl: 'https://examplelab.example.org/',
  citedUrls: ['https://examplelab.example.org/people'],
  badged: true,
  hasDerivedRoster: false,
  ...overrides,
});

const readFrom =
  (pages: Record<string, string>) =>
  async (url: string): Promise<string> => {
    if (!(url in pages)) throw new Error('not found');
    return pages[url];
  };

const config = (overrides: Partial<OfficialRosterConfig> = {}): OfficialRosterConfig => ({
  researchEntityKey: 'example-lab',
  url: 'https://examplelab.example.org/people',
  template: 'heading-list',
  currentSectionLabels: ['Undergraduate Researchers'],
  ...overrides,
});

const roster = (names: string[]): ExtractedOfficialRoster => ({
  state: 'current',
  members: [],
  undergraduates: names.map((name) => ({ name, status: 'current' as const })),
  withheldCount: 0,
  undergraduateWithheldCount: 0,
  duplicateCount: 0,
  observedAt,
  freshnessExpiresAt: new Date('2026-11-08T12:00:00.000Z'),
  complete: true,
});

describe('derivedRosterPageBelongsToRow (#5278)', () => {
  it('accepts a page on the row site', () => {
    expect(
      derivedRosterPageBelongsToRow(
        'https://www.examplelab.example.org/people',
        'https://examplelab.example.org/',
      ),
    ).toBe(true);
  });

  it('refuses another host and a sibling section of a shared host', () => {
    expect(
      derivedRosterPageBelongsToRow(
        'https://department.example.org/people',
        'https://examplelab.example.org/',
      ),
    ).toBe(false);
    expect(
      derivedRosterPageBelongsToRow(
        'https://shared.example.org/lab/other/people',
        'https://shared.example.org/lab/example/',
      ),
    ).toBe(false);
    expect(
      derivedRosterPageBelongsToRow(
        'https://shared.example.org/lab/example/people',
        'https://shared.example.org/lab/example/',
      ),
    ).toBe(true);
  });
});

describe('sectionLabelCombinesGraduateLevels (#5278)', () => {
  it.each(['Graduate and Undergraduate Students', 'Master/Undergrad Students', 'PhD & Undergrads'])(
    'refuses %s',
    (label) => {
      expect(sectionLabelCombinesGraduateLevels(label)).toBe(true);
    },
  );

  it.each(['Undergraduate Researchers', 'Undergraduates', 'Lab Alumni'])('accepts %s', (label) => {
    expect(sectionLabelCombinesGraduateLevels(label)).toBe(false);
  });
});

describe('derivedRosterWithheldReason (#5278)', () => {
  const site = 'https://examplelab.example.org/';

  it('passes an undergraduate-only list on the row site', () => {
    expect(derivedRosterWithheldReason(config(), roster(['Avery Sample']), site)).toBeNull();
  });

  it('names each failed check', () => {
    expect(derivedRosterWithheldReason(config(), roster(['Avery Sample']), '')).toBe('no-website');
    expect(
      derivedRosterWithheldReason(
        config({ url: 'https://department.example.org/people' }),
        roster(['Avery Sample']),
        site,
      ),
    ).toBe('page-not-this-row');
    expect(
      derivedRosterWithheldReason(
        config({ currentSectionLabels: ['Graduate and Undergraduate Students'] }),
        roster(['Avery Sample']),
        site,
      ),
    ).toBe('combined-section-label');
    expect(
      derivedRosterWithheldReason(
        config(),
        roster(
          Array.from({ length: DERIVED_ROSTER_MAX_UNDERGRADUATES + 1 }, (_, i) => `Person ${i}`),
        ),
        site,
      ),
    ).toBe('too-many-names');
    expect(
      derivedRosterWithheldReason(config(), roster(['Avery Sample Graduate Student']), site),
    ).toBe('name-not-an-undergraduate');
  });
});

describe('deriveUndergradRosterForCandidate (#5278)', () => {
  it('derives a roster from the cited people page', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate(),
      readFrom({
        'https://examplelab.example.org/people': rosterPage({
          'Undergraduate Researchers': ['Avery Sample', 'Quinn Fixture'],
        }),
        'https://examplelab.example.org/': '<html><body>Home</body></html>',
      }),
      observedAt,
    );
    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    expect(outcome.roster.undergraduates.map((member) => member.name)).toEqual([
      'Avery Sample',
      'Quinn Fixture',
    ]);
  });

  it('drops a past entry from another school', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate(),
      readFrom({
        'https://examplelab.example.org/people': rosterPage({
          'Undergraduate Researchers': ['Avery Sample'],
          'Undergraduate Alumni': [
            'Riley Example, Yale College 2023',
            'Morgan Example, summer research intern from Example State University',
          ],
        }),
      }),
      observedAt,
    );
    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    const names = outcome.roster.undergraduates.map((member) => member.name);
    expect(names).toContain('Riley Example');
    expect(names).not.toContain('Morgan Example');
  });

  it('withholds a list cited from another site and finds the one the row site links to', async () => {
    const departmentList = rosterPage({ 'Undergraduate Researchers': ['Avery Sample'] });
    const withheld = await deriveUndergradRosterForCandidate(
      candidate({ citedUrls: ['https://department.example.org/people'] }),
      readFrom({ 'https://department.example.org/people': departmentList }),
      observedAt,
    );
    expect(withheld).toMatchObject({ kind: 'withheld', reason: 'page-not-this-row' });

    const discovered = await deriveUndergradRosterForCandidate(
      candidate({ citedUrls: ['https://department.example.org/people'] }),
      readFrom({
        'https://department.example.org/people': departmentList,
        'https://examplelab.example.org/': '<html><body><a href="/team">Team</a></body></html>',
        'https://examplelab.example.org/team': rosterPage({
          'Undergraduate Researchers': ['Quinn Fixture'],
        }),
      }),
      observedAt,
    );
    expect(discovered.kind).toBe('derived');
  });

  it('withholds a combined graduate and undergraduate heading', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate(),
      readFrom({
        'https://examplelab.example.org/people': rosterPage({
          'Graduate and Undergraduate Students': ['Avery Sample', 'Quinn Fixture'],
        }),
      }),
      observedAt,
    );
    expect(outcome).toMatchObject({ kind: 'withheld', reason: 'combined-section-label' });
  });

  it('withdraws a derived roster once the row loses the badge', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate({ badged: false, hasDerivedRoster: true }),
      readFrom({}),
      observedAt,
    );
    expect(outcome).toMatchObject({ kind: 'withheld', reason: 'no-longer-badged' });
  });
});

describe('createUndergradRosterDeriver (#5278)', () => {
  it('leaves static and owner-denied rows alone', async () => {
    const reads: string[] = [];
    const derive = createUndergradRosterDeriver(
      async () => [
        candidate({ researchEntityKey: 'static-lab' }),
        candidate({ researchEntityKey: 'denied-lab' }),
        candidate(),
      ],
      0,
      ['denied-lab'],
    );
    const run = await derive({
      staticKeys: new Set(['static-lab']),
      observedAt,
      fetchPage: async (url) => {
        reads.push(url);
        return rosterPage({ 'Undergraduate Researchers': ['Avery Sample'] });
      },
    });
    expect(run.staticOverridden).toBe(1);
    expect(run.ownerDenied).toBe(1);
    expect(run.outcomes.map((outcome) => outcome.researchEntityKey)).toEqual(['example-lab']);
  });
});

describe('derived roster observations and serving (#5278)', () => {
  const previous = process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV];
  afterEach(() => {
    if (previous === undefined) delete process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV];
    else process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV] = previous;
  });

  const runScraper = async (): Promise<ObservationInput[]> => {
    const emitted: ObservationInput[] = [];
    const derive = createUndergradRosterDeriver(async () => [candidate()], 0, []);
    const scraper = new OfficialResearchHomeRosterScraper(
      [],
      async () => rosterPage({ 'Undergraduate Researchers': ['Avery Sample'] }),
      derive,
    );
    await scraper.run({
      options: { dryRun: false, useCache: false, release: false, referenceDate: observedAt },
      emit: async (observations: ObservationInput[]) => {
        emitted.push(...observations);
      },
      log: () => {},
    } as unknown as ScraperContext);
    return emitted;
  };

  it('emits only the roster snapshot, marked derived, with no team members', async () => {
    const emitted = await runScraper();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      entityType: 'researchEntity',
      entityKey: 'example-lab',
      field: 'rosterEnrichment',
      value: { configOrigin: 'derived', memberKeys: [], memberCount: 0 },
    });
  });

  it('records a derived roster but serves it only behind the flag, and never as the badge', async () => {
    const [snapshot] = await runScraper();
    const stored = rosterEnrichmentWithRetainedSuccessfulSnapshot(snapshot.value);
    delete process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV];
    expect(servableRosterSnapshot(stored)).toBeNull();
    process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV] = 'true';
    expect(servableRosterSnapshot(stored)).not.toBeNull();
    expect(entityHasHostedUndergraduates({ rosterEnrichment: stored })).toBe(false);
  });

  it('keeps the derived mark on a retained snapshot after a failed read', async () => {
    const [snapshot] = await runScraper();
    const stored = rosterEnrichmentWithRetainedSuccessfulSnapshot(snapshot.value);
    const afterFailure = rosterEnrichmentWithRetainedSuccessfulSnapshot(
      { state: 'failed', sourceUrl: 'https://examplelab.example.org/people', observedAt },
      stored,
    );
    delete process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV];
    expect(servableRosterSnapshot(afterFailure)).toBeNull();
  });
});
