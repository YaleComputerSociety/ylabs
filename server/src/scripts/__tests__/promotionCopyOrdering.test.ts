import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * #2346 proved an ORDERING: prime the cursor before `deleteMany`, so a shared-tier
 * cursor rejection could not empty a Production collection it had already cleared.
 *
 * #2347 removed the need for that ordering rather than re-proving it. The promotion
 * stages into a temporary collection and swaps, so it never deletes a live target
 * at all - which is a stronger property than deleting in a safe order, and it is
 * why these assertions now check for ABSENCE instead of relative position.
 *
 * The behavioural half lives in `stagedCollectionSwap.integration.test.ts`, which
 * induces real failures against a real mongod. These source-text checks exist only
 * to fail loudly if a destructive in-place write is ever reintroduced here.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const promotionSource = (): string =>
  stripComments(readFileSync(path.join(__dirname, '..', 'promoteAcceptedBetaCopy.ts'), 'utf8'));

const stageCollectionBody = (): string => {
  const source = promotionSource();
  const start = source.indexOf('async function stageCollection(');
  expect(start).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function /);
  return end === -1 ? rest : rest.slice(0, end);
};

describe('promotion copy ordering', () => {
  it('does not request noCursorTimeout, which shared Atlas tiers reject', () => {
    expect(stageCollectionBody()).not.toContain('noCursorTimeout');
  });

  /**
   * The 2026-09-01 outage in one assertion: no path in the promotion may empty a
   * live Production collection. Staging plus rename replaces it entirely.
   */
  it('never deletes a live target collection anywhere in the promotion', () => {
    expect(promotionSource()).not.toContain('deleteMany');
  });

  it('primes the source cursor before writing anything, so a source failure aborts early', () => {
    const body = stageCollectionBody();
    const primeAt = body.indexOf('cursor.hasNext()');
    const writeAt = body.indexOf('bulkWrite');

    expect(primeAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(primeAt).toBeLessThan(writeAt);
  });

  it('writes the copy into a staging collection rather than the live one', () => {
    const body = stageCollectionBody();
    expect(body).toContain('PROMOTION_STAGING_PREFIX');
    expect(body).toContain('stagingName');
  });

  it('routes the cutover through the shared staged swap rather than a local sequence', () => {
    const source = promotionSource();
    expect(source).toContain('applyStagedCollectionSwap');
    expect(source).toContain('PROMOTION_BACKUP_PREFIX');
  });
});
