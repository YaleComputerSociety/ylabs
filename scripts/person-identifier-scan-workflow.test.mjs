import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowPath = path.join(repoRoot, '.github/workflows/person-identifier-scan.yml');

// The repository declares no YAML dependency and these scripts run on node builtins
// alone, so the workflow is parsed into a step model here rather than string-matched.
const indentOf = (line) => line.match(/^ */)[0].length;
const isStructural = (line) => line.trim() !== '' && !line.trim().startsWith('#');

const stripTrailingComment = (text) => {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index);
    }
  }
  return text;
};

const parseScalar = (raw) => {
  const text = raw.trim();
  if (text === '') return null;
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((entry) => parseScalar(entry))
      .filter((entry) => entry !== null);
  }
  if (/^'.*'$/.test(text) || /^".*"$/.test(text)) return text.slice(1, -1);
  if (text === 'true' || text === 'false') return text === 'true';
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
};

const readBlockScalar = (lines, start, parentIndent, keepTrailingNewline) => {
  const collected = [];
  let blockIndent = null;
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }
    if (indentOf(line) <= parentIndent) break;
    if (blockIndent === null) blockIndent = indentOf(line);
    collected.push(line.slice(blockIndent));
    index += 1;
  }
  while (collected.length > 0 && collected.at(-1) === '') collected.pop();
  const text = collected.join('\n');
  return [keepTrailingNewline ? `${text}\n` : text, index];
};

const nextStructural = (lines, start) => {
  let index = start;
  while (index < lines.length && !isStructural(lines[index])) index += 1;
  return index;
};

const parseNode = (lines, start, indent) => {
  const first = nextStructural(lines, start);
  if (first >= lines.length || indentOf(lines[first]) !== indent) return [null, first];
  if (lines[first].trim().startsWith('- ')) return parseSequence(lines, first, indent);
  return parseMapping(lines, first, indent);
};

const parseSequence = (lines, start, indent) => {
  const items = [];
  let index = start;
  while (true) {
    index = nextStructural(lines, index);
    if (index >= lines.length) break;
    if (indentOf(lines[index]) !== indent || !lines[index].trim().startsWith('- ')) break;
    const itemLines = [lines[index].replace(/^(\s*)- /, '$1  ')];
    let cursor = index + 1;
    while (cursor < lines.length) {
      if (isStructural(lines[cursor]) && indentOf(lines[cursor]) <= indent) break;
      itemLines.push(lines[cursor]);
      cursor += 1;
    }
    items.push(parseNode(itemLines, 0, indent + 2)[0]);
    index = cursor;
  }
  return [items, index];
};

const parseMapping = (lines, start, indent) => {
  const mapping = {};
  let index = start;
  while (true) {
    index = nextStructural(lines, index);
    if (index >= lines.length) break;
    if (indentOf(lines[index]) !== indent) break;
    const match = /^([^:]+):(?:\s+(.*))?$/.exec(lines[index].trim());
    assert.ok(match, `unsupported workflow YAML line: ${lines[index]}`);
    const key = parseScalar(match[1]);
    const inline = match[2] === undefined ? '' : stripTrailingComment(match[2]).trim();
    if (inline === '|' || inline === '|-') {
      const [text, next] = readBlockScalar(lines, index + 1, indent, inline === '|');
      mapping[key] = text;
      index = next;
      continue;
    }
    if (inline === '') {
      const child = nextStructural(lines, index + 1);
      if (child < lines.length && indentOf(lines[child]) > indent) {
        const [value, next] = parseNode(lines, child, indentOf(lines[child]));
        mapping[key] = value;
        index = next;
        continue;
      }
      mapping[key] = null;
      index += 1;
      continue;
    }
    mapping[key] = parseScalar(inline);
    index += 1;
  }
  return [mapping, index];
};

const readWorkflow = (source) => parseNode(source.split('\n'), 0, 0)[0];

const workflow = readWorkflow(fs.readFileSync(workflowPath, 'utf8'));

const resolveExpression = (expression, context) => {
  const body = /^\$\{\{(.*)\}\}$/.exec(expression.trim());
  if (!body) return expression;
  const terms = body[1].split(/(\|\||&&)/).map((term) => term.trim());
  const read = (term) => {
    if (/^'.*'$/.test(term)) return term.slice(1, -1);
    return term
      .split('.')
      .reduce((value, key) => (value == null ? undefined : value[key]), context);
  };
  const truthy = (value) => !(value == null || value === '' || value === 0 || value === false);
  let current = read(terms[0]);
  for (let index = 1; index < terms.length; index += 2) {
    const operator = terms[index];
    const next = read(terms[index + 1]);
    if (operator === '||') current = truthy(current) ? current : next;
    else current = truthy(current) ? next : current;
  }
  return current == null ? '' : String(current);
};

