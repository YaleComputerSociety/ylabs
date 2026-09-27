export const GUARDED_ORG = 'YaleComputerSociety/';

export const PUBLISHING_SUBCOMMANDS = {
  pr: new Set(['create', 'edit', 'comment', 'review', 'merge']),
  issue: new Set(['create', 'edit', 'comment']),
};

const API_TEXT_FIELDS = new Set(['body', 'title', 'message']);

export const optionValues = (args, names) => {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    for (const name of names) {
      if (args[i] === name) {
        if (i + 1 < args.length) values.push(args[i + 1]);
      } else if (name.startsWith('--') && args[i].startsWith(`${name}=`)) {
        values.push(args[i].slice(name.length + 1));
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

export const targetRepo = (args, { envRepo, originUrl }) =>
  optionValue(args, ['-R', '--repo']) ?? envRepo ?? originUrl ?? '';

export const isGuardedRepo = (repo) => String(repo).includes(GUARDED_ORG);

export const collectPublishingText = (args, { readBodyFile, branchCommitMessages }) => {
  const texts = [
    ...optionValues(args, ['-t', '--title']),
    ...optionValues(args, ['-b', '--body']),
    ...optionValues(args, ['-F', '--body-file']).map(readBodyFile),
    ...optionValues(args, ['--subject']),
  ];
  const [group, action] = args;
  if (group === 'pr' && action === 'create' && args.some((arg) => arg.startsWith('--fill'))) {
    texts.push(branchCommitMessages(optionValue(args, ['-B', '--base']) ?? 'beta'));
  }
  return texts;
};

export const collectApiText = (args, { readBodyFile }) => {
  const texts = [];
  for (const field of optionValues(args, ['-f', '--raw-field', '-F', '--field'])) {
    const [key, ...rest] = field.split('=');
    if (!API_TEXT_FIELDS.has(key.replace(/\[\]$/, ''))) continue;
    const value = rest.join('=');
    texts.push(value.startsWith('@') ? readBodyFile(value.slice(1)) : value);
  }
  const input = optionValue(args, ['--input']);
  if (input) texts.push(readBodyFile(input));
  return texts;
};

export const planGuard = (args, context) => {
  const command = classifyCommand(args);
  if (command.kind === 'other') return { action: 'passthrough' };
  if (!isGuardedRepo(targetRepo(args, context))) return { action: 'passthrough' };

  const collect = command.kind === 'api' ? collectApiText : collectPublishingText;
  const texts = collect(args, context).filter((text) => String(text).trim() !== '');
  if (texts.length === 0) return { action: 'passthrough' };

  const label = command.kind === 'api' ? 'API body' : `${command.group} ${command.action} body`;
  return { action: 'scan', label, text: texts.join('\n\n') };
};
