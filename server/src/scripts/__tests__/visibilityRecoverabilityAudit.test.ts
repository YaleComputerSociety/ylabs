import { describe, it, expect } from 'vitest';
import {
  DECISION_BLOCKERS,
  buildRecoverabilityReport,
  classifyBlocker,
  classifyRecoverability,
} from '../visibilityRecoverabilityAuditCore';

const record = (over: Partial<Parameters<typeof classifyRecoverability>[0]> = {}) => ({
  recordId: 'r1',
  slug: 'dept-example-jordan-rivers',
  blockers: [] as string[],
  gated: false,
  populatedFields: new Set<string>(),
  observedFields: new Set<string>(),
  citableSourceUrls: [] as string[],
  ...over,
});

describe('classifyBlocker', () => {
  it('calls a stored-but-unmaterialized field materializable', () => {
    expect(
      classifyBlocker('missing_card_description', {
        observedFields: new Set(['shortDescription']),
        populatedFields: new Set(),
        citableSourceUrls: [],
      }),
    ).toBe('materialize');
  });

  // A `thin_description` row HAS a description; materializing the observation the text
  // came from re-writes the same thin prose and clears nothing, so counting it as
  // repair-queue-addressable overstates exactly the population this audit measures.
  it('does not call a field the document already carries materializable', () => {
    expect(
      classifyBlocker('thin_description', {
        observedFields: new Set(['fullDescription']),
        populatedFields: new Set(['fullDescription']),
        citableSourceUrls: ['https://medicine.example.edu/lab/rivers/'],
      }),
    ).toBe('acquire');
  });

  it('still materializes when one blocked field is stored and another is already populated', () => {
    expect(
      classifyBlocker('missing_card_description', {
        observedFields: new Set(['shortDescription', 'fullDescription']),
        populatedFields: new Set(['fullDescription']),
        citableSourceUrls: [],
      }),
    ).toBe('materialize');
  });

  it('falls to acquire when no observation carries it but a source remains', () => {
    expect(
      classifyBlocker('missing_card_description', {
        observedFields: new Set(),
        populatedFields: new Set(),
        citableSourceUrls: ['https://medicine.example.edu/lab/rivers/'],
      }),
    ).toBe('acquire');
  });

  it('is ceiling with neither an observation nor a source', () => {
    expect(
      classifyBlocker('missing_card_description', {
        observedFields: new Set(),
        populatedFields: new Set(),
        citableSourceUrls: [],
      }),
    ).toBe('ceiling');
  });

  it('treats a decision blocker as ceiling however much evidence exists', () => {
    for (const blocker of DECISION_BLOCKERS) {
      expect(
        classifyBlocker(blocker, {
          observedFields: new Set(['shortDescription', 'fullDescription']),
          populatedFields: new Set(['shortDescription']),
          citableSourceUrls: ['https://medicine.example.edu/lab/rivers/'],
        }),
        blocker,
      ).toBe('ceiling');
    }
  });

  // An audit that silently counts what it does not model as recoverable would
  // overstate the promotable population, which is the failure this instrument exists
  // to prevent. So an unmapped blocker must land in the pessimistic bucket.
  it('counts an unmodelled blocker as ceiling rather than recoverable', () => {
    expect(
      classifyBlocker('some_blocker_added_later', {
        observedFields: new Set(['shortDescription']),
        populatedFields: new Set(),
        citableSourceUrls: ['https://medicine.example.edu/lab/rivers/'],
      }),
    ).toBe('ceiling');
  });
});

