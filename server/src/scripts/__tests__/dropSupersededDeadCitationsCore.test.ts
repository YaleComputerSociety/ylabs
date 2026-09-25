import { describe, expect, it } from 'vitest';
import {
  isRetiredLabMicrositeDrop,
  planDeadCitationDrop,
} from '../dropSupersededDeadCitationsCore';

const dead = (url: string) => ({ url, healthStatus: 'UNAVAILABLE' as const, httpStatusCode: 404 });
const live = (url: string) => ({ url, healthStatus: 'HEALTHY' as const, httpStatusCode: 200 });

const LAB = 'https://medicine.yale.edu/lab/cohn/';
const PROFILE = 'https://medicine.yale.edu/profile/lauren-cohn/';

describe('planDeadCitationDrop', () => {
  it('drops the dead lab microsite and keeps the live profile', () => {
    expect(
      planDeadCitationDrop({
        slug: 'ysm-cohn',
        name: 'Cohn Lab',
        studentVisibilityTier: 'student_ready',
        sourceUrls: [LAB, PROFILE],
        sourceLinkHealth: [dead(LAB), live(PROFILE)],
      }),
      // Asserted on the fields this test protects rather than by whole-object equality: the
      // plan also carries the row's `websiteUrl` now, so the withdrawal can retire the
      // assertion behind a cleared one, and a deep-equal would fail on that key while
      // saying nothing about the drop (#3362).
    ).toMatchObject({
      entitySlug: 'ysm-cohn',
      entityName: 'Cohn Lab',
      studentVisibilityTier: 'student_ready',
      droppedUrls: [LAB],
      keptUrls: [PROFILE],
      clearsWebsiteUrl: false,
    });
  });

  it('clears websiteUrl when it is the dead citation', () => {
    const plan = planDeadCitationDrop({
      slug: 'ysm-cohn',
      websiteUrl: LAB,
      sourceUrls: [LAB, PROFILE],
      sourceLinkHealth: [dead(LAB), live(PROFILE)],
    });
    expect(plan?.clearsWebsiteUrl).toBe(true);
  });

  it('leaves websiteUrl alone when it is not the dead citation', () => {
    const plan = planDeadCitationDrop({
      slug: 'ysm-cohn',
      websiteUrl: PROFILE,
      sourceUrls: [LAB, PROFILE],
      sourceLinkHealth: [dead(LAB), live(PROFILE)],
    });
    expect(plan?.clearsWebsiteUrl).toBe(false);
  });

  // The safety property: #2638 holds an all-dead row out of student_ready, so a
  // repair that emptied the citation list would demote the row it is improving.
  it('refuses when dropping would leave no live citation', () => {
    expect(
      planDeadCitationDrop({
        slug: 'x',
        sourceUrls: [LAB],
        sourceLinkHealth: [dead(LAB)],
      }),
    ).toBeNull();
    expect(
      planDeadCitationDrop({
        slug: 'x',
        sourceUrls: [LAB, 'https://medicine.yale.edu/lab/other/'],
        sourceLinkHealth: [dead(LAB), dead('https://medicine.yale.edu/lab/other/')],
      }),
    ).toBeNull();
  });

  // An unprobed citation is silence, so it neither gets dropped nor counts as the
  // survivor that licenses a drop... it counts as live, matching isKnownDeadSourceUrl.
  it('never drops an unprobed citation', () => {
    expect(planDeadCitationDrop({ slug: 'x', sourceUrls: [LAB, PROFILE] })).toBeNull();
    expect(
      planDeadCitationDrop({
        slug: 'x',
        sourceUrls: [LAB, PROFILE],
        sourceLinkHealth: [{ url: LAB, healthStatus: 'UNKNOWN', httpStatusCode: 403 }],
      }),
    ).toBeNull();
  });

  it('treats an unprobed citation as the surviving live one', () => {
    const plan = planDeadCitationDrop({
      slug: 'x',
      sourceUrls: [LAB, PROFILE],
      sourceLinkHealth: [dead(LAB)],
    });
    expect(plan?.droppedUrls).toEqual([LAB]);
    expect(plan?.keptUrls).toEqual([PROFILE]);
  });

  it('returns null with no slug, no citations, or nothing dead', () => {
    expect(planDeadCitationDrop({ sourceUrls: [LAB], sourceLinkHealth: [dead(LAB)] })).toBeNull();
    expect(planDeadCitationDrop({ slug: 'x' })).toBeNull();
    expect(
      planDeadCitationDrop({ slug: 'x', sourceUrls: [PROFILE], sourceLinkHealth: [live(PROFILE)] }),
    ).toBeNull();
    expect(planDeadCitationDrop({ slug: 'x', sourceUrls: [null, 7] })).toBeNull();
  });
});

