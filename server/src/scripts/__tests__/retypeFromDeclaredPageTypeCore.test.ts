import { describe, expect, it } from 'vitest';
import {
  declaredResearchHomeTypeFromPage,
  planDeclaredPageTypeRetypes,
  type DeclaredTypeRow,
} from '../retypeFromDeclaredPageTypeCore';

const row = (overrides: Partial<DeclaredTypeRow> = {}): DeclaredTypeRow => ({
  slug: 'dept-example-programme',
  name: 'Example Programme',
  displayName: 'Example Programme',
  entityType: 'LAB',
  kind: 'lab',
  typeObservations: [
    { field: 'entityType', value: 'LAB' },
    { field: 'kind', value: 'lab' },
  ],
  pageStatus: '200',
  pageBytes: 60_000,
  pageTitle: 'Example Programme | Yale',
  pageHeading: 'Example Programme',
  ...overrides,
});

describe('declaredResearchHomeTypeFromPage', () => {
  it('lets a laboratory claim win outright, including a closed compound', () => {
    expect(declaredResearchHomeTypeFromPage('SEEN Lab | Sight-Saving Evaluation', '')).toBe('LAB');
    expect(declaredResearchHomeTypeFromPage('PittLab', '')).toBe('LAB');
    // A page that calls itself a laboratory is never retyped on the strength of the
    // programme words it also carries.
    expect(declaredResearchHomeTypeFromPage('Example Lab', 'Our research programme')).toBe('LAB');
  });

  it('prefers the most specific organisational claim over a programme word', () => {
    // A centre's page routinely lists its programmes and its core services, so read
    // order decides the row's type and it is not alphabetical.
    expect(
      declaredResearchHomeTypeFromPage(
        'Yale Translational Research Imaging Center',
        'Our programmes',
      ),
    ).toBe('CENTER');
    expect(declaredResearchHomeTypeFromPage('Wu Tsai Institute', 'Projects')).toBe('INSTITUTE');
    expect(
      declaredResearchHomeTypeFromPage('Keck Mass Spectrometry & Proteomics Resource', ''),
    ).toBe('CORE_FACILITY');
    expect(declaredResearchHomeTypeFromPage('Brain Energy Atlas Project', '')).toBe('INITIATIVE');
  });

  it('declares nothing when the page names no research-home noun', () => {
    // This is the honest majority. A hand reading of the cohort inferred a type from
    // names that sound like projects and reported 18 rows where the pages support 9.
    expect(declaredResearchHomeTypeFromPage('We Are XRPeds', 'We are XRPeds')).toBe('');
    expect(declaredResearchHomeTypeFromPage('Home | ImPACTS', '')).toBe('');
    expect(declaredResearchHomeTypeFromPage('', '')).toBe('');
    // A lab whose name is a pun is undetectable by any vocabulary, and the safe
    // consequence is that it declares nothing and is refused rather than retyped. The
    // row stays `LAB`, which is what it should be.
    expect(declaredResearchHomeTypeFromPage('The Faboratory at Yale', '')).toBe('');
  });
});

describe('planDeclaredPageTypeRetypes', () => {
  it('plans a retype to the type the page declares', () => {
    const outcome = planDeclaredPageTypeRetypes([
      row({ pageTitle: 'Brain Energy Atlas Project', pageHeading: '' }),
    ]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0].declaredType).toBe('INITIATIVE');
    // Both fields are refused, because the resolver reads either one.
    expect(outcome.plans[0].refusals).toEqual([
      { field: 'entityType', value: 'LAB' },
      { field: 'kind', value: 'lab' },
    ]);
  });

  it('refuses a row whose surviving observation asserts a third type', () => {
    // The requirement that makes this safe: after the refusal the row has to resolve to
    // the declared type. A surviving rival would win over the stored value and land the
    // row somewhere neither the page nor the repair chose, so it needs the type
    // asserted rather than the old one refused.
    const outcome = planDeclaredPageTypeRetypes([
      row({
        pageTitle: 'Brain Energy Atlas Project',
        typeObservations: [
          { field: 'entityType', value: 'LAB' },
          { field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
        ],
      }),
    ]);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('a-surviving-observation-asserts-another-type');
  });

  it('plans a row whose surviving observation already agrees with the page', () => {
    const outcome = planDeclaredPageTypeRetypes([
      row({
        pageTitle: 'Brain Energy Atlas Project',
        typeObservations: [
          { field: 'entityType', value: 'LAB' },
          { field: 'entityType', value: 'INITIATIVE' },
        ],
      }),
    ]);
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0].declaredType).toBe('INITIATIVE');
  });

  it('records a throttled read as unread rather than as a verdict', () => {
    // Three rows in this cohort returned 403 with one byte on hosts that served a full
    // page for other rows in the same serial pass. That is the instrument, not the page.
    for (const read of [
      { pageStatus: '403', pageBytes: 1 },
      { pageStatus: '200', pageBytes: 12 },
      { pageStatus: 'unreachable', pageBytes: 0 },
      { pageStatus: '404', pageBytes: 237 },
    ]) {
      const outcome = planDeclaredPageTypeRetypes([row(read)]);
      expect(outcome.plans, JSON.stringify(read)).toEqual([]);
      expect(outcome.refused[0].reason).toBe('page-not-read');
    }
  });

  it('never reverses an operator decision on the type', () => {
    for (const field of ['entityType', 'kind']) {
      const outcome = planDeclaredPageTypeRetypes([
        row({ pageTitle: 'Brain Energy Atlas Project', manuallyLockedFields: [field] }),
      ]);
      expect(outcome.plans).toEqual([]);
      expect(outcome.refused[0].reason).toBe('manually-locked');
    }
  });

  it('leaves a row alone when its own page declares a lab', () => {
    const outcome = planDeclaredPageTypeRetypes([row({ pageTitle: 'SEEN Lab', pageHeading: '' })]);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('page-declares-a-lab');
  });

  it('refuses rather than retypes when the page declares nothing', () => {
    const outcome = planDeclaredPageTypeRetypes([
      row({ pageTitle: 'We Are XRPeds', pageHeading: 'We are XRPeds' }),
    ]);
    expect(outcome.plans).toEqual([]);
    expect(outcome.refused[0].reason).toBe('page-declares-nothing');
  });
});
