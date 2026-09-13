import { describe, expect, it } from 'vitest';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  servedBodyReadsAsResearchProse,
  titleCaseWordRatio,
} from '../researchEntityPublicDescription';

/**
 * The #2573 table names six served defect rows. The abridged text printed in the
 * issue is NOT what is stored: re-read from the pinned 2026-08-31 baseline, three
 * of the six carry a genuine research sentence AFTER the chrome, and the
 * abridgement had cut it off. So the shapes are reproduced synthetically here -
 * committing the real bodies would put named people's biographical data in a
 * fixture - and split by what the allowlist can and cannot do.
 *
 * REFUSED: the whole body is chrome, with no research predication anywhere.
 */
const CHROME_ONLY_CONTROLS: Array<{ label: string; text: string }> = [
  {
    label: 'curriculum-vitae position listing (o-hern-lab-co54 shape)',
    text: 'Assoc Prof Dept of Mechanical Engineering & Materials Science and Physics; Associate Professor of Mechanical Engineering & Materials Science and Physics, co-founder of the Integrated Graduate Program, and Director of the Program.',
  },
  {
    label: 'biography opener with clinical service history (caroline-taylor shape)',
    text: 'Biography This person has been a member of the faculty, and Chief of the Diagnostic Imaging Service from 1984. -2022. They continue to work clinically at the same site.',
  },
  {
    label: 'bare publication titles (sandra-abifadel shape)',
    text: 'EXAMPLE syndrome (Transient Perivascular Inflammation of the Example syndrome). New Gene Discovery with Whole Exome Sequencing in Pilomyxoid Astrocytoma in correlation with quantitative analysis.',
  },
];

/**
 * ACCEPTED, and this is the documented limit of a body-level allowlist (#2573).
 *
 * Each of these is a real served defect: chrome PREPENDED to good research prose.
 * The allowlist accepts them because research prose is genuinely present, so the
 * chrome reaches students in front of it. Refusing them is not the fix either -
 * that discards the real sentence. The fix is sentence-level chrome stripping,
 * which this change does not attempt.
 *
 * On Development this class is 266 of 2,617 served fulls, four times the 65 rows
 * this change moves. These assertions exist so the gap fails loudly the moment
 * someone believes it is closed.
 */
const CHROME_PREPENDED_TO_PROSE: Array<{ label: string; text: string }> = [
  {
    label: 'dated news item followed by a research sentence (fiss-omf2 shape)',
    text: 'February 19, 2024 Professor on the Importance of Voting In Why We Vote, the Sterling Professor Emeritus stresses the importance of voting and examines court cases that sought to enlarge the freedom that democracy generates.',
  },
  {
    label: 'degree list followed by a focus sentence (joyce-mercer shape)',
    text: 'B.A. Example UniversityM.Div. Example Divinity SchoolM.S.W Example Graduate School of Social WorkPh.D. Example University. This researcher\u2019s work focuses on practices of care in diverse contexts and situations, including trauma and moral injury.',
  },
  {
    label: 'administrative title enumeration followed by clinical interests (linda-maerz shape)',
    text: 'Associate Professor of Surgery & Anesthesiology (General Surgery, Trauma & Surgical Critical Care); Program Director for the Fellowships, Medical Director, Surgical Intensive Care Unit. Research interests include quality improvement in the surgical intensive care unit and clinical outcomes in sepsis.',
  },
];

const RESEARCH_PROSE: Array<{ label: string; text: string }> = [
  {
    label: 'lab prose with an explicit subject',
    text: 'The Comita Lab studies the population and community ecology of tropical forest plants.',
  },
  {
    label: 'lab prose with a focus phrase',
    text: 'The Erson Lab focuses on primary brain tumor genomics and precision medicine using multi-omics data.',
  },
  {
    label: 'subjectless verb-initial prose',
    text: 'Investigates high-dimensional biological data using neural networks, optimal transport, and manifold learning.',
  },
  {
    label: 'first-person plural method prose',
    text: 'We use single-molecule imaging to study how RNA polymerase transcribes DNA in living cells.',
  },
  {
    label: 'the derived Studies-topics card template',
    text: 'Studies Biophysics, Condensed Matter Physics, Soft Matter Research, and Biological Physics',
  },
];

