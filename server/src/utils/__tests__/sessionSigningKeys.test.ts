import { describe, expect, it } from 'vitest';

import { sessionSigningKeys } from '../sessionSigningKeys';

const CURRENT = 'Pv5&Gh8!Td2#Yw6$Mk9@Rc4^Ls7*Qn3%';
const PREVIOUS = 'Zq7#Lm2$Wx9!Rt4%Kp8@Hv3^Nc6&Jb1*';
const acceptable = (value: string) => value.length >= 32;

describe('sessionSigningKeys (#4484)', () => {
  it('signs with the current secret alone when no previous secret is configured', () => {
    for (const previousSecret of [undefined, '', '   ']) {
      expect(
        sessionSigningKeys({
          currentSecret: CURRENT,
          previousSecret,
          isAcceptableSecret: acceptable,
          requireStrongSecrets: true,
        }),
      ).toEqual([CURRENT]);
    }
  });

  it('puts the current secret first so new cookies are signed with it', () => {
    expect(
      sessionSigningKeys({
        currentSecret: CURRENT,
        previousSecret: ` ${PREVIOUS} `,
        isAcceptableSecret: acceptable,
        requireStrongSecrets: true,
      }),
    ).toEqual([CURRENT, PREVIOUS]);
  });

  it('refuses a previous secret equal to the current one', () => {
    expect(() =>
      sessionSigningKeys({
        currentSecret: CURRENT,
        previousSecret: CURRENT,
        isAcceptableSecret: acceptable,
        requireStrongSecrets: false,
      }),
    ).toThrow('SESSION_SECRET_PREVIOUS must differ from SESSION_SECRET.');
  });

  it('refuses a weak previous secret on a deployed runtime and allows it locally', () => {
    const options = {
      currentSecret: CURRENT,
      previousSecret: 'short',
      isAcceptableSecret: acceptable,
    };
    expect(() => sessionSigningKeys({ ...options, requireStrongSecrets: true })).toThrow(
      'SESSION_SECRET_PREVIOUS must be a high-entropy string of at least 32 characters.',
    );
    expect(sessionSigningKeys({ ...options, requireStrongSecrets: false })).toEqual([
      CURRENT,
      'short',
    ]);
  });
});
