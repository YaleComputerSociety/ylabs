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
      entityType: 'PROGRAM',
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
        fullDescription:
          'Dr. Example Lead is an Assistant Professor of Neuroscience at Yale University.',
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

  describe('the name-agnostic gate is NOT nested with the lead-aware detail gate (#2241)', () => {
    // Pins the refutation of a former comment claiming lead-name stripping "only
    // ever removes more text, so ... dropping it can never hide a card the detail
    // page would serve". Removing text is not the same as a monotonically stricter
    // verdict. If someone reintroduces a nesting assumption, these fail.
    // #2240 retired the trigger this fixture originally used. It opened on the
    // record's OWN lead ("Dr. Cohen's" on a record led by Andrew B Cohen), which
    // the strip treated as a stranger because an honorific standing in for the
    // given name defeated the match. Every one of the 207 firings the guard
    // produced over the live corpus was that kind of false positive, so the strip
    // now recognises its own lead and this shape is preserved verbatim - pinned by
    // the sibling test below. The mechanism this block exists to pin still exists,
    // and this fixture now uses the input that reaches it: a genuinely third-party
    // possessive, which is the graft the strip is for.
    const leadNameOpenerEntity = {
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Andrew B Cohen - Research',
      sourceUrls: ['https://example.yale.edu/profile/andrew-cohen'],
      studentVisibilityTier: 'student_ready',
      shortDescription:
        "Marguerite Delacroix's research aims to understand how immune cells recognise tumour antigens in solid cancers.",
      fullDescription:
        "Marguerite Delacroix's research aims to understand how immune cells recognise tumour antigens in solid cancers, using single-cell sequencing of patient biopsies to map antigen presentation across tumour microenvironments.",
    };

    it('preserves a possessive naming the record own lead under an honorific (#2240)', () => {
      const ownLeadEntity = {
        ...leadNameOpenerEntity,
        shortDescription:
          "Dr. Cohen's research aims to understand how immune cells recognise tumour antigens in solid cancers.",
        fullDescription:
          "Dr. Cohen's research aims to understand how immune cells recognise tumour antigens in solid cancers, using single-cell sequencing of patient biopsies to map antigen presentation across tumour microenvironments.",
      };
      const leadAware = buildResearchEntityPublicDescriptionRepresentation({
        entity: ownLeadEntity,
        leadMemberNames: ['Andrew B Cohen'],
      });

      expect(leadAware.entity.fullDescription).toBe(ownLeadEntity.fullDescription);
      expect(leadAware.entity.fullDescription).not.toContain('This research aims to');
    });

    // #2597 closed the CARD axis of this disagreement: the serve refusal now asks
    // whether a card renders rather than how it scores, so lead-name stripping can
    // no longer turn a still-rendering card into a 404. The non-nesting lesson this
    // block exists to pin is unchanged and is still load-bearing on the BODY axis,
    // which the sibling test below measures: stripping CREATES text changes, and a
    // verdict computed on the stripped body is not a subset of one computed without
    // it. Do not reintroduce a nesting or monotonicity assumption in either
    // direction.
    it('now agrees with the lead-aware gate on the card axis, because a rendering card is served', () => {
      expect(researchEntityServesPublicDetail(leadNameOpenerEntity)).toBe(true);

      const leadAware = buildResearchEntityPublicDescriptionRepresentation({
        entity: leadNameOpenerEntity,
        leadMemberNames: ['Andrew B Cohen'],
      });
      expect(leadAware.cardDescription).not.toBe('');
      expect(leadAware.invariant.cardDescriptionUseful).toBe(false);
      expect(leadAware.invariant.reasons).not.toContain('missing_public_card_description');
      expect(leadAware.invariant.pass).toBe(true);
    });

    it('shows stripping CREATING the failure rather than only removing text', () => {
      const leadAware = buildResearchEntityPublicDescriptionRepresentation({
        entity: leadNameOpenerEntity,
        leadMemberNames: ['Andrew B Cohen'],
      });
      // The lead-name self-reference is stripped, and what remains is what fails.
      expect(leadAware.fullDescription).toContain('This research aims to');
      expect(leadAware.fullDescription).not.toContain("Marguerite Delacroix's");
      // Sharper than "stripping empties the card": the card still renders, falling
      // back to the stripped full. The gate fails on the stored short's own quality
      // after stripping, so it rejects an entity that HAS renderable card copy.
      expect(leadAware.cardDescription).toContain('This research aims to');
      expect(leadAware.invariant.cardDescriptionUseful).toBe(false);
    });
  });
});

