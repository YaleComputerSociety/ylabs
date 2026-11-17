import fs from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServerBundle, type ServerBundle } from '../test/serverBundle';
import {
  SERVED_CHECK_NONCE_HEADER,
  SYNTHETIC_STUDENT_NETID_PREFIX,
} from '../utils/servedCheckStudentSession';

const STUDENT_CHECK_MODULES = [
  'src/utils/servedCheckStudentSession.ts',
  'src/scripts/servedCheckStudent.ts',
  'src/scripts/servedCheckStudentCore.ts',
];

describe('the production server build carries no served-check student hook (#6079)', () => {
  let bundle: ServerBundle;

  beforeAll(async () => {
    bundle = await buildServerBundle('served-check-student-hook');
  });

  afterAll(() => bundle?.remove());

  it('bundles none of the student check modules into the deployed entry', () => {
    const bundled = bundle.sourceModules();
    expect(bundled).toContain('src/app.ts');
    expect(bundled.filter((module) => STUDENT_CHECK_MODULES.includes(module))).toEqual([]);
  });

  it('carries neither the nonce header nor the synthetic netid prefix in the built code', () => {
    const code = fs.readFileSync(bundle.entryPath, 'utf8');
    expect(code).not.toContain(SERVED_CHECK_NONCE_HEADER);
    expect(code).not.toContain(SYNTHETIC_STUDENT_NETID_PREFIX);
  });
});
