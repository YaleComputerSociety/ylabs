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
