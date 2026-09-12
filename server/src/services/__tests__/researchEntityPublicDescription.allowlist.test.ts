import { describe, expect, it } from 'vitest';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  servedBodyReadsAsResearchProse,
  titleCaseWordRatio,
} from '../researchEntityPublicDescription';

/**
 * The six texts from the #2573 table, copied from the issue as the positive
 * controls the allowlist must refuse. They are abridged in the issue itself, so
 * these are the abridged forms rather than the full served bodies.
 */
const SERVED_DEFECT_CONTROLS: Array<{ slug: string; text: string; shape: string }> = [
  {
    slug: 'o-hern-lab-co54',
    shape: 'curriculum-vitae position listing',
    text: "Assoc Prof Dept of Mechanical Engineering & Materials Science and Physics; Associate Professor Prof. O'Hern is a Professor of Mechanical Engineering & Materials Science and Physics.",
  },
  {
    slug: 'fiss-omf2',
    shape: 'dated news ticker item',
    text: 'February 19, 2024 Professor Owen M. Fiss on the Importance of Voting In Why We Vote, Professor Fiss discusses the role of the courts.',
  },
  {
    slug: 'dept-divinity-joyce-mercer',
    shape: 'degree list boilerplate',
    text: 'B.A. University of VirginiaM.Div. Yale Divinity SchoolM.S.W University of ConnecticutPh.D. Emory University',
  },
  {
    slug: 'ysm-faculty-caroline-taylor',
    shape: 'biography opener',
    text: 'Biography Caroline Taylor has been a member of the Yale faculty since 1984. -2022.',
  },
  {
    slug: 'ysm-faculty-sandra-abifadel',
    shape: 'publications list dump',
    text: 'TIPIC syndrome (TransIent Perivascular Inflammation of the Carotid syndrome). New Gene Discovery with Whole Exome Sequencing in a Family with Cerebral Cavernous Malformations.',
  },
  {
    slug: 'ysm-faculty-linda-maerz',
    shape: 'administrative title enumeration',
    text: 'Associate Professor of Surgery & Anesthesiology (Critical Care); Program Director for the Surgical Critical Care Fellowship.',
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
  describe('positive controls: every verbatim served defect text is refused', () => {
    for (const control of SERVED_DEFECT_CONTROLS) {
      it(`refuses ${control.slug} (${control.shape})`, () => {
        expect(servedBodyReadsAsResearchProse(control.text)).toBe(false);
      });
    }

    it('refuses all six as a body, so none can be served as the detail body', () => {
      const accepted = SERVED_DEFECT_CONTROLS.filter((control) =>
        servedBodyReadsAsResearchProse(control.text),
      );
      expect(accepted.map((control) => control.slug)).toEqual([]);
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
          fullDescription: SERVED_DEFECT_CONTROLS[0].text,
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
          fullDescription: SERVED_DEFECT_CONTROLS[4].text,
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
          fullDescription: SERVED_DEFECT_CONTROLS[1].text,
          shortDescription: SERVED_DEFECT_CONTROLS[5].text,
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
          fullDescription: SERVED_DEFECT_CONTROLS[3].text,
          shortDescription: 'Studies Practical Theology, Pastoral Care, and Adolescent Development',
        }),
        labEntity({ fullDescription: SERVED_DEFECT_CONTROLS[2].text, shortDescription: '' }),
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
