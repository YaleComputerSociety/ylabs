export const GUARDED_ORG = 'YaleComputerSociety/';

export const PUBLISHING_SUBCOMMANDS = {
  pr: new Set(['create', 'edit', 'comment', 'review', 'merge', 'close', 'reopen']),
  issue: new Set(['create', 'edit', 'comment', 'close', 'reopen']),
};

const COMMENTING_ACTIONS = new Set(['close', 'reopen']);

const API_TEXT_FIELDS = new Set(['body', 'title', 'message', 'query']);

const API_FIELD_FLAGS = ['-f', '--raw-field', '-F', '--field'];

const attachedValue = (arg, name) => {
  if (name.startsWith('--')) return arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
  if (!arg.startsWith(name) || arg.length === name.length) return null;
  const rest = arg.slice(name.length);
  return rest.startsWith('=') ? rest.slice(1) : rest;
};

export const optionValues = (args, names) => {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (names.includes(args[i])) {
      if (i + 1 < args.length) values.push(args[i + 1]);
      i += 1;
      continue;
    }
    for (const name of names) {
      const value = attachedValue(args[i], name);
      if (value !== null) {
        values.push(value);
        break;
      }
    }
  }
  return values;
};

export const optionValue = (args, names) => optionValues(args, names)[0];

export const classifyCommand = (args) => {
  const [group, action] = args;
  if (group === 'api') return { group, action, kind: 'api' };
  if (PUBLISHING_SUBCOMMANDS[group]?.has(action)) return { group, action, kind: 'publishing' };
  return { group, action, kind: 'other' };
};

export const explicitRepo = (args, { envRepo }) =>
  optionValue(args, ['-R', '--repo']) ?? (envRepo || undefined);

export const targetRepo = (args, context) => explicitRepo(args, context) ?? context.originUrl ?? '';

const checkoutRemotes = ({ originUrl, remoteUrls = [] }) => [originUrl, ...remoteUrls];

export const isGuardedRepo = (repo) =>
  String(repo).toLowerCase().includes(GUARDED_ORG.toLowerCase());

const apiFields = (args) =>
  optionValues(args, API_FIELD_FLAGS).map((field) => {
    const [key, ...rest] = field.split('=');
    return { key: key.replace(/\[\]$/, ''), value: rest.join('=') };
  });

const isGraphqlMutation = (args) =>
  args.includes('graphql') &&
  apiFields(args).some(({ key, value }) => key === 'query' && /\bmutation\b/.test(value));

const targetsGuardedCheckout = (args, context) => {
  const explicit = explicitRepo(args, context);
  if (explicit !== undefined) return isGuardedRepo(explicit);
  return checkoutRemotes(context).filter(Boolean).some(isGuardedRepo);
};

const targetsGuardedRepo = (args, context) =>
  targetsGuardedCheckout(args, context) || args.some(isGuardedRepo) || isGraphqlMutation(args);

const fillsFromCommits = (args) =>
  args.some((arg) => arg.startsWith('--fill') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg));

export const collectPublishingText = (args, { readBodyFile, branchCommitMessages }) => {
  const [group, action] = args;
  const texts = [
    ...optionValues(args, ['-t', '--title']),
    ...optionValues(args, ['-b', '--body']),
    ...optionValues(args, ['-F', '--body-file']).map(readBodyFile),
    ...optionValues(args, ['--subject']),
  ];
  if (COMMENTING_ACTIONS.has(action)) texts.push(...optionValues(args, ['-c', '--comment']));
  if (group === 'pr' && action === 'create' && fillsFromCommits(args)) {
    texts.push(branchCommitMessages(optionValue(args, ['-B', '--base']) ?? 'beta'));
  }
  return texts;
};

export const collectApiText = (args, { readBodyFile }) => {
  const texts = [];
  for (const { key, value } of apiFields(args)) {
    if (!API_TEXT_FIELDS.has(key)) continue;
    texts.push(value.startsWith('@') ? readBodyFile(value.slice(1)) : value);
  }
  const input = optionValue(args, ['--input']);
  if (input) texts.push(readBodyFile(input));
  return texts;
};

export const planGuard = (args, context) => {
  const command = classifyCommand(args);
  if (command.kind === 'other') return { action: 'passthrough' };
  if (!targetsGuardedRepo(args, context)) return { action: 'passthrough' };

  const collect = command.kind === 'api' ? collectApiText : collectPublishingText;
  const texts = collect(args, context).filter((text) => String(text).trim() !== '');
  if (texts.length === 0) return { action: 'passthrough' };

  const label = command.kind === 'api' ? 'API body' : `${command.group} ${command.action} body`;
  return { action: 'scan', label, text: texts.join('\n\n') };
};

