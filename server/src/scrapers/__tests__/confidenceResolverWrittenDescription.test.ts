import { describe, expect, it } from 'vitest';
import { resolveField, resolveFieldRanked } from '../confidenceResolver';

const D = (s: string) => new Date(s);
const NOW = D('2026-10-04');

const WRITTEN =
  'The lab studies how gut microbes shape immune development in early life. It combines gnotobiotic mouse models with single-cell sequencing to trace which bacterial signals train intestinal T cells.';
const COPIED =
  'Welcome to our lab. We are a team of scientists working on the microbiome and immunity, with projects on gnotobiotic mice, sequencing, and intestinal T cells across many collaborations.';
const ADMIN_NARRATION =
  'Her Yale profile lists interests in microbiome research and immunology, and the official next source for students to review is the lab website.';

const obs = (
  value: string,
  sourceName: string,
  confidence: number,
  observedAt: Date = D('2026-09-20'),
) => ({ field: 'fullDescription', value, sourceName, confidence, observedAt });

describe('the written description outranks copied evidence (#4788)', () => {
  it('serves a servable written body over a higher-weighted copied one', () => {
    const resolved = resolveField(
      'fullDescription',
      [
        obs(COPIED, 'lab-microsite-description-llm', 0.82),
        obs(WRITTEN, 'coverage-synthesis-llm', 0.5),
      ],
      { now: NOW },
    );
    expect(resolved?.value).toBe(WRITTEN);
    expect(resolved?.contributingSources).toEqual(['coverage-synthesis-llm']);
  });

  it('keeps the copied body in the ranked list as the fallback', () => {
    const ranked = resolveFieldRanked(
      'fullDescription',
      [
        obs(COPIED, 'lab-microsite-description-llm', 0.82),
        obs(WRITTEN, 'coverage-synthesis-llm', 0.5),
      ],
      { now: NOW },
    );
    expect(ranked.map((entry) => entry.value)).toEqual([WRITTEN, COPIED]);
  });

  it('falls back to copied evidence when the writer has not run', () => {
    const resolved = resolveField(
      'fullDescription',
      [obs(COPIED, 'lab-microsite-description-llm', 0.82)],
      { now: NOW },
    );
    expect(resolved?.value).toBe(COPIED);
  });

  it('does not prefer a written body that narrates its sources', () => {
    const resolved = resolveField(
      'fullDescription',
      [
        obs(COPIED, 'lab-microsite-description-llm', 0.82),
        obs(ADMIN_NARRATION, 'coverage-synthesis-llm', 0.5),
      ],
      { now: NOW },
    );
    expect(resolved?.value).toBe(COPIED);
  });

  it("leaves a PI's own edit ahead of the written body", () => {
    const PI_EDIT =
      'Studies how commensal bacteria educate intestinal T cells during the first weeks of life, using germ-free mice and single-cell sequencing.';
    const resolved = resolveField(
      'fullDescription',
      [obs(WRITTEN, 'coverage-synthesis-llm', 0.5), obs(PI_EDIT, 'manual-pi-edit', 1)],
      { now: NOW },
    );
    expect(resolved?.value).toBe(PI_EDIT);
  });

  it('applies to fullDescription only', () => {
    const resolved = resolveField(
      'shortDescription',
      [
        {
          ...obs('Studies gut microbes and immune development.', 'coverage-synthesis-llm', 0.5),
          field: 'shortDescription',
        },
        {
          ...obs(
            'Studies how gut microbes train intestinal T cells in germ-free mice.',
            'lab-microsite-description-llm',
            0.82,
          ),
          field: 'shortDescription',
        },
      ],
      { now: NOW },
    );
    expect(resolved?.value).toBe(
      'Studies how gut microbes train intestinal T cells in germ-free mice.',
    );
  });
});

describe('an admin description edit competes as ordinary evidence (#4788)', () => {
  it('loses to the written body although it carries a higher weight', () => {
    const resolved = resolveField(
      'fullDescription',
      [
        obs(ADMIN_NARRATION, 'manual-admin-edit', 1, D('2026-07-01')),
        obs(WRITTEN, 'coverage-synthesis-llm', 0.5),
      ],
      { now: NOW },
    );
    expect(resolved?.value).toBe(WRITTEN);
  });

  it('decays on a description field like any other source', () => {
    const resolved = resolveField(
      'fullDescription',
      [
        obs(COPIED, 'manual-admin-edit', 1, D('2025-10-01')),
        obs(WRITTEN, 'lab-microsite-description-llm', 0.82, D('2026-10-01')),
      ],
      { now: NOW },
    );
    expect(resolved?.value).toBe(WRITTEN);
  });

  it('keeps its curated precedence on a field that is not a description', () => {
    const resolved = resolveField(
      'name',
      [
        {
          field: 'name',
          value: 'Corrected Lab Name',
          sourceName: 'manual-admin-edit',
          confidence: 1,
          observedAt: D('2025-10-01'),
        },
        {
          field: 'name',
          value: 'Fresh Scraped Name',
          sourceName: 'nih-reporter',
          confidence: 0.9,
          observedAt: D('2026-10-01'),
        },
      ],
      { now: NOW },
    );
    expect(resolved?.value).toBe('Corrected Lab Name');
  });
});