describe('isRetiredLabMicrositeDrop', () => {
  // This shape must never be read as a departure: YSM retired the /lab/ namespace
  // while the people stayed. Joan Steitz is still at Yale.
  it('recognises a retired lab microsite beside a live profile', () => {
    const plan = planDeadCitationDrop({
      slug: 'ysm-steitz',
      sourceUrls: [
        'https://medicine.yale.edu/lab/steitz/',
        'https://medicine.yale.edu/profile/joan-steitz/',
      ],
      sourceLinkHealth: [
        dead('https://medicine.yale.edu/lab/steitz/'),
        live('https://medicine.yale.edu/profile/joan-steitz/'),
      ],
    })!;
    expect(isRetiredLabMicrositeDrop(plan)).toBe(true);
  });

  it('does not claim the shape when no profile survives', () => {
    const plan = planDeadCitationDrop({
      slug: 'x',
      sourceUrls: ['https://medicine.yale.edu/lab/x/', 'https://example.org/'],
      sourceLinkHealth: [dead('https://medicine.yale.edu/lab/x/'), live('https://example.org/')],
    })!;
    expect(isRetiredLabMicrositeDrop(plan)).toBe(false);
  });

  it('does not claim the shape when the dropped url is not a lab microsite', () => {
    const plan = planDeadCitationDrop({
      slug: 'x',
      sourceUrls: ['https://statistics.yale.edu/profile/elisa-celis/', 'https://example.org/'],
      sourceLinkHealth: [
        dead('https://statistics.yale.edu/profile/elisa-celis/'),
        live('https://example.org/'),
      ],
    })!;
    expect(isRetiredLabMicrositeDrop(plan)).toBe(false);
  });
});

describe('a dead websiteUrl the row does not also cite', () => {
  const health = (url: string) => [{ url, healthStatus: 'NOT_FOUND', httpStatusCode: 404 }];

  // `dead` is derived from `sourceUrls`, so a dead `websiteUrl` outside that list was never
  // in it and the old membership test reached none of the rows that hold one. Measured on
  // Development: all 3 such rows keep it outside `sourceUrls`, 2 of them served (#3362).
  it('is cleared on its own verdict rather than on membership in the citation list', () => {
    const plan = planDeadCitationDrop({
      slug: 'a-lab',
      websiteUrl: 'https://dead.example.edu/lab/',
      sourceUrls: ['https://live.example.edu/profile/someone/'],
      sourceLinkHealth: health('https://dead.example.edu/lab/'),
    });
    expect(plan).not.toBeNull();
    expect(plan?.clearsWebsiteUrl).toBe(true);
    // Nothing to drop from the citation list, which must not discard the row.
    expect(plan?.droppedUrls).toEqual([]);
    expect(plan?.keptUrls).toEqual(['https://live.example.edu/profile/someone/']);
  });

  it('still plans nothing when neither the citations nor the websiteUrl are known dead', () => {
    expect(
      planDeadCitationDrop({
        slug: 'a-lab',
        websiteUrl: 'https://live.example.edu/lab/',
        sourceUrls: ['https://live.example.edu/profile/someone/'],
        sourceLinkHealth: health('https://other.example.edu/x/'),
      }),
    ).toBeNull();
  });

  // The #2638 safety property is unchanged: a row with no surviving live citation is left
  // alone, because emptying its list would demote the row the repair means to improve.
  it('leaves a row with no surviving live citation alone', () => {
    expect(
      planDeadCitationDrop({
        slug: 'a-lab',
        websiteUrl: 'https://dead.example.edu/lab/',
        sourceUrls: [],
        sourceLinkHealth: health('https://dead.example.edu/lab/'),
      }),
    ).toBeNull();
  });
});