describe('classifyRecoverability', () => {
  // A row is only as promotable as its worst blocker: clearing a description gap does
  // not publish a duplicate. Reporting the best bucket is what would make a repair
  // lane look more valuable than it is.
  it('takes the WORST bucket across blockers, not the best', () => {
    const verdict = classifyRecoverability(
      record({
        blockers: ['missing_card_description', 'duplicate_risk'],
        observedFields: new Set(['shortDescription']),
      }),
    );
    expect(verdict.bucket).toBe('ceiling');
    expect(verdict.decidingBlocker).toBe('duplicate_risk');
    expect(verdict.residualBlockers).toEqual(['duplicate_risk']);
  });

  it('reports acquire when one blocker needs fetching and another is already stored', () => {
    const verdict = classifyRecoverability(
      record({
        blockers: ['missing_card_description', 'missing_lead'],
        observedFields: new Set(['shortDescription']),
        citableSourceUrls: ['https://medicine.example.edu/profile/jordan-rivers/'],
      }),
    );
    expect(verdict.bucket).toBe('acquire');
    expect(verdict.decidingBlocker).toBe('missing_lead');
  });

  // Separate from `materialize` on purpose: a gate dry-run over Development's 559
  // never-gated rows promoted 6 and held 553, so folding these in overstated the
  // recoverable population by roughly 50%.
  it('puts a never-gated row in its own bucket rather than calling it materializable', () => {
    const verdict = classifyRecoverability(record({ blockers: [], gated: false }));
    expect(verdict.bucket).toBe('regate');
    expect(verdict.decidingBlocker).toBe('never_gated');
  });

  // A gated row can be held entirely by reasons outside the modelled blocker taxonomy
  // (a non-blocking correctness reason plus a soft signal). Calling that "gate never
  // ran" claims a cheap re-gate would move it, when the gate already ran and held it.
  it('does not call a gated row with no modelled blocker never-gated', () => {
    const verdict = classifyRecoverability(record({ blockers: [], gated: true }));
    expect(verdict.bucket).toBe('ceiling');
    expect(verdict.decidingBlocker).toBe('held_without_modelled_blocker');
  });
});

describe('buildRecoverabilityReport', () => {
  it('counts each row once per bucket and attributes it to every blocker it carries', () => {
    const verdicts = [
      classifyRecoverability(
        record({ recordId: 'a', blockers: ['duplicate_risk', 'thin_description'] }),
      ),
      classifyRecoverability(
        record({
          recordId: 'b',
          blockers: ['thin_description'],
          observedFields: new Set(['fullDescription']),
        }),
      ),
      classifyRecoverability(record({ recordId: 'c', blockers: [] })),
    ];
    const report = buildRecoverabilityReport(
      verdicts,
      new Map([
        ['a', ['duplicate_risk', 'thin_description']],
        ['b', ['thin_description']],
        ['c', []],
      ]),
    );

    expect(report.withheld).toBe(3);
    expect(report.byBucket).toEqual({ regate: 1, materialize: 1, acquire: 0, ceiling: 1 });
    // 'a' is ceiling but carries a real description gap alongside its duplicate risk, so
    // it is NOT part of the decision-only floor even though it is part of the ceiling.
    expect(report.decisionOnlyRows).toBe(0);

    const thin = report.byBlocker.find((row) => row.blocker === 'thin_description');
    expect(thin).toMatchObject({ rows: 2, materialize: 1, ceiling: 1 });
    expect(thin).not.toHaveProperty('regate');
    // 'c' carries no blocker, so it contributes to no blocker row while still
    // counting once in byBucket - the two totals are not meant to reconcile.
    expect(report.byBlocker.some((row) => row.blocker === 'never_gated')).toBe(false);
  });

  it('counts a row whose every blocker is a decision as decision-only', () => {
    const verdicts = [
      classifyRecoverability(
        record({ recordId: 'a', blockers: ['duplicate_risk', 'permanently_closed'] }),
      ),
      classifyRecoverability(record({ recordId: 'b', blockers: ['thin_description'] })),
    ];
    const report = buildRecoverabilityReport(
      verdicts,
      new Map([
        ['a', ['duplicate_risk', 'permanently_closed']],
        ['b', ['thin_description']],
      ]),
    );

    expect(report.byBucket.ceiling).toBe(2);
    expect(report.decisionOnlyRows).toBe(1);
  });
});
