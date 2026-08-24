import { describe, expect, it } from 'vitest';
import {
  planSameNameGraftCleanup,
  summarizeSameNameGraftPlans,
} from '../cleanupSameNameGraftResidualsCore';

describe('planSameNameGraftCleanup', () => {
  it('strips grafted clinical areas while preserving the surviving discipline area', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'hist-0000',
        researchAreas: [
          'Opioid Use Disorder Treatment',
          'Musculoskeletal pain and rehabilitation',
          'History',
        ],
      },
      {
        slug: 'hist-0000',
        removeAreas: ['Opioid Use Disorder Treatment', 'Musculoskeletal pain and rehabilitation'],
      },
    );
    expect(plan.areasAfter).toEqual(['History']);
    expect(plan.removedAreas).toHaveLength(2);
    expect(plan.missingRemoveAreas).toEqual([]);
    expect(plan.changed).toBe(true);
  });

  it('restores fallback discipline areas only when the list is left empty', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'lit-0000',
        researchAreas: [],
      },
      {
        slug: 'lit-0000',
        removeAreas: [],
        fallbackAreasWhenEmpty: ['Literature', 'British Literature'],
      },
    );
    expect(plan.areasAfter).toEqual(['Literature', 'British Literature']);
    expect(plan.addedAreas).toEqual(['Literature', 'British Literature']);
    expect(plan.changed).toBe(true);
  });

  it('does not apply fallback areas when a legitimate area still survives', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'lit-0001',
        researchAreas: ['Literature'],
      },
      {
        slug: 'lit-0001',
        removeAreas: [],
        fallbackAreasWhenEmpty: ['British Literature', 'Renaissance Studies'],
      },
    );
    expect(plan.areasAfter).toEqual(['Literature']);
    expect(plan.addedAreas).toEqual([]);
    expect(plan.changed).toBe(false);
  });

  it('flags drift when a directed removal is not present and makes no change', () => {
    const plan = planSameNameGraftCleanup(
      { slug: 'econ-0000', researchAreas: ['Economics', 'Game Theory'] },
      { slug: 'econ-0000', removeAreas: ['Liver Disease and Transplantation'] },
    );
    expect(plan.missingRemoveAreas).toEqual(['Liver Disease and Transplantation']);
    expect(plan.removedAreas).toEqual([]);
    expect(plan.areasAfter).toEqual(['Economics', 'Game Theory']);
    expect(plan.changed).toBe(false);
  });

  it('clears a contradicting-host websiteUrl and drops matching sourceUrls', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'fr-0000',
        researchAreas: ['French Literature'],
        websiteUrl: 'https://medicine.yale.edu/profile/sample-person/',
        sourceUrls: [
          'https://medicine.yale.edu/profile/sample-person/',
          'https://orcid.org/0000-0000-0000-0000',
        ],
      },
      {
        slug: 'fr-0000',
        removeAreas: [],
        clearWebsiteHostIncludes: 'medicine.yale.edu',
      },
    );
    expect(plan.websiteCleared).toBe(true);
    expect(plan.websiteAfter).toBe('');
    expect(plan.sourceUrlsRemoved).toEqual(['https://medicine.yale.edu/profile/sample-person/']);
    expect(plan.changed).toBe(true);
  });

  it('leaves a legitimate non-matching websiteUrl untouched', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'fr-0001',
        researchAreas: ['French Literature'],
        websiteUrl: 'https://french.yale.edu/people/sample-person',
      },
      {
        slug: 'fr-0001',
        removeAreas: [],
        clearWebsiteHostIncludes: 'medicine.yale.edu',
      },
    );
    expect(plan.websiteCleared).toBe(false);
    expect(plan.websiteAfter).toBe('https://french.yale.edu/people/sample-person');
    expect(plan.changed).toBe(false);
  });

  it('rewrites a short description that echoes a removed graft area, using the full description', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'poli-0000',
        researchAreas: ['Protein Structure and Dynamics', 'Political Science'],
        shortDescription:
          "Sample Person's research fields include Protein Structure and Dynamics, Heart Rate Variability, and Erythrocyte Function.",
        fullDescription:
          'Sample Person is an Assistant Professor of Political Science studying courts and institutions. Their agenda investigates disparities in institutional outcomes.',
      },
      {
        slug: 'poli-0000',
        removeAreas: ['Protein Structure and Dynamics'],
        reshortFromFullDescription: true,
      },
    );
    expect(plan.areasAfter).toEqual(['Political Science']);
    expect(plan.shortChanged).toBe(true);
    expect(plan.shortAfter).toBe(
      'Sample Person is an Assistant Professor of Political Science studying courts and institutions.',
    );
    expect(plan.changed).toBe(true);
  });

  it('does not rewrite a short description that does not echo a removed area', () => {
    const plan = planSameNameGraftCleanup(
      {
        slug: 'poli-0001',
        researchAreas: ['Veterinary Oncology Research', 'Political Science'],
        shortDescription: 'Studies the politics of courts and institutional change.',
        fullDescription: 'A longer clean biography sentence. And a second sentence.',
      },
      {
        slug: 'poli-0001',
        removeAreas: ['Veterinary Oncology Research'],
        reshortFromFullDescription: true,
      },
    );
    expect(plan.shortChanged).toBe(false);
    expect(plan.shortAfter).toBe('Studies the politics of courts and institutional change.');
  });

  it('summarizes plans across the batch', () => {
    const plans = [
      planSameNameGraftCleanup(
        { slug: 'a-0000', researchAreas: ['Veterinary Oncology Research', 'History'] },
        { slug: 'a-0000', removeAreas: ['Veterinary Oncology Research'] },
      ),
      planSameNameGraftCleanup(
        {
          slug: 'b-0000',
          researchAreas: ['Jewish Studies'],
          websiteUrl: 'https://medicine.yale.edu/profile/sample-person/',
        },
        { slug: 'b-0000', removeAreas: [], clearWebsiteHostIncludes: 'medicine.yale.edu' },
      ),
      planSameNameGraftCleanup(
        { slug: 'c-0000', researchAreas: ['Economics'] },
        { slug: 'c-0000', removeAreas: ['Liver Disease and Transplantation'] },
      ),
    ];
    const summary = summarizeSameNameGraftPlans(plans);
    expect(summary.considered).toBe(3);
    expect(summary.changed).toBe(2);
    expect(summary.areasRemoved).toBe(1);
    expect(summary.websitesCleared).toBe(1);
    expect(summary.driftSlugs).toEqual(['c-0000']);
  });
});
