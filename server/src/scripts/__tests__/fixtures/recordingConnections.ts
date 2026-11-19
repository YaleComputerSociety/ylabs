export * from '../../../db/connections';

export const RUN_SCRIPT_MAIN_RECEIVED = 'runScriptMain received the entry point main';

export async function runScriptMain(main: () => Promise<unknown>): Promise<void> {
  if (typeof main !== 'function') throw new TypeError('runScriptMain needs a function');
  console.log(RUN_SCRIPT_MAIN_RECEIVED);
  process.exit(0);
}
