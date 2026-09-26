import { describe, expect, it } from 'vitest';
import { planRefusalLaneAttributions } from '../attributeFieldValueRefusalLanesCore';
import {
  attributeRefusedValueLanes,
  fieldValueRefusalKey,
} from '../../utils/researchEntityFieldValueRefusals';

const refusal = (field: string, value: string, extra: Record<string, unknown> = {}) => ({
  valueKey: fieldValueRefusalKey(field, value),
  rule: 'wrong_owner',
  refusedBy: 'test',
  refusedAt: new Date(0),
  note: '',
  ...extra,
});

describe('attributeRefusedValueLanes', () => {
  const key = fieldValueRefusalKey('websiteUrl', 'https://example.org/lab');

  it('attributes a refused website to the lane that cited it in sourceUrls', () => {
    const lanes = attributeRefusedValueLanes('websiteUrl', key, [
      {
        field: 'sourceUrls',
        value: ['https://other.org', 'https://example.org/lab/'],
        sourceName: 'roster',
      },
      { field: 'sourceUrls', value: ['https://other.org'], sourceName: 'directory' },
    ]);
    expect(lanes).toEqual(['roster']);
  });

  it('returns every lane that asserted the value, sorted', () => {
    const lanes = attributeRefusedValueLanes('websiteUrl', key, [
      { field: 'websiteUrl', value: 'https://www.example.org/lab', sourceName: 'z-lane' },
      { field: 'website', value: 'http://example.org/lab', sourceName: 'a-lane' },
    ]);
    expect(lanes).toEqual(['a-lane', 'z-lane']);
  });

  it('credits a citing lane only when no lane asserted the value at a field', () => {
    const lanes = attributeRefusedValueLanes('websiteUrl', key, [
      { field: 'websiteUrl', value: 'https://example.org/lab', sourceName: 'profile' },
      { field: 'sourceUrls', value: ['https://example.org/lab'], sourceName: 'roster' },
    ]);
    expect(lanes).toEqual(['profile']);
  });

  it('does not read citation fields for a prose field', () => {
    const prose = 'A lab that studies things.';
    const lanes = attributeRefusedValueLanes(
      'fullDescription',
      fieldValueRefusalKey('fullDescription', prose),
      [
        { field: 'sourceUrls', value: [prose], sourceName: 'citations' },
        { field: 'fullDescription', value: `  ${prose}\n`, sourceName: 'describer' },
      ],
    );
    expect(lanes).toEqual(['describer']);
  });

  it('ignores an observation with no lane name', () => {
    expect(
      attributeRefusedValueLanes('websiteUrl', key, [
        { field: 'websiteUrl', value: 'https://example.org/lab', sourceName: '  ' },
      ]),
    ).toEqual([]);
  });
});

describe('planRefusalLaneAttributions', () => {
  const url = 'https://example.org/lab';
  const observations = new Map([
    ['row-a', [{ field: 'sourceUrls', value: [url], sourceName: 'roster' }]],
  ]);

  it('plans an attribution for a refusal with no lane', () => {
    const outcome = planRefusalLaneAttributions(
      [{ slug: 'row-a', fieldValueRefusals: { websiteUrl: [refusal('websiteUrl', url)] } }],
      observations,
    );
    expect(outcome.plans).toEqual([
      {
        slug: 'row-a',
        field: 'websiteUrl',
        index: 0,
        valueKey: fieldValueRefusalKey('websiteUrl', url),
        attributedSourceNames: ['roster'],
      },
    ]);
  });

  it('never overrides a declared sourceName', () => {
    const outcome = planRefusalLaneAttributions(
      [
        {
          slug: 'row-a',
          fieldValueRefusals: {
            websiteUrl: [refusal('websiteUrl', url, { sourceName: 'operator-named' })],
          },
        },
      ],
      observations,
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.skipped.declared).toBe(1);
  });

  it('plans nothing on a second run', () => {
    const outcome = planRefusalLaneAttributions(
      [
        {
          slug: 'row-a',
          fieldValueRefusals: {
            websiteUrl: [refusal('websiteUrl', url, { attributedSourceNames: ['roster'] })],
          },
        },
      ],
      observations,
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.skipped.unchanged).toBe(1);
  });

  it('keeps a stored lane after its evidence is pruned and adds a new one', () => {
    const outcome = planRefusalLaneAttributions(
      [
        {
          slug: 'row-a',
          fieldValueRefusals: {
            websiteUrl: [refusal('websiteUrl', url, { attributedSourceNames: ['pruned-lane'] })],
          },
        },
      ],
      observations,
    );
    expect(outcome.plans[0].attributedSourceNames).toEqual(['pruned-lane', 'roster']);
    expect(outcome.multiLanePlans).toBe(1);
  });

  it('counts an unattributable refusal by field and rule', () => {
    const outcome = planRefusalLaneAttributions(
      [{ slug: 'row-b', fieldValueRefusals: { websiteUrl: [refusal('websiteUrl', url)] } }],
      observations,
    );
    expect(outcome.plans).toEqual([]);
    expect(outcome.skipped['no-matching-observation']).toBe(1);
    expect(outcome.unattributableByFieldAndRule).toEqual({ 'websiteUrl/wrong_owner': 1 });
  });

  it('reads a Mongoose Map of refusals', () => {
    const outcome = planRefusalLaneAttributions(
      [
        {
          slug: 'row-a',
          fieldValueRefusals: new Map([['websiteUrl', [refusal('websiteUrl', url)]]]),
        },
      ],
      observations,
    );
    expect(outcome.plans).toHaveLength(1);
  });
});
