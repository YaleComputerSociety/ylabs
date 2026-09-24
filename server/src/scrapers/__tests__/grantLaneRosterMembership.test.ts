/**
 * The grant lanes must not emit roster membership (#3274).
 *
 * A grant establishes that someone received funding. It does not establish that they
 * are a member of a lab's roster, which is #3145's rule one step further: grants
 * enrich a research row and never mint one. Two lanes emitted 465 `researchGroupMember`
 * observations addressing the entity under `researchGroupSlug`, which the materializer
 * does not read, so all of them were discarded and 93 edges lay dormant. Aligning the
 * field name would have activated those 93, so the emission is gone instead.
 *
 * The silent-discard half of #3274 is not here. #3296 landed a better version of it,
 * naming both unread slug aliases and giving the skip its own reason, and left the
 * emission in place.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const sourceOf = (file: string): string =>
  fs.readFileSync(path.resolve(__dirname, '..', 'sources', file), 'utf8');

const GRANT_LANES = ['nsfAwardScraper.ts', 'nehGrantScraper.ts'];

describe('grant lanes do not assert roster membership (#3274)', () => {
  it.each(GRANT_LANES)('%s emits no researchGroupMember observation', (file) => {
    expect(sourceOf(file)).not.toContain("entityType: 'researchGroupMember'");
  });

  // The rename is the activation in disguise, so neither spelling may come back: not the
  // one nothing reads, and not the one that would switch 93 dormant edges on.
  it.each(GRANT_LANES)('%s addresses no roster entity under either spelling', (file) => {
    const source = sourceOf(file);
    expect(source).not.toContain("field: 'researchGroupSlug'");
    expect(source).not.toContain("field: 'researchGroupKey'");
  });

  it.each(GRANT_LANES)('%s still carries its funding evidence', (file) => {
    expect(sourceOf(file)).toContain('recentGrants');
  });
});
