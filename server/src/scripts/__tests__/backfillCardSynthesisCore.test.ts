import { describe, expect, it, vi } from 'vitest';

import {
  planCardBackfillRow,
  summarizeCardBackfill,
  type CardBackfillRow,
} from '../backfillCardSynthesisCore';
import { deriveShortDescriptionFromFullDescription } from '../../utils/researchEntityDescriptionQuality';

const RICH_FIRST_PERSON_FULL =
  'Our lab is broadly interested in the biology of aging and the ways that metabolism shapes lifespan across species. Over the past decade we have built a range of experimental systems, from yeast to zebrafish, and we continue to expand these tools while training the next generation of scientists.';

const DERIVABLE_FULL =
  'The Rivera Lab studies how immune cells detect and respond to viral infection. Ongoing projects map the antiviral signaling pathways that shape the earliest stages of the response.';

const GROUNDED_CARD =
  'Studies the biology of aging and how metabolism shapes lifespan across species.';

const neverSynthesize = vi.fn(async () => 'Studies something the grounding check should reject.');

const LABEL_LIST_FULL =
  "Jordan Ellis's research interests include comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.";

const LABEL_LIST_SHORT =
  'Studies comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.';

const LABEL_LIST_AREAS = ['Political Science'];

describe('planCardBackfillRow', () => {
  it('keeps an entity that already has a usable card', async () => {
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000001',
        slug: 'aging-lab',
        shortDescription: GROUNDED_CARD,
        fullDescription: RICH_FIRST_PERSON_FULL,
      },
      neverSynthesize,
    );
    expect(row.action).toBe('short-ok');
    expect(row.gainedCard).toBe(false);
    expect(neverSynthesize).not.toHaveBeenCalled();
  });

  it('skips an entity whose full description is not genuine source prose', async () => {
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000002',
        fullDescription:
          'Welcome to the Smith Lab website. Thank you for your interest in our lab.',
      },
      neverSynthesize,
    );
    expect(row.action).toBe('not-genuine-full');
    expect(row.gainedCard).toBe(false);
  });

  it('uses the deterministic derivation when it produces a card', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      { id: '000000000000000000000003', fullDescription: DERIVABLE_FULL },
      synthesize,
    );
    expect(row.action).toBe('card-derived');
    expect(row.proposedShort).toBe(deriveShortDescriptionFromFullDescription(DERIVABLE_FULL));
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('synthesizes a grounded card when the derivation returns nothing', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000004',
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: ['missing_card_description'],
      },
      synthesize,
    );
    expect(synthesize).toHaveBeenCalledOnce();
    expect(row.action).toBe('card-synthesized');
    expect(row.proposedShort).toBe(GROUNDED_CARD);
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });

  it('counts a promotion when evidence reasons accompany the sole card blocker', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000007',
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: [
          'concrete_next_step',
          'missing_card_description',
          'source_backed_description',
        ],
      },
      synthesize,
    );
    expect(row.action).toBe('card-synthesized');
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });

  it('does not count a promotion when other blockers remain', async () => {
    const synthesize = vi.fn(async () => GROUNDED_CARD);
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000005',
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: ['missing_card_description', 'missing_lead'],
      },
      synthesize,
    );
    expect(row.action).toBe('card-synthesized');
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(false);
  });

  it('fails closed to no-card when synthesis is not confident', async () => {
    const synthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      { id: '000000000000000000000006', fullDescription: RICH_FIRST_PERSON_FULL },
      synthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
    expect(row.proposedShort).toBeNull();
  });

  it('derives a program card from its own terse description instead of rejecting it as not-genuine (#1425)', async () => {
    const programFull =
      'Yale Economics summer research opportunities that match undergraduate students with faculty research projects.';
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000008',
        entityType: 'PROGRAM',
        kind: 'program',
        fullDescription: programFull,
        visibilityReasons: ['missing_card_description'],
      },
      neverSynthesize,
    );
    expect(neverSynthesize).not.toHaveBeenCalled();
    expect(row.action).toBe('card-derived');
    expect(row.proposedShort).toBe(programFull);
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });
});

