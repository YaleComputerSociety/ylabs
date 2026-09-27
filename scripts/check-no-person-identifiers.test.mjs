import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DIRECTORY_DUMP_THRESHOLD,
  findDirectoryDumpFindings,
  findPersonIdentifierFindings,
  formatFindings,
  hasBlockingFindings,
  isDirectoryDumpCandidate,
  isRegisteredName,
  SYNTHETIC_FIXTURE_SURNAMES,
} from './check-no-person-identifiers-core.mjs';

const scanStrict = (documents) => findPersonIdentifierFindings(documents, { strict: true });

const body = (content) => [{ label: 'issue body', content }];

const rulesOf = (findings) =>
  findings
    .filter((finding) => (finding.severity ?? 'finding') === 'finding')
    .map((finding) => finding.rule)
    .sort();

test('flags each person-bearing identifier shape', () => {
  const findings = scanStrict(
    body(
      [
        'The entity nih-pi-quilla-marrowbane serves a stale description.',
        'Its profile is https://physics.yale.edu/people/quilla-marrowbane and',
        'the roster lists quilla.marrowbane@yale.edu as the contact.',
        'netid: qmb4821',
      ].join('\n'),
    ),
  );

  assert.deepEqual(
    findings.map((finding) => finding.rule).sort(),
    [
      'person-bearing-entity-slug',
      'personal-profile-url',
      'personal-yale-address',
      'yale-netid',
    ].sort(),
  );
});

test('flags a prose name paired with a status claim, the case identifier shapes cannot reach', () => {
  const findings = scanStrict(
    body(
      'The 5 refusals are the departures already researched: Quilla Marrowbane and Tobias Fenwright.',
    ),
  );

  assert.deepEqual(rulesOf(findings), ['person-claim-pairing', 'person-claim-pairing']);
  assert.ok(hasBlockingFindings(findings));
});

test('never echoes the prose name it matched', () => {
  const findings = scanStrict(body('Quilla Marrowbane has departed and the row is wrong.'));

  assert.ok(findings.length > 0);
  assert.ok(!JSON.stringify(findings).includes('Marrowbane'));
  assert.ok(!formatFindings(findings).includes('Marrowbane'));
});

test('a claim about a predicate names nobody, so it stays clean', () => {
  const findings = scanStrict(
    body(
      [
        'The 11 rows whose yaleStatusCache is departed still serve a dead citation.',
        'Every one of them is wrong, and 5 sit behind a 403.',
      ].join('\n'),
    ),
  );

  assert.deepEqual(findings, []);
});

test('leaves institutional capitalised pairs alone, because a department is not a person', () => {
  for (const clean of [
    'The Department of Classics page is dead.',
    'The School of Public Health roster is stale.',
    'Yale Research shows the wrong count.',
    'The Jackson School page was permanently closed.',
    'Development and Production both serve the stale description.',
  ]) {
    assert.deepEqual(rulesOf(scanStrict(body(clean))), [], clean);
  }
});

test('ignores the shapes that made the prose rule noisy, measured against the repository docs', () => {
  for (const clean of [
    '## Retired Mongoose models are not registered',
    '| Verdict | Action | The row is dead |',
    'The NSF REU directory is stale and the NIH PI join is wrong.',
    'Per the 2026-08-25 "Simple Directory First" decision the tier is retired.',
    '    Indented Block Text is dead',
    '- Retired Paper Observation Materializer Is Dead',
  ]) {
    assert.deepEqual(rulesOf(scanStrict(body(clean))), [], clean);
  }
});

test('a name inside backticks is still a person, so a code span is not an escape hatch', () => {
  const findings = scanStrict(
    body('The row for `Quilla Marrowbane` is wrong because they departed.'),
  );

  assert.ok(rulesOf(findings).includes('person-claim-pairing'));
});

test('a sentence naming a person with no claim in it stays clean', () => {
  const findings = scanStrict(
    body('Quilla Marrowbane matched the page title against the URL leaf.'),
  );

  assert.deepEqual(rulesOf(findings), []);
});

