import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import postcss, { type Root } from 'postcss';

const STYLESHEET = join(__dirname, '..', 'index.css');

export const scannedCandidates = (content: string, extension: string): string[] =>
  new Scanner({}).scanFiles([{ content, extension }]);

export const scannedPositions = (content: string, extension: string): Set<string> =>
  new Set(
    new Scanner({})
      .getCandidatesWithPositions({ content, extension })
      .map(({ candidate, position }) => `${position}:${candidate}`),
  );

export const candidatesIn = (markup: string): string[] => scannedCandidates(markup, 'html');

/**
 * Optimized the way the Vite build optimizes it, so a guard reads the flat CSS a
 * browser receives rather than Tailwind's nested intermediate output.
 */
export const compileStylesheet = async (candidates: string[]): Promise<Root> => {
  const compiler = await compile(readFileSync(STYLESHEET, 'utf8'), {
    base: dirname(STYLESHEET),
    onDependency: () => {},
  });
  return postcss.parse(optimize(compiler.build(candidates)).code, { from: STYLESHEET });
};
