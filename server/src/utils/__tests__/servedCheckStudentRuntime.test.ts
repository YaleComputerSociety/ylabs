import { describe, expect, it } from 'vitest';

import { assertStudentCheckRuntime, ServedCheckStudentRefusal } from '../servedCheckStudentSession';

describe('the served-check student entry runs only in a check runtime (#6079)', () => {
  it('runs locally with the bypass explicitly off', () => {
    expect(() =>
      assertStudentCheckRuntime({ NODE_ENV: 'test', LOCAL_AUTH_BYPASS: 'false' }),
    ).not.toThrow();
  });

  it('refuses a deployed runtime even with the bypass off', () => {
    for (const NODE_ENV of ['production', 'prod']) {
      expect(() => assertStudentCheckRuntime({ NODE_ENV, LOCAL_AUTH_BYPASS: 'false' })).toThrow(
        ServedCheckStudentRefusal,
      );
    }
  });

  it('refuses unless the bypass is exactly false', () => {
    for (const LOCAL_AUTH_BYPASS of ['true', '1', '', undefined]) {
      expect(() => assertStudentCheckRuntime({ NODE_ENV: 'test', LOCAL_AUTH_BYPASS })).toThrow(
        'LOCAL_AUTH_BYPASS=false',
      );
    }
  });
});
