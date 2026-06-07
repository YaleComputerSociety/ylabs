import { describe, expect, it } from 'vitest';

import {
  buildLaunchTrustContractReport,
  type LaunchTrustContractReport,
} from '../launchTrustContractService';
import type { StudentVisibilityGatePlan } from '../studentVisibilityGateService';

const plan = (
  overrides: Partial<StudentVisibilityGatePlan> = {},
): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId: 'entity-1',
  label: 'Trusted Lab',
  currentTier: 'operator_review',
  computedTier: 'student_ready',
  tier: 'student_ready',
  reasons: ['source_backed_description', 'concrete_next_step'],
  sourceNames: ['lab-microsite-undergrad-llm'],
  nextRepairAction: 'No repair needed.',
  ...overrides,
});

const report = (
  plans: StudentVisibilityGatePlan[],
  mode: 'student-ready-only' | 'public-safe' = 'student-ready-only',
): LaunchTrustContractReport =>
  buildLaunchTrustContractReport(plans, {
    collection: 'all',
    mode,
  });

describe('buildLaunchTrustContractReport', () => {
  it('passes when every scanned record is launch-grade student_ready', () => {
    const result = report([
      plan(),
      plan({ recordId: 'entity-2', label: 'Another Trusted Lab' }),
    ]);

    expect(result.pass).toBe(true);
    expect(result.counts).toMatchObject({
      scanned: 2,
      launchEligible: 2,
      publicVisibilityViolations: 0,
    });
    expect(result.repairLanes).toEqual([]);
  });

  it('fails strict launch mode for limited-but-safe rows and explains action repair', () => {
    const result = report([
      plan(),
      plan({
        recordId: 'entity-2',
        label: 'Sourced But No Route',
        currentTier: 'limited_but_safe',
        computedTier: 'limited_but_safe',
        tier: 'limited_but_safe',
        reasons: ['source_backed_description', 'missing_action_evidence'],
      }),
    ]);

    expect(result.pass).toBe(false);
    expect(result.counts).toMatchObject({
      scanned: 2,
      launchEligible: 1,
      limitedButSafe: 1,
      publicVisibilityViolations: 0,
    });
    expect(result.repairLanes[0]).toMatchObject({
      stage: 'action_evidence',
      count: 1,
      command: expect.stringContaining('beta:repair-queue'),
    });
    expect(result.repairLanes[0].command).toMatch(/^SCRAPER_ENV=beta /);
    expect(result.repairLanes[0].command).toContain('--stage=action_evidence');
    expect(result.repairLanes[0].command).toContain('--mode=dry-run');
    expect(result.repairLanes[0].command).toContain('--retry-blocked');
    expect(result.repairLanes[0].command).toContain(
      '--output /tmp/ylabs-beta-repair-action-evidence.json',
    );
    expect(result.repairLanes[0].command).not.toContain('--mode=apply');
    expect(result.violations[0]).toMatchObject({
      recordId: 'entity-2',
      publicVisibilityViolation: false,
      reasons: expect.arrayContaining(['missing_action_evidence']),
    });
  });

  it('can run in public-safe mode when limited rows are intentionally visible', () => {
    const result = report(
      [
        plan({
          recordId: 'entity-2',
          currentTier: 'limited_but_safe',
          computedTier: 'limited_but_safe',
          tier: 'limited_but_safe',
          reasons: ['source_backed_description', 'missing_action_evidence'],
        }),
      ],
      'public-safe',
    );

    expect(result.pass).toBe(true);
    expect(result.counts).toMatchObject({
      launchEligible: 1,
      limitedButSafe: 1,
      publicVisibilityViolations: 0,
    });
  });

  it('groups held non-public records into ordered repair lanes with commands', () => {
    const result = report([
      plan({
        recordId: 'missing-description',
        label: 'Missing Description',
        computedTier: 'operator_review',
        tier: 'operator_review',
        reasons: ['missing_description', 'missing_source_url'],
      }),
      plan({
        recordId: 'missing-pi',
        label: 'Missing PI',
        computedTier: 'operator_review',
        tier: 'operator_review',
        reasons: ['missing_lead'],
      }),
    ]);

    expect(result.pass).toBe(false);
    expect(result.repairLanes.map((lane) => lane.stage)).toEqual([
      'source_description',
      'pi_identity',
    ]);
    expect(result.repairLanes[0].command).toContain('beta:repair-queue');
    expect(result.repairLanes[0].command).toMatch(/^SCRAPER_ENV=beta /);
    expect(result.repairLanes[0].command).toContain('--mode=dry-run');
    expect(result.repairLanes[0].command).toContain('--retry-blocked');
    expect(result.repairLanes[0].command).toContain(
      '--output /tmp/ylabs-beta-repair-source-description.json',
    );
    expect(result.repairLanes[0].command).not.toContain('--mode=apply');
    expect(result.repairLanes[1].command).toContain('beta:repair-queue');
    expect(result.repairLanes[1].command).toMatch(/^SCRAPER_ENV=beta /);
    expect(result.repairLanes[1].command).toContain('--stage=pi_identity');
    expect(result.repairLanes[1].command).toContain('--mode=dry-run');
    expect(result.repairLanes[1].command).toContain('--retry-blocked');
    expect(result.repairLanes[1].command).toContain(
      '--output /tmp/ylabs-beta-repair-pi-identity.json',
    );
    expect(result.repairLanes[1].command).not.toContain('--mode=apply');
    expect(result.requiredCommands[0]).toContain('student-visibility:gate');
    expect(result.requiredCommands[0]).toMatch(/^SCRAPER_ENV=beta /);
    expect(result.requiredCommands[0]).toContain('--mode=dry-run');
    expect(result.requiredCommands[0]).toContain(
      '--output /tmp/ylabs-student-visibility-gate.json',
    );
    expect(result.requiredCommands[0]).not.toContain('--mode=apply');
  });

  it('treats suppressed hidden records as non-exposed instead of repair violations', () => {
    const result = report([
      plan(),
      plan({
        recordId: 'inactive',
        label: 'Inactive',
        currentTier: 'suppressed',
        computedTier: 'suppressed',
        tier: 'suppressed',
        reasons: ['inactive_at_yale', 'operator_override'],
      }),
    ]);

    expect(result.pass).toBe(true);
    expect(result.counts).toMatchObject({
      scanned: 2,
      launchEligible: 1,
      suppressed: 1,
      publicVisibilityViolations: 0,
    });
    expect(result.repairLanes).toEqual([]);
  });

  it('does not recommend apply mode for review-exception lanes before accepted decisions', () => {
    const result = report([
      plan({
        recordId: 'formalization-only',
        label: 'Formalization Only Fellowship',
        collection: 'programs',
        computedTier: 'operator_review',
        tier: 'operator_review',
        reasons: [
          'official_source',
          'application_route',
          'undergraduate_relevant',
          'formalization_only',
        ],
      }),
    ]);

    expect(result.repairLanes[0]).toMatchObject({
      stage: 'review_exception',
      count: 1,
    });
    expect(result.repairLanes[0].command).toMatch(/^SCRAPER_ENV=beta /);
    expect(result.repairLanes[0].command).toContain('launch:review-exceptions');
    expect(result.repairLanes[0].command).toContain(
      '--decision-template-output /tmp/ylabs-launch-review-exceptions-template.json',
    );
    expect(result.repairLanes[0].command).toContain(
      '--output /tmp/ylabs-launch-review-exceptions.json',
    );
    expect(result.repairLanes[0].command).not.toContain('--mode=apply');
    expect(result.repairLanes[0].command).not.toContain('student-visibility:gate');
  });

  it('fails launch when research activity has unsupported scholarly-link provenance', () => {
    const result = buildLaunchTrustContractReport([plan()], {
      collection: 'all',
      mode: 'student-ready-only',
      researchActivity: {
        pass: false,
        counts: {
          activeScholarlyLinks: 10,
          activeAttributions: 3,
          nullTargetAttributions: 1,
          qualityFailureTotal: 1,
        },
        command: 'yarn --cwd server scholarly-links:provenance-audit --sample-limit=0',
        fixCommand:
          'yarn --cwd server scholarly-links:provenance-audit --apply --confirm-scholarly-link-apply',
      },
    });

    expect(result.pass).toBe(false);
    expect(result.researchActivity).toMatchObject({
      pass: false,
      counts: expect.objectContaining({ nullTargetAttributions: 1 }),
      command: 'SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --sample-limit=0',
      fixCommand:
        'SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --apply --confirm-scholarly-link-apply',
    });
    expect(result.requiredCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --sample-limit=0',
    );
  });

  it('fails launch when paper display quality has launch blockers', () => {
    const result = buildLaunchTrustContractReport([plan()], {
      collection: 'all',
      mode: 'student-ready-only',
      researchActivity: {
        pass: true,
        counts: {
          totalPapers: 10,
          papersWithYaleAuthors: 3,
          paperAuthorRows: 3,
        },
        command: 'yarn --cwd server scholarly-links:provenance-audit --sample-limit=0',
        fixCommand: '',
      },
      paperQuality: {
        pass: false,
        counts: {
          totalActivePapers: 10,
          missingYearOrDate: 2,
          duplicateDoiGroups: 1,
          qualityFailureTotal: 3,
        },
        command: 'yarn --cwd server papers:quality-audit --sample-limit=0',
        fixCommands: [
          'Run DOI/Crossref hydration for missing years and links.',
          'Merge or suppress duplicate paper identifier groups before launch.',
        ],
      },
    });

    expect(result.pass).toBe(false);
    expect(result.paperQuality).toMatchObject({
      pass: false,
      counts: expect.objectContaining({ qualityFailureTotal: 3 }),
      command: 'SCRAPER_ENV=beta yarn --cwd server papers:quality-audit --sample-limit=0',
      fixCommands: [
        'Run DOI/Crossref hydration for missing years and links.',
        'Merge or suppress duplicate paper identifier groups before launch.',
      ],
    });
    expect(result.requiredCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server papers:quality-audit --sample-limit=0',
    );
  });
});
