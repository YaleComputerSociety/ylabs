import { describe, expect, it } from 'vitest';

import {
  assertDisambiguateSurnameLabApplyAllowed,
  buildSurnameLabDisambiguationPlans,
  parseDisambiguateSurnameLabArgs,
  singleSurnameLabName,
} from '../disambiguateSurnameLabNames';

describe('disambiguate surname lab names', () => {
  it('parses dry-run and bounded apply options', () => {
    expect(
      parseDisambiguateSurnameLabArgs([
        '--apply',
        '--confirm-surname-lab-disambiguation',
        '--limit=500',
        '--max-apply',
        '12',
        '--output',
        '/tmp/out.json',
      ]),
    ).toEqual({
      apply: true,
      confirmSurnameLabDisambiguation: true,
      limit: 500,
      limitExplicit: true,
      maxApply: 12,
      output: '/tmp/out.json',
    });

    expect(() => parseDisambiguateSurnameLabArgs(['--limit', '--apply'])).toThrow(
      '--limit requires a value',
    );
    expect(() => parseDisambiguateSurnameLabArgs(['--limit=10abc'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseDisambiguateSurnameLabArgs(['--max-apply=1.5'])).toThrow(
      '--max-apply must be a positive integer',
    );
    expect(() =>
      parseDisambiguateSurnameLabArgs(['--confirm-surname-lab-disambiguation=false']),
    ).toThrow('--confirm-surname-lab-disambiguation does not accept a value');
  });

  it('requires explicit bounds and confirmation before apply mode can connect', () => {
    expect(() =>
      assertDisambiguateSurnameLabApplyAllowed(
        {
          apply: true,
          confirmSurnameLabDisambiguation: false,
          limit: 500,
          limitExplicit: true,
          maxApply: 12,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-surname-lab-disambiguation is required/);

    expect(() =>
      assertDisambiguateSurnameLabApplyAllowed(
        {
          apply: true,
          confirmSurnameLabDisambiguation: true,
          limit: Infinity,
          limitExplicit: false,
          maxApply: 12,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--limit is required/);
  });

  it('detects only simple single-surname lab names', () => {
    expect(singleSurnameLabName('Lin Lab')).toBe('Lin');
    expect(singleSurnameLabName('Higgins-Chen Lab')).toBe('Higgins-Chen');
    expect(singleSurnameLabName('Haifan Lin Lab')).toBeNull();
    expect(singleSurnameLabName('3D Tumor Lab')).toBeNull();
  });

  it('renames duplicate single-surname labs using exact PI member evidence', () => {
    const result = buildSurnameLabDisambiguationPlans({
      entities: [
        { id: 'entity-a', name: 'Lin Lab', slug: 'lin-lab-hl379' },
        { id: 'entity-b', name: 'Lin Lab', slug: 'lin-lab-hl249', displayName: 'Lin Lab' },
        { id: 'entity-c', name: 'Unique Lab', slug: 'unique-lab' },
      ],
      members: [
        { researchEntityId: 'entity-a', userId: 'user-a', role: 'pi' },
        { researchEntityId: 'entity-b', userId: 'user-b', role: 'pi' },
        { researchEntityId: 'entity-c', userId: 'user-c', role: 'pi' },
      ],
      users: [
        { id: 'user-a', fname: 'Haifan', lname: 'Lin' },
        { id: 'user-b', fname: 'Haiqun', lname: 'Lin' },
        { id: 'user-c', fname: 'Una', lname: 'Unique' },
      ],
      existingActiveNames: ['Lin Lab', 'Lin Lab', 'Unique Lab'],
    });

    expect(result.plans).toEqual([
      expect.objectContaining({
        entityId: 'entity-a',
        oldName: 'Lin Lab',
        newName: 'Haifan Lin Lab',
        newDisplayName: 'Haifan Lin Lab',
      }),
      expect.objectContaining({
        entityId: 'entity-b',
        oldName: 'Lin Lab',
        newName: 'Haiqun Lin Lab',
        newDisplayName: 'Haiqun Lin Lab',
      }),
    ]);
  });

  it('skips a cluster unless every row can be safely disambiguated', () => {
    const result = buildSurnameLabDisambiguationPlans({
      entities: [
        { id: 'entity-a', name: 'Miller Lab' },
        { id: 'entity-b', name: 'Miller Lab' },
      ],
      members: [{ researchEntityId: 'entity-a', userId: 'user-a', role: 'pi' }],
      users: [{ id: 'user-a', fname: 'George', lname: 'Miller' }],
      existingActiveNames: ['Miller Lab', 'Miller Lab'],
    });

    expect(result.plans).toHaveLength(0);
    expect(result.skipped.map((row) => row.reason)).toContain('missing_exact_pi_user');
    expect(result.skipped.map((row) => row.reason)).toContain('cluster_not_fully_disambiguated');
  });

  it('skips proposed names that already collide with an existing entity', () => {
    const result = buildSurnameLabDisambiguationPlans({
      entities: [
        { id: 'entity-a', name: 'Zhu Lab' },
        { id: 'entity-b', name: 'Zhu Lab' },
      ],
      members: [
        { researchEntityId: 'entity-a', userId: 'user-a', role: 'pi' },
        { researchEntityId: 'entity-b', userId: 'user-b', role: 'pi' },
      ],
      users: [
        { id: 'user-a', fname: 'Yong', lname: 'Zhu' },
        { id: 'user-b', fname: 'Tianyu', lname: 'Zhu' },
      ],
      existingActiveNames: ['Zhu Lab', 'Zhu Lab', 'Yong Zhu Lab'],
    });

    expect(result.plans).toHaveLength(0);
    expect(result.skipped.map((row) => row.reason)).toContain(
      'proposed_name_collides_with_existing_entity',
    );
  });
});
