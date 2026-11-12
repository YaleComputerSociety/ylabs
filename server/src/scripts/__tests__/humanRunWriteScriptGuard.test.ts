import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
  FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS,
} from '../runScraperSweep';
import pendingConversion from './humanRunWriteScripts.pending.json';

const SCRIPTS_DIR = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(__dirname, '..', '..', '..', 'package.json');
const WRITE_SIGNALS = ['assertScriptApplyAllowed(', "'--apply'"];
const WRITE_GUARD_MODULE = 'scriptWriteGuards.ts';
const SWEEP_RUNNER = 'runScraperSweep.ts';

/**
 * Write scripts that are meant to be run by a person, and why. Each one records a judgement
 * about one row or operates infrastructure, which is the work AGENTS.md reserves for an
 * operator. Anything else that writes belongs in a lane or a sweep stage (#3524).
 */
const OPERATOR_TOOLS: Record<string, string> = {
  'research-entity:refuse-field-value': 'records a per-row refusal, the layer-3 writer',
  'researcher:refuse-field-value':
    'records an operator refusal of one value on one person record, the person-record counterpart of the layer-3 writer (#5641)',
  'role-assignments:detach-edge':
    'detaches one role edge an operator judged wrong after reading the pages, as a DISPUTED verdict no lane re-attaches (#5614)',
  'observations:rollback-scrape-run':
    'reverses one unmaterialized scrape run an operator judged harmful, restoring only the observations it superseded (#5735)',
  'researchers:record-distinct-people':
    'records an operator judgement that two researcher records are different people (#5592)',
  'research-entity:apply-page-read-verdict':
    'applies a verdict an operator reached by reading a page',
  'research-entity:adopt-led-group-site':
    "records an operator's verdict that one row's lead runs a named group site, as observations without a lock (#5040)",
  'research-entity:record-departure': 'records a departure an operator was told about',
  'student-visibility:override':
    "records an operator's visibility verdict on one row, an audited per-row judgement rather than a lock or an archive (#5618)",
  'research-entity:withdraw-non-research-home-row':
    'withdraws one row an operator judged not research',
  'research-entity:release-field-locks': 'releases locks one reviewed row at a time',
  'research-entity:restore-merge-tombstones': 'reverses a merge an operator judged wrong',
  'research-entity:repair-dead-end-tombstones':
    'clears one malformed canonical pointer at a time, refusing to guess a destination; the integrity gate now does the detection',
  'research-entity:tombstone-same-person-archives':
    'points an unpointed same-person archive at the one live row its lead reaches, holding any row the lead leaves ambiguous for review',
  'taxonomy:review-term': 'records a curated review of one taxonomy term',
  'programs:accept-formalization-exceptions': 'records reviewed exceptions',
  'launch:review-exceptions': 'records reviewed launch exceptions',
  'lane:benchmark-capture':
    'freezes a new lane benchmark, a deliberate one-time act per scope; the replay is the sweep stage',
  'lane:benchmark-label':
    'attaches hand judgements read off a frozen benchmark page, an operator judgement per row',
  'observations:purge-unread-directory-contact':
    'deletes stored personal contact data, which AGENTS.md reserves for an operator rather than a lane or a sweep stage (#4161)',
  'accounts:delete-account-data':
    "deletes one person's account data on their own request, an operator act for someone who cannot sign in to do it themselves (#4156)",
  'accounts:purge-retired-login-profile-fields':
    'clears stored personal data from login accounts, an operator decision rather than a lane or a promotion side effect (#4162)',
  'research-plans:expire-legacy-archived':
    'expires archived research plans that still hold a student’s private text, an operator decision about stored personal data per environment (#4163)',
  'observations:retire-glued-profile-text':
    'retires the observations the profile lane read from glued block text before #5729, after re-reading each cited page; user email and title are value-keyed, so a fixed re-read adds the right value beside the glued one instead of superseding it, and nothing ever re-emits the glued key (#5720)',
  'observations:retire-orphaned-lane-configs':
    'retires the live observations of an operator-reviewed list of lane configs that exist on no git ref; the producing config is gone, so no lane run can supersede them, and the run-time scan of every ref is a check the sweep has no repository to make (#5807)',
  'observations:retire-rekeyed-person-keys':
    'a one-time backfill of the person keys a lane re-keyed before it retired them at write time; the lanes now retire a re-keyed key in the run that re-keys it, so no later run re-derives the stored backlog (#5817)',
  'observations:nonfetching-lane-gone-pages':
    'a one-time backfill for lanes that never run again or read no page, so no lane or sweep stage can re-derive it (#4862)',
  'directory-removal:record':
    "records or withdraws one person's directory removal request, an operator judgement about one person that no lane can derive (#4160)",
  'directory-removal:purge-observations':
    'deletes the stored observations of people on the removal list, an operator decision about personal data run per environment with owner approval for Beta and Production (#4160)',
  'directory-removal:reslug':
    'renames a co-led row whose slug names a removed lead, a one-time operator act on each removal request; a later pass keeps the slug because the materializer refuses renames and the old key reaches the row by id (#4160)',
  'research-entity:reslug-alt-text-slugs':
    'renames the roster rows whose slug was minted from photo alt text and keeps the old slug as a redirect, a one-time correction: the lane no longer mints such a key and the materializer refuses renames, so no lane or sweep stage can re-derive it (#5808)',
  'research-topics:rekey-stripped':
    'a one-time, owner-decided migration of cached topic readings to the chrome-stripped text key, run once before the materialize that follows the #5577 lane change; a second run is a no-op',
  'db:build-indexes': 'builds declared indexes, a reviewed schema operation',
  'meili:rebuild-research-entities':
    're-embeds the whole index after a settings, embedder, or document-shape change, an infrastructure operation; the sweep stage is the incremental sync (#5023)',
  'research-entity:rematerialize': 're-derives rows on demand through the engine itself',
  'observations:catch-up-materialize': 'drains the materialize backlog through the engine itself',
  'observations:rematerialize-user-keys':
    're-resolves an operator-named list of person keys through the engine itself, for a scoped data step (#5706, #5740)',
  'observations:supersede-replaced-run-emails':
    'a one-time backfill of the run-scoped email rule appendObservations enforces on every write, for rows stored before it, which only a fresh fetch of every page would otherwise reach (#5705)',
  'observations:rederive-over-shared-person-websites':
    're-resolves through the engine itself the people whose evidence asserts an over-shared website, which no lane re-asserts (#5645)',
  'beta:readiness': 'promotion tooling, run as part of the release process',
  'beta:repair-queue': 'promotion tooling, run as part of the release process',
  'beta:clear-student-analytics': 'promotion tooling, run as part of the release process',
  'beta:refresh-from-development': 'promotion tooling, run as part of the release process',
  'development:refresh-from-beta': 'promotion tooling, run as part of the release process',
  'production:promote-beta-copy': 'promotion tooling, run as part of the release process',
  'research-plans:retarget-merged':
    'promotion tooling, run by the remote phase in each serving environment after a copy (#5208)',
  'research-topics:derive':
    'buys a cached model reading of stored page text, a paid step an operator scopes and confirms (#5296); the engine applies the reading at materialization',
  'research-search:seed-rerank-cache':
    'writes relevance scores an operator produced offline for real past queries, environment-local data seeded per environment and never derivable by a lane (#5448)',
  'model-refactor:validators':
    'applies declared collection validators, a reviewed schema operation',
};

