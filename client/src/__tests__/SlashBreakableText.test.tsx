import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SlashBreakableText from '../components/shared/SlashBreakableText';

describe('SlashBreakableText', () => {
  it('offers a line break after each slash in a name without changing its text', () => {
    const { container } = render(
      <h1>
        <SlashBreakableText text="Alpha/Beta/Gamma Unit" />
      </h1>,
    );
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Alpha/Beta/Gamma Unit');
    expect(heading?.querySelectorAll('wbr')).toHaveLength(2);
    expect(heading?.innerHTML).toBe('Alpha/<wbr>Beta/<wbr>Gamma Unit');
  });
});
