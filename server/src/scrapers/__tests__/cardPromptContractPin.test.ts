import { describe, expect, it } from 'vitest';
import { CARD_SYNTHESIS_PROMPT_HASH } from '../prompts';
import { CARD_CONTRACT_VERSION } from '../cardSynthesisDerivation';

const CARD_PROMPT_PIN = {
  contract: 'card-synthesis-5961-v2',
  promptHash: 'a27c0e0ac23599540b310aa6344449d7e593a299323720939f89154a159801d1',
  carryOverReason:
    'v2 card rules (#5961): keep the main method and never frame a flat expertise list as research, so every card is re-judged under the new contract',
};

const DECIDE_ON_A_CARD_PROMPT_EDIT = [
  'The card prompt changed. Its hash is part of the lab-site description lane content-hash',
  'gate, so the next hand run of that lane re-extracts every row it reads. A card cached',
  'under an older prompt is still served when it passes the checks. If every card should be',
  're-drafted, bump CARD_CONTRACT_VERSION and re-pin both values; otherwise re-pin promptHash',
  'and state why in carryOverReason.',
].join(' ');

describe('card prompt edits need a contract decision (#5961)', () => {
  it('pins the card prompt hash to the card contract', () => {
    expect(
      { contract: CARD_CONTRACT_VERSION, promptHash: CARD_SYNTHESIS_PROMPT_HASH },
      DECIDE_ON_A_CARD_PROMPT_EDIT,
    ).toEqual({ contract: CARD_PROMPT_PIN.contract, promptHash: CARD_PROMPT_PIN.promptHash });
  });

  it('states why the pinned card prompt carries over or re-drafts', () => {
    expect(CARD_PROMPT_PIN.carryOverReason.trim().length).toBeGreaterThan(0);
  });
});
