import { describe, expect, it } from 'vitest';

import {
  assertRetiredPaperPipelineRollbackEnabled,
  isRetiredPaperPipelineRollbackEnabled,
} from '../retiredPaperPipeline';

describe('retired paper pipeline rollback policy', () => {
  it('enables rollback only for the exact lowercase true value', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      const env =
        value === undefined
          ? ({} as NodeJS.ProcessEnv)
          : ({ RETIRED_PAPER_PIPELINE_ROLLBACK: value } as NodeJS.ProcessEnv);
      expect(isRetiredPaperPipelineRollbackEnabled(env)).toBe(false);
      expect(() => assertRetiredPaperPipelineRollbackEnabled(env)).toThrow(
        /quarantined with the retired bibliographic pipeline/,
      );
    }

    const enabled = {
      RETIRED_PAPER_PIPELINE_ROLLBACK: 'true',
    } as NodeJS.ProcessEnv;
    expect(isRetiredPaperPipelineRollbackEnabled(enabled)).toBe(true);
    expect(() => assertRetiredPaperPipelineRollbackEnabled(enabled)).not.toThrow();
  });
});
