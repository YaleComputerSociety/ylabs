import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  parsePublicDescriptionAuditArgs,
  writePublicDescriptionAuditOutput,
} from '../publicResearchEntityDescriptionAudit';

describe('publicResearchEntityDescriptionAudit', () => {
  it('parses strict sample output options', () => {
    expect(
      parsePublicDescriptionAuditArgs([
        '--strict',
        '--include-samples',
        '--sample-limit=10',
        '--output=/tmp/public-description-audit.json',
      ]),
    ).toEqual({
      strict: true,
      includeSamples: true,
      sampleLimit: 10,
      output: '/tmp/public-description-audit.json',
    });
  });

  it('rejects unknown and malformed arguments', () => {
    expect(() => parsePublicDescriptionAuditArgs(['--sample-limit=-1'])).toThrow(
      '--sample-limit must be a non-negative integer',
    );
    expect(() => parsePublicDescriptionAuditArgs(['--unknown'])).toThrow(
      'Unknown argument: --unknown',
    );
  });

  it('writes JSON reports under the guarded temporary root', () => {
    const output = path.join(os.tmpdir(), `ylabs-public-description-audit-${process.pid}.json`);
    writePublicDescriptionAuditOutput({ pass: true }, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual({ pass: true });
    fs.unlinkSync(output);
  });
});
