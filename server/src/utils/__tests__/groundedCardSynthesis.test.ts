import { describe, expect, it, vi } from 'vitest';

import {
  cardGroundingScore,
  isCardGroundedInFullDescription,
  isUngroundedSynthesizedCard,
  normalizeCardText,
  resolveGroundedCardDescription,
  resolveServedShortDescription,
  synthesizeGroundedCardDescription,
} from '../groundedCardSynthesis';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const RICH_FIRST_PERSON_FULL =
  'Our lab is broadly interested in the biology of aging and the ways that metabolism shapes lifespan across species. Over the past decade we have built a range of experimental systems, from yeast to zebrafish, and we continue to expand these tools while training the next generation of scientists.';

const DERIVABLE_FULL =
  'The Rivera Lab studies how immune cells detect and respond to viral infection. Ongoing projects map the antiviral signaling pathways that shape the earliest stages of the response.';

describe('grounding', () => {
  it('grounds a card whose content words all appear in the full description', () => {
    const card = 'Studies the biology of aging and how metabolism shapes lifespan across species.';
    expect(isCardGroundedInFullDescription(card, RICH_FIRST_PERSON_FULL)).toBe(true);
    expect(cardGroundingScore(card, RICH_FIRST_PERSON_FULL)).toBe(1);
  });

  it('rejects a card that introduces content absent from the full description', () => {
    const hallucinated = 'Studies quantum gravity near black hole thermodynamics.';
    expect(isCardGroundedInFullDescription(hallucinated, RICH_FIRST_PERSON_FULL)).toBe(false);
  });

  it('treats a verbatim slice of the full description as grounded', () => {
    expect(isCardGroundedInFullDescription('the biology of aging', RICH_FIRST_PERSON_FULL)).toBe(
      true,
    );
  });
});

describe('isUngroundedSynthesizedCard', () => {
  const MOROCCO_FULL =
    'Studies the making of the modern Moroccan state, colonial state formation across North Africa, and the social history of empire in the Maghreb.';
  const ITALIAN_PEDAGOGY_FULL =
    'Focuses on Italian language pedagogy, literary translation, and medieval and Renaissance literature, with attention to how these texts are taught.';

  it('drops a synthesized card whose topic is absent from the full description (#1212 Wyrtzen)', () => {
    expect(isUngroundedSynthesizedCard('Studies Texas from the first.', MOROCCO_FULL)).toBe(true);
  });

  it('drops a synthesized card whose topic only partially grounds (#1212 Farina)', () => {
    expect(isUngroundedSynthesizedCard('Studies Italian Cooking.', ITALIAN_PEDAGOGY_FULL)).toBe(
      true,
    );
  });

  it('keeps a synthesized card whose topics are all grounded in the full description', () => {
    expect(
      isUngroundedSynthesizedCard(
        'Studies colonial state formation across North Africa.',
        MOROCCO_FULL,
      ),
    ).toBe(false);
  });

  it('never touches a source-derived blurb that does not lead with a synthesis verb', () => {
    expect(
      isUngroundedSynthesizedCard('The lab in Austin explores rodeo culture.', MOROCCO_FULL),
    ).toBe(false);
  });

  it('keeps a synthesized card when there is no full description to verify against', () => {
    expect(isUngroundedSynthesizedCard('Studies Texas from the first.', '')).toBe(false);
  });

  it('keeps a synthesized card whose topic is too short to verify', () => {
    expect(isUngroundedSynthesizedCard('Studies AI.', MOROCCO_FULL)).toBe(false);
  });
});

describe('normalizeCardText', () => {
  it('strips wrapping quotes, keeps one sentence, and adds a terminal period', () => {
    expect(normalizeCardText('"Studies antiviral signaling in immune cells"')).toBe(
      'Studies antiviral signaling in immune cells.',
    );
  });

  it('reduces multi-sentence output to its first sentence', () => {
    expect(normalizeCardText('Studies antiviral signaling. It also trains students.')).toBe(
      'Studies antiviral signaling.',
    );
  });

  it('returns empty for empty input', () => {
    expect(normalizeCardText('   ')).toBe('');
    expect(normalizeCardText(null)).toBe('');
  });
});

