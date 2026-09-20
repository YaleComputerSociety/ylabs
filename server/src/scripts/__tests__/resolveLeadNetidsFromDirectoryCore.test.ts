import { describe, expect, it } from 'vitest';
import {
  indexNetidByEmail,
  netidFromObservationKey,
  planLeadNetidResolution,
  summarizeRefusals,
  type DirectoryPerson,
  type NetidlessLead,
} from '../resolveLeadNetidsFromDirectoryCore';

const DIRECTORY: DirectoryPerson[] = [
  { netid: 'abc12', email: 'Sample.Person@yale.edu' },
  { netid: 'def34', email: 'other.person@yale.edu' },
];

const lead = (over: Partial<NetidlessLead> = {}): NetidlessLead => ({
  researcherId: '000000000000000000000001',
  profileUrls: ['https://example.yale.edu/profile/sample/'],
  emailEvidence: [
    {
      email: 'sample.person@yale.edu',
      sourceUrl: 'https://example.yale.edu/profile/sample/',
      entityKey: 'dept-example-sample-person',
    },
  ],
  ...over,
});

describe('indexNetidByEmail', () => {
  it('lowercases the email so directory casing does not matter', () => {
    const index = indexNetidByEmail(DIRECTORY);
    expect([...(index.get('sample.person@yale.edu') ?? [])]).toEqual(['abc12']);
  });

  it('skips rows missing either identifier', () => {
    const index = indexNetidByEmail([
      { netid: 'x1', email: '' },
      { netid: '', email: 'a@yale.edu' },
    ]);
    expect(index.size).toBe(0);
  });

  it('keeps both netids when one email serves two directory rows', () => {
    const index = indexNetidByEmail([
      { netid: 'aa11', email: 'shared@yale.edu' },
      { netid: 'bb22', email: 'shared@yale.edu' },
    ]);
    expect((index.get('shared@yale.edu') ?? new Set()).size).toBe(2);
  });
});

describe('netidFromObservationKey', () => {
  it('extracts a netid key', () => {
    expect(netidFromObservationKey('netid:ABC12')).toBe('abc12');
  });

  it('returns empty for a slug key', () => {
    expect(netidFromObservationKey('ysm-sample-person')).toBe('');
  });
});

describe('planLeadNetidResolution', () => {
  const index = indexNetidByEmail(DIRECTORY);

  it('resolves a lead whose stored url asserts an email the directory knows', () => {
    const result = planLeadNetidResolution([lead()], index);
    expect(result.planned).toEqual([
      { researcherId: '000000000000000000000001', netid: 'abc12', tier: 'email-and-slug-key' },
    ]);
  });

  it('marks the stronger tier when the evidence is already keyed to the same netid', () => {
    const result = planLeadNetidResolution(
      [
        lead({
          emailEvidence: [
            {
              email: 'sample.person@yale.edu',
              sourceUrl: 'https://example.yale.edu/profile/sample/',
              entityKey: 'netid:abc12',
            },
          ],
        }),
      ],
      index,
    );
    expect(result.planned[0].tier).toBe('email-and-matching-netid-key');
  });

  it('refuses when the evidence is keyed to a different netid, the borrowed-url case', () => {
    const result = planLeadNetidResolution(
      [
        lead({
          emailEvidence: [
            {
              email: 'sample.person@yale.edu',
              sourceUrl: 'https://example.yale.edu/profile/sample/',
              entityKey: 'netid:zz99',
            },
          ],
        }),
      ],
      index,
    );
    expect(result.planned).toEqual([]);
    expect(result.refused[0].reason).toBe('evidence-keyed-to-other-netid');
  });

  it('refuses when two directory rows share the asserted email', () => {
    const ambiguous = indexNetidByEmail([
      { netid: 'aa11', email: 'sample.person@yale.edu' },
      { netid: 'bb22', email: 'sample.person@yale.edu' },
    ]);
    const result = planLeadNetidResolution([lead()], ambiguous);
    expect(result.refused[0].reason).toBe('ambiguous-email-match');
  });

  it('refuses a netid another researcher already holds instead of duplicating identity', () => {
    const result = planLeadNetidResolution([lead()], index, new Set(['abc12']));
    expect(result.refused[0].reason).toBe('netid-already-held');
  });

  it('never writes one netid onto two researchers in a batch', () => {
    const result = planLeadNetidResolution(
      [lead(), lead({ researcherId: '000000000000000000000002' })],
      index,
    );
    expect(result.planned).toHaveLength(1);
    expect(result.refused[0].reason).toBe('duplicate-netid-in-batch');
  });

  it('refuses a lead storing no profile url', () => {
    const result = planLeadNetidResolution([lead({ profileUrls: [] })], index);
    expect(result.refused[0].reason).toBe('no-profile-url');
  });

  it('refuses a lead with no email evidence', () => {
    const result = planLeadNetidResolution([lead({ emailEvidence: [] })], index);
    expect(result.refused[0].reason).toBe('no-email-evidence');
  });

  it('refuses an email the directory does not carry', () => {
    const result = planLeadNetidResolution(
      [
        lead({
          emailEvidence: [
            {
              email: 'absent@yale.edu',
              sourceUrl: 'https://example.yale.edu/profile/sample/',
              entityKey: 'dept-x',
            },
          ],
        }),
      ],
      index,
    );
    expect(result.refused[0].reason).toBe('email-not-in-directory');
  });

  it('ignores an evidence entry whose email is malformed', () => {
    const result = planLeadNetidResolution(
      [
        lead({
          emailEvidence: [
            {
              email: 'not-an-email',
              sourceUrl: 'https://example.yale.edu/profile/sample/',
              entityKey: 'dept-x',
            },
          ],
        }),
      ],
      index,
    );
    expect(result.refused[0].reason).toBe('no-email-evidence');
  });

  it('does not consult names at all, so a name mismatch still resolves', () => {
    const result = planLeadNetidResolution([lead()], index);
    expect(result.planned[0].netid).toBe('abc12');
  });
});

describe('summarizeRefusals', () => {
  it('reports every reason including zeros', () => {
    const counts = summarizeRefusals([
      { researcherId: 'a', reason: 'email-not-in-directory' },
      { researcherId: 'b', reason: 'email-not-in-directory' },
    ]);
    expect(counts['email-not-in-directory']).toBe(2);
    expect(counts['netid-already-held']).toBe(0);
  });
});
