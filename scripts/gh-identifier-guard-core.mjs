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
