import { describe, expect, it } from 'vitest';
import { isYaleHostname } from '../yaleHost';

describe('isYaleHostname', () => {
  it.each(['yale.edu', 'medicine.yale.edu', 'Faculty.SOM.Yale.edu'])('accepts %s', (host) => {
    expect(isYaleHostname(host)).toBe(true);
  });

  it.each(['notyale.edu', 'yale.edu.example.com', 'fakeyale.edu', 'yale.education', ''])(
    'rejects %s',
    (host) => {
      expect(isYaleHostname(host)).toBe(false);
    },
  );
});
