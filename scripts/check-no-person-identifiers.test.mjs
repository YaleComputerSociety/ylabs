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
  SYNTHETIC_NETID_RE,
} from './check-no-person-identifiers-core.mjs';

const scanStrict = (documents) => findPersonIdentifierFindings(documents, { strict: true });

// How the CLI scans a `--body-file`: synthetic allowances active. Named so a test reads as
// the mode it is asserting about rather than as an options object.
const scanBody = (documents) => findPersonIdentifierFindings(documents);

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

// The two script-command cases this used to assert went with the script itself (#3765). A
// retired SOURCE name keeps its allowance, because retiring a source does not stop it being
// discussed; a deleted script name loses it, which is the pin working rather than a gap.
test('does not flag a registered source name that embeds a slug prefix', () => {
  for (const clean of [
    'The nih-nsf-pi-center-lab-conflation-repair source is retired and is not wrong.',
    'The ysm-faculty-directory lane wrote 1,102 name observations and none is a graft.',
  ]) {
    assert.deepEqual(rulesOf(scanStrict(body(clean))), [], clean);
  }
});

// A marker convention scales where the invented-surname allowlist does not: the gate's
// drivers seed fixtures to look like real rows, and two consecutive pull requests failed the
// scan on entirely synthetic data before this (#3540).
test('clears a slug or address whose FINAL segment is a reserved synthetic marker', () => {
  for (const clean of [
    'The row ysm-faculty-morgan-fixture emits inferredPiUserId and no lab fields.',
    'The row nih-pi-riley-sample is refused by the guard.',
    'The row dept-physics-avery-placeholder serves nothing.',
    'leadUsers: morgan.fixture@yale.edu was read from the seeded profile.',
    'The driver seeded casey.sample@yale.edu and asserted the refusal.',
  ]) {
    assert.deepEqual(rulesOf(scanBody(body(clean))), [], clean);
  }
});

// A single profile path without a claim is only a note, so the arm that matters is the DUMP
// one: five or more distinct paths read as a directory dump and become findings, which is how
// one body reported 46 of them. Pinned at the threshold in both directions.
test('clears a run of seeded profile paths, and still reports a run of real ones', () => {
  const syntheticRun = [
    'Seeded pages the driver read:',
    'https://medicine.yale.edu/profile/morgan-fixture/',
    'https://medicine.yale.edu/profile/alex-fixture/',
    'https://ysph.yale.edu/profile/casey-sample/',
    'https://medicine.yale.edu/profile/blair-placeholder/',
    'https://medicine.yale.edu/profile/gray-synthetic/',
    'https://medicine.yale.edu/profile/riley-example/',
  ].join('\n');
  assert.deepEqual(rulesOf(scanBody(body(syntheticRun))), [], 'seeded run');

  const realRun = [
    'Rows to check:',
    'https://medicine.yale.edu/profile/alessandra-whitcombe/',
    'https://medicine.yale.edu/profile/bartholomew-quillfeather/',
    'https://ysph.yale.edu/profile/cordelia-ashgrove/',
    'https://medicine.yale.edu/profile/desmond-fairweather/',
    'https://medicine.yale.edu/profile/evangeline-thornbury/',
    'https://medicine.yale.edu/profile/finnegan-ravensworth/',
  ].join('\n');
  assert.ok(rulesOf(scanBody(body(realRun))).length > 0, 'real run must still report');
});

// Terminal position is the whole safety argument, so it is pinned from both directions.
test('still flags a marker word that is not the final segment', () => {
  for (const flagged of [
    ['The row nih-pi-fixture-whitcombe is wrong.', 'person-bearing-entity-slug'],
    ['The row ysm-faculty-sample-whitcombe departed.', 'person-bearing-entity-slug'],
    ['fixture.whitcombe@yale.edu departed.', 'personal-yale-address'],
    ['sample.whitcombe@yale.edu is suppressed.', 'personal-yale-address'],
    [
      'See https://medicine.yale.edu/profile/fixture-whitcombe/ which is stale.',
      'personal-profile-url',
    ],
  ]) {
    assert.deepEqual(rulesOf(scanBody(body(flagged[0]))), [flagged[1]], flagged[0]);
  }
});

// The allowance is a body-scan allowance only. Strict mode is what proves the shape is still
// recognised, so a future change cannot quietly turn the marker into a blanket stoplist.
test('flags every marker form in strict mode, so the shape stays recognised', () => {
  for (const marked of [
    'The row ysm-faculty-morgan-fixture emits inferredPiUserId.',
    'The row nih-pi-riley-sample is refused.',
    'leadUsers: morgan.fixture@yale.edu was read.',
    // Carries a claim, because a profile path cited WITHOUT one is a note rather than a
    // finding and `rulesOf` keeps only findings.
    'See https://medicine.yale.edu/profile/morgan-fixture/ which is stale.',
  ]) {
    assert.ok(rulesOf(scanStrict(body(marked))).length > 0, marked);
  }
});

