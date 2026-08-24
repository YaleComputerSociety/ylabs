import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CATALOG_FRESHNESS_THRESHOLDS } from '../../services/programCatalogFreshnessService';
import { parseCatalogFreshnessAuditArgs } from '../auditProgramCatalogFreshness';

describe('parseCatalogFreshnessAuditArgs', () => {
  it('defaults to the config thresholds and no output file', () => {
    const options = parseCatalogFreshnessAuditArgs([]);
    expect(options.output).toBeUndefined();
    expect(options.thresholds).toEqual(DEFAULT_CATALOG_FRESHNESS_THRESHOLDS);
  });

  it('overrides individual thresholds', () => {
    const options = parseCatalogFreshnessAuditArgs([
      '--min-accepting-share=0.1',
      '--max-past-deadline-share=0.8',
      '--min-corpus-size=50',
    ]);
    expect(options.thresholds).toEqual({
      minAcceptingShare: 0.1,
      maxPastDeadlineShare: 0.8,
      minCorpusSize: 50,
    });
  });

  it('resolves a safe .json output path', () => {
    const target = path.join(os.tmpdir(), 'catalog-freshness.json');
    const options = parseCatalogFreshnessAuditArgs([`--output=${target}`]);
    expect(options.output).toBe(path.resolve(target));
  });

  it('rejects a share outside the 0..1 range', () => {
    expect(() => parseCatalogFreshnessAuditArgs(['--min-accepting-share=1.5'])).toThrow();
    expect(() => parseCatalogFreshnessAuditArgs(['--max-past-deadline-share=-0.1'])).toThrow();
    expect(() => parseCatalogFreshnessAuditArgs(['--min-accepting-share=abc'])).toThrow();
  });

  it('rejects a non-integer corpus size', () => {
    expect(() => parseCatalogFreshnessAuditArgs(['--min-corpus-size=-5'])).toThrow();
    expect(() => parseCatalogFreshnessAuditArgs(['--min-corpus-size=3.5'])).toThrow();
  });

  it('rejects an unknown argument', () => {
    expect(() => parseCatalogFreshnessAuditArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('rejects an output path outside the allowed roots', () => {
    expect(() => parseCatalogFreshnessAuditArgs(['--output=/etc/passwd.json'])).toThrow();
  });
});
