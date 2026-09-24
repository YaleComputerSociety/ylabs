import { describe, expect, it } from 'vitest';
import {
  isMapOrDirectionsDestinationUrl,
  researchHomeWebsiteUrlDecision,
  researchHomeWebsiteUrlRefusalBlocksWrite,
} from '../researchHomeWebsiteUrl';

describe('a map or directions destination is never a research home (#3184)', () => {
  it('refuses a directions intent carried in the query string', () => {
    const url =
      'https://www.google.com/maps/dir/?api=1&destination=333+Cedar+St&directionsMode=driving';
    expect(isMapOrDirectionsDestinationUrl(url)).toBe(true);
    const decision = researchHomeWebsiteUrlDecision(url);
    expect(decision.refusal).toBe('map-or-directions-destination');
    expect(decision.url).toBe('');
  });

  it('sees a directions intent that lives only in the query string, on a non-map host', () => {
    // Pins the ordering constraint: the decision clears `search` before its path checks,
    // so an arm placed after that point cannot see `directionsMode` at all. A map host
    // would be caught either way, which is why this case uses an institutional host.
    const url = 'https://medicine.yale.edu/locations/?directionsMode=driving';
    expect(isMapOrDirectionsDestinationUrl(url)).toBe(true);
    expect(researchHomeWebsiteUrlDecision(url).refusal).toBe('map-or-directions-destination');
  });

  it('refuses the arm through the write gate, not merely as an audit note', () => {
    expect(researchHomeWebsiteUrlRefusalBlocksWrite('map-or-directions-destination')).toBe(true);
  });

  it('refuses a map host and a shortened map link', () => {
    for (const url of [
      'https://maps.google.com/?q=Yale',
      'https://www.google.com/maps/place/Yale',
      'https://maps.app.goo.gl/abc123',
      'https://maps.apple.com/?address=New+Haven',
      'https://www.openstreetmap.org/#map=17/41.3/-72.9',
    ]) {
      expect(isMapOrDirectionsDestinationUrl(url)).toBe(true);
      expect(researchHomeWebsiteUrlDecision(url).refusal).toBe('map-or-directions-destination');
    }
  });

  it('refuses a directions path on an institutional host', () => {
    expect(
      isMapOrDirectionsDestinationUrl('https://example.yale.edu/locations/get-directions'),
    ).toBe(true);
    expect(isMapOrDirectionsDestinationUrl('https://example.yale.edu/driving-directions/')).toBe(
      true,
    );
  });

  it('accepts a real research home, and does not fire on a lookalike word inside a path segment', () => {
    for (const url of [
      'https://medicine.yale.edu/lab/example/',
      'https://exampledirectionslab.yale.edu/',
      'https://example.yale.edu/research/new-directions-in-genomics/',
    ]) {
      expect(isMapOrDirectionsDestinationUrl(url)).toBe(false);
      expect(researchHomeWebsiteUrlDecision(url).refusal).not.toBe('map-or-directions-destination');
    }
  });

  it('handles a blank or unparseable value without claiming a map', () => {
    for (const value of ['', '   ', 'not a url', null, undefined, 42]) {
      expect(isMapOrDirectionsDestinationUrl(value)).toBe(false);
    }
  });
});
