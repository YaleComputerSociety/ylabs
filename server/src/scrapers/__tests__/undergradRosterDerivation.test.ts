import { afterEach, describe, expect, it } from 'vitest';
import {
  createUndergradRosterDeriver,
  deriveUndergradRosterForCandidate,
  derivedRosterPageBelongsToRow,
  derivedRosterWithheldReason,
  sectionLabelCombinesGraduateLevels,
  sectionLabelMixesOtherGroups,
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

describe('sectionLabelMixesOtherGroups (#5296)', () => {
  it.each([
    'Postgrads, Yale Undergrads, Other Colleges, High School',
    'Undergraduate and High School Students',
    'Visiting and Yale Undergraduates',
    'Undergraduates from Other Universities',
    'Graduate and Undergraduate Students',
  ])('refuses %s', (label) => {
    expect(sectionLabelMixesOtherGroups(label)).toBe(true);
  });

  it.each(['Undergraduate Researchers', 'Yale Undergraduates', 'Lab Alumni'])(
    'accepts %s',
    (label) => {
      expect(sectionLabelMixesOtherGroups(label)).toBe(false);
    },
  );
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

describe('derived roster size check (#5296)', () => {
  const site = 'https://examplelab.example.org/';
  it('holds the current list to the cap but lets a long alumni list through', () => {
    const many = Array.from({ length: DERIVED_ROSTER_MAX_UNDERGRADUATES + 1 }, (_, i) => ({
      name: `Person ${i}`,
      status: 'past' as const,
    }));
    const longAlumni: ExtractedOfficialRoster = {
      ...roster(['Avery Sample']),
      undergraduates: [{ name: 'Avery Sample', status: 'current' }, ...many],
    };
    expect(derivedRosterWithheldReason(config(), longAlumni, site)).toBeNull();
  });

  it('derives a lab alumni list read past a name with a bracketed nickname', async () => {
    const alumni = Array.from(
      { length: DERIVED_ROSTER_MAX_UNDERGRADUATES + 1 },
      (_, i) =>
        `<h3>Alum${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} Sample</h3><h4>Undergraduate Research Assistant</h4>`,
    ).join('');
    const page = `<html><body><main>
      <h2>Research Assistants</h2><h3>Avery Sample</h3><h4>Undergraduate Research Assistant</h4>
      <h2>Lab Alumni</h2><h3>Rowan (Ro) Sample</h3><h4>Undergraduate Research Assistant</h4>${alumni}
    </main></body></html>`;
    const outcome = await deriveUndergradRosterForCandidate(
      candidate(),
      readFrom({ 'https://examplelab.example.org/people': page }),
      observedAt,
    );
    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    const undergraduates = outcome.roster.undergraduates;
    expect(undergraduates.filter((member) => member.status === 'current')).toEqual([
      { name: 'Avery Sample', status: 'current' },
    ]);
    expect(undergraduates.filter((member) => member.status === 'past')).toHaveLength(
      DERIVED_ROSTER_MAX_UNDERGRADUATES + 2,
    );
    expect(undergraduates).toContainEqual({ name: 'Rowan (Ro) Sample', status: 'past' });
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

  it('withholds a mixed section the extractor could not split into sub-groups', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate(),
      readFrom({
        'https://examplelab.example.org/people': rosterPage({
          'Postgrads and Undergraduates': ['Avery Sample', 'Quinn Fixture'],
        }),
      }),
      observedAt,
    );
    expect(outcome).toMatchObject({ kind: 'withheld', reason: 'combined-section-label' });
  });

  it('derives a mixed section whose sub-tables name each group', async () => {
    const label = 'Postgrads, Yale Undergrads, Other Colleges, High School';
    const subTable = (group: string, name: string) =>
      `<table><tbody><tr><th>${group}</th><th>Dates in Lab</th></tr><tr><td>${name}</td><td>2019-2020</td></tr></tbody></table>`;
    const outcome = await deriveUndergradRosterForCandidate(
      candidate(),
      readFrom({
        'https://examplelab.example.org/people': `<html><body><main><h2>Lab Alumni</h2><h3>${label}</h3>
          ${subTable('Postgrads', 'Avery Sample')}
          ${subTable('Yale Undergrads', 'Quinn Fixture')}
          ${subTable('Undergrads from Other Colleges', 'Rowan Example')}
          ${subTable('Summer High School Students', 'Jordan Placeholder')}
        </main></body></html>`,
      }),
      observedAt,
    );
    expect(outcome.kind).toBe('derived');
    expect(outcome.kind === 'derived' && outcome.roster.undergraduates).toEqual([
      { name: 'Quinn Fixture', status: 'past', startYear: 2019, endYear: 2020 },
    ]);
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

  it('withdraws a recorded derived roster once the owner denies the row', async () => {
    const reads: string[] = [];
    const derive = createUndergradRosterDeriver(
      async () => [candidate({ researchEntityKey: 'denied-lab', hasDerivedRoster: true })],
      0,
      ['denied-lab'],
    );
    const run = await derive({
      staticKeys: new Set(),
      observedAt,
      fetchPage: async (url) => {
        reads.push(url);
        return rosterPage({ 'Undergraduate Researchers': ['Avery Sample'] });
      },
    });
    expect(reads).toEqual([]);
    expect(run.ownerDenied).toBe(1);
    expect(run.outcomes).toEqual([
      expect.objectContaining({
        kind: 'withheld',
        researchEntityKey: 'denied-lab',
        reason: 'owner-denied',
      }),
    ]);
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

  it('never keeps a derived roster behind a failed allowlist read', async () => {
    const [snapshot] = await runScraper();
    const stored = rosterEnrichmentWithRetainedSuccessfulSnapshot(snapshot.value);
    const afterFailure = rosterEnrichmentWithRetainedSuccessfulSnapshot(
      {
        state: 'failed',
        configOrigin: 'static',
        sourceUrl: 'https://examplelab.example.org/people',
        observedAt,
      },
      stored,
    );
    process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV] = 'true';
    expect(servableRosterSnapshot(afterFailure)).toBeNull();
  });

  it('emits a withheld snapshot for an owner-denied row that had a derived roster', async () => {
    const emitted: ObservationInput[] = [];
    const derive = createUndergradRosterDeriver(
      async () => [candidate({ hasDerivedRoster: true })],
      0,
      ['example-lab'],
    );
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
    expect(emitted).toHaveLength(1);
    const stored = rosterEnrichmentWithRetainedSuccessfulSnapshot(emitted[0].value);
    expect(stored).toMatchObject({
      state: 'withheld',
      withheldReason: 'owner-denied',
      undergraduates: [],
    });
    process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV] = 'true';
    expect(servableRosterSnapshot(stored)).toBeNull();
  });
});
