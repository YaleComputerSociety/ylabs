import { describe, expect, it } from 'vitest';

import { publicSourceLinkHealthArray } from '../researchEntityDto';

describe('publicSourceLinkHealthArray https landing (#4649)', () => {
  it('serves the recorded https landing so the detail page can offer it', () => {
    expect(
      publicSourceLinkHealthArray([
        {
          url: 'http://faculty.example.yale.edu/FixturePerson/',
          healthStatus: 'HEALTHY',
          httpStatusCode: 200,
          httpsLandingUrl: 'https://faculty.example.yale.edu/fixtureperson/',
        },
      ]),
    ).toEqual([
      {
        url: 'http://faculty.example.yale.edu/FixturePerson/',
        healthStatus: 'HEALTHY',
        httpStatusCode: 200,
        httpsLandingUrl: 'https://faculty.example.yale.edu/fixtureperson/',
      },
    ]);
  });

  it('drops a landing that is not a public http url', () => {
    const [entry] = publicSourceLinkHealthArray([
      {
        url: 'http://faculty.example.yale.edu/FixturePerson/',
        healthStatus: 'HEALTHY',
        httpsLandingUrl: 'javascript:alert(1)',
      },
    ]);
    expect(entry).not.toHaveProperty('httpsLandingUrl');
  });
});

describe('publicSourceLinkHealthArray https spelling (#5639)', () => {
  const HTTP = 'http://both.fixture.example.org/Lab/?tab=people';
  const served = (url: string, httpsSpellingUrl: unknown) =>
    publicSourceLinkHealthArray([{ url, healthStatus: 'HEALTHY', httpsSpellingUrl }])[0];

  it('serves the https spelling of the entry url', () => {
    expect(served(HTTP, 'https://www.both.fixture.example.org/Lab?tab=people')).toEqual({
      url: HTTP,
      healthStatus: 'HEALTHY',
      httpsSpellingUrl: 'https://www.both.fixture.example.org/Lab?tab=people',
    });
  });

  it('drops a spelling that is not https, not public, or names another page', () => {
    for (const spelling of [
      'http://both.fixture.example.org/Lab/?tab=people',
      'javascript:alert(1)',
      'https://other.fixture.example.org/Lab/?tab=people',
      'https://both.fixture.example.org/other/?tab=people',
      'https://both.fixture.example.org/Lab/?tab=news',
      42,
    ]) {
      expect(served(HTTP, spelling)).not.toHaveProperty('httpsSpellingUrl');
    }
  });

  it('drops a spelling recorded on an https entry', () => {
    const https = 'https://both.fixture.example.org/Lab/?tab=people';
    expect(served(https, https)).not.toHaveProperty('httpsSpellingUrl');
  });
});
