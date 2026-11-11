import { describe, expect, it } from 'vitest';

import { personWebsiteShareKey } from '../../scrapers/overSharedPersonWebsite';
import {
  REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
  condemnedPersonWebsiteRule,
  identifiersAssertingCondemnedWebsites,
  isOverSharedWebsiteIn,
  parseRederiveOverSharedPersonWebsitesArgs,
  scopeWebsiteOnlyPlans,
  summarizeRederiveVisits,
} from '../rederiveOverSharedPersonWebsitesCore';

const CHROME_PAGE = 'https://school.example.edu/about/fixture-stories/';
const LAB_SITE = 'https://school.example.edu/lab/fixture-lab/';

describe('observations:rederive-over-shared-person-websites planning (#5645)', () => {
  it('refuses an apply without the confirm flag and unknown arguments', () => {
    expect(() => parseRederiveOverSharedPersonWebsitesArgs(['--apply'])).toThrow(
      REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
    );
    expect(() => parseRederiveOverSharedPersonWebsitesArgs(['--force-llm'])).toThrow(
      'Unknown argument',
    );
    expect(
      parseRederiveOverSharedPersonWebsitesArgs([
        '--apply',
        REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
        '--limit=5',
      ]),
    ).toEqual({ apply: true, confirmed: true, limit: 5 });
  });

  it('visits each identity asserting an over-shared website once, in either identity form', () => {
    const keys = new Set([personWebsiteShareKey(CHROME_PAGE) as string]);

    const identifiers = identifiersAssertingCondemnedWebsites(
      [
        { entityKey: 'dept:fixture:b', value: CHROME_PAGE },
        { entityKey: 'dept:fixture:b', value: CHROME_PAGE.replace(/\/$/, '') },
        { entityId: 'aaaaaaaaaaaaaaaaaaaaaaaa', value: CHROME_PAGE },
        { entityKey: 'dept:fixture:c', value: LAB_SITE },
      ],
      isOverSharedWebsiteIn(keys),
    );

    expect(identifiers).toEqual([
      { entityId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      { entityKey: 'dept:fixture:b' },
    ]);
  });

  it('selects by the inadmissible person-website rule under --inadmissible (#5657)', () => {
    const directions = 'https://www.google.com/maps?daddr=1.5,-2.5&directionsMode=driving';
    const keys = new Set([personWebsiteShareKey(CHROME_PAGE) as string]);
    expect(() =>
      parseRederiveOverSharedPersonWebsitesArgs(['--dry-run', '--inadmissible']),
    ).toThrow('--inadmissible requires --website-only');
    expect(() =>
      parseRederiveOverSharedPersonWebsitesArgs([
        '--apply',
        REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
        '--inadmissible',
      ]),
    ).toThrow('--inadmissible requires --website-only');
    const args = parseRederiveOverSharedPersonWebsitesArgs([
      '--dry-run',
      '--website-only',
      '--inadmissible',
    ]);
    expect(args).toEqual({ apply: false, confirmed: false, websiteOnly: true, inadmissible: true });
    const observations = [
      { entityKey: 'dept:fixture:b', value: CHROME_PAGE },
      { entityKey: 'dept:fixture:c', value: directions },
      { entityKey: 'dept:fixture:d', value: LAB_SITE },
    ];

    expect(
      identifiersAssertingCondemnedWebsites(observations, condemnedPersonWebsiteRule(args, keys)),
    ).toEqual([{ entityKey: 'dept:fixture:c' }]);
    expect(
      identifiersAssertingCondemnedWebsites(observations, condemnedPersonWebsiteRule({}, keys)),
    ).toEqual([{ entityKey: 'dept:fixture:b' }]);
  });

  it('summarizes visits by researcher reached, writes and skips', () => {
    expect(
      summarizeRederiveVisits([
        {
          identifier: { entityKey: 'a' },
          researcherId: 'r1',
          fieldsWritten: 1,
          plannedPaths: ['profile', 'profile.websiteUrl'],
        },
        { identifier: { entityKey: 'b' }, researcherId: 'r1', fieldsWritten: 0 },
        { identifier: { entityKey: 'c' }, fieldsWritten: 0, skipped: 'office-mailbox-user-key' },
        { identifier: { entityKey: 'd' }, fieldsWritten: 0, error: 'boom' },
      ]),
    ).toEqual({
      visited: 4,
      reachedResearchers: 1,
      withFieldsWritten: 1,
      fieldsWritten: 1,
      skippedByReason: { 'office-mailbox-user-key': 1 },
      plannedPathCounts: { 'profile.websiteUrl': 1 },
      errors: 1,
    });
  });

  it('requires a snapshot and a deferred-ids file before a website-only apply', () => {
    const websiteOnlyApply = [
      '--apply',
      REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
      '--website-only',
    ];
    expect(() =>
      parseRederiveOverSharedPersonWebsitesArgs([
        ...websiteOnlyApply,
        '--deferred-output',
        '/tmp/deferred.json',
      ]),
    ).toThrow('--snapshot-output');
    expect(() =>
      parseRederiveOverSharedPersonWebsitesArgs([
        ...websiteOnlyApply,
        '--snapshot-output',
        '/tmp/snapshot.json',
      ]),
    ).toThrow('--deferred-output');
    expect(
      parseRederiveOverSharedPersonWebsitesArgs([
        ...websiteOnlyApply,
        '--snapshot-output',
        '/tmp/snapshot.json',
        '--deferred-output',
        '/tmp/deferred.json',
      ]),
    ).toMatchObject({ apply: true, websiteOnly: true });
  });

  it('applies a researcher only when every identity reaching it plans the website alone', () => {
    const website = ['profile', 'profile.websiteUrl'];
    const scope = scopeWebsiteOnlyPlans(
      [
        {
          identifier: { entityKey: 'a1' },
          researcherId: 'r-website',
          fieldsWritten: 1,
          plannedPaths: website,
        },
        {
          identifier: { entityKey: 'a2' },
          researcherId: 'r-website',
          fieldsWritten: 0,
          plannedPaths: [],
        },
        {
          identifier: { entityKey: 'b1' },
          researcherId: 'r-drift',
          fieldsWritten: 1,
          plannedPaths: website,
        },
        {
          identifier: { entityKey: 'b2' },
          researcherId: 'r-drift',
          fieldsWritten: 1,
          plannedPaths: ['profile', 'profile.title'],
        },
        {
          identifier: { entityKey: 'c1' },
          researcherId: 'r-none',
          fieldsWritten: 0,
          plannedPaths: [],
        },
        { identifier: { entityKey: 'd1' }, fieldsWritten: 0, skipped: 'office-mailbox-user-key' },
      ],
      new Set(['r-website', 'r-drift']),
    );

    expect(scope).toEqual({
      applyIdentifiers: [{ entityKey: 'a1' }],
      websiteOnlyResearcherIds: ['r-website'],
      deferredResearcherIds: ['r-drift'],
    });
  });

  it('defers a researcher whose website plan also writes outside its planned paths', () => {
    const scope = scopeWebsiteOnlyPlans(
      [
        {
          identifier: { entityKey: 'a1' },
          researcherId: 'r-website',
          fieldsWritten: 1,
          plannedPaths: ['profile', 'profile.websiteUrl'],
        },
        {
          identifier: { entityKey: 'b1' },
          researcherId: 'r-hidden-write',
          fieldsWritten: 2,
          plannedPaths: ['profile', 'profile.websiteUrl'],
        },
        {
          identifier: { entityKey: 'c1' },
          researcherId: 'r-hidden-only',
          fieldsWritten: 1,
          plannedPaths: [],
        },
      ],
      new Set(['r-website', 'r-hidden-write', 'r-hidden-only']),
    );

    expect(scope).toEqual({
      applyIdentifiers: [{ entityKey: 'a1' }],
      websiteOnlyResearcherIds: ['r-website'],
      deferredResearcherIds: ['r-hidden-only', 'r-hidden-write'],
    });
  });

  it('defers a website-only researcher that does not store an over-shared website', () => {
    const website = ['profile', 'profile.websiteUrl'];
    const scope = scopeWebsiteOnlyPlans(
      [
        {
          identifier: { entityKey: 'a1' },
          researcherId: 'r-stores',
          fieldsWritten: 1,
          plannedPaths: website,
        },
        {
          identifier: { entityKey: 'b1' },
          researcherId: 'r-other-site',
          fieldsWritten: 1,
          plannedPaths: website,
        },
      ],
      new Set(['r-stores']),
    );

    expect(scope).toEqual({
      applyIdentifiers: [{ entityKey: 'a1' }],
      websiteOnlyResearcherIds: ['r-stores'],
      deferredResearcherIds: ['r-other-site'],
    });
  });
});
