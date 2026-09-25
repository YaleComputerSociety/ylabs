import { describe, expect, it } from 'vitest';
import {
  planUnbackedLabNameCorrections,
  summarizeUnbackedLabNameRefusals,
  urlAssertsALab,
  type UnbackedLabNameObservation,
  type UnbackedLabNameRow,
} from '../repairUnbackedLabNamesCore';

const row = (overrides: Partial<UnbackedLabNameRow> = {}): UnbackedLabNameRow => ({
  id: '6a0000000000000000000001',
  slug: 'quimby-lab-rq11',
  name: 'Quimby Lab',
  displayName: 'Quimby Lab',
  entityType: 'FACULTY_RESEARCH_AREA',
  ...overrides,
});

const leads = (names: string[] = ['Robin Quimby'], slug = 'quimby-lab-rq11') =>
  new Map<string, readonly string[]>([[slug, names]]);

const plan = (
  rows: UnbackedLabNameRow[],
  observations: UnbackedLabNameObservation[] = [],
  leadMap = leads(),
) => planUnbackedLabNameCorrections(rows, observations, leadMap);

describe('planUnbackedLabNameCorrections', () => {
  it('replaces an unbacked lab name with the lead-derived research record name', () => {
    const outcome = plan([row()]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toEqual([
      {
        id: '6a0000000000000000000001',
        slug: 'quimby-lab-rq11',
        currentName: 'Quimby Lab',
        correctedName: 'Robin Quimby Faculty Research',
        correctsDisplayName: true,
      },
    ]);
  });

  it('leaves displayName alone when it does not assert a lab', () => {
    const outcome = plan([row({ displayName: 'Robin Quimby Faculty Research' })]);
    expect(outcome.plans[0].correctsDisplayName).toBe(false);
  });

  it('refuses a row a live observation still names', () => {
    const outcome = plan(
      [row()],
      [{ entityKey: 'quimby-lab-rq11', field: 'name', value: 'Quimby Lab' }],
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('a-live-observation-asserts-this-name');
  });

  it('acts when the only observation naming it is superseded', () => {
    const outcome = plan(
      [row()],
      [{ entityKey: 'quimby-lab-rq11', field: 'name', value: 'Quimby Lab', superseded: true }],
    );
    expect(outcome.plans).toHaveLength(1);
  });

  it('refuses a row a lab site backs, because there the type is the defect', () => {
    expect(plan([row({ websiteUrl: 'https://quimbylab.yale.edu/' })]).refused[0].reason).toBe(
      'lab-evidence-backs-the-name',
    );
    expect(
      plan(
        [row()],
        [
          {
            entityKey: 'quimby-lab-rq11',
            field: 'name',
            value: 'Some Other Name',
            sourceUrl: 'https://medicine.yale.edu/lab/quimby/',
          },
        ],
      ).refused[0].reason,
    ).toBe('lab-evidence-backs-the-name');
  });

  it('refuses an operator-locked name', () => {
    expect(plan([row({ manuallyLockedFields: ['name'] })]).refused[0].reason).toBe(
      'operator-locked',
    );
    expect(plan([row({ manuallyLockedFields: ['displayName'] })]).refused[0].reason).toBe(
      'operator-locked',
    );
  });

  it('refuses a row whose lead is not exactly one, so a namesake never supplies the name', () => {
    expect(plan([row()], [], leads([])).refused[0].reason).toBe('lead-is-not-exactly-one');
    expect(plan([row()], [], leads(['Robin Quimby', 'Pradeep Quimby'])).refused[0].reason).toBe(
      'lead-is-not-exactly-one',
    );
  });

  it('refuses a lead whose name yields no person-scoped record name', () => {
    // A bare surname carries no given name, so the authority declines it.
    expect(plan([row()], [], leads(['Quimby'])).refused[0].reason).toBe(
      'lead-yields-no-person-scoped-name',
    );
  });

  it('refuses a row outside the shape rather than guessing at it', () => {
    expect(plan([row({ name: 'Quimby Faculty Research' })]).refused[0].reason).toBe(
      'name-does-not-assert-a-lab',
    );
    expect(plan([row({ entityType: 'LAB' })]).refused[0].reason).toBe('type-is-not-person-scoped');
    expect(plan([row({ entityType: 'CENTER' })]).refused[0].reason).toBe(
      'type-is-not-person-scoped',
    );
  });

  it('never plans a corrected name that still asserts a lab', () => {
    for (const lead of ['Robin Quimby', 'Thang Le', 'Maria de la Cruz']) {
      const outcome = plan([row()], [], leads([lead]));
      expect(outcome.plans).toHaveLength(1);
      expect(outcome.plans[0].correctedName).not.toMatch(/\s(Lab|Laboratory)$/i);
    }
  });

  it('counts every refusal reason it can emit', () => {
    const counts = summarizeUnbackedLabNameRefusals([
      { reason: 'operator-locked' },
      { reason: 'operator-locked' },
      { reason: 'lead-is-not-exactly-one' },
    ]);
    expect(counts['operator-locked']).toBe(2);
    expect(counts['lead-is-not-exactly-one']).toBe(1);
    expect(counts['lab-evidence-backs-the-name']).toBe(0);
  });
});

describe('urlAssertsALab', () => {
  it('accepts a url naming a lab and refuses one that does not', () => {
    expect(urlAssertsALab('https://quimbylab.yale.edu/')).toBe(true);
    expect(urlAssertsALab('https://medicine.yale.edu/lab/quimby/')).toBe(true);
    expect(urlAssertsALab('https://engineering.yale.edu/faculty-directory/quimby')).toBe(false);
    expect(urlAssertsALab('https://reporter.nih.gov/project-details/1')).toBe(false);
    expect(urlAssertsALab(undefined)).toBe(false);
  });
});
