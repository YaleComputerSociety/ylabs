import { describe, expect, it } from 'vitest';
import {
  assertRepairSupersededEntitySourceUrlsApplyAllowed,
  parseRepairSupersededEntitySourceUrlsArgs,
  rewriteSourceLinkHealth,
  stdoutReport,
} from '../repairSupersededEntitySourceUrls';
import {
  candidatePersonNames,
  entitySourceUrlReplacementCandidates,
  entitySourceUrlRepairTargets,
  isRepointableSignalCitation,
  rewriteSourceUrl,
  summarizeEntitySourceUrlRepair,
  type EntitySourceUrlRepairRow,
} from '../repairSupersededEntitySourceUrlsCore';
import { personNameSlug, profileSlugNamesPerson } from '../verifyOfficialProfileLinksCore';

const DEPT_HOST = 'https://example-dept.yale.edu';
const OTHER_HOST = 'https://other-dept.yale.edu';

describe('apostrophe surnames', () => {
  it('matches a person page whose slug elides the apostrophe Yale elides too', () => {
    expect(profileSlugNamesPerson(`${DEPT_HOST}/people/robin-oexample`, "Robin O'Example")).toBe(
      true,
    );
    expect(profileSlugNamesPerson(`${DEPT_HOST}/profile/robin-oexample`, "Robin O'Example")).toBe(
      true,
    );
  });

  it('derives the slug a department would mint, not an apostrophe-split one', () => {
    expect(personNameSlug("Robin O'Example")).toBe('robin-oexample');
    expect(personNameSlug('Robin O’Example')).toBe('robin-oexample');
  });

  it('still refuses a same-surname colleague and a different person', () => {
    expect(profileSlugNamesPerson(`${DEPT_HOST}/people/robin-oexample`, "Alex O'Example")).toBe(
      false,
    );
    expect(profileSlugNamesPerson(`${DEPT_HOST}/people/robin-oexample`, 'Robin Different')).toBe(
      false,
    );
  });
});

describe('entitySourceUrlRepairTargets', () => {
  const facts = {
    id: 'entity-1',
    slug: 'example-lab',
    name: 'Example Lab',
    leadDisplayNames: ["Robin O'Example"],
  };

  it('selects a person page the entity can name a lead for', () => {
    const targets = entitySourceUrlRepairTargets({
      ...facts,
      sourceUrls: [`${DEPT_HOST}/people/robin-oexample/`],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      entityId: 'entity-1',
      host: 'example-dept.yale.edu',
      url: `${DEPT_HOST}/people/robin-oexample/`,
      personDisplayName: "Robin O'Example",
    });
  });

  it('refuses a same-slug page that names a different person', () => {
    expect(
      entitySourceUrlRepairTargets({
        ...facts,
        leadDisplayNames: ['Alicia Different'],
        name: 'Different Lab',
        sourceUrls: [`${DEPT_HOST}/people/robin-oexample`],
      }),
    ).toEqual([]);
  });

  it('refuses a lab page and a directory row that merely end in a person-shaped slug', () => {
    expect(
      entitySourceUrlRepairTargets({
        ...facts,
        sourceUrls: [
          `${DEPT_HOST}/lab/robin-oexample/`,
          `${DEPT_HOST}/directory/faculty/robin-oexample`,
        ],
      }),
    ).toEqual([]);
  });

  it('refuses a shared roster listing and a non-Yale host', () => {
    expect(
      entitySourceUrlRepairTargets({
        ...facts,
        sourceUrls: [
          `${DEPT_HOST}/people/faculty`,
          `${DEPT_HOST}/people/our-people`,
          'https://example-dept.example.com/people/robin-oexample',
        ],
      }),
    ).toEqual([]);
  });

  it('repairs nothing for an entity that can name nobody', () => {
    expect(
      entitySourceUrlRepairTargets({
        id: 'entity-2',
        sourceUrls: [`${DEPT_HOST}/people/robin-oexample`],
      }),
    ).toEqual([]);
  });

  it('deduplicates a repeated citation', () => {
    const targets = entitySourceUrlRepairTargets({
      ...facts,
      sourceUrls: [`${DEPT_HOST}/people/robin-oexample`, `${DEPT_HOST}/people/robin-oexample`],
    });
    expect(targets).toHaveLength(1);
  });
});

