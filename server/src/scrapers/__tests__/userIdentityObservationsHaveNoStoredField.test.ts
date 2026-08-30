import { describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import { Account } from '../../models/account';

/**
 * `shouldPreserveExistingUserIdentityField` guarded a stored `fname`/`firstName`
 * against being overwritten by an initial-only roster value. It was removed
 * rather than wired back in, because the field it protected no longer exists:
 * `User` was retired, and neither `Researcher` nor `Account` carries a
 * first-name field for an initial to overwrite. Restoring the guard would
 * protect nothing.
 *
 * `fname`/`lname` observations are still emitted by the directory scrapers and
 * are still load-bearing - the materializer reads them for identity matching
 * and name-casing normalization - so this asserts the distinction that matters:
 * they are consumed, never persisted as their own field.
 */
describe('user identity observations have no stored destination field', () => {
  const nameFieldsOf = (schema: typeof Researcher.schema) =>
    Object.keys(schema.paths).filter((path) => /^(fname|lname|firstName|lastName)$/.test(path));

  it('Researcher declares no first- or last-name field', () => {
    expect(nameFieldsOf(Researcher.schema)).toEqual([]);
  });

  it('Account declares no first- or last-name field', () => {
    expect(nameFieldsOf(Account.schema)).toEqual([]);
  });

  it('Researcher carries displayName as its only person-name field', () => {
    expect(Object.keys(Researcher.schema.paths)).toContain('displayName');
  });
});
