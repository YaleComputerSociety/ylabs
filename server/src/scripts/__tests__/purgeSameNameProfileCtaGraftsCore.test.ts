import { describe, expect, it } from 'vitest';

import {
  SAME_NAME_PROFILE_CTA_GRAFTS,
  planSourceUrlPurge,
  shouldClearGraftedWebsite,
} from '../purgeSameNameProfileCtaGraftsCore';

describe('shouldClearGraftedWebsite', () => {
  it('clears only when the current website is the documented graft (slash/case tolerant)', () => {
    expect(
      shouldClearGraftedWebsite(
        'https://medicine.yale.edu/profile/aaron-wolfe/',
        'https://medicine.yale.edu/profile/aaron-wolfe/',
      ),
    ).toBe(true);
    expect(
      shouldClearGraftedWebsite(
        'https://medicine.yale.edu/profile/aaron-wolfe',
        'https://medicine.yale.edu/profile/aaron-wolfe/',
      ),
    ).toBe(true);
  });

  it('leaves an already-cleared or corrected website untouched', () => {
    expect(shouldClearGraftedWebsite('', 'https://medicine.yale.edu/profile/aaron-wolfe/')).toBe(
      false,
    );
    expect(
      shouldClearGraftedWebsite(
        'https://reporter.nih.gov/project-details/10890875',
        'https://medicine.yale.edu/profile/aaron-wolfe/',
      ),
    ).toBe(false);
  });
});

describe('planSourceUrlPurge', () => {
  it('removes the graft when another source route survives (wolfe keeps NIH RePORTER)', () => {
    const plan = planSourceUrlPurge(
      [
        'https://reporter.nih.gov/project-details/10890875',
        'https://medicine.yale.edu/profile/aaron-wolfe/',
      ],
      'https://medicine.yale.edu/profile/aaron-wolfe/',
    );
    expect(plan.after).toEqual(['https://reporter.nih.gov/project-details/10890875']);
    expect(plan.removed).toEqual(['https://medicine.yale.edu/profile/aaron-wolfe/']);
    expect(plan.safeToApply).toBe(true);
  });

  it('refuses to strip the only source route (samuels needs correct-URL acquisition)', () => {
    const plan = planSourceUrlPurge(
      ['https://medicine.yale.edu/profile/maurice-samuels/'],
      'https://medicine.yale.edu/profile/maurice-samuels/',
    );
    expect(plan.removed).toEqual(['https://medicine.yale.edu/profile/maurice-samuels/']);
    expect(plan.safeToApply).toBe(false);
  });

  it('is a no-op when the graft is absent and tolerates non-array input', () => {
    expect(
      planSourceUrlPurge(['https://history.yale.edu/people/x'], 'https://medicine.yale.edu/profile/y/')
        .safeToApply,
    ).toBe(false);
    expect(planSourceUrlPurge(undefined, 'https://medicine.yale.edu/profile/y/').removed).toEqual([]);
  });
});

describe('SAME_NAME_PROFILE_CTA_GRAFTS', () => {
  it('targets the two post-#1270 residual entities with medicine.yale.edu profile grafts', () => {
    expect(Object.keys(SAME_NAME_PROFILE_CTA_GRAFTS).sort()).toEqual([
      'nih-pi-aaron-wolfe',
      'samuels-mas278',
    ]);
    for (const url of Object.values(SAME_NAME_PROFILE_CTA_GRAFTS)) {
      expect(url).toMatch(/^https:\/\/medicine\.yale\.edu\/profile\//);
    }
  });
});
