import { runScriptMain } from '../../../db/connections';

async function main(): Promise<void> {
  console.log('main ran without runScriptMain');
}

void runScriptMain;
main().catch(() => process.exit(1));