describe('synthesizeGroundedCardDescription', () => {
  it('returns a grounded, quality-passing card from rich prose the regex funnel cannot card', async () => {
    expect(deriveShortDescriptionFromFullDescription(RICH_FIRST_PERSON_FULL)).toBe('');

    const callLLM = vi
      .fn()
      .mockResolvedValue(
        'Studies the biology of aging and how metabolism shapes lifespan across species.',
      );
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });

    expect(callLLM).toHaveBeenCalledOnce();
    expect(card).toBe(
      'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
    expect(shortDescriptionQuality(card, RICH_FIRST_PERSON_FULL).isUseful).toBe(true);
  });

  it('fails closed when the model hallucinates content not in the source', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValue('Studies quantum gravity near black hole thermodynamics.');
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });
    expect(card).toBe('');
  });

  it('fails closed when the model output does not pass the card quality bar', async () => {
    const callLLM = vi.fn().mockResolvedValue('We study aging.');
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });
    expect(card).toBe('');
  });

  it('never calls the model for a full description that is not source-useful', async () => {
    const callLLM = vi.fn().mockResolvedValue('Studies something.');
    const card = await synthesizeGroundedCardDescription({
      fullDescription: 'Welcome to the Smith Lab website. Thank you for your interest in our lab.',
      callLLM,
    });
    expect(callLLM).not.toHaveBeenCalled();
    expect(card).toBe('');
  });

  it('fails closed when the model call throws', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('network'));
    const card = await synthesizeGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      callLLM,
    });
    expect(card).toBe('');
  });

  it('rejects a model card shaped as a bare researchArea label list when entityType is threaded (#1730/#1680)', async () => {
    const labelListFull =
      "Jordan Ellis's research interests include comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.";
    const callLLM = vi
      .fn()
      .mockResolvedValue(
        'Studies comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.',
      );
    const card = await synthesizeGroundedCardDescription({
      fullDescription: labelListFull,
      researchAreas: ['Political Science'],
      entityType: 'FACULTY_RESEARCH_AREA',
      callLLM,
    });
    expect(callLLM).toHaveBeenCalledOnce();
    expect(card).toBe('');
  });
});

describe('resolveGroundedCardDescription', () => {
  it('keeps the deterministic derivation and never synthesizes when the derivation already cards', async () => {
    const derived = deriveShortDescriptionFromFullDescription(DERIVABLE_FULL);
    expect(derived).not.toBe('');

    const synthesize = vi.fn(async () => 'Studies something else entirely.');
    const resolved = await resolveGroundedCardDescription({
      fullDescription: DERIVABLE_FULL,
      synthesize,
    });

    expect(synthesize).not.toHaveBeenCalled();
    expect(resolved).toBe(derived);
  });

  it('falls back to grounded synthesis only when the derivation returns nothing', async () => {
    expect(deriveShortDescriptionFromFullDescription(RICH_FIRST_PERSON_FULL)).toBe('');

    const synthesize = vi.fn(
      async () => 'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
    const resolved = await resolveGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
      synthesize,
    });

    expect(synthesize).toHaveBeenCalledOnce();
    expect(resolved).toBe(
      'Studies the biology of aging and how metabolism shapes lifespan across species.',
    );
  });

  it('returns the empty derivation when no synthesizer is provided', async () => {
    const resolved = await resolveGroundedCardDescription({
      fullDescription: RICH_FIRST_PERSON_FULL,
    });
    expect(resolved).toBe('');
  });
});

