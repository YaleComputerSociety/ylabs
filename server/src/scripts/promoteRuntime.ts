import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type { PromoteDeps } from './promoteFlowsCore';

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const LOG_TAIL_LINES = 20;

function tailOf(filePath: string): string {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .trimEnd()
      .split('\n')
      .slice(-LOG_TAIL_LINES)
      .join('\n');
  } catch {
    return '';
  }
}

export function serverYarnRunner(workDir: string) {
  let step = 0;
  return (args: string[], extraEnv: Record<string, string> = {}): Promise<number | null> => {
    step += 1;
    const logPath = path.join(
      workDir,
      `${String(step).padStart(2, '0')}-${args[0].replace(/[^\w-]/g, '-')}.log`,
    );
    const log = fs.openSync(logPath, 'w');
    console.log(`  running ${args[0]} (log: ${logPath})`);
    return new Promise((resolve) => {
      const child = spawn('yarn', args, {
        cwd: SERVER_ROOT,
        env: { ...process.env, ...extraEnv },
        stdio: ['ignore', log, log],
      });
      const finish = (code: number | null) => {
        fs.closeSync(log);
        if (code !== 0) {
          console.error(`  ${args[0]} exited ${code}; last lines of ${logPath}:`);
          console.error(sanitizeLogValue(tailOf(logPath)));
        }
        resolve(code);
      };
      child.on('error', (error) => {
        console.error(`[promote] could not start yarn: ${sanitizeLogValue(error)}`);
        finish(null);
      });
      child.on('close', (code) => finish(code));
    });
  };
}

export function promptLine(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function createPromotionWorkDir(target: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ylabs-promote-${target}-`));
}

export function baseRuntimeDeps(target: string): PromoteDeps {
  const workDir = createPromotionWorkDir(target);
  console.log(`Reports: ${workDir}`);
  return {
    env: process.env,
    log: (message) => console.log(message),
    error: (message) => console.error(`[promote:${target}] ${sanitizeLogValue(message)}`),
    runYarn: serverYarnRunner(workDir),
    readJson: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')),
    workDir,
    prompt: promptLine,
  };
}
