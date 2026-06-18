import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildStudentVisibilityRepairTargetReport,
  parseArgs,
  type RepairTargetEntity,
  writeStudentVisibilityRepairTargetOutput,
} from '../studentVisibilityRepairTargets';

const entity = (overrides: Partial<RepairTargetEntity>): RepairTargetEntity => ({
  recordId: overrides.recordId || 'entity-1',
  slug: overrides.slug || 'example-lab',
  label: overrides.label || 'Example Lab',
  entityType: overrides.entityType || 'LAB',
  departments: overrides.departments || [],
  sourceUrls: overrides.sourceUrls || [],
  websiteUrl: overrides.websiteUrl || '',
});

describe('buildStudentVisibilityRepairTargetReport', () => {
  it('buckets held records into repair targets with compact samples', () => {
    const report = buildStudentVisibilityRepairTargetReport({
      plans: [
        {
          collection: 'research',
          recordId: 'lab-1',
          label: 'Held Lab',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_action_evidence', 'missing_description'],
          sourceNames: [],
          nextRepairAction: 'repair',
        },
        {
          collection: 'research',
          recordId: 'dept-1',
          label: 'Physics Program',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_exploratory_framing'],
          sourceNames: [],
          nextRepairAction: 'repair',
        },
        {
          collection: 'research',
          recordId: 'faculty-1',
          label: 'Faculty Research',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_action_evidence', 'profile_fallback_only'],
          sourceNames: [],
          nextRepairAction: 'repair',
        },
        {
          collection: 'research',
          recordId: 'external-1',
          label: 'External Lab',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_action_evidence', 'missing_description'],
          sourceNames: [],
          nextRepairAction: 'repair',
        },
        {
          collection: 'research',
          recordId: 'source-1',
          label: 'No Source Lab',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_source_url'],
          sourceNames: [],
          nextRepairAction: 'repair',
        },
        {
          collection: 'research',
          recordId: 'lead-1',
          label: 'Leadless Lab',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_lab_lead'],
          sourceNames: [],
          nextRepairAction: 'repair',
        },
        {
          collection: 'research',
          recordId: 'ready-1',
          label: 'Ready Lab',
          computedTier: 'student_ready',
          tier: 'student_ready',
          reasons: ['source_backed_description'],
          sourceNames: [],
          nextRepairAction: 'none',
        },
      ],
      entities: [
        entity({
          recordId: 'lab-1',
          slug: 'held-lab',
          label: 'Held Lab',
          websiteUrl: 'https://lab.yale.edu',
          departments: ['Chemistry'],
        }),
        entity({
          recordId: 'dept-1',
          slug: 'physics-program',
          label: 'Physics Program',
          entityType: 'PROGRAM',
          departments: ['Physics'],
          sourceUrls: ['https://physics.yale.edu/research'],
        }),
        entity({
          recordId: 'faculty-1',
          slug: 'faculty-research',
          label: 'Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
        }),
        entity({
          recordId: 'external-1',
          slug: 'external-lab',
          label: 'External Lab',
          websiteUrl: 'https://external.example.edu/lab',
        }),
        entity({
          recordId: 'source-1',
          slug: 'no-source-lab',
          label: 'No Source Lab',
          websiteUrl: 'mailto:owner@yale.edu',
          sourceUrls: [],
        }),
        entity({
          recordId: 'lead-1',
          slug: 'leadless-lab',
          label: 'Leadless Lab',
          entityType: 'LAB',
          sourceUrls: ['https://leadless.yale.edu'],
        }),
        entity({ recordId: 'ready-1', slug: 'ready-lab', label: 'Ready Lab' }),
      ],
    });

    expect(report.llmMicrositeCandidates.slugs).toEqual(['faculty-research', 'held-lab']);
    expect(
      report.llmMicrositeCandidates.samples.find((sample) => sample.slug === 'held-lab'),
    ).toMatchObject({
      recordId: 'lab-1',
      slug: 'held-lab',
      websiteUrl: 'https://lab.yale.edu',
      reasons: ['missing_action_evidence', 'missing_description'],
    });
    expect(report.departmentPageCandidates.slugs).toEqual(['physics-program', 'held-lab']);
    expect(report.sourceUrlBackfillCandidates.slugs).toEqual(['no-source-lab']);
    expect(report.leadRepairCandidates.slugs).toEqual(['leadless-lab']);
  });

  it('constrains output arguments and artifact writes to safe JSON roots', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-visibility-repair-targets-'));
    const output = path.join(dir, 'repair-targets.json');
    const report = buildStudentVisibilityRepairTargetReport({ plans: [], entities: [] });

    expect(parseArgs(['--output', output])).toMatchObject({ output });
    expect(() => parseArgs(['--output=/etc/repair-targets.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseArgs(['--output=/tmp/repair-targets.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );

    await writeStudentVisibilityRepairTargetOutput(report, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      scanned: 0,
      held: 0,
    });
    await expect(
      writeStudentVisibilityRepairTargetOutput(report, '/etc/repair-targets.json'),
    ).rejects.toThrow(/--output must write under/);
  });
});
