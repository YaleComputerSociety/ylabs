/**
 * One case per counterexample that killed an earlier mechanism, so none of them can come
 * back. #3410 tried four reconciliations of the faculty-keyword and subordinate-rank
 * vocabularies and each broke on a title the corpus actually holds.
 */
import { describe, it, expect } from 'vitest';
import {
  namesARankItServesRatherThanHolds,
  titleOwnsResearch,
  titleRankSpans,
  titleResearchOwnership,
} from '../titleResearchOwnership';

describe('titleResearchOwnership', () => {
  it('reads a conjoined appointment as owning research', () => {
    // Killed the clause split: the refused phrase shares a clause, or an `and`, with the
    // appointment.
    for (const title of [
      'Professor of Psychiatry and of Neuroscience; Research Assistant',
      'Professor of Molecular Biophysics and Biochemistry and Lab Manager',
      'Special Collections Librarian Divinity Library, Lecturer in American Religious History',
      'Assistant Professor Adjunct of Technical Design and Electro Mechanical Laboratory Supervisor',
    ]) {
      expect(titleResearchOwnership(title)).toBe('owns_research');
    }
  });

  it('reads a rank held inside another group as owning nothing, whatever its spelling', () => {
    // Killed the blunt whole-title yield (`postdoctoral` is a FACULTY_KEYWORD) and the
    // spelling split (`postdoc` yielded while `post-doc` did not).
    for (const title of [
      'Postdoctoral Associate',
      'postdoc in Immunobiology',
      'Post-Doctoral Fellow in Immunobiology',
      'Post-doc',
      'Research Associate',
      'Research Fellow',
      'Visiting Scholar',
      'Graduate Student',
      'Ph.D. Student',
      'Graduate School Student',
      'IDE Student',
      'Clinical Fellow',
      'Resident',
      'Trainee',
    ]) {
      expect(titleResearchOwnership(title)).toBe('works_in_another_group');
    }
  });

  it('lets the longer rank phrase win an overlap', () => {
    // Killed the per-keyword filter: `research scientist` tested in isolation cannot see
    // the phrase `associate research scientist` that the screen matches.
    expect(titleResearchOwnership('Associate Research Scientist in Neurology')).toBe(
      'works_in_another_group',
    );
    expect(titleResearchOwnership('Research Scientist')).toBe('owns_research');
    expect(titleResearchOwnership('Senior Research Scientist in Genetics')).toBe('owns_research');

    const spans = titleRankSpans('Associate Research Scientist in Neurology');
    expect(spans).toHaveLength(1);
    expect(spans[0].text.toLowerCase()).toBe('associate research scientist');
  });

  it('treats a title that names no rank as silence rather than as owning nothing', () => {
    for (const title of ['Laboratory Assistant 3', 'Registrar', 'Librarian 4', '']) {
      expect(titleResearchOwnership(title)).toBe('states_no_rank');
    }
    expect(titleResearchOwnership(undefined)).toBe('states_no_rank');
  });

  it('reads a rank through the invisible format characters a CMS emits', () => {
    expect(titleResearchOwnership('Assis­tant Pro­fes­sor of Economics')).toBe('owns_research');
    expect(titleResearchOwnership('Post​doctoral Associate')).toBe('works_in_another_group');
  });

  it('exposes every rank a title names, so a verdict can be explained', () => {
    const spans = titleRankSpans('Professor of Neurology; Postdoctoral Associate');
    expect(spans.map((span) => span.verdict)).toEqual(['owns_research', 'works_in_another_group']);
    expect(titleOwnsResearch('Professor of Neurology; Postdoctoral Associate')).toBe(true);
  });
});

describe('namesARankItServesRatherThanHolds', () => {
  // The module's known limit, asserted rather than hidden: a title names ranks but does not
  // say whose rank each one is, so these read as owning nothing and must be reported rather
  // than archived.
  it('flags an administrative role whose title names the population it serves', () => {
    for (const title of [
      'Senior Associate Director, Graduate Student and Postdoctoral Career Services',
      'Senior Associate Director of Graduate & Postdoc Employer Relations',
      'Associate Director, PhD Graduate Student Affairs',
    ]) {
      expect(titleResearchOwnership(title)).toBe('works_in_another_group');
      expect(namesARankItServesRatherThanHolds(title)).toBe(true);
    }
  });

  it('does not flag a plain rank, nor a title that already owns research', () => {
    expect(namesARankItServesRatherThanHolds('Postdoctoral Associate')).toBe(false);
    expect(namesARankItServesRatherThanHolds('Professor of Neurology')).toBe(false);
    expect(namesARankItServesRatherThanHolds(undefined)).toBe(false);
  });
});
