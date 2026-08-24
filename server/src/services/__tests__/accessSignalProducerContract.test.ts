import { describe, expect, it } from 'vitest';
import { MATERIALIZED_ACCESS_SIGNAL_TYPES } from '../../scrapers/accessMaterializer';
import { STATUS_DETERMINING_SIGNAL_TYPES, computeStatus } from '../accessSummaryService';

describe('access-signal producer contract (#1303)', () => {
  it('every status-determining signal type has a live materializer producer', () => {
    const produced = new Set<string>(MATERIALIZED_ACCESS_SIGNAL_TYPES);
    const orphans = STATUS_DETERMINING_SIGNAL_TYPES.filter((type) => !produced.has(type));
    expect(orphans).toEqual([]);
  });

  it('each status-determining signal type actually drives a non-fallback status', () => {
    for (const type of STATUS_DETERMINING_SIGNAL_TYPES) {
      const status = computeStatus(new Set([type]), new Map([[type, 0.9]]));
      expect(status).not.toBe('unknown');
      expect(status).not.toBe('evidence-backed');
    }
  });

  it('a POSTED_OPENING signal no longer resolves to a top-tier status', () => {
    expect(computeStatus(new Set(['POSTED_OPENING']), new Map([['POSTED_OPENING', 0.9]]))).toBe(
      'evidence-backed',
    );
    expect(computeStatus(new Set(), new Map())).toBe('unknown');
  });
});
