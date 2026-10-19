import { describe, expect, it } from 'vitest';
import { titleResearchOwnership } from '../../scrapers/utils/titleResearchOwnership';
import { cannotOwnResearchHome } from '../researchHomeOwnership';

describe('cannotOwnResearchHome', () => {
  it('reads a page heading or headline as silence rather than as a rank (#5323)', () => {
    for (const heading of [
      'Research Affiliates',
      'Clinical Research Affiliates',
      'Faculty Impact Award',
      'Faculty and Postdocs Hailed as Outstanding Mentors',
    ]) {
      expect(cannotOwnResearchHome(heading)).toBe(false);
    }
  });

  it('still refuses a stated trainee or staff appointment', () => {
    for (const title of ['Postdoctoral Associate', 'Research Affiliate', 'Pre Award Specialist']) {
      expect(cannotOwnResearchHome(title)).toBe(true);
    }
  });

  it('lets a professor emeritus host whatever later clauses name (#5323)', () => {
    const title =
      'Professor Emeritus of Public Health; Affiliated Faculty, Fixture Institute for Global Health; Research Associate, Fixture Bureau';
    expect(cannotOwnResearchHome(title)).toBe(false);
    expect(titleResearchOwnership(title)).toBe('owns_research');
    expect(cannotOwnResearchHome('Professor Emerita; Research Affiliate, Fixture Center')).toBe(
      false,
    );
  });
});
