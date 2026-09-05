import { describe, expect, it } from 'vitest';

import {
  classifyYsmLabIndexSignal,
  decideYsmLabDelisting,
  isYsmLabIndexAuthoritative,
  labSlugFromMicrositeUrl,
  normalizeLabSlug,
  passesYsmLabIndexDropGuard,
  snapshotDiscoveredLabSlugs,
  YSM_LAB_INDEX_DROP_GUARD_MIN_FRACTION,
} from '../ysmLabDelistingReconciler';

describe('normalizeLabSlug / labSlugFromMicrositeUrl', () => {
  it('folds the casing and separator drift that produced false delistings (#2511)', () => {
    expect(normalizeLabSlug('Pitt')).toBe('pitt');
    expect(normalizeLabSlug('colon_ramos')).toBe('colon-ramos');
    expect(normalizeLabSlug('jun_liu')).toBe('jun-liu');
    expect(normalizeLabSlug('  Mixed_Case/  ')).toBe('mixed-case');
  });

  it('extracts and normalizes the slug from a stored microsite url', () => {
    expect(labSlugFromMicrositeUrl('https://medicine.example.edu/lab/Pitt')).toBe('pitt');
    expect(labSlugFromMicrositeUrl('https://medicine.example.edu/lab/colon_ramos/')).toBe(
      'colon-ramos',
    );
    expect(labSlugFromMicrositeUrl('https://medicine.example.edu/lab/koff/pubs/')).toBe('koff');
    expect(labSlugFromMicrositeUrl('https://medicine.example.edu/profile/sample-person/')).toBe('');
    expect(labSlugFromMicrositeUrl(undefined)).toBe('');
  });

  it('matches a normalized index slug that a raw comparison would call delisted', () => {
    const indexed = new Set(['pitt', 'colon-ramos', 'jun-liu']);
    for (const stored of ['lab/Pitt', 'lab/colon_ramos', 'lab/jun_liu']) {
      expect(indexed.has(labSlugFromMicrositeUrl(`https://medicine.example.edu/${stored}`))).toBe(
        true,
      );
    }
  });
});

describe('isYsmLabIndexAuthoritative / snapshotDiscoveredLabSlugs', () => {
  it('requires an explicitly complete snapshot carrying a slug array', () => {
    expect(isYsmLabIndexAuthoritative({ complete: true, discoveredLabSlugs: [] })).toBe(true);
    expect(isYsmLabIndexAuthoritative({ complete: false, discoveredLabSlugs: [] })).toBe(false);
    expect(isYsmLabIndexAuthoritative({ complete: true })).toBe(false);
    expect(isYsmLabIndexAuthoritative({})).toBe(false);
  });

  it('normalizes and drops non-string slugs', () => {
    expect(
      snapshotDiscoveredLabSlugs({ discoveredLabSlugs: ['Pitt', 'colon_ramos', 7, '', null] }),
    ).toEqual(['pitt', 'colon-ramos']);
  });
});

describe('passesYsmLabIndexDropGuard', () => {
  it('passes at the measured healthy ratio and fails a collapsed index', () => {
    expect(passesYsmLabIndexDropGuard(261, 400)).toBe(true);
    expect(passesYsmLabIndexDropGuard(12, 400)).toBe(false);
    expect(passesYsmLabIndexDropGuard(0, 400)).toBe(false);
  });

  it('passes a zero governed set rather than freezing, since nothing can be acted on', () => {
    expect(passesYsmLabIndexDropGuard(0, 0)).toBe(true);
  });

  it('uses a half-of-governed floor by default', () => {
    expect(YSM_LAB_INDEX_DROP_GUARD_MIN_FRACTION).toBe(0.5);
    expect(passesYsmLabIndexDropGuard(200, 400)).toBe(true);
    expect(passesYsmLabIndexDropGuard(199, 400)).toBe(false);
  });
});

