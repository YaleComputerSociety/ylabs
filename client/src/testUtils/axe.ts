import axe, { type Result, type RunOptions } from 'axe-core';
import { expect } from 'vitest';

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);

const LAYOUT_DEPENDENT_RULES: RunOptions['rules'] = {
  'color-contrast': { enabled: false },
};

export type AxeSurfaceOptions = {
  rules?: RunOptions['rules'];
};

const resolveTarget = (container?: HTMLElement): HTMLElement =>
  container ?? (document.body as HTMLElement);

export const findBlockingAxeViolations = async (
  container?: HTMLElement,
  options: AxeSurfaceOptions = {},
): Promise<Result[]> => {
  const results = await axe.run(resolveTarget(container), {
    runOnly: { type: 'tag', values: WCAG_AA_TAGS },
    resultTypes: ['violations'],
    rules: { ...LAYOUT_DEPENDENT_RULES, ...(options.rules ?? {}) },
  });

  return results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''));
};

const describeViolations = (violations: Result[]): string =>
  violations
    .map((violation) => {
      const nodes = violation.nodes
        .map(
          (node) =>
            `      - ${node.target.join(' ')}${node.failureSummary ? `\n        ${node.failureSummary.replace(/\n/g, '\n        ')}` : ''}`,
        )
        .join('\n');
      return `  [${violation.impact}] ${violation.id}: ${violation.help}\n    ${violation.helpUrl}\n${nodes}`;
    })
    .join('\n\n');

export const expectNoAxeViolations = async (
  container?: HTMLElement,
  options: AxeSurfaceOptions = {},
): Promise<void> => {
  const violations = await findBlockingAxeViolations(container, options);
  expect(
    violations,
    violations.length > 0
      ? `Expected no serious or critical axe violations, found ${violations.length}:\n${describeViolations(violations)}`
      : undefined,
  ).toEqual([]);
};
