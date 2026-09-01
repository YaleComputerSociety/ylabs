import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const copyCollectionBody = (): string => {
  const source = stripComments(
    readFileSync(path.join(__dirname, '..', 'promoteAcceptedBetaCopy.ts'), 'utf8'),
  );
  const start = source.indexOf('async function copyCollection(');
  expect(start).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n(async )?function /);
  return end === -1 ? rest : rest.slice(0, end);
};

describe('promotion copy ordering', () => {
  it('does not request noCursorTimeout, which shared Atlas tiers reject', () => {
    expect(copyCollectionBody()).not.toContain('noCursorTimeout');
  });

  it('proves the source cursor is readable before deleting the target', () => {
    const body = copyCollectionBody();
    const primeAt = body.indexOf('cursor.hasNext()');
    const deleteAt = body.indexOf('deleteMany');

    expect(primeAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(primeAt).toBeLessThan(deleteAt);
  });

  it('opens the cursor before it deletes, so a source failure cannot empty the target', () => {
    const body = copyCollectionBody();
    const findAt = body.indexOf('source.find(');
    const deleteAt = body.indexOf('deleteMany');

    expect(findAt).toBeGreaterThan(-1);
    expect(findAt).toBeLessThan(deleteAt);
  });
});
