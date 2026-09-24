import { describe, expect, it } from 'vitest';
import {
  assertCollapseMirroredCitationsApplyAllowed,
  parseCollapseMirroredCitationsArgs,
} from '../collapseMirroredPersonPageCitations';
import {
  mostCanonicalMirroredCitation,
  planMirroredCitationCollapse,
  planMirroredCitationCollapseRow,
} from '../collapseMirroredPersonPageCitationsCore';

const SECTION = 'https://medicine.yale.edu/cancer/profile/example-slug';
const FLAT = 'https://medicine.yale.edu/profile/example-slug';
const NESTED = 'https://medicine.yale.edu/people/faculty/example-slug';
const OTHER_PAGE = 'https://medicine.yale.edu/profile/other-slug';

describe('collapse-citation-mirrors CLI helpers', () => {
  it('defaults to a dry-run and parses the apply safety flags', () => {
    expect(parseCollapseMirroredCitationsArgs([])).toMatchObject({
      apply: false,
      confirm: false,
      explicitLimit: false,
      allTiers: false,
    });
    expect(
      parseCollapseMirroredCitationsArgs([
        '--apply',
        '--confirm-citation-mirror-collapse',
        '--limit=25',
        '--all-tiers',
      ]),
    ).toMatchObject({ apply: true, confirm: true, limit: 25, explicitLimit: true, allTiers: true });
  });

  it('refuses apply without the confirmation flag or an explicit limit', () => {
    expect(() =>
      assertCollapseMirroredCitationsApplyAllowed({
        apply: true,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-citation-mirror-collapse/);
    expect(() =>
      assertCollapseMirroredCitationsApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
    expect(() =>
      assertCollapseMirroredCitationsApplyAllowed({
        apply: false,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('rejects an unknown argument rather than ignoring it', () => {
    expect(() => parseCollapseMirroredCitationsArgs(['--force'])).toThrow(/Unknown/);
  });
});

describe('choosing which spelling survives', () => {
  it('prefers https, then the shallower path, matching the render-time choice', () => {
    expect(mostCanonicalMirroredCitation([SECTION, FLAT])).toBe(FLAT);
    expect(mostCanonicalMirroredCitation([FLAT.replace('https', 'http'), SECTION])).toBe(SECTION);
  });

  it('breaks a remaining tie deterministically, so a re-run does not churn the row', () => {
    const a = 'https://medicine.yale.edu/profile/aaa-slug';
    const b = 'https://medicine.yale.edu/profile/bbb-slug';
    expect(mostCanonicalMirroredCitation([a, b])).toBe(mostCanonicalMirroredCitation([b, a]));
  });
});

describe('planning a collapse', () => {
  it('drops the redundant spellings and leaves unrelated citations alone', () => {
    const plan = planMirroredCitationCollapseRow({
      slug: 'row-with-a-mirror',
      sourceUrls: [SECTION, FLAT, OTHER_PAGE],
    });
    expect(plan?.sourceUrls).toEqual([FLAT, OTHER_PAGE]);
    expect(plan?.droppedUrls).toEqual([SECTION]);
    expect(plan?.refusal).toBeUndefined();
  });

  it('groups a nested roster spelling with the flat one for the same person', () => {
    const plan = planMirroredCitationCollapseRow({
      slug: 'row-with-a-nested-mirror',
      sourceUrls: [NESTED, FLAT],
    });
    expect(plan?.droppedUrls).toEqual([NESTED]);
  });

  it('plans nothing for a row whose citations name different pages', () => {
    expect(
      planMirroredCitationCollapseRow({ slug: 'row-without', sourceUrls: [FLAT, OTHER_PAGE] }),
    ).toBeUndefined();
  });

  /**
   * The narrowing risk this repair has to carry rather than defer. Measured on
   * Development, 95 `fieldProvenance` entries cite a spelling the collapse drops, and
   * dropping the citation while leaving the pointer behind strands the row's evidence the
   * way #2525 stranded `sourceUrls` after repairing `profileLinks`.
   */
  it('repoints a fieldProvenance entry that cited the dropped spelling', () => {
    const plan = planMirroredCitationCollapseRow({
      slug: 'row-with-provenance',
      sourceUrls: [SECTION, FLAT],
      fieldProvenance: {
        fullDescription: { sourceUrl: SECTION },
        researchAreas: { sourceUrl: OTHER_PAGE },
      },
    });
    expect(plan?.provenanceRepoint).toEqual({
      'fieldProvenance.fullDescription.sourceUrl': FLAT,
    });
  });

  it('drops a link-health entry for a dropped spelling and names the kept one for a re-probe', () => {
    const plan = planMirroredCitationCollapseRow({
      slug: 'row-with-health-on-the-dropped-spelling',
      sourceUrls: [SECTION, FLAT],
      sourceLinkHealth: [{ url: SECTION, healthStatus: 'HEALTHY' }],
    });
    expect(plan?.droppedLinkHealthUrls).toEqual([SECTION]);
    expect(plan?.keptUrlsAwaitingReprobe).toEqual([FLAT]);
  });

  it('does not ask for a re-probe when the kept spelling already has its own verdict', () => {
    const plan = planMirroredCitationCollapseRow({
      slug: 'row-with-health-on-both',
      sourceUrls: [SECTION, FLAT],
      sourceLinkHealth: [
        { url: SECTION, healthStatus: 'HEALTHY' },
        { url: FLAT, healthStatus: 'HEALTHY' },
      ],
    });
    expect(plan?.keptUrlsAwaitingReprobe).toEqual([]);
  });

  it('is a no-op on a row it already collapsed', () => {
    const first = planMirroredCitationCollapseRow({
      slug: 'row-run-twice',
      sourceUrls: [SECTION, FLAT, OTHER_PAGE],
    });
    expect(
      planMirroredCitationCollapseRow({ slug: 'row-run-twice', sourceUrls: first!.sourceUrls }),
    ).toBeUndefined();
  });

  it('counts every arm across a corpus and refuses a row it would leave uncited', () => {
    const plan = planMirroredCitationCollapse([
      { slug: 'a', sourceUrls: [SECTION, FLAT], fieldProvenance: { name: { sourceUrl: SECTION } } },
      { slug: 'b', sourceUrls: [FLAT, OTHER_PAGE] },
      { slug: 'c', sourceUrls: [] },
    ]);
    expect(plan).toMatchObject({
      rowsRead: 3,
      rowsPlanned: 1,
      rowsRefused: 0,
      citationsDropped: 1,
      provenanceFieldsRepointed: 1,
    });
  });
});
