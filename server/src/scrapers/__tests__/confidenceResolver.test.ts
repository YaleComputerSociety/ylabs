import { describe, it, expect } from 'vitest';
import { resolveField, resolveAllFields } from '../confidenceResolver';

const D = (s: string) => new Date(s);

describe('resolveField', () => {
  it('returns null when no observations exist for the field', () => {
    expect(resolveField('title', [])).toBeNull();
  });

  it('returns the only observation when there is just one', () => {
    const r = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'Smith Lab',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10') },
    );
    expect(r?.value).toBe('Smith Lab');
    expect(r?.contributingSources).toEqual(['openalex']);
    expect(r?.hasConflict).toBe(false);
  });

  it('picks the higher-weight value when sources disagree', () => {
    const r = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'Smith Lab',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'title',
          value: 'Jane Smith Research Lab',
          sourceName: 'lab-microsite-llm',
          confidence: 0.6,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10'), conflictThreshold: 0.05 },
    );
    expect(r?.value).toBe('Smith Lab');
  });

  it('flags a conflict when two values are close in weight', () => {
    const r = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'A',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'title',
          value: 'B',
          sourceName: 'semantic-scholar',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10'), conflictThreshold: 0.3 },
    );
    expect(r?.hasConflict).toBe(true);
    expect(r?.conflictingValues).toEqual(expect.arrayContaining(['A', 'B']));
  });

  it('applies an agreement bonus when multiple sources agree on a value', () => {
    const single = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'X',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'title',
          value: 'Y',
          sourceName: 'lab-microsite-llm',
          confidence: 0.95,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10') },
    );
    expect(single?.value).toBe('Y');

    const agreed = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'X',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'title',
          value: 'X',
          sourceName: 'semantic-scholar',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'title',
          value: 'Y',
          sourceName: 'lab-microsite-llm',
          confidence: 0.95,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10'), agreementBonusPerExtraSource: 0.5 },
    );
    expect(agreed?.value).toBe('X');
    expect(agreed?.contributingSources).toEqual(
      expect.arrayContaining(['openalex', 'semantic-scholar']),
    );
  });

  it('decays older observations relative to newer ones', () => {
    const r = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'Old',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2024-01-01'),
        },
        {
          field: 'title',
          value: 'New',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10'), recencyHalfLifeDays: 90 },
    );
    expect(r?.value).toBe('New');
  });

  it('prefers a recent complete bio over a newer prefix-only bio from the same source', () => {
    const completeBio =
      'Originally from Sofia, Bulgaria, Nadya Dimitrova graduated with an Sc.B. in Biochemistry from Brown University in 2002. Nadya Dimitrova is currently an assistant professor studying long noncoding RNAs in cancer.';
    const prefixOnlyBio =
      'Originally from Sofia, Bulgaria, Nadya Dimitrova graduated with an Sc.B. in Biochemistry from Brown University in 2002.';

    const r = resolveField(
      'bio',
      [
        {
          field: 'bio',
          value: completeBio,
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: D('2026-05-22'),
        },
        {
          field: 'bio',
          value: prefixOnlyBio,
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: D('2026-05-29'),
        },
      ],
      { now: D('2026-05-29'), recencyHalfLifeDays: 90 },
    );

    expect(r?.value).toBe(completeBio);
  });

  it('prefers a newer substantial concise bio over an older oversized excerpt from the same source', () => {
    const conciseBio =
      'Dr. Abujarad studies digital health tools for public health, clinical care, and health services research. His work develops patient-facing systems and evaluates implementation in real clinical settings.';
    const oversizedBio = `${conciseBio} ${'Additional official profile background. '.repeat(80)}`;

    const r = resolveField(
      'bio',
      [
        {
          field: 'bio',
          value: oversizedBio,
          sourceName: 'official-profile-pi-backfill',
          confidence: 0.85,
          observedAt: D('2026-06-04'),
        },
        {
          field: 'bio',
          value: conciseBio,
          sourceName: 'official-profile-pi-backfill',
          confidence: 0.85,
          observedAt: D('2026-06-05'),
        },
      ],
      { now: D('2026-06-05'), recencyHalfLifeDays: 90 },
    );

    expect(r?.value).toBe(conciseBio);
  });

  it('respects manuallyLockedFields and returns the manual value', () => {
    const r = resolveField(
      'description',
      [
        {
          field: 'description',
          value: 'Scraped description',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
      ],
      {
        now: D('2026-04-10'),
        manuallyLockedFields: ['description'],
        manualValues: { description: 'Hand-written by PI' },
      },
    );
    expect(r?.value).toBe('Hand-written by PI');
    expect(r?.confidence).toBe(1.0);
    expect(r?.contributingSources).toEqual(['manual']);
  });

  it('serializes arrays in a stable order so [a,b] === [b,a]', () => {
    const r = resolveField(
      'departments',
      [
        {
          field: 'departments',
          value: ['MCDB', 'Neuroscience'],
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'departments',
          value: ['Neuroscience', 'MCDB'],
          sourceName: 'yale-directory',
          confidence: 0.9,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10'), agreementBonusPerExtraSource: 0.5 },
    );
    expect(r?.contributingSources.length).toBe(2);
  });
});

describe('resolveAllFields', () => {
  it('produces a record keyed by field with all resolved entries', () => {
    const out = resolveAllFields(
      [
        {
          field: 'title',
          value: 'Smith Lab',
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
        {
          field: 'year',
          value: 2024,
          sourceName: 'openalex',
          confidence: 0.85,
          observedAt: D('2026-04-01'),
        },
      ],
      { now: D('2026-04-10') },
    );
    expect(Object.keys(out).sort()).toEqual(['title', 'year']);
    expect(out.title.value).toBe('Smith Lab');
    expect(out.year.value).toBe(2024);
  });
});
