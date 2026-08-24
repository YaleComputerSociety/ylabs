import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseSourceFreshnessAuditArgs } from '../auditSourceFreshness';

describe('parseSourceFreshnessAuditArgs', () => {
  it('defaults to no output file', () => {
    expect(parseSourceFreshnessAuditArgs([]).output).toBeUndefined();
  });

  it('resolves a safe .json output path', () => {
    const target = path.join(os.tmpdir(), 'source-freshness.json');
    const options = parseSourceFreshnessAuditArgs([`--output=${target}`]);
    expect(options.output).toBe(path.resolve(target));
  });

  it('rejects an unknown argument', () => {
    expect(() => parseSourceFreshnessAuditArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('rejects an output path outside the allowed roots', () => {
    expect(() => parseSourceFreshnessAuditArgs(['--output=/etc/passwd.json'])).toThrow();
  });
});
