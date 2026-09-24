/**
 * The refusal vocabulary now stops a write instead of only annotating an audit
 * (#3167). Before this it had exactly one caller in the tree, an audit script, so the
 * repo carried a set of rules that refused nothing in practice - the same inert shape
 * as a retraction that never retracted.
 *
 * The RED arm is the point: `yale-path-vocabulary` must NOT block a write. Measured on
 * Development it accounts for 335 of the 376 stored `websiteUrl`s the vocabulary
 * refuses, 241 of them on student-facing rows, and the decision function's own
 * docblock records that most of what that arm declines is a correct research home. A
 * gate that blocked on it would withhold hundreds of correct links.
 */
import { describe, expect, it } from 'vitest';
import {
  researchHomeWebsiteUrlDecision,
  researchHomeWebsiteUrlRefusalBlocksWrite,
  researchHomeWebsiteUrlWriteRefusal,
} from '../researchHomeWebsiteUrl';

describe('the arm that must never block a write', () => {
  it('does not block on yale-path-vocabulary, whatever the audit says', () => {
    expect(researchHomeWebsiteUrlRefusalBlocksWrite('yale-path-vocabulary')).toBe(false);
  });

  it('lets a URL that arm declines through the write gate', () => {
    // A plain research subdomain root, which is the shape that arm keeps declining
    // and which is very often the entity's actual research home.
    const vocabularyDeclined = 'https://bioinfo.mbb.yale.edu/';
    const decision = researchHomeWebsiteUrlDecision(vocabularyDeclined);

    expect(decision.refusal).toBe('yale-path-vocabulary');
    expect(researchHomeWebsiteUrlWriteRefusal(vocabularyDeclined)).toBeNull();
  });
});

describe('the arms that do block a write', () => {
  const blocked: Array<[string, string]> = [
    ['a blank value', ''],
    ['an unparseable value', 'c'],
    [
      'a shared lab-website index',
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites',
    ],
    ['a CMS person-profile path', 'https://environment.yale.edu/profile/fixture/'],
    ['an external scholarly platform record', 'https://pubmed.ncbi.nlm.nih.gov/16849964/'],
    ['a Google Sites page', 'https://sites.google.com/a/yale.edu/fixture/'],
    ['a news path', 'https://medicine.yale.edu/news/article/some-story/'],
  ];

  it.each(blocked)('blocks %s', (_label, url) => {
    const refusal = researchHomeWebsiteUrlWriteRefusal(url);

    expect(refusal).not.toBeNull();
    expect(researchHomeWebsiteUrlRefusalBlocksWrite(refusal)).toBe(true);
  });

  /**
   * Recorded as an assertion because it is the reason #3178 had to exist: no arm of
   * this vocabulary refuses a journal article page, so a DOI cited as a row's
   * research home is admitted here and can only be stopped by a per-row refusal.
   */
  it('admits a journal article page, which is why a per-row refusal is needed', () => {
    const doi = 'https://journals.sagepub.com/doi/10.1177/00000000';

    expect(researchHomeWebsiteUrlDecision(doi).refusal).toBeNull();
    expect(researchHomeWebsiteUrlWriteRefusal(doi)).toBeNull();
  });

  it('reports which rule refused, so a log names its own cause', () => {
    expect(
      researchHomeWebsiteUrlWriteRefusal(
        'https://medicine.yale.edu/about/a-to-z-index/lab-websites',
      ),
    ).toBe('listing-or-index');
  });

  it('admits a plain lab site, so the gate is not refusing everything', () => {
    expect(researchHomeWebsiteUrlWriteRefusal('https://fixturelab.org/')).toBeNull();
    expect(researchHomeWebsiteUrlDecision('https://fixturelab.org/').refusal).toBeNull();
  });

  it('treats an absent refusal as no block', () => {
    expect(researchHomeWebsiteUrlRefusalBlocksWrite(null)).toBe(false);
    expect(researchHomeWebsiteUrlRefusalBlocksWrite(undefined)).toBe(false);
  });
});
