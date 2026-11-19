import { describe, expect, it, vi } from 'vitest';
import { scopedRunUserRederiver } from '../fieldRetraction';

const SUBJECT = { entityKey: 'netid:synthetic1' };

describe('the end-of-run user re-derive is scoped to the retracted fields (#6009)', () => {
  it('passes only the retracted email scope', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    await scopedRunUserRederiver(materialize)(SUBJECT, ['email']);
    expect(materialize).toHaveBeenCalledExactlyOnceWith(SUBJECT, ['identifiers.email']);
  });

  it('passes only the retracted ORCID scope', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    await scopedRunUserRederiver(materialize)(SUBJECT, ['orcid']);
    expect(materialize).toHaveBeenCalledExactlyOnceWith(SUBJECT, ['identifiers.orcid']);
  });

  it('never widens a displayName retraction to imageUrl or any other field', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    await scopedRunUserRederiver(materialize)(SUBJECT, ['displayName']);
    expect(materialize).toHaveBeenCalledExactlyOnceWith(SUBJECT, ['displayName']);
  });

  it('fails closed on a field with no user materializer scope, without materializing', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    await expect(
      scopedRunUserRederiver(materialize)(SUBJECT, ['email', 'fieldWithNoScope']),
    ).rejects.toThrow(/no user materializer scope/);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('fails closed on an empty retraction rather than materializing everything', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    await expect(scopedRunUserRederiver(materialize)(SUBJECT, [])).rejects.toThrow(
      /needs a retracted field/,
    );
    expect(materialize).not.toHaveBeenCalled();
  });
});
