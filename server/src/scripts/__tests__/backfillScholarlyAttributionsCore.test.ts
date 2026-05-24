import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  buildScholarlyAttributionBackfillOps,
  parseBackfillScholarlyAttributionsArgs,
  summarizeScholarlyAttributionBackfill,
} from '../backfillScholarlyAttributionsCore';

describe('backfillScholarlyAttributionsCore', () => {
  it('defaults to dry-run mode with a bounded limit', () => {
    expect(parseBackfillScholarlyAttributionsArgs([])).toEqual({
      apply: false,
      limit: 1000,
    });
  });

  it('parses apply and limit options', () => {
    expect(parseBackfillScholarlyAttributionsArgs(['--apply', '--limit=25'])).toEqual({
      apply: true,
      limit: 25,
    });
  });

  it('builds attribution ops from existing scholarly-link user and entity targets', () => {
    const scholarlyLinkId = new mongoose.Types.ObjectId('64f000000000000000000222');
    const userId = new mongoose.Types.ObjectId('64f000000000000000000001');
    const researchEntityId = new mongoose.Types.ObjectId('64f000000000000000000002');

    const result = buildScholarlyAttributionBackfillOps([
      {
        _id: scholarlyLinkId,
        userId,
        researchEntityId,
        discoveredVia: 'OPENALEX',
        sourceUrl: 'https://doi.org/10.5555/example',
        confidence: 0.8,
        observedAt: new Date('2026-05-24T12:00:00Z'),
      },
    ]);

    expect(result.summary).toEqual({
      scanned: 1,
      writeOps: 2,
      skippedMissingLinkId: 0,
      skippedMissingTarget: 0,
    });
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0].updateOne.filter).toMatchObject({
      scholarlyLinkId,
      targetUserId: userId,
      relationshipBasis: 'identity_authorship',
    });
    expect(result.ops[1].updateOne.filter).toMatchObject({
      scholarlyLinkId,
      targetResearchEntityId: researchEntityId,
      relationshipBasis: 'explicit_entity_link',
    });
  });

  it('summarizes dry-run and apply results without pretending dry-run wrote rows', () => {
    expect(
      summarizeScholarlyAttributionBackfill({
        apply: false,
        scanned: 2,
        writeOps: 3,
        skippedMissingLinkId: 0,
        skippedMissingTarget: 1,
      }),
    ).toEqual({
      mode: 'dry-run',
      scanned: 2,
      planned: 3,
      written: 0,
      skippedMissingLinkId: 0,
      skippedMissingTarget: 1,
    });
    expect(
      summarizeScholarlyAttributionBackfill({
        apply: true,
        scanned: 2,
        writeOps: 3,
        skippedMissingLinkId: 0,
        skippedMissingTarget: 1,
      }),
    ).toMatchObject({
      mode: 'apply',
      planned: 3,
      written: 3,
    });
  });
});
