import { describe, expect, it } from 'vitest';
import {
  isCatalogOrCourseSearchIndexRootUrl,
  isWithinCrawlSubtree,
  readCourseCreditRouteFromHtml,
} from '../utils/courseCreditRouteEvidence';
import { readOrgUnitCourseCreditRouteValue } from '../orgUnitSignalMaterializer';
import { Signal, signalTargetIsExactlyOne } from '../../models/signal';

const page = (body: string, heading = 'Undergraduate Program') =>
  `<html><body><main><h1>${heading}</h1>${body}</main></body></html>`;

const DEPARTMENT_URL = 'https://example.yale.edu/undergraduate/senior-essay';

describe('readCourseCreditRouteFromHtml', () => {
  it('accepts a sentence that names both the route and the credit', () => {
    const reading = readCourseCreditRouteFromHtml(
      page(
        '<p>Seniors receive course credit for satisfactory completion of their departmental essays by enrolling in HIST 4995/4996.</p>',
        'Senior Essay',
      ),
      DEPARTMENT_URL,
    );

    expect(reading?.evidenceQuote).toContain('course credit');
    expect(reading?.supportingQuoteCount).toBe(1);
  });

  it('accepts a route named beside a catalog code without an explicit credit word', () => {
    const reading = readCourseCreditRouteFromHtml(
      page(
        '<p>Yearlong senior projects are completed by undergraduates in HSHM 4900 and 4910.</p>',
      ),
      DEPARTMENT_URL,
    );

    expect(reading?.evidenceQuote).toContain('HSHM 4900');
  });

  /**
   * The measured false positive the rule was calibrated against: a page about
   * summer fellowship funding names no course and earns no credit.
   */
  it('refuses a page whose only research language is summer funding', () => {
    const reading = readCourseCreditRouteFromHtml(
      page(
        '<p>A variety of opportunities are available for undergraduates interested in pursuing independent research, many of which provide funding during the summer.</p>',
        'Independent Research Opportunities',
      ),
      DEPARTMENT_URL,
    );

    expect(reading).toBeNull();
  });

  /**
   * Pins the route-phrase exclusion itself rather than the credit clause: this
   * sentence clears the credit-or-code clause on its catalog code, so it accepts
   * if and only if `independent research` counts as a named route. It must not.
   */
  it('refuses an activity phrase paired with a catalog code and no mention of credit', () => {
    const reading = readCourseCreditRouteFromHtml(
      page(
        '<p>Undergraduates pursuing independent research should consult the ABCD 1234 listing before the term begins.</p>',
        'Directed Research',
      ),
      DEPARTMENT_URL,
    );

    expect(reading).toBeNull();
  });

  it('refuses a breadth requirement that carries catalog codes but no route', () => {
    const reading = readCourseCreditRouteFromHtml(
      page(
        '<p>To provide exposure to a broad range of subfields, all majors must take five of the following courses: Language and Mind (LING 1179) and Phonetics 1 (LING 2200).</p>',
        'Program Requirements',
      ),
      DEPARTMENT_URL,
    );

    expect(reading).toBeNull();
  });

  it('refuses a page that documents a route for no undergraduate audience', () => {
    const reading = readCourseCreditRouteFromHtml(
      page(
        '<p>Doctoral candidates receive course credit for the dissertation prospectus by enrolling in ABCD 7995.</p>',
        'Graduate Program',
      ),
      DEPARTMENT_URL,
    );

    expect(reading).toBeNull();
  });

  it('refuses a university-wide catalog root, which describes every department at once', () => {
    expect(isCatalogOrCourseSearchIndexRootUrl('https://courses.yale.edu/')).toBe(true);
    expect(isCatalogOrCourseSearchIndexRootUrl('https://catalog.yale.edu/ycps')).toBe(true);
    expect(isCatalogOrCourseSearchIndexRootUrl(DEPARTMENT_URL)).toBe(false);

    expect(
      readCourseCreditRouteFromHtml(
        page('<p>Undergraduates receive course credit for directed research in ABCD 4900.</p>'),
        'https://courses.yale.edu/',
      ),
    ).toBeNull();
  });
});

describe('isWithinCrawlSubtree', () => {
  const seed = 'https://example.yale.edu/undergraduate/senior-essay';

  it('keeps a sibling under the seed directory', () => {
    expect(
      isWithinCrawlSubtree(seed, 'https://example.yale.edu/undergraduate/directed-research'),
    ).toBe(true);
  });

  it('refuses a page outside the seed directory on the same host', () => {
    expect(isWithinCrawlSubtree(seed, 'https://example.yale.edu/about/the-dean')).toBe(false);
  });

  it('refuses another host and another scheme', () => {
    expect(isWithinCrawlSubtree(seed, 'https://other.yale.edu/undergraduate/senior-essay')).toBe(
      false,
    );
    expect(isWithinCrawlSubtree(seed, 'http://example.yale.edu/undergraduate/senior-essay')).toBe(
      false,
    );
  });
});

describe('readOrgUnitCourseCreditRouteValue', () => {
  const value = {
    schemaVersion: 1,
    evidenceQuote: 'Undergraduates receive course credit for directed research in ABCD 4900.',
    supportingQuoteCount: 2,
  };

  it('accepts a versioned value with a quote and a supporting count', () => {
    expect(readOrgUnitCourseCreditRouteValue(value)).toMatchObject({
      schemaVersion: 1,
      supportingQuoteCount: 2,
    });
  });

  it('refuses an unversioned value, an empty quote, and a zero supporting count', () => {
    expect(readOrgUnitCourseCreditRouteValue({ ...value, schemaVersion: 2 })).toBeNull();
    expect(readOrgUnitCourseCreditRouteValue({ ...value, evidenceQuote: '   ' })).toBeNull();
    expect(readOrgUnitCourseCreditRouteValue({ ...value, supportingQuoteCount: 0 })).toBeNull();
    expect(readOrgUnitCourseCreditRouteValue(null)).toBeNull();
  });
});

describe('Signal targeting', () => {
  it('requires exactly one of researchEntityId and orgUnitId', () => {
    expect(signalTargetIsExactlyOne({ researchEntityId: 'a' })).toBe(true);
    expect(signalTargetIsExactlyOne({ orgUnitId: 'b' })).toBe(true);
    expect(signalTargetIsExactlyOne({ researchEntityId: 'a', orgUnitId: 'b' })).toBe(false);
    expect(signalTargetIsExactlyOne({})).toBe(false);
  });

  it('validates an org-unit-targeted signal and refuses one with neither target', () => {
    const orgUnitSignal = new Signal({
      orgUnitId: '507f1f77bcf86cd799439011',
      type: 'COURSE_CREDIT_PATHWAY',
      status: 'KNOWN',
    });
    expect(orgUnitSignal.validateSync()).toBeUndefined();

    const targetless = new Signal({ type: 'COURSE_CREDIT_PATHWAY', status: 'KNOWN' });
    expect(targetless.validateSync()?.errors.researchEntityId).toBeDefined();
  });

  /**
   * The anti-fan-out invariant. A department course page says nothing about an
   * individual entity, so this signal type must never be written onto one.
   */
  it('keys the org-unit uniqueness index so one department cannot hold two rows per source', () => {
    const indexes = Signal.schema.indexes();
    const orgUnitUnique = indexes.find(
      ([fields]) =>
        (fields as Record<string, unknown>).orgUnitId === 1 &&
        (fields as Record<string, unknown>).derivationKey === 1,
    );
    expect(orgUnitUnique?.[1]).toMatchObject({ unique: true });
  });
});