const labEntity = (overrides: Record<string, any> = {}): Record<string, any> => ({
  name: 'Example Lab',
  entityType: 'LAB',
  kind: 'lab',
  websiteUrl: 'https://example-lab.yale.edu/',
  sourceUrls: ['https://example-lab.yale.edu/'],
  ...overrides,
});

describe('served-description allowlist (#2573)', () => {
  describe('chrome-only bodies are refused', () => {
    for (const control of CHROME_ONLY_CONTROLS) {
      it(`refuses ${control.label}`, () => {
        expect(servedBodyReadsAsResearchProse(control.text)).toBe(false);
      });
    }
  });

  describe('KNOWN LIMIT: chrome prepended to research prose is accepted', () => {
    for (const control of CHROME_PREPENDED_TO_PROSE) {
      it(`accepts ${control.label}, so the chrome still reaches students`, () => {
        expect(servedBodyReadsAsResearchProse(control.text)).toBe(true);
      });
    }

    it('records that a body-level allowlist cannot fix this class', () => {
      const refused = CHROME_PREPENDED_TO_PROSE.filter(
        (control) => !servedBodyReadsAsResearchProse(control.text),
      );
      expect(refused).toEqual([]);
    });
  });

  describe('research prose is still accepted, so the allowlist is not a blanket refusal', () => {
    for (const sample of RESEARCH_PROSE) {
      it(`accepts ${sample.label}`, () => {
        expect(servedBodyReadsAsResearchProse(sample.text)).toBe(true);
      });
    }
  });

  /**
   * Each text below is refused by exactly one structural guard and would
   * otherwise be accepted: prose-like casing, past the word floor, terminal
   * punctuation, and no research-focus phrase. Without these the guards are
   * unreachable on the control set and a later edit could delete them silently.
   */
  describe('each structural guard is individually reachable', () => {
    it('refuses a dated news item whose casing otherwise reads as prose', () => {
      const text =
        'February 19, 2024 the lab announced that its ongoing survey of coastal sediment will continue through the summer with departmental support.';
      expect(servedBodyReadsAsResearchProse(text)).toBe(false);
      expect(titleCaseWordRatio(text)).toBeLessThan(0.34);
    });

    it('refuses a section label pasted in as the body opener', () => {
      const text =
        'Education includes a doctorate earned at a midwestern university followed by postdoctoral training in cellular imaging at a coastal institute.';
      expect(servedBodyReadsAsResearchProse(text)).toBe(false);
      expect(titleCaseWordRatio(text)).toBeLessThan(0.34);
    });

    it('refuses a directory rank abbreviation even in an otherwise prose-shaped line', () => {
      const text =
        'Assoc Prof of molecular biophysics who teaches undergraduate seminars and advises doctoral candidates across the biological sciences division.';
      expect(servedBodyReadsAsResearchProse(text)).toBe(false);
      expect(titleCaseWordRatio(text)).toBeLessThan(0.34);
    });

    it('refuses a lower-cased degree list that clears the casing and length checks', () => {
      const text =
        'B.A. in history, M.Div. in theology, M.S.W. in social work, and a doctorate in practical theology earned at a southern university.';
      expect(servedBodyReadsAsResearchProse(text)).toBe(false);
      expect(titleCaseWordRatio(text)).toBeLessThan(0.34);
    });

    it('refuses a body with no terminal punctuation at all', () => {
      expect(
        servedBodyReadsAsResearchProse(
          'a fragment of copy that runs past the fifteen word floor but never actually closes any sentence anywhere',
        ),
      ).toBe(false);
    });

    it('refuses a body that is too short to be descriptive prose', () => {
      expect(servedBodyReadsAsResearchProse('Coastal sediment carbon.')).toBe(false);
    });
  });

  it('refuses blank and non-string input', () => {
    expect(servedBodyReadsAsResearchProse('')).toBe(false);
    expect(servedBodyReadsAsResearchProse('   ')).toBe(false);
    expect(servedBodyReadsAsResearchProse(null)).toBe(false);
    expect(servedBodyReadsAsResearchProse(undefined)).toBe(false);
  });

  describe('per-row resolution: full, then short, then withheld', () => {
    it('serves the full when the full reads as research prose', () => {
      const representation = buildResearchEntityPublicDescriptionRepresentation({
        entity: labEntity({
          fullDescription:
            'The Comita Lab studies the population and community ecology of tropical forest plants across Panama and Puerto Rico.',
          shortDescription: 'Studies Ecology, Tropical Forests, and Plant Population Biology',
        }),
      });
      expect(representation.bodySource).toBe('full');
      expect(representation.invariant.pass).toBe(true);
      expect(representation.fullDescription).toContain('community ecology');
    });

    it('falls back to the short when the full is a served defect text', () => {
      const representation = buildResearchEntityPublicDescriptionRepresentation({
        entity: labEntity({
          name: "O'Hern Lab",
          fullDescription: CHROME_ONLY_CONTROLS[0].text,
          shortDescription:
            'Studies Biophysics, Condensed Matter Physics, Soft Matter Research, and Biological Physics',
        }),
      });
      expect(representation.bodySource).toBe('short');
      expect(representation.fullDescription).toContain('Biophysics');
      expect(representation.fullDescription).not.toContain('Assoc Prof');
    });

    it('writes the fallback body onto the entity the DTO reads, not just the representation', () => {
      const representation = buildResearchEntityPublicDescriptionRepresentation({
        entity: labEntity({
          fullDescription: CHROME_ONLY_CONTROLS[2].text,
          shortDescription: 'Studies Vascular Biology, Genomics, and Rare Disease Genetics',
        }),
      });
      expect(representation.bodySource).toBe('short');
      expect(representation.entity.fullDescription).not.toContain('TIPIC syndrome');
      expect(representation.entity.fullDescription).toContain('Vascular Biology');
    });

    it('withholds the row when neither field reads as research prose', () => {
      const representation = buildResearchEntityPublicDescriptionRepresentation({
        entity: labEntity({
          fullDescription: CHROME_ONLY_CONTROLS[1].text,
          shortDescription: CHROME_ONLY_CONTROLS[2].text,
        }),
      });
      expect(representation.bodySource).toBe('none');
      expect(representation.invariant.pass).toBe(false);
      expect(representation.invariant.reasons).toContain('no_servable_research_prose');
    });

    it('withholds rather than serving an empty body when both fields are absent', () => {
      const representation = buildResearchEntityPublicDescriptionRepresentation({
        entity: labEntity({ fullDescription: '', shortDescription: '' }),
      });
      expect(representation.bodySource).toBe('none');
      expect(representation.invariant.pass).toBe(false);
    });

    it('never reports a passing row with an empty served body', () => {
      const rows = [
        labEntity({
          fullDescription:
            'The Erson Lab focuses on primary brain tumor genomics and precision medicine.',
          shortDescription: 'Studies Neuro-oncology, Genomics, and Precision Medicine',
        }),
        labEntity({
          fullDescription: CHROME_ONLY_CONTROLS[1].text,
          shortDescription: 'Studies Practical Theology, Pastoral Care, and Adolescent Development',
        }),
        labEntity({ fullDescription: CHROME_ONLY_CONTROLS[0].text, shortDescription: '' }),
      ];
      for (const entity of rows) {
        const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });
        if (representation.invariant.pass) {
          expect(representation.fullDescription.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  it('exempts program-like homes, whose copy describes an offer rather than a research focus', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: labEntity({
        name: 'Summer Undergraduate Research Fellowship',
        entityType: 'PROGRAM',
        kind: 'program',
        fullDescription:
          'This ten-week summer program places undergraduates with a faculty mentor and provides a stipend. Applications open in January and close in March.',
        shortDescription: 'A ten-week paid summer research placement for undergraduates',
      }),
    });
    expect(representation.bodySource).not.toBe('none');
  });
});
