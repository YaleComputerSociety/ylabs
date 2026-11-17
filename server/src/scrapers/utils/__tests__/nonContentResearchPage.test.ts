import { describe, expect, it } from 'vitest';
import { nonContentResearchPageReason } from '../nonContentResearchPage';
import { researchPageTextEntries, researchPageTextEntriesForTopics } from '../researchPageText';

const BOT_CHALLENGE =
  'Security Check Your browser is being verified Consulting the crowd... Powered by CrowdSec Why am I seeing this page?';
const SIGN_IN =
  'Central Authentication Service Make sure your session is secure Before entering your NetID and password, verify that the URL for this page begins with the expected address.';
const RESEARCH =
  'Our lab studies how neurons find their signaling partners during development. Undergraduates who want to join should email the lab with their NetID and a short note about their interests.';

describe('nonContentResearchPageReason (#6460)', () => {
  it('refuses a bot-challenge interstitial', () => {
    expect(nonContentResearchPageReason({ url: 'https://example.org/people/x', text: BOT_CHALLENGE })).toBe(
      'bot-challenge',
    );
  });

  it('refuses a CAS sign-in page by its address', () => {
    expect(
      nonContentResearchPageReason({ url: 'https://secure.its.yale.edu/cas/login?service=x', text: 'Sign in' }),
    ).toBe('sign-in-wall');
  });

  it('refuses a CAS sign-in page by its text on another address', () => {
    expect(nonContentResearchPageReason({ url: 'https://lab.yale.edu/members', text: SIGN_IN })).toBe(
      'sign-in-wall',
    );
  });

  it("refuses a school's own research index that a cited page redirected to", () => {
    expect(
      nonContentResearchPageReason({
        url: 'https://medicine.yale.edu/research/',
        text: 'Yale School of Medicine research spans the full spectrum of discovery.',
      }),
    ).toBe('school-landing');
  });

  it('keeps a research page that mentions a NetID in passing', () => {
    expect(nonContentResearchPageReason({ url: 'https://lab.yale.edu/join', text: RESEARCH })).toBeNull();
  });

  it('keeps a long research page that names a challenge vendor in its prose', () => {
    const text = `${RESEARCH} `.repeat(20) + 'We study why a browser is being verified by Cloudflare challenges.';
    expect(nonContentResearchPageReason({ url: 'https://lab.yale.edu/research', text })).toBeNull();
  });

  it('keeps a deeper page on a school host', () => {
    expect(
      nonContentResearchPageReason({ url: 'https://medicine.yale.edu/lab/example/research/', text: RESEARCH }),
    ).toBeNull();
  });
});

describe('stored page text drops non-content pages on every read (#6460)', () => {
  const stored = [
    { url: 'https://secure.its.yale.edu/cas/login', text: SIGN_IN },
    { url: 'https://lab.yale.edu/research', text: RESEARCH },
    { url: 'https://medicine.yale.edu/research/', text: 'Yale School of Medicine research spans the full spectrum.' },
  ];

  it('keeps only the content pages in the parsed entries', () => {
    expect(researchPageTextEntries(stored)).toEqual([{ url: 'https://lab.yale.edu/research', text: RESEARCH }]);
  });

  it('keeps them out of the topic reading input too', () => {
    expect(researchPageTextEntriesForTopics(stored).map((entry) => entry.url)).toEqual([
      'https://lab.yale.edu/research',
    ]);
  });

  it('leaves a value with no non-content page unchanged', () => {
    const clean = [{ url: 'https://lab.yale.edu/research', text: RESEARCH }];
    expect(researchPageTextEntries(clean)).toEqual(clean);
  });
});
