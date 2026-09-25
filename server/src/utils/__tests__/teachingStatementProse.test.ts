import { describe, it, expect } from 'vitest';
import {
  fullDescriptionQuality,
  isTeachingOrAdvisingStatementProse,
  standaloneCardQuality,
} from '../researchEntityDescriptionQuality';

const COURSE_INVENTORY =
  'Over the past decade, I have taught courses at two land-grant universities. I taught a junior and senior level course in the vegetation ecology of the western US. This course included a lab that focused on identifying the important plant species in each vegetation type. I also co-taught a doctoral level course in the ecology of grasslands and shrublands that combined the global distribution of ecosystems with key ecosystem processes.';

const COURSE_CARD_LINE =
  'This course included a lab that focused on identifying the important plant species in each of the vegetation types.';

describe('isTeachingOrAdvisingStatementProse', () => {
  it('reaches a past-tense first-person course inventory, which the present-tense predicate cannot see', () => {
    expect(isTeachingOrAdvisingStatementProse(COURSE_INVENTORY)).toBe(true);
  });

  it('reaches a labelled statement heading', () => {
    expect(
      isTeachingOrAdvisingStatementProse(
        'Teaching Philosophy My goal in every classroom is to make students responsible for their own learning, whether they are first-year undergraduates or doctoral candidates.',
      ),
    ).toBe(true);
    expect(
      isTeachingOrAdvisingStatementProse(
        'My teaching statement rests on one idea: students learn a method by using it, so every seminar I run ends with the students presenting their own analysis.',
      ),
    ).toBe(true);
  });

  it('reaches a stated advising role', () => {
    expect(
      isTeachingOrAdvisingStatementProse(
        'My approach to mentoring graduate students differs between masters of science students and doctoral students. My role in a master’s programme is one of providing a carefully guided tour through the scientific process.',
      ),
    ).toBe(true);
  });

  it('reaches a single course sentence, which is the card shape an extractor returns beside the body', () => {
    expect(isTeachingOrAdvisingStatementProse(COURSE_CARD_LINE)).toBe(true);
  });

  it('does not fire on research prose that also states what its author teaches', () => {
    expect(
      isTeachingOrAdvisingStatementProse(
        'My research examines how firms respond to trade liberalisation. I also teach the core graduate course in international economics and a seminar on emerging markets.',
      ),
    ).toBe(false);
  });

  it('does not fire on a research description whose research claim names a classroom among its topics', () => {
    // The claim sentence mentions a course noun, so treating any course noun as
    // instruction withdrew the exemption from the one sentence that proves this
    // is a research description.
    expect(
      isTeachingOrAdvisingStatementProse(
        'Dr. Barber teaches courses in conducting and choral pedagogy, and previously taught courses in choral methods at another university. Dr. Barber’s research interests include effective teaching strategies, fostering classroom diversity, and the linguistic performance practice of African American spirituals.',
      ),
    ).toBe(false);
  });

  it('does not fire on a research description whose only topical overlap is a course title', () => {
    // A course names a research field, so a topical test cannot separate the two
    // shapes. This passage has no instruction predicate and no course subject.
    expect(
      isTeachingOrAdvisingStatementProse(
        'The Marlowe Lab studies how coastal wetlands store carbon and how tidal cycles reshape sediment chemistry, combining field sampling with numerical models.',
      ),
    ).toBe(false);
  });

  it('does not fire on an undergraduate research programme description', () => {
    expect(
      isTeachingOrAdvisingStatementProse(
        'The programme supports undergraduates conducting research each summer, offering research assistantships across eight departments and a weekly seminar.',
      ),
    ).toBe(false);
  });

  it('fails the body bar and the card bar, so neither surface can serve it', () => {
    expect(fullDescriptionQuality(COURSE_INVENTORY).isUseful).toBe(false);
    expect(standaloneCardQuality(COURSE_CARD_LINE).isUseful).toBe(false);
  });
});
