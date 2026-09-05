import { describe, it, expect } from 'vitest';
import { resolveField, resolveAllFields, resolveFieldRanked } from '../confidenceResolver';
import { isHighConfidencePersonBio } from '../../utils/researchHomeDescriptionSelection';

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

  // A microsite "n/a" used to count as the genuine brand to prefer, which filtered
  // every roster candidate out of the ranked list and left the materialize name
  // repair nothing to fall through to (#2367).
  it('never lets placeholder filler win or suppress a real name from another source', () => {
    const observations = [
      {
        field: 'name',
        value: 'n/a',
        sourceName: 'lab-microsite-description-llm',
        confidence: 0.95,
        observedAt: D('2026-08-23'),
      },
      {
        field: 'name',
        value: 'Rafferty Duchamp Faculty Research',
        sourceName: 'dept-faculty-roster',
        confidence: 0.7,
        observedAt: D('2026-07-25'),
      },
    ];

    expect(resolveField('name', observations, { now: D('2026-08-24') })?.value).toBe(
      'Rafferty Duchamp Faculty Research',
    );
    expect(
      resolveFieldRanked('name', observations, { now: D('2026-08-24') }).map((r) => r.value),
    ).toContain('Rafferty Duchamp Faculty Research');
  });

  // The corpus is never left nameless: with nothing better on offer the filler is
  // still returned, and the `unusable_name` visibility blocker holds the record.
  it('keeps placeholder filler when it is the only name on offer', () => {
    const r = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'n/a',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.95,
          observedAt: D('2026-08-23'),
        },
      ],
      { now: D('2026-08-24') },
    );
    expect(r?.value).toBe('n/a');
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
    expect(ranked[0].value).toBe(
      resolveField(
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
      )?.value,
    );
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
      {
        manuallyLockedFields: ['fullDescription'],
        manualValues: { fullDescription: 'locked value' },
      },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].value).toBe('locked value');
    expect(ranked[0].contributingSources).toEqual(['manual']);
  });
});

