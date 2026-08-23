import { describe, expect, it } from 'vitest';

import type { ResearchEntityRosterEntry } from '../../services/researchEntityMembershipAccessor';
import {
  entityCarriesPersonProfileIdentity,
  selectContestedLeadEntities,
} from '../purgeContestedLeadProfileSelection';

const rosterEntry = (overrides: Partial<ResearchEntityRosterEntry>): ResearchEntityRosterEntry =>
  ({
    role: 'pi',
    state: 'ACTIVE',
    name: '',
    netid: '',
    profileLinks: [],
    ...overrides,
  }) as unknown as ResearchEntityRosterEntry;

describe('entityCarriesPersonProfileIdentity', () => {
  it('is true when a Yale person profile is on the entity identity links', () => {
    expect(
      entityCarriesPersonProfileIdentity({
        websiteUrl: 'https://medicine.yale.edu/profile/maria-johnson/',
      }),
    ).toBe(true);
  });

  it('is false for a lab or directory landing page', () => {
    expect(
      entityCarriesPersonProfileIdentity({
        websiteUrl: 'https://example.yale.edu/labs/example-lab',
      }),
    ).toBe(false);
  });
});

describe('selectContestedLeadEntities', () => {
  const contaminatedLead = rosterEntry({
    role: 'pi',
    name: 'Mark Johnson',
    netid: 'mjohnson',
  });

  it('selects a non-grant-shell LAB entity whose own profile is a same-surname other person', () => {
    const entities = [
      {
        _id: 'lab-1',
        slug: 'johnson-lab-mjohnson',
        name: 'Johnson Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/maria-johnson/',
        sourceUrls: ['https://medicine.yale.edu/profile/maria-johnson/'],
        studentVisibilityTier: 'operator_review',
      },
    ];
    const roster = new Map([['lab-1', [contaminatedLead]]]);

    const contested = selectContestedLeadEntities(entities, roster);

    expect(contested).toHaveLength(1);
    expect(contested[0]).toMatchObject({
      id: 'lab-1',
      slug: 'johnson-lab-mjohnson',
      websiteUrl: 'https://medicine.yale.edu/profile/maria-johnson/',
    });
  });

  it('selects INDIVIDUAL_RESEARCH and FACULTY_RESEARCH_AREA entities with the same contamination', () => {
    const entities = [
      {
        _id: 'ind-1',
        slug: 'wright-cwright',
        name: 'Craig Wright',
        kind: 'individual',
        entityType: 'INDIVIDUAL_RESEARCH',
        websiteUrl: 'https://medicine.yale.edu/profile/catherine-wright/',
        sourceUrls: ['https://medicine.yale.edu/profile/catherine-wright/'],
      },
      {
        _id: 'fac-1',
        slug: 'sen-sks1',
        name: 'Subrata Sen',
        kind: 'faculty_research_area',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://medicine.yale.edu/profile/sounok-sen/',
        sourceUrls: ['https://medicine.yale.edu/profile/sounok-sen/'],
      },
    ];
    const roster = new Map([
      ['ind-1', [rosterEntry({ name: 'Craig Wright', netid: 'cwright' })]],
      ['fac-1', [rosterEntry({ name: 'Subrata Sen', netid: 'sks1' })]],
    ]);

    const contested = selectContestedLeadEntities(entities, roster);

    expect(contested.map((row) => row.id).sort()).toEqual(['fac-1', 'ind-1']);
  });

  it('excludes organizational and program homes even with a person-profile-shaped link', () => {
    const entities = [
      {
        _id: 'center-1',
        slug: 'whitney-humanities-center',
        name: 'Whitney Humanities Center',
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
        sourceUrls: ['https://medicine.yale.edu/profile/john-smith/'],
      },
      {
        _id: 'program-1',
        slug: 'some-program',
        name: 'Some Program',
        kind: 'program',
        entityType: 'PROGRAM',
        websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
        sourceUrls: ['https://medicine.yale.edu/profile/john-smith/'],
      },
    ];
    const roster = new Map([
      ['center-1', [rosterEntry({ name: 'Jane Doe', netid: 'jd88' })]],
      ['program-1', [rosterEntry({ name: 'Jane Doe', netid: 'jd88' })]],
    ]);

    expect(selectContestedLeadEntities(entities, roster)).toHaveLength(0);
  });

  it('does not select when the lead identity corroborates the profile home', () => {
    const entities = [
      {
        _id: 'lab-2',
        slug: 'doe-lab-jd88',
        name: 'Doe Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
      },
    ];
    const roster = new Map([['lab-2', [rosterEntry({ name: 'Jane Doe', netid: 'jd88' })]]]);

    expect(selectContestedLeadEntities(entities, roster)).toHaveLength(0);
  });

  it('does not select an entity with no person-profile identity link', () => {
    const entities = [
      {
        _id: 'lab-3',
        slug: 'example-lab',
        name: 'Example Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://example.yale.edu/labs/example-lab',
      },
    ];
    const roster = new Map([
      [
        'lab-3',
        [
          rosterEntry({
            name: 'Mark Johnson',
            netid: 'mjohnson',
            profileLinks: [
              {
                kind: 'YALE_OFFICIAL',
                url: 'https://medicine.yale.edu/profile/mark-johnson/',
              },
            ] as unknown as ResearchEntityRosterEntry['profileLinks'],
          }),
        ],
      ],
    ]);

    expect(selectContestedLeadEntities(entities, roster)).toHaveLength(0);
  });

  it('ignores historical roster leads when resolving identity', () => {
    const entities = [
      {
        _id: 'lab-4',
        slug: 'moon-ksm6',
        name: 'Kyoung Moon',
        kind: 'individual',
        entityType: 'INDIVIDUAL_RESEARCH',
        websiteUrl: 'https://medicine.yale.edu/profile/jiyoung-moon/',
        sourceUrls: ['https://medicine.yale.edu/profile/jiyoung-moon/'],
      },
    ];
    const roster = new Map([
      [
        'lab-4',
        [
          rosterEntry({ state: 'HISTORICAL', name: 'Jiyoung Moon', netid: 'jmoon' }),
          rosterEntry({ role: 'pi', name: 'Kyoung Moon', netid: 'ksm6' }),
        ],
      ],
    ]);

    const contested = selectContestedLeadEntities(entities, roster);
    expect(contested).toHaveLength(1);
    expect(contested[0].id).toBe('lab-4');
  });
});
