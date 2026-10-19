import { describe, expect, it } from 'vitest';

import { undergradInvitationFromEntity } from '../undergradInvitation';

describe('undergradInvitationFromEntity', () => {
  it('labels the level and names the cited host', () => {
    expect(
      undergradInvitationFromEntity({
        undergradInvitation: {
          level: 'welcomes_undergrads',
          quote: '  We welcome   undergraduate students. ',
          sourceUrl: 'https://www.lab.example.edu/join',
        },
      }),
    ).toEqual({
      level: 'welcomes_undergrads',
      label: 'Welcomes undergrads',
      quote: 'We welcome undergraduate students.',
      sourceUrl: 'https://www.lab.example.edu/join',
      sourceHost: 'lab.example.edu',
    });
  });

  it('returns nothing without an invitation', () => {
    expect(undergradInvitationFromEntity({})).toBeUndefined();
    expect(undergradInvitationFromEntity(undefined)).toBeUndefined();
  });
});
