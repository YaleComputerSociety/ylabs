import { describe, expect, it } from 'vitest';

import {
  citedHostnames,
  planPrivateAddressRouting,
  type HostResolutionKind,
} from '../reclassifyPrivateAddressCitationsCore';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const PRIVATE_URL = 'https://internal.example.edu/lab/';
const PUBLIC_URL = 'https://medicine.yale.edu/profile/a-person/';

const resolutions = (entries: Record<string, HostResolutionKind>) =>
  new Map<string, HostResolutionKind>(Object.entries(entries));

const entryFor = (plan: ReturnType<typeof planPrivateAddressRouting>, url: string) =>
  plan?.sourceLinkHealth.find((entry) => entry.url === url);

describe('citedHostnames', () => {
  it('reads every citation the gate can read, including provenance', () => {
    expect(
      citedHostnames({
        websiteUrl: PRIVATE_URL,
        sourceUrls: [PUBLIC_URL],
        fieldProvenance: { name: { sourceUrl: 'https://other.example.edu/x' } },
      }).sort(),
    ).toEqual(['internal.example.edu', 'medicine.yale.edu', 'other.example.edu']);
  });
});

describe('planPrivateAddressRouting', () => {
  it('flags an existing verdict without touching its liveness axis', () => {
    const plan = planPrivateAddressRouting(
      {
        slug: 'a-lab',
        studentVisibilityTier: 'student_ready',
        websiteUrl: PRIVATE_URL,
        sourceLinkHealth: [{ url: PRIVATE_URL, healthStatus: 'UNKNOWN', checkedAt: NOW }],
      },
      resolutions({ 'internal.example.edu': 'private-address' }),
      NOW,
    );
    expect(plan?.flaggedUrls).toEqual([PRIVATE_URL]);
    expect(plan?.addedEntries).toEqual([]);
    expect(entryFor(plan, PRIVATE_URL)).toMatchObject({
      healthStatus: 'UNKNOWN',
      privateAddressHost: true,
    });
  });

  it('adds an entry for a private-address citation nobody has probed', () => {
    const plan = planPrivateAddressRouting(
      { slug: 'a-lab', websiteUrl: PRIVATE_URL },
      resolutions({ 'internal.example.edu': 'private-address' }),
      NOW,
    );
    expect(plan?.addedEntries).toEqual([PRIVATE_URL]);
    expect(entryFor(plan, PRIVATE_URL)).toEqual({
      url: PRIVATE_URL,
      healthStatus: 'UNKNOWN',
      privateAddressHost: true,
      lastAttemptedAt: NOW,
    });
  });

  it('leaves a publicly resolving host alone', () => {
    expect(
      planPrivateAddressRouting(
        {
          slug: 'a-lab',
          websiteUrl: PUBLIC_URL,
          sourceLinkHealth: [
            { url: PUBLIC_URL, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: NOW },
          ],
        },
        resolutions({ 'medicine.yale.edu': 'public' }),
        NOW,
      ),
    ).toBeNull();
  });

  it('plans nothing on a re-run, because every arm is keyed on current state', () => {
    const entity = {
      slug: 'a-lab',
      websiteUrl: PRIVATE_URL,
      sourceLinkHealth: [
        { url: PRIVATE_URL, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: NOW },
      ],
    };
    expect(
      planPrivateAddressRouting(
        entity,
        resolutions({ 'internal.example.edu': 'private-address' }),
        NOW,
      ),
    ).toBeNull();
  });

  it('releases a flagged citation once its host resolves publicly', () => {
    const plan = planPrivateAddressRouting(
      {
        slug: 'a-lab',
        websiteUrl: PRIVATE_URL,
        sourceLinkHealth: [
          { url: PRIVATE_URL, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: NOW },
        ],
      },
      resolutions({ 'internal.example.edu': 'public' }),
      NOW,
    );
    expect(plan?.releasedUrls).toEqual([PRIVATE_URL]);
    expect(entryFor(plan, PRIVATE_URL)?.privateAddressHost).toBeUndefined();
  });

  // A lookup that failed is not evidence the public internet can now reach the
  // host, so it must settle nothing in either direction.
  it.each<HostResolutionKind>(['unresolvable', 'resolver-failure'])(
    'settles nothing on a %s verdict',
    (kind) => {
      expect(
        planPrivateAddressRouting(
          {
            slug: 'a-lab',
            websiteUrl: PRIVATE_URL,
            sourceLinkHealth: [
              {
                url: PRIVATE_URL,
                healthStatus: 'UNKNOWN',
                privateAddressHost: true,
                checkedAt: NOW,
              },
            ],
          },
          resolutions({ 'internal.example.edu': kind }),
          NOW,
        ),
      ).toBeNull();
      expect(
        planPrivateAddressRouting(
          { slug: 'a-lab', websiteUrl: PRIVATE_URL },
          resolutions({ 'internal.example.edu': kind }),
          NOW,
        ),
      ).toBeNull();
    },
  );

  it('keeps verdicts for citations it did not visit', () => {
    const stale = { url: 'https://retired.example.edu/x', healthStatus: 'UNAVAILABLE' as const };
    const plan = planPrivateAddressRouting(
      {
        slug: 'a-lab',
        websiteUrl: PRIVATE_URL,
        sourceLinkHealth: [stale, { url: PRIVATE_URL, healthStatus: 'UNKNOWN' }],
      },
      resolutions({ 'internal.example.edu': 'private-address' }),
      NOW,
    );
    expect(plan?.sourceLinkHealth).toHaveLength(2);
    expect(entryFor(plan, stale.url)).toEqual(stale);
  });

  it('matches a stored verdict spelled differently from the citation', () => {
    const plan = planPrivateAddressRouting(
      {
        slug: 'a-lab',
        websiteUrl: 'http://www.internal.example.edu/lab',
        sourceLinkHealth: [{ url: PRIVATE_URL, healthStatus: 'UNKNOWN' }],
      },
      resolutions({ 'www.internal.example.edu': 'private-address' }),
      NOW,
    );
    expect(plan?.addedEntries).toEqual([]);
    expect(plan?.sourceLinkHealth).toHaveLength(1);
    expect(entryFor(plan, PRIVATE_URL)?.privateAddressHost).toBe(true);
  });
});