test('a profile URL cited as working-link evidence is a note, not a finding', () => {
  const findings = scanStrict(
    body(
      'The rewrite is confirmed by https://physics.yale.edu/profile/quilla-marrowbane resolving.',
    ),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'personal-profile-url');
  assert.equal(findings[0].severity, 'note');
  assert.equal(hasBlockingFindings(findings), false);
  assert.ok(formatFindings(findings).includes('note, not a finding'));
});

test('the same profile URL becomes a finding once its sentence carries a claim', () => {
  const findings = scanStrict(
    body('https://physics.yale.edu/profile/quilla-marrowbane is dead because they departed.'),
  );

  const profile = findings.find((finding) => finding.rule === 'personal-profile-url');
  assert.equal(profile.severity, 'finding');
  assert.ok(hasBlockingFindings(findings));
});

test('a run of profile URLs is a finding whatever the prose says, because a list is dump shape', () => {
  const urls = Array.from(
    { length: DIRECTORY_DUMP_THRESHOLD },
    (_, index) => `https://physics.yale.edu/profile/person-${index} resolves.`,
  ).join('\n');

  const findings = scanStrict(body(urls));

  assert.equal(findings.length, DIRECTORY_DUMP_THRESHOLD);
  assert.ok(findings.every((finding) => finding.severity === 'finding'));
});

test('one fewer profile URL, with no claim, stays a note', () => {
  const urls = Array.from(
    { length: DIRECTORY_DUMP_THRESHOLD - 1 },
    (_, index) => `https://physics.yale.edu/profile/person-${index} resolves.`,
  ).join('\n');

  const findings = scanStrict(body(urls));

  assert.equal(hasBlockingFindings(findings), false);
});

test('flags every person-bearing slug prefix in use', () => {
  for (const slug of [
    'nih-pi-quilla-marrowbane',
    'nsf-pi-quilla-marrowbane',
    'ysm-faculty-quilla-marrowbane',
    'faculty-research-area-quilla-marrowbane',
  ]) {
    const findings = scanStrict(body(`row ${slug} is wrong`));
    assert.equal(findings.length, 1, slug);
    assert.equal(findings[0].rule, 'person-bearing-entity-slug');
  }
});

test('does not flag a registered source name that collides with a person-slug prefix', () => {
  const findings = scanStrict(
    body('The ysm-faculty-directory scraper stopped asserting websiteUrl on 151 reads.'),
  );

  assert.deepEqual(findings, []);
});

test('still flags a longer slug that merely starts like a registered source name', () => {
  const findings = scanStrict(body('row ysm-faculty-directorate-of-marrowbane is wrong'));

  assert.equal(rulesOf(findings).length, 1);
  assert.equal(findings[0].rule, 'person-bearing-entity-slug');
});

test('does not flag a registered script or source name that embeds a slug prefix', () => {
  for (const clean of [
    'The `research-homes:repair-nih-nsf-pi-center-lab-conflation` entry stays and is not wrong.',
    '`yarn run | grep -c repair-nih-nsf-pi-center-lab-conflation` returned 1, so nothing is stale.',
    'The nih-nsf-pi-center-lab-conflation-repair source is not wrong.',
  ]) {
    assert.deepEqual(rulesOf(scanStrict(body(clean))), [], clean);
  }
});

test('still flags a person slug at the start of or inside a hyphenated token', () => {
  for (const flagged of [
    'The row `nih-pi-quilla-marrowbane` is wrong.',
    'See https://ylabs.example/research/nsf-pi-quilla-marrowbane which is stale.',
    'The row (ysm-faculty-quilla-marrowbane) departed.',
    'slug=faculty-research-area-quilla-marrowbane is suppressed',
    'See /tmp/screenshot-nih-pi-quilla-marrowbane.png, the row is wrong.',
    'fixture-ysm-faculty-quilla-marrowbane.json shows it departed.',
    'The legacy-ysm-faculty-directory-marrowbane row is stale.',
    'The repair-nih-nsf-pi-center-lab-conflation-marrowbane row is stale.',
  ]) {
    assert.deepEqual(rulesOf(scanStrict(body(flagged))), ['person-bearing-entity-slug'], flagged);
  }
});