const INSTRUMENTS_THAT_REFUSE_APPLY: Record<string, string> = {
  'research-entity:audit-departure-lane': 'throws on --apply and points at the materialize lane',
  'research-entity:measure-retired-remint':
    'throws on --apply; a materializer dry run that measures whether deleting a retired row would let it be minted again',
  'scripts:audit-plans-the-projection-declines': 'throws on --apply, it has no apply path',
  'role-assignments:lead-edge-retirement-review-queue':
    'throws on --apply, read-only by construction',
};

/**
 * The ceiling on write scripts only a person can run that are neither operator tools nor sweep
 * stages. Lower it when one is converted or deleted. Raising it is the thing this guard exists
 * to make a visible, reviewed decision.
 */
const PENDING_CONVERSION_CEILING = 108;

function commandsByScriptFile(): Map<string, string[]> {
  const scripts =
    (JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as { scripts?: Record<string, string> })
      .scripts ?? {};
  const byFile = new Map<string, string[]>();
  for (const [command, line] of Object.entries(scripts)) {
    const match = line.match(/src\/scripts\/([\w./-]+\.ts)/);
    if (!match) continue;
    byFile.set(match[1], [...(byFile.get(match[1]) ?? []), command]);
  }
  return byFile;
}

function humanRunWriteScripts(): string[] {
  const sweptCommands = new Set(
    [...DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS, ...FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS].map(
      (definition) => definition.command,
    ),
  );
  const byFile = commandsByScriptFile();
  return fs
    .readdirSync(SCRIPTS_DIR, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(path.sep).join('/'))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('Core.ts') &&
        !file.includes('__tests__/') &&
        file !== WRITE_GUARD_MODULE &&
        file !== SWEEP_RUNNER,
    )
    .filter((file) => {
      const source = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
      return WRITE_SIGNALS.some((signal) => source.includes(signal));
    })
    .flatMap((file) => {
      const commands = byFile.get(file) ?? [];
      if (commands.some((command) => sweptCommands.has(command))) return [];
      return commands.length > 0 ? [commands[0]] : [`unregistered:${file}`];
    })
    .sort();
}

describe('a write script is born as engine behaviour, not a one-off', () => {
  const found = humanRunWriteScripts();
  const operatorTools = new Set(Object.keys(OPERATOR_TOOLS));
  const refusingInstruments = new Set(Object.keys(INSTRUMENTS_THAT_REFUSE_APPLY));
  const pending = new Set(pendingConversion);

  it('finds the write scripts it is guarding', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it('has no new write script that only a person can run', () => {
    const undeclared = found.filter(
      (entry) =>
        !operatorTools.has(entry) && !pending.has(entry) && !refusingInstruments.has(entry),
    );
    expect(
      undeclared,
      'Register it as a sweep stage in runScraperSweep.ts, fold its correction into a lane, or, if it records a per-row judgement, add it to OPERATOR_TOOLS with the reason.',
    ).toEqual([]);
  });

  it('keeps the pending list exact, so a converted script is removed from it', () => {
    const stale = [...pending].filter((entry) => !found.includes(entry));
    expect(stale, 'These are converted or deleted: remove them and lower the ceiling.').toEqual([]);
  });

  it('keeps every operator tool a real human-run write script', () => {
    expect([...operatorTools].filter((entry) => !found.includes(entry))).toEqual([]);
  });

  it('keeps every instrument that refuses --apply a script that still names the flag', () => {
    expect([...refusingInstruments].filter((entry) => !found.includes(entry))).toEqual([]);
  });

  it('holds the pending list at exactly its ceiling, so it only moves by a reviewed edit', () => {
    expect(pending.size).toBe(PENDING_CONVERSION_CEILING);
    expect(pendingConversion).toHaveLength(pending.size);
  });

  it('never classifies one script both ways', () => {
    expect([...operatorTools].filter((entry) => pending.has(entry))).toEqual([]);
    expect(
      [...refusingInstruments].filter((entry) => pending.has(entry) || operatorTools.has(entry)),
    ).toEqual([]);
  });
});