// GitHub does not read a closing keyword inside a code span, so a body that says
// "Closes `#5622`" merges with its issue left open. The no-mistakes gate writes its PR
// bodies that way, and they reach GitHub through this guard, so the guard restores the
// plain form before posting rather than leaving it to someone noticing (#5664).
const LINE_LEADING_BACKTICKED_CLOSING_KEYWORD_RE =
  /^([ \t]*)(close[sd]?|fix(?:e[sd])?|resolve[sd]?)([ \t]*:?[ \t]+)`((?:[\w.-]+\/[\w.-]+)?#\d+)`/i;
const CODE_FENCE_RE = /^[ \t]*(?:```|~~~)/;

export const rewriteBacktickedClosingKeywords = (text) => {
  let count = 0;
  let insideFence = false;
  const lines = String(text)
    .split('\n')
    .map((line) => {
      if (CODE_FENCE_RE.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) return line;
      return line.replace(
        LINE_LEADING_BACKTICKED_CLOSING_KEYWORD_RE,
        (_match, indent, keyword, gap, ref) => {
          count += 1;
          return `${indent}${keyword}${gap}${ref}`;
        },
      );
    });
  return { text: lines.join('\n'), count };
};

const rewriteJsonDocumentBody = (raw) => {
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return { text: raw, count: 0 };
  }
  if (typeof document?.body !== 'string') return { text: raw, count: 0 };
  const result = rewriteBacktickedClosingKeywords(document.body);
  if (result.count === 0) return { text: raw, count: 0 };
  return { text: JSON.stringify({ ...document, body: result.text }), count: result.count };
};

const BODY_VALUE_FLAGS = ['-b', '--body'];
const BODY_FILE_FLAGS = ['-F', '--body-file'];
const API_INPUT_FLAGS = ['--input'];

const splitFlag = (arg, names) => {
  for (const name of names) {
    if (arg === name) return { name, attached: false };
    const value = attachedValue(arg, name);
    if (value !== null) return { name, attached: true, value };
  }
  return null;
};

/**
 * Returns the args and stdin to hand the real gh, with every backticked closing keyword in a
 * body restored to plain text. A body given as a file is never edited in place: the rewritten
 * text goes to a new file from `writeTempFile` and the argument points there instead.
 */
export const planClosingKeywordRewrite = (args, { readBodyFile, readStdin, writeTempFile }) => {
  const command = classifyCommand(args);
  const out = [...args];
  let stdin;
  let count = 0;

  const rewriteText = (text, rewriter = rewriteBacktickedClosingKeywords) => {
    const result = rewriter(text);
    count += result.count;
    return result;
  };
  const rewriteFileArgument = (file, rewriter) => {
    if (file === '-') {
      const result = rewriteText(readStdin(), rewriter);
      if (result.count > 0) stdin = result.text;
      return file;
    }
    const result = rewriteText(readBodyFile(file), rewriter);
    return result.count > 0 ? writeTempFile(result.text) : file;
  };

  const valueFlags = command.kind === 'api' ? API_FIELD_FLAGS : BODY_VALUE_FLAGS;
  const fileFlags = command.kind === 'api' ? API_INPUT_FLAGS : BODY_FILE_FLAGS;
  const fileRewriter =
    command.kind === 'api' ? rewriteJsonDocumentBody : rewriteBacktickedClosingKeywords;

  for (let i = 0; i < out.length; i += 1) {
    const fileFlag = splitFlag(out[i], fileFlags);
    if (fileFlag) {
      if (fileFlag.attached) {
        out[i] = `${fileFlag.name}=${rewriteFileArgument(fileFlag.value, fileRewriter)}`;
      } else if (i + 1 < out.length) {
        out[i + 1] = rewriteFileArgument(out[i + 1], fileRewriter);
        i += 1;
      }
      continue;
    }
    const valueFlag = splitFlag(out[i], valueFlags);
    if (!valueFlag) continue;
    const index = valueFlag.attached ? i : i + 1;
    if (index >= out.length) continue;
    const raw = valueFlag.attached ? valueFlag.value : out[index];
    let next = raw;
    if (command.kind === 'api') {
      const [key, ...rest] = raw.split('=');
      if (key.replace(/\[\]$/, '') !== 'body') continue;
      const value = rest.join('=');
      next = value.startsWith('@')
        ? `${key}=@${rewriteFileArgument(value.slice(1))}`
        : `${key}=${rewriteText(value).text}`;
    } else {
      next = rewriteText(raw).text;
    }
    out[index] = valueFlag.attached ? `${valueFlag.name}=${next}` : next;
    if (!valueFlag.attached) i += 1;
  }

  return { args: out, ...(stdin === undefined ? {} : { stdin }), count };
};