describe('planCardBackfillRow assesses the served card, not the stored one (#2671)', () => {
  // Shape drawn from a real Development row, with every name replaced: an appointment
  // and editorship block runs straight into genuine research prose with no separator.
  // The public-description sanitizer empties the whole body, so no card can rescue the
  // row, yet the stored short reads perfectly well on its own.
  const TITLES_RUN_INTO_PROSE =
    'Emeritus Professor of Surgery and of Cellular and Molecular Physiology Principal Investigator, Example Laboratory Editor-in-Chief, Journal of Example Science, Society for Example Surgery Dr. Rowan Tallis is a surgeon-scientist who harnesses the power of molecular biology to achieve a modern understanding of vascular disease, and then uses the basic science laboratory to ultimately benefit patients with vascular diseases. Dr. Tallis trained at three universities before an appointment to the faculty in 2001. Dr. Tallis focuses a clinical practice on teaching, and the laboratory studies the healing and function of blood vessels, fistulae and vessel patches used in patients having vascular surgery.';
  const STORED_SHORT_THAT_READS_WELL =
    'Studies the healing and function of blood vessels, fistulae and vessel patches that are used in patients having vascular surgery.';

  it('refuses short-ok when the served full description sanitizes away, because the gate would still hold the card', async () => {
    const synthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000f',
        entityType: 'LAB',
        shortDescription: STORED_SHORT_THAT_READS_WELL,
        fullDescription: TITLES_RUN_INTO_PROSE,
        visibilityReasons: ['missing_card_description'],
      },
      synthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
    expect(row.wouldPromote).toBe(false);
    expect(row.proposedShort).toBeNull();
  });

  it('still reports short-ok when the served representation keeps both halves', async () => {
    const synthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      {
        id: '000000000000000000000010',
        shortDescription: GROUNDED_CARD,
        fullDescription: RICH_FIRST_PERSON_FULL,
        visibilityReasons: ['missing_card_description'],
      },
      synthesize,
    );
    expect(row.action).toBe('short-ok');
    expect(synthesize).not.toHaveBeenCalled();
  });

  // The `leadMemberNames` pass-through is deliberately NOT asserted here. It is
  // load bearing: on Development, supplying the real roster lead names flips all 6
  // rows whose representation reads `complete` without them to `sparse`, which is the
  // entire difference between the planner's verdict and the gate's. Five attempts to
  // reproduce that flip on synthetic text failed, so any unit case written here would
  // pass whether or not the names are passed at all, and would give false assurance
  // rather than protection. Verified on real data instead; see #2671.
});

describe('planCardBackfillRow topic-label-list awareness (#1730/#1680)', () => {
  it('holds rather than fabricates when a stored bare label-list short would be rejected at serve time', async () => {
    const emptySynthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000a',
        slug: 'jordan-ellis',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: LABEL_LIST_SHORT,
        fullDescription: LABEL_LIST_FULL,
        researchAreas: LABEL_LIST_AREAS,
        visibilityReasons: ['missing_card_description'],
      },
      emptySynthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
  });

  it('still detects the label-list short via a kind-derived entityType fallback when entityType is unset (#1732 parity)', async () => {
    const emptySynthesize = vi.fn(async () => '');
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000b',
        slug: 'jordan-ellis-raw-set',
        kind: 'individual',
        shortDescription: LABEL_LIST_SHORT,
        fullDescription: LABEL_LIST_FULL,
        researchAreas: LABEL_LIST_AREAS,
        visibilityReasons: ['missing_card_description'],
      },
      emptySynthesize,
    );
    expect(row.action).toBe('no-card');
    expect(row.gainedCard).toBe(false);
  });

  it('promotes a genuinely different synthesized sentence instead of restating the stored label-list', async () => {
    const rewordedCard =
      'Examines comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.';
    const synthesize = vi.fn(async () => rewordedCard);
    const row = await planCardBackfillRow(
      {
        id: '00000000000000000000000c',
        slug: 'jordan-ellis-resynthesized',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: LABEL_LIST_SHORT,
        fullDescription: LABEL_LIST_FULL,
        researchAreas: LABEL_LIST_AREAS,
        visibilityReasons: ['missing_card_description'],
      },
      synthesize,
    );
    expect(row.action).toBe('card-synthesized');
    expect(row.proposedShort).toBe(rewordedCard);
    expect(row.gainedCard).toBe(true);
    expect(row.wouldPromote).toBe(true);
  });
});

describe('summarizeCardBackfill', () => {
  it('tallies actions, cards gained, and promotions', () => {
    const rows: CardBackfillRow[] = [
      {
        id: '1',
        action: 'card-synthesized',
        proposedShort: 'x',
        gainedCard: true,
        wouldPromote: true,
      },
      {
        id: '2',
        action: 'card-derived',
        proposedShort: 'y',
        gainedCard: true,
        wouldPromote: false,
      },
      { id: '3', action: 'no-card', proposedShort: null, gainedCard: false, wouldPromote: false },
      { id: '4', action: 'short-ok', proposedShort: null, gainedCard: false, wouldPromote: false },
    ];
    const summary = summarizeCardBackfill(rows);
    expect(summary.total).toBe(4);
    expect(summary.cardsGained).toBe(2);
    expect(summary.cardsSynthesized).toBe(1);
    expect(summary.cardsDerived).toBe(1);
    expect(summary.wouldPromote).toBe(1);
    expect(summary.actions['no-card']).toBe(1);
    expect(summary.actions['short-ok']).toBe(1);
  });
});

