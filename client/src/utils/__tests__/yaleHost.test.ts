import { describe, expect, it } from 'vitest';
import { hostnameIsWithin, isYaleHostname } from '../yaleHost';

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

describe('hostnameIsWithin', () => {
  it('accepts the domain and its subdomains only', () => {
    expect(hostnameIsWithin('orcid.org', 'orcid.org')).toBe(true);
    expect(hostnameIsWithin('sandbox.ORCID.org', 'orcid.org')).toBe(true);
    expect(hostnameIsWithin('orcid.org.example.com', 'orcid.org')).toBe(false);
    expect(hostnameIsWithin('notorcid.org', 'orcid.org')).toBe(false);
  });
});
