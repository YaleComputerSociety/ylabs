import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildScraperIntegrityGateOutput,
  parseScraperIntegrityGateArgs,
  writeIntegrityGateOutput,
} from '../scraperIntegrityGate';
import {
  buildDuplicateAccessSignalGroupsFromRows,
  buildDuplicateResearchPaperGroupsFromRows,
  buildPostMaterializationIntegritySummary,
} from '../../scrapers/integrityGate';

describe('scraperIntegrityGate CLI helpers', () => {
  it('parses include samples limit source-run and output flags', () => {
    expect(
      parseScraperIntegrityGateArgs([
        '--include-samples',
        '--include-claim-gate',
        '--limit',
        '12',
        '--source-run=run-123',
        '--output',
        '/tmp/ylabs-scraper-integrity.json',
      ]),
    ).toEqual({
      includeSamples: true,
      includeClaimGate: true,
      limit: 12,
      sourceRunId: 'run-123',
      output: '/tmp/ylabs-scraper-integrity.json',
    });
  });

  it('rejects malformed paired CLI values before running the integrity gate', () => {
    expect(() =>
      parseScraperIntegrityGateArgs(['--output', '--include-samples']),
    ).toThrow('--output requires a value');
    expect(() =>
      parseScraperIntegrityGateArgs(['--output', path.join(os.tmpdir(), 'integrity.txt')]),
    ).toThrow('--output must point to a .json report file');
    expect(() =>
      parseScraperIntegrityGateArgs(['--output', path.resolve('/etc/ylabs-integrity.json')]),
    ).toThrow('--output must write under');
    expect(() => parseScraperIntegrityGateArgs(['--source-run', '--limit=5'])).toThrow(
      '--source-run requires a value',
    );
    expect(() => parseScraperIntegrityGateArgs(['--limit=bad'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseScraperIntegrityGateArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseScraperIntegrityGateArgs(['prod'])).toThrow('Unknown argument: prod');
  });

  it('writes the integrity gate artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-integrity-gate-'));
    const output = path.join(dir, 'integrity.json');
    writeIntegrityGateOutput(
      {
        status: 'pass',
        failureNames: [],
        warnings: [{ name: 'duplicateEntityNames', count: 2 }],
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      status: 'pass',
      failureNames: [],
      warnings: [{ name: 'duplicateEntityNames', count: 2 }],
    });
  });

  it('rejects unsafe integrity gate output paths before writing', () => {
    expect(() => writeIntegrityGateOutput({ status: 'pass' }, '/etc/ylabs-integrity.json')).toThrow(
      '--output must write under',
    );
  });

  it('wraps scraper integrity artifacts with freshness metadata', () => {
    expect(
      buildScraperIntegrityGateOutput(
        {
          status: 'failure',
          counts: {
            samePiSameNameResearchEntities: 1,
            officialLabUrlResearchEntities: 0,
            duplicatePeople: 0,
            duplicateResearchPapers: 0,
            duplicateCurrentMembers: 0,
            currentMembersOnArchivedEntities: 0,
            duplicateExploratoryContactPathways: 0,
            duplicateAccessSignals: 0,
            activeArtifactsOnArchivedEntities: 0,
          },
          failureNames: ['samePiSameNameResearchEntities'],
          samples: {
            samePiSameNameResearchEntities: [],
            officialLabUrlResearchEntities: [],
            duplicatePeople: [],
            duplicateResearchPapers: [],
            duplicateCurrentMembers: [],
            currentMembersOnArchivedEntities: [],
            duplicateExploratoryContactPathways: [],
            duplicateAccessSignals: [],
            activeArtifactsOnArchivedEntities: [],
          },
          warnings: [],
          recommendedCommands: [],
        },
        {
          generatedAt: '2026-05-31T22:05:00.000Z',
          environment: 'beta',
          db: 'Beta',
          options: {
            includeSamples: true,
            includeClaimGate: false,
            limit: 25,
            output: '/tmp/ylabs-scraper-integrity.json',
          },
        },
      ),
    ).toMatchObject({
      generatedAt: '2026-05-31T22:05:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        includeSamples: true,
        includeClaimGate: false,
        limit: 25,
        output: '/tmp/ylabs-scraper-integrity.json',
      },
      status: 'failure',
      failureNames: ['samePiSameNameResearchEntities'],
    });
  });

  it('recommends same-PI accepted-decision validation instead of broad apply', () => {
    const summary = buildPostMaterializationIntegritySummary({
      samePiNameDuplicateGroups: [
        {
          userId: 'user-1',
          normalizedName: 'jane professor faculty research',
          entityIds: ['canonical-entity', 'duplicate-entity'],
        },
      ],
    });

    expect(summary.status).toBe('failure');
    expect(summary.failureNames).toEqual(['samePiSameNameResearchEntities']);
    expect(summary.recommendedCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
    );
    expect(summary.recommendedCommands).not.toContain(
      'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply',
    );
  });

  it('recommends read-only duplicate review artifacts for paper and access-signal failures', () => {
    const summary = buildPostMaterializationIntegritySummary({
      duplicateResearchPaperGroups: [
        {
          identityField: 'doi',
          identityValue: '10.1234/example',
          paperIds: ['paper-a', 'paper-b'],
        },
      ],
      duplicateAccessSignalGroups: [
        {
          researchEntityId: 'entity-1',
          signalType: 'UNDERGRAD_RESEARCH',
          identityField: 'derivationKey',
          identityValue: 'entity-1:undergrad',
          signalIds: ['signal-a', 'signal-b'],
        },
      ],
    });

    expect(summary.failureNames).toEqual([
      'duplicateResearchPapers',
      'duplicateAccessSignals',
    ]);
    expect(summary.recommendedCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server scraper:integrity-duplicates-review --type=research-papers --limit=1000 --output /tmp/ylabs-integrity-duplicate-research-papers.json',
    );
    expect(summary.recommendedCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server access-signals:repair-duplicates --limit=1000 --output /tmp/ylabs-duplicate-access-signal-repair.json',
    );
  });

  it('targets duplicate-person warning handoff commands at Beta', () => {
    const summary = buildPostMaterializationIntegritySummary({
      warnings: [
        {
          name: 'duplicatePersonIdentityConflicts',
          count: 2,
          message: 'Duplicate person identity conflicts need review.',
        },
      ],
    });

    expect(summary.warnings[0]).toMatchObject({
      classification: 'must_fix_before_promotion',
      owner: 'identity/account operator',
      nextCommand:
        'SCRAPER_ENV=beta yarn --cwd server users:repair-mismatched-emails --limit=10000 --output /tmp/ylabs-mismatched-person-email-repair.json',
    });
    expect(summary.recommendedCommands).toContain(
      'SCRAPER_ENV=beta yarn --cwd server users:repair-mismatched-emails --limit=10000 --output /tmp/ylabs-mismatched-person-email-repair.json',
    );
  });

  it('builds duplicate research-paper groups from repeated paper identifiers', () => {
    expect(
      buildDuplicateResearchPaperGroupsFromRows([
        {
          identityField: 'doi',
          identityValue: '10.1234/example',
          paperIds: ['paper-a', 'paper-b'],
        },
        {
          identityField: 'openAlexId',
          identityValue: 'https://openalex.org/W1',
          paperIds: ['paper-c'],
        },
        {
          identityField: 'arxivId',
          identityValue: '',
          paperIds: ['paper-d', 'paper-e'],
        },
      ]),
    ).toEqual([
      {
        identityField: 'doi',
        identityValue: '10.1234/example',
        paperIds: ['paper-a', 'paper-b'],
      },
    ]);
  });

  it('builds duplicate access-signal groups from repeated signal identities', () => {
    expect(
      buildDuplicateAccessSignalGroupsFromRows([
        {
          researchEntityId: 'entity-1',
          signalType: 'UNDERGRAD_RESEARCH',
          identityField: 'derivationKey',
          identityValue: 'entity-1:undergrad',
          signalIds: ['signal-a', 'signal-b'],
        },
        {
          researchEntityId: 'entity-2',
          signalType: 'POSTED_OPENING',
          identityField: 'observationId',
          identityValue: 'obs-1',
          signalIds: ['signal-c'],
        },
        {
          researchEntityId: 'entity-3',
          signalType: '',
          identityField: 'sourceEvidenceId',
          identityValue: 'obs-2',
          signalIds: ['signal-d', 'signal-e'],
        },
      ]),
    ).toEqual([
      {
        researchEntityId: 'entity-1',
        signalType: 'UNDERGRAD_RESEARCH',
        identityField: 'derivationKey',
        identityValue: 'entity-1:undergrad',
        signalIds: ['signal-a', 'signal-b'],
      },
    ]);
  });
});
