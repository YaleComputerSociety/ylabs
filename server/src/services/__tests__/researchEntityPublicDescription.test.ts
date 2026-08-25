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

  it('replaces a researchArea chip-echo short even when entityType is not explicitly stored (#1732)', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'lab',
        shortDescription:
          'Studies Cardiovascular Diseases, Stem Cells, Tissue Engineering, and Regenerative Medicine.',
        fullDescription:
          'The Qyang Lab focuses on cardiovascular regeneration using induced pluripotent stem cell technology to model disease and engineer replacement tissue for heart repair. The lab develops novel differentiation protocols to generate cardiovascular cell types from patient-derived stem cells, and applies tissue engineering approaches to build vascularized cardiac constructs for disease modeling and eventual therapeutic transplantation.',
        researchAreas: [
          'Cardiovascular Diseases',
          'Stem Cells',
          'Tissue Engineering',
          'Regenerative Medicine',
        ],
        sourceUrls: ['https://example.yale.edu/labs/qyang'],
      },
    });

    expect(representation.entity.shortDescription).toBe(
      'Focuses on cardiovascular regeneration using induced pluripotent stem cell technology to model disease and engineer replacement tissue for heart repair.',
    );
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
    // The raw poll-stat short is not itself flagged by shortDescriptionQuality
    // (the #1202 gap this test documents), but #1506's resolver now assesses
    // quality against the resolved short, and no derivable replacement exists
    // for a fullDescription that is itself poll-stat chrome - so this now
    // correctly reads as not useful rather than surviving on the unresolved gap.
    expect(representation.quality.short.isUseful).toBe(false);
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
    // #1506's resolver derives a card from this clean fullDescription even
    // though none was stored, so this program-like home now gets a real card
    // too - the point under test is that it isn't *required* to, which the
    // exemption assertions below still cover regardless of this value.
    expect(representation.quality.short.isUseful).toBe(true);
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(true);
    expect(researchEntityServesPublicDetail(entity)).toBe(true);
  });

  it('does not require a lab-style card for an organizational home with a useful full description', () => {
    const entity = {
      kind: 'organization',
      entityType: 'CENTER',
      shortDescription: '',
      // No lab-style "Studies X" first sentence for the card resolver to derive
      // from, so this genuinely exercises the exemption rather than an
      // auto-derived card: full is useful, but no card is derivable.
      fullDescription:
        'The Center brings together faculty, postdoctoral fellows, and graduate students from across the university, and it partners with community organizations, hosts an annual symposium, and administers a competitive seed-grant program open to the whole campus.',
      sourceUrls: ['https://example.yale.edu/centers/ycri'],
    };
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.quality.full.isUseful).toBe(true);
    expect(representation.quality.short.isUseful).toBe(false);
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(true);
    expect(researchEntityServesPublicDetail(entity)).toBe(true);
  });

  it('does not require a lab-style card for an archive/museum project home', () => {
    const entity = {
      kind: 'organization',
      entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
      shortDescription: '',
      fullDescription:
        'This Beinecke curatorial project catalogs and digitizes early modern manuscripts held in the library, making high-resolution images and descriptive metadata available to researchers and students through the library reading room and its online collections portal.',
      sourceUrls: ['https://example.yale.edu/collections/beinecke-project'],
    };
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.quality.full.isUseful).toBe(true);
    // No derivable card either, so the invariant passes purely on the exemption.
    expect(representation.quality.short.isUseful).toBe(false);
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(true);
  });

  it('still requires a lab-style card for a non-program lab home (#1381)', () => {
    // fullDescription is deliberately appointment-only (no research-focus
    // sentence for #1506's resolver to derive a card from), and there are no
    // researchAreas to fall back on either, so this still demonstrates a
    // non-program home genuinely left without any derivable card.
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: '',
        fullDescription: 'Dr. Example Lead is an Assistant Professor of Neuroscience at Yale University.',
        sourceUrls: ['https://example.yale.edu/labs/example'],
      },
      leadMemberNames: ['Example Lead'],
    });

    expect(representation.invariant.reasons).toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(false);
  });

  it('fails the invariant on a keyword-list "is connected to" full description (#1417/#1511)', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription:
          "Some Researcher's work spans genetic neurodegenerative diseases and mitochondrial function.",
        fullDescription:
          'Some Researcher Lab is connected to genetic neurodegenerative diseases, mitochondrial function and pathology, and ubiquitin and proteasome pathways.',
        sourceUrls: ['https://example.yale.edu/labs/some-researcher-lab'],
      },
    });

    expect(representation.quality.full.isUseful).toBe(false);
    expect(representation.invariant.pass).toBe(false);
    expect(representation.invariant.reasons).toContain('missing_public_full_description');
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

    it('rejects a faculty research area whose fullDescription is a bare "Studies <areas>" echo of its own researchAreas chips, with no prose (#1532)', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          researchAreas: ['Extragalactic Astronomy'],
          shortDescription: 'Studies extragalactic astronomy.',
          fullDescription: 'Studies extragalactic astronomy.',
          sourceUrls: ['https://example.yale.edu/faculty/astronomy'],
        }),
      ).toBe(false);
    });
  });
});