const evaluateCondition = (condition, outputs) => {
  const match = /^steps\.([\w-]+)\.outputs\.([\w-]+)\s*(==|!=)\s*'([^']*)'$/.exec(condition.trim());
  assert.ok(match, `unsupported step condition: ${condition}`);
  const [, stepId, output, operator, literal] = match;
  const actual = outputs[stepId]?.[output] ?? '';
  return operator === '==' ? actual === literal : actual !== literal;
};

const parseStepOutputs = (text) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('=')),
  );

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const runScanBodyJob = async ({ body, existingComments = [], number = 4242 }) => {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'person-scan-job-'));
  const eventContext = { github: { event: { pull_request: { number, body } } } };
  const outputs = {};
  const comments = existingComments.map((comment, index) => ({ id: index + 1, ...comment }));
  const created = [];
  const updated = [];
  const failures = [];
  const skipped = [];
  const logs = [];
  let conclusion = 'success';

  for (const step of workflow.jobs['scan-body'].steps) {
    if (step.if && !evaluateCondition(step.if, outputs)) {
      skipped.push(step.name);
      continue;
    }

    if (step.run) {
      const githubOutput = path.join(runnerTemp, 'github-output');
      fs.writeFileSync(githubOutput, '');
      const env = { ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: githubOutput };
      for (const [key, value] of Object.entries(step.env ?? {})) {
        env[key] = resolveExpression(String(value), eventContext);
      }
      try {
        logs.push(
          execFileSync('bash', ['-c', step.run], { cwd: repoRoot, env, encoding: 'utf8' }).trim(),
        );
      } catch (error) {
        conclusion = 'failure';
        failures.push(`step "${step.name}" exited ${error.status}`);
        break;
      }
      if (step.id) {
        outputs[step.id] = parseStepOutputs(fs.readFileSync(githubOutput, 'utf8'));
      }
      continue;
    }

    if (step.with?.script) {
      const env = { ...process.env, RUNNER_TEMP: runnerTemp };
      for (const [key, value] of Object.entries(step.env ?? {})) {
        env[key] = resolveExpression(String(value), eventContext);
      }
      const github = {
        rest: {
          issues: {
            listComments: async () => ({ data: comments }),
            createComment: async (options) => {
              created.push(options);
              comments.push({ id: comments.length + 1, ...options });
            },
            updateComment: async (options) => {
              updated.push(options);
            },
          },
        },
      };
      const core = {
        info: (message) => logs.push(message),
        warning: (message) => logs.push(message),
        setFailed: (message) => {
          conclusion = 'failure';
          failures.push(message);
        },
      };
      const script = new AsyncFunction(
        'require',
        'github',
        'context',
        'core',
        'process',
        step.with.script,
      );
      await script(
        createRequire(import.meta.url),
        github,
        { repo: { owner: 'yale-research', repo: 'ylabs' } },
        core,
        { ...process, env },
      );
    }
  }

  fs.rmSync(runnerTemp, { recursive: true, force: true });
  return { conclusion, created, updated, failures, skipped, logs, outputs };
};

const flaggedBody = [
  '## Summary',
  '',
  'Quilla Marrowbane has departed and the served row is wrong.',
].join('\n');

const predicateBody = [
  '## Summary',
  '',
  'The 11 rows whose yaleStatusCache is departed still serve a dead citation.',
].join('\n');

test('a flagged pull request body turns the check run red instead of green', async () => {
  const run = await runScanBodyJob({ body: flaggedBody });

  assert.equal(run.conclusion, 'failure');
  assert.equal(run.outputs.scan.exit_code, '1');
  assert.equal(run.created.length, 1);
  assert.match(run.failures.join('\n'), /makes a claim about an identifiable person/);
});

test('the failing run still posts the finding, and never echoes the matched name', async () => {
  const run = await runScanBodyJob({ body: flaggedBody });

  const comment = run.created[0].body;
  assert.match(comment, /<!-- person-identifier-scan -->/);
  assert.match(comment, /person-claim-pairing/);
  assert.ok(!comment.includes('Marrowbane'));
  assert.ok(!run.failures.join('\n').includes('Marrowbane'));
});

test('an edited body that is still flagged updates the comment and stays red', async () => {
  const run = await runScanBodyJob({
    body: flaggedBody,
    existingComments: [{ body: '<!-- person-identifier-scan -->\nearlier report' }],
  });

  assert.equal(run.updated.length, 1);
  assert.equal(run.created.length, 0);
  assert.equal(run.conclusion, 'failure');
});

test('a body written by predicate leaves the check green and posts nothing', async () => {
  const run = await runScanBodyJob({ body: predicateBody });

  assert.equal(run.conclusion, 'success');
  assert.equal(run.outputs.scan.exit_code, '0');
  assert.deepEqual(run.created, []);
  assert.deepEqual(run.updated, []);
  assert.deepEqual(
    run.skipped,
    workflow.jobs['scan-body'].steps.filter((step) => step.if).map((step) => step.name),
  );
});