test('a capitalised word before a plural acronym is not a name', () => {
  for (const clean of [
    'Adversarial POSTs were handled: the wrong entityType stored nothing.',
    'Duplicate IDs were dropped, so the stale list is gone.',
    'Broken URLs are the defect this fixes.',
  ]) {
    assert.deepEqual(rulesOf(scanStrict(body(clean))), [], clean);
  }
});

test('an internally capitalised surname is still a name', () => {
  for (const flagged of [
    'Quilla McMarrowbane has departed and the row is wrong.',
    'Tobias DeFenwright has departed from the lab.',
  ]) {
    assert.ok(rulesOf(scanStrict(body(flagged))).includes('person-claim-pairing'), flagged);
  }
});

// Pins the allowance to the real registry: a source name added later that collides
// with a person-slug prefix has to be recorded deliberately, and one removed has to
// stop being ignored. Without this the set silently drifts into a stoplist.
test('the registered-name allowance matches the colliding source and script names', async () => {
  const seedSources = await readFile(
    new URL('../server/src/scrapers/seedSources.ts', import.meta.url),
    'utf8',
  );
  const declared = [...seedSources.matchAll(/^\s*name: '([a-z0-9-]+)',/gm)].map(
    (match) => match[1],
  );
  assert.ok(declared.length > 20, 'expected to parse the seedSources name list');

  const serverScripts = JSON.parse(
    await readFile(new URL('../server/package.json', import.meta.url), 'utf8'),
  ).scripts;
  const scriptNames = Object.keys(serverScripts).flatMap((script) => script.split(':'));

  const containsSlugPrefix = (name) =>
    /(?:^|-)(?:nih-pi-|nsf-pi-|ysm-faculty-|faculty-research-area-)/.test(name);
  const colliding = [...declared, ...scriptNames].filter(containsSlugPrefix);

  for (const name of colliding) {
    assert.ok(isRegisteredName(name), `${name} collides with a person-slug prefix`);
  }
  for (const name of [
    'ysm-faculty-directory',
    'nih-nsf-pi-center-lab-conflation-repair',
    'repair-nih-nsf-pi-center-lab-conflation',
  ]) {
    assert.ok(colliding.includes(name), `${name} is no longer a registered name`);
  }
});

test('never echoes the identifier it matched, so CI logs cannot republish it', () => {
  const secretish = 'nih-pi-quilla-marrowbane';
  const findings = scanStrict(body(`row ${secretish} is wrong`));

  assert.equal(findings.length, 1);
  assert.ok(!JSON.stringify(findings).includes('marrowbane'));
  assert.ok(!formatFindings(findings).includes('marrowbane'));
});

test('a predicate-style description is clean, so the convention passes its own gate', () => {
  const findings = scanStrict(
    body(
      [
        'The 12 rows where manuallyLockedFields contains activeAtYaleCache serve a',
        'stale description. 5 of them are also missing sourceLinkHealth.',
        'Reproduce with research-entity:served-scoreboard.',
      ].join('\n'),
    ),
  );

  assert.deepEqual(findings, []);
});

test('allows role addresses and documented placeholders', () => {
  for (const clean of [
    'write to physics@yale.edu for the roster',
    'write to dnalab@yale.edu for the roster',
    'the shape is firstname.lastname@yale.edu',
  ]) {
    assert.deepEqual(scanStrict(body(clean)), [], clean);
  }
});

test('allows placeholder slugs that name nobody', () => {
  for (const clean of [
    'the slug looks like nih-pi-example',
    'the slug looks like ysm-faculty-placeholder',
    'the slug looks like nsf-pi-surname',
  ]) {
    assert.deepEqual(scanStrict(body(clean)), [], clean);
  }
});

test('an explicit exemption with a stated reason suppresses the findings', () => {
  const content = [
    'identifier-exempt: rollback runbook needs the literal slug to be greppable',
    'restore nih-pi-quilla-marrowbane from the pre-merge snapshot',
  ].join('\n');

  assert.deepEqual(scanStrict(body(content)), []);
});

