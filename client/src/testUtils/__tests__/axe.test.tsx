import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoAxeViolations, findBlockingAxeViolations } from '../axe';

afterEach(() => {
  cleanup();
});

describe('accessibility assertion helper', () => {
  it('passes when a fragment has no serious or critical violations', async () => {
    const { container } = render(
      <main>
        <h1>Accessible heading</h1>
        <button type="button">Save research plan</button>
        <img src="/logo.png" alt="Yale Research" />
      </main>,
    );

    await expectNoAxeViolations(container);
  });

  it('reports an image that is missing a text alternative', async () => {
    const { container } = render(
      <main>
        <img src="/logo.png" />
      </main>,
    );

    const violations = await findBlockingAxeViolations(container);
    expect(violations.map((violation) => violation.id)).toContain('image-alt');
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/serious or critical/i);
  });

  it('reports a form control with no programmatic label', async () => {
    const { container } = render(
      <main>
        <input type="text" />
      </main>,
    );

    const violations = await findBlockingAxeViolations(container);
    expect(violations.length).toBeGreaterThan(0);
  });
});
