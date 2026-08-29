import { describe, expect, it } from 'vitest';
import {
  isFaqDumpText,
  sanitizeCatalogDescription,
  stripInterrogativeSentences,
} from '../descriptionHygiene';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';

const HUMANITIES_PROSE_WITH_RESEARCH_QUESTIONS = [
  'The researcher specializes in the arts of a single nation and the history of photography.',
  'Their scholarship engages with the history of science, the environmental humanities, and visual culture.',
  'A current book project asks a set of connected questions about wartime imagery.',
  'How can death be imagined by a photograph without picturing a single body?',
  'What responsibility does a state have to its veterans?',
  'How is one community codified against the experience of another?',
  'What constitutes a war crime and can a photograph stand as evidence?',
  'The project draws on archival collections and on the practices of documentary photographers.',
  'It argues that the camera reshaped public memory of conflict across the nineteenth century.',
].join(' ');

const NEUROSCIENCE_PROSE_WITH_RESEARCH_QUESTIONS = [
  'Like learning, sleep changes the brain to improve its future performance.',
  'Unlike learning, these changes occur in the absence of overt behavior or sensory input.',
  'This offline learning thus contains a mystery: how does internally-generated activity improve function?',
  'What signals guide the process when no external input is available?',
  'Which network properties make such reorganization possible?',
  'And why should the process resemble learning at all?',
  'The group builds computational models to bridge cellular properties with behavioral implications.',
  'Recordings from freely behaving animals anchor those models in measured activity.',
  'The resulting framework predicts which sequences are replayed after training.',
].join(' ');

const MARKED_FAQ_PAGE = [
  'Apply Now FAQs',
  'Can I contact a faculty member before I apply?',
  'Yes, applicants are encouraged to reach out to potential mentors ahead of time.',
  'Does the placement pay a stipend?',
  'The programme provides a summer stipend to selected applicants.',
  'How many hours per week are expected?',
].join(' ');

const UNMARKED_QUESTION_ANSWER_RUN = [
  'Can I apply as a first-year student?',
  'Yes, first-year students may apply in the spring term.',
  'Is prior laboratory experience required?',
  'No prior experience is required for most placements.',
  'When are decisions released?',
  'Decisions are released in April.',
].join(' ');

describe('the FAQ arm keeps declarative research prose', () => {
  it('previously annihilated question-clustered humanities prose, now keeps its declaratives', () => {
    expect(isFaqDumpText(HUMANITIES_PROSE_WITH_RESEARCH_QUESTIONS)).toBe(true);
    const served = sanitizeCatalogDescription(HUMANITIES_PROSE_WITH_RESEARCH_QUESTIONS);
    expect(served).not.toBe('');
    expect(served).toContain('specializes in the arts of a single nation');
    expect(served).toContain('reshaped public memory of conflict');
    expect(served).not.toContain('?');
  });

  it('keeps declaratives for question-clustered science prose', () => {
    expect(isFaqDumpText(NEUROSCIENCE_PROSE_WITH_RESEARCH_QUESTIONS)).toBe(true);
    const served = sanitizeCatalogDescription(NEUROSCIENCE_PROSE_WITH_RESEARCH_QUESTIONS);
    expect(served).toContain('sleep changes the brain');
    expect(served).toContain('computational models');
  });

  it('still rejects an explicitly marked FAQ page outright', () => {
    expect(sanitizeCatalogDescription(MARKED_FAQ_PAGE)).toBe('');
  });

  it('still rejects a bare question-and-answer run, whose remainder is answers not a description', () => {
    expect(sanitizeCatalogDescription(UNMARKED_QUESTION_ANSWER_RUN)).toBe('');
  });

  it('rejects a chrome-prefixed question run whose declaratives do not outnumber its questions', () => {
    const questionSummary =
      'INFORMATION FOR How do neurons compute? How do circuits learn? How does memory form? This lab studies the neural basis of cognition.';
    expect(sanitizeCatalogDescription(questionSummary)).toBe('');
  });
});

describe('stripInterrogativeSentences', () => {
  it('is a no-op on text with no question mark', () => {
    const prose = 'The group studies protein folding. It uses cryo-electron microscopy.';
    expect(stripInterrogativeSentences(prose)).toBe(prose);
  });

  it('removes only the interrogative sentences', () => {
    expect(
      stripInterrogativeSentences('We study memory. How does replay work? Findings inform theory.'),
    ).toBe('We study memory. Findings inform theory.');
  });

  it('returns empty when every sentence is a question', () => {
    expect(stripInterrogativeSentences('What is this? Why does it matter?')).toBe('');
  });
});

// `sanitizeResearchEntityDescription` is shared read-time hygiene, and the
// browse and detail paths are known to diverge by construction (#2240, #2241),
// so the recovered prose has to be asserted on the BROWSE path as well as the
// detail DTO. A browse card must never come back empty or carrying chrome for a
// row this change newly serves.
describe('the browse card for newly served question-clustered prose', () => {
  const browseCard = (fullDescription: string) =>
    toPublicResearchEntityDto(
      {
        _id: '67d8928150621bcef434a1d9',
        slug: 'synthetic-question-clustered-lab',
        name: 'Synthetic Question Lab',
        entityType: 'LAB',
        kind: 'lab',
        fullDescription,
        shortDescription: '',
        studentVisibilityTier: 'student_ready',
      } as any,
      { forList: true } as any,
    )?.cardDescription;

  it.each([
    ['humanities prose', HUMANITIES_PROSE_WITH_RESEARCH_QUESTIONS],
    ['science prose', NEUROSCIENCE_PROSE_WITH_RESEARCH_QUESTIONS],
  ])('serves a non-empty, chrome-free browse card for %s', (_label, prose) => {
    const card = browseCard(prose);
    const text = String(card?.text || '');
    expect(text).not.toBe('');
    expect(text).not.toMatch(/copy link|information for|@|https?:\/\//i);
    expect(text).not.toContain('?');
  });

  it('falls back to the review placeholder for a marked FAQ page, leaking no Q&A copy', () => {
    const card = browseCard(MARKED_FAQ_PAGE);
    expect(card?.state).not.toBe('complete');
    const text = String(card?.text || '');
    expect(text).not.toContain('?');
    expect(text).not.toContain('stipend');
    expect(text).not.toContain('faculty member');
  });
});
