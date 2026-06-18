import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildExistingMemberMatchQuery,
  buildOrphanMemberUserReferencePipeline,
  normalizeMemberReferenceObjectId,
  writeResearchEntityMemberReferenceAuditOutput,
} from '../researchEntityMemberReferenceAudit';
import {
  assertResearchEntityMemberReferenceApplyAllowed,
  assertResearchEntityMemberReferenceTargetAllowed,
  buildResearchEntityMemberReferenceAuditOutput,
  buildResearchEntityMemberReferenceAuditSummary,
  inferMemberReferenceNames,
  parseResearchEntityMemberReferenceAuditArgs,
} from '../researchEntityMemberReferenceAuditCore';

describe('research entity member reference audit core', () => {
  it('normalizes member reference ObjectIds without object-shaped coercion', () => {
    expect(normalizeMemberReferenceObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeMemberReferenceObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeMemberReferenceObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  it('infers a candidate person name from faculty research and lab entity names', () => {
    expect(
      inferMemberReferenceNames({
        member: { id: 'member-1', userId: 'missing-user', role: 'pi' },
        entity: { id: 'entity-1', name: 'Nico Brown Lab', slug: 'nih-pi-nico-brown' },
        candidateUsers: [],
      }),
    ).toEqual(['Nico Brown']);

    expect(
      inferMemberReferenceNames({
        member: { id: 'member-2', userId: 'missing-user', role: 'pi' },
        entity: {
          id: 'entity-2',
          name: 'Ada Lovelace Faculty Research',
          slug: 'dept-cs-ada-lovelace',
        },
        candidateUsers: [],
      }),
    ).toEqual(['Ada Lovelace']);
  });

  it('proposes exact-name relinks but keeps apply blocked', () => {
    const summary = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 1,
      rows: [
        {
          member: {
            id: 'member-1',
            userId: 'missing-user',
            researchEntityId: 'entity-1',
            role: 'pi',
            sourceUrl: 'https://reporter.nih.gov/project-details/10886498',
          },
          entity: { id: 'entity-1', name: 'Nico Brown Lab', slug: 'nih-pi-nico-brown' },
          candidateUsers: [
            {
              id: 'user-1',
              netid: 'nb653',
              name: 'Nico Brown',
              userType: 'professor',
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      mode: 'dry-run',
      orphanedMemberUserRefs: 1,
      plannedExactRelinks: 1,
      manualReviewCount: 0,
      applyBlocked: true,
      plan: [
        {
          action: 'relink_user_id_to_exact_name_match',
          memberId: 'member-1',
          currentUserId: 'missing-user',
          replacementUserId: 'user-1',
          replacementNetid: 'nb653',
          entitySlug: 'nih-pi-nico-brown',
          inferredNames: ['Nico Brown'],
        },
      ],
    });
  });

  it('archives orphan duplicate member rows when the exact replacement membership already exists', () => {
    const summary = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 1,
      rows: [
        {
          member: {
            id: 'orphan-member',
            userId: 'missing-user',
            researchEntityId: 'entity-1',
            role: 'pi',
            sourceUrl: 'https://reporter.nih.gov/project-details/10886498',
          },
          entity: { id: 'entity-1', name: 'Nico Brown Lab', slug: 'nih-pi-nico-brown' },
          candidateUsers: [
            {
              id: 'user-1',
              netid: 'nb653',
              name: 'Nico Brown',
              userType: 'professor',
            },
          ],
          existingMemberMatches: [
            {
              id: 'existing-member',
              userId: 'user-1',
              role: 'pi',
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      orphanedMemberUserRefs: 1,
      plannedExactRelinks: 0,
      plannedDuplicateArchives: 1,
      manualReviewCount: 0,
      plan: [
        {
          action: 'archive_orphan_duplicate_member',
          memberId: 'orphan-member',
          currentUserId: 'missing-user',
          existingMemberId: 'existing-member',
          replacementUserId: 'user-1',
          replacementNetid: 'nb653',
          entitySlug: 'nih-pi-nico-brown',
          inferredNames: ['Nico Brown'],
        },
      ],
    });
  });

  it('parses bounds, output, and guarded apply flags', () => {
    expect(
      parseResearchEntityMemberReferenceAuditArgs([
        '--apply',
        '--confirm-exact-relink',
        '--limit=500',
        '--max-apply',
        '2',
        '--output',
        '/tmp/members.json',
      ]),
    ).toEqual({
      apply: true,
      confirmExactRelink: true,
      limit: 500,
      limitProvided: true,
      maxApply: 2,
      output: '/tmp/members.json',
    });
  });

  it('rejects malformed paired CLI values before running the member reference audit', () => {
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--output', '--apply']),
    ).toThrow('--output requires a path');
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--output=/etc/members.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--output=/tmp/members.txt']),
    ).toThrow(/--output must point to a \.json report file/);
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--limit', '--confirm-exact-relink']),
    ).toThrow('--limit requires a number');
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--limit=1e3']),
    ).toThrow('--limit must be a positive integer');
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--max-apply=bad']),
    ).toThrow('--max-apply must be a positive integer');
    expect(() =>
      parseResearchEntityMemberReferenceAuditArgs(['--max-apply=1e3']),
    ).toThrow('--max-apply must be a positive integer');
    expect(() => parseResearchEntityMemberReferenceAuditArgs(['prod'])).toThrow(
      'Unknown research-entity-members:audit-user-refs option: prod',
    );
  });

  it('blocks apply without confirmation or when manual-review rows remain', () => {
    const exactSummary = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 1,
      rows: [
        {
          member: { id: 'member-1', userId: 'missing-user', role: 'pi' },
          entity: { id: 'entity-1', name: 'Nico Brown Lab', slug: 'nih-pi-nico-brown' },
          candidateUsers: [{ id: 'user-1', name: 'Nico Brown' }],
        },
      ],
    });
    const manualSummary = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 1,
      rows: [
        {
          member: { id: 'member-2', userId: 'missing-user', role: 'pi' },
          entity: { id: 'entity-2', name: 'Unknown Lab', slug: 'unknown-lab' },
          candidateUsers: [],
        },
      ],
    });

    expect(() =>
      assertResearchEntityMemberReferenceApplyAllowed(
        {
          apply: true,
          confirmExactRelink: false,
          limit: 1000,
          limitProvided: true,
          maxApply: 10,
        },
        exactSummary,
      ),
    ).toThrow(/--confirm-exact-relink/);

    expect(() =>
      assertResearchEntityMemberReferenceApplyAllowed(
        {
          apply: true,
          confirmExactRelink: true,
          limit: 1000,
          limitProvided: true,
          maxApply: 10,
        },
        manualSummary,
      ),
    ).toThrow(/manual-review/);

    expect(() =>
      assertResearchEntityMemberReferenceApplyAllowed(
        {
          apply: true,
          confirmExactRelink: true,
          limit: 1000,
          limitProvided: true,
          maxApply: 10,
        },
        exactSummary,
      ),
    ).not.toThrow();
  });

  it('requires an explicit limit before member-reference apply can run', () => {
    const args = parseResearchEntityMemberReferenceAuditArgs([
      '--apply',
      '--confirm-exact-relink',
    ]);
    const exactSummary = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 1,
      rows: [
        {
          member: { id: 'member-1', userId: 'missing-user', role: 'pi' },
          entity: { id: 'entity-1', name: 'Nico Brown Lab', slug: 'nih-pi-nico-brown' },
          candidateUsers: [{ id: 'user-1', name: 'Nico Brown' }],
        },
      ],
    });

    expect(args).toMatchObject({
      apply: true,
      confirmExactRelink: true,
      limit: 1000,
      limitProvided: false,
    });
    expect(() =>
      assertResearchEntityMemberReferenceApplyAllowed(args, exactSummary),
    ).toThrow(/--limit is required/);
  });

  it('blocks member-reference apply against production without confirmation', () => {
    expect(() =>
      assertResearchEntityMemberReferenceTargetAllowed(
        {
          apply: true,
          confirmExactRelink: true,
          limit: 1000,
          limitProvided: true,
          maxApply: 10,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('allows confirmed bounded duplicate archive proposals in apply mode', () => {
    const summary = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 1,
      rows: [
        {
          member: { id: 'orphan-member', userId: 'missing-user', role: 'pi' },
          entity: { id: 'entity-1', name: 'Nico Brown Lab', slug: 'nih-pi-nico-brown' },
          candidateUsers: [{ id: 'user-1', name: 'Nico Brown' }],
          existingMemberMatches: [{ id: 'existing-member', userId: 'user-1', role: 'pi' }],
        },
      ],
    });

    expect(() =>
      assertResearchEntityMemberReferenceApplyAllowed(
        {
          apply: true,
          confirmExactRelink: true,
          limit: 1000,
          limitProvided: true,
          maxApply: 1,
        },
        summary,
      ),
    ).not.toThrow();

    expect(() =>
      assertResearchEntityMemberReferenceApplyAllowed(
        {
          apply: true,
          confirmExactRelink: true,
          limit: 1000,
          limitProvided: true,
          maxApply: 0,
        },
        summary,
      ),
    ).toThrow(/above --max-apply/);
  });

  it('marks apply summaries with applied relinks', () => {
    const summary = buildResearchEntityMemberReferenceAuditSummary({
      mode: 'apply',
      totalOrphanedRefs: 1,
      rows: [],
      applied: [
        {
          action: 'relink_user_id_to_exact_name_match',
          memberId: 'member-1',
          previousUserId: 'missing-user',
          replacementUserId: 'user-1',
          replacementNetid: 'nb653',
        },
      ],
    });

    expect(summary).toMatchObject(
      {
        mode: 'apply',
        applied: [
          {
            action: 'relink_user_id_to_exact_name_match',
            memberId: 'member-1',
            previousUserId: 'missing-user',
            replacementUserId: 'user-1',
            replacementNetid: 'nb653',
          },
        ],
      },
    );
  });

  it('marks apply summaries with applied duplicate archives', () => {
    const summary = buildResearchEntityMemberReferenceAuditSummary({
      mode: 'apply',
      totalOrphanedRefs: 1,
      rows: [],
      applied: [
        {
          action: 'archive_orphan_duplicate_member',
          memberId: 'orphan-member',
          previousUserId: 'missing-user',
          existingMemberId: 'existing-member',
          replacementUserId: 'user-1',
          replacementNetid: 'nb653',
        },
      ],
    });

    expect(summary).toMatchObject({
      mode: 'apply',
      applied: [
        {
          action: 'archive_orphan_duplicate_member',
          memberId: 'orphan-member',
          previousUserId: 'missing-user',
          existingMemberId: 'existing-member',
          replacementUserId: 'user-1',
          replacementNetid: 'nb653',
        },
      ],
    });
  });
});

describe('research entity member reference audit CLI wrapper', () => {
  it('builds the orphan member user reference aggregation pipeline', () => {
    expect(buildOrphanMemberUserReferencePipeline(25)).toEqual(
      expect.arrayContaining([
        { $match: { userId: { $exists: true, $nin: [null, ''] }, archived: { $ne: true } } },
        expect.objectContaining({
          $lookup: expect.objectContaining({
            from: 'users',
            localField: 'userId',
          }),
        }),
        { $match: { _user: { $size: 0 } } },
        expect.objectContaining({
          $lookup: expect.objectContaining({
            from: 'research_entities',
            localField: 'researchEntityId',
          }),
        }),
        { $limit: 25 },
      ]),
    );
  });

  it('builds an active duplicate-member lookup query for exact replacement candidates', () => {
    expect(
      buildExistingMemberMatchQuery(
        {
          member: {
            id: '507f1f77bcf86cd799439011',
            userId: '507f1f77bcf86cd799439012',
            researchEntityId: '507f1f77bcf86cd799439013',
            role: 'pi',
          },
          candidateUsers: [
            { id: '507f1f77bcf86cd799439014', name: 'Nico Brown' },
            { id: 'not-object-id', name: 'Nancy B.' },
          ],
        },
        ['507f1f77bcf86cd799439014'],
      ),
    ).toMatchObject({
      _id: { $ne: '507f1f77bcf86cd799439011' },
      researchEntityId: '507f1f77bcf86cd799439013',
      role: 'pi',
      userId: { $in: ['507f1f77bcf86cd799439014'] },
      archived: { $ne: true },
    });
  });

  it('writes a review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-member-ref-audit-'));
    const output = path.join(dir, 'summary.json');
    const payload = buildResearchEntityMemberReferenceAuditSummary({
      totalOrphanedRefs: 0,
      rows: [],
    });

    writeResearchEntityMemberReferenceAuditOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      orphanedMemberUserRefs: 0,
      plan: [],
    });
    expect(() => writeResearchEntityMemberReferenceAuditOutput(payload, '/etc/summary.json')).toThrow(
      /--output must write under/,
    );
  });

  it('adds target metadata to member-reference audit artifacts', () => {
    const payload = buildResearchEntityMemberReferenceAuditOutput(
      buildResearchEntityMemberReferenceAuditSummary({
        totalOrphanedRefs: 1,
        rows: [],
      }),
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmExactRelink: false,
          limit: 1000,
          limitProvided: false,
          maxApply: 10,
          output: '/tmp/ylabs-member-reference-audit.json',
        },
      },
    );

    expect(payload).toMatchObject({
      mode: 'dry-run',
      orphanedMemberUserRefs: 1,
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmExactRelink: false,
        limit: 1000,
        limitProvided: false,
        maxApply: 10,
        output: '/tmp/ylabs-member-reference-audit.json',
      },
    });
  });

  it('exposes the dry-run command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['research-entity-members:audit-user-refs']).toBe(
      'tsx src/scripts/researchEntityMemberReferenceAudit.ts',
    );
  });
});
