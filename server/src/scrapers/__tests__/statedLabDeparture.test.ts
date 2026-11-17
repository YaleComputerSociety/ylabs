import { describe, expect, it } from 'vitest';
import {
  STATED_DEPARTURE_MIN_COMPLETED_RUNS,
  statedLabDepartureVerdict,
  statedLabDeparturesInPageText,
} from '../statedLabDeparture';

const LEAD = ['Quillfeather'];
const page = (text: string) => [{ url: 'https://orrery-fixture.example.edu/', text }];
const kinds = (text: string, leadSurnames: readonly string[] = LEAD) =>
  statedLabDeparturesInPageText(page(text), { leadSurnames }).map((departure) => departure.kind);

describe('statedLabDeparturesInPageText (#6324)', () => {
  it('reads a completed move away from Yale by the lab or its own lead', () => {
    expect(kinds('The lab has moved to the University of Fixtureland. Thank you.')).toEqual([
      'completed',
    ]);
    expect(
      kinds('Quillfeather lab has moved to Münster, Germany (University of Münster).'),
    ).toEqual(['completed']);
    expect(kinds('Professor Quillfeather left Yale in 2024 to lead a new program.')).toEqual([
      'completed',
    ]);
    expect(kinds('Ada Quillfeather is now at the Fixture Research Institute.')).toEqual([
      'completed',
    ]);
    expect(
      kinds(
        'The Quillfeather lab has moved to the University of Fixtureland, where the work continues with collaborators at Yale.',
      ),
    ).toEqual(['completed']);
  });

  it('reads an announced move with its stated date', () => {
    const [departure] = statedLabDeparturesInPageText(
      page(
        'The Quillfeather Lab will be moving to the Department of Optics at the University of Fixtureland in January 2021.',
      ),
      { leadSurnames: LEAD },
    );
    expect(departure).toMatchObject({ kind: 'announced', statedDate: 'January 2021' });
    expect(departure.quote).toContain('will be moving');
  });

  it('keeps a career history before Yale', () => {
    expect(
      kinds('Before moving to the University of Fixtureland, Dr. Quillfeather trained in Basel.'),
    ).toEqual([]);
    expect(
      kinds('Prior to joining Yale, Quillfeather has moved to and worked at several institutes.'),
    ).toEqual([]);
  });

  it('keeps a move to Yale', () => {
    expect(kinds('The lab has moved to the Yale School of Medicine in New Haven.')).toEqual([]);
    expect(kinds('Quillfeather is now at the Yale Fixture Institute.')).toEqual([]);
  });

  it('keeps a move between units inside Yale that does not name Yale', () => {
    expect(kinds('The lab has moved to the Wu Tsai Institute.')).toEqual([]);
    expect(kinds('Our lab has relocated to the School of Public Health.')).toEqual([]);
    expect(kinds('The lab has moved to the Department of Fixture Biology.')).toEqual([]);
    expect(kinds('The lab is now located at the Smilow Cancer Hospital.')).toEqual([]);
    expect(kinds('The lab has moved to the Institute of Fixture Science.')).toEqual([]);
  });

  it('keeps a figure of speech about the research', () => {
    expect(
      kinds('Our research is moving to new imaging methods developed at the Fixture Institute.'),
    ).toEqual([]);
  });

  it('keeps a lab member who moved on', () => {
    expect(
      kinds('Our former postdoc Dr. Quillfeather has moved to the University of Fixtureland.'),
    ).toEqual([]);
    expect(kinds('Bram Ottoline is now at the Fixture Research Institute.')).toEqual([]);
    expect(
      kinds('Graduate students in the lab have moved to the University of Fixtureland.', []),
    ).toEqual([]);
  });

  it('keeps an instrument or a website that moved', () => {
    expect(kinds('The confocal microscope has moved to the imaging core facility.')).toEqual([]);
    expect(kinds('This site has moved to a new address at the University of Fixtureland.')).toEqual(
      [],
    );
    expect(kinds('The microscope from our lab has moved to the Fixture Institute.')).toEqual([]);
    expect(kinds('The website for the lab has moved to the University of Fixtureland.')).toEqual(
      [],
    );
  });

  it('reads nothing from silence or a person who is not a lead', () => {
    expect(statedLabDeparturesInPageText([], { leadSurnames: LEAD })).toEqual([]);
    expect(statedLabDeparturesInPageText(undefined)).toEqual([]);
    expect(kinds('We study orbital resonance in synthetic planetary systems.')).toEqual([]);
  });
});

describe('statedLabDepartureVerdict (#6324)', () => {
  const completedRead = (runId: string) => ({
    runId,
    pages: page('The lab has moved to the University of Fixtureland.'),
  });
  const announcedRead = (runId: string) => ({
    runId,
    pages: page('The lab will be moving to the University of Fixtureland this summer.'),
  });

  it('counts a completed statement read in two distinct runs as a departure', () => {
    expect(
      statedLabDepartureVerdict({
        reads: [completedRead('run-1'), completedRead('run-2')],
        leadSurnames: LEAD,
        leadsHoldYaleAppointment: false,
      }),
    ).toMatchObject({ departed: true, completedRuns: 2 });
  });

  it('needs the minimum number of distinct runs, not repeated reads in one run', () => {
    expect(STATED_DEPARTURE_MIN_COMPLETED_RUNS).toBe(2);
    expect(
      statedLabDepartureVerdict({
        reads: [completedRead('run-1'), completedRead('run-1')],
        leadSurnames: LEAD,
        leadsHoldYaleAppointment: false,
      }),
    ).toMatchObject({ departed: false, completedRuns: 1 });
  });

  it('keeps the row while any lead holds a Yale appointment, however many runs restate the move', () => {
    const verdict = statedLabDepartureVerdict({
      reads: ['run-1', 'run-2', 'run-3', 'run-4'].map(completedRead),
      leadSurnames: LEAD,
      leadsHoldYaleAppointment: true,
    });
    expect(verdict).toMatchObject({ departed: false, completedRuns: 4 });
    expect(verdict.signal?.kind).toBe('completed');
  });

  it('never hides on an announcement, whatever its date, and returns it as a signal', () => {
    const verdict = statedLabDepartureVerdict({
      reads: ['run-1', 'run-2', 'run-3'].map(announcedRead),
      leadSurnames: LEAD,
      leadsHoldYaleAppointment: false,
    });
    expect(verdict).toMatchObject({ departed: false, completedRuns: 0 });
    expect(verdict.signal).toMatchObject({ kind: 'announced', statedDate: 'this summer' });
  });

  it('says nothing when no read states a departure', () => {
    expect(
      statedLabDepartureVerdict({
        reads: [{ runId: 'run-1', pages: page('We study tides.') }],
        leadSurnames: LEAD,
        leadsHoldYaleAppointment: false,
      }),
    ).toEqual({ departed: false, completedRuns: 0 });
  });
});
