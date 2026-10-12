import { describe, expect, it } from 'vitest';
import { formatTitleCaseLabel, formatTopicChipLabel } from '../displayText';

describe('formatTitleCaseLabel', () => {
  it('title-cases plain words', () => {
    expect(formatTitleCaseLabel('molecular biology')).toBe('Molecular Biology');
    expect(formatTitleCaseLabel('tumorigenesis')).toBe('Tumorigenesis');
    expect(formatTitleCaseLabel('Cancer Biology')).toBe('Cancer Biology');
  });

  it('preserves acronyms present in the source instead of mangling them', () => {
    expect(formatTitleCaseLabel('DNA repair')).toBe('DNA Repair');
    expect(formatTitleCaseLabel('DNA Double Strand Break (DSB)')).toBe(
      'DNA Double Strand Break (DSB)',
    );
    expect(formatTitleCaseLabel('EEG signal analysis')).toBe('EEG Signal Analysis');
    expect(formatTitleCaseLabel('PET imaging')).toBe('PET Imaging');
  });

  it('upper-cases known acronyms that arrive lower-cased', () => {
    expect(formatTitleCaseLabel('ai ethics')).toBe('AI Ethics');
    expect(formatTitleCaseLabel('crispr screening')).toBe('CRISPR Screening');
  });

  it('capitalizes after hyphen and slash boundaries', () => {
    expect(formatTitleCaseLabel('single-cell genomics')).toBe('Single-Cell Genomics');
    expect(formatTitleCaseLabel('in vivo/in vitro')).toBe('In Vivo/In Vitro');
  });

  it('preserves apostrophes within a word', () => {
    expect(formatTitleCaseLabel("parkinson's disease")).toBe("Parkinson's Disease");
  });

  it('down-cases screaming enum labels once they are lower-cased by the caller', () => {
    expect(formatTitleCaseLabel('core facility')).toBe('Core Facility');
    expect(formatTitleCaseLabel('lab')).toBe('Lab');
  });

  it('normalizes multi-word screaming-case inputs while keeping known acronyms', () => {
    expect(formatTitleCaseLabel('STEM CELL BIOLOGY')).toBe('Stem Cell Biology');
    expect(formatTitleCaseLabel('CANCER-BIOLOGY')).toBe('Cancer-Biology');
    expect(formatTitleCaseLabel('MOLECULAR/CELLULAR BIOLOGY')).toBe('Molecular/Cellular Biology');
  });

  it('collapses whitespace and trims', () => {
    expect(formatTitleCaseLabel('  cancer   biology  ')).toBe('Cancer Biology');
  });

  it('keeps short function words lower-case away from the opening position', () => {
    expect(formatTitleCaseLabel('work and gender')).toBe('Work and Gender');
    expect(formatTitleCaseLabel('Epigenetics and DNA Methylation')).toBe(
      'Epigenetics and DNA Methylation',
    );
    expect(formatTitleCaseLabel('Complement System in Diseases')).toBe(
      'Complement System in Diseases',
    );
    expect(formatTitleCaseLabel('economics of education')).toBe('Economics of Education');
    expect(formatTitleCaseLabel('bacterial interactions with mammalian hosts')).toBe(
      'Bacterial Interactions with Mammalian Hosts',
    );
  });

  it('capitalizes a function word that opens the label', () => {
    expect(formatTitleCaseLabel('the faboratory')).toBe('The Faboratory');
    expect(formatTitleCaseLabel('in vivo imaging')).toBe('In Vivo Imaging');
    expect(formatTitleCaseLabel('of mice and men')).toBe('Of Mice and Men');
  });

  it('treats a slash or bracket as the start of a new label', () => {
    expect(formatTitleCaseLabel('in vivo/in vitro')).toBe('In Vivo/In Vitro');
    expect(formatTitleCaseLabel('imaging/of tissue')).toBe('Imaging/Of Tissue');
  });

  it('keeps function words lower-case across a hyphen, which continues one label', () => {
    expect(formatTitleCaseLabel('state-of-the-art microscopy')).toBe('State-of-the-Art Microscopy');
  });

  it('keeps the closing word capitalised, because a trailing letter is a designator', () => {
    expect(formatTitleCaseLabel('Vascular Endothelial Growth Factor A')).toBe(
      'Vascular Endothelial Growth Factor A',
    );
    expect(formatTitleCaseLabel('hepatitis a')).toBe('Hepatitis A');
    expect(formatTitleCaseLabel('things to think about')).toBe('Things to Think About');
  });
});

describe('a dotted acronym keeps its capitals', () => {
  /**
   * `U.S.` used to render as `U.s.`: the acronym test allowed no dots, so the token fell
   * through to the lower-case-then-capitalise path. Found while un-inverting a heading that
   * ends in one, and it affected every label carrying a dotted acronym.
   */
  it.each(['U.S.', 'U.K.', 'N.I.H.'])('leaves %s alone', (acronym) => {
    expect(formatTitleCaseLabel(acronym)).toBe(acronym);
  });

  it('still title-cases an ordinary capitalised word', () => {
    expect(formatTitleCaseLabel('Immunology')).toBe('Immunology');
    expect(formatTitleCaseLabel('immunology')).toBe('Immunology');
  });
});

