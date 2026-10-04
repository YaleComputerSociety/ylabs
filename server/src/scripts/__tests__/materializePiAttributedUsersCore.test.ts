import { describe, expect, it } from 'vitest';
import {
  PI_ATTRIBUTED_USERS_CONFIRM_FLAG,
  PI_ATTRIBUTED_USERS_MINT_ONLY_FLAG,
  classifyPiAttributedUserOutcome,
  mintOnlyOutcomeWithoutApply,
  parseMaterializePiAttributedUsersArgs,
  shouldApplyAfterMintOnlyProbe,
  summarizePiAttributedUserRows,
  type PiAttributedUserRow,
} from '../materializePiAttributedUsersCore';

describe('parseMaterializePiAttributedUsersArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseMaterializePiAttributedUsersArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirmed).toBe(false);
    expect(args.mintOnly).toBe(false);
  });

  it('reads the mint-only flag', () => {
    const args = parseMaterializePiAttributedUsersArgs([
      '--apply',
      PI_ATTRIBUTED_USERS_CONFIRM_FLAG,
      PI_ATTRIBUTED_USERS_MINT_ONLY_FLAG,
    ]);
    expect(args.apply).toBe(true);
    expect(args.mintOnly).toBe(true);
  });

  it('refuses --apply without the confirm flag', () => {
    expect(() => parseMaterializePiAttributedUsersArgs(['--apply'])).toThrow(
      PI_ATTRIBUTED_USERS_CONFIRM_FLAG,
    );
  });

  it('accepts --apply with the confirm flag', () => {
    const args = parseMaterializePiAttributedUsersArgs([
      '--apply',
      PI_ATTRIBUTED_USERS_CONFIRM_FLAG,
    ]);
    expect(args.apply).toBe(true);
  });

  it('rejects a non-positive or unsafe limit rather than visiting everything', () => {
    for (const bad of ['0', '-5', 'all', '1.5']) {
      expect(() => parseMaterializePiAttributedUsersArgs([`--limit=${bad}`])).toThrow('--limit');
    }
    expect(parseMaterializePiAttributedUsersArgs(['--limit=25']).limit).toBe(25);
  });
});

describe('classifyPiAttributedUserOutcome', () => {
  it('separates a dry run that would mint from a refusal', () => {
    // The materializer reports `created: false` for both, so reading `created`
    // alone cannot tell them apart (#2773).
    expect(classifyPiAttributedUserOutcome({ skipped: 'dry-run-would-mint-researcher' })).toBe(
      'would-mint',
    );
    expect(
      classifyPiAttributedUserOutcome({ skipped: 'directory-identity-without-research-signal' }),
    ).toBe('refused');
  });

  it('reports a real mint and a plain enrichment distinctly', () => {
    expect(classifyPiAttributedUserOutcome({ created: true })).toBe('minted');
    expect(classifyPiAttributedUserOutcome({ created: false, fieldsWritten: 3 })).toBe('enriched');
  });
});

describe('summarizePiAttributedUserRows', () => {
  it('counts each outcome and groups refusals by reason', () => {
    const rows: PiAttributedUserRow[] = [
      { entityKey: 'a', outcome: 'minted', fieldsWritten: 4 },
      { entityKey: 'b', outcome: 'would-mint', fieldsWritten: 0 },
      { entityKey: 'c', outcome: 'enriched', fieldsWritten: 2 },
      {
        entityKey: 'd',
        outcome: 'refused',
        fieldsWritten: 0,
        skippedReason: 'directory-identity-without-research-signal',
      },
      {
        entityKey: 'e',
        outcome: 'refused',
        fieldsWritten: 0,
        skippedReason: 'directory-identity-without-research-signal',
      },
      { entityKey: 'f', outcome: 'error', fieldsWritten: 0, error: 'boom' },
    ];

    expect(summarizePiAttributedUserRows(rows)).toEqual({
      examined: 6,
      minted: 1,
      wouldMint: 1,
      enriched: 1,
      leftExisting: 0,
      refused: 2,
      errors: 1,
      refusalReasons: { 'directory-identity-without-research-signal': 2 },
    });
  });

  it('labels a refusal with no reason rather than dropping it from the count', () => {
    const summary = summarizePiAttributedUserRows([
      { entityKey: 'a', outcome: 'refused', fieldsWritten: 0 },
    ]);
    expect(summary.refused).toBe(1);
    expect(summary.refusalReasons).toEqual({ unknown: 1 });
  });
});

describe('mint-only mode', () => {
  it('applies a key only when its probe would mint a researcher', () => {
    expect(shouldApplyAfterMintOnlyProbe('would-mint')).toBe(true);
    for (const outcome of ['enriched', 'refused', 'minted', 'error'] as const) {
      expect(shouldApplyAfterMintOnlyProbe(outcome)).toBe(false);
    }
  });

  it('records an existing researcher it left alone apart from a write', () => {
    expect(mintOnlyOutcomeWithoutApply('enriched')).toBe('left-existing');
    expect(mintOnlyOutcomeWithoutApply('refused')).toBe('refused');
    expect(
      summarizePiAttributedUserRows([
        { entityKey: 'a', outcome: 'left-existing', fieldsWritten: 0 },
      ]),
    ).toMatchObject({ leftExisting: 1, enriched: 0, refused: 0 });
  });
});