describe('person-bio demotion for fullDescription', () => {
  const BIO =
    'Dr. Carolyn Roberts is an historian of science and medicine at Yale University, where she teaches in the history of science and medicine program and advises undergraduates.';
  const RESEARCH =
    'Investigates how the histories of slavery and colonial medicine shaped modern clinical practice, combining archival research on eighteenth-century medical records with public history collaborations.';

  const obs = (value: string, sourceName: string, confidence: number) => ({
    field: 'fullDescription',
    value,
    sourceName,
    confidence,
    observedAt: D('2026-02-01'),
  });

  it('lets a lower-confidence research description displace a higher-confidence profile bio', () => {
    // The profile bio is re-emitted weekly at 0.55 while every synthesis lane
    // ranks below official extraction, so on weight alone the replacement can
    // never win and the bio returns on the next scrape (#2200).
    const resolved = resolveField(
      'fullDescription',
      [
        obs(BIO, 'ysm-faculty-directory', 0.55),
        obs(RESEARCH, 'fra-profile-research-synthesis', 0.48),
      ],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(RESEARCH);
    expect(resolved?.contributingSources).toEqual(['fra-profile-research-synthesis']);
  });

  it('demotes a career biography that is not person-voiced enough for the bio check', () => {
    // The bio-replacing lane selects its cohort on career facts, so a demotion
    // keyed only on person-voice shape left that cohort undemotable: the endowed
    // chair bio is re-emitted weekly at 0.55, outranks the 0.48 replacement
    // forever, and the lane reported success while the biography stayed served.
    const CAREER_BIO =
      'Nicholas R. Parrillo is William K. Townsend Professor of Law at Yale. His scholarship examines administrative law and the history of federal regulation.';
    expect(isHighConfidencePersonBio(CAREER_BIO)).toBe(false);
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(CAREER_BIO, 'ysm-faculty-directory', 0.55),
        obs(RESEARCH, 'fra-profile-research-synthesis', 0.48),
      ],
      { now: D('2026-02-08') },
    );
    expect(ranked.map((entry) => entry.value)).toEqual([RESEARCH, CAREER_BIO]);
  });

  it('ranks the bio last but keeps it reachable as the materializer fallback', () => {
    // Dropping it instead left the materializer's fallback walk with nothing to
    // fall back to when its own content gates reject the winner, which blanked
    // descriptions that had previously been served.
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(BIO, 'ysm-faculty-directory', 0.55),
        obs(RESEARCH, 'fra-profile-research-synthesis', 0.48),
      ],
      { now: D('2026-02-08') },
    );
    expect(ranked.map((entry) => entry.value)).toEqual([RESEARCH, BIO]);
  });

  it('does not report a conflict against the bio it displaced', () => {
    const resolved = resolveField(
      'fullDescription',
      [
        obs(BIO, 'ysm-faculty-directory', 0.55),
        obs(RESEARCH, 'fra-profile-research-synthesis', 0.48),
      ],
      { now: D('2026-02-08') },
    );
    expect(resolved?.hasConflict).toBe(false);
    expect(resolved?.confidence).toBe(1);
  });

  it('leaves a bio-shaped description alone when no bio-replacing lane competes', () => {
    // `isHighConfidencePersonBio` also fires on genuine organization prose, and
    // most fullDescription emitters carry no write-time bio guard, so a
    // field-wide demotion promoted a bare grant abstract over a lab's own
    // official description.
    const ORG_PROSE =
      "Professor Jane Doe's laboratory investigates the molecular basis of neurodegeneration, combining human genetics with mouse models of tau propagation to identify tractable therapeutic targets.";
    const GRANT_ABSTRACT =
      'This project will develop and validate a scalable assay for measuring protein aggregation kinetics in patient-derived neurons across a panel of candidate small molecules.';
    expect(isHighConfidencePersonBio(ORG_PROSE)).toBe(true);
    const ranked = resolveFieldRanked(
      'fullDescription',
      [obs(ORG_PROSE, 'yale-research-official', 0.9), obs(GRANT_ABSTRACT, 'nih-reporter', 0.3)],
      { now: D('2026-02-08') },
    );
    expect(ranked.map((entry) => entry.value)).toEqual([ORG_PROSE, GRANT_ABSTRACT]);
  });

  it('still serves a sole bio rather than blanking the description', () => {
    const resolved = resolveField('fullDescription', [obs(BIO, 'ysm-faculty-directory', 0.55)], {
      now: D('2026-02-08'),
    });
    expect(resolved?.value).toBe(BIO);
  });

  it('keeps the bio when the only non-bio alternative is not a useful description', () => {
    const resolved = resolveField(
      'fullDescription',
      [obs(BIO, 'ysm-faculty-directory', 0.55), obs('Research areas:', 'dept-roster-index', 0.48)],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(BIO);
  });

  it('lets research prose already recorded by an ordinary source outrank a biography', () => {
    // The synthesis lane skips an entity that already has usable non-bio prose,
    // so keying the demotion on that lane's own source left the two mechanisms
    // deadlocked and the biography served (#2200 follow-up).
    const FIRST_PERSON_BIO =
      'I am an Associate Professor of Chemistry at the university. I received my Ph.D. from a midwestern graduate program and completed postdoctoral training before joining the faculty.';
    const RESEARCH_PROSE =
      'Research focuses on catalytic reactions in aqueous media, developing earth-abundant metal complexes that convert waste carbon dioxide into liquid fuels.';
    const resolved = resolveField(
      'fullDescription',
      [
        obs(FIRST_PERSON_BIO, 'lab-microsite-description-llm', 0.59),
        obs(RESEARCH_PROSE, 'lab-microsite-undergrad-llm', 0.41),
      ],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(RESEARCH_PROSE);
  });

  it('does not reorder on a bare titled-name opener alone', () => {
    // Measured on the served corpus, that opener leads ordinary research prose
    // roughly three times as often as it leads a biography, so it is not enough
    // evidence to rank a description below another one.
    const TITLED_NAME_PROSE =
      "Professor Lindqvist's research investigates how engineered proteins fold inside living cells, combining single-molecule spectroscopy with computational modelling of folding pathways.";
    const RESEARCH_PROSE =
      'Research focuses on catalytic reactions in aqueous media, developing earth-abundant metal complexes that convert waste carbon dioxide into liquid fuels.';
    expect(isHighConfidencePersonBio(TITLED_NAME_PROSE)).toBe(true);
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(TITLED_NAME_PROSE, 'lab-microsite-description-llm', 0.59),
        obs(RESEARCH_PROSE, 'lab-microsite-undergrad-llm', 0.41),
      ],
      { now: D('2026-02-08') },
    );
    expect(ranked.map((entry) => entry.value)).toEqual([TITLED_NAME_PROSE, RESEARCH_PROSE]);
  });

  it('keeps the biography when the value that would be promoted is a recruiting pitch', () => {
    const CREDENTIAL_BIO =
      'Avery Lindqvist, PhD, is an assistant professor in the department of applied physics. She completed doctoral training in optics and joined the faculty after two postdoctoral appointments.';
    const RECRUITING_PITCH =
      'We are recruiting a postdoctoral fellow and two graduate students to join the group; if you are interested in joining, please reach out by email.';
    const resolved = resolveField(
      'fullDescription',
      [
        obs(CREDENTIAL_BIO, 'lab-microsite-description-llm', 0.59),
        obs(RECRUITING_PITCH, 'lab-microsite-undergrad-llm', 0.41),
      ],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(CREDENTIAL_BIO);
  });

  it('requires the highest-weighted survivor to qualify, not any value further down', () => {
    // Counting a qualifying value anywhere in the set is how a good description
    // ranked third licensed promoting the unvetted value ranked second.
    const CREDENTIAL_BIO =
      'Avery Lindqvist, PhD, is an assistant professor in the department of applied physics. She completed doctoral training in optics and joined the faculty after two postdoctoral appointments.';
    const RECRUITING_PITCH =
      'We are recruiting a postdoctoral fellow and two graduate students to join the group; if you are interested in joining, please reach out by email.';
    const RESEARCH_PROSE =
      'Research focuses on catalytic reactions in aqueous media, developing earth-abundant metal complexes that convert waste carbon dioxide into liquid fuels.';
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(CREDENTIAL_BIO, 'lab-microsite-description-llm', 0.6),
        obs(RECRUITING_PITCH, 'lab-microsite-undergrad-llm', 0.5),
        obs(RESEARCH_PROSE, 'department-undergrad-research', 0.2),
      ],
      { now: D('2026-02-08') },
    );
    expect(ranked[0].value).toBe(CREDENTIAL_BIO);
  });

  it('never reorders a curated manual override', () => {
    const CURATED_BIO =
      'Avery Lindqvist, PhD, is an assistant professor in the department of applied physics. She completed doctoral training in optics and joined the faculty after two postdoctoral appointments.';
    const RESEARCH_PROSE =
      'Research focuses on catalytic reactions in aqueous media, developing earth-abundant metal complexes that convert waste carbon dioxide into liquid fuels.';
    const resolved = resolveField(
      'fullDescription',
      [
        obs(CURATED_BIO, 'manual-admin-edit', 0.43),
        obs(RESEARCH_PROSE, 'lab-microsite-undergrad-llm', 0.41),
      ],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(CURATED_BIO);
  });

  it('does not demote a person bio for the bio field itself', () => {
    const resolved = resolveField(
      'bio',
      [
        { ...obs(BIO, 'ysm-faculty-directory', 0.55), field: 'bio' },
        { ...obs(RESEARCH, 'fra-profile-research-synthesis', 0.48), field: 'bio' },
      ],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(BIO);
  });
});