describe('organizational card exemption agrees with the gate (#1872)', () => {
  const organizationalHome = {
    entityType: 'CENTER',
    name: 'Yale Center for Example Coastal Systems',
    fullDescription:
      'The Yale Center for Example Coastal Systems convenes faculty and students across geology, ecology, and engineering to study coastal erosion, sediment transport, and shoreline adaptation, and it runs a visiting-scholar programme and an annual field season.',
    websiteUrl: 'https://coastal.example.yale.edu',
    sourceUrls: ['https://coastal.example.yale.edu'],
  };

  it('does not fail the card invariant for an organizational home with no card', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: organizationalHome,
    });

    expect(representation.cardDescription).toBe('');
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(true);
    expect(researchEntityServesPublicDetail(organizationalHome)).toBe(true);
  });

  it('still fails the card invariant for a lab-style home with no card', () => {
    const labStyleHome = { ...organizationalHome, entityType: 'LAB' };

    expect(
      buildResearchEntityPublicDescriptionRepresentation({ entity: labStyleHome }).invariant
        .reasons,
    ).toContain('missing_public_card_description');
  });
});

describe('the serve refusal asks what renders, not how the card scores (#2597)', () => {
  const body =
    'The group studies coastal erosion, sediment transport and shoreline adaptation across the Atlantic seaboard, combining field surveys with numerical modelling.';
  const labWith = (shortDescription: string) => ({
    entityType: 'LAB',
    name: 'Example Coastal Lab',
    fullDescription: body,
    shortDescription,
    websiteUrl: 'https://example.yale.edu/coastal',
    sourceUrls: ['https://example.yale.edu/coastal'],
  });

  it.each([
    ['a card byte-identical to the body', body],
    ['a card copied from the body first clause', 'The group studies coastal erosion.'],
  ])('serves a row whose card scores poorly but still renders: %s', (_label, shortDescription) => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: labWith(shortDescription),
    });

    expect(representation.cardDescription).not.toBe('');
    expect(representation.invariant.cardDescriptionUseful).toBe(false);
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(true);
    expect(researchEntityServesPublicDetail(labWith(shortDescription))).toBe(true);
  });

  it('still refuses a row whose served card is empty', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: labWith(''),
    });

    expect(representation.cardDescription).toBe('');
    expect(representation.invariant.reasons).toContain('missing_public_card_description');
    expect(representation.invariant.pass).toBe(false);
  });

  it('does not let a body edit flip a byte-identical card into a refusal', () => {
    const card = body;
    const servesWithBody = (fullDescription: string) =>
      researchEntityServesPublicDetail({
        entityType: 'LAB',
        name: 'Example Coastal Lab',
        fullDescription,
        shortDescription: card,
        websiteUrl: 'https://example.yale.edu/coastal',
        sourceUrls: ['https://example.yale.edu/coastal'],
      });

    expect(servesWithBody(body)).toBe(true);
    expect(servesWithBody(`${body} A second sentence extends the body.`)).toBe(true);
  });
});

describe('the gate judges the card the serve sanitizer produces (#3097)', () => {
  it("refuses a person-scoped row whose card is another organization's prose (#3067)", () => {
    const entity = {
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Robin Marrow - Research',
      slug: 'robin-marrow-research',
      researchAreas: ['Health Equity'],
      shortDescription:
        'The Office of Health Equity Research is the organizing center of health equity research at the medical school.',
      fullDescription:
        'Studies how health systems adopt measurement based care, using trial data and clinician interviews to identify what makes routine outcome measurement stick in community mental health settings.',
      websiteUrl: 'https://medicine.example.edu/profile/marrow/',
      sourceUrls: ['https://medicine.example.edu/profile/marrow/'],
    };

    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.servedCard).toBe('');
    expect(representation.invariant.reasons).toContain('missing_public_card_description');
    expect(researchEntityServesPublicDetail(entity)).toBe(false);
  });

  it('refuses a row whose only carding chip research-area hygiene drops', () => {
    const entity = {
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Example Research Profile',
      slug: 'example-research-profile',
      researchAreas: ['Research Interests'],
      shortDescription: '',
      fullDescription:
        'Research interests are pursued with collaborators across the school and are supported by several ongoing awards, and trainees at every level contribute to the work.',
      websiteUrl: 'https://medicine.example.edu/profile/example/',
      sourceUrls: ['https://medicine.example.edu/profile/example/'],
    };

    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.servedCard).toBe('');
    expect(representation.invariant.reasons).toContain('missing_public_card_description');
  });
});
