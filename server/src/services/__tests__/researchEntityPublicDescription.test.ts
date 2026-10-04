import { describe, expect, it } from 'vitest';

import {
  buildResearchEntityPublicDescriptionRepresentation,
  publicDescriptionLeadMemberNames,
  researchEntityServesPublicDetail,
  servedBodyIsBiographyWithoutResearch,
} from '../researchEntityPublicDescription';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import { withMemoizedDescriptionQuality } from '../../utils/researchEntityDescriptionQuality';

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

    it('serves a faculty research area whose only body is a "Studies <areas>" echo of its own chips, as thin but accurate', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          researchAreas: ['Extragalactic Astronomy'],
          shortDescription: 'Studies extragalactic astronomy.',
          fullDescription: 'Studies extragalactic astronomy.',
          sourceUrls: ['https://example.yale.edu/faculty/astronomy'],
          fieldProvenance: { fullDescription: { sourceName: 'dept-faculty-roster' } },
        }),
      ).toBe(true);
    });

    it('serves a "Studies <areas>" echo a language-model lane wrote, as thin but accurate', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          researchAreas: ['Extragalactic Astronomy'],
          shortDescription: 'Studies extragalactic astronomy.',
          fullDescription: 'Studies extragalactic astronomy.',
          sourceUrls: ['https://example.yale.edu/faculty/astronomy'],
          fieldProvenance: { fullDescription: { sourceName: 'lab-microsite-description-llm' } },
        }),
      ).toBe(true);
    });

    it('still refuses a "Studies <areas>" echo that is a page fragment', () => {
      expect(
        researchEntityServesPublicDetail({
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          researchAreas: ['Particle Physics'],
          shortDescription: '',
          fullDescription: 'Studies particle physics, including research areas:.',
          sourceUrls: ['https://example.yale.edu/faculty/physics'],
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

describe('a thin first-person appointment line that names its topics serves (#4635)', () => {
  it('revoices the line and passes the public description invariant', () => {
    const entity = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      name: 'Alex Rivera Faculty Research',
      fullDescription:
        'I am a professor in the mathematics department at Yale studying representation theory and algebraic geometry.',
      shortDescription:
        "Alex Rivera's research studies representation theory and algebraic geometry.",
      researchAreas: ['Representation Theory', 'Algebraic Geometry'],
      sourceUrls: ['https://math.example.yale.edu/profile/alex-rivera'],
    };

    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity,
      leadMemberNames: ['Alex Rivera'],
    });

    expect(representation.entity.fullDescription).toBe(
      'Alex Rivera is a professor in the mathematics department at Yale studying representation theory and algebraic geometry.',
    );
    expect(representation.invariant.pass).toBe(true);
    expect(
      toPublicResearchEntityDto(representation.entity, { leadMemberNames: ['Alex Rivera'] })
        .fullDescription,
    ).toBe(representation.entity.fullDescription);
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
  it("serves a person-scoped row's own body in place of another organization's card (#3067)", () => {
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

    expect(representation.servedCard).not.toContain('Office of Health Equity Research');
    expect(representation.servedCard).toBe(entity.fullDescription);
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

describe('one derivation scope shared across a page of rows', () => {
  const sedimentBody =
    'The group studies how estuarine sediment transport reshapes coastal marshes, combining flume experiments with field surveys to measure storm surge redistribution.';
  const row = (id: string, fields: Record<string, unknown>) => ({
    _id: id,
    slug: id,
    name: `${id} Lab`,
    kind: 'group',
    entityType: 'LAB',
    sourceUrls: [`https://example.yale.edu/${id}`],
    ...fields,
  });

  const rows = [
    row('sediment-one', {
      researchAreas: ['Sediment Transport'],
      shortDescription: 'Studies estuarine sediment transport in coastal marshes.',
      fullDescription: sedimentBody,
    }),
    row('sediment-twin', {
      researchAreas: ['Sediment Transport'],
      shortDescription: 'Studies estuarine sediment transport in coastal marshes.',
      fullDescription: sedimentBody,
    }),
    row('no-copy', { researchAreas: [], shortDescription: '', fullDescription: '' }),
    row('body-only', {
      researchAreas: ['Sediment Transport'],
      shortDescription: '',
      fullDescription: sedimentBody,
    }),
  ];

  const deriveAll = () =>
    rows.map((entity) => ({
      serves: researchEntityServesPublicDetail(entity),
      card: JSON.stringify(toPublicResearchEntityDto(entity, { forList: true })),
      detail: JSON.stringify(toPublicResearchEntityDto(entity, {})),
    }));

  it('gives every row the verdict and card it gets on its own', () => {
    const alone = deriveAll();
    const shared = withMemoizedDescriptionQuality(deriveAll);
    expect(shared).toEqual(alone);
    expect(alone.map((entry) => entry.serves)).toEqual([true, true, false, true]);
    expect(alone[0].card).not.toBe(alone[1].card);
  });
});

describe('a body pasted from a CV serves its research', () => {
  const served = (fullDescription: string, shortDescription = '') =>
    buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        name: 'Robin Fixture Faculty Research',
        fullDescription,
        shortDescription,
      },
    });

  it('drops a dated book list and an award that follow the research statement', () => {
    const representation = served(
      "Robin Fixture's research explores how coastal towns adapt to repeated flooding, using archival records and household surveys to trace who moves and who stays. She is the author of Rising Water (2011), Salt Roads (2007), and Harbor Lines (2002). She was awarded an example prize for her scholarship in 2015.",
      'Studies how coastal towns adapt to repeated flooding, using archival records and household surveys.',
    );
    expect(representation.entity.fullDescription).toContain('adapt to repeated flooding');
    expect(representation.entity.fullDescription).not.toMatch(/author of|\(2011\)|awarded/);
  });

  it('anchors on a research activity sentence when the CV states no explicit research frame', () => {
    const representation = served(
      'Robin Fixture is Associate Professor of Example Studies. She studies the politics of river management in delta regions, comparing how agencies allocate water during drought. She is the author of Delta Rule (Example Press, 2020). She received a Ph.D. from Example University and a B.A. from Another University.',
      'Studies the politics of river management in delta regions and how agencies allocate water during drought.',
    );
    expect(representation.entity.fullDescription).toContain('politics of river management');
    expect(representation.entity.fullDescription).not.toMatch(/author of|Ph\.D\./);
  });

  it('keeps the whole body when the narrowed body would not serve', () => {
    const body =
      'Robin Fixture won an example prize for drama. Her plays include River Song (2019), Salt (2015), and Harbor (2012). She received grants from an example foundation.';
    expect(served(body).entity.fullDescription).toBe(body);
  });
});

describe('a biography whose research sits among career facts serves its research', () => {
  const served = (
    fullDescription: string,
    shortDescription = '',
    leadMemberNames: readonly string[] = [],
  ) =>
    buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        name: 'Robin Fixture Faculty Research',
        fullDescription,
        shortDescription,
      },
      leadMemberNames,
    });

  it('reads a CV whose degree is named without an article and whose record is "has published in"', () => {
    const representation = served(
      'Dr. Fixture has longstanding interests in the research of tissue inflammation, with specific training in immunobiology of the liver. He received Ph.D. from Example University in 2004. Dr. Fixture has focused on identifying the regulators of metabolic inflammation in liver disease. Dr. Fixture has published in Example Journal, Another Journal, and Third Journal.',
      'Identifies the regulators of metabolic inflammation in liver disease.',
    );
    expect(representation.entity.fullDescription).toContain('regulators of metabolic inflammation');
    expect(representation.entity.fullDescription).not.toMatch(/received Ph\.D\.|has published in/);
  });

  it('keeps the sentence that orients the reader and drops editorial boards, a co-founding and private life', () => {
    const representation = served(
      'Robin Fixture is a historian of early modern ports and their labor markets. She joined the faculty in 2012 after teaching at Example College. She is particularly interested in how dock work was organized across the Atlantic. She serves on the editorial boards of Example Review and Another Review. She was a co-founder of an example reading group. In her free time she enjoys spending time with her dogs.',
      'Studies early modern ports and how dock work was organized across the Atlantic.',
    );
    const body = representation.entity.fullDescription;
    expect(body).toContain('historian of early modern ports');
    expect(body).toContain('how dock work was organized');
    expect(body).not.toMatch(/editorial boards|co-founder|free time|joined the faculty/);
  });

  it('does not anchor on an interest in supervising students', () => {
    const body =
      'Robin Fixture is a historian of modern architecture and its media. His current book project explores cinema buildings in five cities. He joined the faculty in 2015. Professor Fixture is interested in supervising dissertations on twentieth-century architecture.';
    expect(served(body).entity.fullDescription).toContain('historian of modern architecture');
  });

  it('reads the research sentence glued behind a degree run before narrowing', () => {
    const representation = served(
      'Ph.D., M.A., Example College, ExampleshireM.A. Another University Robin Fixture specializes in the literatures and music of medieval France and England. Born in an example town, she took her BA and PhD degrees at Example College. She was elected a fellow of an example society and appointed Lecturer at Another University. She won the Example Prize in 2008. She has particular interests in the medieval lyric and lyric theory.',
      'Studies the literatures and music of medieval France and England.',
      ['Robin Fixture'],
    );
    expect(representation.entity.fullDescription).toContain(
      'specializes in the literatures and music',
    );
    expect(representation.entity.fullDescription).not.toMatch(
      /took her BA|elected a fellow|Example Prize/,
    );
  });

  it('keeps research sentences that only resemble citation or record markers', () => {
    const representation = served(
      'Robin Fixture received a Ph.D. from Example University in 2004 and joined the faculty in 2010. She studies how detectors are built for dark matter experiments. These detectors are part of the search for axions. The press covered the 2020 election through these detectors. Her models predict CV outcomes in older adults. She was awarded the Example Prize in 2015.',
      'Builds detectors for dark matter experiments.',
    );
    const body = representation.entity.fullDescription;
    expect(body).toContain('search for axions');
    expect(body).toContain('press covered the 2020 election');
    expect(body).toContain('CV outcomes');
    expect(body).not.toMatch(/joined the faculty|Example Prize/);
  });

  it('keeps research sentences that share a verb or a place with a career record', () => {
    const representation = served(
      'Robin Fixture joined the faculty in 2010. She studies cardiac gene regulation. We have edited the genomes of zebrafish to model heart disease. We have translated these findings into a clinical trial. We worked with farmers in Kenya to measure soil carbon. The project traces the legacy of the London 2012 Games. She won the Example Prize in 2015.',
      'Studies cardiac gene regulation in zebrafish models of heart disease.',
    );
    const body = representation.entity.fullDescription;
    expect(body).toContain('edited the genomes of zebrafish');
    expect(body).toContain('translated these findings');
    expect(body).toContain('worked with farmers');
    expect(body).toContain('London 2012 Games');
    expect(body).not.toMatch(/joined the faculty|Example Prize/);
  });

  it('still narrows a CV whose only CV signal is the leading degree run', () => {
    const representation = served(
      'Ph.D., History, Example University, 2004 M.A., History, Another University, 1999 B.A., History, Example College, 1997 Robin Fixture studies the labor history of early modern ports. She has also taught at Example College and Another College.',
      'Studies the labor history of early modern ports.',
      ['Robin Fixture'],
    );
    const body = representation.entity.fullDescription;
    expect(body).toContain('studies the labor history of early modern ports');
    expect(body).not.toMatch(/taught at|Example University/);
  });

  it('leaves a body that only orients the reader with a role noun unnarrowed', () => {
    const body =
      'Robin Fixture is a cell biologist who studies membrane signaling in immune cells. Her lab combines reconstitution with live-cell imaging to follow receptor clustering.';
    expect(served(body).entity.fullDescription).toBe(body);
  });
});

describe('a biography that states no research', () => {
  it('is not held when it is an arts practice biography, which is served as creative practice', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        name: 'Robin Fixture Faculty Research',
        departments: ['Music'],
        school: 'School of Music',
        fullDescription:
          'Robin Fixture graduated from an example conservatory in 1989 and joined the faculty in 2004. A violinist, she has performed as a soloist with orchestras across the country and has premiered and recorded works written for her.',
        shortDescription: 'Violinist who performs as a soloist and chamber musician.',
      },
    });
    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(false);
  });
});