describe('undergrad-access lane demotion for fullDescription', () => {
  // Shapes taken from Development rows this demotion was measured on:
  // `center-ycga` and `yse-green-chemistry` serve the first while the second
  // sits unadopted in an active observation (#2266).
  const ACCESS_SUMMARY =
    'The lab focuses on genomic technology, offering sequencing and analysis services to Yale researchers across a range of projects.';
  const MICROSITE_RESEARCH =
    'The center develops and applies high-throughput sequencing technology for human genetics, spanning whole-genome and exome sequencing, single-cell transcriptomics, and long-read assembly. Its staff collaborate with investigators on experimental design, library preparation, and downstream statistical analysis, and it maintains shared instrumentation for the wider Yale research community.';

  const obs = (
    value: string,
    sourceName: string,
    confidence: number,
    observedAt = D('2026-02-01'),
  ) => ({
    field: 'fullDescription',
    value,
    sourceName,
    confidence,
    observedAt,
  });

  it('lets a richer microsite description displace a fresher undergrad-access summary', () => {
    // The access lane re-emits weekly at 0.5, so recency alone keeps a 128-char
    // access blurb ahead of the lab's own 383-char research description.
    const resolved = resolveField(
      'fullDescription',
      [
        obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
        obs(MICROSITE_RESEARCH, 'lab-microsite-description-llm', 0.55, D('2025-11-01')),
      ],
      { now: D('2026-02-25') },
    );
    expect(resolved?.value).toBe(MICROSITE_RESEARCH);
    expect(resolved?.contributingSources).toEqual(['lab-microsite-description-llm']);
  });

  it('ranks the access summary last but keeps it reachable as the materializer fallback', () => {
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
        obs(MICROSITE_RESEARCH, 'lab-microsite-description-llm', 0.55, D('2025-11-01')),
      ],
      { now: D('2026-02-25') },
    );
    expect(ranked.map((entry) => entry.value)).toEqual([MICROSITE_RESEARCH, ACCESS_SUMMARY]);
  });

  it('still serves a sole undergrad-access summary rather than blanking the description', () => {
    const resolved = resolveField(
      'fullDescription',
      [obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55)],
      { now: D('2026-02-08') },
    );
    expect(resolved?.value).toBe(ACCESS_SUMMARY);
  });

  it('keeps the access summary when the richer alternative is a career biography', () => {
    // The regression this demotion invites: on 52 of the thin served rows the
    // richest available value is a resume, and length alone would adopt it.
    const CAREER_BIO =
      'Godfrey Pearlson received his medical degree from the University of Edinburgh and completed his residency in psychiatry at Johns Hopkins, where he joined the faculty in 1980 before coming to Yale. He is the recipient of numerous awards for his work in neuroimaging and has served as director of several research centers.';
    const resolved = resolveField(
      'fullDescription',
      [
        obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
        obs(CAREER_BIO, 'ysm-faculty-directory', 0.55, D('2025-11-01')),
      ],
      { now: D('2026-02-25') },
    );
    expect(resolved?.value).toBe(ACCESS_SUMMARY);
  });

  it('keeps the access summary when the richer alternative is an escaped-HTML citation dump', () => {
    // A "Selected Publications" widget reaches fullDescriptionQuality with zero
    // flags, because the interposed `</span>` breaks the citation-author-list
    // run the detector matches on (`faculty-research-area-chao-ma`).
    const CITATION_DUMP =
      '<span data-id="165184">Djebra Y</span>, <span data-id="165327">Liu X</span>, <span data-id="165133">Marin T</span>, <span data-id="168637">Dhaynaut M</span>, <span data-id="165201">Petibon Y</span>, <span data-id="165399">Fakhri G</span>, <span data-id="165402">Ma C</span>. Joint reconstruction and motion estimation in respiratory-gated positron emission tomography using a matrix-free approach.';
    const resolved = resolveField(
      'fullDescription',
      [
        obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
        obs(CITATION_DUMP, 'lab-microsite-description-llm', 0.55, D('2025-11-01')),
      ],
      { now: D('2026-02-25') },
    );
    expect(resolved?.value).toBe(ACCESS_SUMMARY);
  });

  it('keeps the access summary when the alternative is not materially richer', () => {
    const SLIGHTLY_LONGER = `${ACCESS_SUMMARY} It also runs a seminar series.`;
    const resolved = resolveField(
      'fullDescription',
      [
        obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
        obs(SLIGHTLY_LONGER, 'lab-microsite-description-llm', 0.55, D('2025-11-01')),
      ],
      { now: D('2026-02-25') },
    );
    expect(resolved?.value).toBe(ACCESS_SUMMARY);
  });

  it('does not demote an access-lane value a human also recorded', () => {
    // The demotion only applies to a group sourced solely from the access lane,
    // so a value co-signed by a manual edit keeps the curated decay exemption
    // and stays ahead of a richer scraped description.
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
        obs(ACCESS_SUMMARY, 'manual-admin-edit', 0.55, D('2025-06-01')),
        obs(MICROSITE_RESEARCH, 'lab-microsite-description-llm', 0.55, D('2025-11-01')),
      ],
      { now: D('2026-02-25') },
    );
    expect(ranked[0]?.value).toBe(ACCESS_SUMMARY);
  });

  it('leaves other fields untouched by the access-lane demotion', () => {
    const resolved = resolveField(
      'shortDescription',
      [
        {
          ...obs(ACCESS_SUMMARY, 'lab-microsite-undergrad-llm', 0.55, D('2026-02-20')),
          field: 'shortDescription',
        },
        {
          ...obs(MICROSITE_RESEARCH, 'lab-microsite-description-llm', 0.55, D('2025-11-01')),
          field: 'shortDescription',
        },
      ],
      { now: D('2026-02-25') },
    );
    expect(resolved?.value).toBe(ACCESS_SUMMARY);
  });
});
