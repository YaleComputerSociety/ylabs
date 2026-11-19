import { describe, expect, it } from 'vitest';

import { ECHOED_QUERY_MAX_LENGTH, echoedQuery } from '../echoedQuery';

describe('echoedQuery', () => {
  it('echoes a normal query as typed, trimmed', () => {
    expect(echoedQuery('  marine biology ')).toBe('marine biology');
  });

  it('shortens a very long query with an ellipsis', () => {
    const echoed = echoedQuery('a'.repeat(300));
    expect(echoed).toBe(`${'a'.repeat(ECHOED_QUERY_MAX_LENGTH)}…`);
  });
});