describe('resolveGroundedCardDescription topic-label-list awareness (#1730/#1680)', () => {
  const LABEL_LIST_FULL =
    "Jordan Ellis's research interests include comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.";
  const LABEL_LIST_AREAS = ['Political Science'];
  const LABEL_LIST_STUDIES_TEXT =
    'Studies comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.';

  it('does not settle for the deterministic derivation when it is itself a bare label-list restatement, and tries synthesis instead', async () => {
    expect(
      shortDescriptionQuality(
        deriveShortDescriptionFromFullDescription(LABEL_LIST_FULL),
        LABEL_LIST_FULL,
        LABEL_LIST_AREAS,
        { entityType: 'FACULTY_RESEARCH_AREA' },
      ).isUseful,
    ).toBe(false);

    const synthesize = vi.fn(async () => LABEL_LIST_STUDIES_TEXT);
    await resolveGroundedCardDescription({
      fullDescription: LABEL_LIST_FULL,
      researchAreas: LABEL_LIST_AREAS,
      entityType: 'FACULTY_RESEARCH_AREA',
      synthesize,
    });
    expect(synthesize).toHaveBeenCalledOnce();
  });

  it('rejects a synthesized candidate that only restates the researchArea chips as a "Studies" list', async () => {
    const synthesize = vi.fn(async () => LABEL_LIST_STUDIES_TEXT);
    const resolved = await resolveGroundedCardDescription({
      fullDescription: LABEL_LIST_FULL,
      researchAreas: LABEL_LIST_AREAS,
      entityType: 'FACULTY_RESEARCH_AREA',
      synthesize,
    });
    expect(resolved).not.toBe(LABEL_LIST_STUDIES_TEXT);
  });

  it('accepts a synthesized candidate that is not shaped like the bare label-list template', async () => {
    const rewordedCard =
      'Examines comparative constitutional law, transnational legal governance, the history of federalist theory, judicial independence, and political risk analysis.';
    const synthesize = vi.fn(async () => rewordedCard);
    const resolved = await resolveGroundedCardDescription({
      fullDescription: LABEL_LIST_FULL,
      researchAreas: LABEL_LIST_AREAS,
      entityType: 'FACULTY_RESEARCH_AREA',
      synthesize,
    });
    expect(resolved).toBe(rewordedCard);
  });
});