describe('candidatePersonNames', () => {
  it('prefers lead names and falls back to the entity name, without duplicates', () => {
    expect(
      candidatePersonNames({
        id: 'entity-1',
        leadDisplayNames: ["Robin O'Example", "Robin O'Example"],
        displayName: 'Example Lab',
        name: 'Example Lab',
      }),
    ).toEqual(["Robin O'Example", 'Example Lab']);
  });
});

describe('entitySourceUrlReplacementCandidates', () => {
  it('proposes the same-host canonical profile page for the same person', () => {
    const candidates = entitySourceUrlReplacementCandidates({
      entityId: 'entity-1',
      host: 'example-dept.yale.edu',
      url: `${DEPT_HOST}/people/robin-oexample`,
      personDisplayName: "Robin O'Example",
    });
    expect(candidates).toContain(`${DEPT_HOST}/profile/robin-oexample`);
    expect(candidates.every((candidate) => candidate.startsWith(DEPT_HOST))).toBe(true);
  });

  it('never proposes the stored path back to itself', () => {
    const candidates = entitySourceUrlReplacementCandidates({
      entityId: 'entity-1',
      host: 'example-dept.yale.edu',
      url: `${DEPT_HOST}/profile/robin-oexample`,
      personDisplayName: "Robin O'Example",
    });
    expect(candidates).not.toContain(`${DEPT_HOST}/profile/robin-oexample`);
  });
});

describe('rewriteSourceUrl', () => {
  it('re-points one citation and preserves the order of the rest', () => {
    expect(
      rewriteSourceUrl(
        [
          `${OTHER_HOST}/research-and-faculty/robin-oexample`,
          `${DEPT_HOST}/people/robin-oexample/`,
          'https://example-lab.example.com/',
        ],
        `${DEPT_HOST}/people/robin-oexample/`,
        `${DEPT_HOST}/profile/robin-oexample`,
      ),
    ).toEqual([
      `${OTHER_HOST}/research-and-faculty/robin-oexample`,
      `${DEPT_HOST}/profile/robin-oexample`,
      'https://example-lab.example.com/',
    ]);
  });

  it('collapses the replacement onto an already-cited copy instead of duplicating it', () => {
    expect(
      rewriteSourceUrl(
        [`${DEPT_HOST}/profile/robin-oexample`, `${DEPT_HOST}/people/robin-oexample`],
        `${DEPT_HOST}/people/robin-oexample`,
        `${DEPT_HOST}/profile/robin-oexample`,
      ),
    ).toEqual([`${DEPT_HOST}/profile/robin-oexample`]);
  });
});

describe('rewriteSourceLinkHealth', () => {
  it('replaces the dead entry rather than leaving it to badge the repaired link', () => {
    expect(
      rewriteSourceLinkHealth(
        [
          { url: 'https://example-lab.example.com/', healthStatus: 'HEALTHY', httpStatusCode: 200 },
          {
            url: `${DEPT_HOST}/people/robin-oexample/`,
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
          },
        ],
        `${DEPT_HOST}/people/robin-oexample/`,
        `${DEPT_HOST}/profile/robin-oexample`,
        { healthStatus: 'HEALTHY', httpStatusCode: 200 },
      ).map((entry) => ({ url: entry.url, healthStatus: entry.healthStatus })),
    ).toEqual([
      { url: 'https://example-lab.example.com/', healthStatus: 'HEALTHY' },
      { url: `${DEPT_HOST}/profile/robin-oexample`, healthStatus: 'HEALTHY' },
    ]);
  });
});

describe('isRepointableSignalCitation', () => {
  it('accepts only the two synthesized-boilerplate ways-in derivations', () => {
    expect(isRepointableSignalCitation('signal:REACH_OUT_PLAUSIBLE:IDENTIFIED_FACULTY_LEAD')).toBe(
      true,
    );
    expect(isRepointableSignalCitation('signal:REACH_OUT_PLAUSIBLE:ORGANIZATIONAL_HOME')).toBe(
      true,
    );
  });

  it('refuses a signal whose excerpt quotes the page it cites', () => {
    expect(isRepointableSignalCitation('signal:CURRENT_UNDERGRADS')).toBe(false);
    expect(isRepointableSignalCitation('signal:POSTED_OPENING')).toBe(false);
    expect(isRepointableSignalCitation(undefined)).toBe(false);
  });
});

