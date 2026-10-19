import { describe, expect, it } from 'vitest';
import {
  cowlesPersonProfileExtractor,
  fdsMemberProfileExtractor,
  macmillanPersonProfileExtractor,
  planCenterMemberProfileResearch,
  staleProfileTextRetractions,
} from '../utils/centerMemberProfileResearch';

const BIOGRAPHY =
  'Fixture Member is an Associate Professor of Synthetic Studies who joined the faculty in 2019.';
const STATEMENT =
  'Fixture Member develops statistical methods for synthetic network data and studies how sampling shapes inference.';

const profileHtml = (inner: string) => `<html><body>
  <div class="author-intro"><h2>Fixture Member</h2></div>
  <div class="author-description">${inner}</div>
</body></html>`;

const fullProfile = profileHtml(`
  <p>${BIOGRAPHY}</p>
  <p><strong>What do you do with Data Science?</strong></p>
  <p>${STATEMENT}</p>
  <p><a href="https://fds.yale.edu/wp-login.php" alt="Edit profile">Edit profile</a></p>
`);

describe('fdsMemberProfileExtractor', () => {
  it('splits the biography from the research statement at the data science heading', () => {
    expect(fdsMemberProfileExtractor(fullProfile)).toEqual({
      biography: BIOGRAPHY,
      researchStatement: STATEMENT,
    });
  });

  it('reads a profile with no statement heading as biography only', () => {
    expect(fdsMemberProfileExtractor(profileHtml(`<p>${BIOGRAPHY}</p>`))).toEqual({
      biography: BIOGRAPHY,
      researchStatement: undefined,
    });
  });

  it('never keeps the edit-profile link or a fragment too short to be evidence', () => {
    const text = fdsMemberProfileExtractor(
      profileHtml(`
        <p>Short line.</p>
        <p><strong>What do you do with Data Science?</strong></p>
        <p><a href="https://fds.yale.edu/wp-login.php">Edit profile</a></p>
      `),
    );
    expect(text).toEqual({ biography: undefined, researchStatement: undefined });
  });

  it('treats a page without the profile description block as unread', () => {
    expect(
      fdsMemberProfileExtractor('<html><body><p>Not a profile.</p></body></html>'),
    ).toBeUndefined();
  });
});

const PROFILE = 'https://fds.yale.edu/people/zz0001/';
const row = { personId: 'person-a', entityId: '64b000000000000000000001', slug: 'synthetic-row' };

describe('planCenterMemberProfileResearch', () => {
  const text = { researchStatement: STATEMENT, biography: BIOGRAPHY };

  it('attaches both texts to the one personal row the identity-joined member leads', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text }],
      joins: [{ profileUrl: PROFILE, personId: 'person-a' }],
      rows: [row],
    });
    expect(plan.emittedRows).toBe(1);
    expect(plan.observations).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: row.entityId,
        entityKey: row.slug,
        sourceUrl: PROFILE,
        field: 'researchSummary',
        value: STATEMENT,
      }),
      expect.objectContaining({ field: 'bio', value: BIOGRAPHY }),
    ]);
  });

  it('states no value for a field the read page no longer carries', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text: { biography: BIOGRAPHY } }],
      joins: [{ profileUrl: PROFILE, personId: 'person-a' }],
      rows: [row],
    });
    expect(plan.observations[0]).toEqual(
      expect.objectContaining({
        field: 'researchSummary',
        value: '',
        assertsNoValueFor: ['researchSummary'],
      }),
    );
  });

  it('emits nothing for an unread page, so a fetch failure retracts nothing', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE }],
      joins: [{ profileUrl: PROFILE, personId: 'person-a' }],
      rows: [row],
    });
    expect(plan.observations).toEqual([]);
    expect(plan.skipped['profile-unread']).toBe(1);
  });

  it('skips a page no identity-proven membership edge joins', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text }],
      joins: [],
      rows: [row],
    });
    expect(plan.observations).toEqual([]);
    expect(plan.skipped['no-identity-joined-member']).toBe(1);
  });

  it('skips a page two people are joined to', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text }],
      joins: [
        { profileUrl: PROFILE, personId: 'person-a' },
        { profileUrl: PROFILE, personId: 'person-b' },
      ],
      rows: [row],
    });
    expect(plan.skipped['ambiguous-member']).toBe(1);
  });

  it('skips a member who leads no personal row or several', () => {
    const none = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text }],
      joins: [{ profileUrl: PROFILE, personId: 'person-a' }],
      rows: [],
    });
    expect(none.skipped['leads-no-research-row']).toBe(1);
    const several = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text }],
      joins: [{ profileUrl: PROFILE, personId: 'person-a' }],
      rows: [row, { ...row, entityId: '64b000000000000000000002', slug: 'synthetic-row-two' }],
    });
    expect(several.observations).toEqual([]);
    expect(several.skipped['leads-several-research-rows']).toBe(1);
  });

  it('skips a row two joined members lead, so neither page overwrites the other', () => {
    const OTHER = 'https://fds.yale.edu/people/zz0002/';
    const plan = planCenterMemberProfileResearch({
      reads: [
        { profileUrl: PROFILE, text },
        { profileUrl: OTHER, text: { biography: BIOGRAPHY } },
      ],
      joins: [
        { profileUrl: PROFILE, personId: 'person-a' },
        { profileUrl: OTHER, personId: 'person-b' },
      ],
      rows: [row, { ...row, personId: 'person-b' }],
    });
    expect(plan.observations).toEqual([]);
    expect(plan.skipped['row-led-by-several-members']).toBe(2);
  });

  it('counts a row led through two roles once', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text }],
      joins: [
        { profileUrl: PROFILE, personId: 'person-a' },
        { profileUrl: PROFILE, personId: 'person-a' },
      ],
      rows: [row, row],
    });
    expect(plan.emittedRows).toBe(1);
  });
});

