import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  researchEntityGateProjection,
  serializeEntityForDedupe,
} from '../studentVisibilityGateService';

const SERVICE = path.resolve(__dirname, '../studentVisibilityGateService.ts');

/**
 * Every projection feeding a decision that consults link health has to select
 * `sourceLinkHealth`. The field arrived for `hasLiveSourceCitation` (#2635) but two
 * further readers were left blind: a second `ResearchEntity.find(...).select(...)`
 * for the profile-area duplicate lookup, and `serializeEntityForDedupe`, which is
 * what a PI-dedupe decision actually sees. A dedupe survivor could be chosen on the
 * strength of a URL the corpus already knows is a 404 (#2531).
 *
 * Pinned by reading the source because the defect is an omission from a projection
 * string, which no behavioural test over a fixture would notice.
 */
describe('gate projections stay health-aware', () => {
  it('selects sourceLinkHealth in the main gate projection', () => {
    expect(researchEntityGateProjection).toContain('sourceLinkHealth');
  });

  it('selects sourceLinkHealth in every ResearchEntity projection in the gate service', () => {
    const source = fs.readFileSync(SERVICE, 'utf8');
    const selects = [...source.matchAll(/\.select\(\s*\n?\s*'([^']+)'/g)].map((match) => match[1]);
    const entityShaped = selects.filter((projection) =>
      /\bwebsiteUrl\b|\bsourceUrls\b/.test(projection),
    );

    expect(entityShaped.length).toBeGreaterThan(0);
    const blind = entityShaped.filter((projection) => !projection.includes('sourceLinkHealth'));
    expect(blind).toEqual([]);
  });

  it('carries sourceLinkHealth through to what a dedupe decision sees', () => {
    const serialized = serializeEntityForDedupe({
      _id: '000000000000000000000001',
      slug: 'fixture-lab',
      websiteUrl: 'https://lab.example.yale.edu/',
      sourceUrls: ['https://lab.example.yale.edu/'],
      sourceLinkHealth: [
        {
          url: 'https://lab.example.yale.edu/',
          healthStatus: 'UNAVAILABLE',
          httpStatusCode: 404,
          checkedAt: new Date().toISOString(),
        },
      ],
    });

    expect(serialized.sourceLinkHealth).toBeDefined();
  });

  it('declares sourceLinkHealth on the reach-out credit entity param', () => {
    const source = fs.readFileSync(SERVICE, 'utf8');
    const signature = source.slice(
      source.indexOf('export function reachOutPlausibleSignalCreditsActionEvidence'),
    );
    const entityParam = signature.slice(0, signature.indexOf('}): boolean'));
    expect(entityParam).toContain('sourceLinkHealth');
  });
});
