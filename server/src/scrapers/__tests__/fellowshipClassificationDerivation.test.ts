import { describe, expect, it } from 'vitest';
import { planFellowshipClassification } from '../fellowshipClassificationDerivation';

describe('planFellowshipClassification program role (#3904)', () => {
  const stored = {
    title: 'Fixture Research Grant',
    description: 'Supports independent summer research projects.',
    programKind: 'STRUCTURED_PROGRAM',
    programRole: 'FUNDS_RESEARCH',
  };

  it('derives the role from the locked kind the row keeps', () => {
    const plan = planFellowshipClassification({ stored, lockedFields: ['programKind'] });
    expect(plan.set.programKind).toBeUndefined();
    expect(plan.set.programRole).toBe('STARTS_RESEARCH');
  });

  it('derives the role from the classifier kind when the kind is not locked', () => {
    const plan = planFellowshipClassification({ stored });
    expect(plan.set.programKind).toBe('FELLOWSHIP_FUNDING');
    expect(plan.classification.programRole).toBe('FUNDS_RESEARCH');
  });
});

describe('planFellowshipClassification department internships (#4089)', () => {
  const departmentInternship = {
    title: 'Fixture Research Internship Program',
    sourceUrl:
      'https://example.yale.edu/academic-study/departments/fixture-studies/undergraduate-study/research-internship-program',
  };

  it('derives a department program and sets nothing when re-run on its own output', () => {
    const first = planFellowshipClassification({ stored: departmentInternship });
    expect(first.classification).toMatchObject({
      programCategory: 'RECURRING_PROGRAM',
      programKind: 'STRUCTURED_PROGRAM',
      studentFacingCategory: 'Internship program',
    });
    const rerun = planFellowshipClassification({
      stored: { ...departmentInternship, ...first.set },
    });
    expect(rerun.set).toEqual({});
  });

  it.each([
    ['a departments hostname', 'https://departments.example.yale.edu/internship'],
    ['a near-miss path segment', 'https://example.yale.edu/departments-news/internship'],
    ['a query string', 'https://example.yale.edu/internship?from=departments'],
    ['a fragment', 'https://example.yale.edu/internship#undergraduate-study'],
    ['an uppercase segment', 'https://example.yale.edu/Departments/fixture/internship'],
    ['a malformed URL', 'not a url /departments/fixture'],
    ['no URL', undefined],
  ])('keeps an internship with %s a center internship', (_label, sourceUrl) => {
    const plan = planFellowshipClassification({
      stored: { title: 'Fixture Internship', ...(sourceUrl ? { sourceUrl } : {}) },
    });
    expect(plan.classification).toMatchObject({
      programCategory: 'CENTER_INTERNSHIP',
      programKind: 'CENTER_INTERNSHIP',
      studentFacingCategory: 'Internship program',
    });
  });

  it.each([
    ['a funding award', 'Fixture Internship Fellowship'],
    ['a non-internship program', 'Fixture Undergraduate Research Mentoring Program'],
  ])('does not reclassify %s on a department page', (_label, title) => {
    const sourceUrl = 'https://example.yale.edu/departments/fixture/undergraduate-study/page';
    const onDepartmentPage = planFellowshipClassification({ stored: { title, sourceUrl } });
    const elsewhere = planFellowshipClassification({
      stored: { title, sourceUrl: 'https://fixturecenter.yale.edu/page' },
    });
    expect(onDepartmentPage.classification.programKind).toBe(elsewhere.classification.programKind);
    expect(onDepartmentPage.classification.programCategory).toBe(
      elsewhere.classification.programCategory,
    );
  });
});

describe('planFellowshipClassification reads prose past the stored cap (#4232)', () => {
  const head = Array.from(
    { length: 40 },
    (_, index) =>
      `Recipient cohort ${index + 1} presents findings from archival fieldwork at the spring forum.`,
  ).join(' ');
  const observedDescription = `${head} Each application must include the approval of a faculty advisor who will supervise the research project.`;
  const stored = {
    title: 'Fixture College Senior Research Grant',
    description: `${head.slice(0, 1990).replace(/\s+\S*$/, '')}…`,
  };

  it('finds an adviser requirement the stored copy cut off', () => {
    const plan = planFellowshipClassification({
      stored,
      observedValues: { description: observedDescription },
    });
    expect(plan.classification.requiresMentorBeforeApply).toBe(true);
  });

  it('reads the stored copy alone when no source observed more of it', () => {
    expect(planFellowshipClassification({ stored }).classification.requiresMentorBeforeApply).toBe(
      false,
    );
  });

  it('keeps reading the stored copy of a locked field', () => {
    const plan = planFellowshipClassification({
      stored,
      lockedFields: ['description'],
      observedValues: { description: observedDescription },
    });
    expect(plan.classification.requiresMentorBeforeApply).toBe(false);
  });

  it('ignores an observed text the stored copy does not begin', () => {
    const plan = planFellowshipClassification({
      stored,
      observedValues: {
        description: `A different paragraph entirely. ${observedDescription}`,
      },
    });
    expect(plan.classification.requiresMentorBeforeApply).toBe(false);
  });
});