describe('classifyYsmLabIndexSignal', () => {
  const discoveredLabSlugs = new Set(['koff', 'pitt']);

  it('is inconclusive when the index is not authoritative or the guard failed', () => {
    expect(
      classifyYsmLabIndexSignal({
        indexAuthoritative: false,
        dropGuardPassed: true,
        discoveredLabSlugs,
        labSlug: 'gone',
      }),
    ).toBe('inconclusive');
    expect(
      classifyYsmLabIndexSignal({
        indexAuthoritative: true,
        dropGuardPassed: false,
        discoveredLabSlugs,
        labSlug: 'gone',
      }),
    ).toBe('inconclusive');
  });

  it('is inconclusive for an entity with no resolvable lab slug', () => {
    expect(
      classifyYsmLabIndexSignal({
        indexAuthoritative: true,
        dropGuardPassed: true,
        discoveredLabSlugs,
        labSlug: '',
      }),
    ).toBe('inconclusive');
  });

  it('reports present and absent against the discovered set', () => {
    expect(
      classifyYsmLabIndexSignal({
        indexAuthoritative: true,
        dropGuardPassed: true,
        discoveredLabSlugs,
        labSlug: 'koff',
      }),
    ).toBe('present');
    expect(
      classifyYsmLabIndexSignal({
        indexAuthoritative: true,
        dropGuardPassed: true,
        discoveredLabSlugs,
        labSlug: 'delacruz',
      }),
    ).toBe('absent');
  });
});

describe('decideYsmLabDelisting', () => {
  const base = { labSlug: 'delacruz' };

  it('does nothing on an inconclusive signal or a missing run id', () => {
    expect(
      decideYsmLabDelisting({ signal: 'inconclusive', currentRunId: 'run-2', entity: base }).action,
    ).toBe('noop');
    expect(decideYsmLabDelisting({ signal: 'absent', currentRunId: '', entity: base }).action).toBe(
      'noop',
    );
  });

  it('records the first absence rather than suppressing on one run', () => {
    const decision = decideYsmLabDelisting({
      signal: 'absent',
      currentRunId: 'run-1',
      entity: { ...base, micrositeDead: true },
    });
    expect(decision.action).toBe('record_first_absence');
    expect(decision.set).toEqual({ absentFromIndexSinceRunId: 'run-1' });
  });

  it('does not suppress twice within the same run', () => {
    expect(
      decideYsmLabDelisting({
        signal: 'absent',
        currentRunId: 'run-1',
        entity: { ...base, absentFromIndexSinceRunId: 'run-1', micrositeDead: true },
      }).action,
    ).toBe('noop');
  });

  it('suppresses only when a second run confirms absence AND the microsite is gone', () => {
    const decision = decideYsmLabDelisting({
      signal: 'absent',
      currentRunId: 'run-2',
      entity: { ...base, absentFromIndexSinceRunId: 'run-1', micrositeDead: true },
    });
    expect(decision.action).toBe('suppress_permanently_closed');
    expect(decision.set).toEqual({ studentVisibilitySuppressionReason: 'permanently_closed' });
  });

  it('holds when the index says absent but the microsite is still reachable', () => {
    expect(
      decideYsmLabDelisting({
        signal: 'absent',
        currentRunId: 'run-2',
        entity: { ...base, absentFromIndexSinceRunId: 'run-1', micrositeDead: false },
      }).action,
    ).toBe('noop');
  });

  it('does not rewrite an already recorded closure', () => {
    expect(
      decideYsmLabDelisting({
        signal: 'absent',
        currentRunId: 'run-2',
        entity: {
          ...base,
          absentFromIndexSinceRunId: 'run-1',
          micrositeDead: true,
          hasRecordedClosure: true,
        },
      }).action,
    ).toBe('noop');
  });

  it('clears a pending absence when the lab reappears, so a blip cannot accumulate', () => {
    const decision = decideYsmLabDelisting({
      signal: 'present',
      currentRunId: 'run-2',
      entity: { ...base, absentFromIndexSinceRunId: 'run-1' },
    });
    expect(decision.action).toBe('clear_absence');
    expect(decision.set).toEqual({ absentFromIndexSinceRunId: '' });
  });

  it('is a noop for a present lab with no pending absence', () => {
    expect(
      decideYsmLabDelisting({ signal: 'present', currentRunId: 'run-2', entity: base }).action,
    ).toBe('noop');
  });
});
