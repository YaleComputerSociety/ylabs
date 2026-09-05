import { describe, expect, it } from 'vitest';
import {
  FellowshipSubject,
  RetireLaneContext,
  matchFellowshipSubject,
  parseRetireDeadProgramLanesArgs,
  retireLaneVerdict,
} from '../retireDeadProgramObservationLanesCore';

const fellowships: FellowshipSubject[] = [
  {
    title: 'Branford College Richter Summer Fellowship',
    sourceUrl: 'https://example.edu/branford-richter',
    archived: false,
  },
  {
    title: 'Steven Clark Senior Essay Travel Grant',
    sourceUrl: 'https://example.edu/steven-clark',
    archived: false,
  },
  {
    title: 'Mellon Mays Undergraduate Fellowship Program',
    sourceUrl: 'https://example.edu/mellon-mays',
    archived: true,
  },
  {
    title: 'Baron Student Research Grants',
    sourceUrl: 'https://example.edu/baron-grants',
    archived: false,
  },
];

const retirableContext = (overrides: Partial<RetireLaneContext> = {}): RetireLaneContext => ({
  entityKey: 'program-branfordcollegerichtersummerfellowship',
  observedFields: ['shortDescription'],
  hasRecordedEntityId: true,
  entityExists: false,
  redirectCoversKey: false,
  wouldMaterialize: false,
  referencedByDurableRecord: false,
  fellowshipMatch: {
    title: 'Branford College Richter Summer Fellowship',
    archived: false,
    matchedBy: 'exact',
  },
  ...overrides,
});

describe('parseRetireDeadProgramLanesArgs', () => {
  it('is dry-run by default and requires an explicit confirm flag alongside --apply', () => {
    expect(parseRetireDeadProgramLanesArgs([])).toMatchObject({ apply: false, confirm: false });
    expect(
      parseRetireDeadProgramLanesArgs(['--apply', '--confirm-retire-dead-program-lanes']),
    ).toMatchObject({ apply: true, confirm: true });
    expect(parseRetireDeadProgramLanesArgs(['--apply'])).toMatchObject({
      apply: true,
      confirm: false,
    });
  });

  it('rejects an unknown argument and a non-positive --max-apply', () => {
    expect(() => parseRetireDeadProgramLanesArgs(['--wat'])).toThrow(/Unknown argument/);
    expect(() => parseRetireDeadProgramLanesArgs(['--max-apply=0'])).toThrow(/--max-apply/);
    expect(() => parseRetireDeadProgramLanesArgs(['--max-apply=-3'])).toThrow(/--max-apply/);
  });
});

describe('matchFellowshipSubject', () => {
  it('matches an unspaced entity key against the fellowship title', () => {
    expect(
      matchFellowshipSubject({
        entityKey: 'program-branfordcollegerichtersummerfellowship',
        observationSourceUrls: [],
        fellowships,
      }),
    ).toMatchObject({ title: 'Branford College Richter Summer Fellowship', matchedBy: 'exact' });
  });

  it('matches a prefixed key by containment and a renamed key by source URL', () => {
    expect(
      matchFellowshipSubject({
        entityKey: 'program-yale-college-fellowships-office-steven-clark-senior-essay-travel-grant',
        observationSourceUrls: [],
        fellowships,
      }),
    ).toMatchObject({ title: 'Steven Clark Senior Essay Travel Grant', matchedBy: 'contained' });

    expect(
      matchFellowshipSubject({
        entityKey: 'program-ypsa-antisemitism-travel-awards',
        observationSourceUrls: ['https://example.edu/baron-grants'],
        fellowships,
      }),
    ).toMatchObject({ title: 'Baron Student Research Grants', matchedBy: 'sourceUrl' });
  });

  it('reports no match rather than a false positive when the subject is absent', () => {
    expect(
      matchFellowshipSubject({
        entityKey: 'program-some-fellowship-that-does-not-exist',
        observationSourceUrls: [],
        fellowships,
      }),
    ).toBeUndefined();
  });

  // The `fellowships` model has no `name` and no `slug`; the label is `title`.
  // Reading a nonexistent field returns undefined for every row and yields a
  // confident zero match, which is how #2406 was first mis-measured (and the same
  // shape as the `research_entity_redirects.fromSlug` join in #2401).
  it('matches on title and is unaffected by a name or slug field', () => {
    const withDecoyFields = [
      { title: 'Branford College Richter Summer Fellowship', sourceUrl: '', archived: false },
    ] as unknown as FellowshipSubject[];
    (withDecoyFields[0] as any).name = 'Totally Different Fellowship';
    (withDecoyFields[0] as any).slug = 'totally-different';

    expect(
      matchFellowshipSubject({
        entityKey: 'program-branfordcollegerichtersummerfellowship',
        observationSourceUrls: [],
        fellowships: withDecoyFields,
      }),
    ).toMatchObject({ title: 'Branford College Richter Summer Fellowship' });
  });
});

describe('retireLaneVerdict', () => {
  it('retires an enrichment-only lane whose entity is gone and whose subject survives live', () => {
    expect(retireLaneVerdict(retirableContext())).toBe('retire');
  });

  it('defers rather than retires when the only surviving fellowship is archived', () => {
    expect(
      retireLaneVerdict(
        retirableContext({
          fellowshipMatch: {
            title: 'Mellon Mays Undergraduate Fellowship Program',
            archived: true,
            matchedBy: 'contained',
          },
        }),
      ),
    ).toBe('skip-fellowship-subject-archived');
  });

  // The load-bearing guard. #2406 argued materialization is a no-op via the
  // retired-PROGRAM skip, but this population carries no `entityType` observation
  // at all, so that guard never fires. Mint intent is what actually protects a
  // lane carrying a name or an entityType from being retired.
  it('refuses to retire a lane that carries mint intent', () => {
    expect(retireLaneVerdict(retirableContext({ observedFields: ['name'] }))).toBe(
      'skip-carries-mint-intent',
    );
    expect(
      retireLaneVerdict(retirableContext({ observedFields: ['shortDescription', 'entityType'] })),
    ).toBe('skip-carries-mint-intent');
  });

  it('fails closed on every other precondition', () => {
    expect(retireLaneVerdict(retirableContext({ entityKey: 'dept-ysph-someone' }))).toBe(
      'skip-not-program-key',
    );
    expect(retireLaneVerdict(retirableContext({ hasRecordedEntityId: false }))).toBe(
      'skip-no-recorded-entity-id',
    );
    expect(retireLaneVerdict(retirableContext({ entityExists: true }))).toBe(
      'skip-entity-still-exists',
    );
    expect(retireLaneVerdict(retirableContext({ redirectCoversKey: true }))).toBe(
      'skip-redirect-covers-key',
    );
    expect(retireLaneVerdict(retirableContext({ wouldMaterialize: true }))).toBe(
      'skip-would-materialize',
    );
    expect(retireLaneVerdict(retirableContext({ referencedByDurableRecord: true }))).toBe(
      'skip-referenced-by-durable-record',
    );
    expect(retireLaneVerdict(retirableContext({ fellowshipMatch: undefined }))).toBe(
      'skip-no-fellowship-subject',
    );
  });
});