test('reports the line the identifier sits on', () => {
  const findings = scanStrict(
    body(['clean line', 'clean line', 'row nih-pi-quilla-marrowbane is wrong'].join('\n')),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
});

const dumpContent = (count) =>
  JSON.stringify(
    Array.from({ length: count }, (_, index) => ({
      name: `Person ${index}`,
      email: `given${index}.family${index}@yale.edu`,
    })),
  );

test('pins the dump threshold, so raising it cannot silently disable the file arm', () => {
  assert.equal(DIRECTORY_DUMP_THRESHOLD, 5);

  const findings = findDirectoryDumpFindings([
    { path: 'faculty_data.json', content: dumpContent(5) },
  ]);

  assert.equal(findings.length, 1);
  assert.deepEqual(
    findDirectoryDumpFindings([{ path: 'faculty_data.json', content: dumpContent(4) }]),
    [],
  );
});

test('flags a committed data file holding many distinct personal addresses', () => {
  const findings = findDirectoryDumpFindings([
    { path: 'faculty_data.json', content: dumpContent(DIRECTORY_DUMP_THRESHOLD) },
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'committed-directory-dump');
  assert.equal(findings[0].distinctAddresses, DIRECTORY_DUMP_THRESHOLD);
});

test('leaves a data file below the threshold alone', () => {
  const findings = findDirectoryDumpFindings([
    { path: 'faculty_data.json', content: dumpContent(DIRECTORY_DUMP_THRESHOLD - 1) },
  ]);

  assert.deepEqual(findings, []);
});

test('leaves test fixtures alone, because synthetic identifiers there are deliberate', () => {
  const content = dumpContent(DIRECTORY_DUMP_THRESHOLD * 10);

  for (const fixture of [
    'server/src/scrapers/__tests__/fixtures/roster.json',
    'server/src/scrapers/__tests__/roster.json',
    'client/src/utils/__fixtures__/roster.json',
  ]) {
    assert.equal(isDirectoryDumpCandidate(fixture), false, fixture);
    assert.deepEqual(findDirectoryDumpFindings([{ path: fixture, content }]), [], fixture);
  }
});

test('ignores source files, which the body and review path already cover', () => {
  assert.equal(isDirectoryDumpCandidate('server/src/scrapers/entityMaterializer.ts'), false);
  assert.equal(isDirectoryDumpCandidate('docs/research-model.md'), false);
  assert.equal(isDirectoryDumpCandidate('faculty_data.json'), true);
  assert.equal(isDirectoryDumpCandidate('data/roster.csv'), true);
});

test('pins the synthetic fixture roster, so widening it is a deliberate change', () => {
  assert.deepEqual([...SYNTHETIC_FIXTURE_SURNAMES], ['marrowbane', 'fenwright']);
});

test('the body scan lets the synthetic fixtures through, so a detector pull request can quote its tests', () => {
  const fixtures = [
    'The entity nih-pi-quilla-marrowbane serves a stale description.',
    'Its profile https://physics.yale.edu/people/quilla-marrowbane is wrong.',
    'The roster lists quilla.marrowbane@yale.edu and the row is stale.',
    'Quilla Marrowbane and Tobias Fenwright have departed and the rows are wrong.',
  ].join('\n');

  assert.deepEqual(rulesOf(findPersonIdentifierFindings(body(fixtures))), []);
  assert.deepEqual(
    rulesOf(scanStrict(body(fixtures))).sort(),
    [
      'person-bearing-entity-slug',
      'person-claim-pairing',
      'person-claim-pairing',
      'personal-profile-url',
      'personal-yale-address',
    ].sort(),
  );
});

test('a fixture surname beside another name does not let that other name through', () => {
  const cases = [
    ['See /tmp/compare-marrowbane-nih-pi-tobias-quilla.png, the row is wrong.', 'person-bearing-entity-slug'],
    ['Marrowbane Quilla Tobias has departed and the row is wrong.', 'person-claim-pairing'],
    ['Quilla Tobias Fenwright has departed and the row is wrong.', 'person-claim-pairing'],
  ];

  for (const [content, rule] of cases) {
    assert.deepEqual(rulesOf(findPersonIdentifierFindings(body(content))), [rule], content);
  }
});

test('a finding never carries the text it matched', () => {
  const findings = scanStrict(body('Quilla Marrowbane has departed and the row is wrong.'));
  assert.ok(findings.length > 0);
  for (const finding of findings) assert.equal('matched' in finding, false);
});