describe('summarizeEntitySourceUrlRepair', () => {
  it('counts each verdict separately so a dead-with-no-replacement is not read as repaired', () => {
    const rows: EntitySourceUrlRepairRow[] = [
      { entityId: 'a', host: 'h', before: 'u1', verdict: 'repaired', after: 'u2' },
      { entityId: 'b', host: 'h', before: 'u3', verdict: 'dead' },
      { entityId: 'c', host: 'h', before: 'u4', verdict: 'healthy' },
      { entityId: 'd', host: 'h', before: 'u5', verdict: 'inconclusive' },
    ];
    expect(summarizeEntitySourceUrlRepair(10, rows)).toEqual({
      entitiesConsidered: 10,
      citationsProbed: 4,
      healthy: 1,
      repaired: 1,
      dead: 1,
      inconclusive: 1,
    });
  });
});

describe('parseRepairSupersededEntitySourceUrlsArgs', () => {
  it('defaults to dry-run', () => {
    expect(parseRepairSupersededEntitySourceUrlsArgs([])).toMatchObject({
      apply: false,
      confirm: false,
      explicitLimit: false,
    });
  });

  it('parses both flag spellings', () => {
    expect(
      parseRepairSupersededEntitySourceUrlsArgs([
        '--apply',
        '--confirm-entity-source-url-repair',
        '--limit=5',
        '--host=Example-Dept.Yale.Edu',
        '--slug',
        'example-lab',
      ]),
    ).toMatchObject({
      apply: true,
      confirm: true,
      limit: 5,
      explicitLimit: true,
      host: 'example-dept.yale.edu',
      slug: 'example-lab',
    });
  });

  it('rejects an unknown argument and a non-positive limit', () => {
    expect(() => parseRepairSupersededEntitySourceUrlsArgs(['--wat'])).toThrow(
      /Unknown repair-superseded-entity-source-urls argument/,
    );
    expect(() => parseRepairSupersededEntitySourceUrlsArgs(['--limit=0'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseRepairSupersededEntitySourceUrlsArgs(['--host'])).toThrow(
      /--host requires a value/,
    );
  });
});

describe('assertRepairSupersededEntitySourceUrlsApplyAllowed', () => {
  it('lets a dry run through unconditionally', () => {
    expect(() =>
      assertRepairSupersededEntitySourceUrlsApplyAllowed({
        apply: false,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('requires the confirm flag and an explicit limit to apply', () => {
    expect(() =>
      assertRepairSupersededEntitySourceUrlsApplyAllowed({
        apply: true,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-entity-source-url-repair/);
    expect(() =>
      assertRepairSupersededEntitySourceUrlsApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });
});

describe('stdoutReport', () => {
  it('samples only the repaired rows and keeps person names out of the console', () => {
    const report = stdoutReport({
      entitiesConsidered: 2,
      citationsProbed: 2,
      healthy: 0,
      repaired: 1,
      dead: 1,
      inconclusive: 0,
      mode: 'dry-run',
      citationsRewritten: 0,
      signalCitationsRepointed: 0,
      rows: [
        {
          entityId: 'a',
          slug: 'example-lab',
          host: 'example-dept.yale.edu',
          before: `${DEPT_HOST}/people/robin-oexample`,
          after: `${DEPT_HOST}/profile/robin-oexample`,
          verdict: 'repaired',
          httpStatusCode: 404,
        },
        {
          entityId: 'b',
          slug: 'other-lab',
          host: 'example-dept.yale.edu',
          before: `${DEPT_HOST}/people/alex-different`,
          verdict: 'dead',
          httpStatusCode: 404,
        },
      ],
    });
    expect(report.rows).toEqual([
      {
        slug: 'example-lab',
        before: `${DEPT_HOST}/people/robin-oexample`,
        after: `${DEPT_HOST}/profile/robin-oexample`,
        httpStatusCode: 404,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("O'Example");
  });
});