describe('formatTopicChipLabel', () => {
  /**
   * A controlled vocabulary stores a heading inverted so it files under its head noun.
   * That is right for an index and wrong for a chip a student reads as a phrase.
   * Every pair below was read on a rendered "Best fit for" section on Development.
   */
  it.each([
    ['Carcinoma, Renal Cell', 'Renal Cell Carcinoma'],
    ['Immunity, Innate', 'Innate Immunity'],
    ['Diabetes Mellitus, Type 1', 'Type 1 Diabetes Mellitus'],
    ['Endothelium, Vascular', 'Vascular Endothelium'],
    ['Microscopy, Fluorescence', 'Fluorescence Microscopy'],
    ['Decision Support Systems, Clinical', 'Clinical Decision Support Systems'],
    ['Anemia, Sickle Cell', 'Sickle Cell Anemia'],
    ['Kidney Failure, Chronic', 'Chronic Kidney Failure'],
  ])('un-inverts %s to %s', (stored, expected) => {
    expect(formatTopicChipLabel(stored)).toBe(expected);
  });

  /**
   * A conjunction means the comma separates co-ordinate parts, so the label is a composite
   * heading and swapping it scrambles it. These are the highest-volume comma-form chips in
   * the corpus, so getting this wrong would be the most visible possible regression.
   */
  it.each([
    'Biochemistry, Quantitative Biology, Biophysics & Structural Biology',
    'Molecular Medicine, Pharmacology & Physiology',
    'Health Care Quality, Access, and Evaluation',
    'Atomic, Molecular, and Optical Physics',
  ])('leaves the composite heading %s alone', (stored) => {
    expect(formatTopicChipLabel(stored)).toBe(stored);
  });

  /**
   * A conjunction inside the head is ordinary and does not stop the un-inversion, which was
   * measured rather than assumed: testing the whole label instead of the modifier left three
   * chips inverted on Development and all three read better un-inverted.
   */
  it.each([
    [
      'Centers for Disease Control and Prevention, U.S.',
      'U.S. Centers for Disease Control and Prevention',
    ],
    [
      'Chemical and Drug Induced Liver Injury, Chronic',
      'Chronic Chemical and Drug Induced Liver Injury',
    ],
  ])('un-inverts %s even though its head carries a conjunction', (stored, expected) => {
    expect(formatTopicChipLabel(stored)).toBe(expected);
  });

  /**
   * A conjunction in the MODIFIER is the real signal that the comma separates co-ordinate
   * parts, and this is the highest-volume label it protects.
   */
  it('leaves a heading whose modifier carries a conjunction', () => {
    expect(formatTopicChipLabel('Cell Biology, Genetics & Development')).toBe(
      'Cell Biology, Genetics & Development',
    );
  });

  it('leaves a heading whose modifier is a phrase rather than a subdivision', () => {
    expect(formatTopicChipLabel('Analytical Techniques, Diagnostic Imaging Equipment')).toBe(
      'Analytical Techniques, Diagnostic Imaging Equipment',
    );
  });

  it('leaves a comma inside parentheses alone, because it lists items in a gloss', () => {
    const label = formatTopicChipLabel('transcription factor evolution (Hoxa11, CEBP-B)');
    expect(label.toLowerCase()).toBe('transcription factor evolution (hoxa11, cebp-b)');
    expect(label.indexOf('(')).toBeLessThan(label.indexOf(')'));
  });

  it('still un-inverts a heading whose own parenthetical is balanced on one side', () => {
    expect(formatTopicChipLabel('Carcinoma (Renal), Clear Cell')).toBe(
      'Clear Cell Carcinoma (Renal)',
    );
  });

  it('leaves a lower-case comma phrase alone, because that is prose and not a heading', () => {
    expect(formatTopicChipLabel('Colonialism, slavery')).toBe('Colonialism, Slavery');
  });

  it('leaves a label with no comma to the ordinary title-case path', () => {
    expect(formatTopicChipLabel('machine learning')).toBe('Machine Learning');
  });

  /**
   * A vocabulary heading is stored with its subdivision capitalised, so an all-lower-case
   * label is prose that happens to contain a comma. Order is left alone there and only the
   * title-case pass applies, which is the conservative half of the rule: keeping a prose
   * phrase in its original order costs a reader nothing, while reordering one changes its
   * meaning.
   */
  it('leaves order alone when the modifier is not capitalised, and only title-cases', () => {
    expect(formatTopicChipLabel('carcinoma, renal cell')).toBe('Carcinoma, Renal Cell');
  });

  it('title-cases the un-inverted result, so the two rules compose', () => {
    expect(formatTopicChipLabel('immunity, Innate')).toBe('Innate Immunity');
  });
});