describe('a biography that states no research beside a card that does', () => {
  const served = (fullDescription: string, shortDescription: string) =>
    buildResearchEntityPublicDescriptionRepresentation({
      entity: {
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        name: 'Robin Fixture Faculty Research',
        fullDescription,
        shortDescription,
      },
    });

  const CAREER_ONLY =
    'Robin Fixture has been a consultant to several documentary films, including an example series (2012). Robin Fixture has a Ph.D. from Example University and did an undergraduate degree at Another University. Robin Fixture has also taught at Third University and was a senior Fulbright Professor in 1992-93.';

  it('serves the card as the body', () => {
    const representation = served(
      CAREER_ONLY,
      "Robin Fixture's research focuses on how coastal towns adapt to repeated flooding, using archival records and household surveys.",
    );
    expect(representation.entity.fullDescription).toMatch(/adapt to repeated flooding/);
    expect(representation.entity.fullDescription).not.toMatch(/consultant|Fulbright|Ph\.D\./);
  });

  it('holds the row when the card is a citation rather than a research statement', () => {
    const representation = served(
      CAREER_ONLY,
      'Example Studies 78 Coastal Towns and the Politics of Flooding. 2020.',
    );
    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(true);
  });

  it('reads "<name> primary research area focuses on" as a research statement', () => {
    const representation = served(
      "Robin Fixture joined the faculty in 2012 after teaching at Example College. Robin Fixture's primary research area focuses on household finance and labor markets. Robin Fixture has published in Example Journal and Another Journal.",
      'Studies household finance and labor markets.',
    );
    expect(representation.entity.fullDescription).toContain('household finance and labor markets');
    expect(representation.entity.fullDescription).not.toMatch(
      /joined the faculty|has published in/,
    );
  });
});