// Deliberately NOT widened: a netid is opaque, so no marker can be read out of one, and a
// driver has to use the reserved shape instead. Pinned so a later change does not widen it
// by analogy with the slug and address arms.
test('does not widen the netid arm, which has a reserved shape instead', () => {
  assert.deepEqual(rulesOf(scanBody(body('user observations for netid mf900.'))), ['yale-netid']);
  assert.deepEqual(rulesOf(scanBody(body('user observations for netid zz99.'))), []);
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

// The end-to-end pin the allowance lacked. The existing test below checks that every
// COLLIDING name is registered, which is a property of two lists; this scans each real name
// through the detector and asserts no finding, which is the property a body author actually
// depends on. Measured when added: 46 seeded sources, 26 retired names and 222 npm scripts,
// none flagged (#3540).
test('no registered source name or npm script name flags when discussed in a body', async () => {
  const read = async (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
  const seedSources = await read('../server/src/scrapers/seedSources.ts');
  const declared = [...seedSources.matchAll(/^\s*name: '([a-z0-9-]+)',/gm)].map((m) => m[1]);
  const dispatch = await read('../server/src/scrapers/sourceDispatch.ts');
  const retiredBlock = dispatch.slice(dispatch.indexOf('RETIRED_SOURCE_NAMES'));
  const retired = [
    ...retiredBlock.slice(0, retiredBlock.indexOf('];')).matchAll(/'([a-z0-9-]+)'/g),
  ].map((m) => m[1]);
  const scripts = Object.keys(JSON.parse(await read('../server/package.json')).scripts);

  assert.ok(declared.length > 20 && retired.length > 10 && scripts.length > 100);

  const flagged = [];
  for (const name of [...declared, ...retired, ...scripts]) {
    if (rulesOf(scanBody(body(`The ${name} entry is not wrong.`))).length > 0) flagged.push(name);
  }
  assert.deepEqual(
    flagged,
    [],
    'a registered name that flags forces every body discussing it to use identifier-exempt, which suppresses the whole document',
  );
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

  // A retired source name is still a registered name: it stays in the codebase and stored
  // `fieldProvenance` still cites it, so it has to keep its allowance (#3765).
  const dispatch = await readFile(
    new URL('../server/src/scrapers/sourceDispatch.ts', import.meta.url),
    'utf8',
  );
  const retiredBlock = dispatch.slice(dispatch.indexOf('RETIRED_SOURCE_NAMES'));
  const retired = [
    ...retiredBlock.slice(0, retiredBlock.indexOf('];')).matchAll(/'([a-z0-9-]+)'/g),
  ].map((match) => match[1]);
  assert.ok(retired.length > 10, 'expected to parse the retired source name list');

  const serverScripts = JSON.parse(
    await readFile(new URL('../server/package.json', import.meta.url), 'utf8'),
  ).scripts;
  const scriptNames = Object.keys(serverScripts).flatMap((script) => script.split(':'));

  const containsSlugPrefix = (name) =>
    /(?:^|-)(?:nih-pi-|nsf-pi-|ysm-faculty-|faculty-research-area-)/.test(name);
  const colliding = [...declared, ...retired, ...scriptNames].filter(containsSlugPrefix);

  for (const name of colliding) {
    assert.ok(isRegisteredName(name), `${name} collides with a person-slug prefix`);
  }
  for (const name of ['ysm-faculty-directory', 'nih-nsf-pi-center-lab-conflation-repair']) {
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
    [
      'See /tmp/compare-marrowbane-nih-pi-tobias-quilla.png, the row is wrong.',
      'person-bearing-entity-slug',
    ],
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

test('pins the synthetic netid shape, so widening it is a deliberate change', () => {
  assert.equal(SYNTHETIC_NETID_RE.source, '^zz[a-z]?99\\d*$');
});

test('the body scan lets a synthetic netid through while strict mode still flags it', () => {
  for (const fixture of ['netid: zz9993', "const NETID = 'zzq9999';", 'netid=zz99']) {
    assert.deepEqual(rulesOf(findPersonIdentifierFindings(body(fixture))), [], fixture);
    assert.deepEqual(rulesOf(scanStrict(body(fixture))), ['yale-netid'], fixture);
  }
});

test('a netid outside the synthetic shape is flagged by the body scan', () => {
  for (const flagged of ['netid: qmb4821', 'netid: zz1234', 'netid: ab9912', 'netid: zzab99']) {
    assert.deepEqual(rulesOf(findPersonIdentifierFindings(body(flagged))), ['yale-netid'], flagged);
  }
});
