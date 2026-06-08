import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildPathwayQualityAudit } from '../pathwayQualityAuditCore';
import {
  buildPathwayQualityAuditOutput,
  parsePathwayQualityAuditArgs,
  writePathwayQualityAuditOutput,
} from '../pathwayQualityAudit';

describe('buildPathwayQualityAudit', () => {
  it('summarizes pathway skew and evidence gaps', () => {
    const report = buildPathwayQualityAudit({
      pathways: [
        {
          id: 'pathway-1',
          researchEntityId: 'entity-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'WEAK',
          derivationKey: 'visibility-repair:official-profile-outreach:entity-1',
          sourceUrls: ['https://medicine.yale.edu/profile/example/'],
          sourceEvidenceIds: [],
        },
        {
          id: 'pathway-2',
          researchEntityId: 'entity-2',
          pathwayType: 'POSTED_ROLE',
          status: 'ACTIVE',
          evidenceStrength: 'DIRECT',
          derivationKey: 'listing:listing-1:POSTED_ROLE',
          sourceUrls: ['https://example.test/listing'],
          sourceEvidenceIds: ['obs-1'],
        },
      ],
      routes: [
        {
          id: 'route-1',
          researchEntityId: 'entity-1',
          routeType: 'OFFICIAL_APPLICATION',
          sourceUrl: 'https://example.test/apply',
        },
      ],
      listings: [{ id: 'listing-1', researchEntityId: 'entity-2', hasPostedOpportunity: false }],
      entityContexts: [
        {
          researchEntityId: 'entity-1',
          sourceUrlCount: 1,
          leadCount: 0,
          accessSignalCount: 0,
          publicContactRouteCount: 0,
        },
      ],
      sampleLimit: 5,
    });

    expect(report.summary).toMatchObject({
      activePathways: 2,
      officialApplicationRoutes: 1,
      routesWithoutLinkedPathway: 1,
      activeListingsWithoutPostedOpportunity: 1,
      weakPathwaysNeedingEvidence: 1,
      missingSourceEvidenceIds: 1,
    });
    expect(report.byType).toMatchObject({
      EXPLORATORY_CONTACT: 1,
      POSTED_ROLE: 1,
    });
    expect(report.byDerivationPrefix).toMatchObject({
      'visibility-repair': 1,
      listing: 1,
    });
    expect(report.samples.weakPathwaysNeedingEvidence[0].missingContext).toEqual([
      'source_evidence',
      'lead_pi',
      'access_signal',
      'public_contact_route',
    ]);
  });

  it('parses sample limit and output flags for review artifact generation', () => {
    expect(
      parsePathwayQualityAuditArgs([
        '--sample-limit=10',
        '--output',
        '/tmp/ylabs-pathway-quality.json',
      ]),
    ).toEqual({
      sampleLimit: 10,
      output: '/tmp/ylabs-pathway-quality.json',
    });
    expect(() => parsePathwayQualityAuditArgs(['prod'])).toThrow(
      /Unknown pathway quality audit argument: prod/,
    );
    expect(() => parsePathwayQualityAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit requires a non-negative integer/,
    );
    expect(() => parsePathwayQualityAuditArgs(['--sample-limit=9007199254740992'])).toThrow(
      /--sample-limit requires a non-negative integer/,
    );
    expect(() => parsePathwayQualityAuditArgs(['--output', '--sample-limit=0'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parsePathwayQualityAuditArgs(['--output=--sample-limit=0'])).toThrow(
      /--output requires a path/,
    );
  });

  it('writes the pathway quality artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-pathway-quality-'));
    const output = path.join(dir, 'pathway-quality.json');
    writePathwayQualityAuditOutput(
      {
        summary: {
          activePathways: 2,
          weakPathwaysNeedingEvidence: 1,
        },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      summary: {
        activePathways: 2,
        weakPathwaysNeedingEvidence: 1,
      },
    });
  });

  it('wraps pathway quality artifacts with target metadata and parsed options', () => {
    const output = buildPathwayQualityAuditOutput(
      {
        summary: {
          activePathways: 2,
          weakPathwaysNeedingEvidence: 1,
        },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          sampleLimit: 10,
          output: '/tmp/ylabs-pathway-quality.json',
        },
      },
    );

    expect(output).toEqual({
      summary: {
        activePathways: 2,
        weakPathwaysNeedingEvidence: 1,
      },
      environment: 'beta',
      db: 'Beta',
      options: {
        sampleLimit: 10,
        output: '/tmp/ylabs-pathway-quality.json',
      },
    });
  });
});
