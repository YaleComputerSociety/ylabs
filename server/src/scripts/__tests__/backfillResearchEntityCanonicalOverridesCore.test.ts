import { describe, expect, it } from 'vitest';

import {
  isHttpUrl,
  planCanonicalOverride,
  planHasChanges,
  validateCanonicalOverrideEntry,
} from '../backfillResearchEntityCanonicalOverridesCore';

describe('backfillResearchEntityCanonicalOverridesCore', () => {
  const malone = {
    _id: 'entity-1',
    slug: 'nsf-pi-67d8923a50621bcef4349271',
    name: 'Sparkle Malone Lab',
    displayName: undefined,
    website: '',
    websiteUrl: 'https://environment.yale.edu/directory/faculty/sparkle-malone',
    shortDescription: 'The lab studies coastal wetland dynamics.',
    fullDescription: 'The Sparkle Malone Lab focuses on coastal wetland ecosystem dynamics.',
    sourceUrls: ['https://www.nsf.gov/awardsearch/showAward?AWD_ID=2330792'],
    manuallyLockedFields: [],
  };

  it('sets canonical fields, mirrors website/displayName, appends sourceUrl, and locks applied fields', () => {
    const plan = planCanonicalOverride(malone, {
      slug: malone.slug,
      name: 'Malone Disturbance Ecology Lab',
      website: 'https://www.malonelab.org/',
      shortDescription: 'Short.',
      fullDescription: 'Full description prose.',
    });

    expect(plan.set).toMatchObject({
      name: 'Malone Disturbance Ecology Lab',
      displayName: 'Malone Disturbance Ecology Lab',
      website: 'https://www.malonelab.org/',
      websiteUrl: 'https://www.malonelab.org/',
      shortDescription: 'Short.',
      fullDescription: 'Full description prose.',
    });
    expect(plan.set.sourceUrls).toEqual([
      'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2330792',
      'https://www.malonelab.org/',
    ]);
    expect(plan.lockedFields).toEqual([
      'name',
      'displayName',
      'website',
      'websiteUrl',
      'shortDescription',
      'fullDescription',
    ]);
    expect(plan.set.manuallyLockedFields).toEqual(plan.lockedFields);
    expect(planHasChanges(plan)).toBe(true);
  });

  it('locks an already-correct field without emitting a redundant value change', () => {
    const plan = planCanonicalOverride(
      { ...malone, name: 'Malone Disturbance Ecology Lab', displayName: 'Malone Disturbance Ecology Lab' },
      { slug: malone.slug, name: 'Malone Disturbance Ecology Lab' },
    );

    expect(plan.changedFields).not.toContain('name');
    expect(plan.changedFields).not.toContain('displayName');
    expect(plan.lockedFields).toEqual(expect.arrayContaining(['name', 'displayName']));
    expect(plan.set).toMatchObject({ manuallyLockedFields: expect.arrayContaining(['name']) });
  });

  it('is a no-op when the entity already matches and the fields are already locked', () => {
    const already = {
      ...malone,
      name: 'Malone Disturbance Ecology Lab',
      displayName: 'Malone Disturbance Ecology Lab',
      website: 'https://www.malonelab.org/',
      websiteUrl: 'https://www.malonelab.org/',
      sourceUrls: [
        'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2330792',
        'https://www.malonelab.org/',
      ],
      manuallyLockedFields: ['name', 'displayName', 'website', 'websiteUrl'],
    };
    const plan = planCanonicalOverride(already, {
      slug: malone.slug,
      name: 'Malone Disturbance Ecology Lab',
      website: 'https://www.malonelab.org/',
    });
    expect(planHasChanges(plan)).toBe(false);
    expect(plan.set).toEqual({});
  });

  it('preserves pre-existing locked fields when merging', () => {
    const plan = planCanonicalOverride(
      { ...malone, manuallyLockedFields: ['researchAreas'] },
      { slug: malone.slug, website: 'https://www.malonelab.org/' },
    );
    expect(plan.lockedFields).toEqual(expect.arrayContaining(['researchAreas', 'website', 'websiteUrl']));
  });

  it('rejects entries without an identifier or overridable field', () => {
    expect(validateCanonicalOverrideEntry({ name: 'X' })).toMatch(/slug or recordId/);
    expect(validateCanonicalOverrideEntry({ slug: 's' })).toMatch(/no overridable fields/);
  });

  it('rejects a non-http website', () => {
    expect(validateCanonicalOverrideEntry({ slug: 's', website: 'ftp://x' })).toMatch(/http/);
    expect(isHttpUrl('https://www.malonelab.org/')).toBe(true);
    expect(isHttpUrl('mailto:x@y.z')).toBe(false);
  });
});
