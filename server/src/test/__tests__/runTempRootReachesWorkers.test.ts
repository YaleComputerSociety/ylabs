import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RUN_TEMP_ROOT_PREFIX, runTempRootOwnerPid } from '../runTempRoot';

describe('the run temp root', () => {
  it('is the temp directory every test worker writes into', () => {
    const tempDirectory = path.basename(os.tmpdir());

    expect(tempDirectory.startsWith(RUN_TEMP_ROOT_PREFIX)).toBe(true);
    expect(runTempRootOwnerPid(tempDirectory)).not.toBe(process.pid);
  });
});
