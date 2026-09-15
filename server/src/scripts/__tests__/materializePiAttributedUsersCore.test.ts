import { describe, expect, it } from 'vitest';
import {
  PI_ATTRIBUTED_USERS_CONFIRM_FLAG,
  classifyPiAttributedUserOutcome,
  parseMaterializePiAttributedUsersArgs,
  summarizePiAttributedUserRows,
  type PiAttributedUserRow,
} from '../materializePiAttributedUsersCore';

describe('parseMaterializePiAttributedUsersArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseMaterializePiAttributedUsersArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirmed).toBe(false);
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
