import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { assertRepairFusedIdentityArtifactsApplyAllowed } from '../repairFusedIdentityArtifacts';
import {
  buildFusedIdentityArtifactPlan,
  isFusedNetid,
  parseRepairFusedIdentityArtifactsArgs,
} from '../repairFusedIdentityArtifactsCore';

const NO_ACCOUNTS = new Set<string>();

describe('repair fused identity artifacts core', () => {
  it('archives a fused-netid roster artifact whose email belongs to another active person', () => {
    const summary = buildFusedIdentityArtifactPlan({
      users: [
        {
          id: 'fused',
          netid: 'parker.lane.pl1234',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
        {
          id: 'owner',
          netid: 'sage.avery',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['fused', 'sage.avery@yale.edu'],
        ['owner', 'sage.avery@yale.edu'],
      ]),
      netidsWithLoginAccounts: NO_ACCOUNTS,
    });

    expect(summary).toMatchObject({
      candidateUsers: 1,
      archivableUsers: 1,
      skippedUsers: 0,
    });
    expect(summary.archives).toEqual([
      {
        userId: 'fused',
        name: 'Sage Avery',
        netid: 'parker.lane.pl1234',
        email: 'sage.avery@yale.edu',
        canonicalUserId: 'owner',
        reason: 'fused-identity-conflation',
      },
    ]);
  });

  it('leaves a benign dotted netid that matches its own email untouched', () => {
    const summary = buildFusedIdentityArtifactPlan({
      users: [
        {
          id: 'benign',
          netid: 'robin.morgan',
          fname: 'Robin',
          lname: 'Morgan',
          email: 'robin.morgan@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([['benign', 'robin.morgan@yale.edu']]),
      netidsWithLoginAccounts: NO_ACCOUNTS,
    });

    expect(summary).toMatchObject({ candidateUsers: 0, archivableUsers: 0, skippedUsers: 0 });
  });

  it('keeps a fused artifact whose netid segments overlap its own email out of scope', () => {
    const summary = buildFusedIdentityArtifactPlan({
      users: [
        {
          id: 'selfmatch',
          netid: 'sage.avery.sa2200',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
        {
          id: 'owner',
          netid: 'sage.avery',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['selfmatch', 'sage.avery@yale.edu'],
        ['owner', 'sage.avery@yale.edu'],
      ]),
      netidsWithLoginAccounts: NO_ACCOUNTS,
    });

    expect(summary.archives).toEqual([]);
    expect(summary.candidateUsers).toBe(0);
  });

  it('skips a fused artifact when no other active user owns the contaminating email', () => {
    const summary = buildFusedIdentityArtifactPlan({
      users: [
        {
          id: 'fused',
          netid: 'parker.lane.pl1234',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([['fused', 'sage.avery@yale.edu']]),
      netidsWithLoginAccounts: NO_ACCOUNTS,
    });

    expect(summary.archives).toEqual([]);
    expect(summary.skipped).toEqual([
      {
        userId: 'fused',
        name: 'Sage Avery',
        netid: 'parker.lane.pl1234',
        email: 'sage.avery@yale.edu',
        reason: 'no-canonical-email-owner',
      },
    ]);
  });

  it('never archives a login-capable fused netid even when a canonical email owner exists', () => {
    const summary = buildFusedIdentityArtifactPlan({
      users: [
        {
          id: 'fused',
          netid: 'parker.lane.pl1234',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
        {
          id: 'owner',
          netid: 'sage.avery',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@yale.edu',
        },
      ],
      activeEmailsByUserId: new Map([
        ['fused', 'sage.avery@yale.edu'],
        ['owner', 'sage.avery@yale.edu'],
      ]),
      netidsWithLoginAccounts: new Set(['parker.lane.pl1234']),
    });

    expect(summary.archives).toEqual([]);
    expect(summary.skipped).toEqual([
      {
        userId: 'fused',
        name: 'Sage Avery',
        netid: 'parker.lane.pl1234',
        email: 'sage.avery@yale.edu',
        reason: 'login-capable-account-present',
      },
    ]);
  });

  it('ignores non-yale contaminating emails', () => {
    const summary = buildFusedIdentityArtifactPlan({
      users: [
        {
          id: 'fused',
          netid: 'parker.lane.pl1234',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@example.com',
        },
        {
          id: 'owner',
          netid: 'sa99',
          fname: 'Sage',
          lname: 'Avery',
          email: 'sage.avery@example.com',
        },
      ],
      activeEmailsByUserId: new Map([
        ['fused', 'sage.avery@example.com'],
        ['owner', 'sage.avery@example.com'],
      ]),
      netidsWithLoginAccounts: NO_ACCOUNTS,
    });

    expect(summary.candidateUsers).toBe(0);
  });

  it('recognizes the fused name.name.realnetid shape and rejects clean netids', () => {
    expect(isFusedNetid('parker.lane.pl1234')).toBe(true);
    expect(isFusedNetid('robin.morgan')).toBe(false);
    expect(isFusedNetid('pl1234')).toBe(false);
    expect(isFusedNetid('sage.avery')).toBe(false);
  });

  it('parses guarded apply arguments', () => {
    const outPath = path.join(os.tmpdir(), 'fused-identity-out.json');
    expect(
      parseRepairFusedIdentityArtifactsArgs([
        '--limit=20000',
        '--max-apply',
        '5',
        '--apply',
        '--confirm-fused-identity-archive',
        `--output=${outPath}`,
      ]),
    ).toEqual({
      apply: true,
      confirmFusedIdentityArchive: true,
      limit: 20000,
      limitProvided: true,
      maxApply: 5,
      output: outPath,
    });
  });

  it('rejects non-literal integer bounds and unsafe output paths', () => {
    expect(() => parseRepairFusedIdentityArtifactsArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseRepairFusedIdentityArtifactsArgs(['--max-apply=1e3'])).toThrow(
      '--max-apply must be a positive integer',
    );
    expect(() =>
      parseRepairFusedIdentityArtifactsArgs(['--output=/etc/fused-identity.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseRepairFusedIdentityArtifactsArgs([`--output=${path.join(os.tmpdir(), 'fused-identity.txt')}`]),
    ).toThrow(/--output must point to a \.json report file/);
  });
});

describe('repair fused identity artifacts apply guard', () => {
  it('requires confirmation, limit, and max apply in apply mode', () => {
    expect(() =>
      assertRepairFusedIdentityArtifactsApplyAllowed({
        apply: true,
        confirmFusedIdentityArchive: false,
        limit: 100,
        limitProvided: true,
        maxApply: 1,
      }),
    ).toThrow('--confirm-fused-identity-archive is required');

    expect(() =>
      assertRepairFusedIdentityArtifactsApplyAllowed({
        apply: true,
        confirmFusedIdentityArchive: true,
        limit: 100,
        limitProvided: false,
        maxApply: 1,
      }),
    ).toThrow('--limit is required');

    expect(() =>
      assertRepairFusedIdentityArtifactsApplyAllowed({
        apply: true,
        confirmFusedIdentityArchive: true,
        limit: 100,
        limitProvided: true,
      }),
    ).toThrow('--max-apply is required');
  });

  it('rejects an apply batch larger than the max-apply ceiling', () => {
    expect(() =>
      assertRepairFusedIdentityArtifactsApplyAllowed(
        {
          apply: true,
          confirmFusedIdentityArchive: true,
          limit: 100,
          limitProvided: true,
          maxApply: 1,
        },
        process.env,
        undefined,
        2,
      ),
    ).toThrow('above --max-apply');
  });
});