describe('planCardBackfillRow career-biography cards (#3098)', () => {
  // Career facts and no research subject, and it survives the serve sanitizers, which
  // is what makes it this class rather than #2915's withheld-card class. The synthetic
  // name is the repo's existing fixture name for exactly this shape.
  const CAREER_BIOGRAPHY_CARD =
    'Dr. Rowan Tallis trained at three universities before an appointment to the faculty in 2001.';
  // All 34 rows in this class pass fullDescription quality with zero flags, so the
  // material for a real card is already on the row.
  const DERIVABLE_RESEARCH_BODY =
    'The laboratory studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex to identify the clearance pathways that fail earliest in tauopathy.';
  // 24 of the 34 are this shape: genuine research prose the deterministic derivation
  // has no pattern to compress, which is why the LLM arm is the only one that reaches
  // them.
  const UNDERIVABLE_RESEARCH_BODY =
    'Questions about measurement and questions about mechanism have driven the group for fifteen years, and the instrumentation built to answer the first has repeatedly reshaped what could be asked of the second, so the two threads are now inseparable in the work the group does.';
  const SYNTHESIZED_CARD =
    'Studies questions about measurement and mechanism, building instrumentation that reshapes what can be asked of the biology.';
  // A synthesized biography that is GROUNDED in the body, so it clears
  // shortDescriptionQuality and survives the serve sanitizers as a complete card.
  // That is the only shape the output refusal is load-bearing for: an ungrounded or
  // sanitizer-blanked biography is already refused by `servedCardIsComplete`.
  const SYNTHESIZED_BIOGRAPHY =
    'Dr. Rowan Tallis trained at three universities in measurement and mechanism before joining the group.';

  const biographyRow = (fullDescription: string, researchAreas?: string[]) => ({
    id: '000000000000000000000031',
    slug: 'example-neurology-profile',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    shortDescription: CAREER_BIOGRAPHY_CARD,
    fullDescription,
    ...(researchAreas ? { researchAreas } : {}),
  });

  it('no longer calls a served career-biography card short-ok', async () => {
    const synthesize = vi.fn(async () => SYNTHESIZED_CARD);

    const row = await planCardBackfillRow(biographyRow(DERIVABLE_RESEARCH_BODY), synthesize);

    expect(row.gainedCard).toBe(true);
    expect(row.proposedShort).not.toBe(CAREER_BIOGRAPHY_CARD);
  });

  it('refuses the body derivation on a row that already has a card', async () => {
    const derived = deriveShortDescriptionFromFullDescription(DERIVABLE_RESEARCH_BODY);
    const synthesize = vi.fn(async () => SYNTHESIZED_CARD);

    const row = await planCardBackfillRow(biographyRow(DERIVABLE_RESEARCH_BODY), synthesize);

    expect(derived).toBeTruthy();
    expect(row.proposedShort).not.toBe(derived);
    expect(row.action).toBe('card-synthesized');
  });

  it('leaves a card that states a research focus alone even when a role noun makes it read as a career fact', async () => {
    const synthesize = vi.fn(async () => SYNTHESIZED_CARD);
    // The role noun is a career fact, so isCareerBiographyDescription fires, but the
    // sentence states the research and a student is well served by it.
    const roleFramedResearchCard =
      'Dr. Rowan Tallis is a medical oncologist whose research focuses on gastrointestinal cancers and biomarker-driven therapy selection.';

    const row = await planCardBackfillRow(
      { ...biographyRow(DERIVABLE_RESEARCH_BODY), shortDescription: roleFramedResearchCard },
      synthesize,
    );

    expect(row.action).toBe('short-ok');
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('reaches the LLM arm on a body the derivation cannot compress', async () => {
    const synthesize = vi.fn(async () => SYNTHESIZED_CARD);

    const row = await planCardBackfillRow(biographyRow(UNDERIVABLE_RESEARCH_BODY), synthesize);

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(row.action).toBe('card-synthesized');
    expect(row.proposedShort).toBe(SYNTHESIZED_CARD);
  });

  it('keeps the stored card rather than trading one biography for another', async () => {
    const synthesize = vi.fn(async () => SYNTHESIZED_BIOGRAPHY);

    const row = await planCardBackfillRow(
      biographyRow(UNDERIVABLE_RESEARCH_BODY, ['Neurodegeneration', 'Imaging']),
      synthesize,
    );

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(row.action).toBe('no-card');
    expect(row.proposedShort).toBeNull();
    expect(row.gainedCard).toBe(false);
  });

  it('still calls a research-focus card short-ok and never calls the synthesizer', async () => {
    const synthesize = vi.fn(async () => SYNTHESIZED_CARD);

    const row = await planCardBackfillRow(
      {
        ...biographyRow(DERIVABLE_RESEARCH_BODY),
        shortDescription:
          'Studies how microglia clear protein aggregates in the ageing brain and which clearance pathways fail earliest in tauopathy.',
      },
      synthesize,
    );

    expect(row.action).toBe('short-ok');
    expect(synthesize).not.toHaveBeenCalled();
  });
});