describe('resolveServedShortDescription entityType-aware fallback (#1616)', () => {
  it('falls through past a re-derived affiliation-list first sentence for a FACULTY_RESEARCH_AREA entity', () => {
    const full =
      "Alicia Schmidt Camacho is a Professor of Ethnicity, Race, and Migration, and holds affiliations with the Yale Center for the Study of Race, Indigeneity, and Transnational Migration, the Council of Latin American and Iberian Studies, and the American Studies and Women's, Gender, and Sexuality Programs. Her scholarship examines migration, social movements, and cultural politics in North America.";
    const resolved = resolveServedShortDescription({
      shortDescription: '',
      fullDescription: full,
      researchAreas: [],
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(resolved).toBe('');
  });

  it('rejects the same affiliation-list run-on even with no entityType passed (#1533: fixed at the root)', () => {
    // #1616's entityType-aware guard used to be the only thing standing
    // between this affiliation list and being served as a short - omitting
    // entityType fell back to the un-derived "Studies Race, Indigeneity, and
    // Transnational Migration, the Council of..." run-on. #1533's reopen
    // fixed deriveShortDescriptionFromFullDescription's underlying
    // studyOfMatch/combinedStudyOfMatch extractors to reject a capture that
    // swallows an entire clause instead of naming a compact noun phrase, so
    // the defect is now impossible at the root regardless of entityType -
    // this now matches the entityType-aware test above rather than diverging
    // from it. The chosen research-focus sentence still fails self-contained
    // (the department names "American Studies"/"Iberian Studies" trip the
    // bare "studies" verb match on sentence one, so no later sentence is
    // reached), so this fails closed to '' rather than serving anything.
    const full =
      "Alicia Schmidt Camacho is a Professor of Ethnicity, Race, and Migration, and holds affiliations with the Yale Center for the Study of Race, Indigeneity, and Transnational Migration, the Council of Latin American and Iberian Studies, and the American Studies and Women's, Gender, and Sexuality Programs. Her scholarship examines migration, social movements, and cultural politics in North America.";
    const resolved = resolveServedShortDescription({
      shortDescription: '',
      fullDescription: full,
      researchAreas: [],
    });
    expect(resolved).toBe('');
  });
});

describe('resolveServedShortDescription bare researchArea-chip-echo residual (#1680)', () => {
  const richDistinctFull =
    'Stephen Darwall is the Andrew Downey Orrick Professor of Philosophy at Yale University and the John Dewey Distinguished University Professor Emeritus at the University of Michigan. He has taught in the Department of Philosophy at Yale University. His research interests include moral philosophy, particularly in the areas of second-fixtureal ethics, moral reasoning, and the relationship between morality and authority.';

  it('replaces a shortDescription that only restates the researchArea chips with a full-derived one-liner', () => {
    const resolved = resolveServedShortDescription({
      shortDescription: 'Studies Moral Philosophy, Second-Fixtureal Ethics, and Moral Reasoning.',
      fullDescription: richDistinctFull,
      researchAreas: ['Moral Philosophy', 'Second-Fixtureal Ethics', 'Moral Reasoning'],
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(resolved).toBe(deriveShortDescriptionFromFullDescription(richDistinctFull));
    expect(resolved).not.toBe(
      'Studies Moral Philosophy, Second-Fixtureal Ethics, and Moral Reasoning.',
    );
  });

  it("keeps a fluent list-shaped short whose items are not literally the entity's researchAreas", () => {
    const full =
      'Ray C. Fair is the John M. Musser Professor of Economics at Yale University. His main research is in macroeconometrics, but he has also done work in the areas of finance, voting behavior, and aging in sports.';
    const short =
      'Studies econometrics, financial economics, international finance, and international trade.';
    const resolved = resolveServedShortDescription({
      shortDescription: short,
      fullDescription: full,
      researchAreas: ['Macroeconometrics'],
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(resolved).toBe(short);
  });

  it('keeps a chip-echo short when there is no richer full to compress instead', () => {
    const short = 'Studies Moral Philosophy, Second-Fixtureal Ethics, and Moral Reasoning.';
    const resolved = resolveServedShortDescription({
      shortDescription: short,
      fullDescription: 'A short bio.',
      researchAreas: ['Moral Philosophy', 'Second-Fixtureal Ethics', 'Moral Reasoning'],
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(resolved).toBe(short);
  });
});

describe('resolveServedShortDescription personal-title/name opener (#1886)', () => {
  it('re-derives from the grounded full when the short is a title+name bio opener', () => {
    const full =
      "Edward Cooke's research focuses on American material culture and decorative arts, exploring the social lives of objects.";
    const resolved = resolveServedShortDescription({
      shortDescription:
        'Professor Edward S. Cooke, Jr. Focuses on American material culture and decorative arts, with significant contributions to the understanding of craftsman-client relations.',
      fullDescription: full,
      researchAreas: ['American Material Culture', 'Decorative Arts'],
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(resolved).toBe(deriveShortDescriptionFromFullDescription(full));
    expect(resolved).not.toMatch(/^Professor\b/);
  });
});

describe('resolveServedShortDescription stored truncation fragment (#2184)', () => {
  const full =
    'The lab maps how salt-marsh sediments lock away atmospheric carbon along the Atlantic coast. Field campaigns each summer pair monitoring transects with laboratory incubations that measure decomposition under warmer, saltier conditions.';

  it.each([
    ['unicode ellipsis', '…'],
    ['dotted ellipsis', '...'],
  ])('re-derives from the grounded full when the stored short ends in an %s', (_label, tail) => {
    const resolved = resolveServedShortDescription({
      shortDescription: `The lab maps how salt-marsh sediments lock away atmospheric carbon along the Atlantic coast and how those${tail}`,
      fullDescription: full,
      researchAreas: ['Coastal ecology'],
      entityType: 'LAB',
    });
    expect(resolved).toBe(deriveShortDescriptionFromFullDescription(full));
    expect(resolved).not.toMatch(/(?:\.{3}|…)$/);
  });
});

describe('resolveGroundedCardDescription program path (#1425)', () => {
  const PROGRAM_FULL =
    'Yale Economics summer research opportunities that match undergraduate students with faculty research projects.';

  it('derives a program card from its own description without calling the lab-verb synthesizer', async () => {
    const synthesize = vi.fn(async () => 'Studies something else entirely.');
    const resolved = await resolveGroundedCardDescription({
      fullDescription: PROGRAM_FULL,
      isProgramLike: true,
      synthesize,
    });

    expect(synthesize).not.toHaveBeenCalled();
    expect(resolved).toBe(PROGRAM_FULL);
  });

  it('does not take the program-derive shortcut for a non-program entity', async () => {
    expect(deriveShortDescriptionFromFullDescription(PROGRAM_FULL)).toBe('');
    const resolved = await resolveGroundedCardDescription({
      fullDescription: PROGRAM_FULL,
    });
    expect(resolved).toBe('');
  });
});

const UNGROUNDABLE_FULL = 'Welcome to the lab website. Thank you for your interest in our group.';

describe('resolveGroundedCardDescription research-areas fallback (#952)', () => {
  it('falls back to a research-areas card when prose yields no groundable summary', async () => {
    expect(deriveShortDescriptionFromFullDescription(UNGROUNDABLE_FULL)).toBe('');
    const resolved = await resolveGroundedCardDescription({
      fullDescription: UNGROUNDABLE_FULL,
      researchAreas: ['Biostatistics', 'Public Health', 'Cancer Research', 'Clinical Trials'],
    });
    expect(resolved).toBe(
      'Studies Biostatistics, Public Health, Cancer Research, and Clinical Trials.',
    );
  });

  it('fails closed to empty rather than fabricating when no clean research areas exist', async () => {
    const resolved = await resolveGroundedCardDescription({
      fullDescription: UNGROUNDABLE_FULL,
      researchAreas: [],
    });
    expect(resolved).toBe('');
  });
});

describe('resolveGroundedCardDescription rejects researcher-voice "Studies" on program-like entities (#1555)', () => {
  const NO_CARDABLE_SENTENCE_FULL = 'No description available yet.';

  it('fails closed instead of the research-areas "Studies" fallback for a program-like entity', async () => {
    const resolved = await resolveGroundedCardDescription({
      fullDescription: NO_CARDABLE_SENTENCE_FULL,
      researchAreas: ['Biostatistics', 'Public Health', 'Cancer Research', 'Clinical Trials'],
      isProgramLike: true,
    });
    expect(resolved).toBe('');
  });

  it('never invokes the LLM synthesizer for a program-like entity and fails closed', async () => {
    const synthesize = vi.fn(
      async () => 'Studies Slavery, Resistance, and Abolition at the Whitney.',
    );
    const resolved = await resolveGroundedCardDescription({
      fullDescription: 'Gilder Lehrman fellowship.',
      isProgramLike: true,
      synthesize,
    });
    expect(synthesize).not.toHaveBeenCalled();
    expect(resolved).toBe('');
  });

  it('still allows a "Studies" lead for a non-program (lab/faculty) entity', async () => {
    const resolved = await resolveGroundedCardDescription({
      fullDescription: UNGROUNDABLE_FULL,
      researchAreas: ['Biostatistics', 'Public Health', 'Cancer Research', 'Clinical Trials'],
      isProgramLike: false,
    });
    expect(resolved).toBe(
      'Studies Biostatistics, Public Health, Cancer Research, and Clinical Trials.',
    );
  });
});
