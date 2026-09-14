import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIRECTORY_DUMP_THRESHOLD,
  findDirectoryDumpFindings,
  findPersonIdentifierFindings,
  formatFindings,
  hasBlockingFindings,
  isDirectoryDumpCandidate,
} from './check-no-person-identifiers-core.mjs';

const body = (content) => [{ label: 'issue body', content }];

const rulesOf = (findings) =>
  findings
    .filter((finding) => (finding.severity ?? 'finding') === 'finding')
    .map((finding) => finding.rule)
    .sort();

test('flags each person-bearing identifier shape', () => {
  const findings = findPersonIdentifierFindings(
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
  const findings = findPersonIdentifierFindings(
    body(
      'The 5 refusals are the departures already researched: Quilla Marrowbane and Tobias Fenwright.',
    ),
  );

  assert.deepEqual(rulesOf(findings), ['person-claim-pairing', 'person-claim-pairing']);
  assert.ok(hasBlockingFindings(findings));
});

test('never echoes the prose name it matched', () => {
  const findings = findPersonIdentifierFindings(
    body('Quilla Marrowbane has departed and the row is wrong.'),
  );

  assert.ok(findings.length > 0);
  assert.ok(!JSON.stringify(findings).includes('Marrowbane'));
  assert.ok(!formatFindings(findings).includes('Marrowbane'));
});

test('a claim about a predicate names nobody, so it stays clean', () => {
  const findings = findPersonIdentifierFindings(
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
    assert.deepEqual(rulesOf(findPersonIdentifierFindings(body(clean))), [], clean);
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
    assert.deepEqual(rulesOf(findPersonIdentifierFindings(body(clean))), [], clean);
  }
});

test('a name inside backticks is still a person, so a code span is not an escape hatch', () => {
  const findings = findPersonIdentifierFindings(
    body('The row for `Quilla Marrowbane` is wrong because they departed.'),
  );

  assert.ok(rulesOf(findings).includes('person-claim-pairing'));
});

test('a sentence naming a person with no claim in it stays clean', () => {
  const findings = findPersonIdentifierFindings(
    body('Quilla Marrowbane matched the page title against the URL leaf.'),
  );

  assert.deepEqual(rulesOf(findings), []);
});

test('a profile URL cited as working-link evidence is a note, not a finding', () => {
  const findings = findPersonIdentifierFindings(
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
  const findings = findPersonIdentifierFindings(
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

  const findings = findPersonIdentifierFindings(body(urls));

  assert.equal(findings.length, DIRECTORY_DUMP_THRESHOLD);
  assert.ok(findings.every((finding) => finding.severity === 'finding'));
});

test('one fewer profile URL, with no claim, stays a note', () => {
  const urls = Array.from(
    { length: DIRECTORY_DUMP_THRESHOLD - 1 },
    (_, index) => `https://physics.yale.edu/profile/person-${index} resolves.`,
  ).join('\n');

  const findings = findPersonIdentifierFindings(body(urls));

  assert.equal(hasBlockingFindings(findings), false);
});

test('flags every person-bearing slug prefix in use', () => {
  for (const slug of [
    'nih-pi-quilla-marrowbane',
    'nsf-pi-quilla-marrowbane',
    'ysm-faculty-quilla-marrowbane',
    'faculty-research-area-quilla-marrowbane',
  ]) {
    const findings = findPersonIdentifierFindings(body(`row ${slug} is wrong`));
    assert.equal(findings.length, 1, slug);
    assert.equal(findings[0].rule, 'person-bearing-entity-slug');
  }
});

test('never echoes the identifier it matched, so CI logs cannot republish it', () => {
  const secretish = 'nih-pi-quilla-marrowbane';
  const findings = findPersonIdentifierFindings(body(`row ${secretish} is wrong`));

  assert.equal(findings.length, 1);
  assert.ok(!JSON.stringify(findings).includes('marrowbane'));
  assert.ok(!formatFindings(findings).includes('marrowbane'));
});

test('a predicate-style description is clean, so the convention passes its own gate', () => {
  const findings = findPersonIdentifierFindings(
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
    assert.deepEqual(findPersonIdentifierFindings(body(clean)), [], clean);
  }
});

test('allows placeholder slugs that name nobody', () => {
  for (const clean of [
    'the slug looks like nih-pi-example',
    'the slug looks like ysm-faculty-placeholder',
    'the slug looks like nsf-pi-surname',
  ]) {
    assert.deepEqual(findPersonIdentifierFindings(body(clean)), [], clean);
  }
});

test('an explicit exemption with a stated reason suppresses the findings', () => {
  const content = [
    'identifier-exempt: rollback runbook needs the literal slug to be greppable',
    'restore nih-pi-quilla-marrowbane from the pre-merge snapshot',
  ].join('\n');

  assert.deepEqual(findPersonIdentifierFindings(body(content)), []);
});

test('reports the line the identifier sits on', () => {
  const findings = findPersonIdentifierFindings(
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
