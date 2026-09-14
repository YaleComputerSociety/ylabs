import { describe, expect, it } from 'vitest';
import {
  classifyLabNameInProse,
  labNameFromProse,
  planLabNameInProseAudit,
  proseNameAppearsOnPage,
  summarizeLabNameInProseAudit,
  withSharedBrandsWithheld,
  type LabNameProseCandidate,
} from '../labNameInSourceProseAuditCore';

const candidate = (overrides: Partial<LabNameProseCandidate> = {}): LabNameProseCandidate => ({
  slug: 'dept-example-a-researcher',
  lane: 'lab-microsite-description-llm',
  prose: 'The Example Lab studies visual cognition using probabilistic programs.',
  sourceUrl: 'https://example-lab.example.org/',
  pageText: 'Welcome to the Example Lab. People. Publications. Join us.',
  hasWebsiteUrl: true,
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

describe('labNameFromProse', () => {
  it('reads a proper lab name out of a sentence', () => {
    expect(labNameFromProse('The Example Lab studies X.')).toBe('The Example Lab');
    expect(labNameFromProse('Work in the Human Language Dynamics Lab covers Y.')).toBe(
      'Human Language Dynamics Lab',
    );
    expect(labNameFromProse('The Example Research Group builds Z.')).toBe(
      'The Example Research Group',
    );
  });

  it('finds nothing in prose that names no lab', () => {
    expect(labNameFromProse('Studies immune mechanisms and tumor biology.')).toBe('');
    expect(labNameFromProse('our lab studies inflammation')).toBe('');
    expect(labNameFromProse(undefined)).toBe('');
  });
});

describe('proseNameAppearsOnPage', () => {
  it('accepts the name verbatim and the distinctive part near a head noun', () => {
    expect(proseNameAppearsOnPage('The Prober Lab', 'the prober laboratory investigates')).toBe(
      true,
    );
    expect(proseNameAppearsOnPage('The Example Lab', 'Welcome to the Example Lab')).toBe(true);
  });

  it('rejects a name the page never carries', () => {
    expect(
      proseNameAppearsOnPage('The Example Lab', 'Publications. Teaching. Curriculum vitae.'),
    ).toBe(false);
    expect(proseNameAppearsOnPage('The Example Lab', '')).toBe(false);
    expect(proseNameAppearsOnPage('', 'anything')).toBe(false);
  });

  it('does not let a two-character stem match everything', () => {
    expect(proseNameAppearsOnPage('Yu Lab', 'the group studies materials')).toBe(false);
  });
});

describe('classifyLabNameInProse', () => {
  it('sends a grounded, laboratory-shaped name to review', () => {
    const row = classifyLabNameInProse(candidate());
    expect(row.verdict).toBe('review');
    expect(row.proposedName).toBe('The Example Lab');
  });

  it('refuses a name the page never carries, which is the model coining it', () => {
    const row = classifyLabNameInProse(
      candidate({ pageText: 'Publications. Research interests. Teaching. Curriculum vitae.' }),
    );
    expect(row.verdict).toBe('coined_not_on_page');
  });

  it('refuses prose from a lane that reads no page', () => {
    expect(
      classifyLabNameInProse(candidate({ lane: 'fra-profile-research-synthesis' })).verdict,
    ).toBe('coined_not_on_page');
  });

  it('refuses another institution laboratory', () => {
    const row = classifyLabNameInProse(
      candidate({
        prose: 'He collaborates with the Brookhaven National Laboratory on detector design.',
        pageText: 'work with the Brookhaven National Laboratory on detectors',
      }),
    );
    expect(row.verdict).toBe('other_institution');
  });

  it('refuses a diagnostic service a clinician merely directs', () => {
    for (const name of [
      'Cytology Laboratory',
      'Molecular Diagnostics Laboratory',
      'Clinical Virology Laboratory',
    ]) {
      const row = classifyLabNameInProse(
        candidate({
          prose: `She directs the ${name} for the health system.`,
          pageText: `directs the ${name}`,
        }),
      );
      expect(row.verdict, name).toBe('service_facility');
    }
  });

  it('never proposes a service that carries no laboratory head noun in the first place', () => {
    for (const name of [
      'Hematology Tissue Bank',
      'Yale Autopsy Service',
      'Keck Proteomics Resource',
    ]) {
      const row = classifyLabNameInProse(
        candidate({ prose: `She directs the ${name}.`, pageText: `directs the ${name}` }),
      );
      expect(row.verdict, name).toBe('not_a_laboratory');
      expect(row.proposedName, name).toBeUndefined();
    }
  });

  it('refuses a name that identifies nothing', () => {
    const row = classifyLabNameInProse(
      candidate({
        prose: 'The Research Lab supports the department.',
        pageText: 'The Research Lab',
      }),
    );
    expect(row.verdict).toBe('generic_name');
  });

  it('holds a row whose page could not be read rather than guessing', () => {
    expect(classifyLabNameInProse(candidate({ pageText: '' })).verdict).toBe('page_unreadable');
    expect(classifyLabNameInProse(candidate({ pageText: undefined })).verdict).toBe(
      'page_unreadable',
    );
  });

  it('carries the row context through so a reviewer can see reach and tier', () => {
    const row = classifyLabNameInProse(
      candidate({ hasWebsiteUrl: false, studentVisibilityTier: 'suppressed' }),
    );
    expect(row.hasWebsiteUrl).toBe(false);
    expect(row.studentVisibilityTier).toBe('suppressed');
  });
});

describe('withSharedBrandsWithheld', () => {
  it('withholds both rows when two of them claim the same lab', () => {
    const rows = planLabNameInProseAudit([
      candidate({ slug: 'a' }),
      candidate({ slug: 'b' }),
      candidate({ slug: 'c', prose: 'The Distinct Lab studies X.', pageText: 'The Distinct Lab' }),
    ]);
    expect(
      rows
        .filter((r) => r.verdict === 'shared_brand')
        .map((r) => r.slug)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(rows.find((r) => r.slug === 'c')?.verdict).toBe('review');
  });

  it('compares brands case-insensitively', () => {
    const rows = withSharedBrandsWithheld([
      {
        slug: 'a',
        verdict: 'review',
        lane: 'l',
        proposedName: 'The Example Lab',
        sourceUrl: 'u',
        hasWebsiteUrl: true,
      },
      {
        slug: 'b',
        verdict: 'review',
        lane: 'l',
        proposedName: 'the example lab',
        sourceUrl: 'u',
        hasWebsiteUrl: true,
      },
    ]);
    expect(rows.every((r) => r.verdict === 'shared_brand')).toBe(true);
  });
});

describe('summarizeLabNameInProseAudit', () => {
  it('accounts for every row exactly once', () => {
    const rows = planLabNameInProseAudit([
      candidate({ slug: 'a' }),
      candidate({ slug: 'b', pageText: 'nothing relevant here' }),
      candidate({ slug: 'c', lane: 'fra-profile-research-synthesis' }),
    ]);
    const summary = summarizeLabNameInProseAudit(rows);
    expect(summary.review).toBe(1);
    expect(summary.coined_not_on_page).toBe(2);
    expect(Object.values(summary).reduce((total, count) => total + count, 0)).toBe(rows.length);
  });
});
