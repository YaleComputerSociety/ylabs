import { describe, expect, it } from 'vitest';

import { personWebsiteShareKey } from '../../scrapers/overSharedPersonWebsite';
import {
  REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
  identifiersAssertingOverSharedWebsites,
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

    const identifiers = identifiersAssertingOverSharedWebsites(
      [
        { entityKey: 'dept:fixture:b', value: CHROME_PAGE },
        { entityKey: 'dept:fixture:b', value: CHROME_PAGE.replace(/\/$/, '') },
        { entityId: 'aaaaaaaaaaaaaaaaaaaaaaaa', value: CHROME_PAGE },
        { entityKey: 'dept:fixture:c', value: LAB_SITE },
      ],
      keys,
    );

    expect(identifiers).toEqual([
      { entityId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      { entityKey: 'dept:fixture:b' },
    ]);
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

  it('requires a snapshot before a website-only apply', () => {
    expect(() =>
      parseRederiveOverSharedPersonWebsitesArgs([
        '--apply',
        REDERIVE_OVER_SHARED_PERSON_WEBSITES_CONFIRM_FLAG,
        '--website-only',
      ]),
    ).toThrow('--snapshot-output');
  });

  it('applies a researcher only when every identity reaching it plans the website alone', () => {
    const website = ['profile', 'profile.websiteUrl'];
    const scope = scopeWebsiteOnlyPlans([
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
    ]);

    expect(scope).toEqual({
      applyIdentifiers: [{ entityKey: 'a1' }],
      websiteOnlyResearcherIds: ['r-website'],
      deferredResearcherIds: ['r-drift'],
    });
  });
});
