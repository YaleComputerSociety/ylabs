import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  REFERENCE_CHECKS,
  buildResearchEntityRenameAuditOutput,
  buildLegacyResidueSummary,
  parseResearchEntityRenameAuditArgs,
  writeResearchEntityRenameAuditOutput,
} from '../auditResearchEntityRename';

describe('auditResearchEntityRename CLI helpers', () => {
  it('parses output flags', () => {
    expect(
      parseResearchEntityRenameAuditArgs([
        '--output',
        '/tmp/ylabs-research-entity-rename-audit.json',
      ]),
    ).toEqual({
      output: '/tmp/ylabs-research-entity-rename-audit.json',
    });
  });

  it('rejects unknown positional arguments', () => {
    expect(() => parseResearchEntityRenameAuditArgs(['prod'])).toThrow(
      /Unknown research entity rename audit argument: prod/,
    );
    expect(() => parseResearchEntityRenameAuditArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityRenameAuditArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
  });

  it('writes the rename audit artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-research-entity-rename-'));
    const output = path.join(dir, 'rename-audit.json');
    const payload = {
      generatedAt: '2026-05-31T15:30:00.000Z',
      strategy: 'hard-pivot-copy',
      collections: {
        research_entities: { exists: true, count: 10 },
      },
      references: [],
    };

    writeResearchEntityRenameAuditOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('wraps rename audit artifacts with target metadata and parsed options', () => {
    const output = buildResearchEntityRenameAuditOutput(
      {
        strategy: 'hard-pivot-copy',
        references: [],
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          output: '/tmp/ylabs-research-entity-rename-audit.json',
        },
      },
    );

    expect(output).toEqual({
      strategy: 'hard-pivot-copy',
      references: [],
      environment: 'beta',
      db: 'Beta',
      options: {
        output: '/tmp/ylabs-research-entity-rename-audit.json',
      },
    });
  });

  it('summarizes legacy naming residue by cleanup posture', () => {
    expect(
      buildLegacyResidueSummary([
        {
          collection: 'listings',
          field: 'researchGroupId',
          label: 'Listing legacy host entity pointer',
          collectionExists: true,
          documentsWithResidue: 4,
          classification: 'migration_residue',
          cleanupNote: 'Clean after pathway bridge stability.',
        },
        {
          collection: 'research_group_members',
          field: 'researchEntityId',
          label: 'Legacy member collection',
          collectionExists: true,
          documentsWithResidue: 2,
          classification: 'runtime_cleanup_needed',
          cleanupNote: 'Rename the legacy collection surface.',
        },
        {
          collection: 'student_trackings',
          field: 'researchGroupId',
          label: 'Student tracking legacy field',
          collectionExists: true,
          documentsWithResidue: 0,
          classification: 'runtime_cleanup_needed',
          cleanupNote: 'No residue remains.',
        },
      ]),
    ).toEqual({
      totalChecks: 3,
      totalDocumentsWithResidue: 6,
      migrationResidueDocuments: 4,
      runtimeCleanupDocuments: 2,
      rows: [
        {
          collection: 'listings',
          field: 'researchGroupId',
          label: 'Listing legacy host entity pointer',
          collectionExists: true,
          documentsWithResidue: 4,
          classification: 'migration_residue',
          cleanupNote: 'Clean after pathway bridge stability.',
          status: 'migration_residue',
        },
        {
          collection: 'research_group_members',
          field: 'researchEntityId',
          label: 'Legacy member collection',
          collectionExists: true,
          documentsWithResidue: 2,
          classification: 'runtime_cleanup_needed',
          cleanupNote: 'Rename the legacy collection surface.',
          status: 'runtime_cleanup_needed',
        },
        {
          collection: 'student_trackings',
          field: 'researchGroupId',
          label: 'Student tracking legacy field',
          collectionExists: true,
          documentsWithResidue: 0,
          classification: 'runtime_cleanup_needed',
          cleanupNote: 'No residue remains.',
          status: 'clear',
        },
      ],
    });
  });

  it('checks only active research entity member references for rename readiness', () => {
    expect(
      REFERENCE_CHECKS.find((check) => check.collection === 'research_entity_members'),
    ).toMatchObject({
      field: 'researchEntityId',
      filter: { archived: { $ne: true }, isCurrentMember: { $ne: false } },
    });
  });
});
