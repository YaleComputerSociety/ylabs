import { describe, expect, it } from 'vitest';

import {
  buildResearchEntityPublicDescriptionRepresentation,
  publicDescriptionLeadMemberNames,
  researchEntityServesPublicDetail,
} from '../researchEntityPublicDescription';

describe('researchEntityPublicDescription', () => {
  it('assesses the lead-aware post-sanitization representation', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        shortDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling.",
        fullDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling across complex biological systems.",
        sourceUrls: ['https://example.yale.edu/profile/correct-person'],
      },
      leadMembers: [
        {
          name: 'Stale Row Name',
          user: { fname: 'Correct', lname: 'Person' },
        },
      ],
    });

    expect(representation.leadMemberNames).toEqual(['Correct Person']);
    expect(representation.entity.shortDescription).toBe('');
    expect(representation.entity.fullDescription).toBe('');
    expect(representation.invariant).toEqual({
      pass: false,
      fullDescriptionUseful: false,
      cardDescriptionUseful: false,
      reasons: ['missing_public_full_description', 'missing_public_card_description'],
    });
  });

  it('uses the public detail lead-name contract when explicit names are supplied', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription:
          "Correct Person's research examines molecular dynamics and cellular signaling.",
        fullDescription:
          "Correct Person's research examines molecular dynamics and cellular signaling across complex biological systems.",
        sourceUrls: ['https://example.yale.edu/profile/correct-person'],
      },
      leadMemberNames: ['Correct Person'],
    });

    expect(representation.invariant.pass).toBe(true);
    expect(representation.entity.shortDescription).toContain("Correct Person's research");
  });

  it('fails the invariant when the serve-DTO hygiene blanks a description that survives the copy-field chain (#1202)', () => {
    const entity = {
      kind: 'program',
      entityType: 'PROGRAM',
      shortDescription:
        '82% of Residents say they support expanded public transit funding across the region.',
      fullDescription:
        'Sign up for our newsletter to stay informed. Join us on LinkedIn and YouTube for weekly updates and event announcements. Register now for the fall symposium on climate policy.',
      sourceUrls: ['https://example.yale.edu/program/example'],
    };
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.invariant).toEqual({
      pass: false,
      fullDescriptionUseful: false,
      cardDescriptionUseful: false,
      reasons: ['missing_public_full_description', 'missing_public_card_description'],
    });
    expect(researchEntityServesPublicDetail(entity)).toBe(false);
  });

  it('deduplicates lead identities from populated member rows', () => {
    expect(
      publicDescriptionLeadMemberNames([
        { user: { displayName: 'Correct Person' } },
        { user: { fname: 'Correct', lname: 'Person' } },
      ]),
    ).toEqual(['Correct Person']);
  });

  it('uses a name-only member row as a lead identity', () => {
    expect(publicDescriptionLeadMemberNames([{ name: 'Correct Person' }])).toEqual([
      'Correct Person',
    ]);
  });

  describe('researchEntityServesPublicDetail', () => {
    it('serves an entity whose live public-description invariant passes', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'group',
          shortDescription:
            'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
          fullDescription:
            'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
          sourceUrls: ['https://example.yale.edu/labs/test-lab'],
        }),
      ).toBe(true);
    });

    it('rejects a hollow entity with empty descriptions even when descriptionSource is set (#998)', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          descriptionSource: 'PI_PROFILE_SYNTHESIS',
          researchAreas: ['Middle East Studies', 'Iranian Studies'],
          shortDescription: '',
          fullDescription: '',
          sourceUrls: [],
        }),
      ).toBe(false);
    });
  });
});
