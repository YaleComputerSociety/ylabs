import { describe, expect, it } from 'vitest';
import { stripProvenanceHedge } from '../provenanceHedge';

describe('stripProvenanceHedge', () => {
  it('drops a trailing "when source-confirmed" hedge', () => {
    expect(stripProvenanceHedge('$17/hour when source-confirmed')).toBe('$17/hour');
    expect(stripProvenanceHedge('Stipend plus housing/board when source-confirmed')).toBe(
      'Stipend plus housing/board',
    );
    expect(
      stripProvenanceHedge('Academic-year and summer research support when source-confirmed'),
    ).toBe('Academic-year and summer research support');
  });

  it('tolerates separator and casing variants', () => {
    expect(stripProvenanceHedge('Paid internship, when source confirmed.')).toBe('Paid internship');
    expect(stripProvenanceHedge('Summer stipend When Source-Confirmed')).toBe('Summer stipend');
  });

  it('leaves copy without the hedge untouched', () => {
    expect(stripProvenanceHedge('Stipend available')).toBe('Stipend available');
    expect(stripProvenanceHedge('$17/hour')).toBe('$17/hour');
  });
});
