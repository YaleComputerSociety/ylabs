import { describe, it, expect } from 'vitest';
import { resolveField, resolveAllFields, resolveFieldRanked } from '../confidenceResolver';

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

  it('ranks an authoritative lab-microsite description above a fresher roster one-liner', () => {
    const r = resolveField(
      'fullDescription',
      [
        {
          field: 'fullDescription',
          value: 'Studies condensed matter physics.',
          sourceName: 'dept-faculty-roster',
          confidence: 0.5,
          observedAt: D('2026-08-20'),
        },
        {
          field: 'fullDescription',
          value:
            'The da Silva Neto research group investigates the electronic properties of quantum materials, including nematic order, superconductivity, magnetism, and charge order.',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.82,
          observedAt: D('2026-05-17'),
        },
      ],
      { now: D('2026-08-22') },
    );
    expect(r?.value).toContain('quantum materials');
    expect(r?.contributingSources).toEqual(['lab-microsite-description-llm']);
  });

  it('keeps a fresh roster-sourced bio competing on weight against a stale extracted bio', () => {
    const r = resolveField(
      'bio',
      [
        {
          field: 'bio',
          value:
            'Extracted from the faculty profile page: studies the electronic properties of quantum materials with a focus on nematic order and superconductivity.',
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: D('2026-08-20'),
        },
        {
          field: 'bio',
          value:
            'Stale bio captured long ago from a backfill pass describing broadly similar but outdated interests in condensed matter systems.',
          sourceName: 'official-profile-pi-backfill',
          confidence: 0.85,
          observedAt: D('2025-08-20'),
        },
      ],
      { now: D('2026-08-22') },
    );
    expect(r?.value).toContain('quantum materials');
    expect(r?.contributingSources).toEqual(['dept-faculty-roster']);
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
      'Originally from Fixture City, Nora Fixture graduated with an Sc.B. in Biochemistry from Example University in 2002. Nora Fixture is currently an assistant professor studying long noncoding RNAs in cancer.';
    const prefixOnlyBio =
      'Originally from Fixture City, Nora Fixture graduated with an Sc.B. in Biochemistry from Example University in 2002.';

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

  it('lets a fresh lower-confidence scraper observation overtake an old high-confidence one on decay grounds alone (the general vulnerability class)', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Original Curated Name',
          sourceName: 'official-profile-pi-backfill',
          confidence: 1.0,
          observedAt: D('2025-11-01'),
        },
        {
          field: 'name',
          value: 'Fresh Scraper Name',
          sourceName: 'nih-reporter',
          confidence: 0.9,
          observedAt: D('2026-08-20'),
        },
      ],
      { now: D('2026-08-24'), recencyHalfLifeDays: 90 },
    );
    expect(r?.value).toBe('Fresh Scraper Name');
  });

  it('keeps an old manual-admin-edit correction ahead of a fresh higher-recency scraper observation despite the 90-day decay half-life', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'PI-Corrected Name',
          sourceName: 'manual-admin-edit',
          confidence: 1.0,
          observedAt: D('2025-11-01'),
        },
        {
          field: 'name',
          value: 'Fresh Scraper Name',
          sourceName: 'nih-reporter',
          confidence: 0.9,
          observedAt: D('2026-08-20'),
        },
      ],
      { now: D('2026-08-24'), recencyHalfLifeDays: 90 },
    );
    expect(r?.value).toBe('PI-Corrected Name');
    expect(r?.contributingSources).toEqual(['manual-admin-edit']);
  });

  it('still lets a genuinely newer manual-admin-edit correction supersede an older one', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Old Manual Correction',
          sourceName: 'manual-admin-edit',
          confidence: 1.0,
          observedAt: D('2025-01-01'),
        },
        {
          field: 'name',
          value: 'Newer Manual Correction',
          sourceName: 'manual-admin-edit',
          confidence: 1.0,
          observedAt: D('2026-08-20'),
        },
      ],
      { now: D('2026-08-24'), recencyHalfLifeDays: 90, conflictThreshold: 0.001 },
    );
    expect(r?.value).toBe('Newer Manual Correction');
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

  it('exempts manual-pi-edit from decay against a fresher scraper observation too', () => {
    const r = resolveField(
      'shortDescription',
      [
        {
          field: 'shortDescription',
          value: 'PI-curated one-line summary of the lab.',
          sourceName: 'manual-pi-edit',
          confidence: 1.0,
          observedAt: D('2026-02-04'),
        },
        {
          field: 'shortDescription',
          value: 'Fresh scraper-derived summary line.',
          sourceName: 'dept-faculty-roster',
          confidence: 0.9,
          observedAt: D('2026-08-22'),
        },
      ],
      { now: D('2026-08-23'), recencyHalfLifeDays: 90 },
    );
    expect(r?.value).toBe('PI-curated one-line summary of the lab.');
    expect(r?.contributingSources).toEqual(['manual-pi-edit']);
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

describe('resolveField name selection prefers branded over synthesized', () => {
  it('prefers a branded microsite name over a synthesized PI-derived name that wins on agreement and recency', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'SPIN (Statistical Physics, Information & Networks) Lab',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-22'),
        },
        {
          field: 'name',
          value: 'Alex Rivera Lab',
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: D('2026-07-25'),
        },
        {
          field: 'name',
          value: 'Alex Rivera Lab',
          sourceName: 'department-undergrad-research',
          confidence: 0.8,
          observedAt: D('2026-08-23'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('SPIN (Statistical Physics, Information & Networks) Lab');
    expect(r?.contributingSources).toEqual(['lab-microsite-description-llm']);
  });

  it('demotes a bare person name in favor of a head-noun lab name from the same source', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Rivera Lab',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-22'),
        },
        {
          field: 'name',
          value: 'Alexandra Rivera',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-23'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('Rivera Lab');
  });

  it('demotes a "<Person> Faculty Research" label in favor of a branded lab name', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Jordan Okafor Faculty Research',
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: D('2026-05-21'),
        },
        {
          field: 'name',
          value: 'Okafor Lab',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-22'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('Okafor Lab');
  });

  it('applies the same demotion to the displayName field', () => {
    const r = resolveField(
      'displayName',
      [
        {
          field: 'displayName',
          value: 'Rivera Lab',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-22'),
        },
        {
          field: 'displayName',
          value: 'Alexandra Rivera',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-23'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('Rivera Lab');
  });

  it('keeps a synthesized "<PI> Lab" name when it is the only available source (grant-shell lab)', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Alex Rivera Lab',
          sourceName: 'nih-reporter',
          confidence: 0.9,
          observedAt: D('2026-08-22'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('Alex Rivera Lab');
    expect(r?.contributingSources).toEqual(['nih-reporter']);
  });

  it('does not demote a synthesized "<PI> Lab" when no microsite brand exists (no affiliation-name conflation)', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Alex Rivera Lab',
          sourceName: 'nih-reporter',
          confidence: 0.9,
          observedAt: D('2026-08-23'),
        },
        {
          field: 'name',
          value: 'Center for Brain and Mind Health',
          sourceName: 'official-profile-pi-backfill',
          confidence: 0.7,
          observedAt: D('2026-05-01'),
        },
      ],
      { now: D('2026-08-24'), conflictThreshold: 0.05 },
    );
    expect(r?.value).toBe('Alex Rivera Lab');
  });

  it('keeps the single branded microsite name when it is the only candidate', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'The Faboratory',
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.55,
          observedAt: D('2026-05-18'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('The Faboratory');
  });

  it('does not regress a clean curated name to a lower-weight page-title-glued variant', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Doe Lab',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-22'),
        },
        {
          field: 'name',
          value: 'Doe Lab',
          sourceName: 'ysm-atoz-index',
          confidence: 0.8,
          observedAt: D('2026-07-25'),
        },
        {
          field: 'name',
          value: 'Illuminating chemistry at the human:microbe interface | Doe Lab',
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.55,
          observedAt: D('2026-05-25'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('Doe Lab');
  });

  it('leaves non-name fields untouched by the branded-name preference', () => {
    const r = resolveField(
      'title',
      [
        {
          field: 'title',
          value: 'Alex Rivera Lab',
          sourceName: 'dept-faculty-roster',
          confidence: 0.9,
          observedAt: D('2026-08-23'),
        },
        {
          field: 'title',
          value: 'Rivera Lab',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.5,
          observedAt: D('2026-05-01'),
        },
      ],
      { now: D('2026-08-24'), conflictThreshold: 0.05 },
    );
    expect(r?.value).toBe('Alex Rivera Lab');
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

describe('resolveFieldRanked', () => {
  it('returns an empty array when no observations exist for the field', () => {
    expect(resolveFieldRanked('fullDescription', [])).toEqual([]);
  });

  it('returns every distinct value in weight-descending order with the winner first', () => {
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        {
          field: 'fullDescription',
          value: 'lower',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.7,
          observedAt: D('2026-01-01'),
        },
        {
          field: 'fullDescription',
          value: 'winner',
          sourceName: 'ysm-atoz-index',
          confidence: 0.95,
          observedAt: D('2026-02-01'),
        },
      ],
      { now: D('2026-02-10') },
    );
    expect(ranked.map((r) => r.value)).toEqual(['winner', 'lower']);
    expect(ranked[0].value).toBe(resolveField(
      'fullDescription',
      [
        {
          field: 'fullDescription',
          value: 'lower',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.7,
          observedAt: D('2026-01-01'),
        },
        {
          field: 'fullDescription',
          value: 'winner',
          sourceName: 'ysm-atoz-index',
          confidence: 0.95,
          observedAt: D('2026-02-01'),
        },
      ],
      { now: D('2026-02-10') },
    )?.value);
  });

  it('collapses duplicate values across sources into a single ranked entry', () => {
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        {
          field: 'fullDescription',
          value: 'same prose',
          sourceName: 'source-a',
          confidence: 0.8,
          observedAt: D('2026-01-01'),
        },
        {
          field: 'fullDescription',
          value: 'same prose',
          sourceName: 'source-b',
          confidence: 0.8,
          observedAt: D('2026-01-01'),
        },
      ],
      { now: D('2026-01-10') },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].contributingSources.sort()).toEqual(['source-a', 'source-b']);
  });

  it('returns only the locked value for a manually locked field', () => {
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        {
          field: 'fullDescription',
          value: 'observed',
          sourceName: 'ysm-atoz-index',
          confidence: 0.95,
          observedAt: D('2026-02-01'),
        },
      ],
      { manuallyLockedFields: ['fullDescription'], manualValues: { fullDescription: 'locked value' } },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].value).toBe('locked value');
    expect(ranked[0].contributingSources).toEqual(['manual']);
  });
});
