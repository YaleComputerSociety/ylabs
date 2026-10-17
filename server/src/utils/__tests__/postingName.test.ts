import { describe, expect, it } from 'vitest';
import { namesAPostingRatherThanResearch } from '../postingName';

describe('namesAPostingRatherThanResearch', () => {
  it.each([
    'The Fixture Postdoctoral Fellowship in Widget Research',
    'Fixture Postdoctoral Fellowship',
    'Short-Term Research Fellowships',
    'Research Fellowships for Graduate Students',
    'Widget Undergraduate Scholarship',
    'The Fixture Award for Widget Studies',
    'Postdoctoral Positions in Widget Imaging',
    'Open Positions',
    'Job Openings',
    'Research Positions Available',
  ])('reads %s as a posting', (name) => {
    expect(namesAPostingRatherThanResearch(name)).toBe(true);
  });

  it.each([
    'Fixture Widget Lab',
    'Center for Fellowships and Widget Studies',
    'Center for Fellowships',
    'Society of Fellows',
    'Yale Fixture Scholars Program',
    'Mood Widget Research Program',
    'Widget Fellows Program',
    'Rafferty Duchamp Faculty Research',
    'Laboratory for Labor Markets and Jobs',
    '',
  ])('reads %s as research', (name) => {
    expect(namesAPostingRatherThanResearch(name)).toBe(false);
  });

  it('reads nothing into a value that is not a string', () => {
    expect(namesAPostingRatherThanResearch(undefined)).toBe(false);
    expect(namesAPostingRatherThanResearch(['Fixture Fellowship'])).toBe(false);
  });
});
