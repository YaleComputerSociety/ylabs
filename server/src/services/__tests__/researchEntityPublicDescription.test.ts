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
      reasons: [
        'missing_public_full_description',
        'missing_public_card_description',
        'blank_served_public_description',
      ],
    });
  });

  it('fails closed when the served read-time hygiene empties both descriptions (#1202)', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'program',
        entityType: 'PROGRAM',
        shortDescription:
          '76% of Americans say they are interested in news stories about the topic.',
        fullDescription:
          '68% of Americans say they support stronger public investment in the topic, according to our latest national survey of public opinion spanning every region of the country and many demographic groups.',
        sourceUrls: ['https://example.yale.edu/programs/communications'],
      },
    });

    expect(representation.quality.full.isUseful).toBe(true);
    expect(representation.quality.short.isUseful).toBe(true);
    expect(representation.invariant.pass).toBe(false);
    expect(representation.invariant.reasons).toEqual(['blank_served_public_description']);
  });

  it('does not require a lab-style card for a program-like home with a useful full description (#1381)', () => {
    const entity = {
      kind: 'program',
      entityType: 'FELLOWSHIP_PROGRAM',
      shortDescription: '',
      fullDescription:
        'A Richter Summer Fellowship is awarded for independent study and research, not for mere travel, work, or enrollment in a school. An internship is a valid use only if its primary component is study or research.',
      sourceUrls: ['https://example.yale.edu/programs/richter'],
    };
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.quality.full.isUseful).toBe(true);
    expect(representation.quality.short.isUseful).toBe(false);
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(true);
    expect(researchEntityServesPublicDetail(entity)).toBe(true);
  });

  it('still requires a lab-style card for a non-program lab home (#1381)', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: '',
        fullDescription:
          'The lab studies the molecular mechanisms of neurodegeneration using genetics, imaging, and biochemistry across model organisms.',
        sourceUrls: ['https://example.yale.edu/labs/example'],
      },
      leadMemberNames: ['Example Lead'],
    });

    expect(representation.invariant.reasons).toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(false);
  });

  it('fails the invariant when only the full description is a research-area echo the quality assessor still calls useful (#1417)', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription:
          'Research connected to genetic neurodegenerative diseases and mitochondrial function.',
        fullDescription:
          'Janghoo Lim Research is connected to genetic neurodegenerative diseases, mitochondrial function and pathology, and ubiquitin and proteasome pathways.',
        sourceUrls: ['https://example.yale.edu/labs/lim-lab'],
      },
    });

    expect(representation.quality.full.isUseful).toBe(true);
    expect(representation.quality.short.isUseful).toBe(true);
    expect(representation.entity.fullDescription).not.toBe('');
    expect(representation.invariant.pass).toBe(false);
    expect(representation.invariant.reasons).toContain('research_area_echo_description');
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

    it('rejects a student_ready card whose descriptions are CTA/poll-stat chrome the served hygiene strips (#1202)', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'program',
          entityType: 'PROGRAM',
          shortDescription:
            '76% of Americans say they are interested in news stories about the topic.',
          fullDescription:
            '68% of Americans say they support stronger public investment in the topic, according to our latest national survey of public opinion spanning every region of the country and many demographic groups.',
          sourceUrls: ['https://example.yale.edu/programs/communications'],
        }),
      ).toBe(false);
    });

    it('rejects a lab whose fullDescription is a "is connected to" area echo, even though its shortDescription survives serve (#1417)', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          shortDescription:
            'Research connected to genetic neurodegenerative diseases and mitochondrial function.',
          fullDescription:
            'Janghoo Lim Research is connected to genetic neurodegenerative diseases, mitochondrial function and pathology, and ubiquitin and proteasome pathways.',
          sourceUrls: ['https://example.yale.edu/labs/lim-lab'],
        }),
      ).toBe(false);
    });
  });
});
