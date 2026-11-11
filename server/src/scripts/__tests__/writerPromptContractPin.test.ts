import { describe, expect, it } from 'vitest';
import { COVERAGE_SYNTHESIS_PROMPT_HASH } from '../../scrapers/prompts';
import { WRITER_CONTRACT_VERSION } from '../writtenDescriptionDerivationCore';

const WRITER_PROMPT_PIN = {
  contract: 'written-description-5537-v1',
  promptHash: 'a5f60a5118f59515571fb01f116a013df789327251688e5e29589af3297ab897',
  carryOverReason: 'first pin of the #5537 writer prompt (#5833)',
};

const DECIDE_ON_A_PROMPT_EDIT = [
  'The writer prompt changed. Its hash is not part of writerInputHash, so after this edit',
  'every stored draft that still passes the checks is served again with no model call.',
  'If the edit should re-draft every row, bump WRITER_CONTRACT_VERSION and re-pin both values.',
  'If carrying the passing drafts over is right, re-pin promptHash and state why in carryOverReason.',
].join(' ');

describe('writer prompt edits need a contract decision (#5833)', () => {
  it('pins the prompt hash to the writer contract', () => {
    expect(
      { contract: WRITER_CONTRACT_VERSION, promptHash: COVERAGE_SYNTHESIS_PROMPT_HASH },
      DECIDE_ON_A_PROMPT_EDIT,
    ).toEqual({ contract: WRITER_PROMPT_PIN.contract, promptHash: WRITER_PROMPT_PIN.promptHash });
  });

  it('states why passing drafts carry over under the pinned prompt', () => {
    expect(WRITER_PROMPT_PIN.carryOverReason.trim().length).toBeGreaterThan(0);
  });
});