describe('staleProfileTextRetractions', () => {
  const live = [{ entityId: row.entityId, slug: row.slug, profileUrl: PROFILE }];
  const roster = new Set([PROFILE]);

  it('retracts both texts from a row a read page no longer attaches to', () => {
    const retractions = staleProfileTextRetractions({
      live,
      reads: [{ profileUrl: PROFILE, text: { biography: BIOGRAPHY } }],
      rosterProfileUrls: roster,
      keptEntityIds: new Set(),
    });
    expect(retractions).toEqual([
      expect.objectContaining({
        entityId: row.entityId,
        entityKey: row.slug,
        field: 'researchSummary',
        assertsNoValueFor: ['researchSummary'],
      }),
      expect.objectContaining({ field: 'bio', assertsNoValueFor: ['bio'] }),
    ]);
  });

  it('retracts a row whose page left every roster', () => {
    const retractions = staleProfileTextRetractions({
      live,
      reads: [],
      rosterProfileUrls: new Set(),
      keptEntityIds: new Set(),
    });
    expect(retractions).toHaveLength(2);
  });

  it('keeps text on a row this run attached again or whose page it did not read', () => {
    expect(
      staleProfileTextRetractions({
        live,
        reads: [{ profileUrl: PROFILE, text: {} }],
        rosterProfileUrls: roster,
        keptEntityIds: new Set([row.entityId]),
      }),
    ).toEqual([]);
    expect(
      staleProfileTextRetractions({
        live,
        reads: [{ profileUrl: PROFILE }],
        rosterProfileUrls: roster,
        keptEntityIds: new Set(),
      }),
    ).toEqual([]);
  });
});

describe('Drupal person-page profile extractors', () => {
  const BODY =
    'Fixture Member is a Professor of Synthetic Studies whose research examines how synthetic markets clear under uncertainty.';

  it('reads a Cowles person body and leaves out a link-only call to action', () => {
    const html = `<article class="node node--person"><div class="node__body">
      <p>${BODY}</p>
      <div class="node__all-publications-cta-link"><p><a href="/publications/author/x">Selected Publications</a></p></div>
      <div class="layout__region-item"><p>A project box that sits inside the body but is not the biography.</p></div>
    </div></article>`;
    expect(cowlesPersonProfileExtractor(html)).toEqual({ biography: BODY });
  });

  it('reads a MacMillan person biography', () => {
    const html = `<div class="node__bio"><div class="node__body"><div class="ck-content"><p><span>${BODY}</span></p></div></div></div>`;
    expect(macmillanPersonProfileExtractor(html)).toEqual({ biography: BODY });
  });

  it('reads a person page with no biography block as unread', () => {
    expect(
      macmillanPersonProfileExtractor('<html><body><h1>Fixture Member</h1></body></html>'),
    ).toBe(undefined);
  });
});

describe('one page per field of a row', () => {
  const OTHER = 'https://cowles.yale.edu/people/fixture-member';
  const joins = [
    { profileUrl: PROFILE, personId: 'person-a' },
    { profileUrl: OTHER, personId: 'person-a' },
  ];
  const LONGER_BIOGRAPHY = `${BIOGRAPHY} ${STATEMENT} ${BIOGRAPHY}`;

  it('takes the statement and the fuller biography each from the page that carries it', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [
        { profileUrl: PROFILE, text: { researchStatement: STATEMENT, biography: BIOGRAPHY } },
        { profileUrl: OTHER, text: { biography: LONGER_BIOGRAPHY } },
      ],
      joins,
      rows: [row],
    });
    expect(plan.emittedRows).toBe(1);
    expect(plan.observations).toEqual([
      expect.objectContaining({ field: 'researchSummary', value: STATEMENT, sourceUrl: PROFILE }),
      expect.objectContaining({ field: 'bio', value: LONGER_BIOGRAPHY, sourceUrl: OTHER }),
    ]);
    expect(plan.skipped['row-has-several-profiles']).toBe(1);
  });

  it('emits nothing for a row a competing page this run did not read would reach', () => {
    const competingUnread = planCenterMemberProfileResearch({
      reads: [{ profileUrl: OTHER, text: { biography: LONGER_BIOGRAPHY } }, { profileUrl: PROFILE }],
      joins,
      rows: [row],
    });
    expect(competingUnread.observations).toEqual([]);
    expect(competingUnread.undecidedEntityIds).toEqual(new Set([row.entityId]));
    expect(competingUnread.skipped['row-has-an-unread-profile']).toBe(1);

    const competingNotFetched = planCenterMemberProfileResearch({
      reads: [{ profileUrl: OTHER, text: { biography: LONGER_BIOGRAPHY } }],
      joins,
      rows: [row],
    });
    expect(competingNotFetched.observations).toEqual([]);
    expect(competingNotFetched.undecidedEntityIds).toEqual(new Set([row.entityId]));
  });

  it('leaves a row decided when the unread page would reach no row', () => {
    const plan = planCenterMemberProfileResearch({
      reads: [{ profileUrl: PROFILE, text: { biography: BIOGRAPHY } }, { profileUrl: OTHER }],
      joins: [
        { profileUrl: PROFILE, personId: 'person-a' },
        { profileUrl: OTHER, personId: 'person-b' },
      ],
      rows: [row],
    });
    expect(plan.emittedRows).toBe(1);
    expect(plan.undecidedEntityIds.size).toBe(0);
  });
});
