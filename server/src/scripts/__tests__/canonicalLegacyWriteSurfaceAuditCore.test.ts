import { describe, expect, it } from 'vitest';
import {
  buildLegacyWriteSurfaceReport,
  isCommentOnlyLine,
  parseLegacyWriteSurfaceArgs,
  scanLegacyWriteSurface,
} from '../canonicalLegacyWriteSurfaceAuditCore';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

describe('scanLegacyWriteSurface', () => {
  it('flags raw retired-collection access and retired-model writes', () => {
    const scan = scanLegacyWriteSurface([
      { relPath: 'services/x.ts', content: "await db.collection('research_groups').insertOne(doc);" },
      { relPath: 'services/y.ts', content: 'await Paper.bulkWrite(ops);' },
    ]);
    const ruleIds = scan.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain('retiredCollectionAccess');
    expect(ruleIds).toContain('retiredModelWrite');
    expect(scan.actionableTotal).toBe(2);
  });

  it('flags a legacy ownership-field write as actionable but allowlists model schema definitions', () => {
    const scan = scanLegacyWriteSurface([
      { relPath: 'services/listingService.ts', content: '    researchGroupId: researchEntityId,' },
      { relPath: 'models/listing.ts', content: '    researchGroupId: {' },
    ]);
    const byFile = new Map(scan.findings.map((finding) => [finding.file, finding]));
    expect(byFile.get('services/listingService.ts')?.allowlisted).toBe(false);
    expect(byFile.get('models/listing.ts')?.allowlisted).toBe(true);
    expect(scan.actionableTotal).toBe(1);
  });

  it('does not flag retired identifiers that appear only in comments', () => {
    const scan = scanLegacyWriteSurface([
      {
        relPath: 'scrapers/z.ts',
        content: ' *   - acceptingUndergrads: still emitted for legacy compatibility only.',
      },
    ]);
    expect(scan.actionableTotal).toBe(0);
  });

  it('does not flag retired field names used as string values rather than object keys', () => {
    const scan = scanLegacyWriteSurface([
      { relPath: 'scrapers/z.ts', content: "  emitObservation({ field: 'acceptingUndergrads' });" },
      { relPath: 'services/w.ts', content: "  const RETIRED = ['acceptingUndergrads', 'openness'];" },
    ]);
    expect(scan.actionableTotal).toBe(0);
  });
});

describe('buildLegacyWriteSurfaceReport', () => {
  it('is clean only when source, collections, and models are all clear', () => {
    const scan = scanLegacyWriteSurface([]);
    const clean = buildLegacyWriteSurfaceReport({
      environment: 'development',
      databaseName: 'Development',
      generatedAt: GENERATED_AT,
      scan,
      retiredCollections: [{ collectionName: 'papers', exists: true, documentCount: 0 }],
      retiredModels: [{ modelName: 'Paper', registered: false }],
    });
    expect(clean.summary.clean).toBe(true);

    const dirty = buildLegacyWriteSurfaceReport({
      environment: 'development',
      databaseName: 'Development',
      generatedAt: GENERATED_AT,
      scan,
      retiredCollections: [{ collectionName: 'papers', exists: true, documentCount: 3 }],
      retiredModels: [{ modelName: 'Paper', registered: false }],
    });
    expect(dirty.summary.clean).toBe(false);
    expect(dirty.summary.retiredCollectionsWithData).toBe(1);
  });

  it('separates actionable findings from allowlisted findings', () => {
    const scan = scanLegacyWriteSurface([
      { relPath: 'services/listingService.ts', content: '    researchGroupId: researchEntityId,' },
      { relPath: 'models/listing.ts', content: '    researchGroupId: {' },
    ]);
    const report = buildLegacyWriteSurfaceReport({
      environment: 'development',
      databaseName: 'Development',
      generatedAt: GENERATED_AT,
      scan,
      retiredCollections: [],
      retiredModels: [],
    });
    expect(report.actionableFindings).toHaveLength(1);
    expect(report.allowlistedFindings).toHaveLength(1);
    expect(report.summary.clean).toBe(false);
  });
});

describe('helpers', () => {
  it('recognizes comment-only lines', () => {
    expect(isCommentOnlyLine('  // legacy')).toBe(true);
    expect(isCommentOnlyLine(' * doc')).toBe(true);
    expect(isCommentOnlyLine('  researchGroupId: x,')).toBe(false);
  });

  it('parses and validates arguments', () => {
    expect(() => parseLegacyWriteSurfaceArgs([])).toThrow('--environment is required');
    expect(parseLegacyWriteSurfaceArgs(['--environment', 'development'])).toEqual({
      environment: 'development',
    });
  });
});
