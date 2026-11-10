import { describe, expect, it } from 'vitest';
import { stripLeadingPageChrome } from '../descriptionHygiene';
import { isBarePersonNameEntityName } from '../researchHomeNameIdentityAuthority';

const elapsedMs = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe('isBarePersonNameEntityName on apostrophe runs (#5527)', () => {
  it('still reads apostrophe and hyphen surnames as a person name', () => {
    expect(isBarePersonNameEntityName("Ada O'Brien-Smith")).toBe(true);
    expect(isBarePersonNameEntityName('Ada D’Angelo')).toBe(true);
  });

  it('rejects a long apostrophe run without backtracking', () => {
    const input = `Ada B${"'".repeat(5000)}!`;
    let result: boolean | undefined;
    expect(elapsedMs(() => (result = isBarePersonNameEntityName(input)))).toBeLessThan(100);
    expect(result).toBe(false);
  });
});

describe('stripLeadingPageChrome on repeated labels (#5527)', () => {
  it('still strips a glued Bio Website label', () => {
    expect(stripLeadingPageChrome('Bio Website Ada studies coral reefs.')).toBe(
      'Ada studies coral reefs.',
    );
  });

  it('leaves a long run of labels with no following content unchanged, quickly', () => {
    const input = `${'Bio Website\t'.repeat(5000)}x`;
    let result = '';
    expect(elapsedMs(() => (result = stripLeadingPageChrome(input)))).toBeLessThan(100);
    expect(result.endsWith('x')).toBe(true);
  });
});
